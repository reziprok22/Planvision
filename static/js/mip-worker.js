/**
 * Baut die Mipmap-Kette ausserhalb des Hauptthreads (siehe mipmaps.js).
 * Eingang: { id, url } — der Worker holt und dekodiert das Bild selbst (aus dem
 * HTTP-Cache bzw. der Blob-URL), damit auch das nicht den Hauptthread blockiert;
 * oder { id, bitmap } — das Original als ImageBitmap (Rückfall, übertragen).
 * Ausgang: { id, levels: [{ bitmap, w, h }, …] } ohne Stufe 0, oder { id, error }.
 */
import { halveDarkest, MIP_MIN_SIDE, MIP_DARKEN_STRENGTH } from './mip-halve.js';

self.onmessage = async ({ data: { id, url, bitmap } }) => {
  try {
    if (!bitmap) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bitmap = await createImageBitmap(await res.blob());
    }
    let sw = bitmap.width, sh = bitmap.height;
    const base = new OffscreenCanvas(sw, sh);
    const bctx = base.getContext('2d', { willReadFrequently: true });
    bctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    let src = bctx.getImageData(0, 0, sw, sh).data;

    const levels = [];
    while (Math.min(sw, sh) > MIP_MIN_SIDE) {
      const h = halveDarkest(src, sw, sh, MIP_DARKEN_STRENGTH);
      const c = new OffscreenCanvas(h.w, h.h);
      c.getContext('2d').putImageData(new ImageData(h.data, h.w, h.h), 0, 0);
      levels.push({ bitmap: c.transferToImageBitmap(), w: h.w, h: h.h });
      src = h.data; sw = h.w; sh = h.h;
    }
    self.postMessage({ id, levels }, levels.map(l => l.bitmap));
  } catch (e) {
    self.postMessage({ id, error: String(e) });
  }
};
