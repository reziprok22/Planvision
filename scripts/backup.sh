#!/usr/bin/env bash
#
# Beta-Backup für Planvision: sichert db.sqlite3 (konsistent), bug_reports/,
# training_data_opt-in/ und cloud_projects/ (Online-Ablage: Hardlink-Snapshots,
# KEEP_DAYS zurück). Danach Offsite-Sync nach pCloud via rclone (verschlüsseltes
# Remote RCLONE_REMOTE).
# Bewusst NICHT projects/ (gross, transient, fremde Pläne -> Datenschutz/Retention).
#
# Einrichtung:
#   1. Pfade unten anpassen (APP_DIR, BACKUP_DIR, RCLONE_REMOTE).
#   2. rclone-Remote einrichten (`rclone config`); fehlt rclone/Remote, wird der
#      Offsite-Schritt mit WARN übersprungen (lokales Backup läuft trotzdem).
#   3. chmod +x scripts/backup.sh
#   4. Testlauf:  ./scripts/backup.sh
#   5. Cron (täglich 03:30), via `crontab -e`:
#        30 3 * * * /opt/Planvision/scripts/backup.sh >> /var/log/planvision-backup.log 2>&1
#
set -euo pipefail

# ── Pfade anpassen ──────────────────────────────────────────────────────────────
APP_DIR="/opt/Planvision"            # Projektverzeichnis auf dem Server
BACKUP_DIR="/opt/backups/planvision" # Zielverzeichnis (idealerweise andere Platte/Mount)
KEEP_DAYS=30                          # so viele Tage DB-Backups aufbewahren
RCLONE_REMOTE="pcloud-e2ee-debian:backups"  # rclone-Ziel für den Offsite-Sync
# ────────────────────────────────────────────────────────────────────────────────

DB_FILE="$APP_DIR/db.sqlite3"
PYTHON="$APP_DIR/env/bin/python"     # Projekt-venv (hat sqlite3 garantiert)
STAMP="$(date +%F_%H%M%S)"

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/bug_reports"

# 1) SQLite konsistent sichern (Online-Backup-API, kein halb-geschriebener Stand).
#    Kopiert die DB auch dann sauber, wenn gerade geschrieben wird.
if [ -f "$DB_FILE" ]; then
  DB_DEST="$BACKUP_DIR/db/db-$STAMP.sqlite3"
  "$PYTHON" - "$DB_FILE" "$DB_DEST" <<'PY'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
con = sqlite3.connect(src)
bck = sqlite3.connect(dst)
with bck:
    con.backup(bck)
bck.close(); con.close()
PY
  echo "$(date '+%F %T')  DB gesichert -> $DB_DEST"
else
  echo "$(date '+%F %T')  WARN: $DB_FILE nicht gefunden – DB übersprungen"
fi

# 2) bug_reports/ spiegeln (akkumulierend, ohne --delete: Historie bleibt erhalten).
if [ -d "$APP_DIR/bug_reports" ]; then
  rsync -a "$APP_DIR/bug_reports/" "$BACKUP_DIR/bug_reports/"
  echo "$(date '+%F %T')  bug_reports gesichert -> $BACKUP_DIR/bug_reports/"
fi

# 3) training_data_opt-in/ spiegeln (unwiederbringliche Nutzer-Spenden; server-
#    seitig nie verändert/gelöscht, daher reicht akkumulierendes rsync ohne --delete).
if [ -d "$APP_DIR/training_data_opt-in" ]; then
  mkdir -p "$BACKUP_DIR/training_data_opt-in"
  rsync -a "$APP_DIR/training_data_opt-in/" "$BACKUP_DIR/training_data_opt-in/"
  echo "$(date '+%F %T')  training_data_opt-in gesichert -> $BACKUP_DIR/training_data_opt-in/"
fi

