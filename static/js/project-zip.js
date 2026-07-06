/**
 * project-zip.js – ZIP-based project save / load
 *
 * ZIP structure:
 *   metadata.json      – project name, page count, format version
 *   canvas_data.json   – all-page canvas annotations (multi_page_canvas_v1)
 *   labels.json        – unified label definitions
 *   settings.json      – per-page analysis settings
 *   pages/
 *     page_1.jpg
 *     page_2.jpg
 *     …
 */

import JSZip from 'jszip';

// ── Format versioning ─────────────────────────────────────────────────────────
// Increment CURRENT_VERSION whenever the ZIP schema changes, and add a
// migration step in migrateCanvasData() below.
//
// Version history:
//   1 – Basisformat: canvas_data.json (multi-page annotations inkl.
//       canvas_text_labels und id/labelText), labels.json, settings.json,
//       pages/, optional original.pdf sowie legend_position pro Seite.
//   2 – zusätzlich canvas_dimensions pro Seite: CAD-Bemaßungs-Hilfen (eigener
//       objectType 'dimension', keine Annotationen). v1-ZIPs erhalten beim Laden
//       ein leeres Array (siehe migrateCanvasData).
//
const CURRENT_VERSION = 2;

// ── Migration layer ───────────────────────────────────────────────────────────

/**
 * Detect the numeric format version from a loaded metadata object.
 */
function detectVersion(metadata) {
  return typeof metadata.format_version === 'number' ? metadata.format_version : 1;
}

/**
 * Apply all necessary migrations to bring canvasData up to CURRENT_VERSION.
 * Add "if (fromVersion < N) { … }" blocks here when the schema changes —
 * see CLAUDE.md, "ZIP Format Versioning". Migrations run sequentially.
 */
function migrateCanvasData(canvasData, fromVersion) {
  if (fromVersion >= CURRENT_VERSION) return canvasData;

  // v1 → v2: ensure every page carries a canvas_dimensions array. loadCanvasData
  // already tolerates a missing one, so this is defensive/normalising only.
  if (fromVersion < 2) {
    const pages = canvasData?.pages;
    if (pages && typeof pages === 'object') {
      for (const key of Object.keys(pages)) {
        if (pages[key] && !Array.isArray(pages[key].canvas_dimensions)) {
          pages[key].canvas_dimensions = [];
        }
      }
    }
  }

  return canvasData;
}

/**
 * Build the project ZIP as a Blob (shared by "save as file" and bug reports).
 * @param {Object} p
 * @param {string}   p.projectName
 * @param {Object}   p.canvasData       – output of collectAllPagesCanvasData()
 * @param {Array}    p.labels           – output of getAllLabels()
 * @param {Object}   p.settings         – output of getPageSettings()
 * @param {string[]} p.pageImageUrls    – URL array from getAllPdfPages()
 * @param {Blob}     p.originalPdfBlob  – the original PDF file (optional)
 * @param {Function} p.onProgress       – optional (percent: number) => void
 */
export async function buildProjectZipBlob({ projectName, canvasData, labels, settings, pageImageUrls, originalPdfBlob, onProgress }) {
  const zip = new JSZip();

  zip.file('metadata.json', JSON.stringify({
    project_name:   projectName,
    page_count:     pageImageUrls.length,
    saved_at:       new Date().toISOString(),
    format_version: CURRENT_VERSION,
  }, null, 2));

  zip.file('canvas_data.json', JSON.stringify(canvasData, null, 2));
  zip.file('labels.json',      JSON.stringify(labels,     null, 2));
  zip.file('settings.json',    JSON.stringify(settings,   null, 2));

  // Include original PDF so server session can be re-established on load
  if (originalPdfBlob) {
    zip.file('original.pdf', originalPdfBlob);
  }

  const pagesFolder = zip.folder('pages');
  for (let i = 0; i < pageImageUrls.length; i++) {
    if (onProgress) onProgress(Math.round((i / pageImageUrls.length) * 75));
    try {
      const res  = await fetch(pageImageUrls[i]);
      const blob = await res.blob();
      pagesFolder.file(`page_${i + 1}.jpg`, blob);
    } catch (e) {
      console.warn(`ZIP: could not fetch page ${i + 1}:`, e);
    }
  }

  return zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    ({ percent }) => { if (onProgress) onProgress(75 + Math.round(percent * 0.25)); }
  );
}

/**
 * Download the current project as a ZIP file (params: see buildProjectZipBlob).
 */
export async function saveProjectAsZip(params) {
  const blob = await buildProjectZipBlob(params);

  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  // .plan = ein OnlyPlans-Projekt (intern ein ZIP). Eigene Endung, damit Nutzer
  // es nicht für ein zu entpackendes Archiv halten – wird über "Projekt öffnen"
  // wieder geladen (loadProjectFromZip akzeptiert weiterhin alte .zip-Dateien).
  const safeBase = (params.projectName || 'planli').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'planli';
  a.download = `${safeBase}.plan`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Load a project from a ZIP file.
 * Returns { metadata, canvasData, labels, settings, imageUrls }
 * imageUrls are blob: URLs – caller is responsible for revoking them when done.
 */
export async function loadProjectFromZip(file) {
  const zip = await JSZip.loadAsync(file);

  const readJson = async (name) => {
    const f = zip.file(name);
    if (!f) return null;
    return JSON.parse(await f.async('string'));
  };

  const metadata   = await readJson('metadata.json');
  if (!metadata) throw new Error('Ungültige ZIP-Datei: metadata.json fehlt.');

  const version = detectVersion(metadata);
  if (version < CURRENT_VERSION) {
    console.log(`[ZIP] Format v${version} erkannt (aktuell: v${CURRENT_VERSION}) – Migration wird ausgeführt`);
  }

  let canvasData = await readJson('canvas_data.json');
  if (!canvasData) throw new Error('Ungültige ZIP-Datei: canvas_data.json fehlt.');

  canvasData = migrateCanvasData(canvasData, version);

  const labels   = (await readJson('labels.json'))   || [];
  const settings = (await readJson('settings.json')) || {};

  const imageUrls = [];
  for (let i = 1; i <= metadata.page_count; i++) {
    const imgFile = zip.file(`pages/page_${i}.jpg`);
    if (imgFile) {
      const blob = await imgFile.async('blob');
      imageUrls.push(URL.createObjectURL(blob));
    }
  }
  if (imageUrls.length === 0) throw new Error('ZIP enthält keine Seiten-Bilder.');

  // Extract original PDF for server session re-establishment
  let pdfBlob = null;
  const pdfFile = zip.file('original.pdf');
  if (pdfFile) pdfBlob = await pdfFile.async('blob');

  return { metadata, canvasData, labels, settings, imageUrls, pdfBlob };
}
