# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Planvision (live as **planli.net**) is a Django-based web application for architectural plan analysis that uses computer vision to detect and annotate building elements (windows, doors, walls, roofs, etc.) in PDF files. The application provides:

- AI-powered object detection using a Faster R-CNN model (target label selectable via "Erkennen als")
- Multi-page PDF support with individual page analysis (server accepts **PDF only**; images are rejected)
- Interactive annotation editor using Fabric.js (rectangles, polygons, line measurements, vertex editing)
- CAD-style "Bemassung" helper tool (`data-tool="dimension"`, shortcut **D**): a 3-click linear dimension (start → end → parallel offset) with witness lines + centred measurement. Own `objectType: 'dimension'` — deliberately **not** an annotation, so it never appears in the results table, summary or label manager; it is selectable/movable/deletable, editable via **double-click** (handles for the two endpoints + a parallel-offset handle on the dimension line), persisted per page (ZIP `canvas_dimensions`) and drawn in the PDF export
- "Textfeld" tool (`data-tool="text"`, shortcut **F**): drag a box, then type inside it (Fabric `Textbox`, word-wrapped). Own `objectType: 'textNote'` — like the dimension, **not** an annotation (out of results table/summary/label manager); double-click to re-edit, empty notes auto-removed on exit, persisted per page (ZIP `canvas_text_notes`) and rendered in the PDF export
- Project management with client-side ZIP save/load
- Frontend PDF exports (annotated plan + report) via pdf-lib, incl. placeable on-plan legend
- Bug reports from testers (header button → Django admin)
- User authentication (login/register/logout) via Django's built-in auth system; can be disabled via `BETA_MODE` for the beta phase

## Development Commands

### Running the Application
```bash
# Start the Django development server
python manage.py runserver

# Or on a specific port
python manage.py runserver 5000
```

### Database Migrations
```bash
python manage.py migrate
python manage.py makemigrations  # after changing models
```

### Create Admin User
```bash
python manage.py createsuperuser
```

### Frontend Build (Vite)
JavaScript source files are in `static/js/`. Vite bundles them into `dist/js/main.js`, which is what the HTML template loads via Django's `{% static 'js/main.js' %}`.

```bash
# After any change to static/js/*.js:
npm run build
```

**Important:** `dist/js/main.js` is committed to git (intentional — solo project, no CI/CD). Do not add it to `.gitignore`.

### Python Environment
The project uses a virtual environment located at `env/` with dependencies listed in `requirements.txt`. Key dependencies include:
- Django 6.0.5 for web framework
- Whitenoise for static file serving
- PyTorch 2.6.0 for machine learning
- OpenCV for image processing
- Fabric.js v6 (ES6 modules, bundled via Vite)

### Model Requirements
The application requires a pre-trained Faster R-CNN model at:
`fasterrcnn_model/fasterrcnn_model_2025-04-22-20-04-25.pth`

## Architecture

