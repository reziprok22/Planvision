"""
Schickt ein Seitenbild an den GPU-Dienst und misst die Zeit (inkl. Kaltstart).

  python gpu_service/test_endpoint.py <BASIS-URL> <bild.jpg>
  # Verda: Inference-Key in VERDA_INFERENCE_KEY, BASIS-URL aus "Containers API"
  # lokal:  python gpu_service/test_endpoint.py http://localhost:8000 seite.jpg
"""
import os
import sys
import json
import time
import urllib.error
import urllib.request

base, image = sys.argv[1].rstrip('/'), sys.argv[2]
headers = {'Content-Type': 'application/octet-stream'}
if os.environ.get('VERDA_INFERENCE_KEY'):
    headers['Authorization'] = f"Bearer {os.environ['VERDA_INFERENCE_KEY']}"

with open(image, 'rb') as f:
    data = f.read()

for run in ('1. Aufruf (evtl. Kaltstart)', '2. Aufruf (warm)'):
    t0 = time.perf_counter()
    req = urllib.request.Request(f'{base}/predict?score_thr=0.5', data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f'{run}: HTTP {e.code} — {e.read()[:500].decode(errors="replace")}')
    total = time.perf_counter() - t0
    print(f"{run}: {len(d['boxes'])} Fenster, Inferenz {d['seconds']} s auf {d['device']}, "
          f'gesamt {total:.1f} s')
