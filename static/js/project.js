/**
 * project.js – Project management (ZIP save/load + PDF export)
 */

import { setCurrentLabels, getAllLabels } from './labels.js';
import { initSidebarFromProject, getUploadedBaseName } from './upload-modal.js';
import { saveProjectAsZip, buildProjectZipBlob, loadProjectFromZip } from './project-zip.js';
import { exportAnnotatedPdfClient, exportReportPdfClient } from './pdf-export-client.js';

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
  zipFileInput.accept   = '.plan,.zip';   // .plan = neues Format, .zip = Altprojekte
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

  setupBugReport();
}

// ── Bug report ───────────────────────────────────────────────────────────────

// Modal-Texte/Defaults je Report-Typ. Das Modal wird für Bug-Meldungen und
// Verbesserungsvorschläge wiederverwendet (gemeinsamer Endpoint /report_bug).
const REPORT_PRESETS = {
  bug: {
    title:       'Problem melden',
    intro:       'Beschreibe kurz, was passiert ist und was du erwartet hättest.',
    placeholder: 'Was ist passiert?',
    attach:      true,   // Projekt/Screenshot standardmäßig anhängen
    success:     'Danke! Problem wurde gemeldet ✓',
  },
  suggestion: {
    title:       'Verbesserung vorschlagen',
    intro:       'Was würdest du dir wünschen? Beschreibe deine Idee – je konkreter, desto besser.',
    placeholder: 'Deine Idee…',
    attach:      false,  // bei Vorschlägen selten nötig, aber optional zuschaltbar
    success:     'Danke für deinen Vorschlag ✓',
  },
};

function setupBugReport() {
  const reportBtn  = document.getElementById('reportBugBtn');
  const suggestBtn = document.getElementById('suggestBtn');
  const modal      = document.getElementById('bugReportModal');
  const closeBtn   = document.getElementById('bugReportModalClose');
  const cancel     = document.getElementById('bugReportCancel');
  const submit     = document.getElementById('bugReportSubmit');
  if (!modal || !submit) return;

  const close = () => { modal.style.display = 'none'; };

  const open = (type) => {
    const preset = REPORT_PRESETS[type] || REPORT_PRESETS.bug;
    const set = (id, prop, val) => { const el = document.getElementById(id); if (el) el[prop] = val; };
    set('bugReportType', 'value', type);
    set('bugReportTitle', 'textContent', preset.title);
    set('bugReportIntro', 'textContent', preset.intro);
    set('bugReportText', 'placeholder', preset.placeholder);
    set('bugReportAttachProject', 'checked', preset.attach);
    set('bugReportAttachScreenshot', 'checked', preset.attach);
    modal.style.display = 'block';
    document.getElementById('bugReportText')?.focus();
  };

  reportBtn?.addEventListener('click', () => open('bug'));
  suggestBtn?.addEventListener('click', () => open('suggestion'));
  closeBtn?.addEventListener('click', close);
  cancel?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  submit.addEventListener('click', () => handleBugReportSubmit(close));
}

