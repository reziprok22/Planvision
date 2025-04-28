from flask import Flask, render_template, request, jsonify, url_for
import os
from model_handler import load_model, predict_image
import shutil
import json
from pdf2image.exceptions import PDFInfoNotInstalledError, PDFPageCountError, PDFSyntaxError
import time
from pdf_export import generate_report_pdf

import tempfile
from pdf2image import convert_from_path
import logging

import uuid
import datetime

from PyPDF2 import PdfReader

os.makedirs('static/reports', exist_ok=True)


# Logging einrichten
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 2. Aktualisierte convert_pdf_to_images-Funktion
def convert_pdf_to_images(pdf_file_object):
    """
    Konvertiert eine PDF-Datei in mehrere JPG-Bilder (alle Seiten) und liest die Seitengrößen aus.
    
    Args:
        pdf_file_object: Das File-Objekt der hochgeladenen PDF-Datei
        
    Returns:
        dict: Ein Dictionary mit Informationen über die konvertierten Bilder
    """
    # Erstelle ein eindeutiges Verzeichnis für diese PDF
    timestamp = int(time.time())
    session_id = f"pdf_{timestamp}"
    output_dir = os.path.join('static', 'uploads', session_id)
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
    
    # Konvertiere alle Seiten der PDF zu Bildern
    images = convert_from_path(pdf_path, dpi=300)
    image_paths = []
    
    # Speichere jede Seite als JPG
    for i, image in enumerate(images):
        image_path = os.path.join(output_dir, f"page_{i+1}.jpg")
        image.save(image_path, "JPEG")
        # Relativen Pfad für das Frontend speichern
        rel_path = f"/static/uploads/{session_id}/page_{i+1}.jpg"
        image_paths.append(rel_path)
    
    # Informationen über die Konvertierung
    pdf_info = {
        "session_id": session_id,
        "pdf_path": pdf_path,
        "image_paths": image_paths,
        "page_count": len(images),
        "page_sizes": page_sizes  # Seitengrößen hinzufügen
    }
    print(f"PDF konvertiert: {len(images)} Seiten")
    for i, size in enumerate(page_sizes):
        print(f"Seite {i+1}: {size[0]:.2f} x {size[1]:.2f} mm")

    return pdf_info

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/predict', methods=['POST'])
def predict():
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
                    pdf_info = convert_pdf_to_images(file)
                    
                    # Debug-Ausgabe für PDF-Informationen
                    print(f"PDF Info: {pdf_info['session_id']}, Seiten: {pdf_info['page_count']}")
                    
                    # Sicherstellen, dass die gewählte Seite gültig ist
                    if page < 1 or page > pdf_info["page_count"]:
                        page = 1

                    # Verwende die ausgelesene Seitengröße für die aktuelle Seite
                    if "page_sizes" in pdf_info and len(pdf_info["page_sizes"]) >= page:
                        format_size = pdf_info["page_sizes"][page-1]
                        print(f"Verwende ausgelesene Seitengröße für Seite {page}: {format_size[0]:.2f} x {format_size[1]:.2f} mm")

                    # Pfad zum Bild der aktuellen Seite
                    current_image_path = pdf_info["image_paths"][page-1]
                    
                    # Bilddaten der aktuellen Seite für die Vorhersage lesen
                    full_image_path = os.path.join(os.getcwd(), current_image_path.lstrip('/'))
                    with open(full_image_path, 'rb') as f:
                        image_bytes = f.read()
                    
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
            boxes, labels, scores, areas = predict_image(
                image_bytes, 
                format_size=format_size, 
                dpi=dpi, 
                plan_scale=plan_scale, 
                threshold=threshold
            )
            
            # debug
            print(f"Vorhersage abgeschlossen: {len(boxes)} Objekte gefunden")

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
                    'page_sizes': pdf_info.get("page_sizes", [])  # Diese Zeile hinzufügen
                })
                # Debugging Ausgabe
                print(f"Sende Antwort mit page_sizes: {pdf_info.get('page_sizes', [])}")

                
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
        dpi = float(request.form.get('dpi', 300))
        plan_scale = float(request.form.get('plan_scale', 100))
        threshold = float(request.form.get('threshold', 0.5))
        
        # Überprüfe, ob die Session existiert
        session_dir = os.path.join('static', 'uploads', session_id)
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
        rel_image_path = f"/static/uploads/{session_id}/page_{page}.jpg"
        
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
        all_image_paths = [f"/static/uploads/{session_id}/page_{i+1}.jpg" for i in range(page_count)]
        
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
            'session_id': session_id
        }
        
        print(f"Antwortdaten: Seite {page} von {page_count}, {len(results)} Vorhersagen")
        
        return jsonify(response_data)
        
    except Exception as e:
        import traceback
        print(f"Fehler beim Analysieren der PDF-Seite: {str(e)}")
        print(traceback.format_exc())  # Vollständigen Stacktrace ausgeben
        return jsonify({'error': str(e)}), 500


