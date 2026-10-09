import os
import re
import uuid
import time
import json
import shutil
import hashlib
import logging
import tempfile
import zipfile

from datetime import timedelta
from collections import defaultdict

from django.shortcuts import render
from django.http import JsonResponse, FileResponse, Http404, HttpResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import ensure_csrf_cookie
from django.contrib.auth.views import redirect_to_login
from django.contrib.admin.views.decorators import staff_member_required
from django.core.exceptions import ValidationError
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone
from django.conf import settings

from .models import Project, BugReport, AnalysisEvent, StoredProject, FeedbackResponse
from accounts.models import subscription_for

from pdf2image import convert_from_path
from PyPDF2 import PdfReader

from model_handler import predict_image, cleanup_memory

logger = logging.getLogger(__name__)

PROJECTS_DIR = settings.PROJECTS_DIR
PDF_DPI = settings.PDF_DPI
JPEG_QUALITY = settings.JPEG_QUALITY


def landing(request):
    return render(request, 'landing.html', {
        'beta_mode': settings.BETA_MODE,
        'meta_title': 'Planli | Ausmass-Software für Bauplan-PDFs',
        'meta_description': 'Flächen und Längen direkt aus PDF-Bauplänen im Browser messen. KI-Fenstererkennung, PDF-Export, ohne Installation – für Architekten, Energieberater und Bauleiter.',
    })


def _access_denied(request):
    """Zentrale Zugriffsprüfung: None wenn erlaubt, sonst 401-Response.
    Im BETA_MODE ist jeder Zugriff erlaubt."""
    if settings.BETA_MODE or request.user.is_authenticated:
        return None
    return JsonResponse({'error': 'Nicht autorisiert'}, status=401)


def _read_only(request):
    """True, wenn Trial/Lizenz abgelaufen ist → nur noch Ansehen/Exportieren,
    keine KI-Analyse und kein Bearbeiten. Bei BETA_PRICING nie (unabhängig
    von BETA_MODE/Login-Pflicht)."""
    if settings.BETA_PRICING or not request.user.is_authenticated:
        return False
    return not subscription_for(request.user).is_active


def _get_project(request, project_id):
    """Projekt mit Ownership-Prüfung holen (im BETA_MODE nur per ID).
    Gibt None zurück, wenn nicht gefunden, kein Zugriff oder ungültige ID."""
    try:
        qs = Project.objects.filter(id=project_id)
        if not settings.BETA_MODE:
            qs = qs.filter(user=request.user)
        return qs.first()
    except (ValueError, ValidationError):
        return None


@ensure_csrf_cookie  # CSRF-Cookie immer setzen — nötig für die API-POSTs des Frontends
def app(request):
    # Demo-Modus (?demo=1, Landingpage-Button): auch ohne Login zugänglich.
    # Rendert nur die App-Shell — geladen wird das statische Demo-Projekt,
    # alle API-Endpoints bleiben login-geschützt (_access_denied).
    is_demo = 'demo' in request.GET
    if not settings.BETA_MODE and not request.user.is_authenticated and not is_demo:
        return redirect_to_login(request.get_full_path())
    return render(request, 'app.html', {
        'beta_mode': settings.BETA_MODE,
        'read_only': _read_only(request),
        # Online-Ablage nur mit Login (in der Beta sieht sie mangels Login niemand)
        'cloud_enabled': request.user.is_authenticated,
        # Demo ohne Login: Logo verlinkt zurück auf die Landingpage
        'is_demo': is_demo,
        # Eine Quelle für Server-Prüfung und Browser-Vorabcheck (siehe settings)
        'max_upload_mb': settings.MAX_UPLOAD_MB,
        # Feedback-Dankeschön: Banner nur, solange der User es noch nicht
        # eingelöst hat (erste Feedback-Antwort verlängert die Testphase).
        'feedback_reward': (request.user.is_authenticated and
                            not FeedbackResponse.objects.filter(user=request.user).exists()),
        'feedback_reward_months': settings.FEEDBACK_REWARD_DAYS // 30,
    })


def datenschutz(request):
    return render(request, 'datenschutz.html', {
        'meta_description': 'Datenschutzerklärung von Planli: Wie wir mit hochgeladenen Bauplänen und Nutzerdaten umgehen.',
    })


def impressum(request):
    return render(request, 'impressum.html', {
        'meta_description': 'Impressum von Planli – Anbieterkennzeichnung und Kontaktangaben.',
    })


def agb(request):
    return render(request, 'agb.html', {
        'meta_description': 'Allgemeine Geschäftsbedingungen (AGB) von Planli.',
    })


def robots_txt(request):
    # Den Admin-Pfad (/vitruv/) hier bewusst NICHT auflisten: robots.txt ist
    # öffentlich und würde den unauffälligen Pfad an Scanner verraten.
    # Crawler finden ihn ohnehin nicht, da nichts darauf verlinkt.
    lines = [
        'User-agent: *',
        'Disallow: /accounts/',
        'Disallow: /project_files/',
        '',
        'Sitemap: https://planli.net/sitemap.xml',
    ]
    return HttpResponse('\n'.join(lines), content_type='text/plain')


def sitemap_xml(request):
    urls = [
        ('https://planli.net/', '1.0'),
        ('https://planli.net/datenschutz/', '0.3'),
        ('https://planli.net/impressum/', '0.3'),
        ('https://planli.net/agb/', '0.3'),
    ]
    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url, priority in urls:
        xml.append(f'  <url><loc>{url}</loc><priority>{priority}</priority></url>')
    xml.append('</urlset>')
    return HttpResponse('\n'.join(xml), content_type='application/xml')


