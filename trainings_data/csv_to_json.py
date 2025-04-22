import csv
import json
import os
import glob
import datetime

def convert_multiple_csv_to_single_json(input_folder, output_json_folder):
    # Aktuelles Datum und Zeit für den Dateinamen
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    output_json_path = os.path.join(output_json_folder, f"combined_labels_{timestamp}.json")
    
    # Sicherstellen, dass der Output-Ordner existiert
    os.makedirs(output_json_folder, exist_ok=True)
    
    # Alle CSV-Dateien im Eingabeordner finden
    csv_files = glob.glob(os.path.join(input_folder, "*.csv"))
    
    # Gesamtdaten aus allen CSV-Dateien
    all_data = []
    
    for csv_file in csv_files:
        print(f"Verarbeite Datei: {csv_file}")
        
        with open(csv_file, mode='r') as file:
            reader = csv.DictReader(file)
            current_image = None
            annotations = []
            
            for row in reader:
                image_name = row['image_name']
                label_name = row['label_name']
                
                # Bounding Box Koordinaten
                x1 = int(row['bbox_x'])
                y1 = int(row['bbox_y'])
                width = int(row['bbox_width'])
                height = int(row['bbox_height'])
                
                # Berechnung der rechten unteren Ecke der Bounding Box
                x2 = x1 + width
                y2 = y1 + height
                
                # Kategorie ID zuordnen (Fenster -> 1, z.B. "Fenster" könnte die Klasse 1 sein)
                # Im train_model und app.py num_model nach Anzahl labels einstellen (num_model = 6)
                if label_name.lower() == "fenster":
                    category_id = 1
                elif label_name.lower() == "tür":
                    category_id = 2
                elif label_name.lower() == "wand":
                    category_id = 3
                elif label_name.lower() == "lukarne":
                    category_id = 4
                elif label_name.lower() == "dach":
                    category_id = 5
                else:
                    category_id = 0  # andere

                # Wenn das Bild wechselt, speichere die aktuellen Annotationen
                if image_name != current_image:
                    if current_image:
                        all_data.append({
                            "image": current_image,
                            "annotations": annotations
                        })
                    annotations = []
                    current_image = image_name
                
                annotations.append({
                    "bbox": [x1, y1, x2, y2],
                    "category_id": category_id
                })
            
            # Letztes Bild der Datei speichern
            if current_image:
                all_data.append({
                    "image": current_image,
                    "annotations": annotations
                })
    
    # Speichern aller gesammelten Annotationen als einzelne JSON-Datei
    with open(output_json_path, 'w') as json_file:
        json.dump(all_data, json_file, indent=4)
    
    print(f"JSON-Datei wurde gespeichert: {output_json_path}")
    print(f"Insgesamt {len(all_data)} Bilder verarbeitet.")

# Pfade für den Eingabeordner mit CSV-Dateien und den Ausgabe-JSON-Ordner
input_csv_folder = "csv"  # Ordner mit allen CSV-Dateien
output_json_folder = "json_fenster"  # Ordner für die kombinierte JSON-Datei

# Alle CSV-Dateien zu einer einzelnen JSON-Datei umwandeln
convert_multiple_csv_to_single_json(input_csv_folder, output_json_folder)