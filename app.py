from flask import Flask, render_template, request, jsonify
import torch
from torchvision import models, transforms
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from PIL import Image
import io
import os

app = Flask(__name__)

# Modell definieren
def get_model(num_classes=2):
    model = models.detection.fasterrcnn_resnet50_fpn(weights='DEFAULT')
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)
    return model

# Globale Variable für das Modell
model = None

# Name des Fast R-CNN Model
model_path = 'fasterrcnn_model/fasterrcnn_model_2025-04-20-15-57-47.pth'

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
        
        areas = []
        for box in boxes[valid_detections]:
            x1, y1, x2, y2 = box
            width_pixels = x2 - x1
            height_pixels = y2 - y1
            
            # Umrechnung in Meter
            width_meters = width_pixels / pixels_per_meter
            height_meters = height_pixels / pixels_per_meter
            
            # Fläche in m²
            area = width_meters * height_meters
            areas.append(area)
        
        return boxes[valid_detections], labels[valid_detections], scores[valid_detections], areas
    
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