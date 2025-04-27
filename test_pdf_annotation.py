import fitz  # PyMuPDF
import os

def test_pdf_annotation(pdf_path, output_path):
    """
    Einfacher Test, um zu prüfen, ob PDF-Annotation funktioniert.
    Zeichnet eine rote Linie und einfachen Text auf jede Seite.
    """
    print(f"Test-PDF-Annotation: Öffne {pdf_path}")
    
    try:
        # PDF öffnen
        doc = fitz.open(pdf_path)
        
        # Durch alle Seiten gehen
        for page_num in range(len(doc)):
            page = doc[page_num]
            
            print(f"Bearbeite Seite {page_num+1}")
            
            # Einfach eine rote Linie zeichnen
            start_point = (100, 100)
            end_point = (300, 300)
            page.draw_line(start_point, end_point, color=(1, 0, 0), width=3)
            
            # Text hinzufügen
            page.insert_text((100, 80), f"Testtext auf Seite {page_num+1}", fontsize=12)
            
            print(f"Linie und Text auf Seite {page_num+1} hinzugefügt")
        
        # Dokument speichern
        print(f"Speichere annotierte PDF unter {output_path}")
        doc.save(output_path)
        print("PDF erfolgreich gespeichert!")
        
        return True
    except Exception as e:
        print(f"Fehler beim Annotieren der PDF: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    # Hier absoluten Pfad zu einer existierenden PDF eintragen
    input_pdf = "test.pdf"
    output_pdf = "test_annotated.pdf"
    
    if not os.path.exists(input_pdf):
        print(f"Fehler: Eingabe-PDF nicht gefunden: {input_pdf}")
    else:
        success = test_pdf_annotation(input_pdf, output_pdf)
        if success:
            print(f"Test erfolgreich. Bitte prüfe die Ausgabe-PDF: {output_pdf}")
        else:
            print("Test fehlgeschlagen.")