@staff_member_required
def statistik(request):
    """Interne Beta-Auswertung (nur für Staff/Superuser)."""
    now = timezone.now()
    d7 = now - timedelta(days=7)
    d30 = now - timedelta(days=30)

    projects = Project.objects.all()
    events = AnalysisEvent.objects.all()

    uploads_total = projects.count()
    uploads_registered = projects.filter(user__isnull=False).count()

    # Wiederkehr-Schätzung: Sessions mit Analysen an >= 2 verschiedenen Tagen
    session_days = defaultdict(set)
    for sk, dt in events.exclude(session_key='').values_list('session_key', 'created_at'):
        session_days[sk].add(timezone.localtime(dt).date())
    returning_sessions = sum(1 for days in session_days.values() if len(days) >= 2)

    daily_uploads = (
        projects.filter(created_at__gte=now - timedelta(days=14))
        .annotate(day=TruncDate('created_at'))
        .values('day').annotate(n=Count('id')).order_by('day')
    )

    context = {
        'now': now,
        'uploads_total': uploads_total,
        'uploads_30': projects.filter(created_at__gte=d30).count(),
        'uploads_7': projects.filter(created_at__gte=d7).count(),
        'uploads_registered': uploads_registered,
        'uploads_anon': uploads_total - uploads_registered,
        'analyses_total': events.count(),
        'analyses_30': events.filter(created_at__gte=d30).count(),
        'analyses_7': events.filter(created_at__gte=d7).count(),
        'distinct_sessions': len(session_days),
        'returning_sessions': returning_sessions,
        'daily_uploads': daily_uploads,
        'bugs_total': BugReport.objects.count(),
        'bugs_open': BugReport.objects.filter(resolved=False).count(),
    }
    return render(request, 'statistik.html', context)


def serve_project_file(request, project_id, filename):
    denied = _access_denied(request)
    if denied:
        return denied
    if _get_project(request, project_id) is None:
        raise Http404
    project_dir = PROJECTS_DIR / project_id
    file_path = project_dir / filename
    if not file_path.exists():
        raise Http404("File not found")
    if not str(file_path.resolve()).startswith(str(project_dir.resolve())):
        raise Http404
    response = FileResponse(open(file_path, 'rb'))
    # Page renders are immutable for the lifetime of a session (never
    # re-rendered under the same filename) — cache in the browser so
    # switching pages doesn't re-fetch them. `private`, not `public`: access
    # here is guarded by the unguessable session UUID, not meant for shared caches.
    response['Cache-Control'] = 'private, max-age=31536000, immutable'
    return response


class PdfTooLargeError(Exception):
    """Einzelne Seite zu gross zum Rendern — wird als 400 mit Klartext ausgeliefert."""


# Peak-RAM beim Rendern ist EINE Seite (poppler hält ein Bitmap), nicht die
# Summe — deshalb ein Deckel pro Seite statt aufs Dokument. 80 MP entspricht
# gut der doppelten A0-Fläche bei 150 DPI (A0 = 34.9 MP) und belegt in poppler
# ~240 MB RGB.
MAX_PAGE_MEGAPIXELS = 80


def _check_page_sizes(page_sizes):
    """Verhindert, dass eine einzelne Riesenseite den Worker per OOM killt."""
    for i, (width_mm, height_mm) in enumerate(page_sizes):
        megapixels = (width_mm / 25.4 * PDF_DPI) * (height_mm / 25.4 * PDF_DPI) / 1_000_000
        if megapixels > MAX_PAGE_MEGAPIXELS:
            raise PdfTooLargeError(
                f'Seite {i+1} ist zu gross zum Verarbeiten '
                f'({round(width_mm)}×{round(height_mm)} mm). '
                f'Maximal etwa die doppelte A0-Fläche.'
            )


def _convert_pdf_to_images(pdf_file, project_id=None, source_index=1):
    """Render a PDF into projects/<uuid>/uploads/.

    `source_index` namespaces the output (document_<n>.pdf, page_<n>_<i>.jpg)
    so multiple PDFs can coexist in the same session — see Seiten-Management
    "Anhängen" (CLAUDE.md). source_index=1 is the original upload.
    """
    if not project_id:
        project_id = str(uuid.uuid4())

    output_dir = PROJECTS_DIR / project_id / 'uploads'
    output_dir.mkdir(parents=True, exist_ok=True)

    # Die PDF liegt bis zum erfolgreichen Rendern unter einem Namen, den
    # upload_append nicht als belegte Quell-Nummer zählt (endet nicht auf .pdf).
    # Früher stand document_<n>.pdf sofort da: scheiterte danach das Rendern
    # (Seite zu gross, Render-Fehler), blieb die Nummer auf dem Server belegt,
    # ohne dass der Client sie je erfuhr — eine Lücke in seiner Nummerierung,
    # die beim nächsten Neuaufbau der Session zum Überschreiben einer fremden
    # Quell-PDF führte (Seiten zeigten im Export auf die falsche PDF).
    pdf_path = output_dir / f"document_{source_index}.pdf"
    part_path = output_dir / f"document_{source_index}.pdf.part"
    with open(part_path, 'wb') as f:
        for chunk in pdf_file.chunks():
            f.write(chunk)
    try:
        info = _render_pdf(part_path, output_dir, project_id, source_index)
    except BaseException:
        part_path.unlink(missing_ok=True)
        raise
    os.replace(part_path, pdf_path)
    return info


