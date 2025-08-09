from flask import Flask, render_template, request, jsonify, url_for, send_from_directory
import os
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

import uuid
import datetime

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

@app.route('/minimal')
def minimal():
    return render_template('index-minimal.html')

@app.route('/predict', methods=['POST'])
def predict():
    # Performance-Timing starten
    request_start_time = time.time()
    performance_metrics = {}
    
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
        
        # Parameter aus der Anfrage lesen
        format_size = (
            float(request.form.get('format_width', 210)),  # Standard: A4 Breite in mm
            float(request.form.get('format_height', 297))  # Standard: A4 Höhe in mm
        )
        dpi = float(request.form.get('dpi', 300))  # Standard: 300 DPI
        plan_scale = float(request.form.get('plan_scale', 100))  # Standard: 1:100
        threshold = float(request.form.get('threshold', 0.5))  # Standard: 0.5
        page = int(request.form.get('page', 1))  # Standardmäßig erste Seite
        
        if file:
            # Überprüfen, ob es sich um eine PDF-Datei handelt
            if file.filename.lower().endswith('.pdf'):
                try:
                    # PDF-Datei in Bilder konvertieren
                    pdf_start_time = time.time()
                    pdf_info = convert_pdf_to_images(file)
                    performance_metrics['pdf_conversion_time'] = time.time() - pdf_start_time
                    
                    # Debug-Ausgabe für PDF-Informationen
                    print(f"PDF Info: {pdf_info['session_id']}, Seiten: {pdf_info['page_count']}")
                    
                    # Sicherstellen, dass die gewählte Seite gültig ist
                    if page < 1 or page > pdf_info["page_count"]:
                        page = 1

                    # Verwende die ausgelesene Seitengröße für die aktuelle Seite
                    if "page_sizes" in pdf_info and len(pdf_info["page_sizes"]) >= page:
                        format_size = pdf_info["page_sizes"][page-1]
                        print(f"Verwende ausgelesene Seitengröße für Seite {page}: {format_size[0]:.2f} x {format_size[1]:.2f} mm")

                    # Pfad zum Bild der aktuellen Seite (lokaler Pfad für Backend)
                    current_image_path = pdf_info["local_image_paths"][page-1]
                    
                    # Bilddaten der aktuellen Seite für die Vorhersage lesen
                    with open(current_image_path, 'rb') as f:
                        image_bytes = f.read()
                    
                    # Verwende konfigurierte DPI für PDF-Konvertierung
                    dpi = float(PDF_DPI)
                    is_pdf = True
                except Exception as e:
                    print(f"Fehler bei der PDF-Verarbeitung: {str(e)}")
                    return jsonify({'error': f'Error converting PDF: {str(e)}'}), 500
            else:
                # Normale Bilddatei
                image_bytes = file.read()
                pdf_info = None
                is_pdf = False
            
            # debug
            print(f"Starte Vorhersage mit Parametern: format={format_size}, dpi={dpi}, scale={plan_scale}, threshold={threshold}")
            
            # Bildvorhersage durchführen
            inference_start_time = time.time()
            boxes, labels, scores, areas = predict_image(
                image_bytes, 
                format_size=format_size, 
                dpi=dpi, 
                plan_scale=plan_scale, 
                threshold=threshold
            )
            performance_metrics['model_inference_time'] = time.time() - inference_start_time

            # debug
            # print(f"Prediction results: {len(boxes)} objects found")
            # print(f"Boxes: {boxes}")
            # print(f"Labels: {labels}")
            # print(f"Scores: {scores}")
            # print(f"Vorhersage abgeschlossen: {len(boxes)} Objekte gefunden")

            results = []
            for box, label, score, area in zip(boxes, labels, scores, areas):
                results.append({
                    'box': box.tolist(),
                    'label': int(label),
                    'score': round(float(score), 2),
                    'area': round(float(area), 2)
                })
            
            # Gesamtfläche berechnen
            total_area = sum(area for area in areas)
            
            response_data = {
                'predictions': results,
                'total_area': round(float(total_area), 2),
                'count': len(results)
            }
            
            # PDF-spezifische Informationen hinzufügen
            if is_pdf:
                response_data.update({
                    'is_pdf': True,
                    'pdf_image_url': pdf_info["image_paths"][page-1],
                    'current_page': page,
                    'page_count': int(pdf_info.get("page_count", 1)),
                    'all_pages': pdf_info["image_paths"],
                    'session_id': pdf_info["session_id"],
                    'page_sizes': pdf_info.get("page_sizes", []),
                    'actual_dpi': PDF_DPI  # Tatsächliche DPI für Frontend
                })
                # Debugging Ausgabe
                print(f"Sende Antwort mit page_sizes: {pdf_info.get('page_sizes', [])}")

            # Gesamte Request-Zeit berechnen
            performance_metrics['total_request_time'] = time.time() - request_start_time
            
            # Performance-Metriken zur Antwort hinzufügen
            response_data['performance_metrics'] = performance_metrics
            
            print(f"Final response data: {response_data}")
            print(f"Predictions in response: {len(response_data['predictions'])}")
            print(f"Performance Metrics: {performance_metrics}")

            # Memory cleanup nach Anfrage
            cleanup_memory()
                
            return jsonify(response_data)
        
        return jsonify({'error': 'Error processing file'}), 500
    
    except Exception as e:
        print(f"Allgemeiner Fehler: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/analyze_page', methods=['POST'])
def analyze_page():
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
        dpi = float(PDF_DPI)  # Verwende konfigurierte DPI
        plan_scale = float(request.form.get('plan_scale', 100))
        threshold = float(request.form.get('threshold', 0.5))
        
        # Überprüfe, ob die Session existiert (neue Struktur: projects/session_id/uploads/)
        session_dir = os.path.join(PROJECTS_DIR, session_id, 'uploads')
        if not os.path.exists(session_dir):
            print(f"Session-Verzeichnis nicht gefunden: {session_dir}")
            return jsonify({'error': 'PDF-Session nicht gefunden'}), 404
        
        # Ermittle die Anzahl verfügbarer Seiten
        image_files = [f for f in os.listdir(session_dir) if f.startswith('page_') and f.endswith('.jpg')]
        page_count = len(image_files)
        
        print(f"Gefundene Bilddateien: {image_files}")
        print(f"Seitenanzahl: {page_count}")
        
        if page < 1 or page > page_count:
            return jsonify({'error': 'Ungültige Seitenzahl'}), 400
        
        # Pfad zum Bild der aktuellen Seite
        image_path = os.path.join(session_dir, f"page_{page}.jpg")
        rel_image_path = f"/project_files/{session_id}/uploads/page_{page}.jpg"
        
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
            boxes, labels, scores, areas = predict_image(
                image_bytes, 
                format_size=format_size, 
                dpi=dpi, 
                plan_scale=plan_scale, 
                threshold=threshold
            )
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
        all_image_paths = [f"/project_files/{session_id}/uploads/page_{i+1}.jpg" for i in range(page_count)]
        
        # Gesamtfläche berechnen
        total_area = sum(area for area in areas)
        
        response_data = {
            'predictions': results,
            'total_area': round(float(total_area), 2),
            'count': len(results),
            'is_pdf': True,
            'pdf_image_url': rel_image_path,
            'current_page': page,
            'page_count': page_count,
            'all_pages': all_image_paths,
            'session_id': session_id,
            'actual_dpi': PDF_DPI  # Tatsächliche DPI für Frontend
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





# Projekte speichern
@app.route('/save_project', methods=['POST'])
def save_project():
    try:
        # Projektdaten aus dem Request-Body extrahieren
        data = request.json
        if not data:
            return jsonify({'error': 'Keine Daten erhalten'}), 400
            
        # Projektname und Session-ID extrahieren
        project_name = data.get('project_name', f"Projekt_{datetime.datetime.now().strftime('%Y-%m-%d_%H-%M')}")
        session_id = data.get('session_id')
        is_update = data.get('is_update', False)
        
        if not session_id:
            return jsonify({'error': 'Keine Session-ID angegeben'}), 400
        
        if is_update:
            # Update existing project
            project_id = session_id
            # Keep existing project name if not provided
            if not project_name:
                metadata_path = os.path.join(PROJECTS_DIR, project_id, 'metadata.json')
                if os.path.exists(metadata_path):
                    with open(metadata_path, 'r') as f:
                        existing_metadata = json.load(f)
                        project_name = existing_metadata.get('project_name', f"Projekt_{datetime.datetime.now().strftime('%Y-%m-%d_%H-%M')}")
        else:
            # Create new project with new UUID
            project_id = str(uuid.uuid4())
        
        # Projektverzeichnis behandeln
        project_dir = os.path.join(PROJECTS_DIR, project_id)
        
        if is_update:
            # For updates, project directory should already exist
            if not os.path.exists(project_dir):
                return jsonify({'error': 'Projekt-Session nicht gefunden'}), 404
        else:
            # For new projects, we might need to copy from session directory
            if session_id != project_id:
                # Copy from session directory to new project directory
                session_dir = os.path.join(PROJECTS_DIR, session_id)
                if os.path.exists(session_dir):
                    shutil.copytree(session_dir, project_dir)
                else:
                    return jsonify({'error': 'Session-Daten nicht gefunden'}), 404
        
        # Erstelle fehlende Unterverzeichnisse
        os.makedirs(os.path.join(project_dir, 'analysis'), exist_ok=True)
        
        # Original PDF-Datei sollte bereits im uploads-Ordner sein
        pdf_path = os.path.join(project_dir, 'uploads', 'document.pdf')
        if os.path.exists(pdf_path):
            shutil.copy(pdf_path, os.path.join(project_dir, 'original.pdf'))
        
        # Bildseiten von uploads nach pages kopieren
        uploads_dir = os.path.join(project_dir, 'uploads')
        pages_dir = os.path.join(project_dir, 'pages')
        os.makedirs(pages_dir, exist_ok=True)
        
        if os.path.exists(uploads_dir):
            for filename in os.listdir(uploads_dir):
                if filename.startswith('page_') and filename.endswith('.jpg'):
                    shutil.copy(
                        os.path.join(uploads_dir, filename),
                        os.path.join(pages_dir, filename)
                    )
        
        # Multi-Page Canvas-basierte Projektdaten (Single Source of Truth)
        canvas_data = data.get('canvas_data', {})
        data_format = data.get('data_format', 'canvas_v1')
        
        if data_format == 'multi_page_canvas_v1':
            # Multi-page format
            total_pages = canvas_data.get('total_pages', 1)
            pages_data = canvas_data.get('pages', {})
            total_annotations = sum(page.get('annotation_count', 0) for page in pages_data.values())
            print(f"Multi-Page Canvas-Projektdaten: {total_pages} Seiten, {total_annotations} Annotationen")
        else:
            # Legacy single-page format
            if not canvas_data.get('canvas_available', False):
                return jsonify({'error': 'Keine Canvas-Daten verfügbar'}), 400
            print(f"Single-Page Canvas-Projektdaten: {canvas_data.get('annotation_count', 0)} Annotationen")
        
        # Einstellungen vom Client holen
        settings = data.get('settings', {})
        
        # Labels vom Client holen
        labels = data.get('labels', [])
        line_labels = data.get('lineLabels', [])
        
        # Speichere globale Einstellungen
        with open(os.path.join(project_dir, 'analysis', 'analysis_settings.json'), 'w') as f:
            json.dump(settings, f, indent=2)
        
        # Speichere Labels
        with open(os.path.join(project_dir, 'analysis', 'labels.json'), 'w') as f:
            json.dump(labels, f, indent=2)
        
        # Speichere Line-Labels
        with open(os.path.join(project_dir, 'analysis', 'line_labels.json'), 'w') as f:
            json.dump(line_labels, f, indent=2)
        
        # Speichere Canvas-Daten (Single Source of Truth)
        canvas_save_path = os.path.join(project_dir, 'analysis', 'canvas_data.json')
        try:
            with open(canvas_save_path, 'w') as f:
                json.dump(canvas_data, f, indent=2)
            print(f"Canvas-Daten gespeichert: {canvas_save_path}")
        except Exception as e:
            print(f"Fehler beim Speichern der Canvas-Daten: {e}")
            return jsonify({'error': f'Fehler beim Speichern: {str(e)}'}), 500
        
        # Speichere Metadaten
        pages_dir = os.path.join(project_dir, 'pages')
        if os.path.exists(pages_dir):
            page_count = len([f for f in os.listdir(pages_dir) 
                             if f.endswith('.jpg') and f.startswith('page_')])
        else:
            page_count = 0
        
        # Handle metadata for Multi-Page Canvas-based projects
        if data_format == 'multi_page_canvas_v1':
            annotation_count = sum(page.get('annotation_count', 0) for page in canvas_data.get('pages', {}).values())
        else:
            annotation_count = canvas_data.get('annotation_count', 0)
        
        if is_update:
            # Load existing metadata and update it
            metadata_path = os.path.join(project_dir, 'metadata.json')
            if os.path.exists(metadata_path):
                with open(metadata_path, 'r') as f:
                    metadata = json.load(f)
                # Update fields
                metadata['project_name'] = project_name
                metadata['updated_at'] = datetime.datetime.now().isoformat()
                metadata['page_count'] = page_count
                metadata['annotation_count'] = annotation_count
                metadata['data_format'] = data_format
            else:
                # Fallback if metadata doesn't exist
                metadata = {
                    'project_name': project_name,
                    'created_at': datetime.datetime.now().isoformat(),
                    'page_count': page_count,
                    'project_id': project_id,
                    'annotation_count': annotation_count,
                    'data_format': data_format
                }
        else:
            # New project metadata
            metadata = {
                'project_name': project_name,
                'created_at': datetime.datetime.now().isoformat(),
                'page_count': page_count,
                'project_id': project_id,
                'annotation_count': annotation_count,
                'data_format': data_format
            }
        
        with open(os.path.join(project_dir, 'metadata.json'), 'w') as f:
            json.dump(metadata, f, indent=2)
        
        action = "aktualisiert" if is_update else "gespeichert"
        print(f"Projekt {project_name} erfolgreich {action}. {annotation_count} Annotationen gespeichert.")
        
        return jsonify({
            'success': True,
            'message': f'Projekt erfolgreich {action}',
            'project_id': project_id,
            'project_name': project_name,
            'annotation_count': annotation_count,
            'is_update': is_update
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# Projekte auflisten
@app.route('/list_projects', methods=['GET'])
def list_projects():
    try:
        print("list_projects wurde aufgerufen")
        projects = []
        projects_dir = PROJECTS_DIR
        
        print(f"Suche nach Projekten in: {projects_dir}")
        if not os.path.exists(projects_dir):
            print(f"Ordner {projects_dir} existiert nicht, erstelle ihn")
            os.makedirs(projects_dir, exist_ok=True)
            return jsonify({'success': True, 'projects': []})
        
        project_count = 0
        for project_id in os.listdir(projects_dir):
            project_path = os.path.join(projects_dir, project_id)
            print(f"Gefunden: {project_id}, ist Ordner: {os.path.isdir(project_path)}")
            if os.path.isdir(project_path):
                metadata_path = os.path.join(project_path, 'metadata.json')
                if os.path.exists(metadata_path):
                    print(f"Lade Metadaten aus: {metadata_path}")
                    with open(metadata_path, 'r') as f:
                        metadata = json.load(f)
                        projects.append(metadata)
                        project_count += 1
                else:
                    print(f"Metadaten-Datei nicht gefunden in: {metadata_path}")
        
        print(f"Insgesamt {project_count} Projekte gefunden")
        return jsonify({
            'success': True,
            'projects': projects
        })
        
    except Exception as e:
        import traceback
        print("Fehler beim Auflisten der Projekte:")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# Projekt laden
@app.route('/load_project/<project_id>', methods=['GET'])
def load_project(project_id):
    try:
        print(f"load_project aufgerufen mit ID: {project_id}")
        
        # Projektverzeichnis überprüfen
        project_dir = os.path.join(PROJECTS_DIR, project_id)
        print(f"Suche Projekt in: {project_dir}")
        if not os.path.exists(project_dir):
            print(f"Projektordner nicht gefunden: {project_dir}")
            return jsonify({'error': 'Projekt nicht gefunden'}), 404
        
        # Metadaten laden
        metadata_path = os.path.join(project_dir, 'metadata.json')
        if not os.path.exists(metadata_path):
            print(f"Metadaten-Datei nicht gefunden: {metadata_path}")
            return jsonify({'error': 'Projekt-Metadaten nicht gefunden'}), 404
            
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
        
        # Canvas-Daten laden (Single Source of Truth)
        analysis_dir = os.path.join(project_dir, 'analysis')
        canvas_data_path = os.path.join(analysis_dir, 'canvas_data.json')
        
        if not os.path.exists(canvas_data_path):
            print(f"Canvas-Daten nicht gefunden: {canvas_data_path}")
            return jsonify({'error': 'Canvas-Daten nicht gefunden. Projekt möglicherweise im alten Format.'}), 404
            
        with open(canvas_data_path, 'r') as f:
            canvas_data = json.load(f)
            print(f"Canvas-Daten geladen: {canvas_data.get('annotation_count', 0)} Annotationen")
        
        # Einstellungen laden
        settings_path = os.path.join(analysis_dir, 'analysis_settings.json')
        if os.path.exists(settings_path):
            with open(settings_path, 'r') as f:
                settings = json.load(f)
        else:
            settings = {}
        
        # Labels laden
        labels_path = os.path.join(analysis_dir, 'labels.json')
        if os.path.exists(labels_path):
            with open(labels_path, 'r') as f:
                labels = json.load(f)
        else:
            # Standard-Labels als Fallback
            labels = [
                {"id": 1, "name": "Fenster", "color": "#0000FF"},
                {"id": 2, "name": "Tür", "color": "#FF0000"},
                {"id": 3, "name": "Wand", "color": "#D4D638"},
                {"id": 4, "name": "Lukarne", "color": "#FFA500"},
                {"id": 5, "name": "Dach", "color": "#800080"}
            ]
        
        # Line-Labels laden
        line_labels_path = os.path.join(analysis_dir, 'line_labels.json')
        if os.path.exists(line_labels_path):
            with open(line_labels_path, 'r') as f:
                line_labels = json.load(f)
        else:
            # Standard-Line-Labels als Fallback
            line_labels = [
                {"id": 1, "name": "Strecke", "color": "#FF9500"},
                {"id": 2, "name": "Höhe", "color": "#00AAFF"},
                {"id": 3, "name": "Breite", "color": "#4CAF50"},
                {"id": 4, "name": "Abstand", "color": "#9C27B0"}
            ]
        
        # URLs für die Bildseiten erstellen
        image_urls = []
        pages_dir = os.path.join(project_dir, 'pages')
        for filename in sorted(os.listdir(pages_dir)):
            if filename.startswith('page_') and filename.endswith('.jpg'):
                # URL zum Bild erstellen (direkt aus dem Projektordner)
                image_url = f"/project_files/{project_id}/pages/{filename}"
                image_urls.append(image_url)
        
        # Determine data format from metadata
        project_data_format = metadata.get('data_format', 'canvas_v1')
        
        return jsonify({
            'success': True,
            'metadata': metadata,
            'canvas_data': canvas_data,  # Multi-page or single-page Canvas data
            'settings': settings,
            'labels': labels,
            'lineLabels': line_labels,
            'image_urls': image_urls,
            'data_format': project_data_format  # Pass through the actual format
        })
        
    except Exception as e:
        import traceback
        print("Fehler beim Laden des Projekts:")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


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
        
        # Prüfen, ob Original-PDF existiert
        original_pdf_path = os.path.join(project_dir, 'original.pdf')
        print(f"Prüfe Original-PDF: {original_pdf_path} (existiert: {os.path.exists(original_pdf_path)})")
        
        if not os.path.exists(original_pdf_path):
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