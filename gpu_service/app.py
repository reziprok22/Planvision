"""
GPU-Dienst für die Kachel-Fenstererkennung (läuft als Container bei Verda Serverless).

Endpoints:
  GET  /health   → {"status": "ok"} erst, wenn das Modell geladen ist (Verda schickt
                   vorher keine Anfragen an das Replica)
  POST /predict  → Rumpf = Seitenbild als JPEG/PNG (roh, Content-Type egal),
                   Antwort = Boxen in Pixeln des Bildes

Die Authentifizierung macht Verda vor dem Container (Bearer-Inference-Key) — der
Dienst selbst prüft nichts.
"""
import os
import threading
import time
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool

from tiled_inference import TiledDetector

MODEL_PATH = os.environ.get('MODEL_PATH', '/app/model.pth')
MAX_BYTES = 60 * 1024 * 1024    # A0 @150 DPI als JPEG liegt bei wenigen MB

detector = None
# Eine GPU, ein Modell: parallele Anfragen würden sich nur um den Speicher streiten
gpu_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    global detector
    t0 = time.perf_counter()
    detector = TiledDetector(MODEL_PATH)
    print(f'Modell geladen auf {detector.device} in {time.perf_counter() - t0:.1f} s', flush=True)
    yield


app = FastAPI(lifespan=lifespan)


@app.get('/health')
def health():
    if detector is None:
        raise HTTPException(503, 'Modell lädt noch')
    return {'status': 'ok', 'device': str(detector.device)}


@app.post('/predict')
async def predict(request: Request, score_thr: float = Query(0.05, ge=0, le=1)):
    data = await request.body()
    if not data:
        raise HTTPException(400, 'Leerer Rumpf — Bild als Rohdaten schicken')
    if len(data) > MAX_BYTES:
        raise HTTPException(413, 'Bild zu gross')
    # Inferenz blockiert — im Threadpool laufen lassen, damit /health antwortet
    return await run_in_threadpool(_predict, data, score_thr)


def _predict(data, score_thr):
    t0 = time.perf_counter()
    with gpu_lock:
        try:
            boxes, scores = detector.predict_bytes(data, score_thr)
        except Exception as e:      # cv2 liefert None bei kaputten Bildern
            raise HTTPException(400, f'Bild nicht lesbar: {e}')
        finally:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
    return {
        'boxes': [[round(float(v), 1) for v in b] for b in boxes],
        'scores': [round(float(s), 4) for s in scores],
        'seconds': round(time.perf_counter() - t0, 2),
        'device': str(detector.device),
    }

