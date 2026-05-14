/**
 * pdf-export-client.js
 *
 * Frontend-only PDF export using pdf-lib.
 * All annotations (AI + manual) are taken directly from Fabric.js canvas data
 * (pageCanvasData) — no backend predictions format needed.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

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

function contrastColor(hex) {
    if (!hex || typeof hex !== 'string') return rgb(1, 1, 1);
    const match = hex.match(/^#?([0-9a-f]{6})/i);
    if (!match) return rgb(1, 1, 1);
    const c = match[1];
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55
        ? rgb(0.13, 0.13, 0.13)
        : rgb(1, 1, 1);
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

    if (t === 'rect') {
        return {
            kind: 'rect',
            x1: ann.left,
            y1: ann.top,
            x2: ann.left + ann.width  * sx,
            y2: ann.top  + ann.height * sy,
        };
    }

    if (t === 'polygon' || t === 'polyline') {
        const pts = ann.points || [];
        const xs  = pts.map(p => p.x);
        const ys  = pts.map(p => p.y);
        // pathOffset = center of the points' bounding box (Fabric.js internal)
        const pox = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
        const poy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
        // Object center in canvas pixels
        const cx = ann.left + (ann.width  || 0) * sx / 2;
        const cy = ann.top  + (ann.height || 0) * sy / 2;
        const points = pts.map(p => ({
            x: cx + (p.x - pox) * sx,
            y: cy + (p.y - poy) * sy,
        }));
        return { kind: t, points };
    }

    return null;
}

/**
 * Draw all annotations from canvas data onto a pdf-lib page.
 * sx = pdfPageWidth  / imageNaturalWidth
 * sy = pdfPageHeight / imageNaturalHeight
 */
