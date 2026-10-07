/**
 * hit-testing.js - Präzise Trefferprüfung für Annotationen
 *
 * Fabric prüft einen Klick nur gegen das Bounding-Rechteck eines Objekts und
 * nimmt das oberste, das passt. Bei L-förmigen Polygonen gehört so die leere
 * Ecke zur Klickfläche, und eine dünne Linie über einem Polygon ist kaum zu
 * treffen. Hier ersetzt für Annotationen:
 *
 *  1. Geometrie statt Rechteck: Polygon = Punkt-im-Polygon, Linie = Abstand zum
 *     Segment, jeweils mit einer Toleranz in BILDSCHIRM-Pixeln (zoomunabhängig).
 *  2. Vorrang des Spezifischeren statt "oberstes gewinnt": Linien vor Umrissen
 *     vor Flächen-Innerem, innerhalb einer Stufe die kleinste Fläche.
 *  3. Durchklicken: ein erneuter, langsamer Klick an derselben Stelle wählt das
 *     nächste Objekt darunter (schnell = Doppelklick, der wechselt nie).
 *  4. Hover-Vorschau: das Objekt, das ein Klick treffen würde, bekommt einen
 *     Schimmer — man sieht vor dem Klick, was man erwischt.
 *
 * Alles andere (Eckpunkt-Griffe, Bemassung, Textfeld, Legende, Mehrfachauswahl,
 * die Griffe des aktiven Objekts) behält Fabrics Verhalten. Nur die Trefferprüfung
 * ändert sich, der angezeigte Auswahlrahmen bleibt wie er ist.
 */

import { util } from 'fabric';

const HIT_TOLERANCE_PX = 6;         // Bildschirm-px um Linien/Umrisse herum
const CYCLE_MAX_MOVE_PX = 4;        // so weit darf der Klick wandern und gilt noch als "dieselbe Stelle"
const CYCLE_MIN_INTERVAL_MS = 400;  // schnellere Folgeklicks sind ein Doppelklick → nie durchschalten
const HOVER_COLOR = 'rgba(25, 118, 210, 0.45)';   // App-Blau wie die Eckpunkt-Griffe
const HOVER_EXTRA_PX = 6;           // Schimmer-Breite über die Strichbreite hinaus (Bildschirm-px)

// Trefferstufen — kleiner = gewinnt
const TIER_LINE = 0;
const TIER_EDGE = 1;
const TIER_INSIDE = 2;

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPath(p, pts, closed) {
  let d = Infinity;
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) d = Math.min(d, distToSegment(p, pts[i], pts[i + 1]));
  if (closed && n > 2) d = Math.min(d, distToSegment(p, pts[n - 1], pts[0]));
  return d;
}

// Ray-Casting (gerade/ungerade Regel)
function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
        p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a) / 2;
}

/**
 * Umriss einer Annotation in absoluten Szenen-Koordinaten. Berücksichtigt
 * Verschieben/Skalieren/Drehen und die Lage in einer Mehrfachauswahl, weil
 * calcTransformMatrix() die Gruppen-Transformation mit einrechnet.
 */
function outlineOf(obj) {
  if (obj.type === 'rect' || !Array.isArray(obj.points)) {
    return { pts: obj.getCoords(), closed: true };
  }
  const m = obj.calcTransformMatrix();
  const po = obj.pathOffset;
  const pts = obj.points.map(p => util.transformPoint({ x: p.x - po.x, y: p.y - po.y }, m));
  return { pts, closed: obj.annotationType !== 'line' };
}

/**
 * Trifft der Szenen-Punkt p die Annotation? → { tier, area, dist } oder null.
 * tol = Toleranz in Szenen-Einheiten (Bildschirm-px / Zoom).
 */
function hitAnnotation(obj, p, tol) {
  const reach = tol + (obj.strokeWidth || 0) / 2;

  // Grobfilter über das Bounding-Rechteck (+ Reichweite), bevor gerechnet wird
  const coords = obj.getCoords();
  const xs = coords.map(c => c.x), ys = coords.map(c => c.y);
  if (p.x < Math.min(...xs) - reach || p.x > Math.max(...xs) + reach ||
      p.y < Math.min(...ys) - reach || p.y > Math.max(...ys) + reach) {
    return null;
  }

  const { pts, closed } = outlineOf(obj);
  if (pts.length < 2) return null;
  const dist = distToPath(p, pts, closed);

  if (!closed) {
    return dist <= reach ? { tier: TIER_LINE, area: 0, dist } : null;
  }
  const area = polygonArea(pts);
  if (dist <= reach) return { tier: TIER_EDGE, area, dist };
  if (pointInPolygon(p, pts)) return { tier: TIER_INSIDE, area, dist };
  return null;
}

/**
 * Montiert die Trefferprüfung auf eine Canvas-Instanz (einmal pro Instanz —
 * initCanvas erzeugt sie pro Seite neu).
 * @param {Canvas} canvas
 * @param {{ isActive: () => boolean }} opts  isActive: nur im Auswahl-Werkzeug
 *        ohne laufende Bearbeitung; sonst gilt unverändert Fabrics Verhalten.
 * @returns {{ setHover, clearHover, handleClickCycle }}
 */