# 4) cloud_projects/ (Online-Ablage, dauerhafte Kundendaten): tagesweise
#    Snapshots mit Hardlinks (--link-dest) — unveränderte Dateien belegen
#    keinen zusätzlichen Platz, trotzdem KEEP_DAYS Stände zum Zurückgehen
#    (schützt auch gegen versehentliches Löschen, nicht nur Plattenausfall).
if [ -d "$APP_DIR/cloud_projects" ]; then
  CP_DIR="$BACKUP_DIR/cloud_projects"
  mkdir -p "$CP_DIR"
  CP_DEST="$CP_DIR/$STAMP"
  LATEST="$(ls -1d "$CP_DIR"/????-??-??_* 2>/dev/null | tail -1 || true)"
  if [ -n "$LATEST" ]; then
    rsync -a --link-dest="$LATEST" "$APP_DIR/cloud_projects/" "$CP_DEST/"
  else
    rsync -a "$APP_DIR/cloud_projects/" "$CP_DEST/"
  fi
  echo "$(date '+%F %T')  cloud_projects gesichert -> $CP_DEST"
fi

# 5) Rotation: alte Stände entfernen (bug_reports und training_data_opt-in
#    werden bewusst nicht rotiert).
#    cloud_projects-Snapshots nach Name (=Datum) rotieren, nicht nach mtime —
#    rsync -a überträgt die Quell-Zeitstempel auf die Snapshot-Verzeichnisse.
find "$BACKUP_DIR/db" -name 'db-*.sqlite3' -type f -mtime +"$KEEP_DAYS" -delete
ls -1d "$BACKUP_DIR/cloud_projects"/????-??-??_* 2>/dev/null | head -n -"$KEEP_DAYS" | xargs -r rm -rf
echo "$(date '+%F %T')  Rotation: Stände älter als $KEEP_DAYS Tage/Läufe entfernt"

# 6) Offsite-Sync nach pCloud (rclone, verschlüsseltes Remote).
#    db/, bug_reports/ und training_data_opt-in/ werden aus BACKUP_DIR gespiegelt
#    (Rotation der DB-Stände überträgt sich so automatisch aufs Remote).
#    cloud_projects/ wird NICHT aus den Hardlink-Snapshots hochgeladen — rclone
#    kennt keine Hardlinks, das würde KEEP_DAYS volle Kopien bedeuten. Stattdessen
#    direkt aus der Quelle spiegeln; geänderte/gelöschte Dateien wandern per
#    --backup-dir in datierte Versions-Ordner (gleiche Schutzwirkung, ohne Duplikate).
if ! command -v rclone >/dev/null 2>&1; then
  echo "$(date '+%F %T')  WARN: rclone nicht installiert – Offsite-Sync übersprungen"
elif ! rclone listremotes | grep -q "^${RCLONE_REMOTE%%:*}:$"; then
  echo "$(date '+%F %T')  WARN: rclone-Remote '${RCLONE_REMOTE%%:*}' nicht konfiguriert – Offsite-Sync übersprungen"
else
  rclone sync "$BACKUP_DIR/db" "$RCLONE_REMOTE/db"
  rclone sync "$BACKUP_DIR/bug_reports" "$RCLONE_REMOTE/bug_reports"
  if [ -d "$BACKUP_DIR/training_data_opt-in" ]; then
    rclone sync "$BACKUP_DIR/training_data_opt-in" "$RCLONE_REMOTE/training_data_opt-in"
  fi
  if [ -d "$APP_DIR/cloud_projects" ]; then
    rclone sync "$APP_DIR/cloud_projects" "$RCLONE_REMOTE/cloud_projects" \
      --backup-dir "$RCLONE_REMOTE/cloud_projects_versionen/$STAMP"
    # Versions-Ordner nach Name (=Datum) rotieren, analog zur lokalen Rotation.
    CUTOFF="$(date -d "-$KEEP_DAYS days" +%F)"
    { rclone lsf --dirs-only "$RCLONE_REMOTE/cloud_projects_versionen" 2>/dev/null || true; } \
      | while IFS= read -r vdir; do
          vdir="${vdir%/}"
          if [[ "${vdir%%_*}" < "$CUTOFF" ]]; then
            rclone purge "$RCLONE_REMOTE/cloud_projects_versionen/$vdir"
          fi
        done
  fi
  echo "$(date '+%F %T')  Offsite-Sync -> $RCLONE_REMOTE abgeschlossen"
fi

echo "$(date '+%F %T')  Backup fertig."