async function handleBugReportSubmit(closeModal) {
  const textarea         = document.getElementById('bugReportText');
  const attachProject    = document.getElementById('bugReportAttachProject');
  const attachScreenshot = document.getElementById('bugReportAttachScreenshot');
  const submit           = document.getElementById('bugReportSubmit');

  const reportType = document.getElementById('bugReportType')?.value || 'bug';
  const preset = REPORT_PRESETS[reportType] || REPORT_PRESETS.bug;

  const text = (textarea?.value || '').trim();
  if (!text) {
    alert('Bitte eine kurze Beschreibung eingeben.');
    return;
  }

  submit.disabled = true;
  submit.textContent = 'Wird gesendet…';

  try {
    const fd = new FormData();
    fd.append('text', text);
    fd.append('report_type', reportType);
    if (window.getCurrentPageNumber) fd.append('page', window.getCurrentPageNumber());

    // Attach the current project as ZIP (same content as the save button)
    if (attachProject?.checked && pdfModule.getAllPdfPages().length && window.collectAllPagesCanvasData) {
      const blob = await buildProjectZipBlob({
        projectName:     'bug-report',
        canvasData:      window.collectAllPagesCanvasData(),
        labels:          getAllLabels(),
        settings:        pdfModule.getPageSettings(),
        pageImageUrls:   pdfModule.getAllPdfPages(),
        originalPdfBlob: pdfModule.getOriginalPdfBlob(),
      });
      fd.append('project_zip', new File([blob], 'project.zip', { type: 'application/zip' }));
    }

    if (attachScreenshot?.checked && window.getCanvasScreenshotBlob) {
      const shot = await window.getCanvasScreenshotBlob();
      if (shot) fd.append('screenshot', new File([shot], 'screenshot.jpg', { type: 'image/jpeg' }));
    }

    const res = await fetch('/report_bug', {
      method: 'POST',
      body: fd,
      headers: { 'X-CSRFToken': getCsrfToken() },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    if (textarea) textarea.value = '';
    closeModal();
    const status = showStatus(preset.success);
    updateStatus(status, preset.success, 'success');
  } catch (err) {
    console.error('Bug report error:', err);
    alert('Senden fehlgeschlagen: ' + err.message);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Senden';
  }
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

  // Name nach dem hochgeladenen Plan; Fallback auf generischen Namen mit Datum
  const baseName = getUploadedBaseName();
  const projectName = baseName || `Planvision ${new Date().toLocaleDateString('de-DE')}`;

  const status = showStatus('Projekt wird gespeichert…');
  try {
    await saveProjectAsZip({
      projectName,
      canvasData:      window.collectAllPagesCanvasData(),
      labels:          getAllLabels(),
      settings:        pdfModule.getPageSettings(),
      pageImageUrls:   pdfModule.getAllPdfPages(),
      originalPdfBlob: pdfModule.getOriginalPdfBlob(),
      onProgress:      (pct) => { status.textContent = `Projekt wird gespeichert… ${pct}%`; }
    });
    updateStatus(status, 'Projekt gespeichert ✓', 'success');
  } catch (err) {
    console.error('ZIP save error:', err);
    updateStatus(status, `Fehler: ${err.message}`, 'error');
  }
}

// ── Load ─────────────────────────────────────────────────────────────────────

async function handleLoad(file) {
  const loader = document.getElementById('loader');
  const status = showStatus('Projekt wird geladen…');
  if (loader) loader.style.display = 'block';

  try {
    const { metadata, canvasData, labels, settings, imageUrls, pdfBlob } = await loadProjectFromZip(file);

    // Restore state
    if (window.initializePageCanvasData) window.initializePageCanvasData(canvasData);
    pdfModule.setPdfNavigationState(1, metadata.page_count, imageUrls);
    pdfModule.setPageSettings(settings);
    pdfModule.setPdfSessionId(null);
    if (window.clearImageSessionCache) window.clearImageSessionCache();

    if (labels.length > 0) setCurrentLabels(labels);

    // Store the original PDF blob for frontend export
    if (pdfBlob) {
      pdfModule.setOriginalPdfBlob(pdfBlob);
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

    const analyzeBtn = document.getElementById('analyzeCurrentPageBtn');
    if (analyzeBtn) analyzeBtn.disabled = false;

    // Sync all sidebar scale dropdowns with loaded settings
    if (window.syncAllPageScalesInSidebar) window.syncAllPageScalesInSidebar();

    // Navigate to page 1 – loads its settings into UI fields
    if (window.navigateToPageNoAnalysis) window.navigateToPageNoAnalysis(1, imageUrls);

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

/**
 * Returns the best available session ID:
 * 1. pdfSessionId (set by fresh upload or ZIP re-upload)
 * 2. any per-page session from imageSessionCache (image projects analyzed on demand)
 */
function resolveSessionId() {
  return pdfModule.getPdfSessionId()
    || (window.getUploadModalSessionId ? window.getUploadModalSessionId() : null)
    || (window.getFirstImageSessionId  ? window.getFirstImageSessionId()  : null);
}


function getCsrfToken() {
  return document.cookie.split(';').map(c => c.trim())
    .find(c => c.startsWith('csrftoken='))?.split('=')[1] ?? '';
}

function sendTrainingData(pageCanvasData) {
  const sessionId = window.getUploadModalSessionId ? window.getUploadModalSessionId() : null;
  if (!sessionId) return;
  fetch('/save_training_data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
    body: JSON.stringify({
      session_id: sessionId,
      page_canvas_data: pageCanvasData,
      labels: getAllLabels(),
      exported_at: new Date().toISOString(),
    }),
  }).catch(err => console.warn('Training data save failed:', err));
}

export async function exportPdf() {
  if (!pdfModule.getAllPdfPages().length) {
    alert('Kein aktiver Plan. Bitte laden Sie zuerst eine Datei hoch oder ein Projekt.');
    return;
  }

  const status = showStatus('Bericht wird erstellt…');
  try {
    if (window.saveCurrentPageCanvas) window.saveCurrentPageCanvas();

    const pageCanvasData = window.getPageCanvasData ? window.getPageCanvasData() : {};
    sendTrainingData(pageCanvasData);
    await exportReportPdfClient({
      pageImageUrls: pdfModule.getAllPdfPages(),
      pageCanvasData,
      labels:      getAllLabels(),
      projectName: getUploadedBaseName() || document.title.replace('Planvision – ', '') || 'Planvision',
    });
    updateStatus(status, 'Bericht erstellt ✓', 'success');
  } catch (err) {
    console.error('exportPdf error:', err);
    updateStatus(status, `Fehler: ${err.message}`, 'error');
  }
}

export async function exportAnnotatedPdf() {
  if (!pdfModule.getAllPdfPages().length) {
    alert('Kein aktiver Plan. Bitte laden Sie zuerst eine Datei hoch oder ein Projekt.');
    return;
  }

  const status = showStatus('Annotierter Plan wird erstellt…');
  try {
    if (window.saveCurrentPageCanvas) window.saveCurrentPageCanvas();

    const pageCanvasData = window.getPageCanvasData ? window.getPageCanvasData() : {};
    sendTrainingData(pageCanvasData);
    await exportAnnotatedPdfClient({
      pdfBlob:       pdfModule.getOriginalPdfBlob(),
      pageImageUrls: pdfModule.getAllPdfPages(),
      pageCanvasData,
      labels:        getAllLabels(),
      projectName:   getUploadedBaseName() || document.title.replace('Planvision – ', '') || 'Planvision',
    });
    updateStatus(status, 'Plan erstellt ✓', 'success');
  } catch (err) {
    console.error('exportAnnotatedPdf error:', err);
    updateStatus(status, `Fehler: ${err.message}`, 'error');
  }
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
