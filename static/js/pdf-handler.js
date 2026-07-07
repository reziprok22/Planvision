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
let currentPdfPage = 1;
let totalPdfPages = 1;
let allPdfPages = [];
let pdfPageData = {};
let pageSettings = {};
let originalPdfBlob = null;

export function resetPdfState() {
  pdfSessionId = null;
  currentPdfPage = 1;
  totalPdfPages = 1;
  allPdfPages = [];
  pdfPageData = {};
  pageSettings = {};
  originalPdfBlob = null;
}

// Getters
export function getPdfSessionId()    { return pdfSessionId; }
export function getPdfPageData()     { return pdfPageData; }
export function getPageSettings()    { return pageSettings; }
export function getAllPdfPages()     { return allPdfPages; }
export function getOriginalPdfBlob() { return originalPdfBlob; }

// Setters
export function setPdfSessionId(sessionId)          { pdfSessionId = sessionId; }
export function setPdfPageData(data)                { pdfPageData = data; }
export function setPageSettings(settings)           { pageSettings = settings; }
export function setOriginalPdfBlob(blob)            { originalPdfBlob = blob; }
export function setPdfNavigationState(currentPage, totalPages, allPages) {
  currentPdfPage = currentPage;
  totalPdfPages  = totalPages;
  allPdfPages    = allPages;
}
