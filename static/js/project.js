/**
 * project.js – Project management (ZIP save/load + PDF export)
 */

import { setCurrentLabels, getAllLabels } from './labels.js';
import { initSidebarFromProject }          from './upload-modal.js';
import { saveProjectAsZip, loadProjectFromZip } from './project-zip.js';

let saveProjectBtn, loadProjectBtn, exportPdfBtn, exportAnnotatedPdfBtn;
let zipFileInput;
let pdfModule;

export function setupProject(elements, modules) {
  saveProjectBtn        = elements.saveProjectBtn;
  loadProjectBtn        = elements.loadProjectBtn;
  exportPdfBtn          = elements.exportPdfBtn;
  exportAnnotatedPdfBtn = elements.exportAnnotatedPdfBtn;
  pdfModule             = modules.pdfModule;

  // Hidden file input for ZIP import
  zipFileInput          = document.createElement('input');
  zipFileInput.type     = 'file';
  zipFileInput.accept   = '.zip';
  zipFileInput.style.display = 'none';
  document.body.appendChild(zipFileInput);

  if (saveProjectBtn)        saveProjectBtn.addEventListener('click',        handleSave);
  if (loadProjectBtn)        loadProjectBtn.addEventListener('click',        () => zipFileInput.click());
  if (exportPdfBtn)          exportPdfBtn.addEventListener('click',          exportPdf);
  if (exportAnnotatedPdfBtn) exportAnnotatedPdfBtn.addEventListener('click', exportAnnotatedPdf);

  zipFileInput.addEventListener('change', () => {
    if (zipFileInput.files[0]) handleLoad(zipFileInput.files[0]);
    zipFileInput.value = '';
  });
}

// ── Save ─────────────────────────────────────────────────────────────────────

async function handleSave() {
  if (!pdfModule.getAllPdfPages().length) {
    alert('Bitte zuerst eine Datei hochladen.');
    return;
  }
  if (!window.collectAllPagesCanvasData) {
    alert('Interner Fehler: Canvas-Daten nicht verfügbar.');
    return;
  }

  const projectName = `Planvision ${new Date().toLocaleDateString('de-DE')}`;

  const status = showStatus('ZIP wird erstellt…');
  try {
    await saveProjectAsZip({
      projectName,
      canvasData:      window.collectAllPagesCanvasData(),
      labels:          getAllLabels(),
      settings:        pdfModule.getPageSettings(),
      pageImageUrls:   pdfModule.getAllPdfPages(),
      originalPdfBlob: pdfModule.getOriginalPdfBlob(),
      analysisData:    window.collectAllPagesAnalysisData ? window.collectAllPagesAnalysisData() : {},
      onProgress:      (pct) => { status.textContent = `ZIP wird erstellt… ${pct}%`; }
    });
    updateStatus(status, 'ZIP gespeichert ✓', 'success');
  } catch (err) {
    console.error('ZIP save error:', err);
    updateStatus(status, `Fehler: ${err.message}`, 'error');
  }
}

// ── Load ─────────────────────────────────────────────────────────────────────

