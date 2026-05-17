import os
import uuid
import gc
import time
import json
import logging

from django.shortcuts import render
from django.http import JsonResponse, FileResponse, Http404
from django.views.decorators.http import require_POST
from django.contrib.auth.decorators import login_required
from django.conf import settings

from .models import Project

from pdf2image import convert_from_path
from PyPDF2 import PdfReader

from model_handler import predict_image, cleanup_memory

logger = logging.getLogger(__name__)

PROJECTS_DIR = settings.PROJECTS_DIR
PDF_DPI = settings.PDF_DPI
JPEG_QUALITY = settings.JPEG_QUALITY


def landing(request):
    return render(request, 'landing.html')


@login_required
def app(request):
    return render(request, 'app.html')


def datenschutz(request):
    return render(request, 'datenschutz.html')


def impressum(request):
    return render(request, 'impressum.html')


def serve_project_file(request, project_id, filename):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Nicht autorisiert'}, status=401)
    try:
        Project.objects.get(id=project_id, user=request.user)
    except Project.DoesNotExist:
        raise Http404
    project_dir = PROJECTS_DIR / project_id
    file_path = project_dir / filename
    if not file_path.exists():
        raise Http404("File not found")
    if not str(file_path.resolve()).startswith(str(project_dir.resolve())):
        raise Http404
    return FileResponse(open(file_path, 'rb'))


def _convert_pdf_to_images(pdf_file, project_id=None):
    if not project_id:
        project_id = str(uuid.uuid4())

    output_dir = PROJECTS_DIR / project_id / 'uploads'
    output_dir.mkdir(parents=True, exist_ok=True)

    pdf_path = output_dir / "document.pdf"
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
            image_path = output_dir / f"page_{i+1}.jpg"
            image.save(str(image_path), "JPEG", quality=JPEG_QUALITY, optimize=True)
            local_image_paths.append(str(image_path))
            image_paths.append(f"/project_files/{project_id}/uploads/page_{i+1}.jpg")
        del images
        gc.collect()
    except Exception as e:
        if images:
            del images
        gc.collect()
        raise e

    return {
        "session_id": project_id,
        "image_paths": image_paths,
        "local_image_paths": local_image_paths,
        "page_count": page_count,
        "page_sizes": page_sizes,
    }


MAX_UPLOAD_SIZE = 40 * 1024 * 1024  # 40 MB


@require_POST
def upload_file(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Nicht autorisiert'}, status=401)
    try:
        if 'file' not in request.FILES:
            return JsonResponse({'error': 'No file part'}, status=400)
        file = request.FILES['file']
        if not file.name:
            return JsonResponse({'error': 'No selected file'}, status=400)

        if not file.name.lower().endswith('.pdf'):
            return JsonResponse({'error': 'Nur PDF-Dateien sind erlaubt.'}, status=400)

        if file.size > MAX_UPLOAD_SIZE:
            return JsonResponse({'error': 'Datei zu gross. Maximum: 40 MB.'}, status=400)

        if file.read(4) != b'%PDF':
            return JsonResponse({'error': 'Ungültige PDF-Datei.'}, status=400)
        file.seek(0)

        try:
            pdf_info = _convert_pdf_to_images(file)
            Project.objects.create(
                id=pdf_info["session_id"],
                user=request.user,
                original_filename=file.name,
            )
            return JsonResponse({
                'is_pdf': True,
                'session_id': pdf_info["session_id"],
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
def analyze_page(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Nicht autorisiert'}, status=401)

    request_start = time.time()
    performance_metrics = {}

    try:
        session_id = request.POST.get('session_id')

        try:
            Project.objects.get(id=session_id, user=request.user)
        except Project.DoesNotExist:
            return JsonResponse({'error': 'Projekt nicht gefunden'}, status=404)

        page = int(request.POST.get('page', 1))
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

        pdf_files = [f for f in os.listdir(session_dir) if f.startswith('page_') and f.endswith('.jpg')]
        image_files = [f for f in os.listdir(session_dir) if f.startswith('image.')]

        is_pdf = len(pdf_files) > 0
        page_count = len(pdf_files) if is_pdf else len(image_files)

        if page < 1 or page > page_count:
            return JsonResponse({'error': 'Ungültige Seitenzahl'}, status=400)

        if is_pdf:
            image_filename = f"page_{page}.jpg"
            rel_image_path = f"/project_files/{session_id}/uploads/page_{page}.jpg"
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
            all_image_paths = [f"/project_files/{session_id}/uploads/page_{i+1}.jpg" for i in range(page_count)]
        else:
            all_image_paths = [rel_image_path]

        performance_metrics['total_request_time'] = time.time() - request_start
        cleanup_memory()

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


@require_POST
def save_training_data(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Nicht autorisiert'}, status=401)
    try:
        body = json.loads(request.body)
        session_id = body.get('session_id')
        if not session_id:
            return JsonResponse({'error': 'session_id fehlt'}, status=400)

        try:
            Project.objects.get(id=session_id, user=request.user)
        except Project.DoesNotExist:
            return JsonResponse({'error': 'Projekt nicht gefunden'}, status=404)

        training_data = {
            'session_id': session_id,
            'page_canvas_data': body.get('page_canvas_data', {}),
            'labels': body.get('labels', []),
            'exported_at': body.get('exported_at'),
        }

        project_dir = PROJECTS_DIR / session_id
        training_path = project_dir / 'training_data.json'
        with open(training_path, 'w', encoding='utf-8') as f:
            json.dump(training_data, f, ensure_ascii=False, indent=2)

        return JsonResponse({'status': 'ok'})

    except Exception as e:
        logger.exception("save_training_data error")
        return JsonResponse({'error': str(e)}, status=500)
