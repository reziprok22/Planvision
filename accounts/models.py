from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.core.validators import MaxValueValidator
from django.db import models
from django.utils import timezone

# Preislogik (Listenpreis, globale Aktion, Rundung) liegt in pricing.py; die
# Konstanten werden hier weiter-exportiert, weil Admin/Tests sie von den Models
# her importieren.
from .pricing import (DISCOUNT_LIFETIME, DISCOUNT_ONCE, DISCOUNT_SCOPES,  # noqa: F401
                      NO_DISCOUNT, Discount, apply_discount, global_discount,
                      list_price)


def default_max_projects():
    return settings.DEFAULT_MAX_PROJECTS


class Subscription(models.Model):
    """Trial-/Abo-Status eines Users.

    Zahlung läuft (vorerst) manuell: Rechnung per E-Mail, nach Zahlungseingang
    verlängert der Admin `paid_until` um ein Jahr (Admin-Action). Ein späterer
    Stripe-Webhook würde nur dasselbe Feld setzen."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='subscription')
    trial_ends = models.DateTimeField()
    paid_until = models.DateField(null=True, blank=True)
    # Wie viele Projekte dieser User in der (kommenden) Online-Ablage halten darf.
    # Pro User individuell (z.B. 50/100/200 je nach Plan), Default aus den Settings.
    # Durchgesetzt wird das Limit erst mit der Online-Projektablage — beim Bauen
    # dieses Features hier nachschlagen: Gate beim "In der Cloud speichern".
    max_projects = models.PositiveIntegerField(
        default=default_max_projects,
        help_text='Max. Anzahl online gespeicherter Projekte für diesen User.')
    # Zeitpunkt, zu dem der Bestätigungslink aus der Registrierungs-Mail
    # aufgerufen wurde. Bewusst getrennt von User.is_active, das ein Admin auch
    # manuell setzen kann — dieses Feld belegt ausschliesslich die E-Mail-
    # Verifikation. Kann durch Mail-Scanner (SafeLinks o.ä.) vor dem echten
    # Klick gesetzt werden, siehe verify_email() in accounts/views.py.
    email_verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # ── Preis pro Konto ────────────────────────────────────────────────────
    # Basispreis und Rabatt liegen hier statt nur in den Settings, damit
    # Konto-Seite, Rechnungs-Mail und Admin denselben Betrag zeigen.
    # list_price_chf ist nullable: leer heisst "aktueller Listenpreis" und gilt
    # für alle, die noch nie bezahlt haben. Mit der ersten Rechnung schreibt
    # `pin_list_price()` (Admin-Action "Um 1 Jahr verlängern") den dann
    # gültigen Preis fest — eine spätere Erhöhung trifft dadurch nur noch neue
    # Kunden, Bestandskunden behalten ihren Preis.
    list_price_chf = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Basispreis (CHF/Jahr)',
        # Kein Settings-Wert im help_text: der würde bei jeder Preisänderung
        # eine neue Migration erzwingen.
        help_text='Leer = aktueller Listenpreis (LICENSE_PRICE_CHF). Wird bei '
                  'der ersten Verlängerung automatisch festgeschrieben; leeren, '
                  'um das Konto auf den heutigen Listenpreis zu heben.')
    # Prozentual statt fixem Abzug, damit der Rabatt eine Preisänderung überlebt.
    discount_percent = models.PositiveSmallIntegerField(
        default=0, validators=[MaxValueValidator(100)], verbose_name='Rabatt (%)',
        help_text='0 = kein Rabatt.')
    discount_scope = models.CharField(
        max_length=10, choices=DISCOUNT_SCOPES, default=DISCOUNT_ONCE,
        verbose_name='Rabatt-Laufzeit')
    discount_reason = models.CharField(
        max_length=100, blank=True, verbose_name='Rabatt-Grund',
        help_text='Interne Notiz, z.B. "Beta-Tester" oder "Mengenrabatt 8 Lizenzen".')
    # Wird von der Admin-Action "Um 1 Jahr verlängern" gesetzt: ein einmaliger
    # Rabatt gilt danach nicht mehr, ein dauerhafter ignoriert das Feld.
    discount_used_at = models.DateTimeField(
        null=True, blank=True, verbose_name='Rabatt eingelöst am')

    def __str__(self):
        return f"{self.user.username}: {self.status_label}"

    @property
    def is_paid(self):
        return self.paid_until is not None and self.paid_until >= timezone.localdate()

    @property
    def in_trial(self):
        return not self.is_paid and timezone.now() <= self.trial_ends

    @property
    def is_active(self):
        """Voller Funktionsumfang? Sonst Read-Only (Ansehen/Exportieren)."""
        return self.is_paid or self.in_trial

    @property
    def trial_days_left(self):
        return max(0, (self.trial_ends - timezone.now()).days)

    # ── Preis ──────────────────────────────────────────────────────────────
    @property
    def list_price(self):
        """Basispreis in CHF/Jahr vor Rabatt."""
        if self.list_price_chf is not None:
            return self.list_price_chf
        return list_price()

    @property
    def personal_discount(self):
        """Der für dieses Konto hinterlegte Rabatt — leer, wenn keiner gesetzt
        oder ein einmaliger bereits eingelöst ist."""
        if not self.discount_percent:
            return NO_DISCOUNT
        if self.discount_scope == DISCOUNT_ONCE and self.discount_used_at is not None:
            return NO_DISCOUNT
        return Discount(self.discount_percent, self.discount_reason,
                        scope=self.discount_scope)

    @property
    def effective_discount(self):
        """Persönlicher ODER globaler Aktionsrabatt — der höhere gewinnt.
        Bewusst kein Stapeln: zwei 50 %-Rabatte ergäben sonst 75 %."""
        personal = self.personal_discount
        campaign = global_discount()
        return personal if personal.percent >= campaign.percent else campaign

    @property
    def discount_active(self):
        """Greift für die nächste Rechnung überhaupt ein Rabatt?"""
        return bool(self.effective_discount)

    @property
    def price_chf(self):
        """Effektiver Jahrespreis in CHF für dieses Konto."""
        return apply_discount(self.list_price, self.effective_discount.percent)

    @property
    def discount_label(self):
        """Kurztext für Konto-Seite und Admin, leer wenn kein Rabatt greift."""
        return self.effective_discount.label

    @property
    def price_is_pinned(self):
        """Hat dieses Konto einen festgeschriebenen Basispreis (Preisgarantie)?"""
        return self.list_price_chf is not None

    @property
    def has_price_guarantee(self):
        """Festgeschriebener Preis, der unter dem heutigen Listenpreis liegt —
        nur dann ist die Garantie für den Kunden überhaupt etwas wert."""
        return self.price_is_pinned and self.list_price_chf < list_price()

    def pin_list_price(self):
        """Aktuellen Listenpreis festschreiben (bei der Rechnungsstellung).
        Ein bereits fixierter Preis bleibt unangetastet — sonst wäre die
        Garantie bei der nächsten Verlängerung wieder weg. Speichert nicht
        selbst; gibt zurück, ob sich etwas geändert hat."""
        if self.list_price_chf is None:
            self.list_price_chf = list_price()
            return True
        return False

    def consume_discount(self):
        """Einmaligen Rabatt als eingelöst markieren (nach Zahlungseingang).
        Dauerhafte Rabatte bleiben unberührt. Speichert nicht selbst; gibt
        zurück, ob sich etwas geändert hat."""
        if (self.discount_percent and self.discount_scope == DISCOUNT_ONCE
                and self.discount_used_at is None):
            self.discount_used_at = timezone.now()
            return True
        return False

    @property
    def status_label(self):
        if self.is_paid:
            return f"Lizenz aktiv bis {self.paid_until.strftime('%d.%m.%Y')}"
        if self.in_trial:
            days = self.trial_days_left
            return f"Testphase, noch {days} Tag{'' if days == 1 else 'e'}"
        return 'Abgelaufen, nur Ansicht'


def subscription_for(user):
    """Subscription holen; für Alt-User (vor Einführung registriert) wird
    sie nachträglich angelegt — Trial ab Registrierungsdatum."""
    sub, _created = Subscription.objects.get_or_create(
        user=user,
        defaults={'trial_ends': user.date_joined + timedelta(days=settings.TRIAL_DAYS)},
    )
    return sub
