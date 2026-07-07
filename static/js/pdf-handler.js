/**
 * pdf-handler.js - PDF session and page state management
 */

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
export function getPdfSessionId() { return pdfSessionId; }
export function getPdfPageData()  { return pdfPageData; }
export function getPageSettings() { return pageSettings; }
export function getAllPdfPages()   { return allPdfPages; }

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

// Getters
export function getOriginalPdfBlob() { return originalPdfBlob; }
