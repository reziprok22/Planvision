import io
import tempfile
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.contrib.admin.sites import site as admin_site
from django.contrib.auth.models import User
from django.core import mail
from django.core.management import call_command
from django.forms.models import modelform_factory
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from PyPDF2 import PdfReader

from .admin import InvoiceAdmin, SubscriptionAdmin
from .invoices import OpenInvoiceError, create_invoice, split_amounts, store_pdf
from .models import (DISCOUNT_LIFETIME, DISCOUNT_ONCE, Invoice, Subscription,
                     subscription_for)
from .pricing import global_discount, public_price


class RegistrationTests(TestCase):
    def test_register_with_email_creates_inactive_user_and_sends_verification(self):
        response = self.client.post(reverse('register'), {
            'email': 'Test@Example.CH',
            'password1': 'sicher-genug-42',
            'password2': 'sicher-genug-42',
        })
        self.assertRedirects(response, reverse('verify_email_sent'))
        user = User.objects.get()
        # E-Mail wird kleingeschrieben als Username UND als E-Mail gespeichert
        self.assertEqual(user.username, 'test@example.ch')
        self.assertEqual(user.email, 'test@example.ch')
        # Konto erst nach Klick auf den Bestätigungslink aktiv, noch nicht eingeloggt
        self.assertFalse(user.is_active)
        self.assertFalse(response.wsgi_request.user.is_authenticated)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['test@example.ch'])
        self.assertIn('/accounts/verify-email/', mail.outbox[0].body)

    def test_register_rejects_duplicate_active_email(self):
        User.objects.create_user(username='test@example.ch', email='test@example.ch', password='x')
        response = self.client.post(reverse('register'), {
            'email': 'TEST@example.ch',
            'password1': 'sicher-genug-42',
            'password2': 'sicher-genug-42',
        })
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'existiert bereits ein Konto')
        self.assertEqual(User.objects.count(), 1)

    def test_register_again_with_unverified_email_restarts_verification(self):
        stale = User.objects.create_user(
            username='test@example.ch', email='test@example.ch', password='x', is_active=False)
        response = self.client.post(reverse('register'), {
            'email': 'test@example.ch',
            'password1': 'sicher-genug-42',
            'password2': 'sicher-genug-42',
        })
        self.assertRedirects(response, reverse('verify_email_sent'))
        self.assertEqual(User.objects.count(), 1)
        new_user = User.objects.get()
        self.assertNotEqual(new_user.pk, stale.pk)
        self.assertFalse(new_user.is_active)

    def test_register_does_not_delete_deactivated_used_account(self):
        # Im Admin gesperrtes Konto (is_active=False, aber schon mal
        # eingeloggt) darf nicht per anonymer Registrierung löschbar sein.
        banned = User.objects.create_user(
            username='test@example.ch', email='test@example.ch', password='x', is_active=False)
        banned.last_login = timezone.now()
        banned.save()
        response = self.client.post(reverse('register'), {
            'email': 'test@example.ch',
            'password1': 'sicher-genug-42',
            'password2': 'sicher-genug-42',
        })
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'existiert bereits ein Konto')
        self.assertEqual(User.objects.get().pk, banned.pk)


def _extract_link(outbox_index, path_fragment):
    link = next(line for line in mail.outbox[outbox_index].body.splitlines()
                if path_fragment in line).strip()
    return '/' + link.split('://', 1)[1].split('/', 1)[1]


class EmailVerificationTests(TestCase):
    def test_verify_link_activates_without_login(self):
        # Bewusst kein Auto-Login: der Mail-Link soll kein Session-Ticket sein
        self.client.post(reverse('register'), {
            'email': 'test@example.ch',
            'password1': 'sicher-genug-42',
            'password2': 'sicher-genug-42',
        })
        link = _extract_link(0, '/accounts/verify-email/')
        response = self.client.get(link)
        self.assertContains(response, 'bestätigt')
        self.assertFalse(response.wsgi_request.user.is_authenticated)
        self.assertTrue(User.objects.get().is_active)

    def test_verify_link_records_timestamp(self):
        # Der Klick auf den Bestätigungslink soll den Zeitpunkt festhalten
        # (getrennt von is_active, das ein Admin auch manuell setzt)
        from .models import subscription_for
        self.client.post(reverse('register'), {
            'email': 'test@example.ch',
            'password1': 'sicher-genug-42',
            'password2': 'sicher-genug-42',
        })
        user = User.objects.get()
        self.assertIsNone(subscription_for(user).email_verified_at)
        link = _extract_link(0, '/accounts/verify-email/')
        self.client.get(link)
        self.assertIsNotNone(subscription_for(user).email_verified_at)

    def test_verify_link_second_click_shows_done_not_invalid(self):
        # Mail-Scanner rufen den Link vorab auf und verbrauchen den Token;
        # der echte Klick danach soll zum Login führen statt "ungültig"
        self.client.post(reverse('register'), {
            'email': 'test@example.ch',
            'password1': 'sicher-genug-42',
            'password2': 'sicher-genug-42',
        })
        link = _extract_link(0, '/accounts/verify-email/')
        self.client.get(link)
        response = self.client.get(link)
        self.assertContains(response, 'bestätigt', status_code=200)
        self.assertNotContains(response, 'ungültig')
        self.assertFalse(response.wsgi_request.user.is_authenticated)

    def test_bogus_token_shows_invalid_page(self):
        user = User.objects.create_user(
            username='test@example.ch', email='test@example.ch', password='x', is_active=False)
        from django.utils.http import urlsafe_base64_encode
        from django.utils.encoding import force_bytes
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        response = self.client.get(f'/accounts/verify-email/{uid}/bogus-token/')
        self.assertContains(response, 'ungültig', status_code=200)

    def test_inactive_user_cannot_login(self):
        User.objects.create_user(
            username='test@example.ch', email='test@example.ch', password='sicher-genug-42',
            is_active=False)
        response = self.client.post(reverse('login'), {
            'username': 'test@example.ch',
            'password': 'sicher-genug-42',
        })
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'noch nicht bestätigt')
        self.assertFalse(response.wsgi_request.user.is_authenticated)


class LoginTests(TestCase):
    def setUp(self):
        User.objects.create_user(
            username='test@example.ch', email='test@example.ch', password='sicher-genug-42')

    def test_login_with_email(self):
        response = self.client.post(reverse('login'), {
            'username': 'test@example.ch',
            'password': 'sicher-genug-42',
        })
        self.assertRedirects(response, '/app/', fetch_redirect_response=False)

    def test_login_is_case_insensitive(self):
        response = self.client.post(reverse('login'), {
            'username': 'TEST@Example.CH',
            'password': 'sicher-genug-42',
        })
        self.assertRedirects(response, '/app/', fetch_redirect_response=False)

    def test_logout_via_post(self):
        self.client.login(username='test@example.ch', password='sicher-genug-42')
        response = self.client.post(reverse('logout'))
        self.assertRedirects(response, '/accounts/login/', fetch_redirect_response=False)

    def test_empty_login_shows_an_error(self):
        """Leeres Formular erzeugt nur FELD-Fehler (keine non_field_errors).
        Das Template rendert die inzwischen mit — vorher lud die Seite
        kommentarlos neu und der Nutzer sah gar keinen Hinweis."""
        response = self.client.post(reverse('login'), {'username': '', 'password': ''})
        self.assertEqual(response.status_code, 200)
        # auf das Markup prüfen, nicht auf den Klassennamen: der steht auch
        # im <style>-Block von auth_base.html
        self.assertContains(response, '<ul class="error-list">')
        self.assertContains(response, 'Feld ist zwingend erforderlich')

    def test_login_keeps_the_entered_email_after_a_wrong_password(self):
        response = self.client.post(reverse('login'), {
            'username': 'test@example.ch', 'password': 'falsch'})
        self.assertContains(response, 'value="test@example.ch"')

    def test_deactivating_an_account_ends_its_running_session(self):
        """`is_active=False` ist der einzige Sperrhebel im Admin und muss
        sofort greifen. Mit AllowAllUsersModelBackend hob die aufgehobene
        is_active-Prüfung auch fuer get_user() ab — die laufende Session
        behielt vollen Zugriff bis zum Cookie-Ablauf."""
        self.client.login(username='test@example.ch', password='sicher-genug-42')
        self.assertEqual(self.client.get(reverse('konto')).status_code, 200)

        User.objects.filter(username='test@example.ch').update(is_active=False)

        response = self.client.get(reverse('konto'))
        self.assertEqual(response.status_code, 302)
        self.assertIn('/accounts/login/', response['Location'])
        # Auch die API-Endpoints, nicht nur die HTML-Seiten
        self.assertEqual(self.client.get('/cloud/projects').status_code, 401)

    def test_unconfirmed_account_is_told_to_confirm(self):
        User.objects.filter(username='test@example.ch').update(is_active=False)
        response = self.client.post(reverse('login'), {
            'username': 'test@example.ch', 'password': 'sicher-genug-42'})
        self.assertContains(response, 'noch nicht bestätigt')

    def test_deactivated_account_is_not_told_to_click_a_link(self):
        """Ein im Admin gesperrtes Konto bekam dieselbe "klicke auf den
        Bestätigungslink"-Meldung und wartete auf eine Mail, die nie kommt."""
        user = User.objects.get(username='test@example.ch')
        subscription_for(user)  # legt sie an, falls noch nicht vorhanden
        Subscription.objects.filter(user=user).update(email_verified_at=timezone.now())
        User.objects.filter(pk=user.pk).update(is_active=False)
        response = self.client.post(reverse('login'), {
            'username': 'test@example.ch', 'password': 'sicher-genug-42'})
        self.assertContains(response, 'deaktiviert')
        self.assertNotContains(response, 'Bestätigungslink')


