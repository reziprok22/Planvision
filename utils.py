# Hilfsfunktionen (Skalierung, Überlappungsberechnung etc.)
import numpy as np

def calculate_scale_factor(format_size, dpi, plan_scale):
    """
    Berechnet den Umrechnungsfaktor von Pixel zu Meter
    
    Args:
        format_size: Tuple (width, height) in mm
        dpi: Auflösung in Dots Per Inch
        plan_scale: Maßstab des Plans (z.B. 100 für 1:100)
        
    Returns:
        pixels_per_meter: Anzahl Pixel pro Meter in der Realität
    """
    # Berechne Pixel pro mm auf dem Plan
    pixels_per_inch = dpi
    pixels_per_mm = pixels_per_inch / 25.4
    
    # Berücksichtige den Massstab und Umrechnung mm in m
    # Bei M 1:100 entspricht 1mm auf dem Plan 100mm in der Realität
    pixels_per_real_meter = pixels_per_mm * (1000 / plan_scale)
    
    return pixels_per_real_meter

def calculate_overlap(box1, box2):
    """
    Berechnet verschiedene Überlappungsmetriken zwischen zwei Bounding Boxes.
    
    Args:
        box1: Liste [x1, y1, x2, y2] der ersten Box
        box2: Liste [x1, y1, x2, y2] der zweiten Box
        
    Returns:
        overlap_dict: Dictionary mit verschiedenen Überlappungsmetriken
    """
    # Berechne Schnittfläche
    x_left = max(box1[0], box2[0])
    y_top = max(box1[1], box2[1])
    x_right = min(box1[2], box2[2])
    y_bottom = min(box1[3], box2[3])
    
    # Prüfe, ob es eine Überlappung gibt
    if x_right < x_left or y_bottom < y_top:
        return {
            "iou": 0.0,
            "overlap_area": 0.0,
            "box1_area": (box1[2] - box1[0]) * (box1[3] - box1[1]),
            "box2_area": (box2[2] - box2[0]) * (box2[3] - box2[1]),
            "overlap_box1_ratio": 0.0,
            "overlap_box2_ratio": 0.0
        }
    
    # Berechne Überlappungsfläche
    intersection_area = (x_right - x_left) * (y_bottom - y_top)
    
    # Berechne die Flächen der Boxen
    box1_area = (box1[2] - box1[0]) * (box1[3] - box1[1])
    box2_area = (box2[2] - box2[0]) * (box2[3] - box2[1])
    
    # Berechne verschiedene Überlappungsmetriken
    union_area = box1_area + box2_area - intersection_area
    iou = intersection_area / float(union_area) if union_area > 0 else 0.0
    
    # Berechne den Anteil der Überlappungsfläche an jeder Box
    overlap_box1_ratio = intersection_area / float(box1_area) if box1_area > 0 else 0.0
    overlap_box2_ratio = intersection_area / float(box2_area) if box2_area > 0 else 0.0
    
    return {
        "iou": iou,
        "overlap_area": intersection_area,
        "box1_area": box1_area,
        "box2_area": box2_area,
        "overlap_box1_ratio": overlap_box1_ratio,
        "overlap_box2_ratio": overlap_box2_ratio
    }

def is_contained(inner_box, outer_box, tolerance=0):
    """
    Prüft, ob inner_box vollständig in outer_box enthalten ist, mit optionaler Toleranz.
    
    Args:
        inner_box: Liste [x1, y1, x2, y2] der potenziell enthaltenen Box
        outer_box: Liste [x1, y1, x2, y2] der potenziell umschließenden Box
        tolerance: Toleranzwert in Pixeln für leichte Überlappungen
        
    Returns:
        contained: True, wenn inner_box (fast) vollständig in outer_box enthalten ist
    """
    return (inner_box[0] >= outer_box[0] - tolerance and 
            inner_box[1] >= outer_box[1] - tolerance and 
            inner_box[2] <= outer_box[2] + tolerance and 
            inner_box[3] <= outer_box[3] + tolerance)