### Django Project Structure
- **config/**: Django project settings, root URL config, WSGI
- **core/**: Main app — views (upload, analyze, file serving, index), URLs
- **accounts/**: Auth app — login, logout, register views and templates
- **manage.py**: Django management entry point

### Backend (Python)
- **core/views.py**: Django views for file upload, AI analysis, file serving, bug reports, landing/app pages; central auth helpers `_access_denied()` / `_get_project()`
- **core/models.py**: `Project` (session ownership, user nullable for BETA_MODE) and `BugReport` (visible in Django admin)
- **core/apps.py**: `CoreConfig.ready()` loads the ML model at startup
- **model_handler.py**: PyTorch model loading and inference logic
- **image_preprocessing.py**: OpenCV-based image preprocessing
- **utils.py**: Scale calculations and non-maximum suppression utilities

### Frontend (JavaScript ES6 Modules, in `static/js/`)
- **main.js**: Primary application controller AND all canvas logic — Fabric.js setup, zoom/pan, drawing tools, vertex editing, text labels, on-plan legend, results table, undo/redo, page switching (there is no separate fabric-handler/zoom-manager module)
- **labels.js**: Label management (Label-Manager modal, colors/opacity/stroke, tool dropdowns)
- **pdf-handler.js**: Session and page state (session id, page URLs, per-page settings, original PDF blob)
- **upload-modal.js**: Left sidebar — drop zone, upload, page list with per-page scale
- **project.js**: Save/load/export button handlers + bug report modal
- **project-zip.js**: ZIP build/load incl. format versioning and migrations
- **pdf-export-client.js**: pdf-lib exports (annotated plan + report), page-rotation aware

### Static Files
- `static/` and `dist/` are both in `STATICFILES_DIRS` — both served under `/static/`
- Whitenoise serves static files in production (no separate web server needed for static)
- Templates use `{% load static %}` and `{% static 'path' %}` for all asset references

### Data Flow
1. User uploads a PDF via the left-sidebar drop zone (server rejects non-PDF)
2. `core/views.py` converts PDF to images if needed, extracts page dimensions
3. `model_handler.py` runs AI inference using the Faster R-CNN model
4. Results return to frontend with bounding boxes and confidence scores
5. `fabric-handler.js` renders annotations on Fabric.js canvas overlay
6. User can edit annotations in editor mode
7. Projects can be saved with all page data and exported as PDF reports

### File Structure Patterns
- `projects/`: All session data — uploaded images, saved projects (subdirectory per project UUID)
- `templates/`: Django HTML templates (landing.html, app.html, datenschutz.html, impressum.html, accounts/)
- `staticfiles/`: Collected static files for production (`python manage.py collectstatic`)

## Key Technical Details

### PDF Processing
- PDFs are converted to JPG images using pdf2image
- Page dimensions are extracted using PyPDF2 for accurate scaling
- Each session gets a unique UUID directory under `projects/<uuid>/uploads/`

### Object Detection Model
- Loaded once at startup via `core/apps.py` → `CoreConfig.ready()`
- Uses torchvision's Faster R-CNN with ResNet-50 backbone
- 6 classes: Background, Window, Door, Wall, Dormer, Roof
- Applies NMS (Non-Maximum Suppression) to filter overlapping detections
- Calculates real-world areas using DPI and scale factor

### Annotation System
- Fabric.js canvas overlays the image for interactive editing
- Supports rectangles, polygons, and line measurements
- Canvas coordinates are synchronized with image zoom levels
- Editor mode allows adding, editing, and deleting annotations
- **Auto font scale**: all on-canvas text sizes (annotation labels, legend, dimension text, text-note start size) are A4-tuned base values multiplied by `autoFontScale(imgW, imgH)` (`pdf-handler.js`): `clamp((shortSide / 1240)^0.6, 1, 5)` — page-size-based because the server always renders at 150 DPI, damped since large plans tend to have finer detail (A4 = 1×, A3 ≈ 1.2×, A0 ≈ 2.3×). Computed per page; the PDF export applies the same factor so canvas and export match. No user setting by design.
- **beforeunload-Warnung via Dirty-Tracking**: `projectDirty` (main.js) — gesetzt an den Content-Änderungs-Trichtern (`saveHistorySnapshot(seed=false)`, Undo/Redo, Massstab-Änderung, Seiten-Aktionen, `onPagesAppended`, Label-Manager via `window.planliMarkProjectDirty`), gelöscht nach erfolgreichem Speichern (Cloud **und** .planli-Download) und Projekt-Load (`window.planliMarkProjectSaved` aus project.js) sowie bei frischem Upload/Editor-Reset. Wichtig: Basis-Snapshots nach Seitenwechsel/`loadCanvasData` laufen mit `saveHistorySnapshot(true)` (Seed — kein Nutzereingriff, darf nicht dirty setzen). Nur Ansehen (z.B. Demo) warnt so nie beim Schliessen. Debug-Getter: `window.planliProjectIsDirty()`.

### Demo-Modus (Landingpage → App)
- Hero-Button „Demo ansehen" (Plausible-Event `CTA: Demo Hero`) verlinkt auf `/app?demo=1`
- `maybeLoadDemoProject()` (project.js, aufgerufen am Ende von `initApp` in main.js — braucht die window-Hooks) lädt `static/demo/demo.planli` (URL via `window.PLANLI_DEMO_URL` aus app.html) über den normalen `handleLoad`-Pfad: fertig analysiertes Projekt, keine KI-Analyse, keine Serverlast. Fehlt die Datei → Fehler-Toast + leerer Editor
- Die Demo-Datei ist ein normales `.planli`-Export-ZIP, eingecheckt als `static/demo/demo.planli` (siehe README dort); klein halten (1–2 Seiten, < ~3 MB)
- Auch ohne Login zugänglich, wenn `BETA_MODE=False`: die `app`-View lässt `?demo=1` anonym durch (nur App-Shell; alle API-Endpoints bleiben login-geschützt)
- Das Erstbesuch-Onboarding-Modal wird im Demo-Modus unterdrückt (onboarding.js, Seen-Flag bleibt ungesetzt)

### Authentication
- Django's built-in `django.contrib.auth` handles users, sessions, and password hashing
- **E-Mail + password only** (no visible username): registration/login use the email as the internal `username` (lowercased) via `EmailUserCreationForm`/`EmailAuthenticationForm` in `accounts/forms.py` — no custom user model
- Login: `/accounts/login/` — Logout: `/accounts/logout/` (POST) — Register: `/accounts/register/`
- Password reset: `/accounts/password-reset/` (full Django flow; templates in `templates/accounts/`, mail via `EMAIL_*` settings — console backend in dev, SMTP via `DJANGO_EMAIL_*` env vars in prod)
- Konto löschen: `/accounts/konto/loeschen/` (Link auf der Konto-Seite) — **sofortige harte Löschung** (DSGVO Art. 17) nach Passwort-Bestätigung: Dateien explizit weg (`cloud_projects/`, `projects/<uuid>/`, `training_data_opt-in/` bei consent), DB via CASCADE (BugReport/AnalysisEvent bleiben per SET_NULL anonymisiert), danach Bestätigungs-Mail (best-effort). Superuser/Staff sind von der Web-UI-Löschung ausgenommen. Bewusst keine 30-Tage-Frist: ein Soft-Delete via `is_active` würde mit der E-Mail-Verifikation kollidieren
- Auth pages share a card layout: `templates/accounts/auth_base.html`
- Logged-in users see their email + "Abmelden" (POST form) in the app header burger menu; the landing nav shows "Anmelden" when logged out (non-beta)
- Admin panel available at `/vitruv/` (requires superuser; deliberately not the default `/admin/` to avoid bot scanners — never list this path in robots.txt or public pages) — includes the bug report list
- All API endpoints are CSRF-protected; the frontend sends `X-CSRFToken` from the cookie (set via `@ensure_csrf_cookie` on the app view)
- `BETA_MODE` (settings, env-overridable, default **True**): when True, all endpoints work without login, projects are stored with `user=NULL` (access guarded only by the unguessable session UUID), and the "Beta" badge shows next to the app logo. The whole login flow is built and dormant behind this switch; test locally via `BETA_MODE=False python manage.py runserver`. Exposed to all templates via the `beta_mode` context processor

### Trial & Lizenz (Subscription)
- `accounts/models.py`: `Subscription` (OneToOne zu User, `trial_ends`, `paid_until`). Trial startet bei der Registrierung (`TRIAL_DAYS = 30`); Alt-User ohne Subscription bekommen sie lazy via `subscription_for()` (Trial ab `date_joined`)
- Zahlung läuft (vorerst) **manuell ohne Stripe**: Konto-Seite `/accounts/konto/` zeigt Status/Preis (`LICENSE_PRICE_CHF = 240`) mit "Rechnung anfordern"-Mailto; nach Zahlungseingang Admin-Action "Um 1 Jahr verlängern" (setzt `paid_until`). Ein späterer Stripe-Webhook würde nur dasselbe Feld setzen
- **Abgelaufen ⇒ Read-Only**: Ansehen, Projekte öffnen und PDF-Export bleiben erlaubt; gesperrt sind KI-Analyse (serverseitig: `analyze_page` → 403 via `_read_only()` in `core/views.py`) sowie Zeichnen/Bearbeiten (frontend: `window.PLANLI_READ_ONLY` → `main.js` erzwingt Select-Tool, `canvas.skipTargetFind`, zentrale Hotkey-Sperre im Keydown-Handler — erlaubt nur Ctrl+S/O, Escape, `?`; CSS `body.read-only` graut die Buttons aus, Banner unter dem Header)
- **Projektlimit** (`Subscription.max_projects`, Default `DEFAULT_MAX_PROJECTS = 50`, pro User im Admin änderbar z.B. 100/200; auf der Konto-Seite angezeigt): Anzahl online speicherbarer Projekte — durchgesetzt in `cloud_save` beim Anlegen (Überschreiben zählt nicht). Entschieden: Anzahl-Limit statt GB-Quote; dazu `MAX_PROJECT_MB = 200` als stiller Deckel pro Projekt und (noch offen) Archivierung nach 12 Monaten Inaktivität

### Feedback-Dankeschön (Akquise-Phase)
- Header-Button „Feedback" (nur eingeloggt) + blauer Banner unter dem Header öffnen ein Modal mit drei festen Fragen (Was gefällt dir? / Was muss verbessert werden? / Was fehlt dir?) — alle drei Pflicht, keine Mindestlänge
- `POST /feedback` (`submit_feedback` in `core/views.py`, login-pflichtig auch im BETA_MODE) speichert `FeedbackResponse` (`core/models.py`, User SET_NULL wie BugReport, sichtbar im `/vitruv/`-Admin); die **erste** Antwort pro User setzt als Dankeschön `trial_ends = max(bisher, jetzt + FEEDBACK_REWARD_DAYS)` (`= 180`, settings.py) — bewusst „Variante einfach": ab heute, kein Code-/Mail-System, hebt auch eine abgelaufene (Read-Only-)Trial wieder auf (Frontend lädt dann neu)
- Banner (`feedback_reward` im app-View-Context) erscheint nur, solange der User noch kein Feedback gegeben hat; „×" blendet ihn dauerhaft aus (`localStorage['feedback_banner_dismissed']`); liegt per z-index 1250 über dem Dashboard-Overlay, damit er auch in der Startansicht sichtbar ist. Im Dashboard zusätzlich „Feedback geben" in der linken Spalte (Proxy `dashFeedbackBtn` → `feedbackBtn`)
- Frontend-Logik in `project.js` (`setupFeedback`/`handleFeedbackSubmit`), Modal-Markup in `app.html`

### Online-Ablage ("Meine Projekte")
- **Speicherformat = das normale `.planli`-ZIP** (`buildProjectZipBlob`), serverseitig als `cloud_projects/<uuid>.planli` abgelegt (`StoredProject` in `core/models.py`: user, name, size, updated, `last_opened_at` für die spätere Archivierung). Gitignored, vom `cleanup_projects` nie berührt
- Endpoints (`core/views.py`, alle nur mit Login — unabhängig von BETA_MODE): `GET /cloud/projects` (Liste + Limit), `POST /cloud/projects/save` (upsert: mit `project_id` überschreiben, sonst anlegen → Quota-Gate + Grössen-Deckel; Read-Only ⇒ 403), `GET .../download` (setzt `last_opened_at`), `POST .../rename`, `POST .../delete` (auch Read-Only erlaubt — gibt Speicher frei)
- **Frontend** (`project.js`): eingeloggt (`window.PLANLI_CLOUD`) wird "Speichern"/Ctrl+S zum Cloud-Speichern (`currentCloudProjectId` = gerade geöffnetes Cloud-Projekt → Überschreiben; null → neu). Der Header-Button heisst eingeloggt "Meine Projekte" (sonst "Öffnen"; Label/Tooltip via `cloud_enabled` im Template) und öffnet mit Ctrl+O das **Dashboard** (`#cloudDashboard`, Startansicht beim App-Laden): Projektliste mit Zähler "x von N"; Öffnen per Klick auf die Zeile, pro Zeile ein "⋯"-Menü (Umbenennen / ".planli-Datei exportieren" = Direkt-Download des gespeicherten ZIPs ohne Öffnen / Löschen). Ein .planli-Import wird automatisch als neues Cloud-Projekt gespeichert (ausser Read-Only) — kein manuelles Ctrl+S nötig. "+ Neues Projekt" setzt den Editor komplett zurück (`startNewProject()` in `upload-modal.js` → `window.planliResetEditor()` in `main.js`: Canvas/Empty-State, Ergebnis-Spalte, Manifest, History) und zeigt den leeren Editor mit Drop-Zone (bewusst kein automatischer Datei-Dialog) — nie nur Overlay schliessen (Duplikat-Falle: altes Projekt im Editor, aber Ctrl+S legte neues Cloud-Projekt an). Derselbe Reset läuft beim "+ Neu"-Button der Sidebar. "← Zurück zum Editor" (nur sichtbar, wenn ein Plan geladen ist) schliesst das Overlay. Bei offenem Dashboard (`body.dashboard-open`) sind die Header-Editor-Aktionen und das ganze Burger-Menü ausgeblendet und die Editor-Hotkeys gesperrt; stattdessen zeigt eine permanente linke Spalte (`_app_sidebar.html`, siehe unten „App-Shell") die Optionen: Anleitung/Verbesserung/Bug als Proxy-Buttons auf die Menü-IDs (`dash*Btn` → `.click()` in `project.js`), Konto-Link und Abmelden-POST-Form direkt im Markup. Datei-Workflows: ".planli-Datei importieren" als Button im Dashboard und im Burger-Menü, ".planli-Datei exportieren" im Burger-Menü. Frischer Upload ruft `window.planliCloudNewUpload()` (Hook in `upload-modal.js`) → nächstes Speichern legt ein neues Projekt an. Öffnen aus der Cloud lädt das ZIP über den normalen `handleLoad`-Pfad
- **Ein kanonischer Projektname**: gehalten in `upload-modal.js` (`currentFileName`, beim Upload mit dem PDF-Namen vorbelegt), im Editor per Klick auf den Namen in der file-info-bar umbenennbar (`setProjectName()`). Cloud-Speichern sendet ihn **auch beim Überschreiben** mit (Server aktualisiert `StoredProject.name`), beim Öffnen aus der Cloud gewinnt der Cloud-Name über `metadata.project_name` aus dem ZIP, Dashboard-Umbenennen wirkt auf ein gerade geöffnetes Projekt zurück. Datei-Downloads und PDF-Exporte schöpfen alle aus `getUploadedBaseName()` (strippt nur echte Dateiendungen — Namen dürfen Punkte enthalten)
- In der Beta unsichtbar (kein Login ⇒ `cloud_enabled=False`, altes ZIP-Speichern/Öffnen unverändert)
- Im BETA_MODE komplett inaktiv (kein Gate, kein Banner)

### App-Shell (eingeloggte Seiten: Projektübersicht + Konto)
- Gemeinsame linke Spalte `templates/_app_sidebar.html` (Include mit `active="dashboard"` bzw. `active="konto"`) sorgt für durchgehende Navigation zwischen dem Cloud-Dashboard (app.html) und der Konto-Seite (`accounts/konto.html`) — vorher zwei optisch getrennte "Produkte" (Dashboard-Overlay vs. Marketing-Chrome), jetzt ein App-Gefühl mit Projektübersicht/Konto als fixe Nav-Items (aktiver Zustand hervorgehoben) plus Abmelden; die Dashboard-only-Buttons (Anleitung/Verbesserung/Bug/Feedback) erscheinen nur bei `active="dashboard"`
- **Zwei CSS-Definitionen, ein Klassenname**: `.app-side*` steht sowohl in `static/css/styles.css` (app.html/Dashboard, Overlay-Kontext) als auch im `<style>`-Block von `base.html` (Konto, nutzt dessen `--slate-*`/`--primary`-Tokens) — bewusst dupliziert statt eines gemeinsamen Stylesheets, weil app.html und base.html zwei komplett unterschiedliche Design-Systeme laden und ein globales Cross-Linking Stilbrüche auf den öffentlichen Seiten riskieren würde
- Konto rendert über `base.html` mit `app_shell=True, active_nav='konto'` im View-Context (`accounts/views.py konto()`): dadurch blendet `base.html`s `<nav>` die Marketing-Links (Features/Preise/FAQ) und die "Kostenlos testen"/"Anmelden"-CTAs aus (die Sidebar deckt Konto/Abmelden bereits ab) und `{% block body %}` wrappt den Seiteninhalt in `.app-shell-layout` (Sidebar + `.app-shell-main`). `accounts/auth_base.html` (Login/Register/Konto-löschen) überschreibt `{% block body %}` komplett und bleibt davon unberührt
- **Vorsicht bei `{% include %}`-Beispieltext in Kommentaren**: Django parst Template-Tags auch innerhalb von `<!-- -->`-HTML-Kommentaren — ein Kommentar, der zur Doku den eigenen Include-Tag als Beispiel ausschreibt, erzeugt eine echte Selbst-Inklusion (RecursionError). In `_app_sidebar.html` deshalb nur in Prosa beschrieben, nie als `{% ... %}`-Literal
- **`box-sizing`**: `styles.css` (app.html) setzt anders als `base.html` kein globales `*{box-sizing:border-box}` — `.app-side`/`.app-side-item` dort deshalb explizit mit `box-sizing:border-box`, sonst ragt z.B. der aktive Nav-Hintergrund über die Spalte hinaus
- **`.btn`-Höhe**: `base.html`s `.btn`-Klasse setzt `font-family`+`line-height` explizit — `<button class="btn">` (z.B. Abmelden) übernimmt beides sonst nicht wie `<a class="btn">` vom `body` und wird dadurch niedriger/höher als benachbarte Link-Buttons
- **Konto-Status während der Beta**: Badge/„Jahreslizenz"-Karte zeigen bei `beta_mode` (Konto-View bekommt `beta_mode` automatisch über den globalen Context-Prozessor) einen neutralen „Beta-Phase — kostenlos & unbeschränkt"-Hinweis statt Preis/„Abgelaufen" — `_read_only()` greift während der Beta nie, ein Trial-Countdown oder „Abgelaufen"-Badge wäre daher irreführend. `sub.is_paid` hat weiterhin Vorrang (zeigt echten Lizenzstatus, auch in der Beta)

### Django Settings (config/settings.py)
- `SECRET_KEY`: reads from env var `DJANGO_SECRET_KEY` (falls back to insecure dev key)
- `DEBUG`: reads from env var `DJANGO_DEBUG` (default `True`)
- `ALLOWED_HOSTS`: reads from env var `DJANGO_ALLOWED_HOSTS`
- `SECURE_PROXY_SSL_HEADER` + `CSRF_TRUSTED_ORIGINS`: HTTPS/CSRF behind the nginx proxy (planli.net)
- `BETA_MODE`: beta switch, default True; env var `BETA_MODE=False` enables the login requirement
- `PROJECTS_DIR`: `BASE_DIR / 'projects'` — `BUG_REPORTS_DIR`: `BASE_DIR / 'bug_reports'` — `TRAINING_DATA_DIR`: `BASE_DIR / 'training_data_opt-in'` (all gitignored)
- `PROJECT_RETENTION_DAYS`: default 14 (env-overridable); how long `projects/<uuid>/` is kept before the cleanup command deletes it
- `PDF_DPI = 150` (server always renders at 150 DPI — frontend has no DPI input, only a hidden field), `JPEG_QUALITY = 70`

### Project Data Format
Projects store JSON files containing:
- `metadata.json`: Project info and creation date
- `analysis/page_X_results.json`: Per-page detection results
- `analysis/analysis_settings.json`: Analysis parameters
- `analysis/labels.json`: Custom label definitions
- `pages/`: Original image files
- `original.pdf`: Original PDF file if applicable

### Data Retention & Opt-In Training Data (Datenschutz)
- `projects/<uuid>/` is **ephemeral working data** (uploaded PDF + rendered JPGs). The `cleanup_projects` management command (`core/management/commands/cleanup_projects.py`, `--days`/`--dry-run`) deletes dirs older than `PROJECT_RETENTION_DAYS` and sets `Project.files_deleted=True` (the DB row stays, so statistics remain intact). Run daily via server cron (see Deployment).
- Training data is **opt-in only**: a session-wide toggle in the app header menu (`#consentTrainingToggle`, default off, persisted in `localStorage['ai_training_consent']`) gates `sendTrainingData()` in `project.js`. Only with consent does an export POST the full project ZIP (multipart `project_zip`) to `save_training_data`, which stores it as `training_data_opt-in/<uuid>/project.zip`. `Project.consent_training` records the choice.
- The stored ZIP is **identical to the "Speichern" export** (`buildProjectZipBlob`) → self-contained and directly re-loadable in the app via "Öffnen" for quality review. `training_data_opt-in/` is never touched by the cleanup.

## Deployment (planli.net)

Production runs on a Debian server (Hetzner) at `/opt/Planvision`: gunicorn (systemd service `planvision`, `--timeout 300`) behind nginx with Let's Encrypt. nginx proxies **everything** to Django — the landing page is a Django template, never serve it as a static file. Only `/static/` is an nginx alias to `staticfiles/`; do **not** alias `/project_files/` (it would bypass the ownership check in `serve_project_file`).

After every `git pull` on the server:
1. `env/bin/python manage.py migrate`
2. `env/bin/python manage.py collectstatic --noinput` — otherwise nginx keeps serving the old JS bundle (symptom: CSRF 403 on POSTs)
3. `sudo systemctl restart planvision`

One-time setup — data-retention cron (deletes `projects/` older than 14 days):
```
0 3 * * * cd /opt/Planvision && env/bin/python manage.py cleanup_projects >> /var/log/planvision_cleanup.log 2>&1
```

## Common Development Tasks

When adding new object detection classes, update:
1. Model training pipeline and class count in `model_handler.py`
2. Label definitions in `static/js/labels.js`
3. Color mappings and UI elements in HTML template

When modifying the annotation editor:
1. All canvas interactions live in `main.js` (setupCanvasEvents, drawing functions, vertex editing)
2. Mind Fabric's object cache: direct mutation of e.g. `points` requires `obj.dirty = true`
3. Test zoom synchronization between image and canvas

When changing PDF processing:
1. Update `core/views.py` route handlers for new parameters
2. Ensure `pdf-handler.js` manages navigation state correctly
3. PDF export is fully frontend-based via `static/js/pdf-export-client.js` (pdf-lib) — no backend involved

## ZIP Format Versioning

The ZIP save/load system in `static/js/project-zip.js` uses a numeric `format_version` in `metadata.json` to ensure old ZIP files always load correctly.

**Current version: 1**

Version history:
- **v1** – base format: `canvas_data.json` (multi-page annotations incl. canvas_text_labels and id/labelText, plus per-page `canvas_dimensions` and `canvas_text_notes`), `labels.json`, `settings.json`, `pages/`, optional `original.pdf`, and per-page `legend_position`

(History was reset to a clean v1 before the live launch — there were no real project files in circulation yet, so no legacy migration is needed. `canvas_dimensions` (dimension helper lines) and `canvas_text_notes` (text fields) were folded into the base v1 format.)

Project files are saved with the `.planli` extension (internally a ZIP); "Projekt öffnen" still accepts older `.plan`/`.zip` test files.

### When changing the ZIP schema:

1. Increment `CURRENT_VERSION` in `project-zip.js`
2. Add a migration block in `migrateCanvasData()`:
   ```js
   if (fromVersion < N) {
     // transform data from v(N-1) to vN
   }
   ```
3. Update the version history comment in `project-zip.js` and here

Migration functions are applied sequentially — a v1 ZIP automatically runs through all steps up to the current version.