class PasswordResetTests(TestCase):
    def setUp(self):
        User.objects.create_user(
            username='test@example.ch', email='test@example.ch', password='sicher-genug-42')

    def test_reset_sends_email_with_link(self):
        response = self.client.post(reverse('password_reset'), {'email': 'test@example.ch'})
        self.assertRedirects(response, reverse('password_reset_done'))
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['test@example.ch'])
        self.assertIn('/accounts/reset/', mail.outbox[0].body)

    def test_reset_link_allows_setting_new_password(self):
        self.client.post(reverse('password_reset'), {'email': 'test@example.ch'})
        # Reset-Link aus der Mail extrahieren
        link = next(line for line in mail.outbox[0].body.splitlines()
                    if '/accounts/reset/' in line).strip()
        path = link.split('://', 1)[1].split('/', 1)[1]
        response = self.client.get('/' + path, follow=True)
        self.assertEqual(response.status_code, 200)
        # Django leitet auf die set-password-URL um; dort neues Passwort setzen
        set_password_url = response.request['PATH_INFO']
        response = self.client.post(set_password_url, {
            'new_password1': 'noch-sicherer-43',
            'new_password2': 'noch-sicherer-43',
        })
        self.assertRedirects(response, reverse('password_reset_complete'))
        self.assertTrue(self.client.login(
            username='test@example.ch', password='noch-sicherer-43'))

    def test_unconfirmed_account_gets_a_fresh_verification_link(self):
        """Djangos Reset überspringt inaktive Konten — wer nie bestätigt hat,
        bekam gar nichts, obwohl die Seite "Link ist unterwegs" sagt. Jetzt
        geht stattdessen ein neuer Bestätigungslink raus."""
        User.objects.filter(username='test@example.ch').update(is_active=False)
        response = self.client.post(reverse('password_reset'), {'email': 'test@example.ch'})
        self.assertRedirects(response, reverse('password_reset_done'))
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('/accounts/verify-email/', mail.outbox[0].body)
        self.assertNotIn('/accounts/reset/', mail.outbox[0].body)

    def test_deactivated_account_gets_no_mail_at_all(self):
        """Gesperrt ist nicht unbestätigt: ein im Admin deaktiviertes Konto
        darf sich nicht per Passwort-Reset einen Aktivierungslink holen."""
        user = User.objects.get(username='test@example.ch')
        subscription_for(user)
        Subscription.objects.filter(user=user).update(email_verified_at=timezone.now())
        User.objects.filter(pk=user.pk).update(is_active=False)
        self.client.post(reverse('password_reset'), {'email': 'test@example.ch'})
        self.assertEqual(len(mail.outbox), 0)

    def test_reset_for_unknown_address_stays_silent(self):
        self.client.post(reverse('password_reset'), {'email': 'niemand@example.ch'})
        self.assertEqual(len(mail.outbox), 0)


def _make_user(email='test@example.ch', password='sicher-genug-42'):
    return User.objects.create_user(username=email, email=email, password=password)


def _expire(user):
    sub = subscription_for(user)
    sub.trial_ends = timezone.now() - timedelta(days=1)
    sub.save()
    return sub


def _extend(subs):
    """Ein Jahr Lizenz verbuchen — über den echten (und einzigen) Weg:
    Rechnung ausstellen (schaltet frei, fixiert Preis, verbraucht Einmal-
    Rabatt), danach als bezahlt ablegen, damit die nächste Verlängerung nicht
    am "eine offene Rechnung"-Guard scheitert. Die frühere Subscription-
    Admin-Action "Um 1 Jahr verlängern" wurde entfernt (hätte zusätzlich zur
    Sofort-Freischaltung ein zweites Jahr gutgeschrieben). Die übergebenen
    Objekte sind danach veraltet — refresh_from_db()."""
    for stale in subs:
        sub = Subscription.objects.get(pk=stale.pk)
        create_invoice(sub.user, sub, dict(ADDRESS))
        Invoice.objects.filter(user=sub.user, status=Invoice.STATUS_OPEN).update(
            status=Invoice.STATUS_PAID)


class SubscriptionTests(TestCase):
    def test_register_creates_trial(self):
        self.client.post(reverse('register'), {
            'email': 'neu@example.ch',
            'password1': 'sicher-genug-42',
            'password2': 'sicher-genug-42',
        })
        sub = User.objects.get().subscription
        self.assertTrue(sub.in_trial)
        self.assertTrue(sub.is_active)
        self.assertGreaterEqual(sub.trial_days_left, 29)

    def test_lazy_subscription_for_legacy_user(self):
        user = _make_user()  # ohne Subscription angelegt (Alt-User)
        sub = subscription_for(user)
        self.assertTrue(sub.in_trial)  # Trial ab date_joined

    def test_expired_trial_is_inactive(self):
        sub = _expire(_make_user())
        self.assertFalse(sub.is_active)
        self.assertEqual(sub.status_label, 'Abgelaufen, nur Ansicht')

    def test_paid_overrides_expired_trial(self):
        sub = _expire(_make_user())
        sub.paid_until = timezone.localdate() + timedelta(days=365)
        sub.save()
        self.assertTrue(sub.is_paid)
        self.assertTrue(sub.is_active)


@override_settings(BETA_PRICING=False)
class AnalyzeGateTests(TestCase):
    """analyze_page: 403 nach Ablauf, sonst passiert das Gate (dann 404,
    weil kein Projekt existiert — die Analyse selbst läuft hier nie)."""

    def test_expired_user_gets_403(self):
        user = _make_user()
        _expire(user)
        self.client.login(username='test@example.ch', password='sicher-genug-42')
        response = self.client.post(reverse('analyze_page'), {'session_id': 'x'})
        self.assertEqual(response.status_code, 403)
        self.assertIn('Testphase', response.json()['error'])

    def test_trial_user_passes_gate(self):
        _make_user()
        self.client.login(username='test@example.ch', password='sicher-genug-42')
        response = self.client.post(reverse('analyze_page'), {'session_id': 'x'})
        self.assertNotEqual(response.status_code, 403)

    @override_settings(BETA_MODE=True, BETA_PRICING=True)
    def test_beta_mode_has_no_gate(self):
        response = self.client.post(reverse('analyze_page'), {'session_id': 'x'})
        self.assertNotEqual(response.status_code, 403)
        self.assertNotEqual(response.status_code, 401)


