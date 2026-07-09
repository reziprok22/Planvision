/**
 * pdf-handler.js - PDF session and page state management
 */

// Shared CSRF helper (Django setzt das Cookie via @ensure_csrf_cookie auf der App-View)
export function getCsrfToken() {
  return document.cookie.split(';').map(c => c.trim())
    .find(c => c.startsWith('csrftoken='))?.split('=')[1] ?? '';
}

// Wahrgenommene Helligkeit (sRGB-Koeffizienten) — gemeinsame Basis für die
// Kontrastfarbe von Label-Badges auf Canvas (main.js) und im PDF-Export.
export function isLightColor(hex) {
  const m = typeof hex === 'string' ? hex.match(/^#?([0-9a-f]{6})/i) : null;
  if (!m) return false;
  const c = m[1];
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
}

// Dateinamen-Basis ohne in Dateinamen verbotene Zeichen (Projekt-ZIP + PDF-Exporte)
export function sanitizeFileBase(name, fallback) {
  return (name || '').replace(/[\\/:*?"<>|]+/g, '_').trim() || fallback;
}

// ── Automatische Textskalierung ───────────────────────────────────────────────
// Alle Canvas-Textgrössen (Labels, Legende, Bemassung, Textfelder) sind Bild-px-
// Werte, abgestimmt auf A4 (~1240 px Kurzseite beim fixen 150-DPI-Server-Render).
// Grössere Formate skalieren mit, damit Text bei "Seite einpassen" lesbar bleibt;
// A4 und kleiner behalten Faktor 1. Gedämpft (Exponent 0.6 statt linear), weil
// grosse Pläne meist auch kleinteiliger gezeichnet sind — linear wirkte der Text
// dort zu wuchtig im Verhältnis zu den Objekten (A3 ≈ 1.2×, A0 ≈ 2.3×). Der
// PDF-Export nutzt denselben Faktor, damit Canvas und Export identisch aussehen.
export function autoFontScale(imgWidth, imgHeight) {
  const shortSide = Math.min(imgWidth || 0, imgHeight || 0);
  if (!shortSide) return 1;
  return Math.min(Math.max(Math.pow(shortSide / 1240, 0.6), 1), 5);
}

let pdfSessionId = null;
let sourcePdfBlobs = {}; // { <sourcePdfIndex>: Blob } — the uploaded PDF(s), 1 = original upload
let pageSettings = {}; // keyed by pageId (see pageManifest)
let currentPageId = null;
let pageIdSeq = 0;

// Ordered list of page entries — this IS the page order shown in the app,
// exported to PDF, and saved to ZIP. `sourcePdfIndex`/`sourcePageIndex`
// address the ORIGINAL uploaded PDF this page came from and its page number
// within it (server-rendered as uploads/page_<sourcePdfIndex>_<sourcePageIndex>.jpg,
// see core/views.py _convert_pdf_to_images) — both stay fixed per entry even
// when the entry is duplicated, deleted, or reordered, so AI analysis and PDF
// export always fetch the right source page. `id` is the stable identity used
// everywhere else (pageCanvasData, pageSettings) — see CLAUDE.md "Seiten-Management".
let pageManifest = []; // [{ id, imageUrl, sourcePdfIndex, sourcePageIndex, width_mm, height_mm }]

export function resetPdfState() {
  pdfSessionId = null;
  sourcePdfBlobs = {};
  pageSettings = {};
  currentPageId = null;
  pageIdSeq = 0;
  pageManifest = [];
}

function nextPageId() { return String(++pageIdSeq); }

// Getters
export function getPdfSessionId()    { return pdfSessionId; }
export function getPageSettings()    { return pageSettings; }
export function getPageManifest()    { return pageManifest; }
export function getCurrentPageId()   { return currentPageId; }
export function getSourcePdfBlob(sourcePdfIndex)  { return sourcePdfBlobs[sourcePdfIndex] || null; }
export function getAllSourcePdfBlobs()            { return { ...sourcePdfBlobs }; }

// Ordered array of image URLs (position-based) — bridge for consumers that
// only care about display order (ZIP save, PDF export, sidebar rendering).
export function getAllPdfPages() { return pageManifest.map(e => e.imageUrl); }

export function getPageEntry(id)      { return pageManifest.find(e => e.id === id) || null; }
export function getPageIndexById(id)  { return pageManifest.findIndex(e => e.id === id) + 1; } // 1-based, 0 = not found
export function getPageIdAtIndex(pos) { return pageManifest[pos - 1]?.id ?? null; }            // 1-based

// Setters
export function setPdfSessionId(sessionId) { pdfSessionId = sessionId; }
export function setPageSettings(settings)  { pageSettings = settings; }
export function setCurrentPageId(id)       { currentPageId = id; }
export function setSourcePdfBlob(sourcePdfIndex, blob) { sourcePdfBlobs[sourcePdfIndex] = blob; }
export function setAllSourcePdfBlobs(blobs)            { sourcePdfBlobs = { ...blobs }; }

/**
 * Build a fresh manifest after a new upload (all pages share source PDF 1,
 * sourcePageIndex === original position). Replaces any previous project.
 */
export function initPageManifestFromUpload(imageUrls, pageSizes, sourcePdfIndex = 1) {
  pageManifest = (imageUrls || []).map((url, i) => ({
    id: nextPageId(),
    imageUrl: url,
    sourcePdfIndex,
    sourcePageIndex: i + 1,
    width_mm:  pageSizes?.[i]?.width_mm  ?? null,
    height_mm: pageSizes?.[i]?.height_mm ?? null,
  }));
  currentPageId = pageManifest[0]?.id ?? null;
  return pageManifest;
}

/**
 * Append pages from an additionally uploaded PDF (Seiten-Management "Anhängen")
 * to the end of the manifest. Returns the new entries.
 */
export function appendPagesToManifest(imageUrls, pageSizes, sourcePdfIndex) {
  const newEntries = (imageUrls || []).map((url, i) => ({
    id: nextPageId(),
    imageUrl: url,
    sourcePdfIndex,
    sourcePageIndex: i + 1,
    width_mm:  pageSizes?.[i]?.width_mm  ?? null,
    height_mm: pageSizes?.[i]?.height_mm ?? null,
  }));
  pageManifest.push(...newEntries);
  return newEntries;
}

/**
 * Restore a manifest loaded from a ZIP (already has ids/sourcePdfIndex/sourcePageIndex).
 * Keeps the id counter ahead of any loaded ids so new duplicates never collide.
 */
export function setPageManifest(entries) {
  pageManifest = entries || [];
  const maxId = pageManifest.reduce((max, e) => Math.max(max, parseInt(e.id, 10) || 0), 0);
  pageIdSeq = Math.max(pageIdSeq, maxId);
  currentPageId = pageManifest[0]?.id ?? null;
  return pageManifest;
}

/**
 * Make sure a server session exists, re-establishing one from the stored
 * source PDFs if needed (e.g. a project loaded from ZIP was never analyzed
 * yet, so it has no live session). Re-uploads every source PDF in order —
 * source 1 via /upload, the rest via /upload_append — so uploads/page_<n>_<i>.jpg
 * exists again for every page in the manifest. Throws if nothing can be done.
 */
export async function ensureServerSession() {
  if (pdfSessionId) return pdfSessionId;

  const indices = Object.keys(sourcePdfBlobs).map(Number).sort((a, b) => a - b);
  if (!indices.length) {
    throw new Error('Dieses Projekt enthält kein Original-PDF. Bitte das PDF neu hochladen.');
  }

  for (const idx of indices) {
    const blob = sourcePdfBlobs[idx];
    const fd = new FormData();
    fd.append('file', new File([blob], 'document.pdf', { type: 'application/pdf' }));
    if (idx === indices[0]) {
      const res = await fetch('/upload', { method: 'POST', body: fd, headers: { 'X-CSRFToken': getCsrfToken() } });
      if (!res.ok) throw new Error('Das Projekt-PDF konnte nicht erneut hochgeladen werden.');
      const data = await res.json();
      pdfSessionId = data.session_id;
    } else {
      fd.append('session_id', pdfSessionId);
      const res = await fetch('/upload_append', { method: 'POST', body: fd, headers: { 'X-CSRFToken': getCsrfToken() } });
      if (!res.ok) throw new Error('Ein angehängtes PDF konnte nicht erneut hochgeladen werden.');
    }
  }
  return pdfSessionId;
}

// ── Page operations ───────────────────────────────────────────────────────────

/** Duplicate the entry with the given id right after itself. Returns the new entry. */
export function duplicatePageInManifest(id) {
  const idx = pageManifest.findIndex(e => e.id === id);
  if (idx === -1) return null;
  const newEntry = { ...pageManifest[idx], id: nextPageId() };
  pageManifest.splice(idx + 1, 0, newEntry);
  return newEntry;
}

/** Delete the entry with the given id. Refuses to delete the last remaining page. */
export function deletePageFromManifest(id) {
  if (pageManifest.length <= 1) return false;
  const idx = pageManifest.findIndex(e => e.id === id);
  if (idx === -1) return false;
  pageManifest.splice(idx, 1);
  delete pageSettings[id];
  return true;
}

/** Move the entry with the given id by one slot. direction: -1 = up, +1 = down. */
export function movePageInManifest(id, direction) {
  const idx = pageManifest.findIndex(e => e.id === id);
  if (idx === -1) return false;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= pageManifest.length) return false;
  const [entry] = pageManifest.splice(idx, 1);
  pageManifest.splice(newIdx, 0, entry);
  return true;
}
