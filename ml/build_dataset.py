"""
Baut den Trainings-/Testdatensatz für die Fenstererkennung – einheitlich in
150 DPI, also genau der Auflösung, die der Server beim Upload rendert und auf
der die KI in Produktion läuft.

Quellen:
  --legacy DIR   alter makesense-Datensatz (image/ + json_fenster/combined_*.json),
                 gerendert in 300 DPI → wird halbiert.
  --planli F...  .planli-Projekte aus dem Editor. Pro Seite zählen nur
                 Annotationen, deren Label-Name auf --window-regex passt
                 (Default "fenster"). Seiten ohne passende Annotation werden
                 übersprungen – eine Seite mit Fenster-Annotationen gilt als
                 VOLLSTÄNDIG beschriftet (jedes nicht markierte Fenster lernt
                 das Modell sonst als "kein Fenster").
                 Seiten OHNE Fenster (Schnitte, Situationen …) zählen als
                 Negativbeispiele, wenn ihr Seitenname (Doppelklick auf den
                 Seitentitel) "kein fenster" enthält.

Ausgabe (--out DIR):
  images/<id>.jpg
  dataset.json  [{id, file, project, width, height, boxes:[[x1,y1,x2,y2]], labels:[1|2]}]

Labels: 1 = Fenster, 2 = Tür (nur behalten, damit sich später entscheiden lässt,
ob Türen eigene Klasse, Fenster oder Hintergrund sind).

Der Split (train/test) wird NICHT hier festgelegt, sondern in splits.json pro
*Projekt* – Seiten desselben Plansatzes sehen sich zum Verwechseln ähnlich und
dürfen nie gleichzeitig in Training und Test liegen.
"""
import argparse
import glob
import hashlib
import io
import json
import os
import re
import zipfile

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

TARGET_DPI = 150
LEGACY_DPI = 300
JPEG_QUALITY = 90


# Altdaten-"Türen", die nach der Regel vom 12.10.2026 (Fenster-/Balkontüren =
# Fenster) als Fenster zählen: (Bildname, Index der Annotation im Altdaten-JSON).
LEGACY_DOOR_AS_WINDOW = {
    ('02_Orangerie_Bauprojekt_page8.jpg', 5),   # Balkontür OG hinter Geländer
}


def _id(*parts):
    return hashlib.sha1('|'.join(parts).encode()).hexdigest()[:12]


def _project_of_legacy(name):
    # "01_Gemeindehaus_Bauprojekt_page14.jpg" → "01_Gemeindehaus_Bauprojekt"
    return re.sub(r'_page\d+(\.jpg)?$', '', name).strip()


def add_legacy(root, out_dir, entries):
    jsons = sorted(glob.glob(os.path.join(root, 'json_fenster', 'combined_labels_*.json')))
    if not jsons:
        raise SystemExit(f'Kein combined_labels_*.json in {root}/json_fenster')
    data = json.load(open(jsons[-1]))
    print(f'Legacy: {jsons[-1]} ({len(data)} Bilder)')
    f = TARGET_DPI / LEGACY_DPI
    for e in data:
        name = e['image']
        path = os.path.join(root, 'image', name)
        if not os.path.exists(path) and os.path.exists(path + '.jpg'):
            path += '.jpg'
        if not os.path.exists(path):
            print(f'  fehlt: {name}')
            continue
        img = Image.open(path).convert('RGB')
        w, h = img.size
        img = img.resize((round(w * f), round(h * f)), Image.LANCZOS)
        boxes, labels = [], []
        for k, a in enumerate(e['annotations']):
            if a['category_id'] not in (1, 2):
                continue
            c = 1 if (name, k) in LEGACY_DOOR_AS_WINDOW else a['category_id']
            boxes.append([round(v * f, 1) for v in a['bbox']])
            labels.append(c)
        iid = _id('legacy', name)
        img.save(os.path.join(out_dir, 'images', iid + '.jpg'), quality=JPEG_QUALITY)
        entries.append(dict(id=iid, file=f'images/{iid}.jpg', source=f'legacy:{name}',
                            project=_project_of_legacy(name), width=img.width,
                            height=img.height, boxes=boxes, labels=labels))


def _rect_box(a):
    if a.get('angle', 0) % 360:
        return None
    sw = a.get('strokeWidth', 0) or 0
    sx, sy = a.get('scaleX', 1), a.get('scaleY', 1)
    # left/top = Aussenkante inkl. halbem Strich (siehe CLAUDE.md "Strichbreite
    # und Geometrie"); die sichtbare Kante (Strichmitte) liegt sw/2 weiter innen.
    x1 = a['left'] + sw / 2
    y1 = a['top'] + sw / 2
    return [x1, y1, x1 + a['width'] * sx, y1 + a['height'] * sy]


def _poly_box(a):
    if a.get('angle', 0) % 360 or not a.get('points'):
        return None
    xs = [p['x'] for p in a['points']]
    ys = [p['y'] for p in a['points']]
    sw = a.get('strokeWidth', 0) or 0
    sx, sy = a.get('scaleX', 1), a.get('scaleY', 1)
    # Mittelpunkt des Objekts; Punkte liegen relativ zu pathOffset (= bbox-Mitte)
    cx = a['left'] + (a['width'] * sx + sw) / 2
    cy = a['top'] + (a['height'] * sy + sw) / 2
    po = a.get('pathOffset') or {'x': (min(xs) + max(xs)) / 2, 'y': (min(ys) + max(ys)) / 2}
    X = [cx + (x - po['x']) * sx for x in xs]
    Y = [cy + (y - po['y']) * sy for y in ys]
    return [min(X), min(Y), max(X), max(Y)]


