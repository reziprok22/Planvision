"""
Trainiert den Fensterdetektor auf Kacheln in voller 150-DPI-Auflösung.

  python ml/train.py DATASET_DIR --out fasterrcnn_model/fenster_tiled.pth [--iters 8000]

Unterschiede zum alten train_model.py (die die Ungenauigkeit erklären):
  - kein Herunterskalieren der Seite (früher 800 px längste Seite ≈ Faktor 6–12),
    stattdessen zufällige 1024er-Kacheln mit leichter Skalierungs-Augmentierung
  - Training auf 150 DPI = Produktionsauflösung (früher 300 DPI)
  - genug Iterationen mit Warmup + Cosine (früher fiel die LR nach 3 Epochen à
    ~12 Batches auf 1/10, nach 6 auf 1/100 – effektiv ~40 Lernschritte)
  - Validierung auf zurückgehaltenen *Projekten*, bestes Modell nach AP50:95
"""
import argparse
import json
import math
import os
import random
import sys
import time

import cv2
import numpy as np
import torch
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from ml.tiled_inference import TILE, TiledDetector, build_model, to_input  # noqa: E402
from ml.evaluate import load_split, metrics  # noqa: E402

Image.MAX_IMAGE_PIXELS = None


class TileSampler:
    def __init__(self, ds_dir, entries, focus=0.75, scale=(0.75, 1.33), min_visible=0.35, neg_share=0.15):
        self.pages = []
        for e in entries:
            rgb = np.asarray(Image.open(os.path.join(ds_dir, e['file'])).convert('RGB'))
            self.pages.append((to_input(rgb)[:, :, 0],  # 1 Kanal reicht im RAM
                               np.asarray(e['boxes'], np.float32).reshape(-1, 4),
                               np.asarray(e['labels'], np.int64)))
        self.focus, self.scale, self.min_visible = focus, scale, min_visible
        # Seiten-Gewicht ~ Wurzel der Fensterzahl: eine Fassade mit 187 Fenstern soll
        # nicht ein Fünftel des Trainings ausmachen – Vielfalt der Plansätze zählt mehr.
        # Negativseiten ("kein Fenster") bekommen zusammen einen festen Anteil.
        n = np.array([len(b) for _, b, _ in self.pages], float)
        pos = np.sqrt(n) * (n > 0)
        neg = (n == 0).astype(float)
        self.p = pos / pos.sum() * (1 - neg_share if neg.any() else 1)
        if neg.any():
            self.p += neg / neg.sum() * neg_share

    def sample(self):
        gray, boxes, labels = self.pages[np.random.choice(len(self.pages), p=self.p)]
        h, w = gray.shape
        s = math.exp(random.uniform(*map(math.log, self.scale)))
        win = int(round(TILE / s))           # Ausschnitt in Seitenpixeln
        if len(boxes) and random.random() < self.focus:
            bx = boxes[random.randrange(len(boxes))]
            cx = random.uniform(bx[2] - win + 8, bx[0] - 8) if bx[2] - bx[0] < win - 16 else bx[0]
            cy = random.uniform(bx[3] - win + 8, bx[1] - 8) if bx[3] - bx[1] < win - 16 else bx[1]
            x0, y0 = int(cx), int(cy)
        else:
            x0, y0 = random.randint(0, max(w - win, 0)), random.randint(0, max(h - win, 0))
        x0 = min(max(x0, 0), max(w - win, 0))
        y0 = min(max(y0, 0), max(h - win, 0))
        crop = np.full((win, win), 255, np.uint8)
        part = gray[y0:y0 + win, x0:x0 + win]
        crop[:part.shape[0], :part.shape[1]] = part
        crop = cv2.resize(crop, (TILE, TILE), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)

        b = (boxes - [x0, y0, x0, y0]) * s
        clipped = np.clip(b, 0, [part.shape[1] * s, part.shape[0] * s] * 2)
        area = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
        vis = (clipped[:, 2] - clipped[:, 0]).clip(0) * (clipped[:, 3] - clipped[:, 1]).clip(0)
        keep = vis >= self.min_visible * np.maximum(area, 1)
        b, lab = clipped[keep], labels[keep]
        # Fast vollständig sichtbare, aber dennoch knapp angeschnittene Boxen sind
        # unvermeidlich – die Kachel-Inferenz rechnet damit (siehe merge_tiles).

        # Augmentierung
        if random.random() < 0.5:
            crop = crop[:, ::-1].copy()
            b = np.stack([TILE - b[:, 2], b[:, 1], TILE - b[:, 0], b[:, 3]], 1) if len(b) else b
        img = crop.astype(np.float32)
        if random.random() < 0.8:  # Kontrast / Helligkeit (blasse vs. satte Pläne)
            a = random.uniform(0.6, 1.3)
            img = 255 - (255 - img) * a
            img += random.uniform(-15, 10)
        if random.random() < 0.2:
            img = cv2.GaussianBlur(img, (3, 3), random.uniform(0.3, 0.9))
        img = np.clip(img, 0, 255).astype(np.uint8)
        if random.random() < 0.4:  # JPEG-Artefakte wie in Produktion (Q70)
            ok, enc = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, random.randint(55, 90)])
            img = cv2.imdecode(enc, cv2.IMREAD_GRAYSCALE)
        t = torch.from_numpy(img).float().div(255)[None].expand(3, -1, -1).contiguous()
        target = {'boxes': torch.as_tensor(b, dtype=torch.float32).reshape(-1, 4),
                  'labels': torch.as_tensor(lab, dtype=torch.int64)}
        return t, target


