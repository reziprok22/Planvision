/**
 * project.js – Project management (ZIP save/load + PDF export)
 */

import { setCurrentLabels, getAllLabels } from './labels.js';
import { initSidebarFromProject, getUploadedBaseName } from './upload-modal.js';
import { saveProjectAsZip, buildProjectZipBlob, loadProjectFromZip } from './project-zip.js';
import { exportAnnotatedPdfClient, exportReportPdfClient } from './pdf-export-client.js';
import { getCsrfToken } from './pdf-handler.js';

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
  zipFileInput.accept   = '.planli,.plan,.zip';   // .planli = neues Format, .plan/.zip = ältere Testdateien
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

/**
 * Gemeinsame Parameter für buildProjectZipBlob() — Projekt-Speichern,
 * Bug-Report-Anhang und Trainingsdaten bauen dasselbe ZIP aus demselben Zustand.
 */
function collectZipParams(projectName) {
  return {
    projectName,
    canvasData:      window.collectAllPagesCanvasData(),
    labels:          getAllLabels(),
    settings:        pdfModule.getPageSettings(),
    pageImageUrls:   pdfModule.getAllPdfPages(),
    originalPdfBlob: pdfModule.getOriginalPdfBlob(),
  };
}

// ── Bug report ───────────────────────────────────────────────────────────────

