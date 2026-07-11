import os
import uuid
import gc
import time
import json
import logging

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

from .models import Project, BugReport, AnalysisEvent
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
    keine KI-Analyse und kein Bearbeiten. Im BETA_MODE nie."""
    if settings.BETA_MODE or not request.user.is_authenticated:
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
    if not settings.BETA_MODE and not request.user.is_authenticated:
        return redirect_to_login(request.get_full_path())
    return render(request, 'app.html', {
        'beta_mode': settings.BETA_MODE,
        'read_only': _read_only(request),
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
    lines = [
        'User-agent: *',
        'Disallow: /admin/',
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

    pdf_path = output_dir / f"document_{source_index}.pdf"
    with open(pdf_path, 'wb') as f:
        for chunk in pdf_file.chunks():
            f.write(chunk)

    pdf_reader = PdfReader(str(pdf_path))
    page_sizes = []
    for page in pdf_reader.pages:
        media_box = page.mediabox
        page_sizes.append((float(media_box.width) * 0.352778, float(media_box.height) * 0.352778))

    images = None
    image_paths = []
    local_image_paths = []

    try:
        images = convert_from_path(str(pdf_path), dpi=PDF_DPI)
        page_count = len(images)
        for i, image in enumerate(images):
            image_path = output_dir / f"page_{source_index}_{i+1}.jpg"
            image.save(str(image_path), "JPEG", quality=JPEG_QUALITY, optimize=True)
            local_image_paths.append(str(image_path))
            image_paths.append(f"/project_files/{project_id}/uploads/page_{source_index}_{i+1}.jpg")
        del images
        gc.collect()
    except Exception as e:
        if images:
            del images
        gc.collect()
        raise e

    return {
        "session_id": project_id,
        "source_index": source_index,
        "image_paths": image_paths,
        "local_image_paths": local_image_paths,
        "page_count": page_count,
        "page_sizes": page_sizes,
    }


MAX_UPLOAD_SIZE = 40 * 1024 * 1024  # 40 MB


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
        return None, JsonResponse({'error': 'Datei zu gross. Maximum: 40 MB.'}, status=400)
    if file.read(4) != b'%PDF':
        return None, JsonResponse({'error': 'Ungültige PDF-Datei.'}, status=400)
    file.seek(0)
    return file, None


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
            pdf_info = _convert_pdf_to_images(file)
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
        return JsonResponse({'error': 'Deine Testphase ist abgelaufen — die KI-Analyse '
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
