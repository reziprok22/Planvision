/**
 * pdf-export-client.js
 *
 * Frontend-only PDF export using pdf-lib.
 * All annotations (AI + manual) are taken directly from Fabric.js canvas data
 * (pageCanvasData) — no backend predictions format needed.
 */

import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import { autoFontScale, isLightColor, sanitizeFileBase } from './pdf-handler.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return rgb(0.53, 0.53, 0.53);
    if (hex === 'white') return rgb(1, 1, 1);
    if (hex === 'black') return rgb(0, 0, 0);
    const match = hex.match(/^#?([0-9a-f]{6})/i);
    if (!match) return rgb(0.53, 0.53, 0.53);
    const c = match[1];
    return rgb(
        parseInt(c.slice(0, 2), 16) / 255,
        parseInt(c.slice(2, 4), 16) / 255,
        parseInt(c.slice(4, 6), 16) / 255
    );
}

/**
 * Parse a Fabric fill value into { color, opacity } exactly as the canvas
 * renders it. Canvas fills are '#rrggbbaa' strings (default alpha 0x20 ≈ 12.5 %);
 * lines use '' (no fill).
 */
function parseFill(fill, fallbackHex) {
    if (typeof fill === 'string') {
        const m = fill.match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
        if (m) return { color: hexToRgb(m[1]), opacity: m[2] ? parseInt(m[2], 16) / 255 : 1 };
        // Label-Manager updates write 'rgba(r, g, b, a)' fills
        const ra = fill.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
        if (ra) {
            const alpha = ra[4] !== undefined ? parseFloat(ra[4]) : 1;
            if (alpha <= 0) return { color: null, opacity: 0 };
            return { color: rgb(+ra[1] / 255, +ra[2] / 255, +ra[3] / 255), opacity: alpha };
        }
        if (fill === '' || fill === 'transparent') return { color: null, opacity: 0 };
    }
    return { color: hexToRgb(fallbackHex), opacity: 0x20 / 255 };
}

// Mirrors getContrastTextColor() on the canvas (shared luminance via isLightColor)
function contrastColor(hex) {
    return isLightColor(hex) ? rgb(0.13, 0.13, 0.13) : rgb(1, 1, 1);
}

