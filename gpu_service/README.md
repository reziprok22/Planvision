# GPU-Dienst Fenstererkennung (Verda Serverless)

Kleiner FastAPI-Dienst um `ml/tiled_inference.py` (`TiledDetector`) mit dem Modell
`fasterrcnn_model/v3_tiled.pth`. Das Modell wird **ins Image gebacken** — deshalb das
Image nur in eine **private** Registry pushen (Verda Container Registry `vccr.io`, privat
per Default).

- `GET /health` → `{"status": "ok"}` sobald das Modell geladen ist
- `POST /predict?score_thr=0.05` → Rumpf = Seitenbild roh (JPEG/PNG),
  Antwort `{"boxes": [[x1,y1,x2,y2], …], "scores": […], "seconds": …, "device": "cuda"}`
  in Pixeln des geschickten Bildes

Gemessen lokal (RTX 2070 Super): Seite 11 575 × 6623 px → 66 Fenster in ~15 s.
Gemessen auf Verda (15.10.2026, `page_10.jpg`, 3603 × 2598 px, 133 Fenster): warm **2.0 s**
gesamt (Inferenz 1.6 s); Kaltstart aus der Verda-Registry mit Image-Caching **28 s**
(von ghcr ohne Caching waren es 354 s, siehe Abschnitt 6).

## 1. Docker einmalig installieren (Linux Mint)

```bash
sudo apt install docker.io docker-buildx
sudo usermod -aG docker $USER      # danach ab- und wieder anmelden
```

`docker-buildx` ist nötig: nur BuildKit liest `gpu_service/Dockerfile.dockerignore`.
Ohne würde das ganze Repo (env/, node_modules/, projects/ …) in den Build-Kontext kopiert.

## 2. Bauen und pushen (aus dem Repo-Root)
Repo-Root: der Ordner, in dem `.git` liegt.

`<PROJECT_ID>` = Verda-Projekt-ID (steht in Verda bei der Container Registry).

```bash
docker build -f gpu_service/Dockerfile -t vccr.io/<PROJECT_ID>/planli-fasterrcnn:v1 .
```

Optional lokal testen (braucht `nvidia-container-toolkit` für `--gpus`, sonst läuft es auf CPU).
Port 8001, weil auf 8000 meist der Django-Dev-Server läuft (der antwortet sonst mit 404):

```bash
docker run --rm -p 8001:8000 --gpus all vccr.io/<PROJECT_ID>/planli-fasterrcnn:v1
python3 gpu_service/test_endpoint.py http://localhost:8001 <seite.jpg>
```

Pushen in die Verda Container Registry. Login mit den Registry-Credentials aus Verda — Verda
stellt dem gewählten Credential-Namen `vcr-<PROJECT_ID>+` voran, das ist der Username.
`read -s` statt `echo '<SECRET>'`, sonst landet das Secret in der Shell-History:

```bash
read -s VCR_SECRET   # Secret einfügen, Enter (nichts wird angezeigt)
echo "$VCR_SECRET" | docker login vccr.io/<PROJECT_ID> -u 'vcr-<PROJECT_ID>+<CREDENTIAL-NAME>' --password-stdin
unset VCR_SECRET

# schon gebautes Image (z.B. noch mit ghcr-Tag) nur umtaggen, kein Neubau nötig:
# docker tag ghcr.io/reziprok22/planli-fasterrcnn:v1 vccr.io/<PROJECT_ID>/planli-fasterrcnn:v1
docker push vccr.io/<PROJECT_ID>/planli-fasterrcnn:v1
```

Für jede neue Version das Tag hochzählen (`v2`, …), nicht `latest` überschreiben: so weiss man,
was in Verda läuft, und kann zurückwechseln.

## 3. Verda-Formular