async function handleLoad(file) {
  const loader = document.getElementById('loader');
  const status = showStatus('ZIP wird geladen…');
  if (loader) loader.style.display = 'block';

  try {
    const { metadata, canvasData, labels, settings, imageUrls, pdfBlob, analysisData } = await loadProjectFromZip(file);

    // Restore state
    if (window.initializePageCanvasData) window.initializePageCanvasData(canvasData);
    pdfModule.setPdfNavigationState(1, metadata.page_count, imageUrls);
    pdfModule.setPageSettings(settings);
    pdfModule.setPdfSessionId(null);

    if (labels.length > 0) setCurrentLabels(labels);

    // Re-establish server session so PDF export buttons work
    if (pdfBlob) {
      updateStatus(status, 'Server-Session wird wiederhergestellt…');
      try {
        const fd = new FormData();
        fd.append('file', new File([pdfBlob], 'project.pdf', { type: 'application/pdf' }));
        const res = await fetch('/upload', { method: 'POST', body: fd });
        if (res.ok) {
          const uploadData = await res.json();
          pdfModule.setPdfSessionId(uploadData.session_id);
          pdfModule.setOriginalPdfBlob(pdfBlob);

          // Restore analysis results on server so PDF reports have data
          if (Object.keys(analysisData).length > 0) {
            await fetch(`/restore_analysis/${uploadData.session_id}`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({
                analysis: analysisData,
                labels:   labels,
                settings: settings,
                metadata: {
                  project_name: metadata.project_name,
                  page_count:   metadata.page_count,
                  created_at:   metadata.saved_at
                }
              })
            });
          }
        }
      } catch (e) {
        console.warn('ZIP load: could not re-establish server session:', e);
      }
    }

    // Build page sizes from settings
    const pageSizes = [];
    for (let i = 1; i <= metadata.page_count; i++) {
      const s = settings[i] || settings[String(i)];
      pageSizes.push(s ? {
        width_mm:  Math.round(parseFloat(s.format_width)  || 210),
        height_mm: Math.round(parseFloat(s.format_height) || 297)
      } : null);
    }

    initSidebarFromProject(metadata.project_name, imageUrls, pageSizes);

    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) resultsSection.style.display = 'block';

    // Load first page image + canvas data
    const uploadedImage = document.getElementById('uploadedImage');
    if (uploadedImage && imageUrls.length > 0) {
      uploadedImage.onload = function () {
        const page1 = canvasData.pages && canvasData.pages['1'];
        if (page1 && window.loadCanvasData) window.loadCanvasData(page1);
      };
      uploadedImage.style.display = 'block';
      uploadedImage.src = imageUrls[0];
    }

    document.title = `Planvision – ${metadata.project_name}`;
    updateStatus(status, 'Projekt geladen ✓', 'success');
  } catch (err) {
    console.error('ZIP load error:', err);
    updateStatus(status, `Fehler beim Laden: ${err.message}`, 'error');
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

// ── PDF Export ────────────────────────────────────────────────────────────────

export function exportPdf() {
  const sessionId = pdfModule.getPdfSessionId();
  if (!sessionId) {
    alert('PDF-Export benötigt eine aktive Sitzung. Bitte laden Sie zuerst eine PDF-Datei hoch.');
    return;
  }

  const status = showStatus('PDF-Bericht wird erstellt…');
  fetch(`/export_pdf/${sessionId}`)
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        updateStatus(status, 'PDF erstellt ✓', 'success');
        window.open(data.pdf_url, '_blank');
      } else {
        updateStatus(status, `Fehler: ${data.error}`, 'error');
      }
    })
    .catch(err => updateStatus(status, `Fehler: ${err.message}`, 'error'));
}

export function exportAnnotatedPdf() {
  const sessionId = pdfModule.getPdfSessionId();
  if (!sessionId) {
    alert('PDF-Export benötigt eine aktive Sitzung. Bitte laden Sie zuerst eine PDF-Datei hoch.');
    return;
  }

  const status = showStatus('Annotierte PDF wird erstellt…');
  fetch(`/export_annotated_pdf/${sessionId}`)
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        updateStatus(status, 'Annotierte PDF erstellt ✓', 'success');
        window.open(data.pdf_url, '_blank');
      } else {
        updateStatus(status, `Fehler: ${data.error}`, 'error');
      }
    })
    .catch(err => updateStatus(status, `Fehler: ${err.message}`, 'error'));
}

// ── Status helper ─────────────────────────────────────────────────────────────

function showStatus(msg) {
  const div = document.createElement('div');
  div.className = 'save-status';
  div.textContent = msg;
  document.body.appendChild(div);
  return div;
}

function updateStatus(div, msg, type = 'info') {
  div.textContent = msg;
  if (type === 'success') div.style.backgroundColor = '#4caf50';
  if (type === 'error')   div.style.backgroundColor = '#f44336';
  setTimeout(() => {
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 500);
  }, 3000);
}