function loadImgDimensions(url) {
    return new Promise((resolve) => {
        const img = new window.Image();
        img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/**
 * Reconstruct absolute image-pixel coordinates from a serialized Fabric.js annotation.
 *
 * Fabric.js stores polygon/polyline points relative to the object's pathOffset
 * (= center of bounding box at scale=1).
 * Absolute = point * scale + (left + width/2, top + height/2)
 */
function fabricToAbsolute(ann) {
    const sx = ann.scaleX || 1;
    const sy = ann.scaleY || 1;
    const t  = (ann.type || '').toLowerCase();
    // Fabric angle is clockwise in canvas (y-down) coordinates; rotation
    // happens around the object's origin point (left, top for origin left/top).
    const rad = ((ann.angle || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    if (t === 'rect') {
        const w = ann.width  * sx;
        const h = ann.height * sy;
        if (ann.angle) {
            // Rotated rect → emit its 4 corners as a polygon
            const corner = (dx, dy) => ({
                x: ann.left + dx * cos - dy * sin,
                y: ann.top  + dx * sin + dy * cos,
            });
            return { kind: 'polygon', points: [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)] };
        }
        return {
            kind: 'rect',
            x1: ann.left,
            y1: ann.top,
            x2: ann.left + w,
            y2: ann.top  + h,
        };
    }

    if (t === 'polygon' || t === 'polyline') {
        const pts = ann.points || [];
        const xs  = pts.map(p => p.x);
        const ys  = pts.map(p => p.y);
        // pathOffset = center of the points' bounding box (Fabric.js internal)
        const pox = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
        const poy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
        // Object center in canvas pixels: origin (left, top) + rotated offset to center
        const hw = (ann.width  || 0) * sx / 2;
        const hh = (ann.height || 0) * sy / 2;
        const cx = ann.left + hw * cos - hh * sin;
        const cy = ann.top  + hw * sin + hh * cos;
        const points = pts.map(p => {
            const dx = (p.x - pox) * sx;
            const dy = (p.y - poy) * sy;
            return {
                x: cx + dx * cos - dy * sin,
                y: cy + dx * sin + dy * cos,
            };
        });
        return { kind: t, points };
    }

    return null;
}

/**
 * Build the display→user-space transform for a pdf-lib page.
 *
 * Pages can carry a /Rotate flag (90/180/270): page.getSize() then returns the
 * UNROTATED media box, while the rendered page image (and thus all canvas
 * coordinates) is in the rotated *display* orientation. pdf-lib always draws
 * in unrotated user space, so every display-space point must be mapped back.
 */
function makeDisplayTransform(page) {
    const { width: W, height: H } = page.getSize();
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const swapped  = rotation === 90 || rotation === 270;

    // Page size as displayed (= orientation of the rendered image)
    const displayW = swapped ? H : W;
    const displayH = swapped ? W : H;

    // Map a display-space point (top-left origin, y down, PDF points)
    // to unrotated user space (bottom-left origin, y up).
    let toUser;
    switch (rotation) {
        case 90:  toUser = (xd, yd) => ({ x: yd,     y: xd     }); break;
        case 180: toUser = (xd, yd) => ({ x: W - xd, y: yd     }); break;
        case 270: toUser = (xd, yd) => ({ x: W - yd, y: H - xd }); break;
        default:  toUser = (xd, yd) => ({ x: xd,     y: H - yd }); break;
    }

    // Display-space unit vectors expressed in user space (for text layout)
    const right = { 0: { x: 1, y: 0 }, 90: { x: 0, y: 1 }, 180: { x: -1, y: 0 }, 270: { x: 0, y: -1 } }[rotation];
    const down  = { 0: { x: 0, y: -1 }, 90: { x: 1, y: 0 }, 180: { x: 0, y: 1 }, 270: { x: -1, y: 0 } }[rotation];

    return { rotation, swapped, displayW, displayH, H, toUser, right, down };
}

/**
 * Draw all annotations from canvas data onto a pdf-lib page.
 * T  = makeDisplayTransform(page)
 * sx = displayPageWidth  / imageNaturalWidth
 * sy = displayPageHeight / imageNaturalHeight
 */
function drawAnnotationsOnPage(page, canvasAnnotations, canvasTextLabels, T, sx, sy, labelMap, font, k = 1) {
    let drawn = 0;

    // Pass 1: draw annotation shapes
    for (const ann of canvasAnnotations) {
        if (ann.objectType !== 'annotation') continue;

        const labelId  = ann.labelId ?? ann.objectLabel ?? 0;
        const colorHex = labelMap[labelId]?.color || '#888888';
        const color    = hexToRgb(colorHex);
        const fill     = parseFill(ann.fill, colorHex);
        const strokeW  = Math.max(0.5, (ann.strokeWidth || 2) * Math.min(sx, sy));

        const coords = fabricToAbsolute(ann);
        if (!coords) continue;

        if (coords.kind === 'rect') {
            // Both corners through the transform; 90°-multiples keep rects axis-aligned
            const p1 = T.toUser(coords.x1 * sx, coords.y1 * sy);
            const p2 = T.toUser(coords.x2 * sx, coords.y2 * sy);
            const w  = Math.abs(p2.x - p1.x);
            const h  = Math.abs(p2.y - p1.y);
            if (w > 0 && h > 0) {
                page.drawRectangle({
                    x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: w, height: h,
                    borderColor: color, borderWidth: strokeW, borderOpacity: 1,
                    ...(fill.color ? { color: fill.color, opacity: fill.opacity } : {}) });
                drawn++;
            }

        } else if (coords.kind === 'polygon' && coords.points.length >= 3) {
            // drawSvgPath measures path y downward from the anchor (0, T.H)
            const pts  = coords.points.map(p => T.toUser(p.x * sx, p.y * sy));
            const path = `M ${pts[0].x} ${T.H - pts[0].y} ` +
                pts.slice(1).map(p => `L ${p.x} ${T.H - p.y}`).join(' ') + ' Z';
            page.drawSvgPath(path, { x: 0, y: T.H,
                borderColor: color, borderWidth: strokeW, borderOpacity: 1,
                ...(fill.color ? { color: fill.color, opacity: fill.opacity } : {}) });
            drawn++;

        } else if (coords.kind === 'polyline' && coords.points.length >= 2) {
            const pts = coords.points.map(p => T.toUser(p.x * sx, p.y * sy));
            for (let i = 0; i < pts.length - 1; i++) {
                page.drawLine({
                    start: { x: pts[i].x,   y: pts[i].y },
                    end:   { x: pts[i+1].x, y: pts[i+1].y },
                    color, thickness: strokeW,
                });
            }
            // Endpoint dots at first/last vertex — mirrors Polyline._render on canvas
            // (radius = strokeWidth + 1.5 in image px, scaled to page units).
            const dotR = ((ann.strokeWidth || 2) + 1.5) * Math.min(sx, sy);
            for (const p of [pts[0], pts[pts.length - 1]]) {
                page.drawCircle({ x: p.x, y: p.y, size: dotR, color });
            }
            drawn++;
        }
    }

    // Line-annotation anchors (display space) so their number label can be nudged
    // clear of the start dot. The saved position carries the canvas offset scaled
    // by sx, but the export badge uses a fixed font size — so that scaled offset is
    // too small and the badge touches the point. We re-anchor line labels edge-wise
    // instead (badge edge kept a fixed gap past the start dot, any orientation).
    const lineAnchors = {};
    for (const ann of canvasAnnotations) {
        if (ann.annotationType !== 'line' || ann.id == null) continue;
        const c = fabricToAbsolute(ann);
        if (!c || c.kind !== 'polyline' || c.points.length < 2) continue;
        const p0 = { x: c.points[0].x * sx,  y: c.points[0].y * sy };
        const p1 = { x: c.points[1].x * sx,  y: c.points[1].y * sy };
        const dx = p0.x - p1.x, dy = p0.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const dotR = ((ann.strokeWidth || 2) + 1.5) * Math.min(sx, sy);
        lineAnchors[ann.id] = { p0, dir: { x: dx / len, y: dy / len }, dotR };
    }

    // Pass 2: draw text labels using saved canvas positions (originX/Y: 'center')
    if (font && canvasTextLabels?.length) {
        for (const tl of canvasTextLabels) {
            if (!tl.text) continue;

            const bgHex     = tl.backgroundColor || '#888888';
            const bgColor   = hexToRgb(bgHex);
            const textColor = contrastColor(bgHex);

            const lines    = tl.text.split('\n');
            const fontSize = 8 * k;      // mirrors the canvas auto font scale
            const lineH    = fontSize + 2 * k;
            const textH    = lines.length * lineH;
            const textW    = Math.max(...lines.map(l => font.widthOfTextAtSize(l, fontSize)));

            // Badge is axis-aligned in *display* space → swap w/h on rotated pages
            const wBadge = textW + 2 * k;
            const hBadge = textH;

            // tl.left/top is the center of the badge (originX/Y: 'center'). For line
            // labels, override it: place the badge edge a fixed gap past the start dot.
            let cx = tl.left * sx, cy = tl.top * sy;
            const anchor = lineAnchors[tl.linkedAnnotationId];
            if (anchor) {
                const halfAlong = Math.abs(anchor.dir.x) * wBadge / 2 + Math.abs(anchor.dir.y) * hBadge / 2;
                const GAP = 3 * k;   // points between start dot and badge edge
                cx = anchor.p0.x + anchor.dir.x * (halfAlong + anchor.dotR + GAP);
                cy = anchor.p0.y + anchor.dir.y * (halfAlong + anchor.dotR + GAP);
            }
            const c = T.toUser(cx, cy);

            page.drawRectangle({
                x: c.x - (T.swapped ? hBadge : wBadge) / 2,
                y: c.y - (T.swapped ? wBadge : hBadge) / 2,
                width:  T.swapped ? hBadge : wBadge,
                height: T.swapped ? wBadge : hBadge,
                color: bgColor, opacity: 0.9,
            });

            lines.forEach((line, i) => {
                const lineW = font.widthOfTextAtSize(line, fontSize);
                // Offsets in display space from the badge center …
                const dxd = -lineW / 2;
                const dyd = (i + 1) * lineH - textH / 2 - 2 * k;
                // … mapped to user space via the display unit vectors
                const px = c.x + dxd * T.right.x + dyd * T.down.x;
                const py = c.y + dxd * T.right.y + dyd * T.down.y;
                page.drawText(line, {
                    x: px, y: py,
                    size: fontSize, font, color: textColor,
                    rotate: degrees(T.rotation), // keeps text upright in the displayed orientation
                });
            });
        }
    }

    return drawn;
}

/**
 * Draw CAD-style dimension helpers (own objectType 'dimension') onto a page.
 * Each record carries image-px geometry { p1, p2, d1, d2 } and a precomputed
 * measurement string `text`. Mirrors buildDimensionGroup() in main.js.
 */
function drawDimensionsOnPage(page, dimensions, T, sx, sy, font, k = 1) {
    if (!dimensions?.length) return 0;
    let drawn = 0;

    const u = Math.min(sx, sy) * k;   // mirrors the canvas auto font scale
    const thickness = Math.max(0.5, 1 * u);
    const GAP = 6 * u, EXT = 6 * u, TICK = 9 * u;

    for (const d of dimensions) {
        if (!d.p1 || !d.p2 || !d.d1 || !d.d2) continue;
        const color = hexToRgb(d.color || '#333333');

        // Image px → display px
        const P1 = { x: d.p1.x * sx, y: d.p1.y * sy };
        const P2 = { x: d.p2.x * sx, y: d.p2.y * sy };
        const D1 = { x: d.d1.x * sx, y: d.d1.y * sy };
        const D2 = { x: d.d2.x * sx, y: d.d2.y * sy };

        const ddx = D2.x - D1.x, ddy = D2.y - D1.y;
        const len = Math.hypot(ddx, ddy) || 1;
        const ux = ddx / len, uy = ddy / len;      // along dimension line
        const nx = -uy, ny = ux;                    // normal
        const s = Math.sign((D1.x - P1.x) * nx + (D1.y - P1.y) * ny) || 1;

        const drawSeg = (ax, ay, bx, by) => {
            const A = T.toUser(ax, ay), B = T.toUser(bx, by);
            page.drawLine({ start: { x: A.x, y: A.y }, end: { x: B.x, y: B.y }, color, thickness });
        };

        // Witness (extension) lines
        drawSeg(P1.x + nx * GAP * s, P1.y + ny * GAP * s, D1.x + nx * EXT * s, D1.y + ny * EXT * s);
        drawSeg(P2.x + nx * GAP * s, P2.y + ny * GAP * s, D2.x + nx * EXT * s, D2.y + ny * EXT * s);
        // Dimension line
        drawSeg(D1.x, D1.y, D2.x, D2.y);
        // 45° end ticks
        const tl = Math.hypot(ux + nx, uy + ny) || 1;
        const tux = (ux + nx) / tl * TICK / 2, tuy = (uy + ny) / tl * TICK / 2;
        drawSeg(D1.x - tux, D1.y - tuy, D1.x + tux, D1.y + tuy);
        drawSeg(D2.x - tux, D2.y - tuy, D2.x + tux, D2.y + tuy);

        // Measurement text as a centred white badge at the dimension-line midpoint.
        // Kept axis-aligned in display orientation (like annotation labels) for legibility.
        if (font && d.text) {
            const c = T.toUser((D1.x + D2.x) / 2, (D1.y + D2.y) / 2);
            const fontSize = 8 * k;
            const textW = font.widthOfTextAtSize(d.text, fontSize);
            const wBadge = textW + 4 * k, hBadge = fontSize + 3 * k;
            page.drawRectangle({
                x: c.x - (T.swapped ? hBadge : wBadge) / 2,
                y: c.y - (T.swapped ? wBadge : hBadge) / 2,
                width:  T.swapped ? hBadge : wBadge,
                height: T.swapped ? wBadge : hBadge,
                color: rgb(1, 1, 1), opacity: 0.85,
            });
            const dxd = -textW / 2, dyd = fontSize / 2 - 1 * k;
            page.drawText(d.text, {
                x: c.x + dxd * T.right.x + dyd * T.down.x,
                y: c.y + dxd * T.right.y + dyd * T.down.y,
                size: fontSize, font, color, rotate: degrees(T.rotation),
            });
        }
        drawn++;
    }
    return drawn;
}

// Greedy word-wrap to a max width (honours explicit newlines). Mirrors how a
// Fabric Textbox wraps, closely enough for the PDF (fonts differ slightly).
function wrapText(text, font, size, maxWidth) {
    const out = [];
    for (const para of String(text).split('\n')) {
        const words = para.split(' ');
        let line = '';
        for (const w of words) {
            const test = line ? line + ' ' + w : w;
            if (line && font.widthOfTextAtSize(test, size) > maxWidth) {
                out.push(line);
                line = w;
            } else {
                line = test;
            }
        }
        out.push(line);
    }
    return out;
}

/**
 * Draw text notes (Fabric Textbox, objectType 'textNote') onto a page.
 * Serialized fields: left/top (image px, top-left), width, fontSize, fill,
 * backgroundColor, scaleX/scaleY, text. Page rotation is honoured; a note's own
 * rotation is ignored (users rarely rotate notes).
 */
function drawTextNotesOnPage(page, notes, T, sx, sy, font) {
    if (!notes?.length) return 0;
    let drawn = 0;
    const s = Math.min(sx, sy);

    for (const t of notes) {
        if (!t.text || !t.text.trim()) continue;
        const sX = t.scaleX || 1, sY = t.scaleY || 1;
        const fs   = (t.fontSize || 18) * sY * s;      // display-space font size
        const boxW = (t.width || 180) * sX * sx;       // display-space wrap width
        const lineH = fs * 1.16;
        const color = hexToRgb(t.fill || '#222222');
        const lines = wrapText(t.text, font, fs, boxW);

        const x0 = (t.left || 0) * sx;                 // box top-left, display px
        const y0 = (t.top  || 0) * sy;
        const totalH = lines.length * lineH;

        // Background box (white, translucent) — axis-aligned for any 90° page rotation
        if (t.backgroundColor) {
            const c1 = T.toUser(x0, y0);
            const c2 = T.toUser(x0 + boxW, y0 + totalH);
            page.drawRectangle({
                x: Math.min(c1.x, c2.x), y: Math.min(c1.y, c2.y),
                width: Math.abs(c2.x - c1.x), height: Math.abs(c2.y - c1.y),
                color: rgb(1, 1, 1), opacity: 0.82,
            });
        }

        // Text lines, positioned via the display-space basis (like the label pass)
        const tl = T.toUser(x0, y0);
        lines.forEach((line, i) => {
            const dyd = i * lineH + fs * 0.8;          // baseline offset, display y-down
            page.drawText(line, {
                x: tl.x + dyd * T.down.x,
                y: tl.y + dyd * T.down.y,
                size: fs, font, color, rotate: degrees(T.rotation),
            });
        });
        drawn++;
    }
    return drawn;
}

/**
 * Draw the on-plan legend at its saved canvas position.
 * Mirrors the Fabric legend in main.js: title + one row per used label with
 * swatch, name, count and summed area (parsed from the annotations' labelText).
 */
function drawLegendOnPdfPage(page, T, sx, sy, legendPos, annotations, labelMap, font, fontB, k = 1) {
    // Collect per-label rows from the serialized annotations
    const itemMap = new Map();
    for (const ann of annotations) {
        if (ann.objectType !== 'annotation') continue;
        const labelId = ann.labelId ?? ann.objectLabel ?? 0;
        const label   = labelMap[labelId];
        const name    = label?.name || `Label ${labelId}`;
        if (!itemMap.has(name)) {
            itemMap.set(name, {
                name,
                color: label?.color || ann.stroke || '#888888',
                count: 0,
                area:  0,
                unit:  ann.annotationType === 'line' ? 'm' : 'm²',
            });
        }
        const item = itemMap.get(name);
        item.count++;
        // labelText = "<nr>\n<area> m²" — same measurement shown on the canvas
        const measurement = typeof ann.labelText === 'string' ? ann.labelText.split('\n')[1] : null;
        if (measurement) item.area += parseFloat(measurement) || 0;
    }
    const items = [...itemMap.values()];
    if (!items.length) return;

    // Layout in display space, scaled like the canvas legend (LEGEND_STYLE in
    // main.js) incl. the same per-page auto font scale
    const s = Math.min(sx, sy) * k;
    const fontSize  = 14 * s;
    const titleSize = 15 * s;
    const rowH      = 24 * s;
    const pad       = 14 * s;
    const swatch    = 14 * s;
    const gap       = 8  * s;

    // Table columns: swatch | name | count (right-aligned) | area (right-aligned)
    const nameStrings  = items.map(it => it.name);
    const countStrings = items.map(it => String(it.count));
    const areaStrings  = items.map(it => `${it.area.toFixed(2)} ${it.unit}`);

    const colGap = 18 * s;
    const nameW  = Math.max(...nameStrings.map(t => font.widthOfTextAtSize(t, fontSize)));
    const countW = Math.max(...countStrings.map(t => font.widthOfTextAtSize(t, fontSize)));
    const areaW  = Math.max(...areaStrings.map(t => font.widthOfTextAtSize(t, fontSize)));

    const nameX      = pad + swatch + gap;
    const countRight = nameX + nameW + colGap + countW;
    const areaRight  = countRight + colGap + areaW;

    const boxW = Math.max(areaRight + pad, pad * 2 + fontB.widthOfTextAtSize('Legende', titleSize));
    const boxH = pad * 2 + titleSize + 10 * s + items.length * rowH;

    // Display-space top-left anchor of the legend box
    const x0 = legendPos.left * sx;
    const y0 = legendPos.top  * sy;

    // Axis-aligned rect from two display-space corners (90°-multiples keep rects axis-aligned)
    const rectAt = (dx, dy, w, h, opts) => {
        const a = T.toUser(x0 + dx,     y0 + dy);
        const b = T.toUser(x0 + dx + w, y0 + dy + h);
        page.drawRectangle({
            x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
            width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
            ...opts,
        });
    };
    const textAt = (dx, dyBaseline, text, f, size, color) => {
        const p = T.toUser(x0 + dx, y0 + dyBaseline);
        page.drawText(text, { x: p.x, y: p.y, size, font: f, color, rotate: degrees(T.rotation) });
    };

    // Background
    rectAt(0, 0, boxW, boxH, {
        color: rgb(1, 1, 1), opacity: 0.92,
        borderColor: rgb(0.6, 0.6, 0.6), borderWidth: Math.max(0.5, s),
    });

    // Title
    textAt(pad, pad + titleSize, 'Legende', fontB, titleSize, rgb(0.13, 0.13, 0.13));

    // Rows
    const textColor = rgb(0.13, 0.13, 0.13);
    const rowsTop = pad + titleSize + 10 * s;
    items.forEach((it, i) => {
        const rowY = rowsTop + i * rowH;
        const baseline = rowY + fontSize;
        rectAt(pad, rowY + (fontSize - swatch) / 2 + 2 * s, swatch, swatch, {
            color: hexToRgb(it.color),
            borderColor: rgb(0.4, 0.4, 0.4), borderWidth: Math.max(0.3, 0.5 * s),
        });
        textAt(nameX, baseline, nameStrings[i], font, fontSize, textColor);
        textAt(countRight - font.widthOfTextAtSize(countStrings[i], fontSize), baseline, countStrings[i], font, fontSize, textColor);
        textAt(areaRight - font.widthOfTextAtSize(areaStrings[i], fontSize), baseline, areaStrings[i], font, fontSize, textColor);
    });
}

function triggerDownload(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const safeFileBase = (name) => sanitizeFileBase(name, 'Planli');

// ── Plan erstellen (annotated PDF) ────────────────────────────────────────────

export async function exportAnnotatedPdfClient({ pdfBlob, pageImageUrls, pageCanvasData, labels, projectName }) {
    const labelMap = Object.fromEntries((labels || []).map(l => [l.id, l]));

    let pdfDoc;

    if (pdfBlob) {
        pdfDoc = await PDFDocument.load(await pdfBlob.arrayBuffer());
    } else {
        // No original PDF — build one from page images
        pdfDoc = await PDFDocument.create();
        for (const url of pageImageUrls) {
            try {
                const bytes = await fetch(url).then(r => r.arrayBuffer());
                const isJpg = /\.(jpe?g)(\?.*)?$/i.test(url);
                const img   = isJpg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
                const p     = pdfDoc.addPage([img.width, img.height]);
                p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
            } catch (e) {
                console.warn('[PDF export] Image embed failed for', url, e);
                pdfDoc.addPage([595, 842]); // empty A4 fallback
            }
        }
    }

    const labelFont  = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const labelFontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pdfPages = pdfDoc.getPages();

    for (let i = 0; i < pdfPages.length; i++) {
        const pageNum     = i + 1;
        const canvasData  = pageCanvasData[pageNum] || pageCanvasData[String(pageNum)];
        const annotations = canvasData?.canvas_annotations || [];
        const dimensions  = canvasData?.canvas_dimensions || [];
        const textNotes   = canvasData?.canvas_text_notes || [];
        if (!annotations.length && !dimensions.length && !textNotes.length) continue;

        const page = pdfPages[i];
        const T = makeDisplayTransform(page);

        // pageImageUrls is 0-based: original page `pageNum` → index pageNum - 1
        // The rendered image is in display orientation → scale against display size
        const imgDim = pageImageUrls[pageNum - 1] ? await loadImgDimensions(pageImageUrls[pageNum - 1]) : null;
        const imgW   = imgDim?.w || T.displayW;
        const imgH   = imgDim?.h || T.displayH;
        const sx = T.displayW / imgW;
        const sy = T.displayH / imgH;
        // Same per-page auto font scale as on the canvas (labels, dimensions, legend)
        const k  = autoFontScale(imgW, imgH);

        const textLabels = canvasData?.canvas_text_labels || [];
        drawAnnotationsOnPage(page, annotations, textLabels, T, sx, sy, labelMap, labelFont, k);
        drawDimensionsOnPage(page, dimensions, T, sx, sy, labelFont, k);
        drawTextNotesOnPage(page, textNotes, T, sx, sy, labelFont);

        // On-plan legend (placed by the user on the canvas)
        if (canvasData?.legend_position) {
            drawLegendOnPdfPage(page, T, sx, sy, canvasData.legend_position, annotations, labelMap, labelFont, labelFontB, k);
        }
    }

    triggerDownload(await pdfDoc.save(), `${safeFileBase(projectName)}-annotiert.pdf`);
}

// ── Bericht erstellen (report PDF) ───────────────────────────────────────────

export async function exportReportPdfClient({ pageImageUrls, pageCanvasData, labels, projectName }) {
    const labelMap = Object.fromEntries((labels || []).map(l => [l.id, l]));
    const A4_W = 595, A4_H = 842;
    const MARGIN = 40;
    const INNER_W = A4_W - 2 * MARGIN;

    const pdfDoc = await PDFDocument.create();
    const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const dateStr = new Date().toLocaleDateString('de-DE');

    for (let i = 0; i < pageImageUrls.length; i++) {
        const pageNum    = i + 1;
        const canvasData = pageCanvasData[pageNum] || pageCanvasData[String(pageNum)];
        const annotations = (canvasData?.canvas_annotations || [])
            .filter(a => a.objectType === 'annotation');

        const page = pdfDoc.addPage([A4_W, A4_H]);
        let curY = A4_H - MARGIN;

        // Header
        page.drawText(projectName || 'Planli', {
            x: MARGIN, y: curY, size: 14, font: fontB, color: rgb(0, 0, 0)
        });
        page.drawText(`Seite ${pageNum}  |  ${dateStr}`, {
            x: MARGIN, y: curY - 18, size: 9, font, color: rgb(0.4, 0.4, 0.4)
        });
        curY -= 36;
        page.drawLine({ start: { x: MARGIN, y: curY }, end: { x: A4_W - MARGIN, y: curY },
            color: rgb(0.8, 0.8, 0.8), thickness: 0.5 });
        curY -= 14;

        // Page thumbnail
        const imgUrl = pageImageUrls[i];
        let embImg = null;
        if (imgUrl) {
            try {
                const imgBytes = await fetch(imgUrl).then(r => r.arrayBuffer());
                const isJpg    = /\.(jpe?g)(\?.*)?$/i.test(imgUrl);
                embImg = isJpg
                    ? await pdfDoc.embedJpg(imgBytes)
                    : await pdfDoc.embedPng(imgBytes);
            } catch (e) {
                console.warn('[Report export] image load failed:', imgUrl, e);
            }
        }

        if (embImg) {
            const maxThumbH = 280;
            const scale  = Math.min(INNER_W / embImg.width, maxThumbH / embImg.height);
            const thumbW = embImg.width  * scale;
            const thumbH = embImg.height * scale;
            const thumbX = MARGIN + (INNER_W - thumbW) / 2;
            const thumbY = curY - thumbH;

            page.drawImage(embImg, { x: thumbX, y: thumbY, width: thumbW, height: thumbH });

            // Vector annotations on thumbnail
            if (annotations.length) {
                const sx = thumbW / embImg.width;
                const sy = thumbH / embImg.height;

                for (const ann of annotations) {
                    const labelId  = ann.labelId ?? ann.objectLabel ?? 0;
                    const colorHex = labelMap[labelId]?.color || '#888888';
                    const color    = hexToRgb(colorHex);
                    const fill     = parseFill(ann.fill, colorHex);
                    const strokeW  = Math.max(0.3, (ann.strokeWidth || 2) * Math.min(sx, sy));
                    const coords   = fabricToAbsolute(ann);
                    if (!coords) continue;

                    if (coords.kind === 'rect') {
                        const w = (coords.x2 - coords.x1) * sx;
                        const h = (coords.y2 - coords.y1) * sy;
                        if (w > 0 && h > 0) {
                            page.drawRectangle({
                                x: thumbX + coords.x1 * sx,
                                y: thumbY + thumbH - coords.y2 * sy,
                                width: w, height: h,
                                borderColor: color, borderWidth: strokeW, borderOpacity: 1,
                                ...(fill.color ? { color: fill.color, opacity: fill.opacity } : {}),
                            });
                        }
                    } else if (coords.kind === 'polygon' && coords.points.length >= 3) {
                        const pts  = coords.points;
                        const path = `M ${pts[0].x * sx} ${pts[0].y * sy} ` +
                            pts.slice(1).map(p => `L ${p.x * sx} ${p.y * sy}`).join(' ') + ' Z';
                        page.drawSvgPath(path, {
                            x: thumbX, y: thumbY + thumbH,
                            borderColor: color, borderWidth: strokeW, borderOpacity: 1,
                            ...(fill.color ? { color: fill.color, opacity: fill.opacity } : {}),
                        });
                    } else if (coords.kind === 'polyline' && coords.points.length >= 2) {
                        for (let j = 0; j < coords.points.length - 1; j++) {
                            page.drawLine({
                                start: { x: thumbX + coords.points[j].x   * sx, y: thumbY + thumbH - coords.points[j].y   * sy },
                                end:   { x: thumbX + coords.points[j+1].x * sx, y: thumbY + thumbH - coords.points[j+1].y * sy },
                                color, thickness: strokeW,
                            });
                        }
                    }
                }
            }
            curY = thumbY - 14;
        }

        // Annotation table
        if (annotations.length > 0) {
            const COL   = [MARGIN, MARGIN + 30, MARGIN + 170, MARGIN + 290];
            const ROW_H = 16;

            // Table header
            page.drawRectangle({ x: MARGIN, y: curY - ROW_H, width: INNER_W, height: ROW_H,
                color: rgb(0.1, 0.1, 0.1) });
            [['#', COL[0]], ['Label', COL[1]], ['Typ', COL[2]], ['Farbe', COL[3]]].forEach(([txt, x]) =>
                page.drawText(txt, { x: x + 3, y: curY - 11, size: 8, font: fontB, color: rgb(1,1,1) })
            );
            curY -= ROW_H;

            annotations.forEach((ann, row) => {
                if (curY < MARGIN + 20) return;
                const labelId   = ann.labelId ?? ann.objectLabel ?? 0;
                const labelName = (labelMap[labelId]?.name || `Label ${labelId}`).slice(0, 25);
                const typeName  = ann.annotationType === 'polygon' ? 'Polygon'
                                : ann.annotationType === 'line'    ? 'Linie' : 'Rechteck';
                const colorHex  = labelMap[labelId]?.color || '#888888';

                page.drawRectangle({ x: MARGIN, y: curY - ROW_H, width: INNER_W, height: ROW_H,
                    color: row % 2 === 0 ? rgb(0.96, 0.96, 0.96) : rgb(1, 1, 1) });
                page.drawText(String(row + 1), { x: COL[0] + 3, y: curY - 11, size: 8, font, color: rgb(0,0,0) });
                page.drawText(labelName,        { x: COL[1] + 3, y: curY - 11, size: 8, font, color: rgb(0,0,0) });
                page.drawText(typeName,         { x: COL[2] + 3, y: curY - 11, size: 8, font, color: rgb(0,0,0) });
                page.drawRectangle({ x: COL[3] + 3, y: curY - 12, width: 12, height: 8,
                    color: hexToRgb(colorHex), borderColor: rgb(0.6,0.6,0.6), borderWidth: 0.5 });
                curY -= ROW_H;
            });

            page.drawLine({ start: { x: MARGIN, y: curY }, end: { x: A4_W - MARGIN, y: curY },
                color: rgb(0.8, 0.8, 0.8), thickness: 0.5 });
        } else {
            page.drawText('Keine Objekte auf dieser Seite.', {
                x: MARGIN, y: curY - 14, size: 9, font, color: rgb(0.5, 0.5, 0.5)
            });
        }
    }

    triggerDownload(await pdfDoc.save(), `${safeFileBase(projectName)}-bericht.pdf`);
}
