from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.contrib.admin.sites import site as admin_site
from django.contrib.auth.models import User
from django.core import mail
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .admin import SubscriptionAdmin
from .models import (DISCOUNT_LIFETIME, DISCOUNT_ONCE, Subscription,
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


def _extend(subs):
    """Admin-Action "Um 1 Jahr verlängern" ausführen (= Zahlung verbuchen).
    Die übergebenen Objekte sind danach veraltet — refresh_from_db()."""
    request = RequestFactory().post('/vitruv/')
    queryset = Subscription.objects.filter(pk__in=[s.pk for s in subs])
    with patch.object(SubscriptionAdmin, 'message_user'):
        SubscriptionAdmin(Subscription, admin_site).extend_one_year(request, queryset)


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

    @override_settings(BETA_PRICING=True, GLOBAL_DISCOUNT_PERCENT=0)
    def test_konto_shows_beta_note_and_future_price(self):
        """Während der Beta ist der Zugriff unbeschränkt (_read_only() greift
        nie), ein Rechnungs-CTA wäre also irreführend — der künftige Preis wird
        aber gezeigt, damit die Kosten nach der Beta bekannt sind."""
        response = self.client.get(reverse('konto'))
        self.assertContains(response, 'Während der Beta-Phase ist Planli')
        self.assertNotContains(response, 'Rechnung anfordern')
        self.assertContains(response, f'<sup>CHF</sup>{settings.LICENSE_PRICE_CHF}')
        self.assertContains(response, 'nach der Beta-Phase')

    @override_settings(BETA_PRICING=True, LICENSE_PRICE_CHF=240, GLOBAL_DISCOUNT_PERCENT=0)
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
@override_settings(LICENSE_PRICE_CHF=240, GLOBAL_DISCOUNT_PERCENT=0)
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

    def test_admin_extend_pins_price_so_increases_hit_only_new_users(self):
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

    def test_admin_extend_consumes_once_discount_only(self):
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
        self.assertEqual(once.paid_until, timezone.localdate() + timedelta(days=365))


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
