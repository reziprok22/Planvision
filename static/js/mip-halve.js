/**
 * Rechenkern der Mipmap-Kette — von mipmaps.js (synchroner Notfall-Pfad) und
 * mip-worker.js (Normalfall) gemeinsam benutzt, darf deshalb nichts vom DOM
 * oder von anderen Modulen anfassen.
 */

// Stufen bis min. Seitenlänge ~256px; kleinere Pläne bekommen gar keine Mipmap.
export const MIP_MIN_SIDE = 256;

// Mip-Downsample-Mischung: 0 = reines Mitteln (blass), 1 = reiner Darkest-Pixel
// (sehr schwarz/kräftig). Dazwischen bleiben dünne Linien dunkler als der
// Durchschnitt, ohne hart/überkräftig zu wirken. 0.3 per Sichtvergleich in
// Chrome + Firefox kalibriert (satt genug, ohne überschwarz zu wirken).
export const MIP_DARKEN_STRENGTH = 0.3;

/**
 * Halbiert ein RGBA-Pixelfeld mit einer Mischung aus Mittelwert und dunkelstem
 * Pixel (Min-Filter). Pro 2×2-Block: Durchschnittsfarbe UND die Farbe des
 * dunkelsten Pixels (nach Luminanz) berechnen, dann linear mischen —
 * out = avg + strength·(dark − avg). strength=0 ⇒ reines Mitteln (blass, wie
 * drawImage), strength=1 ⇒ reiner Darkest-Pixel (sehr kräftig). Dazwischen
 * bleiben dünne dunkle Linien beim Rauszoomen kräftiger als der Durchschnitt,
 * ohne hart/überschwarz zu wirken. Uint8ClampedArray rundet/klemmt automatisch.
 */
export function halveDarkest(src, sw, sh, strength) {
  const nw = Math.max(1, sw >> 1), nh = Math.max(1, sh >> 1);
  const dst = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const sy0 = 2 * y, sy1 = Math.min(sy0 + 1, sh - 1);
    for (let x = 0; x < nw; x++) {
      const sx0 = 2 * x, sx1 = Math.min(sx0 + 1, sw - 1);
      const i0 = (sy0 * sw + sx0) * 4, i1 = (sy0 * sw + sx1) * 4;
      const i2 = (sy1 * sw + sx0) * 4, i3 = (sy1 * sw + sx1) * 4;
      // Luminanz (Rec. 601) – kleinster Wert = dunkelster Pixel gewinnt.
      let bi = i0, bl = src[i0] * 0.299 + src[i0 + 1] * 0.587 + src[i0 + 2] * 0.114, l;
      if ((l = src[i1] * 0.299 + src[i1 + 1] * 0.587 + src[i1 + 2] * 0.114) < bl) { bl = l; bi = i1; }
      if ((l = src[i2] * 0.299 + src[i2 + 1] * 0.587 + src[i2 + 2] * 0.114) < bl) { bl = l; bi = i2; }
      if ((l = src[i3] * 0.299 + src[i3 + 1] * 0.587 + src[i3 + 2] * 0.114) < bl) { bl = l; bi = i3; }
      const di = (y * nw + x) * 4;
      // Pro Kanal: Durchschnitt + strength·(dunkelster − Durchschnitt).
      const aR = (src[i0]     + src[i1]     + src[i2]     + src[i3]) * 0.25;
      const aG = (src[i0 + 1] + src[i1 + 1] + src[i2 + 1] + src[i3 + 1]) * 0.25;
      const aB = (src[i0 + 2] + src[i1 + 2] + src[i2 + 2] + src[i3 + 2]) * 0.25;
      const aA = (src[i0 + 3] + src[i1 + 3] + src[i2 + 3] + src[i3 + 3]) * 0.25;
      dst[di]     = aR + strength * (src[bi]     - aR);
      dst[di + 1] = aG + strength * (src[bi + 1] - aG);
      dst[di + 2] = aB + strength * (src[bi + 2] - aB);
      dst[di + 3] = aA + strength * (src[bi + 3] - aA);
    }
  }
  return { data: dst, w: nw, h: nh };
}
