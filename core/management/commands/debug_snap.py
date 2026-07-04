"""
Diagnose-Werkzeug für den Snap-to-Line der Fenster-Erkennung.

Hintergrund: utils.refine_boxes_to_lines rastet die KI-Boxen nachträglich auf
die dunklen Planlinien ein. Bei manchen Plänen bleibt ein kleiner Versatz. Dieses
Command macht *sichtbar*, warum: Es legt pro erkannter Box vier Ebenen übereinander
und zeigt damit, ob im Suchband überhaupt eine Linie lag, welche Linien gefunden
wurden und welche der Snap gewählt hat.

Ebenen im Overlay:
    rot      – rohe KI-Box (vor dem Snap)
    grün     – eingerastete Box (nach refine_boxes_to_lines)
    blau     – Suchband ±search je Kante
    orange   – von _find_lines gefundene Linien im Band (Ticks)
    grün-dick– die je Kante vom Snap *gewählte* Linie

Linien/Snap werden mit denselben Helfern (_find_lines, _snap_edge,
refine_boxes_to_lines) berechnet wie in der Produktion. ABER: die Produktion
füttert den Snap mit dem grau gewandelten Bild aus preprocess_image – Farb-
unterscheidung ist dort wirkungslos. Dieses Tool rechnet bewusst auf dem FARB-
Render, damit --ink-mode (schwarz/rot vs. jede Farbe) sichtbar wird; das ist das
*vorgeschlagene* Verhalten, das man vor einer Produktionsumstellung hier prüft.

Aufruf:
    python manage.py debug_snap pfad/zur/datei.pdf
    python manage.py debug_snap datei.pdf --page 3 --search 16 --min-darkness 25
    python manage.py debug_snap datei.pdf --ink-mode black_red   # schwarz+rot statt nur schwarz
    python manage.py debug_snap datei.pdf --ink-mode min         # Alt: jede Farbe zählt
    python manage.py debug_snap datei.pdf --crops                # zusätzlich Zoom-Crops je Box
    python manage.py debug_snap datei.pdf --ink-bg --min-darkness 120  # Hintergrund = was die Schwelle übriglässt
    python manage.py debug_snap datei.pdf --auto-darkness --crops      # adaptive Schwelle pro Kante (Option B)

Benötigt PyMuPDF (fitz):  pip install PyMuPDF
"""

import io
from pathlib import Path

import numpy as np
from django.core.management.base import BaseCommand, CommandError
from django.conf import settings

import torch
from torchvision import transforms

from model_handler import load_model, resize_image_if_large
from image_preprocessing import preprocess_image
from utils import refine_boxes_to_lines, _find_lines, _snap_edge, _ink_from_image, _resolve_darkness


# Klassen-IDs -> Kürzel (vgl. CLAUDE.md: 6 Klassen inkl. Background)
LABEL_NAMES = {0: 'BG', 1: 'Fenster', 2: 'Tür', 3: 'Wand', 4: 'Gaube', 5: 'Dach'}


def _raw_boxes(image_bytes, threshold):
    """
    Reproduziert exakt den Inferenz-Teil von model_handler.predict_image bis
    *vor* dem Snap und gibt zurück:
        full_res_rgb : np.uint8 (H,W,3) – das vorverarbeitete Vollauflösungsbild,
                       auf dem refine_boxes_to_lines arbeitet
        boxes,labels,scores : rohe Detektionen (>= threshold) in Vollauflösungs-Pixeln
    """
    model = load_model()
    device = next(model.parameters()).device

    processed_image = preprocess_image(image_bytes)
    full_res_rgb = np.array(processed_image.convert('RGB'))

    processed_image, coord_scale = resize_image_if_large(processed_image, max_size=2048)
    image_tensor = transforms.Compose([transforms.ToTensor()])(processed_image).unsqueeze(0).to(device)

    with torch.no_grad():
        prediction = model(image_tensor)
    del image_tensor
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    boxes = prediction[0]['boxes'].cpu().numpy()
    labels = prediction[0]['labels'].cpu().numpy()
    scores = prediction[0]['scores'].cpu().numpy()
    if coord_scale != 1.0:
        boxes = boxes * coord_scale

    keep = scores >= threshold
    return full_res_rgb, boxes[keep], labels[keep], scores[keep]


