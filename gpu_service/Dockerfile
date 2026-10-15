# GPU-Dienst Fenstererkennung — Build aus dem Repo-Root (Kontext = Repo, siehe README):
#   docker build -f gpu_service/Dockerfile -t vccr.io/<PROJECT_ID>/planli-fasterrcnn:v1 .
# Welche Dateien in den Kontext dürfen, regelt gpu_service/Dockerfile.dockerignore.

# Gleiche Torch-Version wie beim Training (2.10 / CUDA 12.8); Verda-Knoten haben Treiber R580
FROM pytorch/pytorch:2.10.0-cuda12.8-cudnn9-runtime

# PIP_BREAK_SYSTEM_PACKAGES: das Basis-Image nutzt Ubuntus System-Python (PEP 668,
# „externally-managed-environment“) — im Container gibt es kein OS-Python zu schützen
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    MODEL_PATH=/app/model.pth

WORKDIR /app

COPY gpu_service/requirements.txt .
RUN pip install -r requirements.txt
# torchvision liegt im Basis-Image; falls nicht, passend zu torch 2.10 nachziehen
RUN python -c "import torchvision" || pip install torchvision==0.25.0

# Modell zuerst (ändert selten) → Code-Änderungen bauen nur die letzten Layer neu
COPY fasterrcnn_model/v3_tiled.pth /app/model.pth
COPY ml/tiled_inference.py gpu_service/app.py /app/

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
