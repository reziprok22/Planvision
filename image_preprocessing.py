import cv2
import numpy as np
from PIL import Image
import io

def preprocess_image(image_bytes):
    """
    Memory-effiziente Bildverbesserung für die Objekterkennung.
    
    Args:
        image_bytes: Bilddaten als Bytes
        
    Returns:
        processed_image: Vorverarbeitetes Bild als PIL-Image
    """
    # Bytes in OpenCV-Format umwandeln
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    # Originalgröße für später merken
    original_height, original_width = img.shape[:2]
    
    # Bild verkleinern falls sehr groß (reduziert RAM-Verbrauch)
    max_dimension = 2048
    if max(original_height, original_width) > max_dimension:
        scale = max_dimension / max(original_height, original_width)
        new_width = int(original_width * scale)
        new_height = int(original_height * scale)
        img = cv2.resize(img, (new_width, new_height), interpolation=cv2.INTER_AREA)
    
    # Graustufen-Konvertierung für Bauplan-Analyse
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    del img  # Sofortiges Löschen um RAM zu sparen
    
    # Vereinfachte Verarbeitung um RAM zu sparen
    # Rauschunterdrückung mit kleinerem Kernel
    denoised = cv2.GaussianBlur(gray, (3, 3), 0)
    del gray
    
    # Leichtere Kontrastverbesserung 
    clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(4, 4))
    enhanced = clahe.apply(denoised)
    del denoised
    
    # Zurück zu RGB für das neuronale Netz
    enhanced_rgb = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2RGB)
    del enhanced
    
    # OpenCV zu PIL-Image für Kompatibilität mit torch transformations
    pil_image = Image.fromarray(enhanced_rgb)
    del enhanced_rgb
    
    return pil_image