def _render_pdf(pdf_path, output_dir, project_id, source_index):
    pdf_reader = PdfReader(str(pdf_path))
    page_sizes = []
    for page in pdf_reader.pages:
        media_box = page.mediabox
        page_sizes.append((float(media_box.width) * 0.352778, float(media_box.height) * 0.352778))

    _check_page_sizes(page_sizes)

    image_paths = []
    local_image_paths = []

    # Direkt auf die Platte rendern: mit output_folder+paths_only schreibt
    # pdftoppm jede Seite selbst als JPEG und gibt sie sofort wieder frei.
    # Ohne output_folder schickt poppler die ROHEN Bitmaps ALLER Seiten über
    # stdout, die pdf2image komplett im RAM puffert und dann zusätzlich zu
    # PIL-Bildern parst — das hat den 4-GB-Server beim Upload grösserer Pläne
    # per OOM-Killer zerlegt (~2.9 GB in einem Worker). Jetzt bleibt der Peak
    # bei einer Seite, unabhängig von der Seitenzahl.
    with tempfile.TemporaryDirectory(dir=str(output_dir), prefix='render_') as tmp_dir:
        rendered = convert_from_path(
            str(pdf_path),
            dpi=PDF_DPI,
            fmt='jpeg',
            jpegopt={'quality': JPEG_QUALITY, 'optimize': True},
            output_folder=tmp_dir,
            paths_only=True,
        )
        page_count = len(rendered)
        for i, tmp_page in enumerate(rendered):
            image_path = output_dir / f"page_{source_index}_{i+1}.jpg"
            # Gleiches Dateisystem (tmp_dir liegt in output_dir) => reines rename
            shutil.move(tmp_page, str(image_path))
            local_image_paths.append(str(image_path))
            image_paths.append(f"/project_files/{project_id}/uploads/page_{source_index}_{i+1}.jpg")

    return {
        "session_id": project_id,
        "source_index": source_index,
        "image_paths": image_paths,
        "local_image_paths": local_image_paths,
        "page_count": page_count,
        "page_sizes": page_sizes,
    }


MAX_UPLOAD_SIZE = settings.MAX_UPLOAD_MB * 1024 * 1024


def _validate_pdf_upload(request):
    """Shared checks for upload_file/upload_append. Returns (file, None) or (None, error_response)."""
    if 'file' not in request.FILES:
        return None, JsonResponse({'error': 'No file part'}, status=400)
    file = request.FILES['file']
    if not file.name:
        return None, JsonResponse({'error': 'No selected file'}, status=400)
    if not file.name.lower().endswith('.pdf'):
        return None, JsonResponse({'error': 'Nur PDF-Dateien sind erlaubt.'}, status=400)
    if file.size > MAX_UPLOAD_SIZE:
        return None, JsonResponse(
            {'error': f'Datei zu gross. Maximum: {settings.MAX_UPLOAD_MB} MB.'}, status=400)
    if file.read(4) != b'%PDF':
        return None, JsonResponse({'error': 'Ungültige PDF-Datei.'}, status=400)
    file.seek(0)
    return file, None


MAX_SOURCE_INDEX = 999


def _requested_source_index(request):
    """Vom Client gewünschte Quell-Nummer (optional). None = nicht angegeben.

    Beim Neuaufbau einer Session nach dem Öffnen eines Projekts (ensureServerSession)
    muss jede Quell-PDF unter IHRER Nummer landen: der Server zählte früher
    lückenlos durch, die Seiten des Projekts verweisen aber auf die Nummern des
    Clients — eine Lücke dort verschob alles Folgende."""
    raw = request.POST.get('source_index')
    if raw in (None, ''):
        return None
    try:
        index = int(raw)
    except ValueError:
        raise ValueError('Ungültige Quell-Nummer.')
    if not 1 <= index <= MAX_SOURCE_INDEX:
        raise ValueError('Ungültige Quell-Nummer.')
    return index


@require_POST
def upload_file(request):
    denied = _access_denied(request)
    if denied:
        return denied
    try:
        file, error = _validate_pdf_upload(request)
        if error:
            return error
        try:
            source_index = _requested_source_index(request) or 1
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=400)

        try:
            pdf_info = _convert_pdf_to_images(file, source_index=source_index)
            Project.objects.create(
                id=pdf_info["session_id"],
                user=request.user if request.user.is_authenticated else None,
                original_filename=file.name,
            )
            return JsonResponse({
                'is_pdf': True,
                'session_id': pdf_info["session_id"],
                'source_index': pdf_info["source_index"],
                'page_count': int(pdf_info["page_count"]),
                'all_pages': pdf_info["image_paths"],
                'page_sizes': pdf_info["page_sizes"],
                'filename': file.name,
            })
        except PdfTooLargeError as e:
            return JsonResponse({'error': str(e)}, status=400)
        except Exception as e:
            logger.exception("PDF processing error")
            return JsonResponse({'error': f'Error converting PDF: {str(e)}'}, status=500)

    except Exception as e:
        logger.exception("Upload error")
        return JsonResponse({'error': str(e)}, status=500)


