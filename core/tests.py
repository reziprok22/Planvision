import hashlib
import json
import shutil
import tempfile
import zipfile
from datetime import timedelta
from io import StringIO
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from PIL import Image

from accounts.models import subscription_for
from .models import FeedbackResponse, Project, StoredProject
from .views import _check_page_sizes, _convert_pdf_to_images, PdfTooLargeError

CLOUD_TMP = Path(tempfile.mkdtemp(prefix='planli_cloud_test_'))


def _zip(content=b'PK\x03\x04 fake zip'):
    return SimpleUploadedFile('project.planli', content, content_type='application/zip')


@override_settings(CLOUD_PROJECTS_DIR=CLOUD_TMP)
class CloudStorageTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='test@example.ch', email='test@example.ch', password='pw')
        self.client.login(username='test@example.ch', password='pw')

    def _save(self, **extra):
        data = {'project_zip': _zip(), 'name': 'EFH Muster', **extra}
        return self.client.post(reverse('cloud_save'), data)

    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.get(reverse('cloud_list')).status_code, 401)
        self.assertEqual(self.client.post(reverse('cloud_save')).status_code, 401)

    def test_save_and_list(self):
        response = self._save()
        self.assertEqual(response.status_code, 200)
        project_id = response.json()['id']
        self.assertTrue((CLOUD_TMP / f'{project_id}.planli').exists())

        data = self.client.get(reverse('cloud_list')).json()
        self.assertEqual(len(data['projects']), 1)
        self.assertEqual(data['projects'][0]['name'], 'EFH Muster')
        self.assertEqual(data['limit'], 50)

    def test_save_with_id_overwrites(self):
        project_id = self._save().json()['id']
        response = self._save(project_id=project_id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(StoredProject.objects.count(), 1)

    def test_quota_blocks_new_but_allows_overwrite(self):
        sub = subscription_for(self.user)
        sub.max_projects = 1
        sub.save()
        project_id = self._save().json()['id']
        response = self._save()  # zweites Projekt → Limit
        self.assertEqual(response.status_code, 403)
        self.assertIn('Projektlimit erreicht (1', response.json()['error'])
        # Überschreiben des bestehenden bleibt möglich
        self.assertEqual(self._save(project_id=project_id).status_code, 200)

    @override_settings(MAX_PROJECT_MB=0)
    def test_size_cap(self):
        response = self._save()
        self.assertEqual(response.status_code, 413)

    def test_download_and_ownership(self):
        project_id = self._save().json()['id']
        response = self.client.get(f'/cloud/projects/{project_id}/download')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), b'PK\x03\x04 fake zip')
        # last_opened_at wird gesetzt (Basis der späteren Archivierung)
        self.assertIsNotNone(StoredProject.objects.get(id=project_id).last_opened_at)

        # Fremder User sieht das Projekt nicht
        User.objects.create_user(username='b@example.ch', password='pw')
        self.client.login(username='b@example.ch', password='pw')
        self.assertEqual(self.client.get(f'/cloud/projects/{project_id}/download').status_code, 404)
        self.assertEqual(self.client.post(f'/cloud/projects/{project_id}/delete').status_code, 404)

    def test_rename_and_delete(self):
        project_id = self._save().json()['id']
        response = self.client.post(f'/cloud/projects/{project_id}/rename', {'name': 'MFH Neu'})
        self.assertEqual(response.json()['name'], 'MFH Neu')

        self.client.post(f'/cloud/projects/{project_id}/delete')
        self.assertEqual(StoredProject.objects.count(), 0)
        self.assertFalse((CLOUD_TMP / f'{project_id}.planli').exists())

    def test_duplicate_copies_file_under_new_name(self):
        project_id = self._save().json()['id']
        response = self.client.post(f'/cloud/projects/{project_id}/duplicate')
        self.assertEqual(response.status_code, 200)
        copy_id = response.json()['id']
        self.assertNotEqual(copy_id, project_id)
        self.assertEqual(response.json()['name'], 'EFH Muster (Kopie)')
        self.assertEqual((CLOUD_TMP / f'{copy_id}.planli').read_bytes(), b'PK\x03\x04 fake zip')
        self.assertEqual(StoredProject.objects.get(id=copy_id).size_bytes, 13)

        # Unabhängig: Löschen der Kopie lässt das Original stehen
        self.client.post(f'/cloud/projects/{copy_id}/delete')
        self.assertTrue((CLOUD_TMP / f'{project_id}.planli').exists())

    def test_duplicate_respects_quota_and_ownership(self):
        sub = subscription_for(self.user)
        sub.max_projects = 1
        sub.save()
        project_id = self._save().json()['id']
        response = self.client.post(f'/cloud/projects/{project_id}/duplicate')
        self.assertEqual(response.status_code, 403)
        self.assertIn('Projektlimit erreicht', response.json()['error'])

        User.objects.create_user(username='b@example.ch', password='pw')
        self.client.login(username='b@example.ch', password='pw')
        self.assertEqual(self.client.post(f'/cloud/projects/{project_id}/duplicate').status_code, 404)
        self.assertEqual(StoredProject.objects.count(), 1)

    @override_settings(BETA_PRICING=False)
    def test_read_only_user_cannot_duplicate(self):
        project_id = self._save().json()['id']
        sub = subscription_for(self.user)
        sub.trial_ends = timezone.now() - timedelta(days=1)
        sub.save()
        self.assertEqual(self.client.post(f'/cloud/projects/{project_id}/duplicate').status_code, 403)

    @override_settings(BETA_PRICING=False)
    def test_read_only_user_cannot_save_but_can_open_and_delete(self):
        project_id = self._save().json()['id']
        sub = subscription_for(self.user)
        sub.trial_ends = timezone.now() - timedelta(days=1)
        sub.save()
        response = self._save()
        self.assertEqual(response.status_code, 403)
        self.assertIn('abgelaufen', response.json()['error'])
        # Ansehen (Download) und Löschen bleiben erlaubt
        self.assertEqual(self.client.get(f'/cloud/projects/{project_id}/download').status_code, 200)
        self.assertEqual(self.client.post(f'/cloud/projects/{project_id}/delete').status_code, 200)

    @override_settings(BETA_MODE=False)
    def test_app_view_enables_cloud_for_logged_in(self):
        response = self.client.get(reverse('app'))
        self.assertContains(response, 'window.PLANLI_CLOUD = true')
        self.assertContains(response, 'cloudDashboard')


