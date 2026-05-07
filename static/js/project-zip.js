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

const FORMAT = 'planvision_zip_v1';

/**
 * Download the current project as a ZIP file.
 * @param {Object} p
 * @param {string}   p.projectName
 * @param {Object}   p.canvasData       – output of collectAllPagesCanvasData()
 * @param {Array}    p.labels           – output of getAllLabels()
 * @param {Object}   p.settings         – output of getPageSettings()
 * @param {string[]} p.pageImageUrls    – URL array from getAllPdfPages()
 * @param {Blob}     p.originalPdfBlob  – the original PDF file (optional)
 * @param {Object}   p.analysisData     – raw AI predictions per page { "1": [...], "2": [...] }
 * @param {Function} p.onProgress       – optional (percent: number) => void
 */
export async function saveProjectAsZip({ projectName, canvasData, labels, settings, pageImageUrls, originalPdfBlob, analysisData, onProgress }) {
  const zip = new JSZip();

  zip.file('metadata.json', JSON.stringify({
    project_name: projectName,
    page_count:   pageImageUrls.length,
    saved_at:     new Date().toISOString(),
    format:       FORMAT
  }, null, 2));

  zip.file('canvas_data.json', JSON.stringify(canvasData, null, 2));
  zip.file('labels.json',      JSON.stringify(labels,     null, 2));
  zip.file('settings.json',    JSON.stringify(settings,   null, 2));

  // Include original PDF so server session can be re-established on load
  if (originalPdfBlob) {
    zip.file('original.pdf', originalPdfBlob);
  }

  // Include raw AI predictions so PDF reports work after re-import
  if (analysisData && Object.keys(analysisData).length > 0) {
    const analysisFolder = zip.folder('analysis');
    for (const [pageNum, predictions] of Object.entries(analysisData)) {
      analysisFolder.file(`page_${pageNum}.json`, JSON.stringify(predictions, null, 2));
    }
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

  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    ({ percent }) => { if (onProgress) onProgress(75 + Math.round(percent * 0.25)); }
  );

  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = `${projectName || 'planvision'}.zip`;
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

  const canvasData = await readJson('canvas_data.json');
  if (!canvasData) throw new Error('Ungültige ZIP-Datei: canvas_data.json fehlt.');

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

  // Extract per-page analysis data for PDF report generation
  const analysisData = {};
  for (let i = 1; i <= metadata.page_count; i++) {
    const af = zip.file(`analysis/page_${i}.json`);
    if (af) {
      try {
        analysisData[String(i)] = JSON.parse(await af.async('string'));
      } catch (e) {
        console.warn(`ZIP: could not parse analysis/page_${i}.json`, e);
      }
    }
  }

  return { metadata, canvasData, labels, settings, imageUrls, pdfBlob, analysisData };
}