@require_POST
def upload_append(request):
    """Render an additional PDF into an EXISTING session (Seiten-Management
    "Anhängen") — same session_id, next free source_index. The frontend keeps
    each page's sourcePdfIndex/sourcePageIndex in its page manifest so
    analysis and PDF export can address the right rendered page afterwards."""
    denied = _access_denied(request)
    if denied:
        return denied
    try:
        session_id = request.POST.get('session_id')
        if _get_project(request, session_id) is None:
            return JsonResponse({'error': 'Projekt nicht gefunden'}, status=404)

        file, error = _validate_pdf_upload(request)
        if error:
            return error

        try:
            requested = _requested_source_index(request)
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=400)

        if requested is not None:
            # Der Client vergibt die Nummer selbst: nur er weiss, welche Quell-PDFs
            # zum Projekt gehören. Eine Datei, die hier schon unter der Nummer liegt,
            # ist eine Waise (Antwort eines früheren Anhängens ging verloren) — der
            # Client kennt sie nicht, sie darf überschrieben werden.
            next_index = requested
        else:
            # Altes JS-Bundle ohne source_index: nächste freie Nummer wie bisher
            session_dir = PROJECTS_DIR / session_id / 'uploads'
            existing_indices = []
            for name in os.listdir(session_dir):
                if name.startswith('document_') and name.endswith('.pdf'):
                    try:
                        existing_indices.append(int(name[len('document_'):-len('.pdf')]))
                    except ValueError:
                        pass
            next_index = max(existing_indices, default=0) + 1

        try:
            pdf_info = _convert_pdf_to_images(file, project_id=session_id, source_index=next_index)
            return JsonResponse({
                'source_index': pdf_info["source_index"],
                'page_count': int(pdf_info["page_count"]),
                'all_pages': pdf_info["image_paths"],
                'page_sizes': pdf_info["page_sizes"],
            })
        except PdfTooLargeError as e:
            return JsonResponse({'error': str(e)}, status=400)
        except Exception as e:
            logger.exception("PDF processing error (append)")
            return JsonResponse({'error': f'Error converting PDF: {str(e)}'}, status=500)

    except Exception as e:
        logger.exception("Upload-append error")
        return JsonResponse({'error': str(e)}, status=500)


@require_POST
def analyze_page(request):
    denied = _access_denied(request)
    if denied:
        return denied
    if _read_only(request):
        return JsonResponse({'error': 'Deine Testphase ist abgelaufen, die KI-Analyse '
                             'ist nur mit aktiver Lizenz verfügbar.'}, status=403)

    request_start = time.time()
    performance_metrics = {}

    try:
        session_id = request.POST.get('session_id')

        if _get_project(request, session_id) is None:
            return JsonResponse({'error': 'Projekt nicht gefunden'}, status=404)

        page = int(request.POST.get('page', 1))
        # Which uploaded PDF this page belongs to (Seiten-Management "Anhängen") —
        # 1 = the original upload. See _convert_pdf_to_images' source_index namespacing.
        source_index = int(request.POST.get('source_index', 1))
        format_size = (
            float(request.POST.get('format_width', 210)),
            float(request.POST.get('format_height', 297)),
        )
        dpi = float(request.POST.get('dpi', PDF_DPI))
        plan_scale = float(request.POST.get('plan_scale', 100))
        threshold = float(request.POST.get('threshold', 0.5))

        session_dir = PROJECTS_DIR / session_id / 'uploads'
        if not session_dir.exists():
            return JsonResponse({'error': 'Session nicht gefunden'}, status=404)

        page_prefix = f"page_{source_index}_"
        pdf_files = [f for f in os.listdir(session_dir) if f.startswith(page_prefix) and f.endswith('.jpg')]
        image_files = [f for f in os.listdir(session_dir) if f.startswith('image.')]

        is_pdf = len(pdf_files) > 0
        page_count = len(pdf_files) if is_pdf else len(image_files)

        if page < 1 or page > page_count:
            return JsonResponse({'error': 'Ungültige Seitenzahl'}, status=400)

        if is_pdf:
            image_filename = f"{page_prefix}{page}.jpg"
            rel_image_path = f"/project_files/{session_id}/uploads/{page_prefix}{page}.jpg"
        else:
            image_filename = image_files[0] if image_files else None
            if not image_filename:
                return JsonResponse({'error': 'Keine Bilddatei gefunden'}, status=404)
            rel_image_path = f"/project_files/{session_id}/uploads/{image_filename}"

        image_path = session_dir / image_filename
        if not image_path.exists():
            return JsonResponse({'error': f'Bild für Seite {page} nicht gefunden'}, status=404)

        with open(image_path, 'rb') as f:
            image_bytes = f.read()

        inference_start = time.time()
        boxes, labels, scores, areas = predict_image(
            image_bytes,
            format_size=format_size,
            dpi=dpi,
            plan_scale=plan_scale,
            threshold=threshold,
        )
        performance_metrics['model_inference_time'] = time.time() - inference_start

        results = [
            {
                'box': box.tolist(),
                'label': int(label),
                'score': round(float(score), 2),
                'area': round(float(area), 2),
            }
            for box, label, score, area in zip(boxes, labels, scores, areas)
        ]

        if is_pdf:
            all_image_paths = [f"/project_files/{session_id}/uploads/{page_prefix}{i+1}.jpg" for i in range(page_count)]
        else:
            all_image_paths = [rel_image_path]

        performance_metrics['total_request_time'] = time.time() - request_start
        cleanup_memory()

        # Beta-Tracking (nicht-fatal): eine durchgeführte Analyse protokollieren
        try:
            if not request.session.session_key:
                request.session.save()
            AnalysisEvent.objects.create(
                session_key=request.session.session_key or '',
                user=request.user if request.user.is_authenticated else None,
                page_number=page,
            )
        except Exception:
            logger.exception('AnalysisEvent konnte nicht gespeichert werden')

        return JsonResponse({
            'predictions': results,
            'total_area': round(float(sum(areas)), 2),
            'count': len(results),
            'is_pdf': is_pdf,
            'pdf_image_url': rel_image_path,
            'current_page': page,
            'page_count': page_count,
            'all_pages': all_image_paths,
            'session_id': session_id,
            'actual_dpi': dpi,
            'performance_metrics': performance_metrics,
        })

    except Exception as e:
        import traceback
        logger.error(traceback.format_exc())
        return JsonResponse({'error': str(e)}, status=500)


