from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import Subscription, subscription_for


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


def _make_user(email='test@example.ch', password='sicher-genug-42'):
    return User.objects.create_user(username=email, email=email, password=password)


def _expire(user):
    sub = subscription_for(user)
    sub.trial_ends = timezone.now() - timedelta(days=1)
    sub.save()
    return sub


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
        self.assertNotContains(response, 'Rechnung anfordern')

    def test_app_read_only_flag_and_banner(self):
        _expire(self.user)
        response = self.client.get(reverse('app'))
        self.assertContains(response, 'window.PLANLI_READ_ONLY = true')
        self.assertContains(response, 'read-only-banner')

    def test_app_active_user_not_read_only(self):
        response = self.client.get(reverse('app'))
        self.assertContains(response, 'window.PLANLI_READ_ONLY = false')
        self.assertNotContains(response, 'read-only-banner')

    @override_settings(BETA_PRICING=True)
    def test_konto_shows_beta_note_instead_of_price(self):
        """Während der Beta ist der Zugriff ohnehin unbeschränkt (_read_only()
        greift nie) — Preis/Rechnungs-CTA wären dann irreführend."""
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'Während der Beta-Phase ist Planli')
        self.assertNotContains(response, 'Rechnung anfordern')
        self.assertNotContains(response, str(settings.LICENSE_PRICE_CHF))

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


class MaxProjectsTests(TestCase):
    def test_default_limit_from_settings(self):
        sub = subscription_for(_make_user())
        self.assertEqual(sub.max_projects, 50)

    def test_limit_is_per_user(self):
        sub_a = subscription_for(_make_user('a@example.ch'))
        sub_b = subscription_for(_make_user('b@example.ch'))
        sub_b.max_projects = 200
        sub_b.save()
        sub_a.refresh_from_db()
        self.assertEqual(sub_a.max_projects, 50)
        self.assertEqual(sub_b.max_projects, 200)

    @override_settings(BETA_MODE=False)
    def test_konto_shows_limit(self):
        _make_user()
        self.client.login(username='test@example.ch', password='sicher-genug-42')
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'bis zu 50 Projekte')