# Ist zum überprüfen, ob PDF to jpfg richtig funktoniert, kann gelöscht werden.
@app.route('/debug_pdf', methods=['POST'])
def debug_pdf():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
        
        if file.filename.lower().endswith('.pdf'):
            try:
                logger.info(f"PDF-Datei erkannt: {file.filename}")
                image_bytes = convert_pdf_to_jpg(file)
                logger.info("PDF erfolgreich in JPG konvertiert")
                
                # Speichere das Bild temporär und gib den Pfad zurück
                debug_path = "static/temp_debug.jpg"
                with open(debug_path, 'wb') as debug_file:
                    debug_file.write(image_bytes)
                
                return jsonify({
                    'success': True,
                    'message': 'PDF erfolgreich konvertiert',
                    'image_path': debug_path,
                    'image_size': len(image_bytes)
                })
            except Exception as e:
                logger.error(f"PDF-Konvertierung fehlgeschlagen: {str(e)}")
                return jsonify({'error': f'PDF-Konvertierung fehlgeschlagen: {str(e)}'}), 500
        else:
            return jsonify({'error': 'Die hochgeladene Datei ist keine PDF-Datei'}), 400
    
    except Exception as e:
        logger.error(f"Fehler bei der Debug-Verarbeitung: {str(e)}")
        return jsonify({'error': str(e)}), 500