MAX_BUG_ZIP_SIZE        = 40 * 1024 * 1024  # wie Upload-Limit
MAX_BUG_SCREENSHOT_SIZE = 10 * 1024 * 1024


@require_POST
def report_bug(request):
    denied = _access_denied(request)
    if denied:
        return denied
    try:
        text = (request.POST.get('text') or '').strip()
        if not text:
            return JsonResponse({'error': 'Beschreibung fehlt'}, status=400)

        try:
            page_number = int(request.POST.get('page', ''))
        except (TypeError, ValueError):
            page_number = None

        valid_types = {choice[0] for choice in BugReport.REPORT_TYPES}
        report_type = request.POST.get('report_type', 'bug')
        if report_type not in valid_types:
            report_type = 'bug'

        report = BugReport.objects.create(
            user=request.user if request.user.is_authenticated else None,
            report_type=report_type,
            text=text[:5000],
            page_number=page_number,
            email=(request.POST.get('email') or '').strip()[:254],
            user_agent=request.META.get('HTTP_USER_AGENT', '')[:500],
            client_info=(request.POST.get('client_info') or '')[:2000],
        )

        report_dir = settings.BUG_REPORTS_DIR / str(report.pk)

        zip_file = request.FILES.get('project_zip')
        if zip_file and zip_file.size <= MAX_BUG_ZIP_SIZE:
            report_dir.mkdir(parents=True, exist_ok=True)
            with open(report_dir / 'project.zip', 'wb') as f:
                for chunk in zip_file.chunks():
                    f.write(chunk)
            report.project_zip = f'{report.pk}/project.zip'

        screenshot = request.FILES.get('screenshot')
        if screenshot and screenshot.size <= MAX_BUG_SCREENSHOT_SIZE:
            report_dir.mkdir(parents=True, exist_ok=True)
            with open(report_dir / 'screenshot.jpg', 'wb') as f:
                for chunk in screenshot.chunks():
                    f.write(chunk)
            report.screenshot = f'{report.pk}/screenshot.jpg'

        report.save()
        return JsonResponse({'status': 'ok', 'id': report.pk})

    except Exception as e:
        logger.exception("report_bug error")
        return JsonResponse({'error': str(e)}, status=500)


@require_POST
def submit_feedback(request):
    """Feedback-Modal (drei feste Fragen). Nur mit Login — die erste Antwort
    pro User verlängert als Dankeschön die Testphase auf FEEDBACK_REWARD_DAYS
    ab heute (kein Code-System; bewusst auch für abgelaufene Trials möglich)."""
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Nicht autorisiert'}, status=401)
    try:
        role       = (request.POST.get('role') or '').strip()
        role_other = (request.POST.get('role_other') or '').strip()
        positive = (request.POST.get('positive') or '').strip()
        improve  = (request.POST.get('improve') or '').strip()
        missing  = (request.POST.get('missing') or '').strip()
        if not (positive and improve and missing):
            return JsonResponse({'error': 'Bitte beantworte alle drei Fragen.'}, status=400)
        valid_roles = {c[0] for c in FeedbackResponse.ROLE_CHOICES}
        if role not in valid_roles:
            return JsonResponse({'error': 'Bitte wähle deine Rolle.'}, status=400)
        if role == 'sonstiges' and not role_other:
            return JsonResponse({'error': 'Bitte gib deine Tätigkeit an.'}, status=400)

        first = not FeedbackResponse.objects.filter(user=request.user).exists()
        FeedbackResponse.objects.create(
            user=request.user,
            role=role,
            role_other=(role_other[:120] if role == 'sonstiges' else ''),
            positive=positive[:5000],
            improve=improve[:5000],
            missing=missing[:5000],
            reward_granted=first,
        )

        payload = {'status': 'ok', 'reward_granted': first}
        if first:
            sub = subscription_for(request.user)
            # max(): eine bereits längere Trial wird nie verkürzt
            sub.trial_ends = max(sub.trial_ends,
                                 timezone.now() + timedelta(days=settings.FEEDBACK_REWARD_DAYS))
            sub.save(update_fields=['trial_ends'])
            # Monatszahl statt konkretem Datum: die Belohnung greift erst nach der
            # Beta (trial_ends ist bis dahin belanglos), ein Datum wäre irreführend.
            payload['reward_months'] = settings.FEEDBACK_REWARD_DAYS // 30
        return JsonResponse(payload)

    except Exception as e:
        logger.exception("submit_feedback error")
        return JsonResponse({'error': str(e)}, status=500)


