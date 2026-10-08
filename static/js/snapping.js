/**
 * snapping.js - Einrasten an vorhandenen Ecken und Kanten
 *
 * Beim Zeichnen (Rechteck, Polygon, Linie, Bemassungs-Endpunkte), beim Ziehen
 * von Eckpunkt-Griffen und beim Verschieben ganzer Annotationen (snapMove: die
 * Ecken des gezogenen Objekts gegen Ecken/Kanten der anderen und umgekehrt)
 * und beim Skalieren eines ungedrehten Rechtecks (snapScale: die bewegte Kante)
 * rastet es auf vorhandene Annotationen ein:
 *
 *  1. Ecke (Eckpunkt eines Polygons/einer Linie, Rechteck-Ecke) — gewinnt immer,
 *     wenn eine in Reichweite liegt.
 *  2. Kante — der nächste Punkt auf einem Segment.
 *  3. Ausrichtung (snap() beim Zeichnen/Griff-Ziehen, alignMove() beim Verschieben
 *     einzelner Objekte und Mehrfachauswahlen, alignSide in snapScale beim
 *     Rechteck-Skalieren): liegt keine Ecke
 *     oder Kante in Reichweite, rasten x und/oder y einzeln auf die Flucht einer
 *     Ecke in der Nähe ein (ALIGN_RANGE_PX entlang der anderen Achse), dazu eine
 *     gestrichelte Hilfslinie von dieser Ecke zum Cursor. Referenzen sind die
 *     Ecken anderer Annotationen plus alignPoints() — die eigenen, schon gesetzten
 *     Punkte (Polygon/Linie im Zeichnen, übrige Ecken beim Eckpunkt-Ziehen,
 *     erster Bemassungspunkt). So entsteht eine Fensterreihe auf gleicher Höhe
 *     oder ein rechtwinkliges Polygon ohne Shift.
 *
 * Reichweite in BILDSCHIRM-Pixeln (zoomunabhängig). Ein Marker zeigt, worauf
 * eingerastet wird (Quadrat = Ecke, Raute = Kante), und das Zielobjekt leuchtet
 * kurz auf und bleibt danach dezent markiert; beides wird in after:render
 * gezeichnet und verändert kein Objekt — landet also nie in Undo/Speichern/Export.
 * Alt gedrückt halten = frei zeichnen; Shift (22.5°-Winkel) hat Vorrang und
 * schaltet das Einrasten ebenfalls ab, sonst widersprächen sich die beiden.
 */

import { util } from 'fabric';

const SNAP_TOLERANCE_PX = 8;
// Ausrichtung: nur Ecken, die entlang der anderen Achse höchstens so weit
// (Bildschirm-px) vom Cursor entfernt sind — sonst rastet es auf dichten Plänen
// ständig an irgendeiner Ecke auf derselben Höhe ein.
const ALIGN_RANGE_PX = 600;
const MARKER_COLOR = '#e6007e';     // Magenta: kommt auf Plänen und als Label-Farbe kaum vor
const MARKER_PX = 5;                // halbe Kantenlänge des Markers
const MARKER_POP_MS = 110;          // Marker „springt“ beim Einrasten kurz auf
// Aufleuchten erst nach einer Verweilzeit: beim schnellen Ziehen über viele
// Objekte kommen ständig neue Ziele kurz in Reichweite — sofortiges Aufleuchten
// flackerte. Der Marker (wo wirklich eingerastet wird) bleibt sofort sichtbar.
const GLOW_DELAY_MS = 120;          // so lange muss dasselbe Ziel gehalten werden
const GLOW_IN_MS = 60;              // weiches Einblenden statt hartem Aufblitzen
const GLOW_MS = 260;                // dann von GLOW_PEAK auf GLOW_REST abklingen
const GLOW_OUT_MS = 150;            // Ziel verloren → ausblenden statt abschneiden
const GLOW_PEAK = 0.8, GLOW_REST = 0.3;
const GLOW_EXTRA_PX = 4;            // Leuchtbreite über die Strichbreite hinaus (Bildschirm-px)

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

/** Geometrische Achsen-Box (ohne Strichbreite) einer Annotation. */
function boxOf(obj) {
  return bboxOf(cornersOf(obj).pts, 0);
}

function segmentsOf({ pts, closed }) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
  if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  return segs;
}