def apply_nms(boxes, labels, scores, areas, iou_threshold=0.5, overlap_ratio_threshold=0.7, tolerance=5):
    """
    Erweiterte Non-Maximum Suppression für überlappende Bounding Boxes.
    
    Args:
        boxes: Liste von Bounding Boxes
        labels: Liste von Klassen-IDs
        scores: Liste von Konfidenzwerten
        areas: Liste von Flächengrößen
        iou_threshold: Schwellenwert für die IoU-Überlappung (Standard: 0.5)
        overlap_ratio_threshold: Schwellenwert für den relativen Überlappungsanteil (Standard: 0.7)
        tolerance: Toleranzwert in Pixeln für die Erkennung "fast enthaltener" Boxen (Standard: 5)
        
    Returns:
        filtered_boxes, filtered_labels, filtered_scores, filtered_areas: Gefilterte Listen
    """
    # Erstelle Indizes und sortiere diese nach absteigender Konfidenz
    indices = np.argsort(scores)[::-1]
    
    keep_indices = []
    
    while len(indices) > 0:
        # Nehme die Box mit der höchsten Konfidenz
        current_index = indices[0]
        keep_indices.append(current_index)
        
        # Entferne den aktuellen Index aus der Liste
        indices = indices[1:]
        
        if len(indices) == 0:
            break
        
        # Hole die aktuelle Box und ihr Label
        current_box = boxes[current_index]
        current_label = labels[current_index]
        
        # Indizes der zu entfernenden Boxen
        remove_indices = []
        
        for i, idx in enumerate(indices):
            # Prüfe nur Boxen der gleichen Klasse
            if labels[idx] == current_label:
                # Berechne verschiedene Überlappungsmetriken
                overlap_metrics = calculate_overlap(current_box, boxes[idx])
                
                # Kriterium 1: Standard IoU Schwellenwert
                if overlap_metrics["iou"] > iou_threshold:
                    remove_indices.append(i)
                    continue
                
                # Kriterium 2: Eine Box ist (nahezu) vollständig in der anderen enthalten
                if is_contained(boxes[idx], current_box, tolerance):
                    # Kleinere Box ist in der größeren Box enthalten
                    remove_indices.append(i)
                    continue
                
                # Kriterium 3: Relativer Überlappungsanteil
                # Entferne die Box, wenn ein großer Teil davon mit der aktuellen Box überlappt
                if (overlap_metrics["overlap_box2_ratio"] > overlap_ratio_threshold and 
                    overlap_metrics["box2_area"] < overlap_metrics["box1_area"]):
                    remove_indices.append(i)
                    continue
        
        # Entferne die markierten Boxen
        indices = np.delete(indices, remove_indices)
    
    # Filtere die Listen basierend auf den beibehaltenen Indizes
    filtered_boxes = [boxes[i] for i in keep_indices]
    filtered_labels = [labels[i] for i in keep_indices]
    filtered_scores = [scores[i] for i in keep_indices]
    filtered_areas = [areas[i] for i in keep_indices]

    return filtered_boxes, filtered_labels, filtered_scores, filtered_areas


def _find_lines(profile, min_darkness):
    """
    Findet im 1D-Helligkeitsprofil die einzelnen Planlinien als zusammenhängende
    dunkle Bereiche (durch hellere Lücken voneinander getrennt).

    Args:
        profile: 1D-Array der "Tinten-Dunkelheit" (255 - Grauwert) quer zum Suchband
        min_darkness: Schwelle, ab der ein Pixel als Linien-Tinte zählt

    Returns:
        Liste der Linien-Mittelpositionen (Profil-Index, dunkelheitsgewichteter
        Schwerpunkt), aufsteigend sortiert. Leer, wenn keine Linie gefunden wurde.
    """
    mask = profile >= min_darkness
    lines = []
    n = len(profile)
    i = 0
    while i < n:
        if not mask[i]:
            i += 1
            continue
        # zusammenhängenden dunklen Abschnitt (eine Linie) einsammeln
        j = i
        while j < n and mask[j]:
            j += 1
        seg = profile[i:j]
        center = i + float(np.average(np.arange(j - i), weights=seg))
        lines.append(center)
        i = j
    return lines


def _snap_edge(profile, orig_offset, min_darkness, outward):
    """
    Bestimmt für ein 1D-Helligkeitsprofil senkrecht zu einer Box-Kante die
    Position der maßgeblichen Planlinie und gibt deren Index zurück.

    Fenster werden meist mit 2-3 nahe beieinander liegenden parallelen Linien
    gezeichnet. Auswahlregel nach Anzahl gefundener Linien:
      - 1 Linie  -> diese Linie
      - 2 Linien -> die *äußere* (Rahmen-/Wandkante)
      - 3 Linien -> die *mittlere* (Glas-/Mittellinie)
      - >3 Linien-> Fallback: die äußerste (konservativ)

    Args:
        profile: 1D-Array der "Tinten-Dunkelheit" (255 - Grauwert) quer zum Suchband
        orig_offset: Index der ursprünglichen Kantenposition innerhalb des Bandes
        min_darkness: Mindest-Dunkelheit, damit überhaupt eine echte Linie angenommen wird
        outward: Richtung "nach außen" als Vorzeichen bzgl. des Profil-Index:
                 -1 = kleinere Indizes liegen außen (obere/linke Kante),
                 +1 = größere Indizes liegen außen (untere/rechte Kante).

    Returns:
        Index der eingerasteten Position – oder orig_offset, wenn keine
        ausreichend dunkle Linie im Suchband liegt (Box bleibt dann unverändert).
    """
    lines = _find_lines(profile, min_darkness)
    # Keine echte Linie im Suchband -> Originalkante behalten (nie verschlechtern)
    if not lines:
        return orig_offset

    n = len(lines)
    if n == 2:
        # äußere der beiden parallelen Linien
        chosen = lines[0] if outward < 0 else lines[-1]
    elif n == 3:
        # mittlere Linie (Glas-/Mittellinie)
        chosen = lines[1]
    elif n == 1:
        chosen = lines[0]
    else:
        # >3 Linien: konservativ die äußerste wählen
        chosen = lines[0] if outward < 0 else lines[-1]
    return int(round(chosen))


