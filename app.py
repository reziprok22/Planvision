from flask import Flask, render_template, request, jsonify, url_for, send_from_directory
import os
import uuid
from model_handler import load_model, predict_image, cleanup_memory
import shutil
import json
from pdf2image.exceptions import PDFInfoNotInstalledError, PDFPageCountError, PDFSyntaxError
import time
from pdf_export import generate_report_pdf

import tempfile
from pdf2image import convert_from_path
import logging
import gc
import atexit

from PyPDF2 import PdfReader

# Base directory für alle Pfade
# __file__ = Pfad zur aktuellen Python-Datei (app.py) 
# os.path.abspath(__file__) = Macht den Pfad absolut 
# os.path.dirname(...) = Entfernt den Dateinamen, behält nur das Verzeichnis
BASE_DIR = os.path.dirname(os.path.abspath(__file__)) 
PROJECTS_DIR = os.path.join(BASE_DIR, 'projects')

# Performance-Konfiguration
PDF_DPI = 150  # DPI für PDF-zu-Bild-Konvertierung (optimiert für Performance vs. Qualität)
JPEG_QUALITY = 70  # JPEG-Kompression (optimiert für Performance vs. Qualität)

# Erstellt den projects-Ordner falls er nicht existiert
os.makedirs(PROJECTS_DIR, exist_ok=True)

# Automatische Bereinigung alter Upload-Dateien (> 24h)
def cleanup_old_uploads():
    """Bereinigt alte Upload-Dateien um Speicherplatz zu sparen."""
    try:
        import time
        current_time = time.time()
        for project_id in os.listdir(PROJECTS_DIR):
            project_path = os.path.join(PROJECTS_DIR, project_id)
            if os.path.isdir(project_path):
                # Prüfe ob Metadaten existieren - wenn nicht, temporärer Upload
                metadata_path = os.path.join(project_path, 'metadata.json')
                if not os.path.exists(metadata_path):
                    # Prüfe Alter des Ordners
                    folder_age = current_time - os.path.getctime(project_path)
                    if folder_age > 86400:  # 24 Stunden
                        shutil.rmtree(project_path, ignore_errors=True)
                        print(f"Cleaned up old upload folder: {project_id}")
    except Exception as e:
        print(f"Error during cleanup: {e}")

# Cleanup bei App-Start
cleanup_old_uploads()

# Cleanup-Funktion für App-Beendigung
def cleanup_on_exit():
    cleanup_memory()
    gc.collect()

atexit.register(cleanup_on_exit)

