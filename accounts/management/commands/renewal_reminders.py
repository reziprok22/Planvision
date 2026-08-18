"""
Tägliche Lizenz-Erinnerungen (Cron).

Die Konto-Seite verspricht "Wir erinnern dich rechtzeitig per E-Mail" — das
hier ist die Einlösung. Zwei deterministische Stichtage statt gespeicherter
"schon erinnert"-Flags: jede Lizenz matcht jeden Stichtag an genau einem Tag,
ein täglicher Cron verschickt also nie doppelt (ein ausgefallener Cron-Lauf
holt dafür nichts nach — bewusst einfach gehalten).

Verhalten:
  - Kunden: RENEWAL_REMINDER_DAYS (Settings, Default 30 und 7) Tage vor
    Lizenzablauf eine Erinnerung mit Link auf die Konto-Seite ("Rechnung
    anfordern"). Übersprungen, wenn schon eine offene Rechnung existiert
    (dann ist die Verlängerung ja unterwegs) oder das Konto deaktiviert ist.
  - Betreiber (INVOICE_BCC): Sammelmail über Rechnungen, deren Zahlungsfrist
    gestern abgelaufen ist (Kandidaten für Nachfassen bzw. Storno).
  - Bei BETA_PRICING=True passiert nichts (in der Beta zahlt niemand).

Aufruf:
    python manage.py renewal_reminders [--dry-run]

Cron (Server, täglich 04:00):
    0 4 * * * cd /opt/Planvision && env/bin/python manage.py renewal_reminders \
        >> /var/log/planvision_reminders.log 2>&1
"""
from datetime import timedelta

from django.conf import settings
from django.core.mail import EmailMessage
from django.core.management.base import BaseCommand
from django.template.loader import render_to_string
from django.utils import timezone

from accounts.models import Invoice, Subscription


class Command(BaseCommand):
    help = 'Erinnert Kunden an auslaufende Lizenzen und meldet neu überfällige Rechnungen.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Nur anzeigen, was verschickt würde.')

    def handle(self, *args, **options):
        if settings.BETA_PRICING:
            self.stdout.write('BETA_PRICING aktiv — keine Erinnerungen.')
            return
        dry = options['dry_run']
        today = timezone.localdate()

        sent = 0
        for days in settings.RENEWAL_REMINDER_DAYS:
            subs = (Subscription.objects
                    .filter(paid_until=today + timedelta(days=days), user__is_active=True)
                    .select_related('user'))
            for sub in subs:
                if sub.user.invoices.filter(status=Invoice.STATUS_OPEN).exists():
                    continue
                email = sub.user.email or sub.user.username
                if dry:
                    self.stdout.write(f'Würde erinnern: {email} (Ablauf {sub.paid_until})')
                    continue
                context = {'sub': sub, 'days': days}
                mail = EmailMessage(
                    render_to_string('accounts/lizenz_erinnerung_subject.txt', context).strip(),
                    render_to_string('accounts/lizenz_erinnerung_email.txt', context),
                    to=[email],
                )
                if settings.INVOICE_BCC:
                    mail.bcc = [settings.INVOICE_BCC]
                mail.send()
                sent += 1

        # Neu überfällige Rechnungen (Frist gestern abgelaufen) an den Betreiber
        overdue = list(Invoice.objects.filter(
            status=Invoice.STATUS_OPEN, due_on=today - timedelta(days=1)))
        if overdue and settings.INVOICE_BCC:
            lines = [f'{inv.number} — {inv.billing_company or inv.billing_name}, '
                     f'CHF {inv.total_chf}, fällig gewesen am {inv.due_on:%d.%m.%Y}'
                     for inv in overdue]
            if dry:
                self.stdout.write('Würde Überfällig-Meldung schicken:\n' + '\n'.join(lines))
            else:
                EmailMessage(
                    f'Planli: {len(overdue)} Rechnung(en) neu überfällig',
                    'Zahlungsfrist gestern abgelaufen — Zahlungseingang prüfen, '
                    'nachfassen oder stornieren:\n\n' + '\n'.join(lines),
                    to=[settings.INVOICE_BCC],
                ).send()

        self.stdout.write(f'{sent} Erinnerung(en) verschickt, '
                          f'{len(overdue)} Rechnung(en) neu überfällig.')
