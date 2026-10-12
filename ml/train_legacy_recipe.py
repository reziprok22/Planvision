"""
Fairer Vergleich: die alte Rezeptur aus train_model.py (ganze Seite auf 800 px,
OpenCV-Vorverarbeitung, fasterrcnn_resnet50_fpn, 15 Epochen, StepLR 3/0.1)
nur auf dem Train-Split neu trainiert. Das Produktionsmodell hat die Test-Projekte
im Training gesehen und ist deshalb auf dem Test-Split geschönt.

  python ml/train_legacy_recipe.py DATASET_DIR --out PATH
  python ml/evaluate.py DATASET_DIR --predictor prod-nosnap --model PATH
"""
import argparse
import io
import os
import sys

import torch
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from image_preprocessing import preprocess_image  # noqa: E402
from model_handler import get_model  # noqa: E402
from ml.evaluate import load_split  # noqa: E402

Image.MAX_IMAGE_PIXELS = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dataset')
    ap.add_argument('--out', required=True)
    ap.add_argument('--max-size', type=int, default=800)
    ap.add_argument('--epochs', type=int, default=15)
    args = ap.parse_args()
    torch.manual_seed(0)

    samples = []
    for e in load_split(args.dataset, 'train'):
        raw = open(os.path.join(args.dataset, e['file']), 'rb').read()
        img = preprocess_image(raw)
        s = min(args.max_size / max(img.size), 1.0)
        img = img.resize((int(img.width * s), int(img.height * s)), Image.BILINEAR)
        t = torch.from_numpy(__import__('numpy').asarray(img)).permute(2, 0, 1).float() / 255
        samples.append((t, {'boxes': torch.tensor(e['boxes'], dtype=torch.float32).reshape(-1, 4) * s,
                            'labels': torch.tensor(e['labels'], dtype=torch.int64)}))

    device = torch.device('cuda')
    model = get_model().to(device)
    opt = torch.optim.SGD(model.parameters(), lr=0.005, momentum=0.9, weight_decay=0.0005)
    sched = torch.optim.lr_scheduler.StepLR(opt, step_size=3, gamma=0.1)
    g = torch.Generator().manual_seed(0)
    for ep in range(args.epochs):
        model.train()
        order = torch.randperm(len(samples), generator=g).tolist()
        tot = 0
        for i in range(0, len(order), 2):
            batch = [samples[j] for j in order[i:i + 2]]
            loss = sum(model([b[0].to(device) for b in batch],
                             [{k: v.to(device) for k, v in b[1].items()} for b in batch]).values())
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += loss.item()
        sched.step()
        print(f'Epoche {ep}: {tot:.3f}', flush=True)
    torch.save(model.state_dict(), args.out)


if __name__ == '__main__':
    main()
