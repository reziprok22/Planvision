# Fenstererkennung: GPU-Dienst (Produktion) oder Kachel-Modell auf der eigenen GPU (lokal)
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np

from utils import calculate_scale_factor

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Kachel-Modell aus ml/train.py — nur lokal (ohne GPU_SERVICE_URL) benutzt.
# Modelle sind gitignored, die Datei also von Hand dorthin kopieren.
MODEL_PATH = os.path.join(BASE_DIR, 'fasterrcnn_model', 'v3_tiled.pth')

logger = logging.getLogger(__name__)

# GPU-Dienst (gpu_service/, läuft bei Verda Serverless mit dem Kachel-Modell).
# Mit URL (Produktion) erkennt ausschliesslich der Dienst, der Server braucht
# dafür weder torch noch eine Modelldatei. Fällt der Dienst aus, bekommt der
# Nutzer einen Hinweis (DetectionUnavailable → 503 in analyze_page).
# Ohne URL (Entwicklung) rechnet das Kachel-Modell unter MODEL_PATH lokal.
# Kaltstart gemessen 28 s, warm ~2 s pro Seite; der Timeout muss unter
# gunicorns 300 s bleiben.
GPU_SERVICE_URL = os.environ.get('GPU_SERVICE_URL', '').rstrip('/')
GPU_SERVICE_KEY = os.environ.get('GPU_SERVICE_KEY', '')
GPU_SERVICE_TIMEOUT = float(os.environ.get('GPU_SERVICE_TIMEOUT', 120))
# Nach einem Fehler den Dienst so lange überspringen — sonst wartete bei einem
# Ausfall jede Analyse erst den vollen Timeout ab (pro gunicorn-Worker). Kurz
# gehalten, weil es keinen Rückfall gibt: so lange sieht jeder nur den Hinweis.
GPU_SERVICE_COOLDOWN = 60
_gpu_skip_until = 0.0

# Lokaler TiledDetector, erst beim ersten Gebrauch geladen
_local_detector = None


class DetectionUnavailable(Exception):
    """Die Erkennung kann gerade nicht rechnen (GPU-Dienst/lokales Modell weg)."""


def uses_local_model():
    return not GPU_SERVICE_URL


def load_local_model():
    """Lädt das Kachel-Modell einmalig (torch erst hier importieren — der Server hat es nicht)."""
    global _local_detector
    if _local_detector is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(f"Model file '{MODEL_PATH}' not found")
        from ml.tiled_inference import TiledDetector
        _local_detector = TiledDetector(MODEL_PATH)  # cuda, falls vorhanden
        logger.info('Lokales Kachel-Modell geladen (%s)', _local_detector.device)
    return _local_detector


def _predict_local(image_bytes, threshold):
    try:
        boxes, scores = load_local_model().predict_bytes(image_bytes, score_thr=threshold)
    except Exception as e:
        # Kein stilles "0 Treffer" — der Nutzer soll wissen, dass nicht gerechnet wurde
        logger.exception('Lokale Erkennung fehlgeschlagen')
        raise DetectionUnavailable(str(e)) from e
    return boxes, scores


def _predict_gpu_service(image_bytes, threshold):
    """
    Schickt das Seitenbild an den GPU-Dienst und liefert (boxes, scores).
    Wirft DetectionUnavailable, wenn der Dienst nicht erreichbar ist oder nach
    einem Fehler gerade pausiert.
    """
    global _gpu_skip_until
    if time.time() < _gpu_skip_until:
        raise DetectionUnavailable('GPU-Dienst pausiert nach einem Fehler')
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
        logger.warning('GPU-Dienst fehlgeschlagen nach %.1f s (%d s Pause): %r %s',
                       time.time() - t0, GPU_SERVICE_COOLDOWN, e, detail)
        raise DetectionUnavailable(str(e)) from e
    logger.info('GPU-Dienst: %d Boxen in %.1f s (Inferenz %s s)',
                len(boxes), time.time() - t0, data.get('seconds'))
    return boxes, scores


def predict_image(image_bytes, format_size=(210, 297), dpi=300, plan_scale=100, threshold=0.5):
    """
    Erkennt Fenster auf einem Seitenbild.

    Args:
        image_bytes: Bilddaten als Bytes
        format_size: Tuple (width, height) in mm
        dpi: Auflösung in Dots Per Inch
        plan_scale: Massstab des Plans (z.B. 100 für 1:100)
        threshold: Schwellenwert für die Erkennungssicherheit

    Returns:
        boxes, labels, scores, areas: Arrays mit Erkennungsergebnissen

    Raises:
        DetectionUnavailable: GPU-Dienst bzw. lokales Modell nicht verfügbar
    """
    if uses_local_model():
        boxes, scores = _predict_local(image_bytes, threshold)
    else:
        boxes, scores = _predict_gpu_service(image_bytes, threshold)

    # Das Kachel-Modell kennt nur Fenster → Label 1; das Frontend setzt ohnehin
    # das gewählte "Erkennen als"-Label. Boxen sind bereits zusammengeführt (merge_tiles).
    boxes = np.asarray(boxes, dtype=float).reshape(-1, 4)
    pixels_per_meter = calculate_scale_factor(format_size, dpi, plan_scale)
    areas = [(x2 - x1) * (y2 - y1) / pixels_per_meter ** 2 for x1, y1, x2, y2 in boxes]
    labels = np.ones(len(boxes), dtype=int)
    return boxes, labels, np.asarray(scores, dtype=float), areas