# Editor
@app.route('/save_edits', methods=['POST'])
def save_edits():
    try:
        data = request.json
        
        if not data or 'predictions' not in data:
            return jsonify({'error': 'Keine gültigen Daten erhalten'}), 400
        
        # Hier könnten Sie die bearbeiteten Daten in einer Datenbank 
        # oder einer JSON-Datei speichern
        # Zum Beispiel:
        # filename = f"edits_{datetime.datetime.now().strftime('%Y-%m-%d-%H-%M-%S')}.json"
        # with open(os.path.join('saved_edits', filename), 'w') as f:
        #     json.dump(data, f)
        
        return jsonify({
            'success': True,
            'message': 'Bearbeitungen erfolgreich gespeichert'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/debug')
def debug_page():
    return render_template('debug.html')

@app.route('/convert_pdf', methods=['POST'])
def convert_pdf_debug():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if not file.filename.lower().endswith('.pdf'):
        return jsonify({'error': 'Not a PDF file'}), 400
    
    try:
        # Speichere die PDF in einem statischen Verzeichnis zur Überprüfung
        os.makedirs('static/debug', exist_ok=True)
        pdf_path = 'static/debug/test.pdf'
        file.save(pdf_path)
        
        # Konvertiere die PDF zu JPG
        images = convert_from_path(pdf_path, first_page=1, last_page=1, dpi=300)
        
        if not images:
            return jsonify({'error': 'No images could be extracted from PDF'}), 500
        
        # Speichere das Bild
        jpg_path = 'static/debug/test.jpg'
        images[0].save(jpg_path, 'JPEG')
        
        # Überprüfe, ob die Datei existiert und die Größe
        if os.path.exists(jpg_path):
            file_size = os.path.getsize(jpg_path)
            return jsonify({
                'success': True,
                'message': f'PDF converted successfully. JPG size: {file_size} bytes',
                'jpg_url': '/static/debug/test.jpg',
                'pdf_url': '/static/debug/test.pdf'
            })
        else:
            return jsonify({'error': 'JPG file was not created'}), 500
            
    except Exception as e:
        return jsonify({'error': f'Error: {str(e)}'}), 500


# Projekte speichern
@app.route('/save_project', methods=['POST'])
def save_project():
    try:
        # Projektdaten aus dem Request-Body extrahieren
        data = request.json
        if not data:
            return jsonify({'error': 'Keine Daten erhalten'}), 400
            
        # Projekt-ID generieren
        project_id = str(uuid.uuid4())
        
        # Projektname und Session-ID extrahieren
        project_name = data.get('project_name', f"Projekt_{datetime.datetime.now().strftime('%Y-%m-%d_%H-%M')}")
        session_id = data.get('session_id')
        
        if not session_id:
            return jsonify({'error': 'Keine Session-ID angegeben'}), 400
        
        # Projektverzeichnis erstellen
        project_dir = os.path.join('projects', project_id)
        os.makedirs(project_dir, exist_ok=True)
        os.makedirs(os.path.join(project_dir, 'pages'), exist_ok=True)
        os.makedirs(os.path.join(project_dir, 'analysis'), exist_ok=True)
        
        # Original PDF-Datei kopieren (falls vorhanden)
        pdf_path = os.path.join('static', 'uploads', session_id, 'document.pdf')
        if os.path.exists(pdf_path):
            shutil.copy(pdf_path, os.path.join(project_dir, 'original.pdf'))
        
        # Bildseiten kopieren
        session_dir = os.path.join('static', 'uploads', session_id)
        if os.path.exists(session_dir):
            for filename in os.listdir(session_dir):
                if filename.startswith('page_') and filename.endswith('.jpg'):
                    shutil.copy(
                        os.path.join(session_dir, filename),
                        os.path.join(project_dir, 'pages', filename)
                    )
        
        # Speichere Analyse-Daten vom Client
        analysis_data = data.get('analysis_data', {})
        print(f"Projektdaten zum Speichern: {len(analysis_data)} Seiten")
        
        # Einstellungen vom Client holen
        settings = data.get('settings', {})
        
        # Labels vom Client holen
        labels = data.get('labels', [])
        
        # Speichere globale Einstellungen
        with open(os.path.join(project_dir, 'analysis', 'analysis_settings.json'), 'w') as f:
            json.dump(settings, f, indent=2)
        
        # Speichere Labels
        with open(os.path.join(project_dir, 'analysis', 'labels.json'), 'w') as f:
            json.dump(labels, f, indent=2)
        
        # Speichere Analyse-Ergebnisse pro Seite
        saved_pages = 0
        for page_num, page_data in analysis_data.items():
            # Stelle sicher, dass page_num als String behandelt wird
            page_filename = f"page_{str(page_num)}_results.json"
            save_path = os.path.join(project_dir, 'analysis', page_filename)
            
            try:
                with open(save_path, 'w') as f:
                    json.dump(page_data, f, indent=2)
                print(f"Gespeichert: {save_path}")
                saved_pages += 1
            except Exception as e:
                print(f"Fehler beim Speichern von Seite {page_num}: {e}")
        
        # Speichere Metadaten
        page_count = len([f for f in os.listdir(os.path.join(project_dir, 'pages')) 
                         if f.endswith('.jpg') and f.startswith('page_')])
        
        metadata = {
            'project_name': project_name,
            'created_at': datetime.datetime.now().isoformat(),
            'page_count': page_count,
            'project_id': project_id,
            'saved_pages': saved_pages
        }
        
        with open(os.path.join(project_dir, 'metadata.json'), 'w') as f:
            json.dump(metadata, f, indent=2)
        
        print(f"Projekt {project_name} erfolgreich gespeichert. {saved_pages} Seiten-Ergebnisse gespeichert.")
        
        return jsonify({
            'success': True,
            'message': 'Projekt erfolgreich gespeichert',
            'project_id': project_id,
            'project_name': project_name,
            'saved_pages': saved_pages
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
        projects_dir = 'projects'
        
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
        project_dir = os.path.join('projects', project_id)
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
        
        # Analyse-Daten laden
        analysis_dir = os.path.join(project_dir, 'analysis')
        analysis_data = {}
        
        # Analysedaten für jede Seite laden
        for filename in os.listdir(analysis_dir):
            if filename.startswith('page_') and filename.endswith('_results.json'):
                page_num = filename.split('_')[1]  # Extrahiere Seitennummer
                with open(os.path.join(analysis_dir, filename), 'r') as f:
                    page_data = json.load(f)
                    analysis_data[page_num] = page_data
        
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
        
        # URLs für die Bildseiten erstellen
        image_urls = []
        pages_dir = os.path.join(project_dir, 'pages')
        for filename in sorted(os.listdir(pages_dir)):
            if filename.startswith('page_') and filename.endswith('.jpg'):
                # Kopiere das Bild in den static/uploads Ordner für den Zugriff
                target_dir = os.path.join('static', 'uploads', project_id)
                os.makedirs(target_dir, exist_ok=True)
                
                # Kopiere die Datei, wenn sie noch nicht existiert
                if not os.path.exists(os.path.join(target_dir, filename)):
                    shutil.copy(
                        os.path.join(pages_dir, filename),
                        os.path.join(target_dir, filename)
                    )
                
                # URL zum Bild erstellen
                image_url = f"/static/uploads/{project_id}/{filename}"
                image_urls.append(image_url)
        
        return jsonify({
            'success': True,
            'metadata': metadata,
            'analysis_data': analysis_data,
            'settings': settings,
            'labels': labels,
            'image_urls': image_urls
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
        project_dir = os.path.join('projects', project_id)
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
        
        # Extrahiere den relativen Pfad für die URL
        if 'static/' in pdf_path:
            rel_path = '/static/' + pdf_path.split('static/')[1]
        else:
            rel_path = '/' + pdf_path  # Führender Slash hinzufügen
            print(f"Warnung: PDF-Pfad enthält nicht 'static/': {pdf_path}")
        
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
        project_dir = os.path.join('projects', project_id)
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
        
        # Extrahiere den relativen Pfad für die URL
        if 'static/' in pdf_path:
            rel_path = '/static/' + pdf_path.split('static/')[1]
        else:
            rel_path = '/' + pdf_path  # Führender Slash hinzufügen
            print(f"Warnung: PDF-Pfad enthält nicht 'static/': {pdf_path}")
        
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