@override_settings(BETA_PRICING=False)
class KontoAndReadOnlyTests(TestCase):
    def setUp(self):
        self.user = _make_user()
        self.client.login(username='test@example.ch', password='sicher-genug-42')

    def test_konto_shows_trial_status(self):
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'Testphase')
        self.assertContains(response, 'test@example.ch')

    def test_konto_shows_expired_status_and_offer(self):
        _expire(self.user)
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'Abgelaufen')
        self.assertContains(response, 'Rechnung anfordern')

    def test_konto_shows_paid_status(self):
        sub = subscription_for(self.user)
        sub.paid_until = timezone.localdate() + timedelta(days=200)
        sub.save()
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'Lizenz aktiv bis')
        # Kaufen kann er nicht nochmal — die Verlängerung liegt noch weit weg
        self.assertNotContains(response, 'btn-primary" href="/accounts/konto/rechnung/')

    def _set_paid_until(self, days):
        sub = subscription_for(self.user)
        sub.paid_until = timezone.localdate() + timedelta(days=days)
        sub.save()
        return sub

    def test_renewal_button_is_greyed_out_before_the_window(self):
        """Der Knopf ist schon da, aber nicht klickbar: sichtbar, damit niemand
        die Verlängerung in der App sucht (siehe .btn-disabled in konto.html)."""
        sub = self._set_paid_until(200)
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'btn btn-disabled')
        self.assertNotContains(response, "href=\"/accounts/konto/rechnung/\"")
        self.assertContains(response, sub.renewal_opens_on.strftime('%d.%m.%Y'))

    def test_renewal_button_is_active_inside_the_window(self):
        """Ab dem Stichtag, an dem auch die Erinnerungs-Mail rausgeht (die auf
        genau diese Seite verlinkt), muss der Knopf gehen."""
        self._set_paid_until(max(settings.RENEWAL_REMINDER_DAYS))
        response = self.client.get(reverse('konto'))
        self.assertContains(response, "href=\"/accounts/konto/rechnung/\"")
        self.assertNotContains(response, 'btn btn-disabled')

    @override_settings(BETA_PRICING=True)
    def test_no_renewal_card_during_beta(self):
        """In der Beta läuft weder der Reminder-Cron noch die Bezahlpflicht —
        ein Verlängerungs-Hinweis wäre ein Versprechen ohne Deckung."""
        self._set_paid_until(10)
        response = self.client.get(reverse('konto'))
        self.assertNotContains(response, '<h2>Verlängerung</h2>')

    def test_app_read_only_flag_and_banner(self):
        _expire(self.user)
        response = self.client.get(reverse('app'))
        self.assertContains(response, 'window.PLANLI_READ_ONLY = true')
        self.assertContains(response, 'read-only-banner')

    def test_app_active_user_not_read_only(self):
        response = self.client.get(reverse('app'))
        self.assertContains(response, 'window.PLANLI_READ_ONLY = false')
        self.assertNotContains(response, 'read-only-banner')

    @override_settings(BETA_PRICING=True, GLOBAL_DISCOUNT_PERCENT=0, SHOW_PRICING=True)
    def test_konto_shows_beta_note_and_future_price(self):
        """Während der Beta ist der Zugriff unbeschränkt (_read_only() greift
        nie), ein Rechnungs-CTA wäre also irreführend — der künftige Preis wird
        (bei SHOW_PRICING) gezeigt, damit die Kosten nach der Beta bekannt sind."""
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'Während der Beta-Phase ist Planli')
        self.assertNotContains(response, 'Rechnung anfordern')
        self.assertContains(response, f'<sup>CHF</sup>{settings.LICENSE_PRICE_CHF}')
        self.assertContains(response, 'nach der Beta-Phase')

    @override_settings(BETA_PRICING=True, GLOBAL_DISCOUNT_PERCENT=0, SHOW_PRICING=False)
    def test_konto_hides_future_price_without_show_pricing(self):
        """SHOW_PRICING=False: die Konto-Seite nennt Beta-Nutzern keinen
        künftigen Preis — die Karte heisst "Aktuell kostenlos" (Formulierung
        wie die Landingpage-Preissektion). Der Vertragspreis zahlender Kunden
        (Jahrespreis-Zeile) ist davon bewusst ausgenommen."""
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'Aktuell kostenlos')
        self.assertContains(response, 'befindet sich in der Beta-Phase')
        self.assertNotContains(response, 'Jahreslizenz')
        self.assertNotContains(response, '<sup>CHF</sup>')
        self.assertNotContains(response, 'nach der Beta-Phase')

    @override_settings(BETA_PRICING=True, LICENSE_PRICE_CHF=240,
                       GLOBAL_DISCOUNT_PERCENT=0, SHOW_PRICING=True)
    def test_konto_shows_personal_discount(self):
        sub = subscription_for(self.user)
        sub.discount_percent = 50
        sub.discount_scope = DISCOUNT_LIFETIME
        sub.discount_reason = 'Beta-Tester'
        sub.save()
        response = self.client.get(reverse('konto'))
        self.assertContains(response, '<sup>CHF</sup>120')
        self.assertContains(response, 'CHF 240')  # durchgestrichener Basispreis
        self.assertContains(response, 'Beta-Tester')

    @override_settings(BETA_PRICING=True)
    def test_konto_status_badge_neutral_during_beta_even_if_expired(self):
        """Der Status-Badge darf während der Beta nicht 'Abgelaufen' zeigen —
        _read_only() greift in der Beta nie, Lesen+Bearbeiten bleibt offen."""
        _expire(self.user)
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'status-badge status-beta')
        self.assertNotContains(response, 'Abgelaufen')
        self.assertNotContains(response, 'Testphase endet am')

    def test_konto_status_badge_shows_expired_outside_beta(self):
        _expire(self.user)
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'status-badge status-expired')
        self.assertNotContains(response, 'status-badge status-beta')


# GLOBAL_DISCOUNT_PERCENT=0 fixiert: diese Tests prüfen den persönlichen
# Rabatt, eine laufende Preisaktion in den Settings darf sie nicht kippen.
# INVOICE_IBAN gepinnt, weil _extend() über create_invoice() läuft — die
# Tests dürfen nicht davon abhängen, ob in den Settings eine echte IBAN steht.
@override_settings(LICENSE_PRICE_CHF=240, GLOBAL_DISCOUNT_PERCENT=0,
                   INVOICE_IBAN='CH5800791123000889012')
