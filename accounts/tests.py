from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase
from django.urls import reverse


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
