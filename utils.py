# Hilfsfunktionen (Skalierung, Überlappungsberechnung etc.)
import numpy as np

def calculate_scale_factor(format_size, dpi, plan_scale):
    """
    Berechnet den Umrechnungsfaktor von Pixel zu Meter
    
    Args:
        format_size: Tuple (width, height) in mm
        dpi: Auflösung in Dots Per Inch
        plan_scale: Massstab des Plans (z.B. 100 für 1:100)
        
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
        outer_box: Liste [x1, y1, x2, y2] der potenziell umschliessenden Box
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
        areas: Liste von Flächengrössen
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
                    # Kleinere Box ist in der grösseren Box enthalten
                    remove_indices.append(i)
                    continue
                
                # Kriterium 3: Relativer Überlappungsanteil
                # Entferne die Box, wenn ein grosser Teil davon mit der aktuellen Box überlappt
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


def _auto_darkness(profile, frac=0.5, floor=40.0, abs_min=50.0):
    """
    Leitet die Linien-Schwelle adaptiv aus dem Suchband selbst ab, statt sie global
    fest vorzugeben. Idee: die dunkelste Tinte im Band ist (wenn überhaupt) die
    massgebliche Planlinie; die Schwelle wird relativ dazu gesetzt.

      - Kräftige dunkle Rahmenlinie (Peak hoch)  -> hohe Schwelle -> Schatten fliegen raus.
      - Blasse, dünne Linie (Peak niedrig)       -> niedrige Schwelle -> Linie bleibt erhalten.

    So löst sich das Dilemma "hohe Schwelle = präzise, killt aber blasse Linien" je
    Kante individuell, ohne globalen Tuning-Wert.

    Args:
        profile: 1D-Tinten-Dunkelheit quer zum Band (0..255, gross = eher Linie)
        frac:    Schwelle als Anteil des Band-Maximums (0.5 = halb so dunkel wie der Peak)
        floor:   absolute Untergrenze, damit reines Rauschen/leichte Schatten nicht zählen
        abs_min: liegt selbst der dunkelste Punkt darunter, gilt das Band als "keine echte
                 Linie" -> Schwelle über den Peak, sodass nichts gefunden wird (kein Snap)

    Returns:
        numerische Schwelle (float)
    """
    if profile is None or len(profile) == 0:
        return floor
    peak = float(np.max(profile))
    if peak < abs_min:
        return peak + 1.0  # nichts im Band dunkel genug -> nichts findbar -> Kante bleibt
    return max(floor, frac * peak)


def _resolve_darkness(profile, min_darkness):
    """Erlaubt min_darkness='auto' (pro Band adaptiv, siehe _auto_darkness) neben
    einem festen numerischen Wert."""
    if isinstance(min_darkness, str) and min_darkness == 'auto':
        return _auto_darkness(profile)
    return min_darkness


def _threshold_crossings(profile, level, rising):
    """
    Findet die Stellen, an denen das Tintenprofil die Schwelle `level` kreuzt –
    also die *Kanten* dunkler Bereiche (Weiss->Schwarz bzw. Schwarz->Weiss), nicht
    deren Schwerpunkt. Subpixel-genau durch lineare Interpolation zwischen den
    beiden Nachbar-Stützstellen.

    Gedacht für massive dunkle Körper (z.B. Ansichtsfenster), bei denen Rahmen
    und Fensterfläche zu einem durchgehenden dunklen Block verschmelzen: dort ist
    die massgebliche Kante der *Übergang* am Rand des Blocks, den _find_lines (das
    nur Schwerpunkte liefert) nicht trifft.

    Args:
        profile: 1D-Array der Tinten-Dunkelheit
        level: Schwellenwert für die Kante
        rising: True  -> nur steigende Flanken (Weiss->Schwarz, Index aufsteigend),
                         massgeblich für obere/linke Box-Kante (Körper innen = höhere Indizes)
                False -> nur fallende Flanken (Schwarz->Weiss), für untere/rechte Kante

    Returns:
        Liste der Kreuzungspositionen (Profil-Index, float), aufsteigend.
    """
    cr = []
    p = np.asarray(profile, dtype=np.float64)
    for i in range(len(p) - 1):
        a, b = p[i], p[i + 1]
        if rising and a < level <= b:
            cr.append(i + (level - a) / (b - a))
        elif (not rising) and a >= level > b:
            cr.append(i + (a - level) / (a - b))
    return cr


def _snap_edge(profile, orig_offset, min_darkness, outward, select='second_inner'):
    """
    Bestimmt für ein 1D-Tintenprofil senkrecht zu einer Box-Kante die Position
    der massgeblichen Planlinie und gibt deren Index zurück.

    Über select wird gesteuert, welche der gefundenen Linien gewählt wird –
    entscheidend, weil je nach Plantyp eine andere Linie die richtige ist:

      'second_inner' – die *zweit-innerste* (von der Box-Mitte gezählt). Für
                       GRUNDRISSE gedacht: die innerste Linie ist dort die
                       Glaslinie (Box zu klein), die zweit-innerste der Rahmen.
      'nearest'      – die Linie, die der *ursprünglichen* Kante am nächsten liegt.
                       Robust, wenn das Netz bereits gut sitzt (nur kleine
                       Korrektur). Für ANSICHTEN/Fassaden meist richtig, wo viele
                       Linien (Sturz, Bank, Laden) dicht liegen und 'second_inner'
                       nach aussen verrutscht.
      'edge'         – nicht der Linien-*Schwerpunkt*, sondern die *Kante* des
                       dunklen Bereichs (Schwellen-Übergang) am nächsten zur
                       Netz-Kante, mit korrekter Polarität (steigende Flanke für
                       obere/linke, fallende für untere/rechte Kante). Trifft den
                       Rahmen auch dann, wenn er mit der Fensterfläche zu einem
                       durchgehenden dunklen Block verschmilzt (siehe
                       _threshold_crossings).
      'outer_near'   – von den *zwei der Netz-Kante nächsten* Linien die äussere.
                       Lokalisierte Variante von 'second_inner': greift nur die
                       Rahmenkante aus dem nahen Linienpaar, ohne weit entfernte
                       Linien (Sturz/Bank) einzubeziehen. Setzt aber voraus, dass
                       das Linienpaar überhaupt getrennt erkannt wird.
      'innermost'    – die zur Box-Mitte hin äusserste gefundene Linie.
      'outermost'    – die von der Box-Mitte am weitesten entfernte Linie.

    Args:
        profile: 1D-Array der Tinten-Dunkelheit quer zum Suchband
        orig_offset: Index der ursprünglichen Kantenposition innerhalb des Bandes
        min_darkness: Mindest-Dunkelheit, damit überhaupt eine echte Linie zählt
        outward: Richtung "nach aussen" als Vorzeichen bzgl. des Profil-Index:
                 -1 = kleinere Indizes liegen aussen (obere/linke Kante),
                 +1 = grössere Indizes liegen aussen (untere/rechte Kante).
        select: Auswahlstrategie (siehe oben).

    Returns:
        Index der eingerasteten Position – oder orig_offset, wenn keine
        ausreichend dunkle Linie im Suchband liegt (Box bleibt dann unverändert).
    """
    if select == 'edge':
        # Kante des dunklen Bereichs statt Schwerpunkt: Polarität aus outward
        # (obere/linke = steigende Flanke, untere/rechte = fallende).
        crossings = _threshold_crossings(profile, min_darkness, rising=(outward < 0))
        if not crossings:
            return orig_offset
        return int(round(min(crossings, key=lambda c: abs(c - orig_offset))))

    lines = _find_lines(profile, min_darkness)
    # Keine echte Linie im Suchband -> Originalkante behalten (nie verschlechtern)
    if not lines:
        return orig_offset

    if select == 'nearest':
        chosen = min(lines, key=lambda l: abs(l - orig_offset))
    elif select == 'outer_near':
        # Die zwei der Netz-Kante nächstgelegenen Linien betrachten und davon die
        # *äussere* (weiter von der Box-Mitte weg) nehmen. Idee: ein Fensterrahmen
        # wird oft als enges Linienpaar gezeichnet; die äussere ist die Rahmenkante.
        # (entgegen 'outward' liegt innen -> aussen = kleinerer Index bei outward<0)
        nearest2 = sorted(lines, key=lambda l: abs(l - orig_offset))[:2]
        chosen = min(nearest2) if outward < 0 else max(nearest2)
    elif select == 'innermost':
        # innen = entgegen "outward": bei outward<0 die grössten Indizes
        chosen = lines[-1] if outward < 0 else lines[0]
    elif select == 'outermost':
        chosen = lines[0] if outward < 0 else lines[-1]
    else:  # 'second_inner'
        if len(lines) == 1:
            chosen = lines[0]
        else:
            chosen = lines[-2] if outward < 0 else lines[1]
    return int(round(chosen))


def _ink_from_image(img, mode='black'):
    """
    Wandelt ein Bild in ein "Tinten"-Profil (float, 0..255 – je grösser, desto
    eher Linie). Über mode wird gesteuert, welche Linienfarben als Tinte zählen –
    entscheidend, um schwarze Baugeometrie von bunten Hilfslinien (Bemassung,
    Raster, Schraffur in Gelb/Cyan/Grün) zu trennen.

    Modi:
      'black'     – nur dunkle Pixel (255 - hellster Kanal). Bunte Linien, auch
                    Rot, zählen NICHT. Für reine Graustufenbilder identisch zu
                    255 - Grauwert.
      'black_red' – schwarz ODER rot (rote Linien werden in Plänen oft für
                    Fenster/Schnitte genutzt); andere Farben zählen nicht.
      'red'       – nur Rot.
      'min'       – Alt-Verhalten: 255 - dunkelster Kanal. Jede gesättigte Farbe
                    (auch Gelb/Cyan) zählt – erfasst damit viele Hilfslinien.

    Hinweis: Wirkt nur auf echten Farbbildern. Ein bereits in Graustufen
    gewandeltes Bild (R=G=B) liefert für alle Modi ausser 'red' dasselbe.
    """
    a = img.astype(np.float32)
    if a.ndim == 2:
        return 255.0 - a  # Graustufe: nur Dunkelheit möglich
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    if mode == 'min':
        return 255.0 - np.minimum(np.minimum(r, g), b)
    darkness = 255.0 - np.maximum(np.maximum(r, g), b)
    if mode == 'black':
        return darkness
    redness = np.clip(np.minimum(r - g, r - b), 0.0, 255.0)
    if mode == 'red':
        return redness
    # 'black_red'
    return np.maximum(darkness, redness)


def refine_boxes_to_lines(boxes, img, search=16, min_darkness=25, ink_mode='black', select='second_inner'):
    """
    Rastet die Kanten erkannter Bounding Boxes auf die tatsächlichen Planlinien
    ein. Nachgelagerter, deterministischer Prozess ohne Retraining – nutzt aus,
    dass Baupläne klare Linien auf hellem Grund sind.

    Pro Box wird jede Kante in einem schmalen Suchband (+/- search px) auf die
    massgebliche Planlinie verschoben (siehe _snap_edge: zweit-innerste Linie).
    Findet sich keine ausreichend dunkle Linie, bleibt die Kante unverändert.

    Tinte ("ink") wird per ink_mode bestimmt (siehe _ink_from_image): 'black'
    zählt nur dunkle Linien, 'black_red' zusätzlich rote, 'min' jede gesättigte
    Farbe. So lassen sich bunte Hilfslinien (Bemassung, Raster) ausblenden, die
    sonst die Kante falsch einrasten. Über die Box-Spanne wird der *Median*
    gebildet (robust gegen Lücken, Schräglage und nur teilweise abgedeckte Linien).

    Wichtig: ink_mode wirkt nur, wenn img ein echtes Farbbild ist. Wird ein bereits
    grau gewandeltes Bild übergeben (R=G=B), gibt es nichts mehr zu unterscheiden.

    Args:
        boxes: numpy-Array der Boxen [x1, y1, x2, y2] in Pixeln der Vollauflösung
        img: Bild (numpy uint8) in genau dieser Vollauflösung – Farbe (H,W,3)
             bevorzugt, Graustufe (H,W) wird ebenfalls akzeptiert
        search: maximaler Versatz in Pixeln, um den eine Kante einrasten darf
        min_darkness: Schwelle (0-255), ab der ein Pixel als Linien-Tinte zählt –
                      oder 'auto' für eine pro Kante adaptiv aus dem Band abgeleitete
                      Schwelle (siehe _auto_darkness / _resolve_darkness)
        ink_mode: 'black' | 'black_red' | 'red' | 'min' – welche Linienfarben als
                  Tinte zählen (siehe _ink_from_image)
        select: 'second_inner' | 'nearest' | 'edge' | 'innermost' | 'outermost' –
                wie die massgebliche Position je Kante gewählt wird (siehe _snap_edge)

    Returns:
        numpy-Array der verfeinerten Boxen (gleiche Reihenfolge).
    """
    if boxes is None or len(boxes) == 0:
        return boxes

    h, w = img.shape[:2]
    # Tinte je nach ink_mode (siehe _ink_from_image): 'black' = nur dunkle Linien,
    # 'black_red' = schwarz oder rot, 'min' = altes Verhalten (jede Farbe zählt).
    ink = _ink_from_image(img, ink_mode)

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

        # Obere Kante: waagrechte Linie -> Median-Profil über die Box-Breite, je Zeile
        # (aussen = kleinerer y-Wert = kleinerer Index -> outward=-1)
        r0, r1 = max(0, iy1 - search), min(h, iy1 + search + 1)
        if r1 - r0 >= 1:
            prof = np.median(ink[r0:r1, cx1:cx2], axis=1)
            md = _resolve_darkness(prof, min_darkness)
            y1 = r0 + _snap_edge(prof, iy1 - r0, md, outward=-1, select=select)

        # Untere Kante (aussen = grösserer y-Wert -> outward=+1)
        r0, r1 = max(0, iy2 - search), min(h, iy2 + search + 1)
        if r1 - r0 >= 1:
            prof = np.median(ink[r0:r1, cx1:cx2], axis=1)
            md = _resolve_darkness(prof, min_darkness)
            y2 = r0 + _snap_edge(prof, iy2 - r0, md, outward=+1, select=select)

        # Linke Kante: senkrechte Linie -> Median-Profil über die Box-Höhe, je Spalte
        # (aussen = kleinerer x-Wert -> outward=-1)
        c0, c1 = max(0, ix1 - search), min(w, ix1 + search + 1)
        if c1 - c0 >= 1:
            prof = np.median(ink[cy1:cy2, c0:c1], axis=0)
            md = _resolve_darkness(prof, min_darkness)
            x1 = c0 + _snap_edge(prof, ix1 - c0, md, outward=-1, select=select)

        # Rechte Kante (aussen = grösserer x-Wert -> outward=+1)
        c0, c1 = max(0, ix2 - search), min(w, ix2 + search + 1)
        if c1 - c0 >= 1:
            prof = np.median(ink[cy1:cy2, c0:c1], axis=0)
            md = _resolve_darkness(prof, min_darkness)
            x2 = c0 + _snap_edge(prof, ix2 - c0, md, outward=+1, select=select)

        # Nur übernehmen, wenn die Box gültig bleibt – sonst Original behalten
        if x2 - x1 >= 2 and y2 - y1 >= 2:
            refined.append(np.array([x1, y1, x2, y2], dtype=np.float32))
        else:
            refined.append(np.asarray(box, dtype=np.float32))

    return np.array(refined, dtype=np.float32)