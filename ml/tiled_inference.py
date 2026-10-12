"""
Kachel-Inferenz für die Fenstererkennung (SAHI-Prinzip).

Das Netz sieht den Plan in voller 150-DPI-Auflösung in überlappenden Kacheln
(TILE × TILE, Überlappung OVERLAP) statt als ganze Seite, die torchvision intern
auf ≤1333 px herunterrechnet (bei A1 Faktor ~4 – dünne Rahmenlinien verschwinden).

Zusammenführen: Boxen, die eine *innere* Kachelkante berühren, sind dort
abgeschnitten. Liegt dasselbe Fenster in einer Nachbarkachel vollständig (der
Normalfall, solange es < OVERLAP ist), gewinnt die vollständige Box; nur für
Fensterbänder, die keine Kachel ganz enthält, werden die Teilstücke zu ihrer
Vereinigung zusammengesetzt. Danach NMS über alle Kacheln.
"""
import os

import cv2
import numpy as np
import torch
import torchvision
from torchvision.models.detection import fasterrcnn_resnet50_fpn_v2
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor

TILE = 1024
OVERLAP = 512
BORDER = 6          # px: Box gilt als "an der Kachelkante abgeschnitten"
NUM_CLASSES = 3     # Hintergrund, Fenster, Tür
WINDOW, DOOR = 1, 2


def build_model(num_classes=NUM_CLASSES, pretrained=True):
    model = fasterrcnn_resnet50_fpn_v2(
        weights='DEFAULT' if pretrained else None,
        min_size=TILE, max_size=TILE,          # Kacheln 1:1, kein internes Resize
        box_detections_per_img=300,
    )
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)
    return model


def to_input(rgb):
    """Gleiches Vorverarbeiten in Training und Inferenz: Graustufen → 3 Kanäle.
    (Farbe ist auf Plänen fast nie das Merkmal eines Fensters, sondern Rauschen.)"""
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    return np.repeat(g[:, :, None], 3, axis=2)


def has_ink(gray, dark=200, min_frac=0.002):
    """Leere Kacheln (weisse Planränder, Freiflächen) überspringen – ohne Linien
    kann dort kein Fenster sein, und auf der CPU kostet jede Kachel Sekunden."""
    return np.count_nonzero(gray[::2, ::2] < dark) >= min_frac * gray[::2, ::2].size


def pad_tile(t):
    """Randkacheln (und kleine Pläne) weiss auf TILE×TILE auffüllen – sonst skaliert
    das Modell (min_size=TILE) sie hoch und die Fenster hätten eine andere Grösse
    als im Training."""
    h, w = t.shape[:2]
    if h == TILE and w == TILE:
        return t
    out = np.full((TILE, TILE, 3), 255, np.uint8)
    out[:h, :w] = t
    return out


def tile_origins(length, tile=TILE, overlap=OVERLAP):
    if length <= tile:
        return [0]
    stride = tile - overlap
    xs = list(range(0, length - tile, stride)) + [length - tile]
    return sorted(set(xs))


def _io_min(a, b):
    """Schnittfläche / kleinere Fläche, paarweise."""
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    aa = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    ab = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / (np.minimum(aa[:, None], ab[None, :]) + 1e-9)


def merge_tiles(b, s, l, cut, nms_iou=0.5, cover=0.6):
    full = ~cut
    fb, fs, fl = b[full], s[full], l[full]
    keep = torchvision.ops.batched_nms(torch.from_numpy(fb).float(), torch.from_numpy(fs).float(),
                                       torch.from_numpy(fl), nms_iou).numpy()
    fb, fs, fl = fb[keep], fs[keep], fl[keep]
    cb, cs, cl = b[cut], s[cut], l[cut]
    if len(cb) and len(fb):
        covered = (_io_min(cb, fb) > cover).any(axis=1)
        cb, cs, cl = cb[~covered], cs[~covered], cl[~covered]
    # Teilstücke ohne vollständiges Gegenstück: überlappende Fragmente vereinigen
    groups = []
    for i in np.argsort(-cs):
        for g in groups:
            if cl[g[0]] == cl[i] and (_io_min(cb[[i]], cb[g]) > 0.5).any():
                g.append(i)
                break
        else:
            groups.append([i])
    mb = [np.r_[cb[g, :2].min(0), cb[g, 2:].max(0)] for g in groups]
    ms = [cs[g].mean() for g in groups]
    ml = [cl[g[0]] for g in groups]
    if mb:
        fb = np.vstack([fb, np.array(mb)])
        fs = np.r_[fs, ms]
        fl = np.r_[fl, ml]
    return fb, fs, fl


class TiledDetector:
    def __init__(self, model_path, device=None, snap=False, classes=(WINDOW,)):
        self.device = torch.device(device or ('cuda' if torch.cuda.is_available() else 'cpu'))
        self.model = build_model(pretrained=False)
        state = torch.load(model_path, map_location=self.device)
        self.model.load_state_dict(state.get('model', state))
        self.model.to(self.device).eval()
        self.snap = snap
        self.classes = classes

    @torch.no_grad()
    def predict_rgb(self, rgb, score_thr=0.05, batch=4):
        h, w = rgb.shape[:2]
        x = to_input(rgb)
        origins = [(ox, oy) for oy in tile_origins(h) for ox in tile_origins(w)
                   if has_ink(x[oy:oy + TILE, ox:ox + TILE, 0])]
        all_b, all_s, all_l, all_c = [], [], [], []
        for i in range(0, len(origins), batch):
            chunk = origins[i:i + batch]
            tens, sizes = [], []
            for ox, oy in chunk:
                t = pad_tile(x[oy:oy + TILE, ox:ox + TILE])
                sizes.append((min(TILE, h - oy), min(TILE, w - ox)))
                tens.append(torch.from_numpy(t).permute(2, 0, 1).float().div(255).to(self.device))
            with torch.autocast(self.device.type, enabled=self.device.type == 'cuda'):
                outs = self.model(tens)
            for (ox, oy), o, (th, tw) in zip(chunk, outs, sizes):
                b = o['boxes'].float().cpu().numpy()
                s = o['scores'].float().cpu().numpy()
                l = o['labels'].cpu().numpy()
                # an inneren Kachelkanten abgeschnittene Boxen markieren
                cut = np.zeros(len(b), bool)
                if ox > 0:
                    cut |= b[:, 0] <= BORDER
                if oy > 0:
                    cut |= b[:, 1] <= BORDER
                if ox + tw < w:
                    cut |= b[:, 2] >= tw - BORDER
                if oy + th < h:
                    cut |= b[:, 3] >= th - BORDER
                keep = (s >= score_thr) & np.isin(l, self.classes)
                all_b.append(b[keep] + np.array([ox, oy, ox, oy]))
                all_s.append(s[keep])
                all_l.append(l[keep])
                all_c.append(cut[keep])
        if not sum(len(b) for b in all_b):
            return np.zeros((0, 4)), np.zeros(0), np.zeros(0, int)
        b, s, l, c = map(np.concatenate, (all_b, all_s, all_l, all_c))
        b, s, l = merge_tiles(b, s, l, c)
        if self.snap and len(b):
            from utils import refine_boxes_to_lines
            b = refine_boxes_to_lines(b, rgb, search=6, min_darkness='auto', select='nearest')
        return b, s, l

    def predict_bytes(self, image_bytes, score_thr=0.05):
        bgr = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        b, s, _ = self.predict_rgb(rgb, score_thr)
        return b, s
