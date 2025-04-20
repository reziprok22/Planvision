from flask import Flask, render_template, request, jsonify
import torch
from torchvision import models, transforms
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from PIL import Image
import io
import os
import numpy as np

app = Flask(__name__)

# Modell definieren
def get_model(num_classes=6):
    model = models.detection.fasterrcnn_resnet50_fpn(weights='DEFAULT')
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)
    return model

# Globale Variable für das Modell
model = None

# Name des Fast R-CNN Model
model_path = 'fasterrcnn_model/fasterrcnn_model_2025-04-20-21-00-43.pth'

def load_model():
    global model
    # Überprüfen, ob das Modell bereits geladen wurde
    if model is None:
        model = get_model()
        # Überprüfen, ob die Modelldatei existiert
        if os.path.exists(model_path):
            model.load_state_dict(torch.load(model_path, map_location=torch.device('cpu')))
            model.eval()
        else:
            raise FileNotFoundError("Model file 'fasterrcnn_model.pth' not found")
    return model

# Funktion zur Berechnung des Umrechnungsfaktors
def calculate_scale_factor(format_size, dpi, plan_scale):
    """
    Berechnet den Umrechnungsfaktor von Pixel zu Meter
    
    Args:
        format_size: Tuple (width, height) in mm
        dpi: Auflösung in Dots Per Inch
        plan_scale: Maßstab des Plans (z.B. 100 für 1:100)
        
    Returns:
        pixels_per_meter: Anzahl Pixel pro Meter in der Realität
    """
    # Berechne Pixel pro mm auf dem Plan
    pixels_per_inch = dpi
    pixels_per_mm = pixels_per_inch / 25.4
    
    # Berücksichtige den Maßstab
    # Bei M 1:100 entspricht 1mm auf dem Plan 100mm in der Realität
    pixels_per_real_meter = pixels_per_mm * (1000 / plan_scale)
    
    return pixels_per_real_meter

# Funktion zur Berechnung der Überlappung zwischen zwei Bounding Boxes
def calculate_overlap(box1, box2):
    """
    Berechnet verschiedene Überlappungsmetriken zwischen zwei Bounding Boxes.
    
    Args:
        box1: Liste [x1, y1, x2, y2] der ersten Box
        box2: Liste [x1, y1, x2, y2] der zweiten Box
        
    Returns:
        overlap_dict: Dictionary mit verschiedenen Überlappungsmetriken
    """
    # Berechne Schnittfläche
    x_left = max(box1[0], box2[0])
    y_top = max(box1[1], box2[1])
    x_right = min(box1[2], box2[2])
    y_bottom = min(box1[3], box2[3])
    
    # Prüfe, ob es eine Überlappung gibt
    if x_right < x_left or y_bottom < y_top:
        return {
            "iou": 0.0,
            "overlap_area": 0.0,
            "box1_area": (box1[2] - box1[0]) * (box1[3] - box1[1]),
            "box2_area": (box2[2] - box2[0]) * (box2[3] - box2[1]),
            "overlap_box1_ratio": 0.0,
            "overlap_box2_ratio": 0.0
        }
    
    # Berechne Überlappungsfläche
    intersection_area = (x_right - x_left) * (y_bottom - y_top)
    
    # Berechne die Flächen der Boxen
    box1_area = (box1[2] - box1[0]) * (box1[3] - box1[1])
    box2_area = (box2[2] - box2[0]) * (box2[3] - box2[1])
    
    # Berechne verschiedene Überlappungsmetriken
    union_area = box1_area + box2_area - intersection_area
    iou = intersection_area / float(union_area) if union_area > 0 else 0.0
    
    # Berechne den Anteil der Überlappungsfläche an jeder Box
    overlap_box1_ratio = intersection_area / float(box1_area) if box1_area > 0 else 0.0
    overlap_box2_ratio = intersection_area / float(box2_area) if box2_area > 0 else 0.0
    
    return {
        "iou": iou,
        "overlap_area": intersection_area,
        "box1_area": box1_area,
        "box2_area": box2_area,
        "overlap_box1_ratio": overlap_box1_ratio,
        "overlap_box2_ratio": overlap_box2_ratio
    }

# Funktion zur Prüfung, ob eine Box vollständig in einer anderen enthalten ist
def is_contained(inner_box, outer_box, tolerance=0):
    """
    Prüft, ob inner_box vollständig in outer_box enthalten ist, mit optionaler Toleranz.
    
    Args:
        inner_box: Liste [x1, y1, x2, y2] der potenziell enthaltenen Box
        outer_box: Liste [x1, y1, x2, y2] der potenziell umschließenden Box
        tolerance: Toleranzwert in Pixeln für leichte Überlappungen
        
    Returns:
        contained: True, wenn inner_box (fast) vollständig in outer_box enthalten ist
    """
    return (inner_box[0] >= outer_box[0] - tolerance and 
            inner_box[1] >= outer_box[1] - tolerance and 
            inner_box[2] <= outer_box[2] + tolerance and 
            inner_box[3] <= outer_box[3] + tolerance)

