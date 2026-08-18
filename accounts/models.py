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
                      list_price, vat_note)


def default_max_projects():
    return settings.DEFAULT_MAX_PROJECTS


class Subscription(models.Model):
    """Trial-/Abo-Status eines Users.

    Zahlung läuft über QR-Rechnungen: `paid_until` setzt activate_licence()
    beim Ausstellen der Rechnung, der Zahlungseingang wird im Invoice-Admin
    nur noch bestätigt ("Als bezahlt markieren"). Ein späterer Stripe-Webhook
    würde nur dasselbe Feld setzen."""

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

    # ── Rechnungsadresse ───────────────────────────────────────────────────
    # Zuletzt verwendete Adresse, dient nur der Vorbefüllung des Formulars.
    # Die verbindliche Adresse steht als Kopie auf der Rechnung selbst
    # (Invoice.billing_*) — eine Rechnung darf sich nie nachträglich ändern.
    billing_company = models.CharField(max_length=100, blank=True)
    billing_name = models.CharField(max_length=100, blank=True)
    billing_street = models.CharField(max_length=70, blank=True)
    billing_zip = models.CharField(max_length=16, blank=True)
    billing_city = models.CharField(max_length=35, blank=True)
    billing_country = models.CharField(max_length=2, default='CH')

    # ── Preis pro Konto ────────────────────────────────────────────────────
    # Basispreis und Rabatt liegen hier statt nur in den Settings, damit
    # Konto-Seite, Rechnungs-Mail und Admin denselben Betrag zeigen.
    # list_price_chf ist nullable: leer heisst "aktueller Listenpreis" und gilt
    # für alle, die noch nie bezahlt haben. Mit der ersten Rechnung schreibt
    # `pin_list_price()` (via activate_licence() beim Ausstellen) den dann
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
    # Wird von `consume_discount()` (via activate_licence() beim Ausstellen der
    # Rechnung) gesetzt: ein einmaliger Rabatt gilt danach nicht mehr, ein
    # dauerhafter ignoriert das Feld.
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
    def vat_note(self):
        """'inkl. 8.1 % MWST' — siehe pricing.vat_note()."""
        return vat_note()

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


class Invoice(models.Model):
    """Eine ausgestellte Jahresrechnung.

    Alles Preisrelevante ist **eingefroren**: Betrag, Rabatt und Adresse werden
    beim Ausstellen kopiert, nicht aus Subscription/Settings nachgeladen. Eine
    verschickte Rechnung darf sich nie nachträglich ändern — korrigiert wird
    per Storno + neuer Rechnung.
    """

    STATUS_OPEN = 'open'
    STATUS_PAID = 'paid'
    STATUS_CANCELLED = 'cancelled'
    STATUSES = [
        (STATUS_OPEN, 'Offen'),
        (STATUS_PAID, 'Bezahlt'),
        (STATUS_CANCELLED, 'Storniert'),
    ]

    # SET_NULL statt CASCADE: Rechnungen unterliegen der 10-jährigen
    # Aufbewahrungspflicht (OR 958f) und überleben deshalb die Kontolöschung.
    # Der Personenbezug zum Konto fällt weg, die Rechnungsdaten selbst
    # (Adresskopie unten) bleiben — das ist die Buchhaltung, nicht das Profil.
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name='invoices')
    number = models.CharField(max_length=20, unique=True, verbose_name='Rechnungsnummer')
    status = models.CharField(max_length=10, choices=STATUSES, default=STATUS_OPEN)
    issued_on = models.DateField(verbose_name='Rechnungsdatum')
    due_on = models.DateField(verbose_name='Zahlbar bis')
    paid_at = models.DateTimeField(null=True, blank=True, verbose_name='Bezahlt am')

    # Beträge in CHF, eingefroren
    net_chf = models.DecimalField(max_digits=9, decimal_places=2, verbose_name='Netto')
    vat_rate = models.DecimalField(max_digits=4, decimal_places=2, default=0,
                                   verbose_name='MWST-Satz (%)')
    vat_chf = models.DecimalField(max_digits=9, decimal_places=2, default=0,
                                  verbose_name='MWST')
    total_chf = models.DecimalField(max_digits=9, decimal_places=2, verbose_name='Total')

    # Was verrechnet wurde
    period_start = models.DateField(verbose_name='Lizenz von')
    period_end = models.DateField(verbose_name='Lizenz bis')
    list_price_chf = models.PositiveIntegerField(verbose_name='Basispreis')
    discount_percent = models.PositiveSmallIntegerField(default=0)
    discount_note = models.CharField(max_length=200, blank=True)

    # Zahlungsempfänger eingefroren — wie die Beträge: Wird das PDF Jahre
    # später regeneriert (Datei verloren), darf nicht die dann aktuelle
    # IBAN/Adresse aus den Settings auf den Beleg geraten. Leer nur bei
    # Rechnungen aus der Zeit vor diesen Feldern (Fallback auf Settings).
    creditor_iban = models.CharField(max_length=34, blank=True, default='')
    creditor = models.JSONField(default=dict, blank=True)
    creditor_vat_uid = models.CharField(max_length=32, blank=True, default='')

    # Adresskopie (überlebt die Kontolöschung)
    billing_company = models.CharField(max_length=100, blank=True)
    billing_name = models.CharField(max_length=100)
    billing_street = models.CharField(max_length=70)
    billing_zip = models.CharField(max_length=16)
    billing_city = models.CharField(max_length=35)
    billing_country = models.CharField(max_length=2, default='CH')
    billing_email = models.EmailField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-issued_on', '-number']

    def __str__(self):
        return f'{self.number} — CHF {self.total_chf} ({self.get_status_display()})'

    @property
    def is_open(self):
        return self.status == self.STATUS_OPEN

    @property
    def is_overdue(self):
        """Offen und Zahlungsfrist abgelaufen — genutzt im Admin und auf der
        Konto-Seite (der Kunde soll das auch sehen, nicht nur wir)."""
        return self.is_open and self.due_on < timezone.localdate()

    @property
    def pdf_path(self):
        return settings.INVOICES_DIR / f'{self.number}.pdf'

    @property
    def address_lines(self):
        """Empfängeradresse als Zeilen — für PDF und Konto-Seite.

        Auslandsadressen tragen den Ländercode vor der PLZ ('DE-10115 Berlin'),
        wie es auch der QR-Zahlteil tut; bei CH bleibt er postüblich weg."""
        place = f'{self.billing_zip} {self.billing_city}'.strip()
        if place and self.billing_country and self.billing_country != 'CH':
            place = f'{self.billing_country}-{place}'
        lines = [self.billing_company, self.billing_name, self.billing_street, place]
        return [line for line in lines if line]


def subscription_for(user):
    """Subscription holen; für Alt-User (vor Einführung registriert) wird
    sie nachträglich angelegt — Trial ab Registrierungsdatum."""
    sub, _created = Subscription.objects.get_or_create(
        user=user,
        defaults={'trial_ends': user.date_joined + timedelta(days=settings.TRIAL_DAYS)},
    )
    return sub
