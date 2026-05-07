/**
 * pdf-handler.js - PDF session and page state management
 */

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