class PriceAndDiscountTests(TestCase):
    """Basispreis pro Konto (leer = Listenpreis) und prozentualer Rabatt mit
    Laufzeit einmalig/dauerhaft."""

    def setUp(self):
        self.sub = subscription_for(_make_user())

    def test_price_defaults_to_settings_and_follows_price_changes(self):
        self.assertEqual(self.sub.list_price, 240)
        self.assertEqual(self.sub.price_chf, 240)
        with override_settings(LICENSE_PRICE_CHF=280):
            self.assertEqual(self.sub.price_chf, 280)

    def test_pinned_list_price_survives_price_change(self):
        """Preisgarantie: eingetragener Basispreis schlägt den Listenpreis."""
        self.sub.list_price_chf = 240
        with override_settings(LICENSE_PRICE_CHF=280):
            self.assertEqual(self.sub.price_chf, 240)

    def test_percent_discount_rounds_half_up(self):
        self.sub.list_price_chf = 245
        self.sub.discount_percent = 50
        self.assertEqual(self.sub.price_chf, 123)  # 122.5 → 123, nicht 122

    def test_once_discount_expires_after_being_consumed(self):
        self.sub.discount_percent = 50
        self.sub.discount_scope = DISCOUNT_ONCE
        self.assertEqual(self.sub.price_chf, 120)
        self.assertTrue(self.sub.consume_discount())
        self.assertFalse(self.sub.discount_active)
        self.assertEqual(self.sub.price_chf, 240)
        self.assertEqual(self.sub.discount_label, '')
        # Zweiter Aufruf ändert nichts mehr
        self.assertFalse(self.sub.consume_discount())

    def test_lifetime_discount_survives_renewal(self):
        self.sub.discount_percent = 50
        self.sub.discount_scope = DISCOUNT_LIFETIME
        self.assertFalse(self.sub.consume_discount())
        self.assertTrue(self.sub.discount_active)
        self.assertEqual(self.sub.price_chf, 120)
        self.assertIn('dauerhaft', self.sub.discount_label)

    def test_no_discount_means_list_price(self):
        self.assertFalse(self.sub.discount_active)
        self.assertEqual(self.sub.discount_label, '')

    def test_renewal_pins_price_so_increases_hit_only_new_users(self):
        """Preisgarantie: mit der Rechnung wird der Preis festgeschrieben, eine
        spätere Erhöhung gilt nur für Konten, die noch nie bezahlt haben."""
        old_customer = self.sub
        new_user = subscription_for(_make_user('neu@example.ch'))
        _extend([old_customer])

        old_customer.refresh_from_db()
        self.assertEqual(old_customer.list_price_chf, 240)
        with override_settings(LICENSE_PRICE_CHF=300):
            self.assertEqual(old_customer.price_chf, 240)
            self.assertTrue(old_customer.has_price_guarantee)
            self.assertEqual(new_user.price_chf, 300)  # noch nie bezahlt
            self.assertFalse(new_user.has_price_guarantee)

    def test_second_extension_keeps_the_pinned_price(self):
        _extend([self.sub])
        with override_settings(LICENSE_PRICE_CHF=300):
            _extend([Subscription.objects.get(pk=self.sub.pk)])
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.list_price_chf, 240)

    def test_clearing_the_pin_moves_account_to_current_list_price(self):
        """So hebt man ein Konto bewusst auf den neuen Preis: Feld leeren."""
        _extend([self.sub])
        self.sub.refresh_from_db()
        self.sub.list_price_chf = None
        with override_settings(LICENSE_PRICE_CHF=300):
            self.assertEqual(self.sub.price_chf, 300)

    def test_pin_keeps_personal_discount_working(self):
        """Der fixierte Preis ist der Basispreis — ein dauerhafter Rabatt
        rechnet weiterhin darauf."""
        self.sub.discount_percent = 50
        self.sub.discount_scope = DISCOUNT_LIFETIME
        self.sub.save()
        _extend([self.sub])
        self.sub.refresh_from_db()
        with override_settings(LICENSE_PRICE_CHF=300):
            self.assertEqual(self.sub.price_chf, 120)  # 50 % von 240, nicht von 300

    def test_renewal_consumes_once_discount_only(self):
        """Die Verlängerung ist der Moment, in dem ein einmaliger Rabatt
        verbraucht ist — sonst gälte er auch im Folgejahr."""
        once = self.sub
        once.discount_percent = 50
        once.discount_scope = DISCOUNT_ONCE
        once.save()
        lifetime = subscription_for(_make_user('b@example.ch'))
        lifetime.discount_percent = 30
        lifetime.discount_scope = DISCOUNT_LIFETIME
        lifetime.save()

        _extend([once, lifetime])

        once.refresh_from_db()
        lifetime.refresh_from_db()
        self.assertIsNotNone(once.discount_used_at)
        self.assertFalse(once.discount_active)
        self.assertIsNone(lifetime.discount_used_at)
        self.assertTrue(lifetime.discount_active)
        # Laufzeit = Kalenderjahr ab Anker (Trial-Resttage werden angerechnet)
        self.assertEqual(once.paid_until,
                         Invoice.objects.get(user=once.user).period_end)


@override_settings(LICENSE_PRICE_CHF=200, GLOBAL_DISCOUNT_PERCENT=20,
                   GLOBAL_DISCOUNT_REASON='Einführungsrabatt', GLOBAL_DISCOUNT_UNTIL='')
class GlobalDiscountTests(TestCase):
    """Globale Preisaktion (settings.GLOBAL_DISCOUNT_*): gilt für alle, wird
    aber nie mit einem persönlichen Rabatt gestapelt."""

    def setUp(self):
        self.sub = subscription_for(_make_user())

    def test_campaign_applies_to_everyone(self):
        base, now, discount = public_price()
        self.assertEqual((base, now), (200, 160))
        self.assertEqual(discount.percent, 20)
        self.assertEqual(self.sub.price_chf, 160)
        self.assertIn('Einführungsrabatt', self.sub.discount_label)

    @override_settings(GLOBAL_DISCOUNT_PERCENT=0)
    def test_no_campaign_means_list_price(self):
        self.assertFalse(global_discount())
        self.assertEqual(public_price()[1], 200)
        self.assertEqual(self.sub.price_chf, 200)

    def test_better_personal_discount_wins(self):
        self.sub.discount_percent = 50
        self.sub.discount_scope = DISCOUNT_LIFETIME
        self.sub.discount_reason = 'Beta-Tester'
        self.assertEqual(self.sub.price_chf, 100)
        self.assertIn('Beta-Tester', self.sub.discount_label)

    def test_campaign_wins_over_weaker_personal_discount(self):
        """Kein Stapeln: 20 % Aktion + 10 % persönlich ergibt 20 %, nicht 28 %."""
        self.sub.discount_percent = 10
        self.sub.discount_scope = DISCOUNT_LIFETIME
        self.assertEqual(self.sub.price_chf, 160)
        self.assertIn('Einführungsrabatt', self.sub.discount_label)

    def test_consumed_personal_discount_falls_back_to_campaign(self):
        self.sub.discount_percent = 50
        self.sub.discount_scope = DISCOUNT_ONCE
        self.sub.consume_discount()
        self.assertEqual(self.sub.price_chf, 160)

    def test_once_discount_is_not_consumed_when_the_campaign_wins(self):
        """10 % persönlich gegen 20 % Aktion: gerechnet wird die Aktion, der
        persönliche Rabatt darf dabei nicht verfallen — sonst hätte der Kunde
        ihn nach Aktionsende verloren, ohne ihn je bekommen zu haben."""
        self.sub.discount_percent = 10
        self.sub.discount_scope = DISCOUNT_ONCE
        self.assertEqual(self.sub.price_chf, 160)  # Aktion, nicht 180
        self.assertFalse(self.sub.consume_discount())
        self.assertIsNone(self.sub.discount_used_at)
        with override_settings(GLOBAL_DISCOUNT_PERCENT=0):
            self.assertTrue(self.sub.discount_active)
            self.assertEqual(self.sub.price_chf, 180)

    def test_once_discount_is_consumed_when_it_beats_the_campaign(self):
        self.sub.discount_percent = 50
        self.sub.discount_scope = DISCOUNT_ONCE
        self.assertEqual(self.sub.price_chf, 100)
        self.assertTrue(self.sub.consume_discount())
        self.assertEqual(self.sub.price_chf, 160)  # danach greift die Aktion

    def test_equal_percentages_consume_the_personal_discount(self):
        """Gleichstand geht an den persönlichen Rabatt (effective_discount) —
        dann muss er auch als eingelöst gelten, sonst gälte er ewig."""
        self.sub.discount_percent = 20
        self.sub.discount_scope = DISCOUNT_ONCE
        self.assertTrue(self.sub.consume_discount())

    @override_settings(GLOBAL_DISCOUNT_UNTIL='2020-01-01')
    def test_expired_campaign_is_ignored(self):
        self.assertFalse(global_discount())
        self.assertEqual(self.sub.price_chf, 200)

    def test_campaign_runs_until_end_of_last_day(self):
        until = timezone.localdate().isoformat()
        with override_settings(GLOBAL_DISCOUNT_UNTIL=until):
            self.assertTrue(global_discount())
            self.assertEqual(global_discount().until, timezone.localdate())

    @override_settings(GLOBAL_DISCOUNT_UNTIL='31.12.2026')
    def test_unparsable_end_date_is_treated_as_open_ended(self):
        """Ein Tippfehler im Datum darf die Landingpage nicht mit einem 500er
        abschiessen — die Aktion läuft dann eben unbefristet weiter."""
        self.assertTrue(global_discount())
        self.assertIsNone(global_discount().until)

    @override_settings(GLOBAL_DISCOUNT_PERCENT=150)
    def test_percent_is_clamped(self):
        self.assertEqual(global_discount().percent, 100)
        self.assertEqual(self.sub.price_chf, 0)


