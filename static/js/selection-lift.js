/**
 * selection-lift.js - Ausgewählte Annotationen „schweben“ über den anderen
 *
 * Bei eng beieinander- oder übereinanderliegenden Annotationen war unklar, was
 * wirklich ausgewählt ist: Fabrics Auswahlrahmen ist ein Rechteck, und das
 * Objekt selbst kann unter seinen Nachbarn liegen. Deshalb bekommt jede
 * ausgewählte Annotation
 *
 *  1. einen weichen Schlagschatten um ihre Form (nur ausserhalb der Fläche,
 *     das Innere bleibt farbgleich), und
 *  2. ihren Umriss und ihr Text-Label noch einmal über alle anderen Objekte
 *     gezeichnet.
 *
 * Beim Auswählen hebt sie sich in LIFT_IN_MS an; während sie verschoben wird,
 * hebt sie sich höher (ein blosser Klick ändert nichts). Beim Skalieren oder
 * Drehen an einem Griff verschwindet der Schatten, damit genau ausgerichtet
 * werden kann. Gezeichnet in after:render —
 * kein Objekt wird verändert, nichts landet in Undo/Speichern/Export.
 */

import { cornersOf } from './snapping.js';

const LIFT_IN_MS = 140;             // Anheben beim Auswählen
const DRAG_EASE_MS = 90;            // Übergang Ruhe ↔ Ziehen
// Schatten in Bildschirm-px: [Ruhe, Ziehen]
const BLUR_PX = [12, 16];
const OFFSET_Y_PX = [3, 5];
const SHADOW_ALPHA = [0.6, 0.55];
const SHADOW_MAX_OBJECTS = 80;      // shadowBlur ist teuer — grosse Auswahlen nur mit Umriss
const SHIFT_PX = 10000;             // Form ausserhalb zeichnen, nur ihr Schatten fällt ins Bild

const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - (1 - t) ** 3;

function tracePath(ctx, { pts, closed }, dx = 0) {
  ctx.moveTo(pts[0].x + dx, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + dx, pts[i].y);
  if (closed) ctx.closePath();
}

/**
 * @param {Canvas} canvas
 * @param {{ isActive: () => boolean }} opts
 *   isActive – nur im Auswahl-Werkzeug ohne laufende Eckpunkt-/Bemassungs-Bearbeitung
 */
export function installSelectionLift(canvas, { isActive }) {
  const since = new Map();          // Annotation → Zeitpunkt der Auswahl
  let dragLevel = 0;                // 0 = Ruhe, 1 = gezogen
  let lastFrame = 0;

  canvas.on('after:render', ({ ctx }) => {
    if (ctx !== canvas.getContext()) return;
    const now = performance.now();
    const active = isActive()
      ? canvas.getActiveObjects().filter(o => o.objectType === 'annotation' && o.canvas === canvas)
      : [];

    const activeSet = new Set(active);
    for (const o of since.keys()) if (!activeSet.has(o)) since.delete(o);
    for (const o of active) if (!since.has(o)) since.set(o, now);
    if (active.length === 0) { dragLevel = 0; lastFrame = 0; return; }

    const dt = lastFrame ? Math.min(now - lastFrame, 100) : 16;
    lastFrame = now;
    // Erst höher, wenn sich wirklich etwas bewegt — ein blosser Klick (Maus
    // gedrückt, nicht gezogen) liess den Schatten sonst kurz aufspringen
    const tr = canvas._currentTransform;
    const moved = tr?.action === 'drag' && tr.original &&
      (tr.target.left !== tr.original.left || tr.target.top !== tr.original.top);
    const dragTarget = moved ? 1 : 0;
    dragLevel += (dragTarget - dragLevel) * Math.min(1, dt / DRAG_EASE_MS);
    if (Math.abs(dragTarget - dragLevel) < 0.01) dragLevel = dragTarget;
    let animating = dragLevel !== dragTarget;

    ctx.save();
    ctx.transform(...canvas.viewportTransform);
    const m = ctx.getTransform();
    const scale = Math.hypot(m.a, m.b) || 1;                  // Szene → Geräte-px
    const devicePx = scale / (canvas.getZoom() || 1);         // Bildschirm-px → Geräte-px
    // Skalieren/Drehen an einem Griff: kein Schatten, da wird genau ausgerichtet
    // (wie im Eckpunkt-Modus, wo die Hebung ganz aus ist)
    const handleTransform = tr && tr.action !== 'drag';
    const withShadow = active.length <= SHADOW_MAX_OBJECTS && !handleTransform;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const labels = [];

    for (const o of active) {
      const shape = cornersOf(o);
      if (!shape || shape.pts.length < 2) continue;
      const t = Math.min(1, (now - since.get(o)) / LIFT_IN_MS);
      if (t < 1) animating = true;
      const e = easeOutCubic(t);
      const strokeWidth = o.strokeWidth || 2;

      if (withShadow) {
        ctx.save();
        if (shape.closed) {
          // Schatten nur ausserhalb der Form: das Innere bleibt in seiner Farbe
          ctx.beginPath();
          ctx.rect(-1e7, -1e7, 2e7, 2e7);
          tracePath(ctx, shape);
          ctx.clip('evenodd');
        }
        ctx.shadowColor = `rgba(0, 0, 0, ${(lerp(SHADOW_ALPHA[0], SHADOW_ALPHA[1], dragLevel) * e).toFixed(3)})`;
        ctx.shadowBlur = lerp(BLUR_PX[0], BLUR_PX[1], dragLevel) * e * devicePx;
        ctx.shadowOffsetX = SHIFT_PX;
        ctx.shadowOffsetY = lerp(OFFSET_Y_PX[0], OFFSET_Y_PX[1], dragLevel) * e * devicePx;
        ctx.beginPath();
        tracePath(ctx, shape, -SHIFT_PX / scale);
        ctx.lineWidth = strokeWidth;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        if (shape.closed) { ctx.fillStyle = '#000'; ctx.fill(); }
        ctx.restore();
      }

      // Umriss über alle Nachbarn
      ctx.beginPath();
      tracePath(ctx, shape);
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = o.stroke || '#1976d2';
      ctx.stroke();
      if (o.id != null) labels.push(o.id);
    }

    // Text-Labels zuletzt, sonst verdeckt der Umriss das eigene Label
    if (labels.length) {
      const ids = new Set(labels);
      for (const tl of canvas.getObjects()) {
        if (tl.objectType === 'textLabel' && tl.visible !== false && ids.has(tl.linkedAnnotationId)) tl.render(ctx);
      }
    }
    ctx.restore();

    if (animating) canvas.requestRenderAll();
  });
}
