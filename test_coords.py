import fitz
import json
import os

def test_with_real_coordinates(pdf_path, analysis_path, output_path):
    """
    Test mit echten Koordinaten aus den Analysedaten.
    
    Args:
        pdf_path: Pfad zur Original-PDF
        analysis_path: Pfad zur Analysedatei (JSON)
        output_path: Pfad für die Ausgabe-PDF
    """
    print(f"Teste mit echten Koordinaten")
    print(f"PDF: {pdf_path}")
    print(f"Analyse: {analysis_path}")
    print(f"Ausgabe: {output_path}")
    
    # Prüfen, ob Dateien existieren
    if not os.path.exists(pdf_path):
        print(f"FEHLER: PDF nicht gefunden: {pdf_path}")
        return False
        
    if not os.path.exists(analysis_path):
        print(f"FEHLER: Analysedatei nicht gefunden: {analysis_path}")
        return False
    
    try:
        # Analysedaten laden
        with open(analysis_path, 'r') as f:
            analysis_data = json.load(f)
        
        # PDF öffnen
        doc = fitz.open(pdf_path)
        
        if len(doc) == 0:
            print("FEHLER: PDF hat keine Seiten")
            return False
            
        # Für Debugging: Seitengröße ausgeben
        page = doc[0]
        print(f"Seitengröße: {page.rect.width} x {page.rect.height}")
        
        # Einfache Testlinie malen
        page.draw_line((100, 100), (400, 400), color=(1, 0, 0), width=5)
        page.insert_text((100, 80), "Testlinie (sollte immer sichtbar sein)", fontsize=12)
        
        # Vorhersagen extrahieren
        predictions = analysis_data.get('predictions', [])
        print(f"Gefunden: {len(predictions)} Vorhersagen")
        
        for idx, pred in enumerate(predictions):
            if 'box' in pred:
                try:
                    x1, y1, x2, y2 = pred['box']
                    label = pred.get('label', 0)
                    
                    print(f"Box #{idx}: Klasse {label}, Koordinaten: [{x1}, {y1}, {x2}, {y2}]")
                    
                    # Test 1: Original-Koordinaten
                    color = (0, 0, 1)  # Blau
                    page.draw_line((x1, y1), (x2, y1), color=color, width=2)
                    page.insert_text((x1, y1-20), f"Original #{idx+1}", fontsize=8)
                    
                    # Test 2: Skalierte Koordinaten - falls die Originale zu groß sind
                    scale = min(page.rect.width / 3500, page.rect.height / 3500)
                    scaled_x1 = x1 * scale
                    scaled_y1 = y1 * scale
                    scaled_x2 = x2 * scale
                    scaled_y2 = y2 * scale
                    
                    color = (0, 1, 0)  # Grün
                    page.draw_line((scaled_x1, scaled_y1), (scaled_x2, scaled_y1), color=color, width=2)
                    page.insert_text((scaled_x1, scaled_y1-10), f"Skaliert #{idx+1}", fontsize=8)
                    
                except Exception as e:
                    print(f"Fehler bei Box {idx}: {e}")
        
        # PDF speichern
        doc.save(output_path)
        print(f"Test-PDF gespeichert unter: {output_path}")
        return True
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Fehler beim Test: {e}")
        return False

if __name__ == "__main__":
    # Absoluten Pfad zu einer existierenden PDF eintragen
    pdf_path = "projects/76f1a63c-0ee2-497e-b01c-997a6a878671/original.pdf"
    analysis_path = "/home/fabian/Documents Bauphysik Lengg/10000 Admin/055 Website/Planvision/projects/76f1a63c-0ee2-497e-b01c-997a6a878671/analysis/page_1_results.json"
    output_path = "test_coords.pdf"
    
    success = test_with_real_coordinates(pdf_path, analysis_path, output_path)
    if success:
        print("Test abgeschlossen. Bitte prüfe die Ausgabe-PDF.")
    else:
        print("Test fehlgeschlagen.")