@override_settings(LICENSE_PRICE_CHF=200, GLOBAL_DISCOUNT_PERCENT=0)
class SubscriptionAdminTests(TestCase):
    """Rabatt von Hand im Änderungsformular ändern."""

    def setUp(self):
        self.sub = subscription_for(_make_user())
        self.sub.discount_percent = 20
        self.sub.discount_scope = DISCOUNT_ONCE
        self.sub.discount_used_at = timezone.now()  # bereits eingelöst
        self.sub.save()

    def _edit(self, **changes):
        """Wie das Änderungsformular: ModelForm auf den Rabattfeldern, dann
        save_model()."""
        fields = ('max_projects', 'discount_percent', 'discount_scope',
                  'discount_reason')
        Form = modelform_factory(Subscription, fields=fields)
        data = {'max_projects': self.sub.max_projects,
                'discount_percent': self.sub.discount_percent,
                'discount_scope': self.sub.discount_scope,
                'discount_reason': self.sub.discount_reason, **changes}
        form = Form(data, instance=self.sub)
        self.assertTrue(form.is_valid(), form.errors)
        obj = form.save(commit=False)
        SubscriptionAdmin(Subscription, admin_site).save_model(
            RequestFactory().post('/vitruv/'), obj, form, change=True)
        self.sub.refresh_from_db()

    def test_the_discount_is_not_editable_in_the_changelist(self):
        """Vergeben wird der Rabatt über die Action "Rabatt setzen" — nur die
        fragt auch den Grund ab, der eingefroren auf dem Rechnungs-PDF landet."""
        editable = SubscriptionAdmin(Subscription, admin_site).list_editable
        self.assertNotIn('discount_percent', editable)
        self.assertNotIn('discount_scope', editable)

    def test_new_percent_reopens_a_consumed_discount(self):
        """Sonst bewirkt der neu eingetragene Prozentwert schlicht nichts:
        `personal_discount` bliebe wegen `discount_used_at` leer."""
        self._edit(discount_percent=30, discount_reason='Ersatzrechnung')
        self.assertIsNone(self.sub.discount_used_at)
        self.assertEqual(self.sub.price_chf, 140)

    def test_new_scope_reopens_a_consumed_discount(self):
        self._edit(discount_scope=DISCOUNT_LIFETIME)
        self.assertIsNone(self.sub.discount_used_at)

    def test_editing_something_else_leaves_the_discount_consumed(self):
        self._edit(max_projects=100)
        self.assertIsNotNone(self.sub.discount_used_at)
        self.assertEqual(self.sub.max_projects, 100)
        self.assertEqual(self.sub.price_chf, 200)


class MaxProjectsTests(TestCase):
    def test_default_limit_from_settings(self):
        sub = subscription_for(_make_user())
        self.assertEqual(sub.max_projects, 100)

    def test_limit_is_per_user(self):
        sub_a = subscription_for(_make_user('a@example.ch'))
        sub_b = subscription_for(_make_user('b@example.ch'))
        sub_b.max_projects = 200
        sub_b.save()
        sub_a.refresh_from_db()
        self.assertEqual(sub_a.max_projects, 100)
        self.assertEqual(sub_b.max_projects, 200)

    @override_settings(BETA_MODE=False)
    def test_konto_shows_limit(self):
        _make_user()
        self.client.login(username='test@example.ch', password='sicher-genug-42')
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'bis zu 100 Projekte')


INVOICE_TMP = Path(tempfile.mkdtemp(prefix='planli_invoices_test_'))
ADDRESS = {
    'billing_company': 'Muster AG',
    'billing_name': 'Anna Muster',
    'billing_street': 'Bahnhofstrasse 2',
    'billing_zip': '3000',
    'billing_city': 'Bern',
    'billing_country': 'CH',
}


def _mark_paid(queryset):
    """Admin-Action "Als bezahlt markieren" ausführen."""
    with patch.object(InvoiceAdmin, 'message_user'):
        InvoiceAdmin(Invoice, admin_site).mark_paid(RequestFactory().post('/vitruv/'), queryset)


def _cancel(queryset):
    with patch.object(InvoiceAdmin, 'message_user'):
        InvoiceAdmin(Invoice, admin_site).cancel_invoices(
            RequestFactory().post('/vitruv/'), queryset)


def _reopen(queryset):
    """Admin-Action "Zurück auf offen" ausführen."""
    with patch.object(InvoiceAdmin, 'message_user'):
        InvoiceAdmin(Invoice, admin_site).reopen(RequestFactory().post('/vitruv/'), queryset)


@override_settings(BETA_PRICING=False, LICENSE_PRICE_CHF=200, GLOBAL_DISCOUNT_PERCENT=0,
                   INVOICES_DIR=INVOICE_TMP, INVOICE_IBAN='CH5800791123000889012',
                   INVOICE_VAT_RATE='8.1', LICENSE_PRICE_INCLUDES_VAT=True,
                   INVOICE_BCC='buchhaltung@planli.net')