export function installSmartHitTesting(canvas, { isActive }) {
  const originalSearch = canvas._searchPossibleTargets.bind(canvas);

  /**
   * Alle Annotationen unter dem Viewport-Punkt, nach Vorrang sortiert. Liegt ein
   * anderes trefferfähiges Objekt (Griff, Bemassung, Textfeld, Legende) OBEN auf,
   * bevor eine Annotation getroffen wurde, gewinnt es wie bisher → `blocker`.
   */
  function collect(objects, viewportPt) {
    const scenePt = util.transformPoint(viewportPt, util.invertTransform(canvas.viewportTransform));
    const tol = HIT_TOLERANCE_PX / (canvas.getZoom() || 1);
    const hits = [];
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (obj.objectType === 'annotation') {
        if (!obj.visible || !obj.evented) continue;
        const h = hitAnnotation(obj, scenePt, tol);
        if (h) hits.push({ obj, ...h, z: i });
      } else if (canvas._checkTarget(obj, viewportPt)) {
        if (!hits.length) return { hits, blocker: obj };
        break;   // liegt unter einer getroffenen Annotation
      }
    }
    hits.sort((a, b) =>
      a.tier - b.tier ||
      (a.tier === TIER_LINE ? a.dist - b.dist : a.area - b.area) ||
      b.z - a.z);
    return { hits, blocker: null };
  }

  canvas._searchPossibleTargets = function (objects, pointer) {
    if (!isActive()) return originalSearch(objects, pointer);

    // findTarget fragt zuerst nur das aktive Objekt ab und gibt es zurück, sobald
    // der Klick darin liegt — ein ausgewähltes grosses Polygon würde so jede Linie
    // und jedes kleine Rechteck darin schlucken. Nur bestätigen, wenn es auch im
    // Gesamtvergleich vorne liegt; sonst sucht findTarget über alle Objekte weiter.
    const active = this._activeObject;
    if (objects.length === 1 && objects[0] === active && active.objectType === 'annotation') {
      const { hits, blocker } = collect(this._objects, pointer);
      return !blocker && hits[0]?.obj === active ? active : undefined;
    }

    const { hits, blocker } = collect(objects, pointer);
    if (blocker) return originalSearch([blocker], pointer);
    return hits[0]?.obj;
  };

  // ── Hover-Vorschau ──────────────────────────────────────────────────────────
  let hovered = null;

  function hoverVisible() {
    return hovered && hovered.canvas === canvas && isActive() &&
      !canvas._currentTransform &&                    // nicht während Ziehen/Skalieren
      !canvas.getActiveObjects().includes(hovered);   // ausgewählt hat schon seinen Rahmen
  }

  canvas.on('after:render', ({ ctx }) => {
    if (ctx !== canvas.getContext() || !hoverVisible()) return;
    const { pts, closed } = outlineOf(hovered);
    if (pts.length < 2) return;
    const zoom = canvas.getZoom() || 1;
    ctx.save();
    ctx.transform(...canvas.viewportTransform);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    ctx.lineWidth = (hovered.strokeWidth || 2) + HOVER_EXTRA_PX / zoom;
    ctx.strokeStyle = HOVER_COLOR;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  });

  function setHover(target) {
    if (hovered === target) return;
    hovered = target;
    canvas.requestRenderAll();
  }

  function clearHover(target) {
    if (!hovered || (target && target !== hovered)) return;
    hovered = null;
    canvas.requestRenderAll();
  }

  // Bei einer Mehrfachauswahl meldet Fabric innerhalb ihres Rechtecks die Auswahl
  // selbst als Hover-Ziel — mouse:over sieht dann nie die Annotation darunter.
  // Solange eine Mehrfachauswahl aktiv ist, das Hover-Ziel deshalb selbst bestimmen.
  // ('mouse:move:before', weil setupCanvasEvents alle 'mouse:move'-Handler abhängt.)
  let hoverFromSelection = false;
  canvas.on('mouse:move:before', ({ e }) => {
    const sel = canvas.getActiveObject();
    const multi = sel && canvas.getActiveObjects().length > 1;
    const pt = multi && isActive() && !canvas._currentTransform ? canvas.getViewportPoint(e) : null;
    if (pt && canvas._checkTarget(sel, pt)) {
      const { hits, blocker } = collect(canvas._objects, pt);
      hoverFromSelection = true;
      setHover(blocker ? null : hits[0]?.obj ?? null);
    } else if (hoverFromSelection) {
      // Rechteck der Auswahl verlassen: ab hier liefern mouse:over/out wieder das Ziel
      hoverFromSelection = false;
      clearHover();
    }
  });

  // ── Durchklicken ────────────────────────────────────────────────────────────
  let down = null;       // { x, y, prevActive } beim letzten Mausdruck
  let lastClick = null;  // { x, y, time } beim letzten Klick ohne Ziehen

  // 'mouse:down:before' feuert, bevor Fabric die Auswahl ändert.
  canvas.on('mouse:down:before', ({ e }) => {
    down = { x: e.clientX, y: e.clientY, time: performance.now(), prevActive: canvas.getActiveObject() };
  });

  /** Aus dem mouse:up-Handler von main.js aufrufen. */
  function handleClickCycle({ e }) {
    if (!down || !e || e.clientX === undefined) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > CYCLE_MAX_MOVE_PX;
    const sameSpot = lastClick &&
      Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) <= CYCLE_MAX_MOVE_PX;
    const slow = lastClick && down.time - lastClick.time >= CYCLE_MIN_INTERVAL_MS;
    const prev = down.prevActive;
    const plain = !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;

    if (isActive() && !moved && sameSpot && slow && plain && prev?.objectType === 'annotation') {
      const ranked = collect(canvas._objects, canvas.getViewportPoint(e)).hits.map(h => h.obj);
      const i = ranked.indexOf(prev);
      if (ranked.length > 1 && i !== -1) {
        const next = ranked[(i + 1) % ranked.length];
        if (canvas.getActiveObject() !== next) {
          canvas.setActiveObject(next, e);
          canvas.requestRenderAll();
        }
      }
    }
    lastClick = moved ? null : { x: e.clientX, y: e.clientY, time: performance.now() };
    down = null;
  }

  return { setHover, clearHover, handleClickCycle };
}