class LandingCtaTests(TestCase):
    """Primär-CTAs (Nav, Hero, Preise): ausgeloggt (non-beta) zur Registrierung
    statt via /app/ in die Login-Sackgasse; eingeloggt direkt in die App."""

    @override_settings(BETA_MODE=False)
    def test_logged_out_ctas_point_to_register(self):
        response = self.client.get(reverse('landing'))
        self.assertContains(response, reverse('register'))
        self.assertContains(response, 'Kostenlos testen')
        self.assertNotContains(response, 'Zur App')

    @override_settings(BETA_MODE=False)
    def test_logged_in_ctas_point_to_app(self):
        User.objects.create_user(username='a@example.ch', password='pw')
        self.client.login(username='a@example.ch', password='pw')
        response = self.client.get(reverse('landing'))
        self.assertContains(response, 'Zur App')
        self.assertNotContains(response, reverse('register'))

    @override_settings(BETA_MODE=True)
    def test_beta_ctas_unchanged(self):
        response = self.client.get(reverse('landing'))
        self.assertContains(response, 'Beta testen')
        self.assertNotContains(response, reverse('register'))


# SHOW_PRICING=True gepinnt: diese Tests prüfen die Preisdarstellung selbst —
# der Kommunikations-Schalter (Default aktuell False) ist ein eigener Test unten.
@override_settings(GLOBAL_DISCOUNT_PERCENT=0, SHOW_PRICING=True)
class LandingPricingTests(TestCase):
    """Die Preiskarte ist auch während der Beta sichtbar (die Kosten danach
    sollen früh bekannt sein); nur Hinweistext und JSON-LD-Preis unterscheiden
    sich. Der Betrag kommt aus LICENSE_PRICE_CHF, nicht aus dem Template."""

    @override_settings(SHOW_PRICING=False, BETA_PRICING=True, LICENSE_PRICE_CHF=240)
    def test_show_pricing_off_shows_free_beta_section_without_prices(self):
        """SHOW_PRICING=False: die Preissektion zeigt die schlichte
        "Aktuell kostenlos"-Version — keine Preis-Karte, kein Betrag in FAQ
        oder JSON-LD, nirgends auf der Landingpage steht ein Preis."""
        response = self.client.get(reverse('landing'))
        self.assertContains(response, 'id="pricing"')
        self.assertContains(response, 'Aktuell kostenlos')
        self.assertContains(response, 'Jetzt loslegen')
        self.assertNotContains(response, 'Ein Preis, voller Funktionsumfang')
        # Aufs Markup prüfen, nicht auf den Klassennamen: der steht auch im
        # <style>-Block der Seite
        self.assertNotContains(response, '<div class="plan-card')  # Karte weg
        self.assertNotContains(response, '<sup>CHF</sup>')
        self.assertNotContains(response, '"price"')
        self.assertNotContains(response, 'CHF 240')
        self.assertNotContains(response, 'unten stehende Preis')
        # Die FAQ bleibt, nur ohne Betrag
        self.assertContains(response, 'kostenlose Testphase')
        # Ohne offers-Block muss das JSON-LD gültig bleiben (das Komma nach
        # description hängt im Template am if — hier bricht es zuerst)
        html = response.content.decode()
        start = html.index('<script type="application/ld+json">') + len('<script type="application/ld+json">')
        json.loads(html[start:html.index('</script>', start)])

    @override_settings(BETA_PRICING=True, LICENSE_PRICE_CHF=240)
    def test_price_card_visible_during_beta(self):
        response = self.client.get(reverse('landing'))
        self.assertContains(response, '<sup>CHF</sup>240')
        self.assertContains(response, 'nach der Beta-Phase')
        # JSON-LD zeigt, was heute gilt: niemand zahlt etwas
        self.assertContains(response, '"price": "0"')

    @override_settings(BETA_PRICING=False, LICENSE_PRICE_CHF=240)
    def test_price_card_outside_beta(self):
        response = self.client.get(reverse('landing'))
        self.assertContains(response, '<sup>CHF</sup>240')
        self.assertContains(response, '"price": "240"')
        self.assertNotContains(response, 'Während der Beta-Phase ist Planli')

    @override_settings(BETA_PRICING=True, LICENSE_PRICE_CHF=299)
    def test_price_follows_settings(self):
        response = self.client.get(reverse('landing'))
        self.assertContains(response, '<sup>CHF</sup>299')
        self.assertNotContains(response, '<sup>CHF</sup>240')

    @override_settings(BETA_PRICING=False, LICENSE_PRICE_CHF=200,
                       GLOBAL_DISCOUNT_PERCENT=20,
                       GLOBAL_DISCOUNT_REASON='Einführungsrabatt',
                       GLOBAL_DISCOUNT_UNTIL='2099-12-31')
    def test_campaign_shows_struck_price_and_reason(self):
        response = self.client.get(reverse('landing'))
        self.assertContains(response, 'plan-price-was">CHF 200')  # durchgestrichen
        self.assertContains(response, '<sup>CHF</sup>160')
        self.assertContains(response, 'Einführungsrabatt')
        self.assertContains(response, 'gültig bis 31.12.2099')
        self.assertContains(response, '&minus;20&nbsp;%')  # Badge
        self.assertContains(response, '"price": "160"')  # JSON-LD = was man zahlt

    @override_settings(GLOBAL_DISCOUNT_PERCENT=0, LICENSE_PRICE_CHF=200)
    def test_no_campaign_no_struck_price(self):
        response = self.client.get(reverse('landing'))
        self.assertContains(response, '<sup>CHF</sup>200')
        # nur die CSS-Regel darf vorkommen, nicht das Markup
        self.assertNotContains(response, 'plan-price-was">')


class FeedbackTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='test@example.ch', email='test@example.ch', password='pw')
        self.client.login(username='test@example.ch', password='pw')

    def _submit(self, **overrides):
        # `role` ist seit der Rollen-Abfrage Pflicht und wird vom Modal
        # mitgeschickt (project.js) — der Helper muss dasselbe senden wie das
        # Frontend, sonst testet er nur noch die Rollen-Validierung.
        data = {'role': 'architekt', 'positive': 'KI-Erkennung',
                'improve': 'Zoom', 'missing': 'DXF-Export', **overrides}
        return self.client.post(reverse('submit_feedback'), data)

    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self._submit().status_code, 401)

    def test_all_three_answers_required(self):
        response = self._submit(missing='')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(FeedbackResponse.objects.count(), 0)

    def test_role_required(self):
        for role in ('', 'kein-gueltiger-wert'):
            with self.subTest(role=role):
                response = self._submit(role=role)
                self.assertEqual(response.status_code, 400)
                self.assertIn('Rolle', response.json()['error'])
        self.assertEqual(FeedbackResponse.objects.count(), 0)

    def test_sonstiges_needs_free_text(self):
        response = self._submit(role='sonstiges')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(FeedbackResponse.objects.count(), 0)

        response = self._submit(role='sonstiges', role_other='Bauphysik')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(FeedbackResponse.objects.get().role_other, 'Bauphysik')

    def test_role_other_ignored_for_normal_roles(self):
        self._submit(role='architekt', role_other='wird verworfen')
        self.assertEqual(FeedbackResponse.objects.get().role_other, '')

    def test_first_feedback_extends_trial(self):
        response = self._submit()
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['reward_granted'])
        self.assertEqual(data['reward_months'], settings.FEEDBACK_REWARD_DAYS // 30)
        sub = subscription_for(self.user)
        # 180 Tage ab jetzt (mit etwas Toleranz)
        self.assertGreater(sub.trial_ends, timezone.now() + timedelta(days=179))
        self.assertTrue(FeedbackResponse.objects.get().reward_granted)

    def test_second_feedback_grants_no_second_reward(self):
        self._submit()
        first_ends = subscription_for(self.user).trial_ends
        response = self._submit(positive='Immer noch gut')
        self.assertFalse(response.json()['reward_granted'])
        self.assertEqual(subscription_for(self.user).trial_ends, first_ends)
        self.assertEqual(FeedbackResponse.objects.count(), 2)

    def test_expired_trial_is_revived(self):
        sub = subscription_for(self.user)
        sub.trial_ends = timezone.now() - timedelta(days=10)
        sub.save()
        self._submit()
        self.assertTrue(subscription_for(self.user).is_active)

    @override_settings(BETA_MODE=False)
    def test_banner_only_until_first_feedback(self):
        self.assertContains(self.client.get(reverse('app')), 'feedbackBanner')
        self._submit()
        self.assertNotContains(self.client.get(reverse('app')), 'feedbackBanner')


@override_settings(TRIAL_DAYS=30, FEEDBACK_REWARD_DAYS=180)
class ResetTrialsCommandTests(TestCase):
    def _make(self, email, **kwargs):
        return User.objects.create_user(username=email, email=email, password='pw', **kwargs)

    def test_resets_feedback_and_standard_users_from_now(self):
        # Feedback-User mit halb verbrauchtem Zähler, Standard-User längst abgelaufen
        fb = self._make('fb@example.ch')
        fb_sub = subscription_for(fb)
        fb_sub.trial_ends = timezone.now() + timedelta(days=20)
        fb_sub.save()
        FeedbackResponse.objects.create(user=fb, positive='a', improve='b', missing='c')

        plain = self._make('plain@example.ch')
        plain_sub = subscription_for(plain)
        plain_sub.trial_ends = timezone.now() - timedelta(days=5)  # abgelaufen
        plain_sub.save()

        call_command('reset_trials', stdout=StringIO())

        now = timezone.now()
        # Feedback-User: volle 180 Tage ab jetzt (nicht die alten 20)
        self.assertGreater(subscription_for(fb).trial_ends, now + timedelta(days=179))
        # Standard-User: frische 30 Tage ab jetzt (wieder aktiv)
        plain_ends = subscription_for(plain).trial_ends
        self.assertGreater(plain_ends, now + timedelta(days=29))
        self.assertLess(plain_ends, now + timedelta(days=31))
        self.assertTrue(subscription_for(plain).is_active)

    def test_skips_staff_and_paid_by_default(self):
        staff = self._make('staff@example.ch', is_staff=True)
        staff_sub = subscription_for(staff)
        staff_sub.trial_ends = timezone.now() - timedelta(days=5)
        staff_sub.save()

        paid = self._make('paid@example.ch')
        paid_sub = subscription_for(paid)
        paid_sub.trial_ends = timezone.now() - timedelta(days=5)
        paid_sub.paid_until = timezone.localdate() + timedelta(days=365)
        paid_sub.save()

        call_command('reset_trials', stdout=StringIO())

        # Beide unangetastet: Staff (intern) und bezahlte Lizenz
        self.assertLess(subscription_for(staff).trial_ends, timezone.now())
        self.assertLess(subscription_for(paid).trial_ends, timezone.now())

    def test_dry_run_changes_nothing(self):
        u = self._make('dry@example.ch')
        sub = subscription_for(u)
        sub.trial_ends = timezone.now() - timedelta(days=5)
        sub.save()
        before = subscription_for(u).trial_ends

        call_command('reset_trials', '--dry-run', stdout=StringIO())

        self.assertEqual(subscription_for(u).trial_ends, before)


def _pdf(page_widths_pt, height_pt=800):
    """Minimale mehrseitige PDF ohne Fremdbibliothek. Unterschiedliche
    Seitenbreiten machen die Render-Reihenfolge am Ergebnis überprüfbar."""
    objs, out = [], bytearray(b'%PDF-1.4\n')

    def add(body):
        objs.append(len(out))
        out.extend(f'{len(objs)} 0 obj\n'.encode() + body + b'\nendobj\n')

    kids = ' '.join(f'{3 + i * 2} 0 R' for i in range(len(page_widths_pt)))
    add(b'<< /Type /Catalog /Pages 2 0 R >>')
    add(f'<< /Type /Pages /Count {len(page_widths_pt)} /Kids [{kids}] >>'.encode())
    for w in page_widths_pt:
        stream = f'1 w 10 10 m {w - 10} {height_pt - 10} l S'.encode()
        add(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {height_pt}] '
            f'/Contents {len(objs) + 2} 0 R >>'.encode())
        add(f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'\nendstream')

    xref = len(out)
    out.extend(f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode())
    for off in objs:
        out.extend(f'{off:010d} 00000 n \n'.encode())
    out.extend(f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\n'
               f'startxref\n{xref}\n%%EOF\n'.encode())
    return SimpleUploadedFile('plan.pdf', bytes(out), content_type='application/pdf')


