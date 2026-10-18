"""
Misst die Fenstererkennung auf einem Datensatz aus build_dataset.py.

  python ml/evaluate.py DATASET_DIR [--split test] [--predictor tiled|tiled-nosnap]
                        [--model PATH] [--viz OUT_DIR]

Kennzahlen (Fenster = Klasse 1; Türen im Ground Truth werden ignoriert, d.h. eine
Vorhersage auf einer Tür zählt weder als Treffer noch als Fehlalarm – das
Frontend macht ohnehin jede Erkennung zum gewählten Label):
  AP50 / AP75 / AP50:95  – COCO-artig, klassenagnostisch
  P / R / F1 @0.5        – bei Score ≥ 0.5 (Produktions-Schwelle), IoU ≥ 0.5
  Kante px               – mittlere |Abweichung| der 4 Kanten bei Treffern (150 DPI)
  IoU≥0.85 / IoU≥0.95    – Anteil der GT-Fenster, die so genau getroffen werden
                           (≈ "muss nicht nachkorrigiert werden")
"""
import argparse
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


def iou_matrix(a, b):
    a = np.asarray(a, float).reshape(-1, 4)
    b = np.asarray(b, float).reshape(-1, 4)
    if not len(a) or not len(b):
        return np.zeros((len(a), len(b)))
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    aa = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    ab = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / (aa[:, None] + ab[None, :] - inter + 1e-9)


def match(pred_boxes, scores, gt, ignore, thr):
    """Greedy nach Score. Rückgabe: tp-Flags pro Vorhersage (None = ignoriert), gt-Index je Vorhersage."""
    order = np.argsort(-np.asarray(scores))
    used = set()
    flags, gidx = [None] * len(pred_boxes), [-1] * len(pred_boxes)
    ious = iou_matrix(pred_boxes, gt)
    iou_ign = iou_matrix(pred_boxes, ignore)
    for i in order:
        best, bj = thr, -1
        for j in range(len(gt)):
            if j not in used and ious[i, j] >= best:
                best, bj = ious[i, j], j
        if bj >= 0:
            used.add(bj)
            flags[i], gidx[i] = True, bj
        elif len(ignore) and iou_ign[i].max() >= 0.5:
            flags[i] = None
        else:
            flags[i] = False
    return flags, gidx


def average_precision(records, n_gt, thr):
    allp = []
    for r in records:
        flags, _ = match(r['boxes'], r['scores'], r['gt'], r['ignore'], thr)
        allp += [(s, f) for s, f in zip(r['scores'], flags) if f is not None]
    if not n_gt:
        return float('nan')
    allp.sort(key=lambda t: -t[0])
    tp = np.cumsum([f for _, f in allp]) if allp else np.array([0])
    fp = np.cumsum([not f for _, f in allp]) if allp else np.array([0])
    rec = tp / n_gt
    prec = tp / np.maximum(tp + fp, 1e-9)
    # 101-Punkt-Interpolation wie COCO
    ap = 0
    for t in np.linspace(0, 1, 101):
        p = prec[rec >= t]
        ap += p.max() if len(p) else 0
    return ap / 101


def metrics(records, score_thr=0.5):
    n_gt = sum(len(r['gt']) for r in records)
    ap = {t: average_precision(records, n_gt, t) for t in np.arange(0.5, 0.96, 0.05).round(2)}
    tp = fp = 0
    edge_err, ious_hit = [], []
    hit85 = hit95 = 0
    for r in records:
        keep = [i for i, s in enumerate(r['scores']) if s >= score_thr]
        pb = [r['boxes'][i] for i in keep]
        ps = [r['scores'][i] for i in keep]
        flags, gidx = match(pb, ps, r['gt'], r['ignore'], 0.5)
        tp += sum(f is True for f in flags)
        fp += sum(f is False for f in flags)
        im = iou_matrix(pb, r['gt'])
        for i, (f, j) in enumerate(zip(flags, gidx)):
            if f:
                edge_err += list(np.abs(np.asarray(pb[i]) - np.asarray(r['gt'][j])))
                ious_hit.append(im[i, j])
                hit85 += im[i, j] >= 0.85
                hit95 += im[i, j] >= 0.95
    p = tp / max(tp + fp, 1)
    rc = tp / max(n_gt, 1)
    return {
        'n_gt': n_gt,
        'AP50': ap[0.5], 'AP75': ap[0.75], 'AP50:95': float(np.mean(list(ap.values()))),
        'P': p, 'R': rc, 'F1': 2 * p * rc / max(p + rc, 1e-9),
        'edge_px_mean': float(np.mean(edge_err)) if edge_err else float('nan'),
        'edge_px_median': float(np.median(edge_err)) if edge_err else float('nan'),
        'IoU>=0.85': hit85 / max(n_gt, 1), 'IoU>=0.95': hit95 / max(n_gt, 1),
    }


def make_predictor(kind, model_path=None):
    if kind in ('tiled', 'tiled-nosnap'):
        from ml.tiled_inference import TiledDetector
        det = TiledDetector(model_path, snap=kind == 'tiled')

        def predict(img):
            buf = io.BytesIO()
            img.save(buf, 'JPEG', quality=70)
            boxes, scores = det.predict_bytes(buf.getvalue(), score_thr=0.05)
            return [list(map(float, b)) for b in boxes], [float(s) for s in scores]
        return predict
    raise SystemExit(f'unbekannter Predictor {kind}')


def load_split(ds_dir, split):
    entries = json.load(open(os.path.join(ds_dir, 'dataset.json')))
    if split == 'all':
        return entries
    splits = json.load(open(os.path.join(ds_dir, 'splits.json')))
    projects = set(splits[split])
    return [e for e in entries if e['project'] in projects]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dataset')
    ap.add_argument('--split', default='test')
    ap.add_argument('--predictor', default='tiled')
    ap.add_argument('--model')
    ap.add_argument('--viz')
    ap.add_argument('--json-out')
    args = ap.parse_args()

    entries = load_split(args.dataset, args.split)
    predict = make_predictor(args.predictor, args.model)
    records = []
    for e in entries:
        img = Image.open(os.path.join(args.dataset, e['file'])).convert('RGB')
        boxes, scores = predict(img)
        gt = [b for b, l in zip(e['boxes'], e['labels']) if l == 1]
        ign = [b for b, l in zip(e['boxes'], e['labels']) if l != 1]
        records.append(dict(id=e['id'], boxes=boxes, scores=scores, gt=gt, ignore=ign))
        m = metrics([records[-1]])
        print(f"  {e['project'][:40]:40s} GT {m['n_gt']:3d}  R {m['R']:.2f}  P {m['P']:.2f}  Kante {m['edge_px_mean']:5.1f}px")
        if args.viz:
            os.makedirs(args.viz, exist_ok=True)
            d = ImageDraw.Draw(img)
            for b in gt:
                d.rectangle(b, outline=(0, 200, 0), width=2)
            for b, s in zip(boxes, scores):
                if s >= 0.5:
                    d.rectangle(b, outline=(255, 0, 0), width=1)
            img.save(os.path.join(args.viz, e['id'] + '.jpg'), quality=80)

    m = metrics(records)
    print(f"\n[{args.predictor}] {len(entries)} Seiten, {m['n_gt']} Fenster")
    for k, v in m.items():
        print(f'  {k:13s} {v:.3f}' if isinstance(v, float) else f'  {k:13s} {v}')
    if args.json_out:
        json.dump(m, open(args.json_out, 'w'), indent=1)


if __name__ == '__main__':
    main()