def _edge_lines(ink, box, search, min_darkness, select):
    """
    Wertet für eine Box dasselbe aus, was refine_boxes_to_lines intern tut, und
    liefert pro Kante die Sichtbarmachung. Reihenfolge der Helfer-Aufrufe ist
    identisch zur Produktion, damit 'chosen' wirklich der gewählten Linie entspricht.

    Rückgabe: dict edge -> (band_lo, band_hi, found_abs[list], chosen_abs_or_None)
      edge in {'top','bottom','left','right'}; Positionen in Bild-Pixeln.
    """
    h, w = ink.shape[:2]
    x1, y1, x2, y2 = (float(v) for v in box)
    ix1, iy1, ix2, iy2 = int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))
    cx1, cx2 = max(0, ix1), min(w, ix2)
    cy1, cy2 = max(0, iy1), min(h, iy2)

    out = {}
    if cx2 - cx1 < 2 or cy2 - cy1 < 2:
        return out

    def eval_edge(prof, band_start, orig_offset, outward):
        # Schwelle je Band auflösen (numerisch ODER 'auto' = adaptiv) – exakt wie
        # refine_boxes_to_lines, damit 'found'/'chosen' der Produktion entsprechen.
        md = _resolve_darkness(prof, min_darkness)
        found = [band_start + p for p in _find_lines(prof, md)]
        snapped = _snap_edge(prof, orig_offset, md, outward, select=select)
        chosen = None if snapped == orig_offset and not _find_lines(prof, md) else band_start + snapped
        return found, chosen

    # exakt wie refine_boxes_to_lines (Profilrichtung + outward beachten)
    r0, r1 = max(0, iy1 - search), min(h, iy1 + search + 1)
    if r1 - r0 >= 1:
        prof = np.median(ink[r0:r1, cx1:cx2], axis=1)
        found, chosen = eval_edge(prof, r0, iy1 - r0, -1)
        out['top'] = (r0, r1, found, chosen)

    r0, r1 = max(0, iy2 - search), min(h, iy2 + search + 1)
    if r1 - r0 >= 1:
        prof = np.median(ink[r0:r1, cx1:cx2], axis=1)
        found, chosen = eval_edge(prof, r0, iy2 - r0, +1)
        out['bottom'] = (r0, r1, found, chosen)

    c0, c1 = max(0, ix1 - search), min(w, ix1 + search + 1)
    if c1 - c0 >= 1:
        prof = np.median(ink[cy1:cy2, c0:c1], axis=0)
        found, chosen = eval_edge(prof, c0, ix1 - c0, -1)
        out['left'] = (c0, c1, found, chosen)

    c0, c1 = max(0, ix2 - search), min(w, ix2 + search + 1)
    if c1 - c0 >= 1:
        prof = np.median(ink[cy1:cy2, c0:c1], axis=0)
        found, chosen = eval_edge(prof, c0, ix2 - c0, +1)
        out['right'] = (c0, c1, found, chosen)
    return out


def _auto_ink_mask(ink, boxes, search):
    """
    Schwarz/Weiss-Maske für --ink-bg im Auto-Modus: wendet pro Such-Band die
    ADAPTIVE Schwelle an (exakt wie der Auto-Snap je Kante, siehe _auto_darkness).
    Schwarz = Tinte >= Band-Schwelle (zählt als Linie), weiss = darunter.

    Nur die Such-Bänder der Box-Kanten werden binarisiert – nur dort trifft der Snap
    überhaupt eine Entscheidung; der Rest bleibt weiss. So sieht man pro Kante, was
    die adaptive Schwelle übriglässt (anders als eine globale feste Schwelle).
    """
    h, w = ink.shape[:2]
    mask = np.full((h, w), 255, dtype=np.uint8)
    for box in boxes:
        x1, y1, x2, y2 = (float(v) for v in box)
        ix1, iy1, ix2, iy2 = int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))
        cx1, cx2 = max(0, ix1), min(w, ix2)
        cy1, cy2 = max(0, iy1), min(h, iy2)
        if cx2 - cx1 < 2 or cy2 - cy1 < 2:
            continue
        # obere/untere Kante: waagrechtes Band über die Box-Breite, Median je Zeile
        for iy in (iy1, iy2):
            r0, r1 = max(0, iy - search), min(h, iy + search + 1)
            if r1 - r0 >= 1:
                sub = ink[r0:r1, cx1:cx2]
                thr = _resolve_darkness(np.median(sub, axis=1), 'auto')
                mask[r0:r1, cx1:cx2][sub >= thr] = 0
        # linke/rechte Kante: senkrechtes Band über die Box-Höhe, Median je Spalte
        for ix in (ix1, ix2):
            c0, c1 = max(0, ix - search), min(w, ix + search + 1)
            if c1 - c0 >= 1:
                sub = ink[cy1:cy2, c0:c1]
                thr = _resolve_darkness(np.median(sub, axis=0), 'auto')
                mask[cy1:cy2, c0:c1][sub >= thr] = 0
    return mask