class PdfRenderTests(TestCase):
    """Der Render-Pfad lief früher über convert_from_path() ohne output_folder:
    poppler schob die rohen Bitmaps ALLER Seiten durch stdout in den RAM, was
    auf dem 4-GB-Server reproduzierbar den OOM-Killer auslöste. Jetzt schreibt
    pdftoppm direkt auf die Platte — der Peak hängt an einer Seite, nicht an
    der Seitenzahl."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='planli_render_test_'))
        patcher = mock.patch('core.views.PROJECTS_DIR', self.tmp)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_pages_keep_pdf_order(self):
        # Ab 10 Seiten wechselt poppler die Nullauffüllung (page-01 -> page-001);
        # die Sortierung darf davon nicht kippen.
        widths = [200 + i * 40 for i in range(12)]
        info = _convert_pdf_to_images(_pdf(widths))

        self.assertEqual(info['page_count'], 12)
        rendered = [Image.open(p).size[0] for p in info['local_image_paths']]
        expected = [round(w / 72 * settings.PDF_DPI) for w in widths]
        for got, want in zip(rendered, expected):
            self.assertAlmostEqual(got, want, delta=1)

    def test_append_keeps_sources_apart(self):
        info = _convert_pdf_to_images(_pdf([300, 400]))
        session = info['session_id']
        _convert_pdf_to_images(_pdf([500]), project_id=session, source_index=2)

        names = sorted(p.name for p in (self.tmp / session / 'uploads').iterdir())
        self.assertEqual([n for n in names if n.startswith('page_1_')],
                         ['page_1_1.jpg', 'page_1_2.jpg'])
        self.assertEqual([n for n in names if n.startswith('page_2_')], ['page_2_1.jpg'])
        # Das Render-Temp-Verzeichnis darf nichts zurücklassen
        self.assertEqual([n for n in names if n.startswith('render_')], [])

    def test_oversized_page_is_rejected_before_rendering(self):
        with self.assertRaises(PdfTooLargeError):
            _check_page_sizes([(210, 297), (2000, 2000)])

    def test_a0_still_allowed(self):
        _check_page_sizes([(841, 1189)])  # darf nicht werfen

    def test_upload_endpoint_answers_oversized_page_in_plain_german(self):
        # Ohne eigenen except-Zweig liefe das in die generische 500
        # "Error converting PDF: ..." — im Frontend als kryptischer Abbruch.
        User.objects.create_user(username='u@example.ch', email='u@example.ch', password='pw')
        self.client.login(username='u@example.ch', password='pw')

        huge = 2000 / 25.4 * 72  # 2000 mm Kantenlänge in pt
        response = self.client.post(reverse('upload'), {'file': _pdf([huge], huge)})

        self.assertEqual(response.status_code, 400)
        self.assertIn('zu gross', response.json()['error'])

    def test_failed_render_leaves_no_source_number_behind(self):
        # Früher stand document_<n>.pdf schon vor dem Rendern da: ein
        # gescheitertes Anhängen belegte die Nummer, das nächste bekam n+1 und
        # im Client entstand eine Lücke — Ursache für Seiten, die im Export auf
        # eine fremde Quell-PDF zeigten.
        info = _convert_pdf_to_images(_pdf([300]))
        session = info['session_id']
        huge = 2000 / 25.4 * 72
        with self.assertRaises(PdfTooLargeError):
            _convert_pdf_to_images(_pdf([huge], huge), project_id=session, source_index=2)

        names = sorted(p.name for p in (self.tmp / session / 'uploads').iterdir())
        self.assertEqual([n for n in names if n.startswith('document_')], ['document_1.pdf'])

    def test_session_rebuild_keeps_the_clients_source_numbers(self):
        # Ein geöffnetes Projekt mit Lücke (Quellen 1, 2, 5) baut seine Session
        # neu auf. Der Server zählte früher lückenlos (1, 2, 3) — das nächste
        # Anhängen bekam dann eine Nummer, die der Client schon hatte, und
        # überschrieb dort die Quell-PDF.
        User.objects.create_user(username='u@example.ch', email='u@example.ch', password='pw')
        self.client.login(username='u@example.ch', password='pw')

        first = self.client.post(reverse('upload'), {'file': _pdf([300]), 'source_index': 1}).json()
        session = first['session_id']
        for idx in (2, 5):
            data = self.client.post(reverse('upload_append'), {
                'file': _pdf([400]), 'session_id': session, 'source_index': idx}).json()
            self.assertEqual(data['source_index'], idx)
            self.assertEqual(data['all_pages'],
                             [f'/project_files/{session}/uploads/page_{idx}_1.jpg'])

        names = {p.name for p in (self.tmp / session / 'uploads').iterdir()}
        self.assertEqual({n for n in names if n.startswith('document_')},
                         {'document_1.pdf', 'document_2.pdf', 'document_5.pdf'})

        # Ohne source_index (altes JS-Bundle): nächste freie Nummer wie bisher
        legacy = self.client.post(reverse('upload_append'), {
            'file': _pdf([500]), 'session_id': session}).json()
        self.assertEqual(legacy['source_index'], 6)

    def test_invalid_source_index_is_rejected(self):
        User.objects.create_user(username='u@example.ch', email='u@example.ch', password='pw')
        self.client.login(username='u@example.ch', password='pw')
        for bad in ('0', '-1', 'abc', '1000'):
            response = self.client.post(reverse('upload'), {'file': _pdf([300]), 'source_index': bad})
            self.assertEqual(response.status_code, 400, bad)


@override_settings(CLOUD_PROJECTS_DIR=CLOUD_TMP)
class CloudDeltaSaveTests(TestCase):
    """Delta-Speichern: Der Client schickt ein Manifest mit Inhalts-Hashes; nur
    was der Server noch nicht hat, geht über die Leitung. Inhaltsadressiert,
    weil `pages/page_N.jpg` positionsbenannt ist — Umsortieren, Löschen und
    Duplizieren ändern die Namen, nicht die Bytes."""

    JSON_ENTRIES = {
        'metadata.json':    '{"format_version": 3}',
        'canvas_data.json': '{"pages": {}}',
        'labels.json':      '[]',
        'settings.json':    '{}',
    }

    def setUp(self):
        self.user = User.objects.create_user(
            username='delta@example.ch', email='delta@example.ch', password='pw')
        self.client.login(username='delta@example.ch', password='pw')
        self.pdf = b'%PDF-1.4 fake original' + b'x' * 5000
        self.jpgs = [b'\xff\xd8jpeg-seite-%d' % i + b'y' * 500 for i in range(3)]

    # ── Hilfen ───────────────────────────────────────────────────────────────
    @staticmethod
    def _sha(data):
        return hashlib.sha256(data).hexdigest()

    def _entry(self, name, data):
        return {'name': name, 'sha256': self._sha(data), 'size': len(data)}

    def _manifest(self, entries, json_entries=None):
        return json.dumps({'json': json_entries or self.JSON_ENTRIES, 'entries': entries})

    def _commit(self, entries, blobs=(), json_entries=None, **extra):
        data = {'manifest': self._manifest(entries, json_entries), 'name': 'Delta-Projekt', **extra}
        for blob in blobs:
            data[f'blob_{self._sha(blob)}'] = SimpleUploadedFile(self._sha(blob), blob)
        return self.client.post(reverse('cloud_save'), data)

    def _full_save(self):
        """Erstes Speichern: PDF + drei Seiten gehen komplett hoch."""
        entries = [self._entry('sources/1.pdf', self.pdf)] + [
            self._entry(f'pages/page_{i + 1}.jpg', j) for i, j in enumerate(self.jpgs)]
        response = self._commit(entries, blobs=[self.pdf, *self.jpgs])
        self.assertEqual(response.status_code, 200)
        return response.json()['id'], entries

    def _stored(self, project_id):
        return zipfile.ZipFile(CLOUD_TMP / f'{project_id}.planli')

    # ── Tests ────────────────────────────────────────────────────────────────
    def test_first_save_stores_everything(self):
        project_id, _ = self._full_save()
        with self._stored(project_id) as z:
            self.assertEqual(z.read('sources/1.pdf'), self.pdf)
            self.assertEqual(z.read('pages/page_1.jpg'), self.jpgs[0])
            self.assertEqual(json.loads(z.read('metadata.json'))['format_version'], 3)

    def test_prepare_reports_only_unknown_hashes(self):
        project_id, entries = self._full_save()
        neu = b'\xff\xd8ganz neue seite'
        response = self.client.post(
            reverse('cloud_save_prepare'),
            json.dumps({'project_id': project_id,
                        'hashes': [e['sha256'] for e in entries] + [self._sha(neu)]}),
            content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['missing'], [self._sha(neu)])

    def test_reorder_delete_duplicate_need_no_upload(self):
        """Der Kern: Seiten umsortieren, eine löschen, eine duplizieren —
        alles ohne ein einziges hochgeladenes Byte."""
        project_id, _ = self._full_save()
        entries = [
            self._entry('sources/1.pdf', self.pdf),
            self._entry('pages/page_1.jpg', self.jpgs[2]),   # war Seite 3
            self._entry('pages/page_2.jpg', self.jpgs[0]),   # war Seite 1
            self._entry('pages/page_3.jpg', self.jpgs[0]),   # dupliziert
        ]                                                    # jpgs[1] gelöscht
        response = self._commit(entries, blobs=[], project_id=project_id,
                                json_entries={**self.JSON_ENTRIES, 'labels.json': '["Fenster"]'})

        self.assertEqual(response.status_code, 200)
        with self._stored(project_id) as z:
            self.assertEqual(z.read('sources/1.pdf'), self.pdf)
            self.assertEqual(z.read('pages/page_1.jpg'), self.jpgs[2])
            self.assertEqual(z.read('pages/page_2.jpg'), self.jpgs[0])
            self.assertEqual(z.read('pages/page_3.jpg'), self.jpgs[0])
            self.assertEqual(z.read('labels.json').decode(), '["Fenster"]')
            self.assertNotIn('pages/page_4.jpg', z.namelist())

    def test_appending_uploads_only_the_new_page(self):
        project_id, entries = self._full_save()
        neu = b'\xff\xd8angehaengte seite'
        entries = entries + [self._entry('pages/page_4.jpg', neu)]
        response = self._commit(entries, blobs=[neu], project_id=project_id)
        self.assertEqual(response.status_code, 200)
        with self._stored(project_id) as z:
            self.assertEqual(z.read('pages/page_4.jpg'), neu)
            self.assertEqual(z.read('sources/1.pdf'), self.pdf)

    def test_commit_demands_missing_blobs_with_409(self):
        """Der Commit verlässt sich nicht auf die prepare-Antwort, sondern
        prüft selbst — sonst würde ein Race die Datei unvollständig machen."""
        entries = [self._entry('sources/1.pdf', self.pdf),
                   self._entry('pages/page_1.jpg', self.jpgs[0])]
        response = self._commit(entries, blobs=[self.pdf])   # Seite fehlt
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['missing'], [self._sha(self.jpgs[0])])
        self.assertEqual(StoredProject.objects.count(), 0)

    def test_lost_stored_file_falls_back_to_full_upload(self):
        """Fehlt die gespeicherte Datei, meldet der Server alles als fehlend —
        der Client lädt dann alles hoch, wie vor dem Delta-Speichern."""
        project_id, entries = self._full_save()
        (CLOUD_TMP / f'{project_id}.planli').unlink()

        prepare = self.client.post(
            reverse('cloud_save_prepare'),
            json.dumps({'project_id': project_id, 'hashes': [e['sha256'] for e in entries]}),
            content_type='application/json')
        self.assertEqual(sorted(prepare.json()['missing']),
                         sorted(e['sha256'] for e in entries))

        self.assertEqual(self._commit(entries, blobs=[], project_id=project_id).status_code, 409)
        response = self._commit(entries, blobs=[self.pdf, *self.jpgs], project_id=project_id)
        self.assertEqual(response.status_code, 200)
        with self._stored(project_id) as z:
            self.assertEqual(z.read('sources/1.pdf'), self.pdf)

    def test_rejects_foreign_entry_names(self):
        entries = [{'name': '../../etc/passwd', 'sha256': self._sha(self.pdf), 'size': len(self.pdf)}]
        response = self._commit(entries, blobs=[self.pdf])
        self.assertEqual(response.status_code, 400)

    def test_rejects_blob_that_does_not_match_its_hash(self):
        entries = [self._entry('sources/1.pdf', self.pdf)]
        manipuliert = b'%PDF-1.4 etwas ganz anderes'
        data = {'manifest': self._manifest(entries), 'name': 'X',
                f'blob_{self._sha(self.pdf)}': SimpleUploadedFile('x', manipuliert)}
        response = self.client.post(reverse('cloud_save'), data)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(StoredProject.objects.count(), 0)

    def test_size_cap_counts_manifest_entries(self):
        entries = [self._entry('sources/1.pdf', self.pdf)]
        with override_settings(MAX_PROJECT_MB=0):
            self.assertEqual(self._commit(entries, blobs=[self.pdf]).status_code, 413)

    @override_settings(BETA_PRICING=False)
    def test_read_only_blocks_delta_save(self):
        sub = subscription_for(self.user)
        sub.trial_ends = timezone.now() - timedelta(days=1)
        sub.save()
        entries = [self._entry('sources/1.pdf', self.pdf)]
        self.assertEqual(self._commit(entries, blobs=[self.pdf]).status_code, 403)

    def test_large_manifest_survives_django_form_limit(self):
        """canvas_data.json steckt inline im Manifest. Als Formularfeld würde
        Django ab DATA_UPLOAD_MAX_MEMORY_SIZE (2.6 MB) abbrechen — deshalb geht
        es als Datei-Part hoch, wie es der Browser auch tut."""
        gross = {**self.JSON_ENTRIES, 'canvas_data.json': json.dumps({'x': 'a' * 4_000_000})}
        entries = [self._entry('sources/1.pdf', self.pdf)]
        data = {
            'manifest': SimpleUploadedFile(
                'manifest.json', self._manifest(entries, gross).encode(), 'application/json'),
            'name': 'Grosses Projekt',
            f'blob_{self._sha(self.pdf)}': SimpleUploadedFile('x', self.pdf),
        }
        response = self.client.post(reverse('cloud_save'), data)
        self.assertEqual(response.status_code, 200)
        with self._stored(response.json()['id']) as z:
            self.assertEqual(len(json.loads(z.read('canvas_data.json'))['x']), 4_000_000)

    def test_prepare_requires_own_project(self):
        project_id, _ = self._full_save()
        User.objects.create_user(username='fremd@example.ch', password='pw')
        self.client.login(username='fremd@example.ch', password='pw')
        response = self.client.post(
            reverse('cloud_save_prepare'),
            json.dumps({'project_id': project_id, 'hashes': []}),
            content_type='application/json')
        self.assertEqual(response.status_code, 404)


PROJECTS_TMP = Path(tempfile.mkdtemp(prefix='planli_projects_test_'))


@override_settings(CLOUD_PROJECTS_DIR=CLOUD_TMP, PROJECTS_DIR=PROJECTS_TMP)
class ProjectFileCleanupTests(TestCase):
    """Die Dateien einer gelöschten Zeile müssen mit verschwinden — egal auf
    welchem Weg gelöscht wurde. Vorher räumte nur die Selbstlöschung des
    Kontos auf: eine Löschung im /vitruv/-Admin liess `cloud_projects/*.planli`
    und `projects/<uuid>/` für immer liegen (der cleanup_projects-Cron fasst
    `cloud_projects/` nie an)."""

    def setUp(self):
        CLOUD_TMP.mkdir(parents=True, exist_ok=True)
        PROJECTS_TMP.mkdir(parents=True, exist_ok=True)
        self.user = User.objects.create_user(
            username='test@example.ch', email='test@example.ch', password='sicher-genug-42')

    def _stored(self):
        stored = StoredProject.objects.create(user=self.user, name='EFH', size_bytes=3)
        stored.file_path.write_bytes(b'zip')
        return stored

    def _project(self):
        project = Project.objects.create(user=self.user, original_filename='plan.pdf')
        (PROJECTS_TMP / str(project.id) / 'uploads').mkdir(parents=True, exist_ok=True)
        (PROJECTS_TMP / str(project.id) / 'uploads' / 'page_1.jpg').write_bytes(b'jpg')
        return project

    def test_cloud_delete_endpoint_removes_the_file(self):
        stored = self._stored()
        self.client.login(username='test@example.ch', password='sicher-genug-42')
        response = self.client.post(reverse('cloud_delete', args=[stored.id]))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(stored.file_path.exists())

    def test_self_service_account_deletion_removes_all_files(self):
        stored, project = self._stored(), self._project()
        self.client.login(username='test@example.ch', password='sicher-genug-42')
        self.client.post(reverse('konto_loeschen'), {'password': 'sicher-genug-42'})
        self.assertEqual(User.objects.count(), 0)
        self.assertFalse(stored.file_path.exists())
        self.assertFalse((PROJECTS_TMP / str(project.id)).exists())

    def test_deleting_a_user_in_the_admin_removes_all_files(self):
        """Der Weg, der bis 20.8.2026 nichts aufräumte."""
        stored, project = self._stored(), self._project()
        self.user.delete()
        self.assertFalse(stored.file_path.exists())
        self.assertFalse((PROJECTS_TMP / str(project.id)).exists())

    def test_a_missing_file_is_not_an_error(self):
        """Der Cleanup-Cron löscht `projects/<uuid>/` schon nach 14 Tagen, die
        Zeile bleibt stehen — deren spätere Löschung darf nicht scheitern."""
        stored = self._stored()
        stored.file_path.unlink()
        project = Project.objects.create(user=self.user, original_filename='weg.pdf')
        self.user.delete()  # darf nicht werfen
        self.assertEqual(Project.objects.filter(pk=project.pk).count(), 0)