@require_POST
def save_training_data(request):
    denied = _access_denied(request)
    if denied:
        return denied
    try:
        session_id = request.POST.get('session_id')
        if not session_id:
            return JsonResponse({'error': 'session_id fehlt'}, status=400)

        project = _get_project(request, session_id)
        if project is None:
            return JsonResponse({'error': 'Projekt nicht gefunden'}, status=404)

        # Einwilligung des Nutzers persistieren.
        consent = request.POST.get('consent') == 'true'
        if project.consent_training != consent:
            project.consent_training = consent
            project.save(update_fields=['consent_training'])

        # Ohne Einwilligung wird nichts dauerhaft gespeichert.
        if not consent:
            return JsonResponse({'status': 'skipped'})

        # Es wird das vollständige, ladbare Projekt-ZIP abgelegt (identisch zum
        # "Speichern"-Export): self-contained, in der App per "Öffnen" prüfbar.
        zip_file = request.FILES.get('project_zip')
        if not zip_file:
            return JsonResponse({'error': 'project_zip fehlt'}, status=400)

        target_dir = settings.TRAINING_DATA_DIR / session_id
        target_dir.mkdir(parents=True, exist_ok=True)
        with open(target_dir / 'project.zip', 'wb') as f:
            for chunk in zip_file.chunks():
                f.write(chunk)

        return JsonResponse({'status': 'ok'})

    except Exception as e:
        logger.exception("save_training_data error")
        return JsonResponse({'error': str(e)}, status=500)


# ── Online-Ablage ("Meine Projekte") ─────────────────────────────────────────
# Dauerhaft gespeicherte .planli-ZIPs pro User (identisch zum lokalen
# "Speichern"-Export). Braucht immer einen eingeloggten User — unabhängig
# von BETA_MODE/BETA_PRICING.