function drawAnnotationsOnPage(page, canvasAnnotations, canvasTextLabels, sx, sy, labelMap, font) {
    const pH = page.getHeight();
    let drawn = 0;

    // Pass 1: draw annotation shapes
    for (const ann of canvasAnnotations) {
        if (ann.objectType !== 'annotation') continue;

        const labelId  = ann.labelId ?? ann.objectLabel ?? 0;
        const colorHex = labelMap[labelId]?.color || '#888888';
        const color    = hexToRgb(colorHex);
        const strokeW  = Math.max(0.5, (ann.strokeWidth || 2) * Math.min(sx, sy));

        const coords = fabricToAbsolute(ann);
        if (!coords) continue;

        if (coords.kind === 'rect') {
            const x = coords.x1 * sx;
            const y = pH - coords.y2 * sy;
            const w = (coords.x2 - coords.x1) * sx;
            const h = (coords.y2 - coords.y1) * sy;
            if (w > 0 && h > 0) {
                page.drawRectangle({ x, y, width: w, height: h,
                    borderColor: color, borderWidth: strokeW, borderOpacity: 1,
                    color, opacity: 0.10 });
                drawn++;
            }

        } else if (coords.kind === 'polygon' && coords.points.length >= 3) {
            const pts  = coords.points;
            const path = `M ${pts[0].x * sx} ${pts[0].y * sy} ` +
                pts.slice(1).map(p => `L ${p.x * sx} ${p.y * sy}`).join(' ') + ' Z';
            page.drawSvgPath(path, { x: 0, y: pH,
                borderColor: color, borderWidth: strokeW, borderOpacity: 1,
                color, opacity: 0.10 });
            drawn++;

        } else if (coords.kind === 'polyline' && coords.points.length >= 2) {
            const pts = coords.points;
            for (let i = 0; i < pts.length - 1; i++) {
                page.drawLine({
                    start: { x: pts[i].x   * sx, y: pH - pts[i].y   * sy },
                    end:   { x: pts[i+1].x * sx, y: pH - pts[i+1].y * sy },
                    color, thickness: strokeW,
                });
            }
            drawn++;
        }
    }

    // Pass 2: draw text labels using saved canvas positions (originX/Y: 'center')
    if (font && canvasTextLabels?.length) {
        for (const tl of canvasTextLabels) {
            if (!tl.text) continue;

            const bgHex     = tl.backgroundColor || '#888888';
            const bgColor   = hexToRgb(bgHex);
            const textColor = contrastColor(bgHex);

            const lines    = tl.text.split('\n');
            const fontSize = 8;
            const lineH    = fontSize + 2;
            const textH    = lines.length * lineH;
            const textW    = Math.max(...lines.map(l => font.widthOfTextAtSize(l, fontSize)));

            // tl.left/top is the center of the badge (originX/Y: 'center')
            const cx = tl.left * sx;
            const cy = pH - tl.top * sy;

            page.drawRectangle({
                x: cx - textW / 2 - 3, y: cy - textH / 2 - 2,
                width: textW + 6, height: textH + 4,
                color: bgColor, opacity: 0.9,
            });

            lines.forEach((line, i) => {
                const lineW = font.widthOfTextAtSize(line, fontSize);
                page.drawText(line, {
                    x: cx - lineW / 2,
                    y: cy + textH / 2 - (i + 1) * lineH + 2,
                    size: fontSize, font, color: textColor,
                });
            });
        }
    }

    return drawn;
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

// ── Plan erstellen (annotated PDF) ────────────────────────────────────────────

function insertLegendPage(pdfDoc, labels, usedIds, projectName, font, fontB, dateStr) {
    const W = 595, H = 842, M = 50, INNER = W - 2 * M;
    const legendPage = pdfDoc.insertPage(0, [W, H]);
    let y = H - M;

    // Title
    legendPage.drawText(projectName || 'Planvision', {
        x: M, y, size: 16, font: fontB, color: rgb(0, 0, 0),
    });
    y -= 20;
    legendPage.drawText(`Legende  |  ${dateStr}`, {
        x: M, y, size: 9, font, color: rgb(0.4, 0.4, 0.4),
    });
    y -= 14;
    legendPage.drawLine({
        start: { x: M, y }, end: { x: W - M, y },
        color: rgb(0.8, 0.8, 0.8), thickness: 0.5,
    });
    y -= 24;

    // Filter to used labels (or all if nothing used)
    const visibleLabels = labels.filter(l => usedIds.size === 0 || usedIds.has(l.id));
    if (visibleLabels.length === 0) {
        legendPage.drawText('Keine Labels definiert.', {
            x: M, y, size: 9, font, color: rgb(0.5, 0.5, 0.5),
        });
        return;
    }

    // Two-column layout
    const COL_W = INNER / 2;
    const ROW_H = 22;
    const SWATCH = 14;

    visibleLabels.forEach((label, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x   = M + col * COL_W;
        const rowY = y - row * ROW_H;

        if (rowY < M + ROW_H) return; // page overflow guard

        const color = hexToRgb(label.color || '#888888');

        // Color swatch
        legendPage.drawRectangle({
            x, y: rowY - SWATCH,
            width: SWATCH, height: SWATCH,
            color, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5,
        });

        // Label name
        const name = (label.name || `Label ${label.id}`).slice(0, 40);
        legendPage.drawText(name, {
            x: x + SWATCH + 6, y: rowY - SWATCH + 3,
            size: 10, font, color: rgb(0, 0, 0),
        });
    });
}

export async function exportAnnotatedPdfClient({ pdfBlob, pageImageUrls, pageCanvasData, labels, projectName }) {
    const labelMap = Object.fromEntries((labels || []).map(l => [l.id, l]));

    console.log('[PDF export] pdfBlob:', pdfBlob ? `${pdfBlob.size} bytes` : 'null');
    console.log('[PDF export] pageImageUrls:', pageImageUrls);
    console.log('[PDF export] pageCanvasData keys:', Object.keys(pageCanvasData));
    for (const [k, v] of Object.entries(pageCanvasData)) {
        console.log(`  page ${k}: ${v?.canvas_annotations?.length ?? 0} annotations`);
    }

    let pdfDoc;
    let labelFont;

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

    labelFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const labelFontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const dateStr = new Date().toLocaleDateString('de-DE');

    // Collect label IDs actually used across all pages
    const usedIds = new Set();
    for (const data of Object.values(pageCanvasData)) {
        for (const ann of (data?.canvas_annotations || [])) {
            if (ann.objectType === 'annotation') usedIds.add(ann.labelId ?? ann.objectLabel ?? 0);
        }
    }

    insertLegendPage(pdfDoc, labels || [], usedIds, projectName, labelFont, labelFontB, dateStr);

    const pdfPages = pdfDoc.getPages();
    console.log('[PDF export] PDF pages:', pdfPages.length);

    // Start from page index 1 — index 0 is the legend page
    for (let i = 1; i < pdfPages.length; i++) {
        const pageNum     = i; // original page 1 is now at index 1
        const canvasData  = pageCanvasData[pageNum] || pageCanvasData[String(pageNum)];
        const annotations = canvasData?.canvas_annotations || [];

        console.log(`[PDF export] page ${pageNum}: ${annotations.length} canvas annotations`);
        if (!annotations.length) continue;

        const page = pdfPages[i];
        const { width: pdfW, height: pdfH } = page.getSize();

        const imgDim = pageImageUrls[i] ? await loadImgDimensions(pageImageUrls[i]) : null;
        const imgW   = imgDim?.w || pdfW;
        const imgH   = imgDim?.h || pdfH;
        const sx = pdfW / imgW;
        const sy = pdfH / imgH;

        console.log(`[PDF export] page ${pageNum}: pdfSize=${pdfW}x${pdfH}, imgSize=${imgW}x${imgH}, scale=${sx.toFixed(3)}x${sy.toFixed(3)}`);

        const textLabels = canvasData?.canvas_text_labels || [];
        const n = drawAnnotationsOnPage(page, annotations, textLabels, sx, sy, labelMap, labelFont);
        console.log(`[PDF export] page ${pageNum}: drew ${n} annotations`);
    }

    triggerDownload(await pdfDoc.save(), 'annotierter-plan.pdf');
}

// ── Bericht erstellen (report PDF) ───────────────────────────────────────────

export async function exportReportPdfClient({ pageImageUrls, pageCanvasData, labels, projectName }) {
    const labelMap = Object.fromEntries((labels || []).map(l => [l.id, l]));
    const A4_W = 595, A4_H = 842;
    const MARGIN = 40;
    const INNER_W = A4_W - 2 * MARGIN;

    console.log('[Report export] pages:', pageImageUrls.length, 'labels:', labels?.length);

    const pdfDoc = await PDFDocument.create();
    const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const dateStr = new Date().toLocaleDateString('de-DE');

    for (let i = 0; i < pageImageUrls.length; i++) {
        const pageNum    = i + 1;
        const canvasData = pageCanvasData[pageNum] || pageCanvasData[String(pageNum)];
        const annotations = (canvasData?.canvas_annotations || [])
            .filter(a => a.objectType === 'annotation');

        console.log(`[Report export] page ${pageNum}: ${annotations.length} annotations`);

        const page = pdfDoc.addPage([A4_W, A4_H]);
        let curY = A4_H - MARGIN;

        // Header
        page.drawText(projectName || 'Planvision', {
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
                    const color    = hexToRgb(labelMap[labelId]?.color || '#888888');
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
                                color, opacity: 0.10,
                            });
                        }
                    } else if (coords.kind === 'polygon' && coords.points.length >= 3) {
                        const pts  = coords.points;
                        const path = `M ${pts[0].x * sx} ${pts[0].y * sy} ` +
                            pts.slice(1).map(p => `L ${p.x * sx} ${p.y * sy}`).join(' ') + ' Z';
                        page.drawSvgPath(path, {
                            x: thumbX, y: thumbY + thumbH,
                            borderColor: color, borderWidth: strokeW, borderOpacity: 1,
                            color, opacity: 0.10,
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
            page.drawText('Keine Annotationen auf dieser Seite.', {
                x: MARGIN, y: curY - 14, size: 9, font, color: rgb(0.5, 0.5, 0.5)
            });
        }
    }

    triggerDownload(await pdfDoc.save(), 'planvision-bericht.pdf');
}
