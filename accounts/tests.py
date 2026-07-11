from datetime import timedelta

from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import Subscription, subscription_for


class RegistrationTests(TestCase):
    def test_register_with_email_creates_user(self):
        response = self.client.post(reverse('register'), {
            'email': 'Test@Example.CH',
            'password1': 'sicher-genug-42',
            'password2': 'sicher-genug-42',
        })
        self.assertRedirects(response, '/app/', fetch_redirect_response=False)
        user = User.objects.get()
        # E-Mail wird kleingeschrieben als Username UND als E-Mail gespeichert
        self.assertEqual(user.username, 'test@example.ch')
        self.assertEqual(user.email, 'test@example.ch')
        # Nach der Registrierung direkt eingeloggt
        self.assertTrue(response.wsgi_request.user.is_authenticated)

    def test_register_rejects_duplicate_email(self):
        User.objects.create_user(username='test@example.ch', email='test@example.ch', password='x')
        response = self.client.post(reverse('register'), {
            'email': 'TEST@example.ch',
            'password1': 'sicher-genug-42',
            'password2': 'sicher-genug-42',
        })
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'existiert bereits ein Konto')
        self.assertEqual(User.objects.count(), 1)


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
        self.assertEqual(sub.status_label, 'Abgelaufen — nur Ansicht')

    def test_paid_overrides_expired_trial(self):
        sub = _expire(_make_user())
        sub.paid_until = timezone.localdate() + timedelta(days=365)
        sub.save()
        self.assertTrue(sub.is_paid)
        self.assertTrue(sub.is_active)


@override_settings(BETA_MODE=False)
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

    @override_settings(BETA_MODE=True)
    def test_beta_mode_has_no_gate(self):
        response = self.client.post(reverse('analyze_page'), {'session_id': 'x'})
        self.assertNotEqual(response.status_code, 403)
        self.assertNotEqual(response.status_code, 401)


@override_settings(BETA_MODE=False)
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
