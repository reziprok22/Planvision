import tempfile
from datetime import timedelta
from io import StringIO
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from accounts.models import subscription_for
from .models import FeedbackResponse, StoredProject

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


class FeedbackTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='test@example.ch', email='test@example.ch', password='pw')
        self.client.login(username='test@example.ch', password='pw')

    def _submit(self, **overrides):
        data = {'positive': 'KI-Erkennung', 'improve': 'Zoom', 'missing': 'DXF-Export', **overrides}
        return self.client.post(reverse('submit_feedback'), data)

    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self._submit().status_code, 401)

    def test_all_three_answers_required(self):
        response = self._submit(missing='')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(FeedbackResponse.objects.count(), 0)

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