def _cloud_denied(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Nicht angemeldet'}, status=401)
    return None


def _get_stored_project(request, project_id):
    """Eigenes Cloud-Projekt holen; None bei fremd/nicht gefunden/ungültiger ID."""
    try:
        return StoredProject.objects.filter(id=project_id, user=request.user).first()
    except (ValueError, ValidationError):
        return None


def _cloud_read_only_denied(request):
    if _read_only(request):
        return JsonResponse({'error': 'Deine Testphase bzw. Lizenz ist abgelaufen, '
                             'Online-Speichern ist nur mit aktiver Lizenz möglich.'}, status=403)
    return None


def _cloud_quota_denied(request):
    """Projektlimit — gilt für alles, was ein neues Cloud-Projekt anlegt."""
    limit = subscription_for(request.user).max_projects
    if request.user.stored_projects.count() >= limit:
        return JsonResponse({'error': f'Projektlimit erreicht ({limit} Projekte). '
                             'Exportiere ältere Projekte in der Projektübersicht als .planli-Datei '
                             '(⋯-Menü) und lösche sie dann aus der Ablage — oder kontaktiere uns '
                             'für ein höheres Limit.'}, status=403)
    return None


def cloud_list(request):
    denied = _cloud_denied(request)
    if denied:
        return denied
    projects = [{
        'id': str(p.id),
        'name': p.name,
        'size_bytes': p.size_bytes,
        'updated_at': timezone.localtime(p.updated_at).strftime('%d.%m.%Y %H:%M'),
    } for p in request.user.stored_projects.all()]
    return JsonResponse({
        'projects': projects,
        'limit': subscription_for(request.user).max_projects,
    })


# ── Delta-Speichern ──────────────────────────────────────────────────────────
# Der Client schickt beim Überschreiben nicht mehr das ganze ZIP, sondern ein
# Manifest: die JSON-Einträge inline plus SHA-256 je Binär-Eintrag. Der Server
# übernimmt alles, was er schon hat, und fordert nur Unbekanntes an. Bei der
# Demo-Datei sind 99.2 % der Bytes (PDF + Seiten-JPEGs) bei jedem Speichern
# identisch — die gehen jetzt nicht mehr über die Leitung.

CLOUD_JSON_ENTRIES = ('metadata.json', 'canvas_data.json', 'labels.json', 'settings.json')
# Nur die Namen, die das Format kennt — verhindert, dass ein Client beliebige
# Pfade in die gespeicherte Datei schreibt.
CLOUD_ENTRY_NAME = re.compile(r'^(?:pages/page_\d{1,5}\.jpg|sources/\d{1,4}\.pdf)$')
SHA256_HEX = re.compile(r'^[0-9a-f]{64}$')
CHUNK = 1024 * 1024


def _stored_hash_index(path):
    """{sha256: Eintragsname} der gespeicherten .planli.

    Inhaltsadressiert statt namensbasiert: `pages/page_N.jpg` ist
    positionsbenannt, deshalb ändern Umsortieren/Löschen/Duplizieren zwar die
    Namen, nicht aber die Bytes. Über den Hash erkennt der Server sie wieder
    und der Client muss nichts davon erneut hochladen.
    """
    index = {}
    if not path.exists():
        return index
    try:
        with zipfile.ZipFile(path) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                digest = hashlib.sha256()
                with zf.open(info) as fh:
                    for chunk in iter(lambda: fh.read(CHUNK), b''):
                        digest.update(chunk)
                index.setdefault(digest.hexdigest(), info.filename)
    except (zipfile.BadZipFile, OSError):
        # Datei fehlt oder ist beschädigt: Delta-Basis verwerfen. Der Client
        # bekommt dann alle Hashes als "fehlend" gemeldet und lädt alles hoch —
        # also exakt das Verhalten von vor dem Delta-Speichern.
        logger.warning("Cloud-Projekt %s nicht lesbar, Delta-Basis verworfen", path.name)
        return {}
    return index


def _write_zip_entry(zf, name, chunks):
    """Einen Eintrag streamend schreiben (unkomprimiert) und dabei hashen."""
    info = zipfile.ZipInfo(name, date_time=time.localtime()[:6])
    info.compress_type = zipfile.ZIP_STORED
    digest = hashlib.sha256()
    with zf.open(info, 'w') as dst:
        for chunk in chunks:
            digest.update(chunk)
            dst.write(chunk)
    return digest.hexdigest()


def _assemble_cloud_zip(dest, json_entries, entries, uploaded, stored_index):
    """Neue .planli aus hochgeladenen und bereits gespeicherten Einträgen bauen.

    Schreibt in eine temporäre Datei und ersetzt `dest` erst am Schluss atomar.
    Die bereits vorhandenen Einträge werden dabei aus `dest` selbst gelesen —
    das geht, weil bis zum abschliessenden os.replace() nur die temporäre Datei
    beschrieben wird. Ein Abbruch mittendrin lässt das gespeicherte Projekt
    also unangetastet.
    """
    tmp = dest.with_name(dest.name + '.tmp')
    try:
        with zipfile.ZipFile(tmp, 'w') as out:
            for name in CLOUD_JSON_ENTRIES:
                out.writestr(name, json_entries[name], zipfile.ZIP_DEFLATED)

            src = zipfile.ZipFile(dest) if stored_index else None
            try:
                for entry in entries:
                    upload = uploaded.get(entry['sha256'])
                    if upload is not None:
                        # chunks() spult selbst zurück — derselbe Blob kann
                        # mehrfach vorkommen (duplizierte Seite).
                        actual = _write_zip_entry(out, entry['name'], upload.chunks())
                        if actual != entry['sha256']:
                            raise ValueError(f"Prüfsumme von {entry['name']} stimmt nicht")
                    else:
                        with src.open(stored_index[entry['sha256']]) as fh:
                            _write_zip_entry(out, entry['name'],
                                             iter(lambda: fh.read(CHUNK), b''))
            finally:
                if src is not None:
                    src.close()
        os.replace(tmp, dest)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def _parse_manifest(raw):
    """Manifest prüfen. Gibt (json_entries, entries, bytes) oder wirft ValueError."""
    try:
        manifest = json.loads(raw)
        json_entries = manifest['json']
        entries = manifest['entries']
    except (ValueError, TypeError, KeyError, UnicodeDecodeError):
        raise ValueError('Ungültiges Manifest')

    if not isinstance(json_entries, dict) or set(json_entries) != set(CLOUD_JSON_ENTRIES):
        raise ValueError('Ungültiges Manifest')
    if not isinstance(entries, list):
        raise ValueError('Ungültiges Manifest')

    total = sum(len(text.encode()) for text in json_entries.values())
    for entry in entries:
        if (not isinstance(entry, dict)
                or not CLOUD_ENTRY_NAME.match(str(entry.get('name', '')))
                or not SHA256_HEX.match(str(entry.get('sha256', '')))
                or not isinstance(entry.get('size'), int) or entry['size'] < 0):
            raise ValueError('Ungültiger Eintrag im Manifest')
        total += entry['size']
    return json_entries, entries, total


@require_POST
def cloud_save_prepare(request):
    """Meldet, welche der angefragten Inhalts-Hashes der Server noch nicht hat.
    Reine Optimierung: Der Commit prüft unabhängig davon nochmal selbst."""
    denied = _cloud_denied(request)
    if denied:
        return denied
    try:
        payload = json.loads(request.body or b'{}')
    except ValueError:
        return JsonResponse({'error': 'Ungültige Anfrage'}, status=400)

    project = _get_stored_project(request, payload.get('project_id'))
    if project is None:
        return JsonResponse({'error': 'Projekt nicht gefunden'}, status=404)

    hashes = [h for h in payload.get('hashes') or [] if isinstance(h, str) and SHA256_HEX.match(h)]
    known = _stored_hash_index(project.file_path)
    return JsonResponse({'missing': [h for h in hashes if h not in known]})


@require_POST
def cloud_save(request):
    """Projekt speichern: mit project_id überschreiben, sonst neu anlegen.

    Zwei Wege: `manifest` (Delta, siehe oben) oder `project_zip` (komplettes
    ZIP). Der ZIP-Weg bleibt bestehen, damit Browser mit noch gecachtem altem
    JS-Bundle nach einem Deploy weiter speichern können.
    Gates: Read-Only (abgelaufen), Projektlimit (nur beim Anlegen), Grössen-Deckel."""
    denied = _cloud_denied(request)
    if denied:
        return denied
    denied = _cloud_read_only_denied(request)
    if denied:
        return denied

    # Das Manifest kommt als Datei-Part (canvas_data.json steckt inline drin und
    # sprengt bei grossen Projekten Djangos Formulardaten-Deckel); als Feld
    # akzeptieren wir es weiterhin, damit Tests und einfache Clients es einfach haben.
    manifest_file = request.FILES.get('manifest')
    manifest_raw = manifest_file.read() if manifest_file else request.POST.get('manifest')
    upload = request.FILES.get('project_zip')
    if not manifest_raw and not upload:
        return JsonResponse({'error': 'Keine Projektdatei erhalten'}, status=400)

    if manifest_raw:
        try:
            json_entries, entries, total_bytes = _parse_manifest(manifest_raw)
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=400)
    else:
        total_bytes = upload.size

    if total_bytes > settings.MAX_PROJECT_MB * 1024 * 1024:
        return JsonResponse({'error': f'Projekt zu gross (max. {settings.MAX_PROJECT_MB} MB). '
                             'Tipp: sehr grosse Original-PDFs vor dem Hochladen verkleinern.'}, status=413)

    name = (request.POST.get('name') or '').strip()[:200]
    project_id = request.POST.get('project_id')

    if project_id:
        project = _get_stored_project(request, project_id)
        if project is None:
            return JsonResponse({'error': 'Projekt nicht gefunden'}, status=404)
        if name:
            project.name = name
    else:
        quota = _cloud_quota_denied(request)
        if quota:
            return quota
        project = StoredProject(user=request.user, name=name or 'Unbenanntes Projekt')

    settings.CLOUD_PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

    if manifest_raw:
        uploaded = {field[len('blob_'):]: f for field, f in request.FILES.items()
                    if field.startswith('blob_') and SHA256_HEX.match(field[len('blob_'):])}
        stored_index = _stored_hash_index(project.file_path)
        # Der Commit entscheidet unabhängig von der prepare-Antwort, was fehlt:
        # so bleibt er auch bei einem Race (zweiter Tab) oder verschwundener
        # Datei korrekt und fordert das Fehlende einfach nach.
        missing = [e['sha256'] for e in entries
                   if e['sha256'] not in uploaded and e['sha256'] not in stored_index]
        if missing:
            return JsonResponse({'missing': sorted(set(missing))}, status=409)
        try:
            _assemble_cloud_zip(project.file_path, json_entries, entries,
                                uploaded, stored_index)
        except (ValueError, KeyError, zipfile.BadZipFile) as e:
            logger.warning("Delta-Speichern fehlgeschlagen: %s", e)
            return JsonResponse({'error': 'Projekt konnte nicht zusammengesetzt werden. '
                                 'Bitte nochmal speichern.'}, status=400)
    else:
        with open(project.file_path, 'wb') as f:
            for chunk in upload.chunks():
                f.write(chunk)

    project.size_bytes = project.file_path.stat().st_size
    project.save()
    return JsonResponse({'id': str(project.id), 'name': project.name})