# Funktion zur Anwendung von Non-Maximum Suppression mit verbesserter Überlappungserkennung
# overlap_ratio_threshold: 0 = alle überlappende Boxen werden entfernt 1 = keine überlappende Boxen werden entfernt
# tolerance: Empfindlichkeit gegenüber kleinen Überlappungen
def apply_nms(boxes, labels, scores, areas, iou_threshold=0.5, overlap_ratio_threshold=0.7, tolerance=5):
    """
    Erweiterte Non-Maximum Suppression für überlappende Bounding Boxes.
    
    Args:
        boxes: Liste von Bounding Boxes
        labels: Liste von Klassen-IDs
        scores: Liste von Konfidenzwerten
        areas: Liste von Flächengrößen
        iou_threshold: Schwellenwert für die IoU-Überlappung (Standard: 0.5)
        overlap_ratio_threshold: Schwellenwert für den relativen Überlappungsanteil (Standard: 0.7)
        tolerance: Toleranzwert in Pixeln für die Erkennung "fast enthaltener" Boxen (Standard: 5)
        
    Returns:
        filtered_boxes, filtered_labels, filtered_scores, filtered_areas: Gefilterte Listen
    """
    # Erstelle Indizes und sortiere diese nach absteigender Konfidenz
    indices = np.argsort(scores)[::-1]
    
    keep_indices = []
    
    while len(indices) > 0:
        # Nehme die Box mit der höchsten Konfidenz
        current_index = indices[0]
        keep_indices.append(current_index)
        
        # Entferne den aktuellen Index aus der Liste
        indices = indices[1:]
        
        if len(indices) == 0:
            break
        
        # Hole die aktuelle Box und ihr Label
        current_box = boxes[current_index]
        current_label = labels[current_index]
        
        # Indizes der zu entfernenden Boxen
        remove_indices = []
        
        for i, idx in enumerate(indices):
            # Prüfe nur Boxen der gleichen Klasse
            if labels[idx] == current_label:
                # Berechne verschiedene Überlappungsmetriken
                overlap_metrics = calculate_overlap(current_box, boxes[idx])
                
                # Kriterium 1: Standard IoU Schwellenwert
                if overlap_metrics["iou"] > iou_threshold:
                    remove_indices.append(i)
                    continue
                
                # Kriterium 2: Eine Box ist (nahezu) vollständig in der anderen enthalten
                if is_contained(boxes[idx], current_box, tolerance):
                    # Kleinere Box ist in der größeren Box enthalten
                    remove_indices.append(i)
                    continue
                
                # Kriterium 3: Relativer Überlappungsanteil
                # Entferne die Box, wenn ein großer Teil davon mit der aktuellen Box überlappt
                if (overlap_metrics["overlap_box2_ratio"] > overlap_ratio_threshold and 
                    overlap_metrics["box2_area"] < overlap_metrics["box1_area"]):
                    remove_indices.append(i)
                    continue
        
        # Entferne die markierten Boxen
        indices = np.delete(indices, remove_indices)
    
    # Filtere die Listen basierend auf den beibehaltenen Indizes
    filtered_boxes = [boxes[i] for i in keep_indices]
    filtered_labels = [labels[i] for i in keep_indices]
    filtered_scores = [scores[i] for i in keep_indices]
    filtered_areas = [areas[i] for i in keep_indices]
    
    return filtered_boxes, filtered_labels, filtered_scores, filtered_areas

# Funktion zur Bildvorhersage
def predict_image(image_bytes, format_size=(210, 297), dpi=300, plan_scale=100, threshold=0.5):
    try:
        device = torch.device('cuda') if torch.cuda.is_available() else torch.device('cpu')
        
        # Modell laden
        model = load_model()
        model.to(device)
        
        # Bild öffnen und transformieren
        transform = transforms.Compose([transforms.ToTensor()])
        image = Image.open(io.BytesIO(image_bytes))
        image_tensor = transform(image).unsqueeze(0).to(device)
        
        # Berechne den Umrechnungsfaktor
        pixels_per_meter = calculate_scale_factor(format_size, dpi, plan_scale)
        
        # Inferenz
        with torch.no_grad():
            prediction = model(image_tensor)
        
        # Ergebnisse extrahieren
        boxes = prediction[0]['boxes'].cpu().numpy()
        labels = prediction[0]['labels'].cpu().numpy()
        scores = prediction[0]['scores'].cpu().numpy()
        
        # Schwellenwert anwenden
        valid_detections = scores >= threshold
        boxes = boxes[valid_detections]
        labels = labels[valid_detections]
        scores = scores[valid_detections]
        
        # Flächen berechnen
        areas = []
        for box in boxes:
            x1, y1, x2, y2 = box
            width_pixels = x2 - x1
            height_pixels = y2 - y1
            
            # Umrechnung in Meter
            width_meters = width_pixels / pixels_per_meter
            height_meters = height_pixels / pixels_per_meter
            
            # Fläche in m²
            area = width_meters * height_meters
            areas.append(area)
        
        # Non-Maximum Suppression anwenden
        boxes, labels, scores, areas = apply_nms(
            boxes, 
            labels, 
            scores, 
            areas, 
            iou_threshold=0.5,
            overlap_ratio_threshold=0.7,
            tolerance=5
        )
        
        return boxes, labels, scores, areas
    
    except Exception as e:
        print(f"Error in predict_image: {e}")
        return [], [], [], []

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
        
        if file:
            image_bytes = file.read()
            boxes, labels, scores, areas = predict_image(
                image_bytes, 
                format_size=format_size, 
                dpi=dpi, 
                plan_scale=plan_scale, 
                threshold=threshold
            )
            
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
            
            return jsonify({
                'predictions': results,
                'total_area': round(float(total_area), 2),
                'count': len(results)
            })
        
        return jsonify({'error': 'Error processing file'}), 500
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Versuche, das Modell zu Beginn zu laden
    try:
        load_model()
        app.run(debug=True)
    except Exception as e:
        print(f"Error loading model: {e}")