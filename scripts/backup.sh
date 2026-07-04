#!/usr/bin/env bash
#
# Beta-Backup für Planvision: sichert db.sqlite3 (konsistent) und bug_reports/.
# Bewusst NICHT projects/ (gross, transient, fremde Pläne -> Datenschutz/Retention).
#
# Einrichtung:
#   1. Pfade unten anpassen (APP_DIR, BACKUP_DIR).
#   2. chmod +x scripts/backup.sh
#   3. Testlauf:  ./scripts/backup.sh
#   4. Cron (täglich 03:30), via `crontab -e`:
#        30 3 * * * /opt/Planvision/scripts/backup.sh >> /var/log/planvision-backup.log 2>&1
#
set -euo pipefail

# ── Pfade anpassen ──────────────────────────────────────────────────────────────
APP_DIR="/opt/Planvision"            # Projektverzeichnis auf dem Server
BACKUP_DIR="/opt/backups/planvision" # Zielverzeichnis (idealerweise andere Platte/Mount)
KEEP_DAYS=30                          # so viele Tage DB-Backups aufbewahren
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

# 3) Rotation: alte DB-Backups entfernen (bug_reports werden bewusst nicht rotiert).
find "$BACKUP_DIR/db" -name 'db-*.sqlite3' -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T')  Rotation: DB-Backups älter als $KEEP_DAYS Tage entfernt"

echo "$(date '+%F %T')  Backup fertig."
