# Modellverarbeitung und -vorhersagen
import torch
from torchvision import models, transforms
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from PIL import Image
import io
import os
import numpy as np
from utils import calculate_scale_factor, apply_nms

# Name des Fast R-CNN Model
MODEL_PATH = 'fasterrcnn_model/fasterrcnn_model_2025-04-20-21-00-43.pth'

# Globale Variable für das Modell
model = None

def get_model(num_classes=6):
    """
    Erstellt und gibt ein Faster R-CNN Modell zurück.
    
    Args:
        num_classes: Anzahl der Klassen (inkl. Hintergrund)
        
    Returns:
        model: Das Modell-Objekt
    """
    model = models.detection.fasterrcnn_resnet50_fpn(weights='DEFAULT')
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)
    return model

def load_model():
    """
    Lädt das vortrainierte Modell aus der Modelldatei.
    
    Returns:
        model: Das geladene Modell-Objekt
    """
    global model
    # Überprüfen, ob das Modell bereits geladen wurde
    if model is None:
        model = get_model()
        # Überprüfen, ob die Modelldatei existiert
        if os.path.exists(MODEL_PATH):
            model.load_state_dict(torch.load(MODEL_PATH, map_location=torch.device('cpu')))
            model.eval()
        else:
            raise FileNotFoundError(f"Model file '{MODEL_PATH}' not found")
    return model

def predict_image(image_bytes, format_size=(210, 297), dpi=300, plan_scale=100, threshold=0.5):
    """
    Führt Objekterkennung auf einem Bild durch.
    
    Args:
        image_bytes: Bilddaten als Bytes
        format_size: Tuple (width, height) in mm
        dpi: Auflösung in Dots Per Inch
        plan_scale: Maßstab des Plans (z.B. 100 für 1:100)
        threshold: Schwellenwert für die Erkennungssicherheit
        
    Returns:
        boxes, labels, scores, areas: Arrays mit Erkennungsergebnissen
    """
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