// Modal-Texte/Defaults je Report-Typ. Das Modal wird für Bug-Meldungen und
// Verbesserungsvorschläge wiederverwendet (gemeinsamer Endpoint /report_bug).
const REPORT_PRESETS = {
  bug: {
    title:       'Problem melden',
    intro:       'Beschreibe kurz, was passiert ist und was du erwartet hättest.',
    placeholder: 'Was ist passiert? Bitte füge allfällige Fehlermeldungen hinzu. ',
    attach:      true,   // Projekt/Screenshot standardmässig anhängen
    success:     'Danke! Problem wurde gemeldet ✓',
  },
  suggestion: {
    title:       'Verbesserung vorschlagen',
    intro:       'Was würdest du dir wünschen? Beschreibe deine Idee.',
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
    set('bugReportEmail', 'value', '');
    // Anhänge + System-Info-Hinweis nur bei Bug-Meldungen zeigen.
    const extras = document.getElementById('bugReportExtras');
    if (extras) extras.style.display = preset.attach ? '' : 'none';
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

// Technische Systeminfos zur besseren Nachvollziehbarkeit von Bugs. Bewusst nur
// Geräte-/Umgebungsdaten (kein Tracking) — Viewport/DPR/Zeitzone stehen nicht im
// UA-Header und sind für eine Canvas-App am hilfreichsten.
function collectClientInfo() {
  const nav = navigator || {};
  const scr = window.screen || {};
  let tz = '-';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '-'; } catch { /* ignore */ }
  return [
    `User-Agent: ${nav.userAgent || '-'}`,
    `Plattform: ${nav.userAgentData?.platform || nav.platform || '-'}`,
    `Sprache: ${nav.language || '-'}`,
    `Bildschirm: ${scr.width || '?'}×${scr.height || '?'} px`,
    `Viewport: ${window.innerWidth}×${window.innerHeight} px @ DPR ${window.devicePixelRatio || 1}`,
    `Zeitzone: ${tz}`,
  ].join('\n');
}

async function handleBugReportSubmit(closeModal) {
  const textarea         = document.getElementById('bugReportText');
  const attachProject    = document.getElementById('bugReportAttachProject');
  const attachScreenshot = document.getElementById('bugReportAttachScreenshot');
  const emailInput       = document.getElementById('bugReportEmail');
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
    const email = (emailInput?.value || '').trim();
    if (email) fd.append('email', email);
    // Systeminfos nur bei Bug-Meldungen (bei Vorschlägen irrelevant).
    if (reportType === 'bug') fd.append('client_info', collectClientInfo());

    // Attach the current project as ZIP (same content as the save button)
    if (attachProject?.checked && pdfModule.getAllPdfPages().length && window.collectAllPagesCanvasData) {
      const blob = await buildProjectZipBlob(collectZipParams('bug-report'));
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
  const projectName = baseName || `Planli ${new Date().toLocaleDateString('de-DE')}`;

  const status = showStatus('Projekt wird gespeichert…');
  try {
    await saveProjectAsZip({
      ...collectZipParams(projectName),
      onProgress: (pct) => { status.textContent = `Projekt wird gespeichert… ${pct}%`; }
    });
    updateStatus(status, 'Projekt gespeichert ✓', 'success');
    window.plausible?.('Projekt gespeichert');
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

    document.title = `Planli – ${metadata.project_name}`;
    updateStatus(status, 'Projekt geladen ✓', 'success');
  } catch (err) {
    console.error('ZIP load error:', err);
    updateStatus(status, `Fehler beim Laden: ${err.message}`, 'error');
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

// ── PDF Export ────────────────────────────────────────────────────────────────

async function sendTrainingData() {
  // Nur mit ausdrücklicher Einwilligung (session-weiter Toggle im Header-Menü,
  // Default aus). Ohne Zustimmung verlässt nichts den Client.
  if (localStorage.getItem('ai_training_consent') !== 'true') return;
  const sessionId = window.getUploadModalSessionId ? window.getUploadModalSessionId() : null;
  if (!sessionId || !window.collectAllPagesCanvasData || !pdfModule.getAllPdfPages().length) return;
  try {
    // Vollständiges, ladbares Projekt-ZIP (identisch zum "Speichern"-Export),
    // damit die Qualität später in der App per "Öffnen" geprüft werden kann.
    const blob = await buildProjectZipBlob(collectZipParams(getUploadedBaseName() || 'training'));
    const fd = new FormData();
    fd.append('session_id', sessionId);
    fd.append('consent', 'true');
    fd.append('project_zip', new File([blob], 'project.zip', { type: 'application/zip' }));
    await fetch('/save_training_data', {
      method: 'POST',
      body: fd,
      headers: { 'X-CSRFToken': getCsrfToken() },
    });
  } catch (err) {
    console.warn('Training data save failed:', err);
  }
}

/** Gemeinsamer Ablauf für beide PDF-Exporte (Bericht + annotierter Plan). */
async function runPdfExport(startMsg, successMsg, exporter, eventName) {
  if (!pdfModule.getAllPdfPages().length) {
    alert('Kein aktiver Plan. Bitte laden Sie zuerst eine Datei hoch oder ein Projekt.');
    return;
  }

  const status = showStatus(startMsg);
  try {
    if (window.saveCurrentPageCanvas) window.saveCurrentPageCanvas();

    const pageCanvasData = window.getPageCanvasData ? window.getPageCanvasData() : {};
    sendTrainingData();
    await exporter({
      pageImageUrls: pdfModule.getAllPdfPages(),
      pageCanvasData,
      labels:        getAllLabels(),
      projectName:   getUploadedBaseName() || document.title.replace('Planli – ', '') || 'Planli',
    });
    updateStatus(status, successMsg, 'success');
    window.plausible?.(eventName);
  } catch (err) {
    console.error('PDF export error:', err);
    updateStatus(status, `Fehler: ${err.message}`, 'error');
  }
}

export function exportPdf() {
  return runPdfExport('Bericht wird erstellt…', 'Bericht erstellt ✓', exportReportPdfClient, 'PDF Export: Bericht');
}

export function exportAnnotatedPdf() {
  return runPdfExport('Annotierter Plan wird erstellt…', 'Plan erstellt ✓', (params) =>
    exportAnnotatedPdfClient({ ...params, pdfBlob: pdfModule.getOriginalPdfBlob() }), 'PDF Export: Plan');
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
