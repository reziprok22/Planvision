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
//   1 – original format (metadata.format = 'project_zip_v1', no numeric version)
//       canvas_annotations only; no canvas_text_labels; no id/labelText on annotations
//   2 – canvas_text_labels per page added; id + labelText serialised on annotations
//   3 – legend_position per page added (optional; null when no on-plan legend placed)
//
// Note: the optional analysis/page_N.json (raw AI predictions) is no longer
// written – it was a write-only round-trip, fully superseded by the scored
// annotations in canvas_data.json. Old files that still contain it load fine
// (the folder is simply ignored). No version bump needed (absence-tolerant).
//
const CURRENT_VERSION = 3;

// ── Migration layer ───────────────────────────────────────────────────────────

/**
 * Detect the numeric format version from a loaded metadata object.
 * Old ZIPs used a string 'project_zip_v1' instead of a number.
 */
function detectVersion(metadata) {
  if (typeof metadata.format_version === 'number') return metadata.format_version;
  // Legacy: string format field means version 1
  if (metadata.format === 'project_zip_v1') return 1;
  return 1; // safe default for unknown old files
}

/**
 * Apply all necessary migrations to bring canvasData up to CURRENT_VERSION.
 * Each "if (v < N)" block is idempotent — safe to run multiple times.
 */
function migrateCanvasData(canvasData, fromVersion) {
  if (fromVersion >= CURRENT_VERSION) return canvasData;

  console.log(`[ZIP migration] upgrading from v${fromVersion} to v${CURRENT_VERSION}`);
  // canvasData is the multi_page_canvas_v1 wrapper:
  // { format, total_pages, pages: { "1": {...}, ... }, current_page, saved_at }
  // Migrations operate on the per-page entries inside .pages.
  let data = { ...canvasData };

  // ── v1 → v2 ────────────────────────────────────────────────────────────────
  // canvas_text_labels did not exist. The loader already handles this via the
  // createSingleTextLabel fallback, so no data transform is needed here.
  // We do ensure every annotation has a stable displayIndex so the fallback
  // can assign correct numbers.
  if (fromVersion < 2) {
    data.pages = Object.fromEntries(
      Object.entries(data.pages || {}).map(([pageNum, pageData]) => {
        if (!pageData?.canvas_annotations) return [pageNum, pageData];

        let nextIndex = 1;
        const patched = pageData.canvas_annotations.map(ann => {
          if (ann.objectType !== 'annotation') return ann;
          if (ann.displayIndex) {
            nextIndex = Math.max(nextIndex, ann.displayIndex + 1);
            return ann;
          }
          return { ...ann, displayIndex: nextIndex++ };
        });

        return [pageNum, { ...pageData, canvas_annotations: patched }];
      })
    );
    console.log('[ZIP migration] v1→v2: displayIndex assigned where missing');
  }

  // ── v2 → v3 ────────────────────────────────────────────────────────────────
  // legend_position is a new OPTIONAL per-page field; older files simply lack
  // it (= no legend placed), so no data transform is needed.

  // ── v3 → v4 (placeholder) ──────────────────────────────────────────────────
  // if (fromVersion < 4) { ... }

  return data;
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
  if (version !== CURRENT_VERSION) {
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
