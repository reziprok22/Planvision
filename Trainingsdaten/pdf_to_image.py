from pdf2image import convert_from_path
import os
import glob

def convert_pdf_to_jpg(pdf_folder, output_folder, dpi=300):
    """
    Konvertiert alle PDF-Dateien in einem Ordner zu JPG-Bildern.
    Jede Seite wird als separate JPG-Datei gespeichert.
    
    :param pdf_folder: Pfad zum Ordner mit den PDF-Dateien
    :param output_folder: Pfad zum Ausgabeordner für die JPG-Dateien
    :param dpi: Auflösung der Bilder (Dots per Inch)
    """
    # Stellen sicher, dass der Ausgabeordner existiert
    os.makedirs(output_folder, exist_ok=True)
    
    # Suche alle PDF-Dateien im angegebenen Ordner
    pdf_files = glob.glob(os.path.join(pdf_folder, "*.pdf"))
    
    # Prüfen, ob PDF-Dateien gefunden wurden
    if not pdf_files:
        print(f"Keine PDF-Dateien im Ordner '{pdf_folder}' gefunden.")
        return
    
    # Verarbeite jede PDF-Datei
    for pdf_path in pdf_files:
        try:
            # Extrahiere den Dateinamen ohne Erweiterung
            pdf_filename = os.path.splitext(os.path.basename(pdf_path))[0]
            print(f"Verarbeite PDF: {pdf_filename}")
            
            # Konvertiere PDF zu Bildern
            images = convert_from_path(pdf_path, dpi=dpi)
            
            # Speichere jede Seite als JPG
            for i, image in enumerate(images):
                # Erstelle den Ausgabepfad: PDF-Name_pageX.jpg
                output_path = os.path.join(output_folder, f"{pdf_filename}_page{i+1}.jpg")
                
                # Speichere das Bild
                image.save(output_path, "JPEG")
                print(f"  Seite {i+1} gespeichert als: {output_path}")
                
            print(f"PDF '{pdf_filename}' erfolgreich konvertiert: {len(images)} Seiten")
            
        except Exception as e:
            print(f"Fehler bei der Verarbeitung von '{pdf_path}': {e}")
    
    print("Konvertierung abgeschlossen.")

# Ordnerpfade konfigurieren
pdf_folder = "makesense_ai/pdf"  # Ordner mit den PDF-Dateien
output_folder = "makesense_ai/images_for_makesense_ai"  # Ausgabeordner für die JPG-Dateien

# Führe die Konvertierung durch
convert_pdf_to_jpg(pdf_folder, output_folder)