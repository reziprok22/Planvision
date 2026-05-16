# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Planvision is a Django-based web application for architectural plan analysis that uses computer vision to detect and annotate building elements (windows, doors, walls, roofs, etc.) in PDF and image files. The application provides:

- AI-powered object detection using a Faster R-CNN model
- Multi-page PDF support with individual page analysis
- Interactive annotation editor using Fabric.js
- Project management with save/load functionality
- PDF report generation with bounding box overlays
- User authentication (login/register/logout) via Django's built-in auth system

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
- **core/views.py**: Django views for file upload, AI analysis, file serving, and index page
- **core/apps.py**: `CoreConfig.ready()` loads the ML model at startup
- **model_handler.py**: PyTorch model loading and inference logic
- **image_preprocessing.py**: OpenCV-based image preprocessing
- **utils.py**: Scale calculations and non-maximum suppression utilities

### Frontend (JavaScript ES6 Modules)
- **main.js**: Primary application controller, coordinates all modules and handles form submission
- **fabric-handler.js**: Fabric.js canvas management for interactive annotations
- **zoom-manager.js**: Image zoom and pan functionality
- **pdf-handler.js**: Multi-page PDF navigation and state management
- **project.js**: Project save/load operations
- **labels.js**: Label management system for object categories

### Static Files
- `static/` and `dist/` are both in `STATICFILES_DIRS` — both served under `/static/`
- Whitenoise serves static files in production (no separate web server needed for static)
- Templates use `{% load static %}` and `{% static 'path' %}` for all asset references

### Data Flow
1. User uploads PDF/image via HTML form
2. `core/views.py` converts PDF to images if needed, extracts page dimensions
3. `model_handler.py` runs AI inference using the Faster R-CNN model
4. Results return to frontend with bounding boxes and confidence scores
5. `fabric-handler.js` renders annotations on Fabric.js canvas overlay
6. User can edit annotations in editor mode
7. Projects can be saved with all page data and exported as PDF reports

### File Structure Patterns
- `projects/`: All session data — uploaded images, saved projects (subdirectory per project UUID)
- `templates/`: Django HTML templates (index.html, accounts/login.html, accounts/register.html)
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

### Authentication
- Django's built-in `django.contrib.auth` handles users, sessions, and password hashing
- Login: `/accounts/login/` — Logout: `/accounts/logout/` — Register: `/accounts/register/`
- Admin panel available at `/admin/` (requires superuser)
- API endpoints (`/upload`, `/analyze_page`) are currently `@csrf_exempt` — tighten when adding per-user data

### Django Settings (config/settings.py)
- `SECRET_KEY`: reads from env var `DJANGO_SECRET_KEY` (falls back to insecure dev key)
- `DEBUG`: reads from env var `DJANGO_DEBUG` (default `True`)
- `ALLOWED_HOSTS`: reads from env var `DJANGO_ALLOWED_HOSTS`
- `PROJECTS_DIR`: `BASE_DIR / 'projects'`
- `PDF_DPI = 150`, `JPEG_QUALITY = 70`

### Project Data Format
Projects store JSON files containing:
- `metadata.json`: Project info and creation date
- `analysis/page_X_results.json`: Per-page detection results
- `analysis/analysis_settings.json`: Analysis parameters
- `analysis/labels.json`: Custom label definitions
- `pages/`: Original image files
- `original.pdf`: Original PDF file if applicable

## Common Development Tasks

When adding new object detection classes, update:
1. Model training pipeline and class count in `model_handler.py`
2. Label definitions in `static/js/labels.js`
3. Color mappings and UI elements in HTML template

When modifying the annotation editor:
1. Update `fabric-handler.js` for canvas interactions
2. Coordinate changes with `main.js` for state management
3. Test zoom synchronization between image and canvas

When changing PDF processing:
1. Update `core/views.py` route handlers for new parameters
2. Ensure `pdf-handler.js` manages navigation state correctly
3. PDF export is fully frontend-based via `static/js/pdf-export-client.js` (pdf-lib) — no backend involved

## ZIP Format Versioning

The ZIP save/load system in `static/js/project-zip.js` uses a numeric `format_version` in `metadata.json` to ensure old ZIP files always load correctly.

**Current version: 2**

Version history:
- **v1** – original format (`metadata.format = 'planvision_zip_v1'`); canvas_annotations only, no canvas_text_labels, no id/labelText on annotations
- **v2** – canvas_text_labels per page added; id + labelText serialised on annotations

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
