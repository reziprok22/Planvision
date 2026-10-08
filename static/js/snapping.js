/**
 * snapping.js - Einrasten an vorhandenen Ecken und Kanten
 *
 * Beim Zeichnen (Rechteck, Polygon, Linie, Bemassungs-Endpunkte) und beim
 * Ziehen von Eckpunkt-Griffen rastet der Cursor auf vorhandene Annotationen ein:
 *
 *  1. Ecke (Eckpunkt eines Polygons/einer Linie, Rechteck-Ecke) — gewinnt immer,
 *     wenn eine in Reichweite liegt.
 *  2. Kante — der nächste Punkt auf einem Segment.
 *
 * Reichweite in BILDSCHIRM-Pixeln (zoomunabhängig). Ein Marker zeigt, worauf
 * eingerastet wird (Quadrat = Ecke, Raute = Kante); er wird in after:render
 * gezeichnet und verändert kein Objekt — landet also nie in Undo/Speichern/Export.
 * Alt gedrückt halten = frei zeichnen; Shift (22.5°-Winkel) hat Vorrang und
 * schaltet das Einrasten ebenfalls ab, sonst widersprächen sich die beiden.
 */

import { util } from 'fabric';

const SNAP_TOLERANCE_PX = 8;
const MARKER_COLOR = '#e6007e';     // Magenta: kommt auf Plänen und als Label-Farbe kaum vor
const MARKER_PX = 5;                // halbe Kantenlänge des Markers
const MARKER_POP_MS = 110;          // Marker „springt“ beim Einrasten kurz auf

/** Geometrische Eckpunkte einer Annotation in Szenen-Koordinaten (ohne Strichbreite). */
function cornersOf(obj) {
  const m = obj.calcTransformMatrix();
  if (obj.type === 'rect') {
    const w = obj.width / 2, h = obj.height / 2;
    const pts = [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }]
      .map(p => util.transformPoint(p, m));
    return { pts, closed: true };
  }
  if (!Array.isArray(obj.points)) return null;
  const po = obj.pathOffset;
  const pts = obj.points.map(p => util.transformPoint({ x: p.x - po.x, y: p.y - po.y }, m));
  return { pts, closed: obj.annotationType !== 'line' };
}

function nearestOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * @param {Canvas} canvas
 * @param {{ isEnabled: () => boolean, exclude: () => any[] }} opts
 *   isEnabled – ob gerade ein Werkzeug aktiv ist, das einrasten soll
 *   exclude   – Objekte, die nicht als Ziel taugen (das gerade gezeichnete/bearbeitete)
 */
export function installSnapping(canvas, { isEnabled, exclude }) {
  let marker = null;          // { x, y, kind: 'vertex' | 'edge' } in Szenen-Koordinaten
  let markerSince = 0;

  function setMarker(next) {
    const same = marker && next && marker.kind === next.kind &&
      Math.abs(marker.x - next.x) < 1e-9 && Math.abs(marker.y - next.y) < 1e-9;
    if (same || (!marker && !next)) return;
    // Pop nur beim Wechsel des Ziels, nicht beim Gleiten entlang einer Kante
    if (!marker || !next || marker.kind !== next.kind || next.kind === 'vertex') {
      markerSince = performance.now();
    }
    marker = next;
    canvas.requestRenderAll();
  }

  function clear() { setMarker(null); }

  /**
   * Eingerasteter Punkt für p (Szenen-Koordinaten) oder p selbst.
   * e = das Maus-Event (Alt/Shift).
   */
  function snap(p, e) {
    if (!isEnabled() || e?.altKey || e?.shiftKey) { clear(); return p; }
    const tol = SNAP_TOLERANCE_PX / (canvas.getZoom() || 1);
    const skip = new Set(exclude().filter(Boolean));
    let bestVertex = null, bestVertexD = tol;
    let bestEdge = null, bestEdgeD = tol;

    for (const obj of canvas.getObjects()) {
      if (obj.objectType !== 'annotation' || !obj.visible || skip.has(obj)) continue;
      const shape = cornersOf(obj);
      if (!shape || shape.pts.length < 2) continue;
      const { pts, closed } = shape;
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(p.x - pts[i].x, p.y - pts[i].y);
        if (d <= bestVertexD) { bestVertexD = d; bestVertex = pts[i]; }
      }
      if (bestVertex) continue;   // Ecke gefunden → Kanten anderer Objekte sind egal
      const segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const q = nearestOnSegment(p, pts[i], pts[(i + 1) % n]);
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d <= bestEdgeD) { bestEdgeD = d; bestEdge = q; }
      }
    }

    const hit = bestVertex ? { ...bestVertex, kind: 'vertex' }
              : bestEdge   ? { ...bestEdge, kind: 'edge' }
              : null;
    setMarker(hit);
    return hit ? { x: hit.x, y: hit.y } : p;
  }

  canvas.on('after:render', ({ ctx }) => {
    if (ctx !== canvas.getContext() || !marker) return;
    if (!isEnabled()) { marker = null; return; }
    const vpt = canvas.viewportTransform;
    const x = marker.x * vpt[0] + vpt[4];
    const y = marker.y * vpt[3] + vpt[5];
    const t = Math.min(1, (performance.now() - markerSince) / MARKER_POP_MS);
    const s = MARKER_PX * (1 + 0.5 * (1 - t) * (1 - t));   // 1.5× → 1×, ausklingend

    ctx.save();                         // Bildschirm-px: Marker bleibt bei jedem Zoom gleich gross
    ctx.beginPath();
    if (marker.kind === 'vertex') {
      ctx.rect(x - s, y - s, 2 * s, 2 * s);
    } else {
      ctx.moveTo(x, y - s * 1.25); ctx.lineTo(x + s * 1.25, y);
      ctx.lineTo(x, y + s * 1.25); ctx.lineTo(x - s * 1.25, y);
      ctx.closePath();
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';   // Halo, damit er auf jedem Untergrund steht
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = MARKER_COLOR;
    ctx.stroke();
    ctx.restore();
    if (t < 1) canvas.requestRenderAll();
  });

  canvas.on('mouse:out', clear);

  const api = { snap, clear, isEnabled };
  current = api;
  if (!altListenerInstalled) {
    altListenerInstalled = true;
    document.addEventListener('keydown', onAltKey);
    document.addEventListener('keyup', onAltKey);
  }
  return api;
}

// Alt alleine öffnet in Firefox beim Loslassen die Menüleiste — während ein
// Zeichenwerkzeug aktiv ist, gehört die Taste dem Einrasten. Die Canvas wird pro
// Seite neu erzeugt, der Listener hängt deshalb nur einmal am Dokument und
// spricht die jeweils letzte Installation an.
let current = null;
let altListenerInstalled = false;
function onAltKey(e) {
  if (e.key !== 'Alt' || !current?.isEnabled()) return;
  e.preventDefault();
  if (e.type === 'keydown') current.clear();
}
