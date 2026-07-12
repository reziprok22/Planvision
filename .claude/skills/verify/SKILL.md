---
name: verify
description: Planvision/planli lokal starten und Änderungen end-to-end über HTTP prüfen
---

# Planvision lokal verifizieren

## Starten

```bash
# Immer das venv nutzen; --noreload vermeidet doppeltes ML-Model-Laden.
# Achtung: Start dauert wegen Model-Load einige Sekunden (GPU-Init).
BETA_MODE=False env/bin/python manage.py runserver 8765 --noreload
```

- `BETA_MODE=False` aktiviert Login/Trial/Cloud-Ablage (Default True = alles offen, anonyme Sessions).
- E-Mails landen im Dev auf der Server-Konsole (Console-Backend) — Betreff mit Umlauten erscheint MIME-codiert (`=?utf-8?q?...?=`).
- Nach JS-Änderungen in `static/js/` zuerst `npm run build` (Template lädt `dist/js/main.js`).

## Testdaten & Flows

- Testuser direkt per `manage.py shell` anlegen (`User.objects.create_user(username=email, email=email, ...)` + `subscription_for(user)`), statt den Registrierungs-/Mail-Flow zu durchlaufen. `is_active=False` heisst "E-Mail nicht verifiziert".
- Auth-Flows lassen sich komplett mit curl + Cookie-Jar fahren: erst GET auf die Seite (setzt `csrftoken`), dann POST mit `csrfmiddlewaretoken` aus dem Jar und `-e <seiten-url>` als Referer.
- Login-POST: Felder `username` (= E-Mail) und `password` an `/accounts/login/`, Erfolg = 302 nach `/app/`.
- Dateiseiten der User: `cloud_projects/<uuid>.planli` (StoredProject.file_path), `projects/<uuid>/`, `training_data_opt-in/<uuid>/`.
- Aufräumen nicht vergessen: Testuser löschen entfernt nur DB-Zeilen (CASCADE), Dateien vorher per `file_path.unlink()` / `shutil.rmtree`.