def cloud_download(request, project_id):
    denied = _cloud_denied(request)
    if denied:
        return denied
    project = _get_stored_project(request, project_id)
    if project is None or not project.file_path.exists():
        raise Http404
    project.last_opened_at = timezone.now()
    project.save(update_fields=['last_opened_at'])
    return FileResponse(open(project.file_path, 'rb'), as_attachment=True,
                        filename=f'{project.name}.planli')


@require_POST
def cloud_rename(request, project_id):
    denied = _cloud_denied(request)
    if denied:
        return denied
    project = _get_stored_project(request, project_id)
    if project is None:
        return JsonResponse({'error': 'Projekt nicht gefunden'}, status=404)
    name = (request.POST.get('name') or '').strip()[:200]
    if not name:
        return JsonResponse({'error': 'Name darf nicht leer sein'}, status=400)
    project.name = name
    project.save(update_fields=['name', 'updated_at'])
    return JsonResponse({'id': str(project.id), 'name': project.name})


@require_POST
def cloud_duplicate(request, project_id):
    """Kopie eines Cloud-Projekts anlegen — rein serverseitig, ohne dass der
    Client das ZIP herunter- und wieder hochladen muss. Der Projektname in der
    metadata.json der Kopie bleibt der alte; das ist egal, weil beim Öffnen aus
    der Cloud der StoredProject-Name gewinnt.
    Gates wie beim Anlegen in cloud_save: Read-Only und Projektlimit."""
    denied = _cloud_denied(request) or _cloud_read_only_denied(request)
    if denied:
        return denied
    source = _get_stored_project(request, project_id)
    if source is None or not source.file_path.exists():
        return JsonResponse({'error': 'Projekt nicht gefunden'}, status=404)
    quota = _cloud_quota_denied(request)
    if quota:
        return quota

    suffix = ' (Kopie)'
    copy = StoredProject(user=request.user,
                         name=source.name[:200 - len(suffix)] + suffix)
    # Erst die Datei, dann die Zeile: ein Fehler beim Kopieren hinterlässt so
    # nie einen Listeneintrag ohne Datei.
    try:
        shutil.copyfile(source.file_path, copy.file_path)
        copy.size_bytes = copy.file_path.stat().st_size
        copy.save()
    except Exception:
        copy.file_path.unlink(missing_ok=True)
        raise
    return JsonResponse({'id': str(copy.id), 'name': copy.name})


@require_POST
def cloud_delete(request, project_id):
    """Löschen ist bewusst auch im Read-Only-Modus erlaubt (gibt Speicher frei)."""
    denied = _cloud_denied(request)
    if denied:
        return denied
    project = _get_stored_project(request, project_id)
    if project is None:
        return JsonResponse({'error': 'Projekt nicht gefunden'}, status=404)
    # Die .planli-Datei räumt das post_delete-Signal in core/models.py ab —
    # ein Weg für alle Löschpfade (hier, Kontoloeschung, Admin).
    project.delete()
    return JsonResponse({'status': 'ok'})