class InvoiceTests(TestCase):
    def setUp(self):
        self.user = _make_user()
        self.sub = subscription_for(self.user)
        self.client.login(username='test@example.ch', password='sicher-genug-42')

    def _request(self, **overrides):
        return self.client.post(reverse('rechnung_anfordern'), {**ADDRESS, **overrides})

    # ── Beträge ────────────────────────────────────────────────────────────
    def test_gross_price_split_keeps_total_exact(self):
        """Bei Brutto-Preisen muss das Total exakt der angezeigte Preis sein,
        sonst weicht die Rechnung von der Konto-Seite ab."""
        net, vat, total = split_amounts(200)
        self.assertEqual(total, Decimal('200.00'))
        self.assertEqual(net + vat, total)
        self.assertEqual(net, Decimal('185.01'))

    @override_settings(LICENSE_PRICE_INCLUDES_VAT=False)
    def test_net_price_adds_vat_on_top(self):
        net, vat, total = split_amounts(200)
        self.assertEqual((net, vat, total),
                         (Decimal('200.00'), Decimal('16.20'), Decimal('216.20')))

    @override_settings(INVOICE_VAT_RATE='')
    def test_without_vat_registration(self):
        net, vat, total = split_amounts(200)
        self.assertEqual((net, vat, total), (Decimal('200.00'), Decimal('0.00'), Decimal('200.00')))

    # ── Erstellen ──────────────────────────────────────────────────────────
    def test_request_creates_invoice_pdf_and_mail(self):
        response = self._request()
        invoice = Invoice.objects.get()
        self.assertRedirects(response, f"{reverse('konto')}?rechnung={invoice.number}")
        self.assertEqual(invoice.number, f'{timezone.localdate().year}-0001')
        self.assertEqual(invoice.total_chf, Decimal('200.00'))
        self.assertEqual(invoice.billing_name, 'Anna Muster')
        self.assertTrue(invoice.pdf_path.exists())
        self.assertEqual(invoice.pdf_path.read_bytes()[:4], b'%PDF')

        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.to, ['test@example.ch'])
        self.assertEqual(sent.bcc, ['buchhaltung@planli.net'])
        self.assertIn(invoice.number, sent.subject)
        self.assertEqual(sent.attachments[0][0], f'{invoice.number}.pdf')

    def test_address_is_remembered_for_next_time(self):
        self._request()
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.billing_city, 'Bern')
        # Erst mit bezahlter Rechnung gibt es wieder das Formular statt des
        # "bereits ausgestellt"-Hinweises
        Invoice.objects.update(status=Invoice.STATUS_PAID)
        response = self.client.get(reverse('rechnung_anfordern'))
        self.assertContains(response, 'Bahnhofstrasse 2')

    def test_incomplete_address_is_rejected(self):
        response = self._request(billing_street='')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Invoice.objects.count(), 0)

    def test_only_one_open_invoice(self):
        self._request()
        response = self._request()
        self.assertEqual(Invoice.objects.count(), 1)
        self.assertContains(response, 'Rechnung bereits ausgestellt')

    def test_numbers_are_sequential(self):
        self._request()
        Invoice.objects.update(status=Invoice.STATUS_PAID)
        self._request()
        year = timezone.localdate().year
        self.assertEqual(sorted(Invoice.objects.values_list('number', flat=True)),
                         [f'{year}-0001', f'{year}-0002'])

    def test_amounts_are_frozen_against_later_price_changes(self):
        self._request()
        invoice = Invoice.objects.get()
        with override_settings(LICENSE_PRICE_CHF=500):
            invoice.refresh_from_db()
            self.assertEqual(invoice.total_chf, Decimal('200.00'))

    def test_discount_is_recorded_on_the_invoice(self):
        self.sub.discount_percent = 50
        self.sub.discount_scope = DISCOUNT_LIFETIME
        self.sub.discount_reason = 'Beta-Tester'
        self.sub.save()
        self._request()
        invoice = Invoice.objects.get()
        self.assertEqual(invoice.total_chf, Decimal('100.00'))
        self.assertEqual(invoice.list_price_chf, 200)
        self.assertIn('Beta-Tester', invoice.discount_note)

    def test_period_follows_a_running_licence(self):
        self.sub.paid_until = timezone.localdate() + timedelta(days=100)
        self.sub.save()
        self._request()
        invoice = Invoice.objects.get()
        self.assertEqual(invoice.period_start, self.sub.paid_until)

    def test_expired_user_can_still_order(self):
        """Read-Only darf den Kauf nicht blockieren — das ist der Normalfall."""
        _expire(self.user)
        self._request()
        self.assertEqual(Invoice.objects.count(), 1)

    @override_settings(INVOICE_IBAN='CH0000000000000000000')
    def test_placeholder_iban_blocks_issuing(self):
        response = self._request()
        self.assertEqual(Invoice.objects.count(), 0)
        self.assertContains(response, 'gerade nicht verfügbar')

    @override_settings(BETA_PRICING=True)
    def test_no_invoices_during_beta(self):
        response = self._request()
        self.assertRedirects(response, reverse('konto'))
        self.assertEqual(Invoice.objects.count(), 0)

    # ── Zugriff ────────────────────────────────────────────────────────────
    def test_pdf_download_only_for_owner(self):
        self._request()
        number = Invoice.objects.get().number
        self.assertEqual(self.client.get(reverse('rechnung_pdf', args=[number])).status_code, 200)
        _make_user('fremd@example.ch')
        self.client.login(username='fremd@example.ch', password='sicher-genug-42')
        self.assertEqual(self.client.get(reverse('rechnung_pdf', args=[number])).status_code, 404)

    def test_requires_login(self):
        self.client.logout()
        response = self.client.get(reverse('rechnung_anfordern'))
        self.assertEqual(response.status_code, 302)
        self.assertIn('/accounts/login/', response['Location'])

    def test_konto_lists_invoices(self):
        self._request()
        response = self.client.get(reverse('konto'))
        self.assertContains(response, Invoice.objects.get().number)

    def test_konto_hides_invoice_section_when_empty(self):
        """Ohne Rechnungen keine Karte — bewusst so, hält die Seite übersichtlich."""
        response = self.client.get(reverse('konto'))
        # auf das Markup prüfen, nicht auf den Klassennamen: der steht auch
        # im <style>-Block der Seite
        self.assertNotContains(response, '<table class="invoice-table">')
        self.assertNotContains(response, '<h2>Rechnungen</h2>')


    # ── Aufbewahrung ───────────────────────────────────────────────────────
    def test_invoice_survives_account_deletion(self):
        """Aufbewahrungspflicht (OR 958f): der Beleg bleibt, der Kontobezug geht."""
        self._request()
        self.client.post(reverse('konto_loeschen'), {'password': 'sicher-genug-42'})
        self.assertEqual(User.objects.count(), 0)
        invoice = Invoice.objects.get()
        self.assertIsNone(invoice.user_id)
        self.assertEqual(invoice.billing_name, 'Anna Muster')
        self.assertTrue(invoice.pdf_path.exists())

    # ── Sofortige Freischaltung ────────────────────────────────────────────
    def test_issuing_activates_licence_immediately(self):
        """Freigeschaltet wird beim Ausstellen, nicht erst bei Zahlungseingang."""
        _expire(self.user)
        self._request()
        invoice = Invoice.objects.get()
        self.sub.refresh_from_db()
        self.assertTrue(self.sub.is_paid)
        self.assertEqual(self.sub.paid_until, invoice.period_end)
        self.assertEqual(invoice.status, Invoice.STATUS_OPEN)  # noch unbezahlt
        # Was an der Lizenzvergabe hängt, passiert hier mit
        self.assertEqual(self.sub.list_price_chf, 200)

    def test_once_discount_is_consumed_at_issuing(self):
        self.sub.discount_percent = 50
        self.sub.discount_scope = DISCOUNT_ONCE
        self.sub.save()
        self._request()
        self.sub.refresh_from_db()
        self.assertEqual(Invoice.objects.get().total_chf, Decimal('100.00'))
        self.assertIsNotNone(self.sub.discount_used_at)
        self.assertFalse(self.sub.discount_active)

    @override_settings(GLOBAL_DISCOUNT_PERCENT=20, GLOBAL_DISCOUNT_REASON='Aktion')
    def test_once_discount_survives_an_invoice_that_used_the_campaign(self):
        """Auf der Rechnung steht die stärkere Aktion — der schwächere
        persönliche Einmal-Rabatt bleibt für den nächsten Kauf erhalten."""
        self.sub.discount_percent = 10
        self.sub.discount_scope = DISCOUNT_ONCE
        self.sub.save()
        self._request()
        invoice = Invoice.objects.get()
        self.sub.refresh_from_db()
        self.assertEqual(invoice.discount_percent, 20)
        self.assertEqual(invoice.total_chf, Decimal('160.00'))
        self.assertIsNone(self.sub.discount_used_at)

    # ── Verlängerung ───────────────────────────────────────────────────────
    def test_renewal_card_shows_the_open_invoice(self):
        """Wer die Rechnung angefordert hat und später nochmal aufs Konto
        schaut, sieht dort ihren Stand — statt eines CTAs, der nur auf
        "bereits ausgestellt" liefe."""
        self.sub.paid_until = timezone.localdate() + timedelta(days=10)
        self.sub.save()
        self._request()
        invoice = Invoice.objects.get()
        response = self.client.get(reverse('konto'))
        self.assertContains(response, '<h2>Verlängerung</h2>')
        self.assertContains(response, f'Rechnung {invoice.number}')
        self.assertContains(response, 'du musst nichts weiter tun')
        # Kein zweiter Anlauf, solange sie offen ist
        self.assertNotContains(response, "href=\"/accounts/konto/rechnung/\"")

    def test_marking_paid_only_confirms(self):
        self._request()
        invoice = Invoice.objects.get()
        before = self.sub.__class__.objects.get(pk=self.sub.pk).paid_until
        _mark_paid(Invoice.objects.all())
        invoice.refresh_from_db()
        self.sub.refresh_from_db()
        self.assertEqual(invoice.status, Invoice.STATUS_PAID)
        self.assertIsNotNone(invoice.paid_at)
        # Laufzeit unverändert — kein zweites Jahr obendrauf
        self.assertEqual(self.sub.paid_until, before)

    def test_marking_paid_twice_does_not_extend(self):
        self._request()
        for _ in range(2):
            _mark_paid(Invoice.objects.all())
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.paid_until, Invoice.objects.get().period_end)

    def test_marking_paid_repairs_a_missing_licence(self):
        """Absicherung für Rechnungen aus der Zeit vor der Sofort-Freischaltung
        (oder von Hand zurückgesetzte Konten)."""
        self._request()
        self.sub.refresh_from_db()
        self.sub.paid_until = None
        self.sub.save()
        _mark_paid(Invoice.objects.all())
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.paid_until, Invoice.objects.get().period_end)

    def test_marking_paid_repair_has_no_side_effects(self):
        """Der Reparaturpfad setzt **nur** `paid_until`. Sonst frisst das
        nachträgliche Verbuchen einer alten Rechnung einen inzwischen für die
        Ersatzrechnung neu vergebenen Einmal-Rabatt und schreibt nebenbei den
        heutigen Listenpreis fest."""
        self._request()
        self.sub.refresh_from_db()
        self.sub.paid_until = None       # Konto von Hand zurückgesetzt
        self.sub.list_price_chf = None   # Preisbindung bewusst gelöst
        self.sub.discount_percent = 30   # Rabatt für die Ersatzrechnung
        self.sub.discount_scope = DISCOUNT_ONCE
        self.sub.discount_used_at = None
        self.sub.save()

        _mark_paid(Invoice.objects.all())

        self.sub.refresh_from_db()
        self.assertEqual(self.sub.paid_until, Invoice.objects.get().period_end)
        self.assertIsNone(self.sub.discount_used_at)
        self.assertIsNone(self.sub.list_price_chf)
        self.assertEqual(self.sub.price_chf, 140)

    def test_cancelling_revokes_the_licence(self):
        _expire(self.user)  # ohne laufende Testphase, sonst greift die weiter
        self._request()
        invoice = Invoice.objects.get()
        _cancel(Invoice.objects.all())
        invoice.refresh_from_db()
        self.sub.refresh_from_db()
        self.assertEqual(invoice.status, Invoice.STATUS_CANCELLED)
        # Vorher gab es keine Lizenz → zurück auf gar keine
        self.assertIsNone(self.sub.paid_until)
        self.assertFalse(self.sub.is_active)

    def test_cancelling_falls_back_to_the_previous_licence(self):
        self.sub.paid_until = timezone.localdate() + timedelta(days=100)
        self.sub.save()
        self._request()
        invoice = Invoice.objects.get()
        _cancel(Invoice.objects.all())
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.paid_until, invoice.period_start)
        self.assertTrue(self.sub.is_paid)

    def test_cancelling_keeps_a_newer_licence_period(self):
        """Storno einer alten Rechnung darf eine inzwischen neuere Laufzeit
        nicht zurückdrehen."""
        self._request()
        alt = Invoice.objects.get()
        self.sub.refresh_from_db()
        self.sub.paid_until = alt.period_end + timedelta(days=365)
        self.sub.save()
        _cancel(Invoice.objects.filter(pk=alt.pk))
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.paid_until, alt.period_end + timedelta(days=365))

    def test_cancelling_during_the_trial_leaves_no_licence(self):
        """Storno nach einem Kauf während der Testphase darf keine Lizenz
        hinterlassen.

        Der Anker der Laufzeit ist dann das Trial-Ende (Resttage gehen nicht
        verloren). Solange der Storno den Vorzustand aus `period_start` erriet,
        blieb genau dieses Datum als `paid_until` stehen: der Kunde galt als
        zahlend, bekam später eine Verlängerungs-Erinnerung — und weil
        `can_request_invoice` bei laufender Lizenz erst im Verlängerungsfenster
        öffnet, war ihm der Kaufweg monatelang zu."""
        self.sub.trial_ends = timezone.now() + timedelta(days=180)  # Feedback-Dankeschön
        self.sub.save()
        self._request()

        _cancel(Invoice.objects.all())

        self.sub.refresh_from_db()
        self.assertIsNone(self.sub.paid_until)
        self.assertFalse(self.sub.is_paid)
        self.assertTrue(self.sub.in_trial)          # Testphase läuft weiter
        self.assertTrue(self.sub.can_request_invoice)
        # …und der Knopf dafür ist auch wirklich da (nicht die ausgegraute
        # Verlängerungs-Variante, die nur bei laufender Lizenz erscheint)
        response = self.client.get(reverse('konto'))
        self.assertContains(response, reverse('rechnung_anfordern'))
        self.assertNotContains(response, 'Verlängern kannst du')

    def test_previous_licence_is_frozen_on_the_invoice(self):
        """Der Vorzustand wird beim Ausstellen mitgeschrieben, nicht beim
        Storno rekonstruiert."""
        self.assertIsNone(subscription_for(self.user).paid_until)
        self._request()
        self.assertIsNone(Invoice.objects.get().previous_paid_until)

        _cancel(Invoice.objects.all())
        bis = timezone.localdate() + timedelta(days=100)
        self.sub.refresh_from_db()
        self.sub.paid_until = bis
        self.sub.save()
        self._request()

        zweite = Invoice.objects.exclude(status=Invoice.STATUS_CANCELLED).get()
        self.assertEqual(zweite.previous_paid_until, bis)
        _cancel(Invoice.objects.filter(pk=zweite.pk))
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.paid_until, bis)

    def test_cancelling_stamps_the_stored_pdf(self):
        """Das abgelegte PDF bleibt von der Konto-Seite abrufbar — es darf nach
        dem Storno nicht mehr zum Zahlen auffordern."""
        self._request()
        invoice = Invoice.objects.get()
        before = PdfReader(io.BytesIO(invoice.pdf_path.read_bytes())).pages[0].extract_text()
        self.assertIn('bereits freigeschaltet', before)

        _cancel(Invoice.objects.all())

        after = PdfReader(io.BytesIO(invoice.pdf_path.read_bytes())).pages[0].extract_text()
        self.assertIn('STORNIERT', after)
        self.assertIn('nicht bezahlen', after)
        self.assertNotIn('bereits freigeschaltet', after)

    def test_regenerated_pdf_of_a_cancelled_invoice_is_stamped(self):
        """Auch ein später neu erzeugtes PDF (Datei verloren) trägt den Stempel
        — die Kennzeichnung hängt am Status, nicht am Zeitpunkt."""
        self._request()
        invoice = Invoice.objects.get()
        _cancel(Invoice.objects.all())
        invoice.pdf_path.unlink()
        response = self.client.get(reverse('rechnung_pdf', args=[invoice.number]))
        self.assertEqual(response.status_code, 200)
        text = PdfReader(io.BytesIO(invoice.pdf_path.read_bytes())).pages[0].extract_text()
        self.assertIn('STORNIERT', text)

    def test_cancelled_invoice_allows_a_new_one(self):
        self._request()
        _cancel(Invoice.objects.all())
        self._request()
        self.assertEqual(Invoice.objects.count(), 2)

    # ── Adress-Grenzen (QR-Norm) ───────────────────────────────────────────
    def test_overlong_name_is_rejected_by_form(self):
        """Die QR-Norm erlaubt 70 Zeichen pro Adresszeile — längere Namen
        müssen am Formular scheitern, nicht erst als ValueError in qrbill
        (der hinterliesse eine Rechnung ohne erzeugbares PDF)."""
        response = self._request(billing_name='N' * 71)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Invoice.objects.count(), 0)
        response = self._request(billing_company='F' * 71)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Invoice.objects.count(), 0)

    def test_invalid_country_is_rejected(self):
        response = self._request(billing_country='XX')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Invoice.objects.count(), 0)

    def test_lowercase_country_is_normalised(self):
        self._request(billing_country='ch')
        self.assertEqual(Invoice.objects.get().billing_country, 'CH')

    def test_swiss_zip_must_be_four_digits(self):
        for bad in ('300', '30000', '30a0', 'ABCD'):
            response = self._request(billing_zip=bad)
            self.assertContains(response, 'vierstellige PLZ')
        self.assertEqual(Invoice.objects.count(), 0)

    def test_foreign_zip_may_be_long_or_alphanumeric(self):
        """NL '1234 AB', UK 'SW1A 1AA' & Co. sind gültig — die 4-Ziffern-Regel
        gilt nur für CH/LI."""
        self._request(billing_country='NL', billing_zip='1234 AB')
        self.assertEqual(Invoice.objects.get().billing_zip, '1234 AB')

    def test_pdf_renders_with_maximum_length_address(self):
        """70-Zeichen-Zeilen (das Maximum der QR-Norm) müssen im PDF umbrechen
        statt zu crashen oder über den Rand zu laufen."""
        self._request(billing_company='F' * 70, billing_name='N' * 70,
                      billing_street='S' * 70)
        invoice = Invoice.objects.get()
        self.assertEqual(invoice.pdf_path.read_bytes()[:4], b'%PDF')

    def test_foreign_address_carries_country_prefix(self):
        """Auslandsadresse: Ländercode vor der PLZ (wie auf dem QR-Zahlteil);
        bei CH bleibt er postüblich weg."""
        self._request(billing_country='DE', billing_zip='10115', billing_city='Berlin')
        self.assertIn('DE-10115 Berlin', Invoice.objects.get().address_lines)
        Invoice.objects.update(status=Invoice.STATUS_PAID)
        self._request()  # Standard-Adresse (CH)
        ch_invoice = Invoice.objects.get(status=Invoice.STATUS_OPEN)
        self.assertIn('3000 Bern', ch_invoice.address_lines)

    # ── Laufzeit ───────────────────────────────────────────────────────────
    def test_trial_remainder_is_not_lost(self):
        """Wer während der Testphase kauft, verliert die Resttage nicht: die
        Lizenz schliesst ans Trial-Ende an und dauert ein Kalenderjahr."""
        self._request()
        invoice = Invoice.objects.get()
        trial_end = timezone.localtime(self.sub.trial_ends).date()
        self.assertEqual(invoice.period_start, trial_end)
        self.assertEqual(invoice.period_end, trial_end.replace(year=trial_end.year + 1))

    # ── Eingefrorener Zahlungsempfänger ────────────────────────────────────
    def test_creditor_is_frozen_on_the_invoice(self):
        """Regeneriertes PDF = derselbe Beleg, auch nach Bankwechsel: die
        Zahlungsdaten kommen von der Rechnung, nicht aus den Settings. Mit der
        Platzhalter-IBAN in den Settings würde qrbill crashen — dass das
        Rendern klappt, beweist, dass die eingefrorene IBAN benutzt wird."""
        self._request()
        invoice = Invoice.objects.get()
        self.assertEqual(invoice.creditor_iban, 'CH5800791123000889012')
        self.assertEqual(invoice.creditor['name'], settings.INVOICE_CREDITOR['name'])
        invoice.pdf_path.unlink()
        with override_settings(INVOICE_IBAN='CH0000000000000000000'):
            store_pdf(invoice)
        self.assertEqual(invoice.pdf_path.read_bytes()[:4], b'%PDF')

    # ── Nummernkreis ───────────────────────────────────────────────────────
    def test_next_number_is_compared_numerically(self):
        """String-Sortierung fände '9999' > '10000' — ab der fünfstelligen
        Rechnung zöge das eine schon vergebene Nummer."""
        self._request()
        year = timezone.localdate().year
        Invoice.objects.update(number=f'{year}-9999', status=Invoice.STATUS_PAID)
        self._request()
        self.assertTrue(Invoice.objects.filter(number=f'{year}-10000').exists())

    # ── Rabatt-Text auf dem Beleg ──────────────────────────────────────────
    @override_settings(GLOBAL_DISCOUNT_PERCENT=25, GLOBAL_DISCOUNT_REASON='Aktion',
                       GLOBAL_DISCOUNT_UNTIL='2099-12-31')
    def test_invoice_discount_note_has_no_expiry_clause(self):
        """'gültig bis' gehört zur Aktion, nicht auf den eingefrorenen Beleg."""
        self._request()
        self.assertEqual(Invoice.objects.get().discount_note, '25 % Rabatt (Aktion)')

    # ── Fehlklick-Korrektur ────────────────────────────────────────────────
    def test_reopen_reverts_a_wrong_mark_paid(self):
        self._request()
        _mark_paid(Invoice.objects.all())
        _reopen(Invoice.objects.all())
        invoice = Invoice.objects.get()
        self.assertEqual(invoice.status, Invoice.STATUS_OPEN)
        self.assertIsNone(invoice.paid_at)

    def test_reopen_skips_cancelled_invoices(self):
        self._request()
        _cancel(Invoice.objects.all())
        _reopen(Invoice.objects.all())
        self.assertEqual(Invoice.objects.get().status, Invoice.STATUS_CANCELLED)

    # ── Storno-Hinweis auf verbrauchten Rabatt ─────────────────────────────
    def test_cancel_message_warns_about_consumed_once_discount(self):
        self.sub.discount_percent = 50
        self.sub.discount_scope = DISCOUNT_ONCE
        self.sub.save()
        self._request()  # löst den Einmal-Rabatt ein
        with patch.object(InvoiceAdmin, 'message_user') as message:
            InvoiceAdmin(Invoice, admin_site).cancel_invoices(
                RequestFactory().post('/vitruv/'), Invoice.objects.all())
        self.assertIn('Einmal-Rabatt', message.call_args.args[1])

    # ── Kunden-Sicht ───────────────────────────────────────────────────────
    def test_konto_marks_overdue_invoices(self):
        self._request()
        Invoice.objects.update(due_on=timezone.localdate() - timedelta(days=3))
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'überfällig seit')

    # ── Fehler beim Erzeugen ───────────────────────────────────────────────
    def test_pdf_failure_rolls_back_the_invoice(self):
        """Schlägt das PDF-Rendern fehl, darf keine Zombie-Rechnung bleiben:
        keine Freischaltung, kein verbrauchter Rabatt, Nummer wieder frei."""
        self.sub.discount_percent = 50
        self.sub.discount_scope = DISCOUNT_ONCE
        self.sub.save()
        with patch('accounts.views.store_pdf', side_effect=ValueError('kaputt')):
            response = self._request()
        self.assertContains(response, 'konnte nicht erstellt werden')
        self.assertEqual(Invoice.objects.count(), 0)
        self.sub.refresh_from_db()
        self.assertIsNone(self.sub.paid_until)
        self.assertIsNone(self.sub.discount_used_at)
        # Rollback komplett: der nächste Versuch bekommt wieder die erste Nummer
        self._request()
        self.assertEqual(Invoice.objects.get().number,
                         f'{timezone.localdate().year}-0001')

    # ── Doppel-Submit ──────────────────────────────────────────────────────
    def test_second_open_invoice_is_blocked_at_creation(self):
        """Der View-Check läuft ausserhalb der Transaktion — bei einem
        Doppelklick passieren ihn beide Requests. Der Guard in create_invoice
        selbst muss den zweiten stoppen."""
        create_invoice(self.user, self.sub, dict(ADDRESS))
        with self.assertRaises(OpenInvoiceError):
            create_invoice(self.user, self.sub, dict(ADDRESS))
        self.assertEqual(Invoice.objects.count(), 1)


