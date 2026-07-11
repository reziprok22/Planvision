from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone


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
    created_at = models.DateTimeField(auto_now_add=True)

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

    @property
    def status_label(self):
        if self.is_paid:
            return f"Lizenz aktiv bis {self.paid_until.strftime('%d.%m.%Y')}"
        if self.in_trial:
            days = self.trial_days_left
            return f"Testphase — noch {days} Tag{'' if days == 1 else 'e'}"
        return 'Abgelaufen — nur Ansicht'


def subscription_for(user):
    """Subscription holen; für Alt-User (vor Einführung registriert) wird
    sie nachträglich angelegt — Trial ab Registrierungsdatum."""
    sub, _created = Subscription.objects.get_or_create(
        user=user,
        defaults={'trial_ends': user.date_joined + timedelta(days=settings.TRIAL_DAYS)},
    )
    return sub
