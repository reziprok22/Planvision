import cv2
import numpy as np
from PIL import Image
import io

def preprocess_image(image_bytes):
    """
    Verbessert die Qualität eines Bildes für die Objekterkennung.
    
    Args:
        image_bytes: Bilddaten als Bytes
        
    Returns:
        processed_image: Vorverarbeitetes Bild als PIL-Image
    """
    # Bytes in OpenCV-Format umwandeln
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    # Graustufen-Konvertierung für Bauplan-Analyse
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Rauschunterdrückung mit Gaußschem Filter
    denoised = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Adaptiver Threshold für bessere Binarisierung (optional)
    # binary = cv2.adaptiveThreshold(denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
    #                              cv2.THRESH_BINARY, 11, 2)
    
    # Kontrastverbesserung mit CLAHE
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(denoised)
    
    # Kantenhervorhebung (optional)
    edges = cv2.Canny(enhanced, 50, 150)
    
    # Zurück zu RGB für das neuronale Netz
    enhanced_rgb = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2RGB)
    
    # OpenCV zu PIL-Image für Kompatibilität mit torch transformations
    pil_image = Image.fromarray(enhanced_rgb)

    # Speichert das Bild vor und nach der Verarbeitung. Zur Überprüfung des Ergebnisses
    cv2.imwrite('before_preprocessing.jpg', img)
    cv2.imwrite('after_preprocessing.jpg', enhanced_rgb)
    
    return pil_image