| Feld                        | Wert                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Image settings**          |                                                                                                         |
| Container image             | `vccr.io/<PROJECT_ID>/planli-fasterrcnn:v1`                                                             |
| Registry credentials        | die Verda-Registry-Credentials                                                                          |
| Image caching               | **an** (geht nur für die Verda-Registry und öffentliche Docker-Hub-Images, nicht für ghcr)              |
| **Container configuration** |                                                                                                         |
| Exposed HTTP port           | `8000`                                                                                                  |
| Healthcheck port / path     | `8000` / `/health`                                                                                      |
| Start command               | aus (steht im Dockerfile)                                                                               |
| Env-Variablen               | keine nötig                                                                                             |
| Instanztyp                  | **On-Demand**, nicht Spot (seit 18.10.2026): Spot meldete „no nodes available“ — ohne Rückfall-Modell fällt die Erkennung dann aus |
| **Scaling**                 |                                                                                                         |
| Replica-Limits              | Min 0 / Max 1 → bezahlt wird nur Laufzeit (inkl. Kaltstart und Scale-down-Delay); 1/1 = läuft dauerhaft |
| Queue load                  | Cost-Saver (10) — bei Max 1 ohne Wirkung                                                                |
| Advanced-Settings           | Scale-down-Delay: 30 Minuten (seit 18.10.2026, vorher 5) — wer an einem Plan arbeitet, wartet nur einmal |

## 4. Inference-API-Key erstellen
- In Verda unter Credentials → Inference API Keys
- Gespeichert im Passwort-Manager

## 5. Testlauf

Aufrufen mit `Authorization: Bearer <Inference-API-Key>`; die Basis-URL steht im Abschnitt
„Containers API“ des Deployments — **vollständig** kopieren: ein falscher Deployment-Name ergibt
für jeden Pfad `404 page not found` vom Gateway, beim Bild-Upload in Python als `SSLEOFError`.

```bash
# kurzer Check ohne Bild
curl -H "Authorization: Bearer <KEY>" https://containers.datacrunch.io/<DEPLOYMENT>/health

VERDA_INFERENCE_KEY=… python3 gpu_service/test_endpoint.py https://containers.datacrunch.io/<DEPLOYMENT> <seite.jpg>
```
- `VERDA_INFERENCE_KEY`: siehe PWM
- `<DEPLOYMENT>`: gpu-for-p
- `<seite.jpg>`: gpu_service/page_10.jpg
Das Skript ruft zweimal auf: der erste Aufruf nach einer Pause (> Scale-down-Delay) zeigt den
Kaltstart, der zweite die warme Zeit.

## 6. Kaltstart

Das Image ist entpackt **13.1 GB**, davon ~12.8 GB PyTorch-Basis-Image (CUDA/cuDNN/torch),
nur 173 MB Modell — das Modell auf ein Volume auszulagern bringt deshalb nichts.
Von ghcr ohne Caching dauerte der Kaltstart 354 s, **länger als der gunicorn/nginx-Timeout
(300 s)**. Deshalb Verda-Registry mit Image-Caching; der erste Start danach füllt erst den Cache,
aussagekräftig ist der zweite Kaltstart.

| Messung (15.10.2026, `page_10.jpg`)          | 1. Aufruf | 2. Aufruf (warm) |
| -------------------------------------------- | --------- | ---------------- |
| ghcr, ohne Caching, von 0 Replicas           | 354.1 s   | 2.0 s            |
| vccr, mit Caching, von 0 Replicas            | **27.7 s**| 2.0 s            |

Ein Kaltstart kostet also ~26 s Wartezeit — deutlich unter dem 300-s-Timeout, Planli kann den
Dienst synchron aufrufen. Das UI sollte die Wartezeit trotzdem anzeigen („GPU startet …“).

Offen / Ideen:
x - Fallback aufs alte CPU-Modell, falls Verda nicht antwortet. Verworfen, altes CPU-Modell ist zu schlecht. 
- schlankeres Basis-Image (Python-slim + CUDA-Wheels) würde den Kaltstart weiter senken, lohnt erst bei Bedarf
