/**
 * Mipmap-Kette des Plan-Hintergrunds: Aufbau im Web Worker + Cache pro Bild-URL.
 *
 * Bis 22.10.2026 lief buildMipmaps synchron in initCanvas, bei JEDEM
 * Seitenwechsel — gemessen an einer A0-Seite (7084×5027) ~750 ms Blockade
 * (halveDarkest ~330, getImageData ~270, drawImage ~75 ms), auf langsameren
 * Rechnern 3–4 s. Jetzt zeigt initCanvas das Original sofort, die Stufen kommen
 * nach und werden pro URL gemerkt, ein erneuter Besuch kostet nichts mehr.
 *
 * Der Cache hängt an der Bild-URL, nicht an der Seiten-ID (wie die Vorschaubilder
 * in upload-modal.js): duplizierte Seiten teilen sich das Bild, und eine URL
 * zeigt in einer Sitzung immer auf dasselbe Render.
 */
import { halveDarkest, MIP_MIN_SIDE, MIP_DARKEN_STRENGTH } from './mip-halve.js';
import MipWorker from './mip-worker.js?worker&inline';

// Obergrenze für den Cache in Pixeln (RGBA ⇒ ×4 Byte). Die Stufen einer A0-Seite
// sind ~12 MP (≈ 47 MB) — 60 MP (≈ 240 MB) halten die letzten ~5 A0- bzw. ~40
// A3-Seiten. Mit 36 MP verfehlte schon ein 4-seitiger A0-Satz beim Durchklicken
// jedes Mal den Cache (LRU wirft genau die Seite raus, die als nächste kommt).
const CACHE_MAX_PX = 60e6;

const cache = new Map();    // url → { levels, px }  (Einfügereihenfolge = LRU)
const pending = new Map();  // url → Promise<levels|null>
let cachedPx = 0;
let generation = 0;         // clearMipmapCache() verwirft danach eintreffende Ergebnisse

let worker = null;
let workerBroken = false;
let nextJobId = 0;
const jobs = new Map();     // id → { resolve, reject }

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new MipWorker();
    worker.onmessage = ({ data }) => {
      const job = jobs.get(data.id);
      if (!job) return;
      jobs.delete(data.id);
      data.error ? job.reject(new Error(data.error)) : job.resolve(data.levels);
    };
    worker.onerror = (e) => {
      // Worker selbst kaputt (z.B. kein OffscreenCanvas) — offene Jobs abbrechen,
      // ab jetzt synchron.
      console.warn('Mipmap-Worker ausgefallen, rechne synchron:', e.message || e);
      workerBroken = true;
      worker.terminate();
      worker = null;
      for (const job of jobs.values()) job.reject(new Error('worker failed'));
      jobs.clear();
    };
  } catch (e) {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

/** ImageBitmap → Canvas, weil Fabrics setElement ein Bild-/Canvas-Element erwartet. */
function bitmapToCanvas(bitmap) {
  const c = document.createElement('canvas');
  c.width = bitmap.width; c.height = bitmap.height;
  const br = c.getContext('bitmaprenderer');
  if (br) {
    br.transferFromImageBitmap(bitmap);   // übernimmt das Bitmap ohne Kopie
  } else {
    c.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
  }
  return c;
}

function runJob(w, msg, transfer) {
  const id = ++nextJobId;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    w.postMessage({ id, ...msg }, transfer);
  });
}

async function buildInWorker(img, url) {
  const w = getWorker();
  if (!w) throw new Error('no worker');
  let levels;
  try {
    // Normalfall: Worker lädt + dekodiert selbst. createImageBitmap(img) im
    // Hauptthread kostete bei A0 nochmals ~120 ms Blockade.
    levels = await runJob(w, { url });
  } catch (e) {
    if (workerBroken) throw e;
    const bitmap = await createImageBitmap(img);
    levels = await runJob(w, { bitmap }, [bitmap]);
  }
  return levels.map(l => ({ el: bitmapToCanvas(l.bitmap), w: l.w, h: l.h }));
}