def evaluate_model(model, ds_dir, entries, device):
    det = TiledDetector.__new__(TiledDetector)
    det.model, det.device, det.snap, det.classes = model, device, False, (1,)
    model.eval()
    records = []
    for e in entries:
        rgb = np.asarray(Image.open(os.path.join(ds_dir, e['file'])).convert('RGB'))
        b, s, _ = det.predict_rgb(rgb, score_thr=0.05)
        records.append(dict(boxes=b.tolist(), scores=s.tolist(),
                            gt=[x for x, l in zip(e['boxes'], e['labels']) if l == 1],
                            ignore=[x for x, l in zip(e['boxes'], e['labels']) if l != 1]))
    model.train()
    # reine Python-floats: numpy-Skalare im Checkpoint lehnt torch.load(weights_only=True) ab
    return {k: float(v) for k, v in metrics(records).items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dataset')
    ap.add_argument('--out', required=True)
    ap.add_argument('--iters', type=int, default=8000)
    ap.add_argument('--batch', type=int, default=4)
    ap.add_argument('--lr', type=float, default=0.01)
    ap.add_argument('--eval-every', type=int, default=1000)
    ap.add_argument('--train-split', default='train')
    ap.add_argument('--val-split', default='test')
    ap.add_argument('--seed', type=int, default=0)
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device('cuda')
    train_e = load_split(args.dataset, args.train_split)
    val_e = load_split(args.dataset, args.val_split) if args.val_split != 'none' else []
    print(f'Train: {len(train_e)} Seiten / {sum(l == 1 for e in train_e for l in e["labels"])} Fenster, '
          f'Val: {len(val_e)} Seiten / {sum(l == 1 for e in val_e for l in e["labels"])} Fenster', flush=True)
    sampler = TileSampler(args.dataset, train_e)

    model = build_model().to(device)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.SGD(params, lr=args.lr, momentum=0.9, weight_decay=1e-4)
    warm = min(500, args.iters // 10)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda i: min(1, (i + 1) / warm) *
                                              0.5 * (1 + math.cos(math.pi * min(i, args.iters) / args.iters)))
    scaler = torch.amp.GradScaler()
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    best, hist = -1, []
    t0, run = time.time(), 0.0
    model.train()
    for it in range(1, args.iters + 1):
        batch = [sampler.sample() for _ in range(args.batch)]
        imgs = [b[0].to(device, non_blocking=True) for b in batch]
        tgts = [{k: v.to(device) for k, v in b[1].items()} for b in batch]
        with torch.autocast('cuda'):
            loss = sum(model(imgs, tgts).values())
        opt.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(params, 10.0)
        scaler.step(opt)
        scaler.update()
        sched.step()
        run = 0.98 * run + 0.02 * loss.item() if it > 1 else loss.item()
        if it % 100 == 0:
            print(f'it {it:5d}  loss {run:.4f}  lr {opt.param_groups[0]["lr"]:.5f}  '
                  f'{(time.time() - t0) / it:.2f}s/it  mem {torch.cuda.max_memory_allocated() / 2**30:.1f}G', flush=True)
        if val_e and (it % args.eval_every == 0 or it == args.iters):
            m = evaluate_model(model, args.dataset, val_e, device)
            hist.append(dict(it=it, **m))
            print(f'  VAL it {it}: AP50 {m["AP50"]:.3f} AP75 {m["AP75"]:.3f} AP50:95 {m["AP50:95"]:.3f} '
                  f'P {m["P"]:.2f} R {m["R"]:.2f} Kante {m["edge_px_mean"]:.2f}px '
                  f'IoU≥.85 {m["IoU>=0.85"]:.2f} IoU≥.95 {m["IoU>=0.95"]:.2f}', flush=True)
            if m['AP50:95'] > best:
                best = m['AP50:95']
                torch.save({'model': model.state_dict(), 'it': it, 'val': m}, args.out)
                print(f'  → bestes Modell gespeichert ({args.out})', flush=True)
    if not val_e:
        torch.save({'model': model.state_dict(), 'it': args.iters}, args.out)
    json.dump(hist, open(args.out + '.history.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