@override_settings(BETA_PRICING=False, INVOICE_BCC='buchhaltung@planli.net',
                   INVOICE_IBAN='CH5800791123000889012', RENEWAL_REMINDER_DAYS=(30, 7))
class RenewalReminderTests(TestCase):
    """Täglicher renewal_reminders-Cron: Kunden-Erinnerung vor Lizenzablauf,
    Betreiber-Meldung bei neu überfälligen Rechnungen."""

    def setUp(self):
        self.user = _make_user()
        self.sub = subscription_for(self.user)

    def _run(self):
        call_command('renewal_reminders', stdout=io.StringIO())

    def _expiring_in(self, days):
        self.sub.paid_until = timezone.localdate() + timedelta(days=days)
        self.sub.save()

    def test_reminder_at_threshold(self):
        self._expiring_in(30)
        self._run()
        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.to, ['test@example.ch'])
        self.assertEqual(sent.bcc, ['buchhaltung@planli.net'])
        self.assertIn('/accounts/konto/', sent.body)

    def test_no_reminder_between_thresholds(self):
        """Deterministische Stichtage: der tägliche Cron trifft jede Lizenz
        pro Stichtag genau einmal — dazwischen ist Ruhe."""
        self._expiring_in(15)
        self._run()
        self.assertEqual(mail.outbox, [])

    def test_no_reminder_when_an_invoice_is_already_open(self):
        create_invoice(self.user, self.sub, dict(ADDRESS))
        self._expiring_in(30)
        self._run()
        self.assertEqual(mail.outbox, [])

    def test_operator_note_for_newly_overdue_invoice(self):
        invoice = create_invoice(self.user, self.sub, dict(ADDRESS))
        Invoice.objects.update(due_on=timezone.localdate() - timedelta(days=1))
        self._run()
        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.to, ['buchhaltung@planli.net'])
        self.assertIn('überfällig', sent.subject)
        self.assertIn(invoice.number, sent.body)

    def test_operator_note_only_on_the_day_after_due(self):
        """Nur am Tag nach Fristablauf — sonst käme die Meldung täglich."""
        create_invoice(self.user, self.sub, dict(ADDRESS))
        Invoice.objects.update(due_on=timezone.localdate() - timedelta(days=5))
        self._run()
        self.assertEqual(mail.outbox, [])

    @override_settings(BETA_PRICING=True)
    def test_silent_during_beta(self):
        self._expiring_in(30)
        self._run()
        self.assertEqual(mail.outbox, [])
