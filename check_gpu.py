#!/usr/bin/env python3
"""
GPU/CUDA Verfügbarkeits-Check für Planvision
Prüft ob CUDA/GPU für PyTorch verfügbar ist
"""

import torch
import sys

def check_gpu_support():
    print("🔍 GPU/CUDA Support Check für Planvision")
    print("=" * 50)
    
    # PyTorch Version
    print(f"🐍 PyTorch Version: {torch.__version__}")
    
    # CUDA Verfügbarkeit
    cuda_available = torch.cuda.is_available()
    print(f"🚀 CUDA verfügbar: {'✅ JA' if cuda_available else '❌ NEIN'}")
    
    if cuda_available:
        # CUDA Details
        cuda_version = torch.version.cuda
        print(f"📦 CUDA Version: {cuda_version}")
        
        # GPU Informationen
        gpu_count = torch.cuda.device_count()
        print(f"🖥️  GPU Anzahl: {gpu_count}")
        
        for i in range(gpu_count):
            gpu_name = torch.cuda.get_device_name(i)
            gpu_memory = torch.cuda.get_device_properties(i).total_memory / (1024**3)
            print(f"   GPU {i}: {gpu_name} ({gpu_memory:.1f}GB VRAM)")
        
        # Performance Test
        print("\n⚡ GPU Performance Test...")
        try:
            # Erstelle Test-Tensor auf GPU
            device = torch.device('cuda:0')
            test_tensor = torch.randn(1000, 1000, device=device)
            result = torch.matmul(test_tensor, test_tensor)
            print("✅ GPU Test erfolgreich - GPU ist einsatzbereit!")
            
            # Empfohlene Konfiguration
            print(f"\n🎯 Empfohlene Einstellung für model_handler.py:")
            print(f"   device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')")
            
            # Geschätzte Performance-Verbesserung
            print(f"\n📈 Erwartete Performance-Verbesserung:")
            print(f"   - Model-Inferenz: 50-70% schneller")
            print(f"   - Gesamt-Request: 30-50% schneller")
            
        except Exception as e:
            print(f"❌ GPU Test fehlgeschlagen: {e}")
            print("   GPU ist verfügbar aber nicht funktionsfähig")
    else:
        print("\n💡 Ohne GPU:")
        print("   - Aktuelle CPU-Performance ist ok für Development")
        print("   - Für Production: GPU-Host empfohlen für bessere UX")
        print("   - Alternative: Model-Quantisierung oder kleineres Modell")
    
    # MPS Support (Apple Silicon)
    mps_available = hasattr(torch.backends, 'mps') and torch.backends.mps.is_available()
    if mps_available:
        print(f"\n🍎 Apple Silicon MPS: ✅ Verfügbar")
        print("   - Kann für moderate Beschleunigung genutzt werden")
        print("   - device = torch.device('mps')")
    
    # Empfehlung
    print("\n" + "=" * 50)
    if cuda_available:
        print("🎯 EMPFEHLUNG: GPU-Beschleunigung aktivieren!")
        print("   → Deutlich schnellere Fenstererkennung")
    elif mps_available:
        print("🎯 EMPFEHLUNG: MPS-Beschleunigung aktivieren!")
        print("   → Moderate Verbesserung auf Apple Silicon")
    else:
        print("🎯 EMPFEHLUNG: CPU-Optimierungen fokussieren")
        print("   → Modell-Quantisierung, kleinere Bildgrössen, Async Processing")
    
    return cuda_available or mps_available

if __name__ == "__main__":
    try:
        gpu_support = check_gpu_support()
        sys.exit(0 if gpu_support else 1)
    except Exception as e:
        print(f"❌ Fehler beim GPU-Check: {e}")
        sys.exit(1)