def add_planli(path, out_dir, entries, window_re, door_re, split_by_pdf=False):
    z = zipfile.ZipFile(path)
    cd = json.loads(z.read('canvas_data.json'))
    md = json.loads(z.read('metadata.json')) if 'metadata.json' in z.namelist() else {}
    labels = json.loads(z.read('labels.json')) if 'labels.json' in z.namelist() else []
    names = {l['id']: l['name'] for l in labels}
    project = md.get('project_name') or os.path.basename(path)
    manifest = cd.get('page_manifest') or []
    order = [str(m['id']) for m in manifest] or list(cd['pages'])
    page_names = {str(m['id']): (m.get('name') or '') for m in manifest}
    # Sammel-Projekte (--split-by-pdf): jede angehängte Quell-PDF gilt als eigener
    # Plansatz. Bewusst nicht der Default – meist sind mehrere PDFs in einer Datei
    # die einzeln exportierten Ansichten *desselben* Gebäudes, und die dürfen nie
    # auf Train und Test verteilt werden.
    page_src = {str(m['id']): m.get('sourcePdfIndex', 1) for m in manifest}
    multi_src = split_by_pdf and len(set(page_src.values())) > 1
    n_pages = 0
    for pos, pid in enumerate(order, start=1):
        page = cd['pages'].get(pid)
        if not page:
            continue
        boxes, cls = [], []
        skipped = 0
        for a in page.get('canvas_annotations', []):
            name = names.get(a.get('labelId'), '')
            if window_re.search(name):
                c = 1
            elif door_re and door_re.search(name):
                c = 2
            else:
                continue
            t = (a.get('type') or '').lower()
            b = _rect_box(a) if t == 'rect' else _poly_box(a) if t in ('polygon',) else None
            if b is None:
                skipped += 1
                continue
            boxes.append([round(v, 1) for v in b])
            cls.append(c)
        negative = re.search(r'kein(e)?\s*fenster', page_names.get(pid, ''), re.I)
        if negative and cls:
            print(f'  {project} Seite {pos}: als "kein Fenster" benannt, hat aber {len(cls)} Fenster/Türen – übersprungen')
            continue
        if not negative and not any(c == 1 for c in cls):
            continue
        img_name = f'pages/page_{pos}.jpg'
        if img_name not in z.namelist():
            print(f'  {project} Seite {pos}: {img_name} fehlt im ZIP')
            continue
        img = Image.open(io.BytesIO(z.read(img_name))).convert('RGB')
        iw, ih = page.get('image_width'), page.get('image_height')
        if iw and (iw, ih) != img.size:
            print(f'  {project} Seite {pos}: Bildgrösse {img.size} != Canvas {iw}x{ih} – übersprungen')
            continue
        iid = _id('planli', project, pid, img_name)
        img.save(os.path.join(out_dir, 'images', iid + '.jpg'), quality=JPEG_QUALITY)
        entries.append(dict(id=iid, file=f'images/{iid}.jpg', source=f'planli:{os.path.basename(path)}#{pid}',
                            project=f'{project} #PDF{page_src.get(pid, 1)}' if multi_src else project,
                            width=img.width, height=img.height,
                            boxes=boxes, labels=cls))
        n_pages += 1
        if skipped:
            print(f'  {project} Seite {pos}: {skipped} gedrehte/unbekannte Formen ignoriert')
    print(f'Planli: {os.path.basename(path)} „{project}“ → {n_pages} Seiten')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--legacy')
    ap.add_argument('--planli', nargs='*', default=[])
    ap.add_argument('--window-regex', default=r'fenster')
    ap.add_argument('--door-regex', default=r't[üu]r')
    ap.add_argument('--split-by-pdf', action='store_true',
                    help='Sammeldateien: jede angehängte PDF als eigenes Projekt')
    args = ap.parse_args()

    os.makedirs(os.path.join(args.out, 'images'), exist_ok=True)
    entries = []
    if args.legacy:
        add_legacy(args.legacy, args.out, entries)
    wre = re.compile(args.window_regex, re.I)
    dre = re.compile(args.door_regex, re.I) if args.door_regex else None
    for p in args.planli:
        add_planli(p, args.out, entries, wre, dre, args.split_by_pdf)

    json.dump(entries, open(os.path.join(args.out, 'dataset.json'), 'w'), indent=1, ensure_ascii=False)
    nw = sum(l == 1 for e in entries for l in e['labels'])
    nd = sum(l == 2 for e in entries for l in e['labels'])
    projects = sorted({e['project'] for e in entries})
    print(f'\n{len(entries)} Seiten, {nw} Fenster, {nd} Türen, {len(projects)} Projekte')
    for p in projects:
        es = [e for e in entries if e['project'] == p]
        print(f'  {p}: {len(es)} Seiten, {sum(l == 1 for e in es for l in e["labels"])} Fenster')


if __name__ == '__main__':
    main()