class Command(BaseCommand):
    help = 'Visualisiert den Snap-to-Line (refine_boxes_to_lines) zur Diagnose von Box-Versatz.'

    def add_arguments(self, parser):
        parser.add_argument('pdf', type=str, help='Pfad zur PDF-Datei')
        parser.add_argument('--page', type=int, default=0, help='Nur diese Seite (1-basiert); 0 = alle')
        parser.add_argument('--dpi', type=float, default=float(getattr(settings, 'PDF_DPI', 150)))
        parser.add_argument('--threshold', type=float, default=0.5, help='Erkennungs-Schwelle')
        parser.add_argument('--search', type=int, default=16, help='Suchband je Kante in Pixeln')
        parser.add_argument('--min-darkness', type=int, default=25, help='Schwelle ab der ein Pixel als Linie zählt')
        parser.add_argument('--ink-mode', choices=['black', 'black_red', 'red', 'min'], default='black',
                            help="Welche Linienfarben als Tinte zählen: black=nur dunkel, "
                                 "black_red=dunkel+rot, red=nur rot, min=jede Farbe (Alt-Verhalten)")
        parser.add_argument('--select', choices=['second_inner', 'nearest', 'edge', 'outer_near', 'innermost', 'outermost'],
                            default='second_inner',
                            help="Wie die Kante gewählt wird: second_inner=Alt (Grundriss), "
                                 "nearest=nächste Linie zur Netz-Kante, edge=Kante des dunklen "
                                 "Bereichs (Übergang) statt Schwerpunkt (Ansicht/Fassade)")
        parser.add_argument('--only-windows', action='store_true', help='Nur Fenster (Label 1) zeichnen')
        parser.add_argument('--crops', action='store_true', help='Zusätzlich Zoom-Crop je Box speichern')
        parser.add_argument('--ink-bg', action='store_true',
                            help='Als Hintergrund das geschwellte Bild zeigen (nur was bei '
                                 '--min-darkness als Linie zählt), statt des Original-Plans')
        parser.add_argument('--auto-darkness', action='store_true',
                            help='min-darkness ignorieren und die Schwelle pro Kante adaptiv aus '
                                 'dem Suchband ableiten (Option B, siehe utils._auto_darkness)')
        parser.add_argument('--out', type=str, default='', help='Ausgabeordner für Overlay-PNGs')

    def handle(self, *args, **opts):
        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise CommandError("PyMuPDF fehlt. Installieren mit:  pip install PyMuPDF")
        from PIL import Image, ImageDraw

        pdf_path = Path(opts['pdf']).expanduser()
        if not pdf_path.exists():
            raise CommandError(f"PDF nicht gefunden: {pdf_path}")

        out_dir = Path(opts['out']) if opts['out'] else Path(str(pdf_path.with_suffix('')) + '_snapdiag')
        out_dir.mkdir(parents=True, exist_ok=True)

        dpi, search, min_darkness = opts['dpi'], opts['search'], opts['min_darkness']
        scale_px = dpi / 72.0

        doc = fitz.open(str(pdf_path))
        pages = [opts['page'] - 1] if opts['page'] else range(len(doc))

        tot_boxes = tot_moved = 0
        # Offset-Statistik je Kante (Betrag der Verschiebung in px)
        deltas = []

        for pno in pages:
            if pno < 0 or pno >= len(doc):
                self.stderr.write(f"Seite {pno + 1} ausserhalb des Bereichs – übersprungen")
                continue
            page = doc[pno]
            pix = page.get_pixmap(matrix=fitz.Matrix(scale_px, scale_px), alpha=False)
            render = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
            buf = io.BytesIO()
            render.save(buf, format='PNG')

            _gray, boxes, labels, scores = _raw_boxes(buf.getvalue(), opts['threshold'])

            if opts['only_windows'] and len(boxes):
                m = labels == 1
                boxes, labels, scores = boxes[m], labels[m], scores[m]

            # Wichtig: Snap/Ink auf dem FARB-Render (nicht der Graustufe aus
            # preprocess_image) – nur so können die Farbmodi schwarz/rot von
            # bunten Hilfslinien trennen. Geometrie identisch (gleiche Auflösung).
            color = np.array(render)
            # 'auto' = adaptive Schwelle pro Kante (Option B), sonst fester Wert
            md_param = 'auto' if opts['auto_darkness'] else min_darkness
            refined = refine_boxes_to_lines(boxes, color, search=search,
                                            min_darkness=md_param, ink_mode=opts['ink_mode'],
                                            select=opts['select'])
            ink = _ink_from_image(color, opts['ink_mode'])

            # Optional: Hintergrund durch das geschwellte Bild ersetzen, um zu sehen,
            # welche Linien der Snap "sieht". Erst NACH Inferenz/ink-Berechnung – das
            # Modell bekommt weiterhin den echten Plan.
            if opts['ink_bg']:
                if opts['auto_darkness']:
                    # adaptive Schwelle pro Band anwenden (nur in den Such-Bändern)
                    mask = _auto_ink_mask(ink, boxes, search)
                else:
                    mask = np.where(ink >= min_darkness, 0, 255).astype(np.uint8)
                render = Image.fromarray(mask, mode='L').convert('RGB')

            draw = ImageDraw.Draw(render)
            page_moved = 0

            for i, box in enumerate(boxes):
                x1, y1, x2, y2 = (float(v) for v in box)
                rx1, ry1, rx2, ry2 = (float(v) for v in refined[i])

                edges = _edge_lines(ink, box, search, md_param, opts['select'])
                for band_lo, band_hi, found, chosen in edges.values():
                    pass  # gezeichnet unten je Orientierung

                # Suchbänder + Linien je Kante zeichnen
                def draw_h_edge(info):
                    band_lo, band_hi, found, chosen = info
                    draw.rectangle([x1, band_lo, x2, band_hi], outline=(80, 120, 255), width=1)
                    for p in found:
                        draw.line([x1, p, x2, p], fill=(255, 150, 0), width=1)
                    if chosen is not None:
                        draw.line([x1, chosen, x2, chosen], fill=(0, 200, 0), width=2)

                def draw_v_edge(info):
                    band_lo, band_hi, found, chosen = info
                    draw.rectangle([band_lo, y1, band_hi, y2], outline=(80, 120, 255), width=1)
                    for p in found:
                        draw.line([p, y1, p, y2], fill=(255, 150, 0), width=1)
                    if chosen is not None:
                        draw.line([chosen, y1, chosen, y2], fill=(0, 200, 0), width=2)

                if 'top' in edges:    draw_h_edge(edges['top'])
                if 'bottom' in edges: draw_h_edge(edges['bottom'])
                if 'left' in edges:   draw_v_edge(edges['left'])
                if 'right' in edges:  draw_v_edge(edges['right'])

                # Boxen oben drauf
                draw.rectangle([x1, y1, x2, y2], outline=(220, 0, 0), width=2)        # roh
                draw.rectangle([rx1, ry1, rx2, ry2], outline=(0, 160, 0), width=2)    # gesnappt

                edge_deltas = (abs(rx1 - x1), abs(ry1 - y1), abs(rx2 - x2), abs(ry2 - y2))
                moved = max(edge_deltas) >= 0.5
                deltas.extend(edge_deltas)
                tot_boxes += 1
                if moved:
                    tot_moved += 1
                    page_moved += 1

                if opts['crops']:
                    m = search + 8
                    cl, ct = max(0, int(min(x1, rx1) - m)), max(0, int(min(y1, ry1) - m))
                    cr, cb = int(max(x2, rx2) + m), int(max(y2, ry2) + m)
                    crop = render.crop((cl, ct, cr, cb))
                    z = max(1, int(round(400 / max(1, max(cr - cl, cb - ct)))))
                    if z > 1:
                        crop = crop.resize((crop.width * z, crop.height * z), Image.NEAREST)
                    name = LABEL_NAMES.get(int(labels[i]), str(labels[i]))
                    crop.save(out_dir / f"page_{pno + 1}_box{i:02d}_{name}.png")

            out_png = out_dir / f"page_{pno + 1}.png"
            render.save(out_png)
            self.stdout.write(
                f"Seite {pno + 1}: {len(boxes)} Boxen, {page_moved} verschoben → {out_png.name}")

        doc.close()

        self.stdout.write("")
        if tot_boxes:
            arr = np.array(deltas)
            moved_edges = arr[arr >= 0.5]
            self.stdout.write(self.style.SUCCESS(
                f"Gesamt: {tot_moved}/{tot_boxes} Boxen vom Snap verschoben"))
            self.stdout.write(
                f"Kanten-Versatz (nur verschobene, px): median {np.median(moved_edges):.1f}, "
                f"p90 {np.percentile(moved_edges, 90):.1f}, max {moved_edges.max():.1f}"
                if len(moved_edges) else "Keine Kante wurde verschoben.")
            dark_note = "auto (adaptiv pro Kante)" if opts['auto_darkness'] else f"{min_darkness}"
            bg_note = ", Hintergrund=Auto-Schwelle pro Band" if (opts['ink_bg'] and opts['auto_darkness']) \
                else (f", Hintergrund=Schwelle@{min_darkness}" if opts['ink_bg'] else "")
            self.stdout.write(
                f"Overlays: {out_dir}   (ink-mode: {opts['ink_mode']}, select: {opts['select']}, "
                f"min-darkness: {dark_note}{bg_note})")
            self.stdout.write(
                "Legende: rot=KI-Box, grün=gesnappt, blau=Suchband, "
                "orange=gefundene Linie, grün-dick=gewählte Linie")
        else:
            self.stdout.write(self.style.WARNING("Keine Boxen erkannt."))