def refine_boxes_to_lines(boxes, gray, search=6, min_darkness=25):
    """
    Rastet die Kanten erkannter Bounding Boxes auf die tatsächlichen (dunklen)
    Planlinien ein. Nachgelagerter, deterministischer Prozess ohne Retraining –
    nutzt aus, dass Baupläne klare Linien auf hellem Grund sind.

    Pro Box wird jede Kante in einem schmalen Suchband (+/- search px) auf die
    dominante waagrechte bzw. senkrechte Linie verschoben. Findet sich keine
    ausreichend dunkle Linie, bleibt die Kante unverändert.

    Args:
        boxes: numpy-Array der Boxen [x1, y1, x2, y2] in Pixeln der Vollauflösung
        gray: Graustufenbild (numpy uint8) in genau dieser Vollauflösung
        search: maximaler Versatz in Pixeln, um den eine Kante einrasten darf
        min_darkness: Schwelle (0-255), ab der eine Linie als real gilt

    Returns:
        numpy-Array der verfeinerten Boxen (gleiche Reihenfolge).
    """
    if boxes is None or len(boxes) == 0:
        return boxes

    h, w = gray.shape[:2]
    # Dunkle Linien -> hohe Werte
    ink = 255.0 - gray.astype(np.float32)

    refined = []
    for box in boxes:
        x1, y1, x2, y2 = (float(v) for v in box)
        ix1, iy1, ix2, iy2 = int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))

        # Box-Spanne für die Profilbildung (geklippt auf das Bild)
        cx1, cx2 = max(0, ix1), min(w, ix2)
        cy1, cy2 = max(0, iy1), min(h, iy2)
        if cx2 - cx1 < 2 or cy2 - cy1 < 2:
            refined.append(np.asarray(box, dtype=np.float32))
            continue

        # Obere Kante: waagrechte Linie -> Profil über die Box-Breite, je Zeile
        # (außen = kleinerer y-Wert = kleinerer Index -> outward=-1)
        r0, r1 = max(0, iy1 - search), min(h, iy1 + search + 1)
        if r1 - r0 >= 1:
            prof = ink[r0:r1, cx1:cx2].mean(axis=1)
            y1 = r0 + _snap_edge(prof, iy1 - r0, min_darkness, outward=-1)

        # Untere Kante (außen = größerer y-Wert -> outward=+1)
        r0, r1 = max(0, iy2 - search), min(h, iy2 + search + 1)
        if r1 - r0 >= 1:
            prof = ink[r0:r1, cx1:cx2].mean(axis=1)
            y2 = r0 + _snap_edge(prof, iy2 - r0, min_darkness, outward=+1)

        # Linke Kante: senkrechte Linie -> Profil über die Box-Höhe, je Spalte
        # (außen = kleinerer x-Wert -> outward=-1)
        c0, c1 = max(0, ix1 - search), min(w, ix1 + search + 1)
        if c1 - c0 >= 1:
            prof = ink[cy1:cy2, c0:c1].mean(axis=0)
            x1 = c0 + _snap_edge(prof, ix1 - c0, min_darkness, outward=-1)

        # Rechte Kante (außen = größerer x-Wert -> outward=+1)
        c0, c1 = max(0, ix2 - search), min(w, ix2 + search + 1)
        if c1 - c0 >= 1:
            prof = ink[cy1:cy2, c0:c1].mean(axis=0)
            x2 = c0 + _snap_edge(prof, ix2 - c0, min_darkness, outward=+1)

        # Nur übernehmen, wenn die Box gültig bleibt – sonst Original behalten
        if x2 - x1 >= 2 and y2 - y1 >= 2:
            refined.append(np.array([x1, y1, x2, y2], dtype=np.float32))
        else:
            refined.append(np.asarray(box, dtype=np.float32))

    return np.array(refined, dtype=np.float32)