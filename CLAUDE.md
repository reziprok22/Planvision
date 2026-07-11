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

### Authentication
- Django's built-in `django.contrib.auth` handles users, sessions, and password hashing
- **E-Mail + password only** (no visible username): registration/login use the email as the internal `username` (lowercased) via `EmailUserCreationForm`/`EmailAuthenticationForm` in `accounts/forms.py` — no custom user model
- Login: `/accounts/login/` — Logout: `/accounts/logout/` (POST) — Register: `/accounts/register/`
- Password reset: `/accounts/password-reset/` (full Django flow; templates in `templates/accounts/`, mail via `EMAIL_*` settings — console backend in dev, SMTP via `DJANGO_EMAIL_*` env vars in prod)
- Auth pages share a card layout: `templates/accounts/auth_base.html`
- Logged-in users see their email + "Abmelden" (POST form) in the app header burger menu; the landing nav shows "Anmelden" when logged out (non-beta)
- Admin panel available at `/admin/` (requires superuser) — includes the bug report list
- All API endpoints are CSRF-protected; the frontend sends `X-CSRFToken` from the cookie (set via `@ensure_csrf_cookie` on the app view)
- `BETA_MODE` (settings, env-overridable, default **True**): when True, all endpoints work without login, projects are stored with `user=NULL` (access guarded only by the unguessable session UUID), and the "Beta" badge shows next to the app logo. The whole login flow is built and dormant behind this switch; test locally via `BETA_MODE=False python manage.py runserver`. Exposed to all templates via the `beta_mode` context processor

### Trial & Lizenz (Subscription)
- `accounts/models.py`: `Subscription` (OneToOne zu User, `trial_ends`, `paid_until`). Trial startet bei der Registrierung (`TRIAL_DAYS = 30`); Alt-User ohne Subscription bekommen sie lazy via `subscription_for()` (Trial ab `date_joined`)
- Zahlung läuft (vorerst) **manuell ohne Stripe**: Konto-Seite `/accounts/konto/` zeigt Status/Preis (`LICENSE_PRICE_CHF = 240`) mit "Rechnung anfordern"-Mailto; nach Zahlungseingang Admin-Action "Um 1 Jahr verlängern" (setzt `paid_until`). Ein späterer Stripe-Webhook würde nur dasselbe Feld setzen
- **Abgelaufen ⇒ Read-Only**: Ansehen, Projekte öffnen und PDF-Export bleiben erlaubt; gesperrt sind KI-Analyse (serverseitig: `analyze_page` → 403 via `_read_only()` in `core/views.py`) sowie Zeichnen/Bearbeiten (frontend: `window.PLANLI_READ_ONLY` → `main.js` erzwingt Select-Tool und `canvas.skipTargetFind`, CSS `body.read-only` graut die Buttons aus, Banner unter dem Header)
- Im BETA_MODE komplett inaktiv (kein Gate, kein Banner)

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