/**
 * Synchroner Notfall-Pfad (Browser ohne Worker/OffscreenCanvas) — blockiert wie
 * früher. Fällt bei getImageData-Fehler (CORS-taint oder Canvas-Grössenlimit)
 * auf "keine Mipmaps" zurück → dann greift der browser-native 'high'-Pfad.
 */
function buildSync(img) {
  let sw = img.naturalWidth, sh = img.naturalHeight;
  const base = document.createElement('canvas');
  base.width = sw; base.height = sh;
  const bctx = base.getContext('2d', { willReadFrequently: true });
  bctx.drawImage(img, 0, 0);
  let src;
  try {
    src = bctx.getImageData(0, 0, sw, sh).data;
  } catch (e) {
    console.warn('Mipmap-Aufbau übersprungen (getImageData fehlgeschlagen):', e);
    return [];
  }
  const levels = [];
  while (Math.min(sw, sh) > MIP_MIN_SIDE) {
    const h = halveDarkest(src, sw, sh, MIP_DARKEN_STRENGTH);
    const c = document.createElement('canvas');
    c.width = h.w; c.height = h.h;
    c.getContext('2d').putImageData(new ImageData(h.data, h.w, h.h), 0, 0);
    levels.push({ el: c, w: h.w, h: h.h });
    src = h.data; sw = h.w; sh = h.h;
  }
  return levels;
}

function store(url, levels) {
  const px = levels.reduce((s, l) => s + l.w * l.h, 0);
  if (px > CACHE_MAX_PX) return;          // einzelne Riesenseite: nicht cachen
  cache.set(url, { levels, px });
  cachedPx += px;
  for (const [key, entry] of cache) {
    if (cachedPx <= CACHE_MAX_PX) break;
    cache.delete(key);                    // älteste zuerst; Canvases sammelt der GC ein
    cachedPx -= entry.px;
  }
}

/**
 * Stufen 1…n für diese URL, falls schon gebaut (sonst null). Markiert den
 * Eintrag als zuletzt benutzt.
 */
export function getCachedMipmaps(url) {
  const entry = cache.get(url);
  if (!entry) return null;
  cache.delete(url);
  cache.set(url, entry);
  return entry.levels;
}

/**
 * Baut die Stufen 1…n für ein fertig geladenes Bild (im Worker, ohne Worker
 * synchron nach dem nächsten Frame). Laufende Anfragen für dieselbe URL werden
 * geteilt — initCanvas läuft pro Seite u.U. mehrmals. Liefert null, wenn
 * zwischendurch das Projekt gewechselt wurde.
 */
export function requestMipmaps(img, url) {
  const cached = getCachedMipmaps(url);
  if (cached) return Promise.resolve(cached);
  if (pending.has(url)) return pending.get(url);

  const gen = generation;
  const small = Math.min(img.naturalWidth, img.naturalHeight) <= MIP_MIN_SIDE;
  const p = (small ? Promise.resolve([]) : buildInWorker(img, url).catch(err => {
    if (!workerBroken) console.warn('Mipmap-Worker fehlgeschlagen, rechne synchron:', err);
    // Erst nach dem nächsten Frame: der Plan soll vorher schon zu sehen sein.
    // Bis dahin kann <img> schon die nächste Seite zeigen — dann nichts bauen.
    return new Promise(res => requestAnimationFrame(() => setTimeout(() =>
      res((img.currentSrc || img.src) === url ? buildSync(img) : null))));
  })).then(levels => {
    pending.delete(url);
    if (!levels || gen !== generation) return null;
    store(url, levels);
    return levels;
  });
  pending.set(url, p);
  return p;
}

/** Beim Projektwechsel/Reset: Speicher freigeben, laufende Ergebnisse verwerfen. */
export function clearMipmapCache() {
  generation++;
  cache.clear();
  pending.clear();
  cachedPx = 0;
}