# Logging einrichten
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 2. Aktualisierte convert_pdf_to_images-Funktion
def convert_pdf_to_images(pdf_file_object, project_id=None):
    """
    Konvertiert eine PDF-Datei in mehrere JPG-Bilder (alle Seiten) und liest die Seitengrößen aus.
    
    Args:
        pdf_file_object: Das File-Objekt der hochgeladenen PDF-Datei
        project_id: Optional project ID for direct storage in projects folder
        
    Returns:
        dict: Ein Dictionary mit Informationen über die konvertierten Bilder
    """
    # Generiere immer eine UUID für neue Uploads
    if not project_id:
        project_id = str(uuid.uuid4())
    
    # Speichere direkt im Projektordner
    output_dir = os.path.join(PROJECTS_DIR, project_id, 'uploads')
    session_id = project_id
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Speichere die PDF-Datei
    pdf_path = os.path.join(output_dir, "document.pdf")
    pdf_file_object.save(pdf_path)
    
    # PDF-Größen auslesen mit PyPDF2
    pdf_reader = PdfReader(pdf_path)
    page_sizes = []
    
    for page_num in range(len(pdf_reader.pages)):
        page = pdf_reader.pages[page_num]
        # Hole die Mediabox, die die Seitengröße in Punkten (1/72 Zoll) angibt
        media_box = page.mediabox
        # Umrechnung von Punkten in Millimeter (1 Punkt = 0,352778 mm)
        width_mm = float(media_box.width) * 0.352778
        height_mm = float(media_box.height) * 0.352778
        page_sizes.append((width_mm, height_mm))
    
    print("Ausgelesene PDF-Seitengrößen:", page_sizes)
    
    # Konvertiere alle Seiten der PDF zu Bildern (reduzierte DPI für RAM-Ersparnis)
    images = None
    image_paths = []
    local_image_paths = []  # Lokale Pfade für Backend-Zugriff
    page_count = 0
    
    try:
        images = convert_from_path(pdf_path, dpi=PDF_DPI)
        page_count = len(images)  # Anzahl speichern bevor images gelöscht wird
        
        # Speichere jede Seite als JPG mit Qualitätsoptimierung
        for i, image in enumerate(images):
            image_path = os.path.join(output_dir, f"page_{i+1}.jpg")
            # Speichere mit optimierter Qualität (Performance vs. Größe)
            image.save(image_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
            # Lokalen Pfad für Backend-Zugriff speichern
            local_image_paths.append(image_path)
            # URL-Pfad für Frontend-Anzeige
            rel_path = f"/project_files/{session_id}/uploads/page_{i+1}.jpg"
            image_paths.append(rel_path)
        
        # Memory cleanup nach PDF Konvertierung
        if images:
            del images
        gc.collect()
        
    except Exception as e:
        if images:
            del images
        gc.collect()
        raise e
    
    # Informationen über die Konvertierung
    pdf_info = {
        "session_id": session_id,
        "pdf_path": pdf_path,
        "image_paths": image_paths,  # URLs für Frontend
        "local_image_paths": local_image_paths,  # Lokale Pfade für Backend
        "page_count": page_count,
        "page_sizes": page_sizes  # Seitengrößen hinzufügen
    }
    print(f"PDF konvertiert: {page_count} Seiten")
    for i, size in enumerate(page_sizes):
        print(f"Seite {i+1}: {size[0]:.2f} x {size[1]:.2f} mm")

    return pdf_info

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/dist/<path:filename>')
def serve_dist_file(filename):
    """Serve bundled JavaScript files from dist directory"""
    dist_dir = os.path.join(BASE_DIR, 'dist')
    return send_from_directory(dist_dir, filename)

@app.route('/project_files/<project_id>/<path:filename>')
def serve_project_file(project_id, filename):
    """Serve files from project directories"""
    project_dir = os.path.join(PROJECTS_DIR, project_id)
    if not os.path.exists(project_dir):
        return "Project not found", 404
    return send_from_directory(project_dir, filename)

@app.route('/upload', methods=['POST'])
def upload_file():
    """
    Separater Upload-Endpoint: Konvertiert PDF zu Bildern ohne Analyse
    """
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
        
        # Parameter für Format-Detection (optional)
        format_width = request.form.get('format_width')
        format_height = request.form.get('format_height')
        
        if file:
            # Überprüfen, ob es sich um eine PDF-Datei handelt
            if file.filename.lower().endswith('.pdf'):
                try:
                    # PDF-Datei in Bilder konvertieren (ohne Analyse)
                    pdf_info = convert_pdf_to_images(file)
                    
                    response_data = {
                        'is_pdf': True,
                        'session_id': pdf_info["session_id"],
                        'page_count': int(pdf_info.get("page_count", 1)),
                        'all_pages': pdf_info["image_paths"],
                        'page_sizes': pdf_info.get("page_sizes", []),
                        'filename': file.filename
                    }
                    
                    print(f"Upload erfolgreich: {file.filename}, Session: {pdf_info['session_id']}, Seiten: {pdf_info['page_count']}")
                    return jsonify(response_data)
                    
                except Exception as e:
                    print(f"Fehler bei der PDF-Verarbeitung: {str(e)}")
                    return jsonify({'error': f'Error converting PDF: {str(e)}'}), 500
            else:
                # Normale Bilddatei - erstelle Session für Konsistenz
                project_id = str(uuid.uuid4())
                output_dir = os.path.join(PROJECTS_DIR, project_id, 'uploads')
                os.makedirs(output_dir, exist_ok=True)
                
                # Speichere das Bild
                image_path = os.path.join(output_dir, f"image.{file.filename.split('.')[-1]}")
                file.save(image_path)
                
                # URL für Frontend
                rel_path = f"/project_files/{project_id}/uploads/image.{file.filename.split('.')[-1]}"
                
                response_data = {
                    'is_pdf': False,
                    'session_id': project_id,
                    'page_count': 1,
                    'all_pages': [rel_path],
                    'page_sizes': [],  # Wird bei Bildern nicht automatisch erkannt
                    'filename': file.filename
                }
                
                print(f"Bild hochgeladen: {file.filename}, Session: {project_id}")
                return jsonify(response_data)
        
        return jsonify({'error': 'Error processing file'}), 500
    
    except Exception as e:
        print(f"Upload-Fehler: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/analyze_page', methods=['POST'])
def analyze_page():
    """
    Separater Analyse-Endpoint: Analysiert einzelne Seiten von hochgeladenen Dokumenten
    """
    # Performance-Timing starten
    request_start_time = time.time()
    performance_metrics = {}
    
    try:
        # Parameter aus der Anfrage lesen
        session_id = request.form.get('session_id')
        page = int(request.form.get('page', 1))
        
        print(f"Analyze Page: Session {session_id}, Seite {page}")
        
        # Parameter für die Bildanalyse
        format_size = (
            float(request.form.get('format_width', 210)),
            float(request.form.get('format_height', 297))
        )
        dpi = float(request.form.get('dpi', PDF_DPI))  # Verwende gegebene oder Standard-DPI
        plan_scale = float(request.form.get('plan_scale', 100))
        threshold = float(request.form.get('threshold', 0.5))
        
        # Überprüfe, ob die Session existiert
        session_dir = os.path.join(PROJECTS_DIR, session_id, 'uploads')
        if not os.path.exists(session_dir):
            print(f"Session-Verzeichnis nicht gefunden: {session_dir}")
            return jsonify({'error': 'Session nicht gefunden'}), 404
        
        # Ermittle verfügbare Dateien (PDF-Seiten oder Einzelbild)
        pdf_files = [f for f in os.listdir(session_dir) if f.startswith('page_') and f.endswith('.jpg')]
        image_files = [f for f in os.listdir(session_dir) if f.startswith('image.')]
        
        is_pdf = len(pdf_files) > 0
        page_count = len(pdf_files) if is_pdf else len(image_files)
        
        print(f"Ist PDF: {is_pdf}, Seitenanzahl: {page_count}")
        
        if page < 1 or page > page_count:
            return jsonify({'error': 'Ungültige Seitenzahl'}), 400
        
        # Bestimme Bildpfad basierend auf Dokumenttyp
        if is_pdf:
            image_filename = f"page_{page}.jpg"
            rel_image_path = f"/project_files/{session_id}/uploads/page_{page}.jpg"
        else:
            # Einzelbild - finde die Datei
            image_filename = image_files[0] if image_files else None
            if not image_filename:
                return jsonify({'error': 'Keine Bilddatei gefunden'}), 404
            rel_image_path = f"/project_files/{session_id}/uploads/{image_filename}"
        
        image_path = os.path.join(session_dir, image_filename)
        
        print(f"Bildpfad: {image_path}")
        
        # Überprüfe, ob das Bild existiert
        if not os.path.exists(image_path):
            print(f"Bilddatei nicht gefunden: {image_path}")
            return jsonify({'error': f'Bild für Seite {page} nicht gefunden'}), 404
        
        # Bild für die Vorhersage laden
        try:
            with open(image_path, 'rb') as f:
                image_bytes = f.read()
        except Exception as e:
            print(f"Fehler beim Lesen der Bilddatei: {e}")
            return jsonify({'error': f'Fehler beim Lesen des Bildes: {str(e)}'}), 500
        
        # Bildvorhersage durchführen
        try:
            inference_start_time = time.time()
            boxes, labels, scores, areas = predict_image(
                image_bytes, 
                format_size=format_size, 
                dpi=dpi, 
                plan_scale=plan_scale, 
                threshold=threshold
            )
            performance_metrics['model_inference_time'] = time.time() - inference_start_time
        except Exception as e:
            print(f"Fehler bei der Bildvorhersage: {e}")
            return jsonify({'error': f'Fehler bei der Analyse: {str(e)}'}), 500
        
        # Ergebnisse formatieren
        results = []
        for box, label, score, area in zip(boxes, labels, scores, areas):
            results.append({
                'box': box.tolist(),
                'label': int(label),
                'score': round(float(score), 2),
                'area': round(float(area), 2)
            })
        
        # Alle Bildpfade für die Navigation
        if is_pdf:
            all_image_paths = [f"/project_files/{session_id}/uploads/page_{i+1}.jpg" for i in range(page_count)]
        else:
            all_image_paths = [rel_image_path]
        
        # Gesamtfläche berechnen
        total_area = sum(area for area in areas)
        
        # Gesamte Request-Zeit berechnen
        performance_metrics['total_request_time'] = time.time() - request_start_time
        
        response_data = {
            'predictions': results,
            'total_area': round(float(total_area), 2),
            'count': len(results),
            'is_pdf': is_pdf,
            'pdf_image_url': rel_image_path,
            'current_page': page,
            'page_count': page_count,
            'all_pages': all_image_paths,
            'session_id': session_id,
            'actual_dpi': dpi,
            'performance_metrics': performance_metrics
        }
        
        print(f"Antwortdaten: Seite {page} von {page_count}, {len(results)} Vorhersagen")
        
        # Memory cleanup nach Anfrage
        cleanup_memory()
        
        return jsonify(response_data)
        
    except Exception as e:
        import traceback
        print(f"Fehler beim Analysieren der PDF-Seite: {str(e)}")
        print(traceback.format_exc())  # Vollständigen Stacktrace ausgeben
        return jsonify({'error': str(e)}), 500





@app.route('/restore_analysis/<session_id>', methods=['POST'])
def restore_analysis(session_id):
    """
    Restores server-side analysis data after loading a ZIP project.
    Creates the analysis directory structure needed for PDF export.
    """
    try:
        payload = request.get_json()
        project_dir = os.path.join(PROJECTS_DIR, session_id)

        if not os.path.exists(project_dir):
            return jsonify({'success': False, 'error': 'Session nicht gefunden'}), 404

        analysis_dir = os.path.join(project_dir, 'analysis')
        os.makedirs(analysis_dir, exist_ok=True)

        # Save per-page prediction results
        for page_num, predictions in payload.get('analysis', {}).items():
            path = os.path.join(analysis_dir, f'page_{page_num}_results.json')
            with open(path, 'w') as f:
                json.dump({'predictions': predictions}, f)

        # Save labels
        if 'labels' in payload:
            with open(os.path.join(analysis_dir, 'labels.json'), 'w') as f:
                json.dump(payload['labels'], f)

        # Save analysis settings
        if 'settings' in payload:
            with open(os.path.join(analysis_dir, 'analysis_settings.json'), 'w') as f:
                json.dump(payload['settings'], f)

        # Save project metadata
        if 'metadata' in payload:
            with open(os.path.join(project_dir, 'metadata.json'), 'w') as f:
                json.dump(payload['metadata'], f)

        # Copy uploaded PDF to expected location for export_annotated_pdf
        pdf_src = os.path.join(project_dir, 'uploads', 'document.pdf')
        pdf_dst = os.path.join(project_dir, 'original.pdf')
        if os.path.exists(pdf_src) and not os.path.exists(pdf_dst):
            import shutil
            shutil.copy2(pdf_src, pdf_dst)

        return jsonify({'success': True})

    except Exception as e:
        print(f'restore_analysis error: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


# Endpunkt zum Erstellen des PDF-Berichts
@app.route('/export_pdf/<project_id>', methods=['GET'])
def export_pdf(project_id):
    try:
        project_dir = os.path.join(PROJECTS_DIR, project_id)
        print(f"Suche Projekt in: {project_dir}")
        
        if not os.path.exists(project_dir):
            print(f"Projektordner nicht gefunden: {project_dir}")
            return jsonify({
                'success': False, 
                'error': 'Projekt wurde nicht gefunden. Bitte speichern Sie das Projekt zuerst.'
            }), 404
        
        # Mehr Debug-Ausgaben hinzufügen
        print(f"Projekt gefunden, generiere Bericht für ID: {project_id}")
        
        # PDF-Bericht generieren mit besserer Fehlerbehandlung
        try:
            pdf_path = generate_report_pdf(project_id)
            print(f"PDF erfolgreich generiert: {pdf_path}")
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"Fehler beim Generieren des PDF-Berichts: {e}")
            return jsonify({'success': False, 'error': f'Fehler beim Generieren des Berichts: {str(e)}'}), 500
        
        # Prüfen, ob die Datei existiert
        if not os.path.exists(pdf_path):
            print(f"Generierte PDF-Datei nicht gefunden: {pdf_path}")
            return jsonify({'success': False, 'error': 'Generierte PDF-Datei wurde nicht gefunden'}), 500
        
        # Extrahiere den relativen Pfad für die URL (neue Struktur)
        if 'projects/' in pdf_path:
            # Neuer Pfad: projects/project_id/reports/filename.pdf
            path_parts = pdf_path.split('projects/')[1]  # project_id/reports/filename.pdf
            rel_path = '/project_files/' + path_parts
        else:
            # Fallback
            rel_path = '/' + pdf_path
            print(f"Warnung: PDF-Pfad enthält nicht 'projects/': {pdf_path}")
        
        print(f"Relativer Pfad für URL: {rel_path}")
        
        return jsonify({
            'success': True,
            'message': 'PDF-Bericht wurde erfolgreich erstellt',
            'pdf_url': rel_path
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/export_annotated_pdf/<project_id>', methods=['GET'])
def export_annotated_pdf(project_id):
    try:
        project_dir = os.path.join(PROJECTS_DIR, project_id)
        print(f"Suche Projekt in: {project_dir}")
        
        if not os.path.exists(project_dir):
            print(f"Projektordner nicht gefunden: {project_dir}")
            return jsonify({
                'success': False, 
                'error': 'Projekt wurde nicht gefunden. Bitte speichern Sie das Projekt zuerst.'
            }), 404
        
        # Prüfen, ob Original-PDF existiert; Fallback auf uploads/document.pdf
        original_pdf_path = os.path.join(project_dir, 'original.pdf')
        if not os.path.exists(original_pdf_path):
            fallback_pdf = os.path.join(project_dir, 'uploads', 'document.pdf')
            if os.path.exists(fallback_pdf):
                import shutil
                shutil.copy2(fallback_pdf, original_pdf_path)
                print(f"original.pdf aus uploads/document.pdf kopiert")
            else:
                print(f"Original-PDF nicht gefunden: {original_pdf_path}")
                return jsonify({
                    'success': False,
                    'error': 'Original-PDF wurde nicht gefunden. Diese Funktion ist nur für PDF-Projekte verfügbar.'
                }), 400
        
        # PDF-Bericht mit Annotationen auf Original-PDF generieren mit besserer Fehlerbehandlung
        try:
            from pdf_export import generate_annotated_pdf
            pdf_path = generate_annotated_pdf(project_id)
            print(f"Annotierte PDF generiert: {pdf_path}")
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"Fehler beim Generieren der annotierten PDF: {e}")
            return jsonify({'success': False, 'error': f'Fehler beim Generieren der PDF: {str(e)}'}), 500
        
        # Prüfen, ob die Datei existiert
        if not os.path.exists(pdf_path):
            print(f"Generierte PDF-Datei nicht gefunden: {pdf_path}")
            return jsonify({'success': False, 'error': 'Generierte PDF-Datei wurde nicht gefunden'}), 500
        
        # Extrahiere den relativen Pfad für die URL (neue Struktur)
        if 'projects/' in pdf_path:
            # Neuer Pfad: projects/project_id/reports/filename.pdf
            path_parts = pdf_path.split('projects/')[1]  # project_id/reports/filename.pdf
            rel_path = '/project_files/' + path_parts
        else:
            # Fallback
            rel_path = '/' + pdf_path
            print(f"Warnung: PDF-Pfad enthält nicht 'projects/': {pdf_path}")
        
        print(f"Relativer Pfad für URL: {rel_path}")
        
        return jsonify({
            'success': True,
            'message': 'Annotierte PDF wurde erfolgreich erstellt',
            'pdf_url': rel_path
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# Nach dem Serverstart
if __name__ == '__main__':
    # Stelle sicher, dass der Projektordner existiert
    os.makedirs('projects', exist_ok=True)
    
    # Versuche, das Modell zu Beginn zu laden
    try:
        load_model()
        app.run(debug=True)
    except Exception as e:
        print(f"Error loading model: {e}")