# Modellverarbeitung und -vorhersagen
import torch
from torchvision import models, transforms
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from PIL import Image
import io
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import cv2
import numpy as np
from utils import calculate_scale_factor, apply_nms, refine_boxes_to_lines
from image_preprocessing import preprocess_image

# Base directory für absolute Pfade
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Absoluter Pfad zum Fast R-CNN Model
MODEL_PATH = os.path.join(BASE_DIR, 'fasterrcnn_model', 'fasterrcnn_model_2025-04-22-20-04-25.pth')

# Globale Variable für das Modell
model = None
device = None
# Kachel-Modell aus ml/train.py (Checkpoint {'model', 'it', 'val'}); wird beim
# Laden am Dateiinhalt erkannt, sonst None = altes Ganzseiten-Modell.
tiled_detector = None

# Schalter zum Vergleichen: True = Snap-to-Line-Nachbearbeitung aktiv,
# False = altes Verhalten (rohe Netz-Boxen ohne Einrasten auf die Planlinien).
AFTERPROCESS = True

logger = logging.getLogger(__name__)

# GPU-Dienst (gpu_service/, läuft bei Verda Serverless mit dem Kachel-Modell).
# Ohne URL bleibt alles lokal. Kaltstart gemessen 28 s, warm ~2 s pro Seite;
# der Timeout muss deutlich unter gunicorns 300 s bleiben, damit danach noch
# Zeit für den Rückfall aufs lokale Modell ist.
GPU_SERVICE_URL = os.environ.get('GPU_SERVICE_URL', '').rstrip('/')
GPU_SERVICE_KEY = os.environ.get('GPU_SERVICE_KEY', '')
GPU_SERVICE_TIMEOUT = float(os.environ.get('GPU_SERVICE_TIMEOUT', 120))
# Nach einem Fehler den Dienst so lange überspringen — sonst wartete bei einem
# Ausfall jede Analyse erst den vollen Timeout ab (pro gunicorn-Worker)
GPU_SERVICE_COOLDOWN = 300
_gpu_skip_until = 0.0

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
    Lädt das vortrainierte Modell aus der Modelldatei einmalig.
    Nutzt GPU falls verfügbar für deutlich bessere Performance.
    
    Returns:
        model: Das geladene Modell-Objekt
    """
    global model, device
    # Überprüfen, ob das Modell bereits geladen wurde
    if model is None:
        # GPU-First Strategie: Nutze GPU falls verfügbar, sonst CPU
        if torch.cuda.is_available():
            device = torch.device('cuda')
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            device = torch.device('mps')
        else:
            device = torch.device('cpu')

        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(f"Model file '{MODEL_PATH}' not found")

        state = torch.load(MODEL_PATH, map_location=device)
        if isinstance(state, dict) and 'model' in state:
            global tiled_detector
            from ml.tiled_inference import TiledDetector
            tiled_detector = TiledDetector(MODEL_PATH, device=device.type)
            model = tiled_detector.model
        else:
            model = get_model()
            # Lade Model-Gewichte auf das gewählte Device
            model.load_state_dict(state)
            model.to(device)
            model.eval()
    return model

def cleanup_memory():
    """
    Bereinigt nicht benötigten Speicher nach der Inferenz.
    Optimiert für GPU-Memory-Management.
    """
    import gc
    gc.collect()
    
    # GPU-Speicher bereinigen falls verfügbar
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()  # Synchronisiere GPU-Operationen
    
    # MPS-Speicher bereinigen (Apple Silicon)
    elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        if hasattr(torch.mps, 'empty_cache'):
            torch.mps.empty_cache()

def resize_image_if_large(image, max_size=2048):
    """
    Verkleinert Bild wenn es zu gross ist, um RAM zu sparen.
    
    Args:
        image: PIL Image
        max_size: Maximale Bildgrösse (längste Seite)
        
    Returns:
        resized_image: Verkleinertes Bild
        scale_factor: Skalierungsfaktor für Koordinaten-Rückkonvertierung
    """
    w, h = image.size
    max_dim = max(w, h)
    
    if max_dim > max_size:
        scale_factor = max_size / max_dim
        new_w = int(w * scale_factor)
        new_h = int(h * scale_factor)
        resized_image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
        return resized_image, 1/scale_factor
    
    return image, 1.0

def _tiled_result(boxes, scores, format_size, dpi, plan_scale):
    # Kachel-Modell (lokal oder GPU-Dienst) kennt nur Fenster → Label 1; das
    # Frontend setzt ohnehin das gewählte "Erkennen als"-Label.
    boxes = np.asarray(boxes, dtype=float).reshape(-1, 4)
    pixels_per_meter = calculate_scale_factor(format_size, dpi, plan_scale)
    areas = [(x2 - x1) * (y2 - y1) / pixels_per_meter ** 2 for x1, y1, x2, y2 in boxes]
    labels = np.ones(len(boxes), dtype=int)
    return boxes, labels, np.asarray(scores, dtype=float), areas

def _predict_tiled(image_bytes, format_size, dpi, plan_scale, threshold):
    # Kachel-Modell: liefert fertig zusammengeführte Fenster-Boxen (inkl. NMS).
    # Kein Snap-to-Line (verschlechtert die Kachel-Boxen, gemessen 12.10.2026) und
    # kein apply_nms (merge_tiles hat bereits zusammengeführt).
    boxes, scores = tiled_detector.predict_bytes(image_bytes, score_thr=threshold)
    cleanup_memory()
    return _tiled_result(boxes, scores, format_size, dpi, plan_scale)

def _predict_gpu_service(image_bytes, threshold):
    """
    Schickt das Seitenbild an den GPU-Dienst. Liefert (boxes, scores) oder None,
    wenn der Dienst nicht konfiguriert, gerade gesperrt oder nicht erreichbar ist —
    dann rechnet predict_image lokal weiter.
    """
    global _gpu_skip_until
    if not GPU_SERVICE_URL or time.time() < _gpu_skip_until:
        return None
    query = urllib.parse.urlencode({'score_thr': threshold})
    req = urllib.request.Request(
        f'{GPU_SERVICE_URL}/predict?{query}',
        data=image_bytes,
        headers={'Content-Type': 'application/octet-stream',
                 'Authorization': f'Bearer {GPU_SERVICE_KEY}'},
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=GPU_SERVICE_TIMEOUT) as r:
            data = json.load(r)
        boxes, scores = data['boxes'], data['scores']
    except Exception as e:  # HTTP-Fehler, Timeout, Netz, kaputtes JSON
        _gpu_skip_until = time.time() + GPU_SERVICE_COOLDOWN
        detail = e.read()[:300] if isinstance(e, urllib.error.HTTPError) else ''
        logger.warning('GPU-Dienst fehlgeschlagen nach %.1f s, lokales Modell übernimmt '
                       '(%d s Pause): %r %s', time.time() - t0, GPU_SERVICE_COOLDOWN, e, detail)
        return None
    logger.info('GPU-Dienst: %d Boxen in %.1f s (Inferenz %s s)',
                len(boxes), time.time() - t0, data.get('seconds'))
    return boxes, scores

def predict_image(image_bytes, format_size=(210, 297), dpi=300, plan_scale=100, threshold=0.5):
    """
    Führt memory-effiziente Objekterkennung auf einem Bild durch.
    
    Args:
        image_bytes: Bilddaten als Bytes
        format_size: Tuple (width, height) in mm
        dpi: Auflösung in Dots Per Inch
        plan_scale: Massstab des Plans (z.B. 100 für 1:100)
        threshold: Schwellenwert für die Erkennungssicherheit
        
    Returns:
        boxes, labels, scores, areas: Arrays mit Erkennungsergebnissen
    """
    # Zuerst der GPU-Dienst (falls konfiguriert); bei Ausfall das lokale Modell
    remote = _predict_gpu_service(image_bytes, threshold)
    if remote is not None:
        return _tiled_result(*remote, format_size, dpi, plan_scale)

    try:
        global device

        # Modell laden (nur einmal)
        model = load_model()

        if tiled_detector is not None:
            return _predict_tiled(image_bytes, format_size, dpi, plan_scale, threshold)
        
        # Vorverarbeitung mit OpenCV (NUR für die KI – das Modell ist auf genau
        # diese Vorverarbeitung trainiert, siehe image_preprocessing.preprocess_image)
        processed_image = preprocess_image(image_bytes)

        # Sauberes Vollauflösungs-Farbbild NUR für den Snap-to-Line: das Original
        # ohne CLAHE/GaussianBlur (die verfälschen die Tinten-/Schwellenwerte, auf
        # die `min_darkness='auto'` relativ reagiert) und in echter Farbe (damit der
        # ink_mode bunte Hilfslinien wie gelbe Abbruchlinien aussortieren kann).
        # So snappt die Produktion auf demselben Bild wie `manage.py debug_snap`.
        # (vor dem Verkleinern – die Boxen werden in diese Auflösung zurückskaliert.)
        _snap_bgr = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        full_res_rgb = cv2.cvtColor(_snap_bgr, cv2.COLOR_BGR2RGB)

        # Bild verkleinern falls zu gross (höhere Inferenz-Auflösung = präzisere Boxen)
        processed_image, coord_scale = resize_image_if_large(processed_image, max_size=2048)
        
        # Bild transformieren und direkt auf GPU verschieben
        transform = transforms.Compose([transforms.ToTensor()])
        image_tensor = transform(processed_image).unsqueeze(0).to(device)
        
        # Berechne den Umrechnungsfaktor
        pixels_per_meter = calculate_scale_factor(format_size, dpi, plan_scale)
        
        # GPU-optimierte Inferenz mit Memory-Management
        with torch.no_grad():
            prediction = model(image_tensor)
        
        # Sofortiges Memory-Cleanup für GPU-Effizienz
        del image_tensor
        if torch.cuda.is_available():
            torch.cuda.empty_cache()  # GPU-Cache sofort leeren
        
        # Ergebnisse extrahieren
        boxes = prediction[0]['boxes'].cpu().numpy()
        labels = prediction[0]['labels'].cpu().numpy()
        scores = prediction[0]['scores'].cpu().numpy()
        
        # Koordinaten zurück skalieren falls Bild verkleinert wurde
        if coord_scale != 1.0:
            boxes = boxes * coord_scale
        
        # Schwellenwert anwenden
        valid_detections = scores >= threshold
        boxes = boxes[valid_detections]
        labels = labels[valid_detections]
        scores = scores[valid_detections]

        # Snap-to-Line: Box-Kanten auf die echten Planlinien einrasten
        # (per AFTERPROCESS-Schalter abschaltbar, um mit dem alten Verhalten zu vergleichen)
        if AFTERPROCESS:
            # Konservativer Snap: dem (meist schon guten) Netz vertrauen und nur
            # winzig korrigieren. select='nearest' rastet auf die der Netz-Kante
            # nächste Linie ein, das search-Band wirkt als Toleranz – so werden
            # kleine Versätze sauber eingerastet, ohne bei vielen dicht liegenden
            # Linien (Ansichten: Rahmen/Sturz/Bank/Laden) nach aussen zu springen.
            # min_darkness='auto': Schwelle wird pro Kante adaptiv aus dem Suchband
            # abgeleitet (siehe utils._auto_darkness) – ein fester Wert tötet auf
            # manchen Plänen die blassen Rahmenlinien (Snap greift dann ins Leere
            # oder springt auf Schatten). Diagnose/Vergleich: `manage.py debug_snap`.
            boxes = refine_boxes_to_lines(boxes, full_res_rgb, search=16, min_darkness='auto', select='nearest')

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
        
        # Final cleanup
        cleanup_memory()
        
        return boxes, labels, scores, areas
    
    except Exception as e:
        print(f"Error in predict_image: {e}")
        cleanup_memory()
        return [], [], [], []
