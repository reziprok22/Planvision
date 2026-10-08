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
- User authentication (login/register/logout) via Django's built-in auth system; anonymous access can be re-enabled via `BETA_MODE` (default off), pricing/read-only enforcement is separately controlled by `BETA_PRICING` (default on = free)

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
- **hit-testing.js**: Geometrische Trefferprüfung, Vorrang, Durchklicken und Hover-Schimmer für Annotationen (siehe „Annotation System")
- **labels.js**: Label management (Label-Manager modal, colors/opacity/stroke, tool dropdowns)
- **pdf-handler.js**: Session and page state (session id, page URLs, per-page settings, original PDF blob)
- **upload-modal.js**: Left sidebar — drop zone, upload, page list with per-page scale
  - **Annotations-Zähler pro Seite** (`.page-count-pill`, bei 0 ausgeblendet): Quelle ist `getPageAnnotationCount()` in main.js — für die offene Seite live vom Canvas, sonst `pageCanvasData[id].canvas_annotations`; per `setPageCountProvider` an `buildPageList()` gereicht. Live nachgezogen in `updateSummary()` (läuft nach jeder Annotations-Änderung) und in `markCanvasLoaded()`, weil ein `updateSummary()` während des asynchronen Ladens (`canvasReady=false`) übersprungen wird
  - **Seitennamen**: Doppelklick auf den Seitentitel → Inline-Feld (`startPageRename`), leer = zurück auf „Seite N“. Gespeichert als optionales `name` im `page_manifest`-Eintrag (kein Versionssprung, alte Dateien haben das Feld einfach nicht), Duplizieren nummeriert hoch („Grundriss (1)“, „(2)“ … — nächste freie Nummer über alle Seiten, `nextCopyName`), der PDF-Bericht zeigt ihn im Seitenkopf. `buildPageList()` trägt nach jedem Neuaufbau die gespeicherten Massstäbe wieder in die Dropdowns ein (vorher zeigten nach Umsortieren alle anderen Seiten 1:100)
  - **Seiten-Vorschaubilder werden verkleinert erzeugt, nie das Seitenrender direkt anzeigen**: Die Liste zeigt 28×36 px (`.page-thumb` in app.html), das Render hat 150 DPI. Als `<img src>` hiess das, eine A1-Seite als 3508×4967-Bitmap zu dekodieren — **69.7 MB für 1008 sichtbare Pixel**, bei 10 Seiten ~700 MB. Unter dem Druck verwirft der Browser die dekodierten Bitmaps wieder und muss sie beim nächsten Neuzeichnen des Eintrags neu dekodieren; schon `.page-list-item:hover { background }` genügt als Auslöser, was sich als **1–2 s Verzögerung beim Drüberfahren** zeigte. `getThumbUrl()` erzeugt deshalb einmalig per `createImageBitmap(blob, {resizeWidth: 256, resizeQuality})` ein kleines JPEG (~0.37 MB dekodiert statt 69.7 MB) — der Cache hängt an der **Bild-URL**, nicht an der Seiten-ID (duplizierte Seiten teilen sich das Thumbnail, und `buildPageList()` wirft die Liste bei jeder Seiten-Aktion komplett weg). `clearThumbCache()` gibt die Objekt-URLs beim Projektwechsel/Reset frei. Der IntersectionObserver bleibt davor: er lädt das Seitenbild erst, wenn der Eintrag wirklich sichtbar wird
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
- **Rendern immer direkt auf die Platte** (`_convert_pdf_to_images` in `core/views.py`): `convert_from_path(..., fmt='jpeg', jpegopt={...}, output_folder=<tmp in uploads/>, paths_only=True)` — pdftoppm schreibt jede Seite selbst als JPEG und gibt sie sofort frei, danach `shutil.move` (gleiches Dateisystem ⇒ reines rename) auf `page_<source>_<i>.jpg`. **Nie wieder `convert_from_path()` ohne `output_folder`**: dann schiebt poppler die rohen Bitmaps ALLER Seiten durch stdout, pdf2image puffert sie komplett im RAM und parst sie zusätzlich zu PIL-Bildern — Peak ≈ 2× (Seitenzahl × Seitenfläche). Das hat den 4-GB-Server am 24.7. und 30.7.2026 reproduzierbar per OOM-Killer zerlegt (2.9–3.4 GB in einem Worker, nginx meldete dann `upstream prematurely closed connection`, das Frontend nur „Upload fehlgeschlagen"). Gemessen an 8× A1 @150 DPI: Peak-RSS 1216 MB → 17 MB, bei identischem JPEG-Ergebnis und schneller (kein Re-Encode in Python)
- **`MAX_PAGE_MEGAPIXELS = 80`** (`core/views.py`): Deckel **pro Seite**, nicht pro Dokument — seit dem Streaming-Umbau ist der Peak eine Seite, die Seitenzahl ist egal. 80 MP ≈ doppelte A0-Fläche bei 150 DPI (A0 = 34.9 MP ≈ 105 MB RGB in poppler). Geprüft wird vor dem Rendern anhand der PyPDF2-Mediaboxen; Verstoss ⇒ `PdfTooLargeError` ⇒ **400 mit Klartext** (die generische 500 „Error converting PDF" wäre für den Nutzer nutzlos). Tests: `core.tests.PdfRenderTests` (Reihenfolge ab 10 Seiten wegen poppler-Nullauffüllung, Append-Trennung, Guard)

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
- **Trefferprüfung für Annotationen** (`static/js/hit-testing.js`, montiert in `initCanvas`): Fabric trifft nur über das Bounding-Rechteck und nimmt das oberste Objekt — die leere Ecke eines L-Polygons war klickbar, dünne Linien über Flächen kaum. `installSmartHitTesting()` ersetzt deshalb `canvas._searchPossibleTargets` (nur im Auswahl-Werkzeug ohne laufende Bearbeitung): Polygon = Punkt-im-Polygon, Linie = Abstand zum Segment, Toleranz 6 **Bildschirm**-px (also `/ zoom`). Vorrang statt Z-Reihenfolge: Linie → Umriss einer Fläche → Flächen-Inneres, innerhalb der Stufe die kleinste Fläche. Das gilt auch gegen das aktive Objekt — Fabrics `findTarget` bestätigt sonst ein ausgewähltes grosses Polygon bei jedem Klick in sein Rechteck. Nicht-Annotationen (Griffe, Bemassung, Textfeld, Legende, Mehrfachauswahl) behalten Fabrics Verhalten, sofern sie über der getroffenen Annotation liegen. Dazu: **Durchklicken** (erneuter Klick an derselben Stelle ≥ 400 ms nach dem letzten → nächstes Objekt darunter; schneller ist ein Doppelklick und wechselt nie, sonst landete der Eckpunkt-Modus auf dem falschen Objekt) und ein **Hover-Schimmer** (in `after:render` gezeichnet, verändert das Objekt nicht → landet nie in Undo/Speichern). Der angezeigte Auswahlrahmen bleibt bewusst rechteckig. `perPixelTargetFind` bleibt aus (rendert pro mouse:move jedes Objekt auf einen Hilfs-Canvas)
- **Polygon/Linie am Startpunkt schliessen** (`main.js`, `isDrawCloseTarget`/`drawCloseRing`): ab drei Punkten zeigt der Startpunkt einen Ring; innerhalb `CLOSE_SNAP_PX` (10 **Bildschirm**-px) rastet die Vorschau dort ein, der Ring wächst (120 ms), der Distanz-Tooltip zeigt „Schliessen · X m²“ und ein Klick schliesst — ohne den Extrapunkt, den der Doppelklick-Pfad wegpoppt (`finishPolygonDrawing({ fromDblClick: false })`). Klicks < 400 ms danach werden ignoriert, sonst startete der 2. Klick eines Doppelklicks auf den Startpunkt ein neues Polygon. Ring in `after:render`, wie der Hover-Schimmer nie Teil des Objekts. Doppelklick bleibt als Alternative
  - **Geschlossene Linie (Umfang)** = Polyline, deren letzter Punkt eine exakte Kopie des ersten ist (`isClosedLine`) — kein Format-Feld, Speichern/Export/Länge funktionieren unverändert, Tooltip zeigt „Schliessen · Umfang X m“. Bleibt eine Linie (Trefferprüfung nur auf dem Strich, kein Inneres). `Polyline.prototype.isOpen` liefert dafür `false` (saubere Ecke via closePath), Endpunkt-Punkte entfallen. Eckpunkt-Modus: der letzte Punkt hat keinen eigenen Griff und folgt Griff 0 (`object:moving` kopiert ihn exakt nach, sonst öffnet Rundung die Schleife); Startpunkt löschen schliesst am neuen Start, Minimum 4 Punkte
- **Auto font scale**: all on-canvas text sizes (annotation labels, legend, dimension text, text-note start size) are A4-tuned base values multiplied by `autoFontScale(imgW, imgH)` (`pdf-handler.js`): `clamp((shortSide / 1240)^0.6, 1, 5)` — page-size-based because the server always renders at 150 DPI, damped since large plans tend to have finer detail (A4 = 1×, A3 ≈ 1.2×, A0 ≈ 2.3×). Computed per page; the PDF export applies the same factor so canvas and export match. No user setting by design.
- **Mipmap-Downsampling des Plan-Hintergrunds** (`main.js`): Beim Rauszoomen skaliert der Browser das 150-DPI-Bitmap über `drawImage` herunter — mit `imageSmoothingQuality:'high'` (in `applyImageSmoothingQuality()`, nach jedem `setWidth/setHeight` neu gesetzt, weil die width/height-Zuweisung den 2D-Kontext-State resettet) rettet das in Chrome dünne Linien, Firefox ignoriert die Quality aber. Deshalb baut `buildMipmaps()` pro Seite eine eigene Bildpyramide durch wiederholtes Halbieren; jede Stufe entsteht per `halveDarkest()` — einer Mischung aus 2×2-Mittelwert und **dunkelstem Pixel** (`MIP_DARKEN_STRENGTH = 0.3`, in Chrome+Firefox kalibriert), damit dünne dunkle Linien satt statt grau bleiben statt zu verschwinden/verwässern. `updateBackgroundMip(zoom)` tauscht an den beiden Zoom-Einstiegen (Mausrad + `fitToViewport`) die kleinste Stufe ≥ Anzeigegrösse als `canvas.backgroundImage`-Element ein und kompensiert per `scaleX/scaleY` auf Natural-Koordinaten → Annotationen bleiben deckungsgleich, der Browser skaliert nur noch ~≤2×, in JEDEM Browser gleich. Fällt bei `getImageData`-Fehler (CORS-taint/Canvas-Limit) sauber auf den browser-nativen `'high'`-Pfad zurück; kleine Pläne (kürzeste Seite ≤ 256px) bekommen gar keine Mipmap. **Betrifft nur die Bildschirmdarstellung**: PDF-Export bettet Original-PDF/Server-JPG ein, ZIP speichert `pages/` — beide nutzen nie den Canvas-Hintergrund. Offen: `getImageData` + JS-Min-Filter laufen synchron beim Seiten-Laden — bei sehr grossen Plänen (A0) ggf. in einen Web-Worker/async verlagern.
- **beforeunload-Warnung via Dirty-Tracking**: `projectDirty` (main.js) — gesetzt an den Content-Änderungs-Trichtern (`saveHistorySnapshot(seed=false)`, Undo/Redo, Massstab-Änderung, Seiten-Aktionen, `onPagesAppended`, Label-Manager via `window.planliMarkProjectDirty`), gelöscht nach erfolgreichem Speichern (Cloud **und** .planli-Download) und Projekt-Load (`window.planliMarkProjectSaved` aus project.js) sowie bei frischem Upload/Editor-Reset. Wichtig: Basis-Snapshots nach Seitenwechsel/`loadCanvasData` laufen mit `saveHistorySnapshot(true)` (Seed — kein Nutzereingriff, darf nicht dirty setzen). Nur Ansehen (z.B. Demo) warnt so nie beim Schliessen. Getter: `window.planliProjectIsDirty()`. **Speichern-Button zeigt den Zustand**: `projectDirty` nur über `setProjectDirty()` setzen, das ruft `updateSaveButtonState()` — ausgegraut (`.is-saved`, wie der Mülleimer ohne Auswahl) wenn alles gespeichert ist, dunkel bei Änderungen; bleibt aber klickbar. Ein frischer PDF-Upload ist nicht dirty (keine beforeunload-Warnung, es geht nichts verloren), aber auch nicht gespeichert: dafür `projectNeverSaved`, das nur den Button dunkel hält. **beforeunload greift nicht, wenn nur der Editor-Inhalt ausgetauscht wird** (Seite bleibt geladen): Cloud-Projekt öffnen, .planli importieren und „+ Neu“/„+ Neues Projekt“ fragen deshalb vorher über `confirmDiscardChanges()` (`upload-modal.js`) nach. Beim Import erst nach der Dateiwahl, weil ein `confirm()` vor `zipFileInput.click()` die Nutzer-Aktivierung kosten kann, die der Datei-Dialog braucht.

### Demo-Modus (Landingpage → App)
- Hero-Button „Demo ansehen" (Plausible-Event `CTA: Demo Hero`) verlinkt auf `/app?demo=1`
- `maybeLoadDemoProject()` (project.js, aufgerufen am Ende von `initApp` in main.js — braucht die window-Hooks) lädt `static/demo/demo.planli` (URL via `window.PLANLI_DEMO_URL` aus app.html) über den normalen `handleLoad`-Pfad: fertig analysiertes Projekt, keine KI-Analyse, keine Serverlast. Fehlt die Datei → Fehler-Toast + leerer Editor
- Die Demo-Datei ist ein normales `.planli`-Export-ZIP, eingecheckt als `static/demo/demo.planli` (siehe README dort); klein halten (1–2 Seiten, < ~3 MB)
- Auch ohne Login zugänglich (unabhängig von `BETA_MODE`): die `app`-View lässt `?demo=1` anonym durch (nur App-Shell; alle API-Endpoints bleiben login-geschützt)
- Das Erstbesuch-Onboarding-Modal wird im Demo-Modus unterdrückt (onboarding.js, Seen-Flag bleibt ungesetzt)

### Authentication
- Django's built-in `django.contrib.auth` handles users, sessions, and password hashing
- **E-Mail + password only** (no visible username): registration/login use the email as the internal `username` (lowercased) via `EmailUserCreationForm`/`EmailAuthenticationForm` in `accounts/forms.py` — no custom user model
- Login: `/accounts/login/` — Logout: `/accounts/logout/` (POST) — Register: `/accounts/register/`
- **`AUTHENTICATION_BACKENDS = ['accounts.backends.InactiveAwareModelBackend']`**: Ein `is_active=False`-Konto muss `authenticate()` passieren, damit `EmailAuthenticationForm.confirm_login_allowed()` erklären kann, *warum* der Login scheitert (unbestätigt vs. gesperrt) — sonst bliebe nur Djangos generische Meldung. Dafür stand hier bis 20.8.2026 Djangos `AllowAllUsersModelBackend`; das hebt die Prüfung über `user_can_authenticate()` auf, **und dieselbe Methode benutzt `ModelBackend.get_user()`**, die bei jedem Request die Session auflöst. Ein im Admin deaktiviertes Konto behielt damit seine laufende Session samt vollem Zugriff auf App und Cloud-Endpoints bis zum Cookie-Ablauf (Default zwei Wochen) — `is_active` ist aber der einzige Sperrhebel des Admins und muss sofort greifen. Das eigene Backend trennt beides: `user_can_authenticate() -> True` (nur für den Login), `get_user()` streng. Regressionstest: `LoginTests.test_deactivating_an_account_ends_its_running_session`
- **Die Login-Meldung unterscheidet unbestätigt und gesperrt** (`_never_confirmed()` in `accounts/forms.py`): `is_active=False` heisst zweierlei. Kriterium ist `Subscription.email_verified_at` (das Feld existiert genau dafür, weil `is_active` auch von Hand gesetzt wird), plus `last_login` als Fallback für Konten aus der Zeit davor — dieselbe Prüfung wie in `EmailUserCreationForm.clean_email`. Vorher bekam auch ein im Admin gesperrtes Konto den Hinweis auf den Bestätigungslink und wartete auf eine Mail, die nie kommt
- **Das Login-Template rendert die Feld-Fehler von Hand**: Die Inputs in `templates/accounts/login.html` stehen wegen des Layouts einzeln da statt als `{{ form }}`. Ein leeres Formular erzeugt aber nur **Feld**-Fehler, keine `non_field_errors` — ohne `{% if form.username.errors %}`-Blöcke lud die Seite kommentarlos neu und der Nutzer sah gar keinen Hinweis. Ebenso müssen `required` und `value="{{ form.username.value }}"` von Hand mit (sonst Adresse nach jedem Passwort-Tippfehler neu eintippen)
- Password reset: `/accounts/password-reset/` (full Django flow; templates in `templates/accounts/`, mail via `EMAIL_*` settings — console backend in dev, SMTP via `DJANGO_EMAIL_*` env vars in prod). **`EmailPasswordResetForm` schickt unbestätigten Konten einen neuen Bestätigungslink** statt gar nichts: Djangos `PasswordResetForm.get_users()` filtert auf `is_active=True`, wer den Bestätigungslink nie angeklickt hat bekam also **null Mails** bei einer Seite, die einen versendeten Link verspricht — Login gesperrt, Reset stumm, und dass eine erneute Registrierung der Ausweg ist, stand nur auf Seiten, auf denen dieser Nutzer längst nicht mehr landet. Ein **gesperrtes** Konto bekommt weiterhin nichts (sonst holte es sich per Reset einen Aktivierungslink), Kriterium ist dasselbe `_never_confirmed()`. Nach aussen bleibt die Antwort unverändert generisch (keine Auskunft, ob eine Adresse registriert ist); `password_reset_done.html` erklärt den Fall. Der Verifikations-Mailversand liegt deshalb in `accounts/emails.py` — in `views.py` gäbe er mit `forms.py` einen Zirkelimport
- Konto löschen: `/accounts/konto/loeschen/` (Link auf der Konto-Seite) — **sofortige harte Löschung** (DSGVO Art. 17) nach Passwort-Bestätigung: DB via CASCADE, die Dateien (`cloud_projects/<uuid>.planli`, `projects/<uuid>/`) über **`post_delete`-Signale in `core/models.py`** (BugReport/AnalysisEvent bleiben per SET_NULL anonymisiert), danach Bestätigungs-Mail (best-effort). `training_data_opt-in/` bleibt bewusst unangetastet — laut Datenschutzerklärung sind freigegebene Exporte bereits anonymisiert/nicht ans Konto gekoppelt gespeichert, der CASCADE-Delete der `Project`-Zeile kappt die letzte Verknüpfung zum User. Die Signale liegen bewusst am Modell statt im View: Zeilen verschwinden auf mehreren Wegen, und bis 20.8.2026 räumte **nur** die Selbstlöschung auf — eine Löschung im `/vitruv/`-Admin liess die Dateien für immer liegen (der `cleanup_projects`-Cron fasst `cloud_projects/` nie an). Voraussetzung, auf die dabei Verlass ist: Django nimmt seinen Fast-Delete-Pfad (Bulk-DELETE ohne Signale) nur, solange für das Modell kein `post_delete`-Empfänger registriert ist. Tests: `core.tests.ProjectFileCleanupTests`. Superuser/Staff sind von der Web-UI-Löschung ausgenommen. Bewusst keine 30-Tage-Frist: ein Soft-Delete via `is_active` würde mit der E-Mail-Verifikation kollidieren
- Auth pages share a card layout: `templates/accounts/auth_base.html`
- Logged-in users see their email + "Abmelden" (POST form) in the app header burger menu; the landing nav shows "Anmelden" whenever `beta_mode` is off (now the default) and the user is logged out
- Admin panel available at `/vitruv/` (requires superuser; deliberately not the default `/admin/` to avoid bot scanners — never list this path in robots.txt or public pages) — includes the bug report list
- All API endpoints are CSRF-protected; the frontend sends `X-CSRFToken` from the cookie (set via `@ensure_csrf_cookie` on the app view)
- **`BETA_MODE`** (settings, env-overridable, **default False since 2026-07-21**): when True, all endpoints work without login, projects are stored with `user=NULL` (access guarded only by the unguessable session UUID). At default (False), `/app` requires login (`?demo=1` stays anonymous — see Demo-Modus above), the nav shows "Anmelden"/"Konto", and landing CTAs route through `register`. Exposed to all templates via the `beta_mode` context processor. Local anonymous-access testing: `BETA_MODE=True python manage.py runserver`
- **`BETA_PRICING`** (settings, env-overridable, **default True**): independent of `BETA_MODE` — controls only pricing/trial enforcement. When True, `_read_only()` (`core/views.py`) never triggers (no read-only lockout regardless of trial age), the JSON-LD offer says `price: 0` and `konto.html`/landing pricing section add the "Beta-Phase — kostenlos" note instead of "Rechnung anfordern". **Der Preis selbst bleibt sichtbar** (seit 14.8.2026) — Karte und Konto-Seite zeigen ihn mit dem Zusatz „nach der Beta-Phase", damit die künftigen Kosten früh bekannt sind; nur das JSON-LD nennt weiter 0, weil es beschreibt, was heute gilt. Exposed via the `pricing` context processor (liefert `beta_pricing` **und** `license_price_chf`). This is what lets login be mandatory (`BETA_MODE=False`) while the product stays fully free during the beta — the two flags used to be one (`BETA_MODE`), split so registered users can use Online-Ablage without triggering the paywall

### Trial & Lizenz (Subscription)
- `accounts/models.py`: `Subscription` (OneToOne zu User, `trial_ends`, `paid_until`). Trial startet bei der Registrierung (`TRIAL_DAYS = 30`); Alt-User ohne Subscription bekommen sie lazy via `subscription_for()` (Trial ab `date_joined`)
- Zahlung läuft **ohne Stripe** über QR-Rechnungen (siehe eigener Abschnitt unten): Die Lizenz wird beim Ausstellen der Rechnung freigeschaltet, der Zahlungseingang wird im Admin nur bestätigt. Ein späterer Stripe-Webhook würde dieselben Felder setzen
- **Preislogik liegt in `accounts/pricing.py`** (seit 14.8.2026), nicht verstreut in Templates/Views: Listenpreis (`LICENSE_PRICE_CHF`, settings), globale Preisaktion und die Rundung an einem Ort; `Subscription` und der Context-Processor `pricing` (core) greifen darauf zu. Im Template steht nie ein Betrag
- **Globaler Aktionsrabatt** (`GLOBAL_DISCOUNT_PERCENT` / `_REASON` / `_UNTIL` in settings, Default 0 = aus): gilt für alle. Die Landingpage-Karte zeigt dann den Listenpreis **durchgestrichen** (`.plan-price-was`), darunter den Aktionspreis, ein `−X %`-Badge (recycelt `.popular-badge`) und die Begründung + optionales „gültig bis"; Konto-Seite, Rechnungs-Mailto und JSON-LD (ausserhalb der Beta) ziehen mit. Template-Variablen: `license_price_chf` (Liste), `license_price_now` (nach Aktion), `global_discount` (falsy = keine Aktion). `GLOBAL_DISCOUNT_UNTIL` ist optional `'YYYY-MM-DD'`; **ein unlesbares Datum gilt als unbefristet statt als Fehler** — ein Tippfehler in der Preisaktion darf die Landingpage nicht mit einem 500er abschiessen
- **Persönlich und global stapeln nie**: `Subscription.effective_discount` nimmt den **höheren** der beiden (50 % persönlich schlägt 20 % Aktion; 10 % persönlich verliert gegen 20 % Aktion). Gestapelt ergäben zwei 50 %-Rabatte 75 % — ein Preis, den niemand versprochen hat
- **Die globale Aktion allein ist NICHT lifetime, auch nicht für die, die während ihrer Laufzeit gekauft haben** (seit 12.9.2026, Beispiel "Einführungsrabatt für die ersten 50 Lizenzen"): `effective_discount` fragt `global_discount()` bei **jeder** Rechnung live ab, auch bei Verlängerungen — es gibt keinen Zeitpunkt, an dem der Rabatt für ein bestimmtes Konto "eingefroren" wird. Schaltest du `GLOBAL_DISCOUNT_PERCENT` nach der 50. Lizenz aus, zahlen auch die ersten 50 ab ihrer **nächsten Verlängerung** wieder den vollen Preis — das globale Flag merkt sich niemanden, es ist reine Point-in-Time-Logik. Ein Versprechen wie "dauerhaft für dich reserviert" braucht deshalb zusätzlich einen **persönlichen** Rabatt (`discount_scope='lifetime'`) auf genau diesem Konto — der übersteht das Abschalten der globalen Aktion, weil `effective_discount` dann auf den persönlichen zurückfällt. Praktisch heisst das: bei jeder Rechnung, die während der Kampagne bezahlt wird, sofort (nicht erst rückwirkend beim Erreichen der Marke von 50 — dann ist unklar, wer schon vorher bezahlt hat) über die Admin-Action "Rabatt setzen" den persönlichen Rabatt mit demselben Prozentsatz und `scope=lifetime` auf die Subscription eintragen. Zur Erinnerung an genau diesen Schritt steht ein Verweis hierher im Settings-Kommentar bei `GLOBAL_DISCOUNT_PERCENT`
- **Preis pro Konto** (`Subscription.list_price_chf` / `.discount_percent` / `.discount_scope` / `.discount_reason` / `.discount_used_at`):
  - `list_price_chf` ist **nullable = "aktueller Listenpreis"** und gilt so für alle, die noch nie bezahlt haben. **Preisgarantie**: `activate_licence()` (beim Ausstellen der Rechnung) schreibt über `pin_list_price()` den zum Rechnungszeitpunkt gültigen Listenpreis fest (nur wenn noch leer — eine Folge-Verlängerung überschreibt ihn nie). Eine spätere Erhöhung von `LICENSE_PRICE_CHF` trifft dadurch **nur neue Kunden**; Bestandskunden zieht man bewusst nach, indem man das Feld im Admin leert. Fixiert wird der **Listenpreis, nicht der Aktionspreis** — ein globaler Aktionsrabatt ist befristet und soll nicht über die Rechnung dauerhaft werden (wer den behalten soll, bekommt einen persönlichen `lifetime`-Rabatt)
  - Der Rabatt ist **prozentual**, damit er eine Preisänderung überlebt; `price_chf` rundet kaufmännisch über `Decimal`/`ROUND_HALF_UP` (`round()` würde bei .5 abwärts runden)
  - `discount_scope`: `once` = nur die nächste Jahreslizenz, `lifetime` = jede Verlängerung (**kontogebunden, nicht abogebunden**: eine Lücke im Abo hat keine Wirkung, `paid_until` kommt in der Rabattlogik nicht vor). Verbraucht wird ein `once`-Rabatt genau dort, wo die Lizenz vergeben wird — `activate_licence()` beim Ausstellen der Rechnung ruft `consume_discount()` (setzt `discount_used_at`); danach ist `discount_active` False. **Verbraucht wird aber nur, was auch gerechnet wurde**: `consume_discount()` prüft, ob `effective_discount` überhaupt der persönliche Rabatt ist (seit 18.8.2026). Gewinnt die globale Aktion (10 % persönlich gegen 20 % Aktion), steht der persönliche gar nicht auf der Rechnung und bleibt liegen — sonst wäre er nach Aktionsende verfallen, ohne je gewirkt zu haben. Bei Gleichstand gewinnt der persönliche und gilt damit auch als eingelöst. Die frühere Subscription-Admin-Action "Um 1 Jahr verlängern" wurde am 18.8.2026 entfernt: seit der Sofort-Freischaltung hätte sie beim Verbuchen einer Zahlung ein **zweites** Jahr gutgeschrieben und den Storno-Anker (`paid_until == period_end`) zerstört — verlängert wird nur noch über Rechnungen. **Achtung**: Wer `paid_until` von Hand im Admin-Formular ändert, umgeht Rabatt-Verbrauch und Preisfixierung. Wer den Rabatt neu vergibt (Admin-Action "Rabatt setzen", Zwischenformular in `templates/admin/accounts/set_discount.html`), setzt `discount_used_at` wieder auf leer — seit 18.8.2026 tut das auch eine Änderung von `discount_percent`/`discount_scope` im Änderungsformular, über `SubscriptionAdmin.save_model()`: sonst bewirkt ein neuer Prozentwert bei einem Konto mit eingelöstem Einmal-Rabatt schlicht nichts, weil `personal_discount` wegen `discount_used_at` leer bleibt. Wer `discount_used_at` im selben Schritt selbst anfasst, behält die Kontrolle. **Der Rabatt ist bewusst nicht mehr `list_editable`** (nur `max_projects` ist es, seit 18.8.2026): `discount_reason` passt nicht in die Liste, landet über `Discount.invoice_label` aber eingefroren auf dem Rechnungs-PDF — inline entstünde "50 % Rabatt" ohne Begründung auf dem Beleg. Die Action fragt Prozent, Laufzeit und Grund zusammen ab. (Historie: die Rabattspalten wurden in `20e95d9` beiläufig an die für `max_projects` bestehende `list_editable` gehängt, nie bewusst als zweiter Vergabeweg gedacht.) **Persönlicher Rabatt ≠ Preisaktion**: Nur die globale Aktion steht in den Settings, ein Rabatt für ein einzelnes Konto existiert ausschliesslich in der DB und wird ausschliesslich im Admin vergeben
  - Anzeige: Konto-Seite zeigt durchgestrichenen Basispreis + `discount_label` (egal ob persönlich oder Aktion); im Admin steht der effektive Preis in der Liste. Tests: `accounts.tests.PriceAndDiscountTests` / `.GlobalDiscountTests`, `core.tests.LandingPricingTests`
  - **Preistests immer mit `GLOBAL_DISCOUNT_PERCENT=0` pinnen**, wenn sie einen exakten Betrag prüfen — sonst kippt sie jede spätere Preisaktion in den Settings
- **Abgelaufen ⇒ Read-Only** (nur wenn `BETA_PRICING=False`; solange True — der aktuelle Beta-Default — greift das nie, siehe `_read_only()`): Ansehen, Projekte öffnen und PDF-Export bleiben erlaubt; gesperrt sind KI-Analyse (serverseitig: `analyze_page` → 403 via `_read_only()` in `core/views.py`) sowie Zeichnen/Bearbeiten (frontend: `window.PLANLI_READ_ONLY` → `main.js` erzwingt Select-Tool, `canvas.skipTargetFind`, zentrale Hotkey-Sperre im Keydown-Handler — erlaubt nur Ctrl+S/O, Escape, `?`; CSS `body.read-only` graut die Buttons aus, Banner unter dem Header)
- **Projektlimit** (`Subscription.max_projects`, Default `DEFAULT_MAX_PROJECTS = 50`, pro User im Admin änderbar z.B. 100/200; auf der Konto-Seite angezeigt): Anzahl online speicherbarer Projekte — durchgesetzt in `cloud_save` beim Anlegen (Überschreiben zählt nicht). Entschieden: Anzahl-Limit statt GB-Quote; dazu `MAX_PROJECT_MB = 200` als stiller Deckel pro Projekt und (noch offen) Archivierung nach 12 Monaten Inaktivität

### Rechnungen (QR-Rechnung, seit 14.8.2026)
- **Ablauf**: Konto-Seite → "Rechnung anfordern" → Adressformular (`BillingAddressForm`, vorbefüllt aus `Subscription.billing_*`) → `Invoice` wird angelegt, **die Lizenz sofort freigeschaltet**, PDF erzeugt und abgelegt, Mail mit PDF-Anhang an den Kunden + BCC an `INVOICE_BCC` → Rechnung erscheint auf der Konto-Seite. Zahlungseingang prüfst du im E-Banking (Rechnungsnummer steht als Mitteilung auf dem Zahlteil) und bestätigst ihn mit der Admin-Action **"Als bezahlt markieren"**
- **Adressformular validiert die QR-Norm-Grenzen** (seit 18.8.2026): Name/Firma max. **70 Zeichen** (qrbill wirft bei längeren `ValueError` — sonst entstünde eine Rechnung, deren PDF sich nie erzeugen lässt), Ländercode gegen **ISO 3166** (normalisiert auf Grossbuchstaben), PLZ **nur bei CH/LI** streng 4 Ziffern (Auslands-PLZ sind länger/alphanumerisch, z.B. `NL 1234 AB`). Auslandsadressen tragen in `Invoice.address_lines` den Ländercode vor der PLZ (`DE-10115 Berlin`), wie auf dem QR-Zahlteil
- **Anlegen + PDF laufen in einer Transaktion** (`rechnung_anfordern`): schlägt das Rendern fehl, rollt alles zurück (Freischaltung, Rabatt-Verbrauch, Nummer) und der Kunde sieht eine Fehlermeldung statt einer 500er — nie eine "Zombie-Rechnung" ohne erzeugbares PDF. Der "höchstens eine offene Rechnung"-Guard sitzt **zusätzlich in `create_invoice()`** (`OpenInvoiceError`), weil der View-Check ausserhalb der Transaktion läuft und ein Doppelklick ihn zweimal passiert; das Formular deaktiviert den Submit-Button zusätzlich per JS
- **Laufzeit = ein Kalenderjahr** (`one_year_later()`, nicht 365 Tage — Schaltjahre kosten sonst einen Tag), Anker = das späteste von heute / `paid_until` / **Trial-Ende**: Wer während der Testphase kauft, verliert die Resttage nicht (gilt auch für per Feedback-Dankeschön verlängerte Trials)
- **Freigeschaltet wird beim Ausstellen, nicht bei Zahlungseingang** (`activate_licence()`, seit 14.8.2026 — vorher umgekehrt): niemand soll auf den manuellen Zahlungsabgleich warten. Dort hängt alles dran, was zur Lizenzvergabe gehört: `paid_until = invoice.period_end`, Einmal-Rabatt verbraucht, Basispreis fixiert. Konsequenzen, die zusammengehören:
  - **"Als bezahlt markieren" verlängert nicht mehr** — es setzt nur `status`/`paid_at`. Es trägt die Lizenz nur nach, wenn `paid_until` fehlt oder vor `period_end` liegt (Altrechnungen, von Hand zurückgesetzte Konten), nie darüber hinaus: zweimal klicken kann keine zwei Jahre gutschreiben. Der Reparaturpfad ruft dafür `backfill_licence()` und **nicht** `activate_licence()` (seit 18.8.2026): Letzteres verbraucht auch den aktuellen Einmal-Rabatt und fixiert den heutigen Listenpreis — beides gehört zur Ausstellung *jener* Rechnung. Sonst wäre nach "storniert → Rabatt für die Ersatzrechnung neu vergeben → alte Rechnung versehentlich als bezahlt markiert" der neue Rabatt verbraucht
  - **"Stornieren" nimmt die Freischaltung zurück** — das ist der Hebel gegen Nichtzahler. Zurückgesetzt wird nur, wenn `paid_until` noch genau auf dieser Rechnung steht (eine neuere Laufzeit bleibt); zurückgeschrieben wird `Invoice.previous_paid_until` — der beim Ausstellen eingefrorene Vorzustand. **Vorher (bis 20.8.2026) wurde er aus `period_start` erraten** (`period_start > issued_on` ⇒ „schloss an eine laufende Lizenz an"): Das war falsch, sobald der Anker das **Trial-Ende** war (Kauf während der Testphase, Resttage gehen ja nicht verloren). Dann blieb nach dem Storno eine Lizenz bis zum Trial-Ende stehen, die es nie gab — grünes „Lizenz aktiv"-Badge, Verlängerungs-Erinnerung, und weil `can_request_invoice` bei laufender Lizenz erst im Verlängerungsfenster öffnet, war ausgerechnet dem Kunden, der wieder zahlen soll, der Kaufweg zu (bei 180-Tage-Trials aus dem Feedback-Dankeschön monatelang). Migration `0008` hat Altrechnungen mit der alten Heuristik befüllt, `None` heisst seither eindeutig „vorher keine Lizenz". Regressionstest: `InvoiceTests.test_cancelling_during_the_trial_leaves_no_licence`. Ein verbrauchter Einmal-Rabatt bleibt eingelöst — die Erfolgsmeldung der Action **warnt** dann namentlich ("Achtung, eingelöster Einmal-Rabatt bei: …"), damit er bei einer Ersatzrechnung nicht vergessen geht (Subscription-Admin, "Rabatt setzen")
  - **Storno erzeugt das PDF neu** (seit 18.8.2026): Der Kunde kann eine stornierte Rechnung auf der Konto-Seite weiter herunterladen (Beleg), das alte PDF forderte aber zum Zahlen auf und behauptete "Konto ist bereits freigeschaltet" — jemand hätte eine gegenstandslose Rechnung einzahlen können. Die Kennzeichnung hängt am **Status**, nicht am Zeitpunkt: `_text_page()` ersetzt bei `cancelled` die Zahlungs-Hinweise durch "bitte nicht bezahlen, der Zahlteil unten ist ungültig" und legt einen diagonalen, halbtransparenten **STORNIERT**-Stempel (`_cancelled_stamp()`, `setFillAlpha` — der Text darunter muss lesbar bleiben) darüber; auch eine spätere Regeneration ist damit gestempelt. Der QR-Zahlteil selbst bleibt unangetastet (ein halb übermalter QR-Code wäre schlechter als klarer Text). Scheitert das Neu-Rendern, warnt die Action namentlich statt zu scheitern
  - **"Zurück auf offen"** ist der Notausgang für den Fehlklick auf "Als bezahlt markieren": setzt nur `status`/`paid_at` zurück (nur auf bezahlte, nie auf stornierte Rechnungen); die Lizenz bleibt unberührt
  - Spalte **"Überfällig"** in der Rechnungsliste (Property `Invoice.is_overdue`): offen + Frist abgelaufen. Wichtiger als vorher, weil unbezahlte Rechnungen jetzt mit freigeschaltetem Konto mitlaufen. Auch der **Kunde** sieht auf der Konto-Seite ein rotes "überfällig seit …"-Badge
- **Logik in `accounts/invoices.py`**, Modell `Invoice` in `accounts/models.py`, Settings-Block `INVOICE_*` in `config/settings.py`
- **PDF-Pipeline**: `qrbill` → SVG → **cairosvg** → A4-Seite mit Zahlteil, dazu eine reportlab-Seite mit dem Rechnungstext, zusammengelegt per PyPDF2. Zwei Fallen, beide verifiziert:
  - **svglib funktioniert hier nicht** (wurde probiert): qrbill mischt mm-Koordinaten in einem px-`viewBox`, svglib verschiebt dadurch den Zahlteil und lässt den Betrag weg. Deshalb cairosvg — braucht auf dem Server `libcairo2`
  - **Reihenfolge beim Merge**: Der Zahlteil muss **unten** liegen, der Text darüber (`qr_page.merge_page(text_page)`). Die qrbill-SVG beginnt mit einem deckenden weissen Rechteck über die ganze Seite; andersherum ist der Rechnungstext unsichtbar
- **Alles Preisrelevante ist auf der Rechnung eingefroren** (Betrag, MWST, Basispreis, Rabatt-Text, Adresse, **seit 18.8.2026 der Zahlungsempfänger** — `creditor_iban`/`creditor`/`creditor_vat_uid` — und **seit 20.8.2026 der Lizenz-Vorzustand** `previous_paid_until` für den Storno) — nie aus Subscription/Settings nachladen. Eine PDF-Regeneration (Datei verloren) ergibt so auch nach einem Bankwechsel denselben Beleg; Settings-Fallback nur für Altrechnungen ohne die Felder. Der Rabatt-Text auf dem Beleg ist `Discount.invoice_label` (nur Prozent + Grund — "gültig bis"/"einmalig …" beziehen sich auf künftige Käufe und wären auf dem Beleg widersinnig). Eine verschickte Rechnung ist ein Beleg: korrigiert wird per Storno + neuer Rechnung, deshalb ist im Admin alles read-only und Löschen deaktiviert
- **MWST**: `INVOICE_VAT_RATE` (leer = kein Ausweis) und `LICENSE_PRICE_INCLUDES_VAT`. Default **brutto**, weil die Landingpage den Betrag ohne "zzgl." zeigt; beim Umstellen schreibt die Preiskarte automatisch "zzgl. MWST" (`price_vat_note` aus dem `pricing`-Context-Processor). Bei brutto ist das Total exakt der angezeigte Preis, netto/MWST werden herausgerechnet — sonst wichen Konto-Seite und Rechnung um Rappen ab
- **Beträge in Templates immer `|floatformat:"2u"`**: `LANGUAGE_CODE='de-ch'` rendert `Decimal` sonst als "200,00" statt "200.00"
- **Nummernkreis** `JJJJ-NNNN`, fortlaufend pro Jahr, vergeben in `transaction.atomic()` — SQLite läuft im IMMEDIATE-Modus, gleichzeitige Anfragen serialisieren also statt dieselbe Nummer zu ziehen; das Maximum wird **numerisch** ermittelt (String-Sortierung fände `9999` > `10000`)
- **Verlängerungs-Erinnerungen**: täglicher Cron `renewal_reminders` (`accounts/management/commands/`) mailt Kunden an den Stichtagen `RENEWAL_REMINDER_DAYS` (Default 30 und 7 Tage) vor Lizenzablauf einen "Rechnung anfordern"-Hinweis (übersprungen bei offener Rechnung/deaktiviertem Konto) und dem Betreiber (`INVOICE_BCC`) eine Meldung über Rechnungen, deren Frist **gestern** ablief. Deterministische Stichtage statt "schon erinnert"-Flags: der tägliche Lauf verschickt nie doppelt. Bei `BETA_PRICING=True` No-Op. Die Konto-Seite verspricht entsprechend "Wir erinnern dich rechtzeitig per E-Mail" (nicht "Rechnung folgt" — anfordern muss der Kunde selbst)
- **Verlängerungs-Fenster auf der Konto-Seite** (seit 18.8.2026): Die Erinnerungs-Mail schickt den Kunden auf `/accounts/konto/` — dort muss der Knopf dann auch da sein. Er steckte aber im `{% if not sub.is_paid %}`-Block und tauchte damit erst **nach** Ablauf der Lizenz auf, also frühestens im Read-Only. Jetzt hat die Konto-Seite für zahlende Kunden eine eigene **"Verlängerung"-Karte** (`{% if sub.is_paid and not beta_pricing %}`, die frühere dl-Zeile ist darin aufgegangen) mit drei Zuständen: offene Rechnung ⇒ deren Stand + Download (kein zweiter CTA, der ohnehin nur auf „bereits ausgestellt" liefe), im Fenster ⇒ aktiver Knopf, davor ⇒ **ausgegraut** (`.btn-disabled`, `<span>` ohne href) plus Datum „Verlängern kannst du ab …". Bewusst sichtbar statt versteckt: sonst sucht der Kunde die Funktion in der App. Der Stichtag ist `Subscription.renewal_opens_on` = `paid_until − max(RENEWAL_REMINDER_DAYS)`, also **derselbe Tag, an dem die erste Erinnerung rausgeht** — die beiden dürfen nie auseinanderlaufen. `Subscription.can_request_invoice` ist die Gate-Property (ohne laufende Lizenz immer True). **Die View `rechnung_anfordern` gated bewusst nicht** darauf: wer die URL direkt aufruft, will früher zahlen, und die Laufzeit schliesst an `paid_until` an, geht also nicht verloren
- **Guards**: höchstens **eine offene Rechnung** pro Konto (sonst erzeugt hektisches Klicken mehrere Nummern); Platzhalter-IBAN blockiert das Ausstellen mit Klartextfehler statt einen unbezahlbaren QR-Code zu verschicken; `BETA_PRICING=True` leitet zurück aufs Konto (in der Beta zahlt niemand). **Kein** Read-Only-Gate — wer nach Ablauf der Testphase bezahlen will, muss das können
- **Aufbewahrung 10 Jahre (OR 958f)**: `Invoice.user` ist `SET_NULL` und die Adresse liegt als Kopie auf der Rechnung, PDFs in `INVOICES_DIR` (gitignored, vom Cleanup nie berührt). Die Kontolöschung entfernt also den Personenbezug, nicht den Beleg — steht so auch in der Datenschutzerklärung und auf der Löschseite. **`invoices/` gehört ins Backup**
- Tests: `accounts.tests.InvoiceTests` / `.RenewalReminderTests`

### Feedback-Dankeschön (Akquise-Phase)
- Header-Button „Feedback" (nur eingeloggt) + blauer Banner unter dem Header öffnen ein Modal mit drei festen Fragen (Was gefällt dir? / Was muss verbessert werden? / Was fehlt dir?) — alle drei Pflicht, keine Mindestlänge
- `POST /feedback` (`submit_feedback` in `core/views.py`, login-pflichtig auch im BETA_MODE) speichert `FeedbackResponse` (`core/models.py`, User SET_NULL wie BugReport, sichtbar im `/vitruv/`-Admin); die **erste** Antwort pro User setzt als Dankeschön `trial_ends = max(bisher, jetzt + FEEDBACK_REWARD_DAYS)` (`= 180`, settings.py) — bewusst „Variante einfach": ab heute, kein Code-/Mail-System, hebt auch eine abgelaufene (Read-Only-)Trial wieder auf (Frontend lädt dann neu)
- Banner (`feedback_reward` im app-View-Context) erscheint nur, solange der User noch kein Feedback gegeben hat; „×" blendet ihn dauerhaft aus (`localStorage['feedback_banner_dismissed']`); liegt per z-index 1250 über dem Dashboard-Overlay, damit er auch in der Startansicht sichtbar ist. Im Dashboard zusätzlich „Feedback geben" in der linken Spalte (Proxy `dashFeedbackBtn` → `feedbackBtn`)
- Frontend-Logik in `project.js` (`setupFeedback`/`handleFeedbackSubmit`), Modal-Markup in `app.html`

### Online-Ablage ("Projektübersicht")
- **Speicherformat = das normale `.planli`-ZIP** (`buildProjectZipBlob`), serverseitig als `cloud_projects/<uuid>.planli` abgelegt (`StoredProject` in `core/models.py`: user, name, size, updated, `last_opened_at` für die spätere Archivierung). Gitignored, vom `cleanup_projects` nie berührt
- Endpoints (`core/views.py`, alle nur mit Login — unabhängig von BETA_MODE): `GET /cloud/projects` (Liste + Limit), `POST /cloud/projects/save` (upsert: mit `project_id` überschreiben, sonst anlegen → Quota-Gate + Grössen-Deckel; Read-Only ⇒ 403), `POST /cloud/projects/save/prepare` (Delta, siehe unten), `GET .../download` (setzt `last_opened_at`), `POST .../rename`, `POST .../delete` (auch Read-Only erlaubt — gibt Speicher frei)
- **Delta-Speichern (seit 30.7.2026)**: Vorher ging bei **jedem** Ctrl+S das komplette ZIP hoch — bei der Demo-Datei sind davon 88.7 % Original-PDF und 10.4 % Seiten-JPEGs, also **99.2 % Bytes, die der Server schon hat**; nur die ~0.8 % JSON ändern sich. Jetzt schickt `saveToCloud` (`project.js`) ein **Manifest** (`buildProjectManifest` in `project-zip.js`): JSON-Einträge inline plus SHA-256 je Binär-Eintrag. `prepare` meldet die unbekannten Hashes, der Commit lädt nur die hoch, und `_assemble_cloud_zip` (`core/views.py`) baut die neue `.planli` aus vorhandenen + hochgeladenen Einträgen (streamend, in eine `.tmp` und dann atomar per `os.replace` — ein Abbruch darf das gespeicherte Projekt nie beschädigen). Gemessen end-to-end: erstes Speichern 40.9 MB, zweites **0.000 MB**
  - **Inhaltsadressiert, nicht namensbasiert** — das ist der springende Punkt: `pages/page_N.jpg` ist *positionsbenannt* (Anzeigereihenfolge zum Speicherzeitpunkt), also verschieben Umsortieren/Löschen/Duplizieren die Namen, während die Bytes gleich bleiben. Über den Hash erkennt der Server sie wieder → all diese Operationen kosten **keinen** Upload. Ein namensbasiertes Delta hätte beim Verschieben von Seite 1 ans Ende jede einzelne Seite neu hochgeladen
  - **Der Commit vertraut der prepare-Antwort nicht**, sondern prüft selbst und antwortet ggf. `409 {missing: [...]}`; der Client liefert genau die nach (ein Anlauf). Das deckt Races (zweiter Tab) und verschwundene Dateien ab
  - **Fallback = altes Verhalten**: Fehlt die gespeicherte Datei oder ist sie beschädigt, liefert `_stored_hash_index` einen leeren Index → alles gilt als fehlend → Voll-Upload. Der ZIP-Weg (`project_zip`) bleibt im Endpoint erhalten, damit Browser mit noch gecachtem altem JS-Bundle nach einem Deploy weiter speichern können
  - **Das Manifest geht als Datei-Part hoch, nicht als Formularfeld**: `canvas_data.json` steckt inline drin, und Django deckelt Formulardaten auf `DATA_UPLOAD_MAX_MEMORY_SIZE` (2.6 MB ≈ 7000 Annotationen) — als Feld wäre das Speichern grosser Projekte mit einem undurchsichtigen Fehler gestorben. Datei-Uploads zählen nicht gegen dieses Limit
  - Eintragsnamen werden serverseitig gegen `CLOUD_ENTRY_NAME` geprüft und hochgeladene Blobs gegen ihren behaupteten Hash — ein Client kann weder fremde Pfade in die Datei schreiben noch untergeschobene Bytes speichern. Tests: `core.tests.CloudDeltaSaveTests`
- **Frontend** (`project.js`): eingeloggt (`window.PLANLI_CLOUD`) wird "Speichern"/Ctrl+S zum Cloud-Speichern (`currentCloudProjectId` = gerade geöffnetes Cloud-Projekt → Überschreiben; null → neu). Der Header-Button heisst eingeloggt "Projektübersicht" (sonst "Öffnen"; Label/Tooltip via `cloud_enabled` im Template) und öffnet mit Ctrl+O das **Dashboard** (`#cloudDashboard`, Startansicht beim App-Laden; Panel-Überschrift ebenfalls "Projektübersicht"): Projektliste mit Zähler "x von N"; Öffnen per Klick auf die Zeile, pro Zeile ein "⋯"-Menü (Umbenennen / ".planli-Datei exportieren" = Direkt-Download des gespeicherten ZIPs ohne Öffnen / Löschen). Ein .planli-Import wird automatisch als neues Cloud-Projekt gespeichert (ausser Read-Only) — kein manuelles Ctrl+S nötig. "+ Neues Projekt" setzt den Editor komplett zurück (`startNewProject()` in `upload-modal.js` → `window.planliResetEditor()` in `main.js`: Canvas/Empty-State, Ergebnis-Spalte, Manifest, History) und zeigt den leeren Editor mit Drop-Zone (bewusst kein automatischer Datei-Dialog) — nie nur Overlay schliessen (Duplikat-Falle: altes Projekt im Editor, aber Ctrl+S legte neues Cloud-Projekt an). Derselbe Reset läuft beim "+ Neu"-Button der Sidebar. "← Zurück zum Editor" (nur sichtbar, wenn ein Plan geladen ist) schliesst das Overlay. Bei offenem Dashboard (`body.dashboard-open`) sind die Header-Editor-Aktionen und das ganze Burger-Menü ausgeblendet und die Editor-Hotkeys gesperrt; stattdessen zeigt eine permanente linke Spalte (`_app_sidebar.html`, siehe unten „App-Shell") die Optionen: Anleitung/Verbesserung/Bug als Proxy-Buttons auf die Menü-IDs (`dash*Btn` → `.click()` in `project.js`), Konto-Link und Abmelden-POST-Form direkt im Markup. Datei-Workflows: ".planli-Datei importieren" als Button im Dashboard und im Burger-Menü, ".planli-Datei exportieren" im Burger-Menü. Frischer Upload ruft `window.planliCloudNewUpload()` (Hook in `upload-modal.js`) → nächstes Speichern legt ein neues Projekt an. Öffnen aus der Cloud lädt das ZIP über den normalen `handleLoad`-Pfad
- **Ein kanonischer Projektname**: gehalten in `upload-modal.js` (`currentFileName`, beim Upload mit dem PDF-Namen vorbelegt), im Editor per Klick auf den Namen in der file-info-bar umbenennbar (`setProjectName()`). Cloud-Speichern sendet ihn **auch beim Überschreiben** mit (Server aktualisiert `StoredProject.name`), beim Öffnen aus der Cloud gewinnt der Cloud-Name über `metadata.project_name` aus dem ZIP, Dashboard-Umbenennen wirkt auf ein gerade geöffnetes Projekt zurück. Datei-Downloads und PDF-Exporte schöpfen alle aus `getUploadedBaseName()` (strippt nur echte Dateiendungen — Namen dürfen Punkte enthalten)
- Seit dem `BETA_MODE`-Default-Flip auf False (2026-07-21) für alle nutzbar: Login ist jetzt der Normalfall (ausser `?demo=1`), also ist `cloud_enabled` für die meisten Besucher `True`. Vorher (`BETA_MODE=True`) sah mangels Login-Einstieg praktisch niemand die Online-Ablage — das war der Auslöser für den Flag-Split (`BETA_MODE` vs. `BETA_PRICING`, siehe Authentication oben): Login sollte zur Normalität werden, ohne dass gleichzeitig die Bezahl-/Read-Only-Logik einsetzt
- `BETA_MODE=True` (z.B. lokal zum Testen des alten anonymen Flows) schaltet die Online-Ablage wieder faktisch unsichtbar (kein Login-Einstieg ⇒ `cloud_enabled=False` für die meisten); altes ZIP-Speichern/Öffnen bleibt davon unberührt

### App-Shell (eingeloggte Seiten: Projektübersicht + Konto)
- Gemeinsame linke Spalte `templates/_app_sidebar.html` (Include mit `active="dashboard"` bzw. `active="konto"`) sorgt für durchgehende Navigation zwischen dem Cloud-Dashboard (app.html) und der Konto-Seite (`accounts/konto.html`) — vorher zwei optisch getrennte "Produkte" (Dashboard-Overlay vs. Marketing-Chrome), jetzt ein App-Gefühl mit Projektübersicht/Konto als fixe Nav-Items (aktiver Zustand hervorgehoben) plus Abmelden; die Dashboard-only-Buttons (Anleitung/Verbesserung/Bug/Feedback) erscheinen nur bei `active="dashboard"`
- **Zwei CSS-Definitionen, ein Klassenname**: `.app-side*` steht sowohl in `static/css/styles.css` (app.html/Dashboard, Overlay-Kontext) als auch im `<style>`-Block von `base.html` (Konto, nutzt dessen `--slate-*`/`--primary`-Tokens) — bewusst dupliziert statt eines gemeinsamen Stylesheets, weil app.html und base.html zwei komplett unterschiedliche Design-Systeme laden und ein globales Cross-Linking Stilbrüche auf den öffentlichen Seiten riskieren würde
- Konto rendert über `base.html` mit `app_shell=True, active_nav='konto'` im View-Context (`accounts/views.py konto()`): dadurch blendet `base.html`s `<nav>` die Marketing-Links (Features/Preise/FAQ) und die "Kostenlos testen"/"Anmelden"-CTAs aus (die Sidebar deckt Konto/Abmelden bereits ab) und `{% block body %}` wrappt den Seiteninhalt in `.app-shell-layout` (Sidebar + `.app-shell-main`). `accounts/auth_base.html` (Login/Register/Konto-löschen) überschreibt `{% block body %}` komplett und bleibt davon unberührt
- **`{# … #}` ist einzeilig**: Ein über zwei Zeilen gezogener Django-Kommentar wird **nicht** als Kommentar geparst und landet wörtlich im HTML — im JSON-LD der Landingpage macht das die strukturierten Daten kaputt. Mehrzeilig immer `{% comment %}…{% endcomment %}`. (Im Elternteil-freien Bereich einer `{% extends %}`-Vorlage fällt es nicht auf, weil Inhalt ausserhalb von Blöcken ohnehin verworfen wird — deshalb ist es in `auth_base.html` folgenlos.)
- **Vorsicht bei `{% include %}`-Beispieltext in Kommentaren**: Django parst Template-Tags auch innerhalb von `<!-- -->`-HTML-Kommentaren — ein Kommentar, der zur Doku den eigenen Include-Tag als Beispiel ausschreibt, erzeugt eine echte Selbst-Inklusion (RecursionError). In `_app_sidebar.html` deshalb nur in Prosa beschrieben, nie als `{% ... %}`-Literal
- **`box-sizing`**: `styles.css` (app.html) setzt anders als `base.html` kein globales `*{box-sizing:border-box}` — `.app-side`/`.app-side-item` dort deshalb explizit mit `box-sizing:border-box`, sonst ragt z.B. der aktive Nav-Hintergrund über die Spalte hinaus
- **`.btn`-Höhe**: `base.html`s `.btn`-Klasse setzt `font-family`+`line-height` explizit — `<button class="btn">` (z.B. Abmelden) übernimmt beides sonst nicht wie `<a class="btn">` vom `body` und wird dadurch niedriger/höher als benachbarte Link-Buttons
- **Konto-Status während der Beta**: Badge/„Jahreslizenz"-Karte zeigen bei `beta_pricing` (Konto-View bekommt `beta_pricing` automatisch über den globalen Context-Prozessor) einen neutralen „Beta-Phase — kostenlos & unbeschränkt"-Hinweis statt „Abgelaufen"/„Rechnung anfordern" (der Preis selbst steht darunter, markiert als „nach der Beta-Phase") — `_read_only()` greift bei `BETA_PRICING=True` nie, ein Trial-Countdown oder „Abgelaufen"-Badge wäre daher irreführend. `sub.is_paid` hat weiterhin Vorrang (zeigt echten Lizenzstatus, auch in der Beta). Bewusst `beta_pricing`, nicht `beta_mode` — die Konto-Seite ist ohnehin `@login_required`, das Badge soll nur die Preis-/Enforcement-Frage beantworten, nicht die Login-Pflicht

### Django Settings (config/settings.py)
- `SECRET_KEY`: reads from env var `DJANGO_SECRET_KEY` (falls back to insecure dev key)
- `DEBUG`: reads from env var `DJANGO_DEBUG` (default `True`)
- `ALLOWED_HOSTS`: reads from env var `DJANGO_ALLOWED_HOSTS`
- `SECURE_PROXY_SSL_HEADER` + `CSRF_TRUSTED_ORIGINS`: HTTPS/CSRF behind the nginx proxy (planli.net)
- `BETA_MODE`: anonymous-access switch, default **False**; env var `BETA_MODE=True` disables the login requirement (local testing of the old anonymous flow)
- `BETA_PRICING`: pricing/read-only-enforcement switch, default **True** (free, `_read_only()` never triggers); independent of `BETA_MODE` — see Authentication section above. **Gehört mit `SHOW_PRICING` zusammen gedreht**: der Default stand zwischenzeitlich (Commit `20e95d9`) auf False, während `SHOW_PRICING=False` nach aussen weiter „Aktuell kostenlos" versprach — die Kombination hätte Kunden nach Trial-Ablauf in Read-Only geschickt und zur Kasse gebeten, während die Landingpage das Gegenteil sagte. Am 18.8.2026 auf True zurückgesetzt
- `LICENSE_PRICE_CHF`: Listenpreis pro Nutzer/Jahr, einzige Quelle für alle Preisangaben (Templates ziehen ihn über den `pricing`-Context-Processor); pro Konto überschreib-/rabattierbar — siehe "Trial & Lizenz"
- `GLOBAL_DISCOUNT_PERCENT` / `GLOBAL_DISCOUNT_REASON` / `GLOBAL_DISCOUNT_UNTIL`: globale Preisaktion für alle (0 = aus), Logik in `accounts/pricing.py` — siehe "Trial & Lizenz". Wie `LICENSE_PRICE_CHF` bewusst als Literal in den Settings statt per Env: der laufende Preis soll im git stehen, nicht in der systemd-Unit
- `SHOW_PRICING` (default **False**, seit 18.8.2026): Preiskommunikation nach aussen. Die **Preissektion (`#pricing`) und der "Preise"-Nav-Link bleiben immer sichtbar**, die Sektion hat aber zwei Gesichter: bei False die schlichte **"Aktuell kostenlos"**-Version ("Planli befindet sich in der Beta-Phase" + "Jetzt loslegen"-Link, kein Betrag), bei True die Preiskarte mit Betrag. Bei False verschwinden ausserdem der Betrag in der FAQ-Antwort und der `offers`-Block im JSON-LD (Achtung: das Komma nach `description` hängt im Template am if, sonst ungültiges JSON — Test `LandingPricingTests.test_show_pricing_off_shows_free_beta_section_without_prices` parst das JSON-LD) sowie auf der **Konto-Seite** der künftige Preis in der "Jahreslizenz"-Karte während der Beta (nur der Beta-Hinweis bleibt). Bewusst **nicht** betroffen: die Jahrespreis-Zeile zahlender Kunden (Vertragspreis) und der Verkaufsmodus nach der Beta (`BETA_PRICING=False` zeigt den Preis neben "Rechnung anfordern" immer — dann muss `SHOW_PRICING` ohnehin wieder True sein). Der Rechnungszyklus läuft unabhängig. Gedacht für die Phase, in der der Rechnungszyklus fertig ist, das Pricing aber noch nicht entschieden/kommuniziert werden soll. Preistests pinnen `SHOW_PRICING=True`
- `PROJECTS_DIR`: `BASE_DIR / 'projects'` — `BUG_REPORTS_DIR`: `BASE_DIR / 'bug_reports'` — `TRAINING_DATA_DIR`: `BASE_DIR / 'training_data_opt-in'` (all gitignored)
- `PROJECT_RETENTION_DAYS`: default 14 (env-overridable); how long `projects/<uuid>/` is kept before the cleanup command deletes it
- `PDF_DPI = 150` (server always renders at 150 DPI — frontend has no DPI input, only a hidden field), `JPEG_QUALITY = 70`
- `MAX_UPLOAD_MB = 90`: grösste hochladbare PDF. **Eine** Quelle für die Server-Prüfung (`MAX_UPLOAD_SIZE` in `core/views.py`) und den Browser-Vorabcheck (`window.PLANLI_MAX_UPLOAD_MB` aus app.html → `upload-modal.js`). Vorher standen hier 40 MB und im Frontend hart 100 — Dateien dazwischen wurden erst nach dem vollständigen Upload abgewiesen. **Der Wert liegt bewusst 10 MB unter nginx' `client_max_body_size` (100M)**: Multipart-Overhead kommt zur Dateigrösse dazu, und läge nginx gleichauf oder tiefer, würde nginx die Verbindung mit einer HTML-413 kappen, bevor Django eine verständliche Meldung schicken kann. Wer nginx ändert, muss diesen Abstand mitziehen

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
- The stored ZIP is **identical to the "Speichern" export** (`buildProjectZipBlob`) → self-contained and directly re-loadable in the app via "Öffnen" for quality review. `training_data_opt-in/` is never touched by the cleanup command, nor by account deletion (see `konto_loeschen` above) — it's already stored anonymized/unlinked from the account per the privacy policy.

## Deployment (planli.net)

Production runs on a Debian server (Hetzner) at `/opt/Planvision`: gunicorn (systemd service `planvision`, `--timeout 300`) behind nginx with Let's Encrypt. nginx proxies **everything** to Django — the landing page is a Django template, never serve it as a static file. Only `/static/` is an nginx alias to `staticfiles/`; do **not** alias `/project_files/` (it would bypass the ownership check in `serve_project_file`).

After every `git pull` on the server:
1. `env/bin/python manage.py migrate`
2. `env/bin/python manage.py collectstatic --noinput` — otherwise nginx keeps serving the old JS bundle (symptom: CSRF 403 on POSTs)
3. `sudo systemctl restart planvision`

One-time setup for the invoicing feature (seit 14.8.2026):
```
sudo apt install libcairo2          # cairosvg rendert damit den QR-Zahlteil
env/bin/pip install -r requirements-server.txt   # qrbill, cairosvg, reportlab
```
Dazu vor der ersten echten Rechnung in `config/settings.py` die `INVOICE_*`-Platzhalter durch echte Werte ersetzen (IBAN, Adresse, UID) — mit der Platzhalter-IBAN verweigert der Server das Ausstellen. `invoices/` ins Backup aufnehmen (Aufbewahrungspflicht).

One-time setup — data-retention cron (deletes `projects/` older than 14 days):
```
0 3 * * * cd /opt/Planvision && env/bin/python manage.py cleanup_projects >> /var/log/planvision_cleanup.log 2>&1
```

One-time setup — licence-reminder cron (mails Kunden vor Lizenzablauf + Überfällig-Meldungen an INVOICE_BCC; No-Op solange `BETA_PRICING=True`):
```
0 4 * * * cd /opt/Planvision && env/bin/python manage.py renewal_reminders >> /var/log/planvision_reminders.log 2>&1
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

**Current version: 3** (`CURRENT_VERSION` in `project-zip.js` — diese Doku stand bis 30.7.2026 fälschlich auf 1)

Version history:
- **v1** – base format: `canvas_data.json` (multi-page annotations incl. canvas_text_labels and id/labelText, plus per-page `canvas_dimensions` and `canvas_text_notes`), `labels.json`, `settings.json`, `pages/`, optional `original.pdf`, and per-page `legend_position`
- **v2** – Seiten-Management (Duplizieren/Löschen/Reihenfolge): `canvas_data.json` bekommt `page_manifest` (geordnete Liste `[{id, sourcePageIndex, width_mm, height_mm}]`); `pages` und `settings.json` sind ab hier per stabiler pageId statt Seitenzahl geschlüsselt
- **v3** – "Anhängen": mehrere Quell-PDFs pro Projekt, `page_manifest`-Einträge bekommen `sourcePdfIndex`, `original.pdf` wird zu `sources/<index>.pdf`
  - optionales Feld `name` je `page_manifest`-Eintrag (eigener Seitenname, seit 7.10.2026) — ohne Versionssprung, weil fehlend = „Seite N“

(History was reset to a clean v1 before the live launch — there were no real project files in circulation yet, so no legacy migration is needed. `canvas_dimensions` (dimension helper lines) and `canvas_text_notes` (text fields) were folded into the base v1 format.)

Project files are saved with the `.planli` extension (internally a ZIP); "Projekt öffnen" still accepts older `.plan`/`.zip` test files.

**Kompression: `STORE` für `sources/*.pdf` und `pages/*.jpg`, DEFLATE nur für die JSON-Einträge** (`const STORE` in `project-zip.js`). PDFs und JPEGs sind bereits komprimiert — sie nochmal zu deflaten kostete gemessen 5.0 s statt 0.3 s bei 100 MB und sparte **null Byte**. Kein Formatbruch: ZIP-Leser mischen beide Verfahren, alte `.planli` laden unverändert. Nebeneffekt: Der Server kann beim Delta-Speichern vorhandene Einträge roh durchreichen, statt sie neu zu packen.

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
