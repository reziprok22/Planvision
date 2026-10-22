"""
Räumt den projects/-Ordner auf (Datenschutz / Datenminimierung).

projects/<uuid>/ ist reiner Arbeits-/Zwischenspeicher einer Session (hochgeladenes
PDF + gerenderte Seitenbilder). Das eigentliche Projekt lebt clientseitig (ZIP),
freiwillig freigegebene Trainingsdaten liegen bereits kopiert in TRAINING_DATA_DIR.
Deshalb dürfen die projects/-Ordner nach Ablauf der Aufbewahrungsfrist komplett weg.

Verhalten:
  - Löscht projects/<uuid>/, wenn die zugehörige Project-Zeile älter als N Tage ist,
    und setzt Project.files_deleted=True (die DB-Zeile bleibt für die Statistik).
  - Verwaiste Ordner ohne Project-Zeile werden nach Verzeichnis-mtime gelöscht.
  - Räumt im Zwischenlager des Online-Speicherns (CLOUD_STAGING_DIR) Reste
    abgebrochener Speichervorgänge weg, die älter als einen Tag sind.

Aufruf:
    python manage.py cleanup_projects [--days N] [--dry-run]

Cron (Server, täglich 03:00):
    0 3 * * * cd /opt/Planvision && env/bin/python manage.py cleanup_projects \
        >> /var/log/planvision_cleanup.log 2>&1
"""
import shutil
import time
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.conf import settings
from django.utils import timezone

from core.models import Project
from core.views import STAGING_MAX_AGE_S, _prune_staging


class Command(BaseCommand):
    help = "Löscht abgelaufene projects/<uuid>/-Ordner (Arbeitsdaten)."

    def add_arguments(self, parser):
        parser.add_argument(
            '--days', type=int, default=settings.PROJECT_RETENTION_DAYS,
            help='Aufbewahrungsdauer in Tagen (Default: settings.PROJECT_RETENTION_DAYS).',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Nur anzeigen, was gelöscht würde – nichts verändern.',
        )

    def handle(self, *args, **options):
        days = options['days']
        dry_run = options['dry_run']
        cutoff = timezone.now() - timedelta(days=days)
        projects_dir = settings.PROJECTS_DIR

        prefix = '[dry-run] ' if dry_run else ''
        self.stdout.write(f"{prefix}Cleanup projects/ – älter als {days} Tage (cutoff {cutoff:%Y-%m-%d %H:%M}).")

        self._prune_cloud_staging(dry_run, prefix)

        if not projects_dir.exists():
            self.stdout.write("projects/ existiert nicht – nichts zu tun.")
            return

        # Bekannte, abgelaufene Projekte (Dateien noch vorhanden).
        expired = Project.objects.filter(created_at__lt=cutoff, files_deleted=False)
        known_ids = set(str(pk) for pk in Project.objects.values_list('id', flat=True))

        removed = 0
        freed_dirs = []

        for project in expired.iterator():
            path = projects_dir / str(project.id)
            if path.exists():
                freed_dirs.append(path)
                if not dry_run:
                    shutil.rmtree(path, ignore_errors=True)
            if not dry_run:
                project.files_deleted = True
                project.save(update_fields=['files_deleted'])
            removed += 1

        # Verwaiste Ordner ohne Project-Zeile: nach Verzeichnis-mtime.
        orphan_cutoff_ts = cutoff.timestamp()
        orphans = 0
        for entry in projects_dir.iterdir():
            if not entry.is_dir() or entry.name in known_ids:
                continue
            try:
                mtime = entry.stat().st_mtime
            except OSError:
                continue
            if mtime < orphan_cutoff_ts:
                freed_dirs.append(entry)
                orphans += 1
                if not dry_run:
                    shutil.rmtree(entry, ignore_errors=True)

        for path in freed_dirs:
            self.stdout.write(f"  {prefix}entfernt: {path.name}")

        self.stdout.write(self.style.SUCCESS(
            f"{prefix}Fertig: {removed} abgelaufene Projekt-Ordner, {orphans} verwaiste Ordner."
        ))

    def _prune_cloud_staging(self, dry_run, prefix):
        staging = settings.CLOUD_STAGING_DIR
        if not staging.exists():
            return
        if dry_run:
            cutoff = time.time() - STAGING_MAX_AGE_S
            old = sum(1 for d in staging.iterdir() if d.is_dir()
                      for f in d.iterdir() if f.stat().st_mtime < cutoff)
            self.stdout.write(f"{prefix}Zwischenlager: {old} Reste würden entfernt.")
            return
        for user_dir in staging.iterdir():
            if user_dir.is_dir():
                _prune_staging(user_dir)
                try:
                    user_dir.rmdir()   # nur wenn leer
                except OSError:
                    pass
