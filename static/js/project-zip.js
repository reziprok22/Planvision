/**
 * project-zip.js – ZIP-based project save / load
 *
 * ZIP structure:
 *   metadata.json      – project name, page count, format version
 *   canvas_data.json   – all-page canvas annotations, keyed by pageId, plus
 *                        page_manifest (ordered [{id, sourcePdfIndex,
 *                        sourcePageIndex, width_mm, height_mm}] — see
 *                        CLAUDE.md "Seiten-Management")
 *   labels.json        – unified label definitions
 *   settings.json      – per-page analysis settings, keyed by pageId
 *   pages/
 *     page_1.jpg
 *     page_2.jpg
 *     …               (positional — display order at save time)
 *   sources/
 *     1.pdf            (the original upload)
 *     2.pdf            (a PDF appended via "Seiten anhängen"), …
 */

import JSZip from 'jszip';
import { sanitizeFileBase } from './pdf-handler.js';

// ── Format versioning ─────────────────────────────────────────────────────────
// Increment CURRENT_VERSION whenever the ZIP schema changes, and add a
// migration step in migrateCanvasData() below.
//
// Version history:
//   1 – Basisformat: canvas_data.json (multi-page annotations inkl.
//       canvas_text_labels und id/labelText, canvas_dimensions und
//       canvas_text_notes pro Seite), labels.json, settings.json, pages/,
//       optional original.pdf sowie legend_position pro Seite.
//   2 – Seiten-Management (Duplizieren/Löschen/Reihenfolge): canvas_data.json
//       bekommt page_manifest — eine geordnete Liste [{id, sourcePageIndex,
//       width_mm, height_mm}], die die Anzeigereihenfolge sowie die Zuordnung
//       jeder Seite zur Original-PDF-Seite (für Analyse + PDF-Export) trägt.
//       `pages` (canvas_data.json) und settings.json sind ab jetzt per
//       stabiler pageId statt Seitenzahl geschlüsselt. `pages/page_N.jpg`
//       bleibt weiterhin positionsbasiert (Anzeigereihenfolge zum Speicherzeitpunkt) —
//       Duplikate landen als eigene page_N.jpg, auch wenn sie dieselbe
//       Original-PDF-Seite referenzieren.
//   3 – Seiten-Management "Anhängen": mehrere Quell-PDFs pro Projekt möglich.
//       page_manifest-Einträge bekommen sourcePdfIndex (welches der mehreren
//       Quell-PDFs); `original.pdf` wird zu `sources/<index>.pdf` (1 = die
//       ursprüngliche Datei). Der PDF-Export kopiert Seiten pro Eintrag aus
//       der jeweils passenden Quelle (pdf-lib copyPages).
//
const CURRENT_VERSION = 3;

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

  if (fromVersion < 2) {
    // v1 had no page manifest — page identity WAS the page number, and
    // `pages`/settings.json were keyed by that same number. Reusing those
    // number strings as pageIds means `pages` needs no remapping at all;
    // we only need to synthesize the ordered manifest itself. width_mm/
    // height_mm are backfilled from settings.json by the caller (project.js),
    // which still has the per-page format values at load time.
    const total = canvasData.total_pages || Object.keys(canvasData.pages || {}).length;
    canvasData.page_manifest = Array.from({ length: total }, (_, i) => ({
      id: String(i + 1),
      sourcePageIndex: i + 1,
      width_mm: null,
      height_mm: null,
    }));
    canvasData.current_page_id = canvasData.page_manifest[0]?.id ?? null;
  }

  if (fromVersion < 3) {
    // v1/v2 only ever had a single source PDF ("original.pdf", loaded by the
    // caller as sources[1] — see loadProjectFromZip). Every existing entry
    // belongs to it.
    for (const entry of canvasData.page_manifest || []) {
      entry.sourcePdfIndex = 1;
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
 * @param {Object}   p.sourcePdfBlobs   – { <sourcePdfIndex>: Blob } — every uploaded/appended PDF (optional)
 * @param {Function} p.onProgress       – optional (percent: number) => void
 */
export async function buildProjectZipBlob({ projectName, canvasData, labels, settings, pageImageUrls, sourcePdfBlobs, onProgress }) {
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

  // Include every source PDF so the server session can be re-established on
  // load and the PDF export can copy vector pages from each of them.
  const sourcesFolder = zip.folder('sources');
  for (const [sourcePdfIndex, blob] of Object.entries(sourcePdfBlobs || {})) {
    if (blob) sourcesFolder.file(`${sourcePdfIndex}.pdf`, blob);
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
  // .planli = ein Planli-Projekt (intern ein ZIP). Eigene Endung, damit Nutzer
  // es nicht für ein zu entpackendes Archiv halten – wird über "Projekt öffnen"
  // wieder geladen (loadProjectFromZip akzeptiert weiterhin alte .zip-Dateien).
  a.download = `${sanitizeFileBase(params.projectName, 'planli')}.planli`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Load a project from a ZIP file.
 * Returns { metadata, canvasData, labels, settings, imageUrls, sourcePdfBlobs }
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

  // Extract every source PDF for server session re-establishment + export.
  // v3+ stores one file per source under sources/<index>.pdf; v1/v2 only ever
  // had a single "original.pdf", which becomes source 1.
  const sourcePdfBlobs = {};
  if (version >= 3) {
    for (const name of Object.keys(zip.files)) {
      const m = name.match(/^sources\/(\d+)\.pdf$/);
      if (m) sourcePdfBlobs[parseInt(m[1], 10)] = await zip.file(name).async('blob');
    }
  } else {
    const legacyPdf = zip.file('original.pdf');
    if (legacyPdf) sourcePdfBlobs[1] = await legacyPdf.async('blob');
  }

  return { metadata, canvasData, labels, settings, imageUrls, sourcePdfBlobs };
}
