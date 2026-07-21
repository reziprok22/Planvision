"""
Setzt die Testphase (Subscription.trial_ends) aller User neu.

Gedacht als **einmaliger Schritt beim Beenden der Beta** (Umlegen von
BETA_PRICING auf False): Solange BETA_PRICING=True gilt, ist trial_ends
irrelevant (voller Zugriff, _read_only() greift nie) — der Zähler tickt aber im
Hintergrund runter. Beim Beta-Ende soll jeder eine frische, faire Testphase ab
*jetzt* bekommen, statt einen längst abgelaufenen oder halb verbrauchten Zähler:

  - User, die Feedback gegeben haben (Feedback-Dankeschön), bekommen die volle
    Feedback-Belohnung (Default FEEDBACK_REWARD_DAYS = 180 Tage).
  - Alle anderen bekommen eine frische Standard-Testphase (TRIAL_DAYS = 30).

Jeweils absolut ab jetzt gesetzt (nicht addiert). Superuser/Staff werden
übersprungen (interne Konten), ebenso bereits bezahlte Lizenzen (is_paid hätte
ohnehin Vorrang) — beides via Flags überschreibbar.

Aufruf (einmalig beim Beta-Ende, vor/nach dem Flag-Flip):
    python manage.py reset_trials [--dry-run]
    python manage.py reset_trials --feedback-days 180 --trial-days 30
"""
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import subscription_for
from core.models import FeedbackResponse


class Command(BaseCommand):
    help = "Setzt trial_ends aller User neu (Feedback-User 180, sonst 30 Tage ab jetzt)."

    def add_arguments(self, parser):
        parser.add_argument(
            '--feedback-days', type=int, default=settings.FEEDBACK_REWARD_DAYS,
            help=f'Tage für User mit Feedback (Default: {settings.FEEDBACK_REWARD_DAYS}).',
        )
        parser.add_argument(
            '--trial-days', type=int, default=settings.TRIAL_DAYS,
            help=f'Tage für User ohne Feedback (Default: {settings.TRIAL_DAYS}).',
        )
        parser.add_argument(
            '--include-staff', action='store_true',
            help='Auch Superuser/Staff einbeziehen (Default: übersprungen).',
        )
        parser.add_argument(
            '--include-paid', action='store_true',
            help='Auch bezahlte Lizenzen zurücksetzen (Default: übersprungen).',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Nur anzeigen, was passieren würde – nichts speichern.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        now = timezone.now()
        feedback_until = now + timedelta(days=options['feedback_days'])
        trial_until = now + timedelta(days=options['trial_days'])

        # Wer hat je Feedback gegeben? (Belohnung ist an die erste Antwort
        # gekoppelt – "hat Feedback" reicht als Kriterium.)
        feedback_user_ids = set(
            FeedbackResponse.objects.filter(user__isnull=False)
            .values_list('user_id', flat=True)
        )

        users = User.objects.all()
        if not options['include_staff']:
            users = users.filter(is_superuser=False, is_staff=False)

        prefix = '[dry-run] ' if dry_run else ''
        self.stdout.write(
            f"{prefix}Setze Testphasen neu: Feedback-User → {options['feedback_days']} Tage, "
            f"sonst → {options['trial_days']} Tage (ab {timezone.localtime(now):%d.%m.%Y})."
        )

        n_feedback = n_trial = n_skipped_paid = 0
        for user in users.iterator():
            sub = subscription_for(user)

            if sub.is_paid and not options['include_paid']:
                n_skipped_paid += 1
                self.stdout.write(f"  {prefix}übersprungen (bezahlt): {user.username}")
                continue

            if user.id in feedback_user_ids:
                new_ends, bucket = feedback_until, 'Feedback'
                n_feedback += 1
            else:
                new_ends, bucket = trial_until, 'Standard'
                n_trial += 1

            self.stdout.write(
                f"  {prefix}{user.username}: {bucket} → {timezone.localtime(new_ends):%d.%m.%Y}"
            )
            if not dry_run:
                sub.trial_ends = new_ends
                sub.save(update_fields=['trial_ends'])

        self.stdout.write(self.style.SUCCESS(
            f"{prefix}Fertig: {n_feedback} Feedback-User, {n_trial} Standard-User "
            f"neu gesetzt, {n_skipped_paid} bezahlte übersprungen."
        ))