function bboxOf(pts, pad) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
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
export function installSnapping(canvas, { isEnabled, exclude, alignPoints = () => [] }) {
  let marker = null;          // { x, y, kind: 'vertex' | 'edge', target } in Szenen-Koordinaten
  let markerSince = 0;
  let glow = null;            // { target, since }: aktuelles Ziel, gehalten seit
  let fade = null;            // { target, since, alpha }: verlorenes Ziel, blendet aus
  let glowTimer = null;

  function glowAlpha(now) {
    if (!glow) return 0;
    const e = now - glow.since - GLOW_DELAY_MS;
    if (e < 0) return 0;
    const g = Math.min(1, e / GLOW_MS);
    return Math.min(1, e / GLOW_IN_MS) * (GLOW_REST + (GLOW_PEAK - GLOW_REST) * (1 - g) * (1 - g));
  }

  function setGlowTarget(target, now) {
    if (target === glow?.target) return;
    const a = glowAlpha(now);
    if (a > 0) fade = { target: glow.target, since: now, alpha: a };
    glow = target ? { target, since: now } : null;
    clearTimeout(glowTimer);
    // Steht der Cursor still, kommt kein mouse:move mehr — selbst nachzeichnen
    if (glow) glowTimer = setTimeout(() => canvas.requestRenderAll(), GLOW_DELAY_MS + 5);
  }

  function setMarker(next) {
    const same = marker && next && marker.kind === next.kind && marker.target === next.target &&
      marker.guideKey === next.guideKey &&
      Math.abs(marker.x - next.x) < 1e-9 && Math.abs(marker.y - next.y) < 1e-9;
    if (same || (!marker && !next)) return;
    const now = performance.now();
    // Pop nur beim Wechsel des Ziels, nicht beim Gleiten entlang einer Kante
    if (!marker || !next || marker.kind !== next.kind || next.kind === 'vertex') markerSince = now;
    setGlowTarget(next?.target ?? null, now);
    marker = next;
    canvas.requestRenderAll();
  }

  function targets(extraSkip = []) {
    const skip = new Set([...exclude(), ...extraSkip].filter(Boolean));
    return canvas.getObjects().filter(o =>
      o.objectType === 'annotation' && o.visible && !skip.has(o));
  }

  function clear() { setMarker(null); }

  /**
   * Eingerasteter Punkt für p (Szenen-Koordinaten) oder p selbst.
   * e = das Maus-Event (Alt/Shift).
   */
  function snap(p, e) {
    if (!isEnabled() || e?.altKey || e?.shiftKey) { clear(); return p; }
    const tol = SNAP_TOLERANCE_PX / (canvas.getZoom() || 1);
    let bestVertex = null, bestVertexD = tol, vertexObj = null;
    let bestEdge = null, bestEdgeD = tol, edgeObj = null;

    for (const obj of targets()) {
      const shape = cornersOf(obj);
      if (!shape || shape.pts.length < 2) continue;
      const { pts, closed } = shape;
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(p.x - pts[i].x, p.y - pts[i].y);
        if (d <= bestVertexD) { bestVertexD = d; bestVertex = pts[i]; vertexObj = obj; }
      }
      if (bestVertex) continue;   // Ecke gefunden → Kanten anderer Objekte sind egal
      const segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const q = nearestOnSegment(p, pts[i], pts[(i + 1) % n]);
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d <= bestEdgeD) { bestEdgeD = d; bestEdge = q; edgeObj = obj; }
      }
    }

    const hit = bestVertex ? { x: bestVertex.x, y: bestVertex.y, kind: 'vertex', target: vertexObj }
              : bestEdge   ? { x: bestEdge.x, y: bestEdge.y, kind: 'edge', target: edgeObj }
              : align(p, tol);
    setMarker(hit);
    return hit ? { x: hit.x, y: hit.y } : p;
  }

  /** Ausrichtung an der Flucht von Ecken in der Nähe (siehe Kopfkommentar, 3.). */
  function align(p, tol) {
    const range = ALIGN_RANGE_PX / (canvas.getZoom() || 1);
    const refs = [];
    for (const obj of targets()) {
      const shape = cornersOf(obj);
      if (shape) refs.push(...shape.pts);
    }
    refs.push(...alignPoints().filter(Boolean));

    // pro Achse: kleinste Abweichung gewinnt; die Hilfslinie geht zur nächsten
    // Ecke auf genau dieser Flucht
    const pick = (ax, oa) => {
      let best = null;
      for (const v of refs) {
        const d = Math.abs(v[ax] - p[ax]);
        const far = Math.abs(v[oa] - p[oa]);
        if (d > tol || far > range || far < 1e-9) continue;
        if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && far < best.far)) {
          best = { d, far, ref: v };
        }
      }
      return best;
    };
    const ax = pick('x', 'y'), ay = pick('y', 'x');
    if (!ax && !ay) return null;
    const x = ax ? ax.ref.x : p.x;
    const y = ay ? ay.ref.y : p.y;
    const guides = [];
    if (ax) guides.push({ x1: ax.ref.x, y1: ax.ref.y, x2: x, y2: y });
    if (ay) guides.push({ x1: ay.ref.x, y1: ay.ref.y, x2: x, y2: y });
    const guideKey = guides.map(g => `${g.x1},${g.y1}`).join('|');
    return { x, y, kind: 'align', target: null, guides, guideKey };
  }

  /**
   * Gezogene Annotation an andere andocken: Ecke auf Ecke gewinnt, sonst Ecke auf
   * Kante — in beide Richtungen (eigene Ecke auf fremde Kante, fremde Ecke auf
   * eigene Kante, damit auch zwei Rechtecke versetzt Kante an Kante docken).
   * Verschiebt obj direkt; Fabric rechnet die Position bei jedem mouse:move neu
   * aus dem Pointer, das Einrasten summiert sich also nicht auf.
   * obj darf auch eine Mehrfachauswahl sein: dann zählen die Ecken/Kanten aller
   * Annotationen darin (calcTransformMatrix rechnet die Gruppe mit ein), sie
   * selbst sind keine Ziele, und verschoben wird die Auswahl als Ganzes. Es
   * rastet trotzdem nur EIN Kontaktpunkt ein — der nächste.
   */
  function snapMove(obj, e) {
    if (!isEnabled() || e?.altKey || e?.shiftKey) { clear(); return; }
    const members = typeof obj.getObjects === 'function'
      ? obj.getObjects().filter(o => o.objectType === 'annotation')
      : [obj];
    const shapes = members.map(cornersOf).filter(sh => sh && sh.pts.length > 1);
    if (!shapes.length) { clear(); return; }
    const tol = SNAP_TOLERANCE_PX / (canvas.getZoom() || 1);
    const ownPts = shapes.flatMap(sh => sh.pts);
    const ownSegs = shapes.flatMap(segmentsOf);
    const ob = bboxOf(ownPts, tol);
    let best = null;   // { tier, d, dx, dy, x, y, kind, target }
    const consider = (tier, d, dx, dy, x, y, kind, target) => {
      if (d > tol) return;
      if (!best || tier < best.tier || (tier === best.tier && d < best.d)) {
        best = { tier, d, dx, dy, x, y, kind, target };
      }
    };

    for (const target of targets(members)) {
      const shape = cornersOf(target);
      if (!shape || shape.pts.length < 2) continue;
      const tb = bboxOf(shape.pts, 0);
      if (tb.maxX < ob.minX || tb.minX > ob.maxX || tb.maxY < ob.minY || tb.minY > ob.maxY) continue;
      const tSegs = segmentsOf(shape);
      // Nur eigene Ecken/Kanten in Reichweite dieses Ziels prüfen — bei grossen
      // Auswahlen spannt die Gesamt-Box fast den ganzen Plan auf.
      const tbt = bboxOf(shape.pts, tol);
      const nearPts = ownPts.filter(v => v.x >= tbt.minX && v.x <= tbt.maxX && v.y >= tbt.minY && v.y <= tbt.maxY);
      const nearSegs = ownSegs.filter(([a, b]) =>
        Math.max(a.x, b.x) >= tbt.minX && Math.min(a.x, b.x) <= tbt.maxX &&
        Math.max(a.y, b.y) >= tbt.minY && Math.min(a.y, b.y) <= tbt.maxY);
      for (const v of nearPts) {
        for (const tv of shape.pts) {
          consider(0, Math.hypot(tv.x - v.x, tv.y - v.y), tv.x - v.x, tv.y - v.y, tv.x, tv.y, 'vertex', target);
        }
        for (const [a, b] of tSegs) {
          const q = nearestOnSegment(v, a, b);
          consider(1, Math.hypot(q.x - v.x, q.y - v.y), q.x - v.x, q.y - v.y, q.x, q.y, 'edge', target);
        }
      }
      for (const tv of shape.pts) {
        for (const [a, b] of nearSegs) {
          const q = nearestOnSegment(tv, a, b);
          consider(1, Math.hypot(tv.x - q.x, tv.y - q.y), tv.x - q.x, tv.y - q.y, tv.x, tv.y, 'edge', target);
        }
      }
    }

    if (!best) {
      // Kein Kontakt → an der Flucht von Nachbar-Ecken ausrichten (Hilfslinien)
      const al = alignMove(ownPts, members, tol);
      if (al) {
        obj.set({ left: obj.left + al.dx, top: obj.top + al.dy });
        obj.setCoords();
      }
      setMarker(al && al.marker);
      return;
    }
    if (best.dx || best.dy) {
      obj.set({ left: obj.left + best.dx, top: obj.top + best.dy });
      obj.setCoords();
    }
    setMarker({ x: best.x, y: best.y, kind: best.kind, target: best.target });
  }

  /**
   * Ausrichtung beim Verschieben: x und y einzeln — pro Achse das Paar (eigene
   * Ecke, fremde Ecke) mit der kleinsten Abweichung, sofern die fremde Ecke
   * entlang der anderen Achse höchstens ALIGN_RANGE_PX entfernt ist. Bei Ctrl-
   * Duplizieren ist die frisch abgelegte Kopie eine Referenz: das Duplikat bleibt
   * beim Seitwärtsziehen auf ihrer Höhe.
   */
  function alignMove(ownPts, members, tol) {
    const range = ALIGN_RANGE_PX / (canvas.getZoom() || 1);
    const refs = [];
    for (const t of targets(members)) {
      const shape = cornersOf(t);
      if (shape) refs.push(...shape.pts);
    }
    if (!refs.length) return null;
    const pick = (ax, oa) => {
      let best = null;
      for (const v of ownPts) {
        for (const r of refs) {
          const d = Math.abs(r[ax] - v[ax]);
          if (d > tol) continue;
          const far = Math.abs(r[oa] - v[oa]);
          if (far > range) continue;
          if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && far < best.far)) {
            best = { d, far, own: v, ref: r, delta: r[ax] - v[ax] };
          }
        }
      }
      return best;
    };
    const ax = pick('x', 'y'), ay = pick('y', 'x');
    if (!ax && !ay) return null;
    const dx = ax ? ax.delta : 0, dy = ay ? ay.delta : 0;
    // Linien von der Referenz-Ecke zur eigenen Ecke — in deren neuer Lage
    const guides = [];
    if (ax) guides.push({ x1: ax.ref.x, y1: ax.ref.y, x2: ax.ref.x, y2: ax.own.y + dy });
    if (ay) guides.push({ x1: ay.ref.x, y1: ay.ref.y, x2: ay.own.x + dx, y2: ay.ref.y });
    const guideKey = guides.map(g => `${g.x1},${g.y1},${g.x2},${g.y2}`).join('|');
    const end = guides[guides.length - 1];
    return { dx, dy, marker: { x: end.x2, y: end.y2, kind: 'align', target: null, guides, guideKey } };
  }

  // Umriss eines Zielobjekts leuchten lassen (Szenen-Koordinaten, wie der Hover-Schimmer)
  function strokeGlow(ctx, target, alpha) {
    const shape = alpha > 0.005 && target?.canvas === canvas && cornersOf(target);
    if (!shape || shape.pts.length < 2) return;
    const zoom = canvas.getZoom() || 1;
    ctx.save();
    ctx.transform(...canvas.viewportTransform);
    ctx.beginPath();
    ctx.moveTo(shape.pts[0].x, shape.pts[0].y);
    for (let i = 1; i < shape.pts.length; i++) ctx.lineTo(shape.pts[i].x, shape.pts[i].y);
    if (shape.closed) ctx.closePath();
    ctx.lineWidth = (target.strokeWidth || 2) + GLOW_EXTRA_PX / zoom;
    ctx.strokeStyle = `rgba(230, 0, 126, ${alpha.toFixed(3)})`;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  canvas.on('after:render', ({ ctx }) => {
    if (ctx !== canvas.getContext()) return;
    const now = performance.now();
    let animating = false;

    // Ausblenden läuft auch nach dem Loslassen weiter (dann ist isEnabled() false)
    if (fade) {
      const f = (now - fade.since) / GLOW_OUT_MS;
      if (f >= 1) fade = null;
      else { strokeGlow(ctx, fade.target, fade.alpha * (1 - f)); animating = true; }
    }

    if (marker && !isEnabled()) { marker = null; setGlowTarget(null, now); }
    if (!marker) { if (animating) canvas.requestRenderAll(); return; }

    if (glow) {
      strokeGlow(ctx, glow.target, glowAlpha(now));
      const e = now - glow.since - GLOW_DELAY_MS;
      if (e >= 0 && e < GLOW_MS) animating = true;
    }

    const vpt = canvas.viewportTransform;
    const x = marker.x * vpt[0] + vpt[4];
    const y = marker.y * vpt[3] + vpt[5];
    const t = Math.min(1, (now - markerSince) / MARKER_POP_MS);
    const s = MARKER_PX * (1 + 0.5 * (1 - t) * (1 - t));   // 1.5× → 1×, ausklingend

    if (marker.guides?.length) {
      // Hilfslinien von der Referenz-Ecke zum Cursor, dazu kleine Kreuze an beiden Enden
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = MARKER_COLOR;
      for (const g of marker.guides) {
        const ax = g.x1 * vpt[0] + vpt[4], ay = g.y1 * vpt[3] + vpt[5];
        const bx = g.x2 * vpt[0] + vpt[4], by = g.y2 * vpt[3] + vpt[5];
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        for (const [cx, cy] of [[ax, ay], [bx, by]]) {
          ctx.moveTo(cx - 3, cy - 3); ctx.lineTo(cx + 3, cy + 3);
          ctx.moveTo(cx - 3, cy + 3); ctx.lineTo(cx + 3, cy - 3);
        }
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      ctx.restore();
    }
    if (marker.kind === 'align') {           // reine Ausrichtung: kein Ecken-/Kanten-Marker
      if (animating) canvas.requestRenderAll();
      return;
    }

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
    if (t < 1 || animating) canvas.requestRenderAll();
  });

  // DOM-Event statt canvas.on('mouse:out'): setupCanvasEvents in main.js hängt
  // alle mouse:out-Handler der Canvas ab und hätte diesen mit entfernt.
  canvas.upperCanvasEl?.addEventListener('mouseleave', clear);

  /**
   * Skalieren eines ungedrehten Rechtecks: die bewegte(n) Kante(n) rasten auf
   * Ecken und achsparallele Kanten anderer Objekte ein, die neben ihr liegen.
   * Nur Rechtecke — bei Polygon/Linie sitzt der Griff an der Bounding-Box, nicht
   * an einem echten Eckpunkt; präzise geht dort der Eckpunkt-Modus.
   * Welche Kante sich bewegt, entscheidet die Nähe zum Pointer (robust auch,
   * wenn Fabric beim Überziehen spiegelt). Die gegenüberliegende Kante bleibt
   * stehen: nach dem Ändern der Skalierung wird darauf zurückverschoben.
   */
  function snapScale(obj, e, corner, pointer) {
    if (!isEnabled() || e?.altKey || e?.shiftKey || obj.type !== 'rect' ||
        (obj.angle || 0) % 360 !== 0 || !corner) { clear(); return; }
    const box = boxOf(obj);
    const tol = SNAP_TOLERANCE_PX / (canvas.getZoom() || 1);
    const ts = targets([obj]).map(t => ({ t, shape: cornersOf(t) })).filter(x => x.shape?.pts.length > 1);

    // Kandidaten für eine Kante bei `pos` auf Achse `ax` ('x' = senkrechte Kante),
    // die sich über [lo, hi] der anderen Achse erstreckt.
    const findSide = (ax, pos, lo, hi) => {
      const oa = ax === 'x' ? 'y' : 'x';
      let best = null;
      const take = (d, val, contact, kind, target) => {
        if (d <= tol && (!best || d < best.d || (d === best.d && kind === 'vertex'))) {
          best = { d, val, contact, kind, target };
        }
      };
      for (const { t, shape } of ts) {
        for (const v of shape.pts) {
          if (v[oa] >= lo - tol && v[oa] <= hi + tol) take(Math.abs(v[ax] - pos), v[ax], v, 'vertex', t);
        }
        for (const [a, b] of segmentsOf(shape)) {
          if (Math.abs(a[ax] - b[ax]) > 1e-6 * (1 + Math.abs(a[ax]))) continue;  // nur parallele Kanten
          const oLo = Math.max(lo, Math.min(a[oa], b[oa])), oHi = Math.min(hi, Math.max(a[oa], b[oa]));
          if (oLo > oHi) continue;
          const mid = (oLo + oHi) / 2;
          take(Math.abs(a[ax] - pos), a[ax], ax === 'x' ? { x: a.x, y: mid } : { x: mid, y: a.y }, 'edge', t);
        }
      }
      return best;
    };

    const moveX = /[lr]/.test(corner), moveY = /[tb]/.test(corner);
    const right = Math.abs(pointer.x - box.maxX) < Math.abs(pointer.x - box.minX);
    const bottom = Math.abs(pointer.y - box.maxY) < Math.abs(pointer.y - box.minY);
    // Ohne direkten Kontakt: Kante an der Flucht einer Nachbar-Ecke ausrichten
    // (Hilfslinie zur nächstgelegenen Ecke der bewegten Kante)
    const range = ALIGN_RANGE_PX / (canvas.getZoom() || 1);
    const alignSide = (ax, pos, lo, hi) => {
      const oa = ax === 'x' ? 'y' : 'x';
      let best = null;
      for (const { shape } of ts) {
        for (const v of shape.pts) {
          const d = Math.abs(v[ax] - pos);
          const near = Math.max(lo, Math.min(hi, v[oa]));   // nächster Punkt der Kante
          const far = Math.abs(v[oa] - near);
          if (d > tol || far > range) continue;
          if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && far < best.far)) {
            best = { d, far, val: v[ax], ref: v, near, kind: 'align' };
          }
        }
      }
      return best;
    };
    const side = (ax, pos, lo, hi) => findSide(ax, pos, lo, hi) || alignSide(ax, pos, lo, hi);
    const sx = moveX ? side('x', right ? box.maxX : box.minX, box.minY, box.maxY) : null;
    const sy = moveY ? side('y', bottom ? box.maxY : box.minY, box.minX, box.maxX) : null;
    if (!sx && !sy) { clear(); return; }

    if (sx) {
      const w = right ? sx.val - box.minX : box.maxX - sx.val;
      if (w > 1) obj.set('scaleX', w / obj.width);
    }
    if (sy) {
      const h = bottom ? sy.val - box.minY : box.maxY - sy.val;
      if (h > 1) obj.set('scaleY', h / obj.height);
    }
    // Gegenüberliegende Kante festhalten
    const nb = boxOf(obj);
    obj.set({
      left: obj.left + (sx ? (right ? box.minX - nb.minX : box.maxX - nb.maxX) : 0),
      top:  obj.top  + (sy ? (bottom ? box.minY - nb.minY : box.maxY - nb.maxY) : 0),
    });
    obj.setCoords();

    // Hilfslinien der ausgerichteten Achsen (Referenz-Ecke → Kante in neuer Lage)
    const guides = [];
    if (sx?.kind === 'align') guides.push({ x1: sx.ref.x, y1: sx.ref.y, x2: sx.val, y2: sx.near });
    if (sy?.kind === 'align') guides.push({ x1: sy.ref.x, y1: sy.ref.y, x2: sy.near, y2: sy.val });
    const guideKey = guides.map(g => `${g.x1},${g.y1},${g.x2},${g.y2}`).join('|');

    // Marker: Kontakt hat Vorrang (bei zwei Kontakt-Achsen an der bewegten Ecke),
    // sonst reine Ausrichtung
    const cx = sx && sx.kind !== 'align' ? sx : null;
    const cy = sy && sy.kind !== 'align' ? sy : null;
    let hit;
    if (cx && cy) {
      hit = { x: cx.val, y: cy.val, kind: cx.kind === 'vertex' && cy.kind === 'vertex' ? 'vertex' : 'edge', target: cx.target };
    } else if (cx || cy) {
      const c = cx || cy;
      hit = { ...c.contact, kind: c.kind, target: c.target };
    } else {
      const g = guides[guides.length - 1];
      hit = { x: g.x2, y: g.y2, kind: 'align', target: null };
    }
    setMarker({ x: hit.x, y: hit.y, kind: hit.kind, target: hit.target, guides, guideKey });
  }

  const api = { snap, snapMove, snapScale, clear, isEnabled };
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
