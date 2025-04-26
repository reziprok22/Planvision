import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Image, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import PageBreak
from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont
import json
import datetime



def generate_report_pdf(project_id, output_path=None):
    """
    Generiert einen PDF-Bericht für ein Projekt mit Bildern und Ergebnistabellen.
    
    Args:
        project_id: Die ID des Projekts
        output_path: Optionaler Pfad zum Speichern der PDF
    
    Returns:
        PDF-Datei-Pfad
    """
    # Projektverzeichnisse
    project_dir = os.path.join('projects', project_id)
    metadata_path = os.path.join(project_dir, 'metadata.json')
    
    print(f"Generiere PDF für Projekt: {project_id}")
    print(f"Projektpfad: {project_dir}")
    
    # Prüfen, ob Projektverzeichnis existiert
    if not os.path.exists(project_dir):
        raise FileNotFoundError(f"Projektverzeichnis nicht gefunden: {project_dir}")
    
    # Metadaten laden
    try:
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
    except FileNotFoundError:
        print(f"Metadatendatei nicht gefunden: {metadata_path}")
        # Fallback-Metadaten
        metadata = {
            "project_name": f"Projekt_{project_id}",
            "created_at": datetime.datetime.now().isoformat(),
            "page_count": len([f for f in os.listdir(os.path.join(project_dir, 'pages')) 
                                if f.endswith('.jpg') and f.startswith('page_')])
        }
    
    project_name = metadata.get('project_name', 'Unbenanntes Projekt')
    date_created = metadata.get('created_at', datetime.datetime.now().isoformat())
    page_count = metadata.get('page_count', 0)

    # Nach dem Laden der Metadaten:
    print(f"Prüfe Verzeichnisstruktur für Projekt {project_id}:")
    print(f"Verfügbare Dateien im pages-Verzeichnis:")
    pages_dir = os.path.join(project_dir, 'pages')
    if os.path.exists(pages_dir):
        print([f for f in os.listdir(pages_dir)])
    else:
        print(f"Verzeichnis {pages_dir} existiert nicht!")

    print(f"Verfügbare Dateien im analysis-Verzeichnis:")
    analysis_dir = os.path.join(project_dir, 'analysis')
    if os.path.exists(analysis_dir):
        print([f for f in os.listdir(analysis_dir)])
    else:
        print(f"Verzeichnis {analysis_dir} existiert nicht!")
    
    # PDF-Dateinamen erstellen
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    if output_path is None:
        # Speichern im static/reports-Verzeichnis
        reports_dir = os.path.join('static', 'reports')
        os.makedirs(reports_dir, exist_ok=True)
        
        safe_name = project_name.replace(' ', '_').replace('/', '_').replace('\\', '_')
        output_path = os.path.join(reports_dir, f"{safe_name}_{timestamp}.pdf")
    
    print(f"PDF wird erstellt unter: {output_path}")
    
    # PDF-Dokument erstellen
    doc = SimpleDocTemplate(output_path, pagesize=A4, rightMargin=20*mm, leftMargin=20*mm, topMargin=20*mm, bottomMargin=20*mm)
    styles = getSampleStyleSheet()
    
    # Eigenen Stil für Überschriften erstellen
    title_style = ParagraphStyle(
        'TitleStyle',
        parent=styles['Heading1'],
        alignment=TA_CENTER,
        fontSize=16,
        spaceAfter=10
    )
    
    subtitle_style = ParagraphStyle(
        'SubtitleStyle',
        parent=styles['Heading2'],
        fontSize=14,
        spaceAfter=6
    )
    
    normal_style = styles['Normal']
    
    # Inhalte für das PDF
    elements = []
    
    # Titelseite
    elements.append(Paragraph(f"Fenster-Erkennungsbericht", title_style))
    elements.append(Paragraph(f"Projekt: {project_name}", subtitle_style))
    elements.append(Paragraph(f"Erstellt am: {datetime.datetime.fromisoformat(date_created).strftime('%d.%m.%Y %H:%M')}", normal_style))
    elements.append(Paragraph(f"Anzahl Seiten: {page_count}", normal_style))
    elements.append(Spacer(1, 20*mm))
    
    # Zusammenfassung aller Seiten
    total_fenster = 0
    total_tuer = 0
    total_wand = 0
    total_lukarne = 0
    total_dach = 0
    total_fenster_area = 0
    total_tuer_area = 0
    total_wand_area = 0
    total_lukarne_area = 0
    total_dach_area = 0
    
    # Seiten-Daten laden und Zusammenfassung berechnen
    for page_num in range(1, page_count + 1):
        analysis_path = os.path.join(project_dir, 'analysis', f'page_{page_num}_results.json')
        if os.path.exists(analysis_path):
            with open(analysis_path, 'r') as f:
                page_data = json.load(f)
            
            # Zählen und Flächen summieren
            if 'count' in page_data and 'total_area' in page_data:
                total_fenster += page_data['count'].get('fenster', 0)
                total_tuer += page_data['count'].get('tuer', 0)
                total_wand += page_data['count'].get('wand', 0)
                total_lukarne += page_data['count'].get('lukarne', 0)
                total_dach += page_data['count'].get('dach', 0)
                
                total_fenster_area += page_data['total_area'].get('fenster', 0)
                total_tuer_area += page_data['total_area'].get('tuer', 0)
                total_wand_area += page_data['total_area'].get('wand', 0)
                total_lukarne_area += page_data['total_area'].get('lukarne', 0)
                total_dach_area += page_data['total_area'].get('dach', 0)
    
    # Zusammenfassungstabelle
    elements.append(Paragraph("Zusammenfassung", subtitle_style))
    
    data = [
        ["Typ", "Anzahl", "Gesamtfläche (m²)"],
        ["Fenster", total_fenster, f"{total_fenster_area:.2f}"],
        ["Türen", total_tuer, f"{total_tuer_area:.2f}"],
        ["Wände", total_wand, f"{total_wand_area:.2f}"],
        ["Lukarnen", total_lukarne, f"{total_lukarne_area:.2f}"],
        ["Dächer", total_dach, f"{total_dach_area:.2f}"],
        ["Gesamt", total_fenster + total_tuer + total_wand + total_lukarne + total_dach, 
         f"{(total_fenster_area + total_tuer_area + total_wand_area + total_lukarne_area + total_dach_area):.2f}"]
    ]
    
    summary_table = Table(data, colWidths=[75*mm, 35*mm, 50*mm])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.black),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, -1), (-1, -1), colors.lightgrey),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 1, colors.black),
        ('ALIGN', (1, 1), (-1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    
    elements.append(summary_table)
    elements.append(Spacer(1, 20*mm))

    # Seiten-Daten laden und Zusammenfassung berechnen
    print(f"Verarbeite {page_count} Seiten")
    
    # Für jede Seite ein eigenes Kapitel
    for page_num in range(1, page_count + 1):
        # Verschiedene mögliche Dateimuster überprüfen
        possible_page_paths = [
            os.path.join(project_dir, 'pages', f"page_{page_num}.jpg"),
            os.path.join(project_dir, 'pages', f"page_{page_num:02d}.jpg"),  # Mit führender Null
            os.path.join(project_dir, 'pages', f"{page_num}.jpg")
        ]
        
        # Suche nach dem ersten existierenden Pfad
        page_path = None
        for path in possible_page_paths:
            if os.path.exists(path):
                page_path = path
                break
                
        # Ähnlich für Analysedateien
        possible_analysis_paths = [
            os.path.join(project_dir, 'analysis', f"page_{page_num}_results.json"),
            os.path.join(project_dir, 'analysis', f"page_{page_num:02d}_results.json"),
            os.path.join(project_dir, 'analysis', f"{page_num}_results.json")
        ]
        
        analysis_path = None
        for path in possible_analysis_paths:
            if os.path.exists(path):
                analysis_path = path
                break
        
        # print(f"Seite {page_num}: Bild gefunden: {page_path is not None}, Analyse gefunden: {analysis_path is not None}")
        
        # Seitentitel
        elements.append(Paragraph(f"Seite {page_num}", subtitle_style))
        
        # Prüfen, ob das Bild und die Analyse existieren
        if not page_path or not analysis_path:
            elements.append(Paragraph(f"Keine vollständigen Daten für Seite {page_num} verfügbar", normal_style))
            elements.append(Spacer(1, 10*mm))
            
            # Dennoch Seitenumbruch einfügen (außer für die letzte Seite)
            if page_num < page_count:
                print(f"Füge Seitenumbruch nach Seite {page_num} ein")
                elements.append(PageBreak())
                
            continue
        
        # Analyse-Daten laden
        with open(analysis_path, 'r') as f:
            page_data = json.load(f)
        
        # Originalbild laden
        img = PILImage.open(page_path)
        
        # Bild mit Annotationen kopieren und zeichnen
        annotated_img = img.copy()
        draw = ImageDraw.Draw(annotated_img)
        
        max_width = 170 * mm  # Maximale Breite für das Bild im PDF
        img_width, img_height = img.size
        scale_factor = min(max_width / img_width, 1.0)
        
        # Alle Annotationen auf das Bild zeichnen
        for idx, pred in enumerate(page_data.get('predictions', [])):
            if 'box' in pred:
                x1, y1, x2, y2 = pred['box']
                label = pred.get('label', 0)
                area = pred.get('area', 0)
                
                # Farbe basierend auf dem Label
                color_map = {
                    1: (0, 0, 255),      # Fenster - Blau
                    2: (255, 0, 0),      # Tür - Rot
                    3: (212, 214, 56),   # Wand - Gelb
                    4: (255, 165, 0),    # Lukarne - Orange
                    5: (128, 0, 128),    # Dach - Lila
                    0: (128, 128, 128)   # Andere - Grau
                }
                
                color = color_map.get(label, (0, 0, 0))
                
                # Box zeichnen
                draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
                
                # Beschriftung hinzufügen
                label_text = f"#{idx+1}: {area:.2f} m²"
                try:
                    # Versuche, eine Schriftart zu laden (optional)
                    font = ImageFont.load_default()
                    draw.rectangle([x1, y1-20, x1 + len(label_text)*7, y1], fill=color)
                    draw.text((x1+2, y1-18), label_text, fill=(255,255,255), font=font)
                except:
                    # Fallback ohne Schriftart
                    draw.rectangle([x1, y1-15, x1 + len(label_text)*7, y1], fill=color)
                    draw.text((x1+2, y1-14), label_text, fill=(255,255,255))
        
        # Temporären Pfad für das annotierte Bild erstellen
        annotated_path = os.path.join('static', 'temp', f"annotated_page_{page_num}_{timestamp}.jpg")
        os.makedirs(os.path.dirname(annotated_path), exist_ok=True)
        
        # Annotiertes Bild speichern
        annotated_img.save(annotated_path)
        
        # Bild zum PDF hinzufügen (skaliert)
        elements.append(Image(annotated_path, width=img_width*scale_factor, height=img_height*scale_factor))
        elements.append(Spacer(1, 5*mm))
        
        # Zusammenfassung für diese Seite
        if 'count' in page_data and 'total_area' in page_data:
            elements.append(Paragraph(f"Ergebnisse für Seite {page_num}", normal_style))
            
            page_summary = [
                ["Typ", "Anzahl", "Gesamtfläche (m²)"]
            ]
            
            for obj_type, count in [
                ("Fenster", page_data['count'].get('fenster', 0)),
                ("Türen", page_data['count'].get('tuer', 0)),
                ("Wände", page_data['count'].get('wand', 0)),
                ("Lukarnen", page_data['count'].get('lukarne', 0)),
                ("Dächer", page_data['count'].get('dach', 0))
            ]:
                if count > 0:
                    area = page_data['total_area'].get(obj_type.lower().replace('ä', 'a').replace('ü', 'u'), 0)
                    page_summary.append([obj_type, count, f"{area:.2f}"])
            
            if len(page_summary) > 1:  # Nur hinzufügen, wenn es tatsächlich Ergebnisse gibt
                page_table = Table(page_summary, colWidths=[75*mm, 35*mm, 50*mm])
                page_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.black),
                    ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('GRID', (0, 0), (-1, -1), 1, colors.black),
                    ('ALIGN', (1, 1), (-1, -1), 'RIGHT'),
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ]))
                elements.append(page_table)
        
        # Detailtabelle für diese Seite
        if 'predictions' in page_data and page_data['predictions']:
            elements.append(Paragraph("Detailergebnisse", normal_style))
            
            detail_data = [["Nr.", "Klasse", "Typ", "Wahrsch.", "Fläche (m²)"]]
            for idx, pred in enumerate(page_data['predictions']):
                label_name = pred.get('label_name', "Andere")
                pred_type = pred.get('type', "Rechteck")
                score = pred.get('score', 0) * 100
                area = pred.get('area', 0)
                
                detail_data.append([
                    idx+1, 
                    label_name, 
                    pred_type, 
                    f"{score:.1f}%",
                    f"{area:.2f}"
                ])
            
            detail_table = Table(detail_data, colWidths=[20*mm, 40*mm, 40*mm, 30*mm, 30*mm])
            detail_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.black),
                ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('GRID', (0, 0), (-1, -1), 1, colors.black),
                ('ALIGN', (0, 1), (0, -1), 'CENTER'),
                ('ALIGN', (3, 1), (4, -1), 'RIGHT'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ]))
            elements.append(detail_table)
        
        # Seitenumbruch (außer für die letzte Seite)
        if page_num < page_count:
            elements.append(PageBreak())
            
    
    # PDF generieren
    doc.build(elements)
    
    # Temporäre annotierte Bilder aufräumen
    for page_num in range(1, page_count + 1):
        annotated_path = os.path.join('static', 'temp', f"annotated_page_{page_num}_{timestamp}.jpg")
        if os.path.exists(annotated_path):
            os.remove(annotated_path)
    
    # Debug
    print(f"Generiere PDF für Projekt: {project_id}")
    print(f"Projektpfad: {project_dir}")
    print(f"Prüfe Metadatendatei: {metadata_path}")
    
    if not os.path.exists(project_dir):
        print(f"FEHLER: Projektverzeichnis existiert nicht: {project_dir}")
        raise FileNotFoundError(f"Projektverzeichnis nicht gefunden: {project_dir}")
    
    if not os.path.exists(metadata_path):
        print(f"FEHLER: Metadatendatei existiert nicht: {metadata_path}")
        raise FileNotFoundError(f"Metadatendatei nicht gefunden: {metadata_path}")
    
    return output_path