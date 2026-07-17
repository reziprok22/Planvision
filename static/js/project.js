/**
 * project.js – Project management (ZIP save/load + PDF export)
 */

import { setCurrentLabels, getAllLabels } from './labels.js';
import { initSidebarFromProject, getUploadedBaseName, setProjectName, startNewProject } from './upload-modal.js';
import { saveProjectAsZip, buildProjectZipBlob, loadProjectFromZip } from './project-zip.js';
import { exportAnnotatedPdfClient, exportReportPdfClient } from './pdf-export-client.js';
import { getCsrfToken } from './pdf-handler.js';

let saveProjectBtn, loadProjectBtn, exportPdfBtn, exportAnnotatedPdfBtn;

// Online-Ablage: aktiv sobald eingeloggt (Flag setzt app.html). currentCloudProjectId
// hält das gerade geöffnete Cloud-Projekt — Speichern überschreibt es dann statt
// ein neues anzulegen. Null = nächstes Speichern legt ein neues Projekt an.
let cloudEnabled = false;
let currentCloudProjectId = null;
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

  cloudEnabled = !!window.PLANLI_CLOUD;

  if (saveProjectBtn)        saveProjectBtn.addEventListener('click',        handleSave);
  if (loadProjectBtn)        loadProjectBtn.addEventListener('click',
    () => cloudEnabled ? openDashboard() : zipFileInput.click());
  if (exportPdfBtn)          exportPdfBtn.addEventListener('click',          exportPdf);
  if (exportAnnotatedPdfBtn) exportAnnotatedPdfBtn.addEventListener('click', exportAnnotatedPdf);

  zipFileInput.addEventListener('change', () => {
    if (zipFileInput.files[0]) {
      hideDashboard(); // erst bei tatsächlicher Dateiwahl — Abbrechen lässt die Übersicht offen
      handleLoad(zipFileInput.files[0]);
    }
    zipFileInput.value = '';
  });

  setupBugReport();
  if (cloudEnabled) setupCloud();
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
    sourcePdfBlobs:  pdfModule.getAllSourcePdfBlobs(),
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

  // Eingeloggt: Speichern legt das Projekt online ab ("Meine Projekte").
  // Der Datei-Download bleibt im Menü als "Als Datei herunterladen".
  if (cloudEnabled) return saveToCloud(projectName);

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

/** Datei-Download (.planli) — bisheriges Speichern, jetzt Menüpunkt. */
async function handleDownload() {
  if (!pdfModule.getAllPdfPages().length) {
    alert('Bitte zuerst eine Datei hochladen.');
    return;
  }
  const projectName = getUploadedBaseName() || `Planli ${new Date().toLocaleDateString('de-DE')}`;
  const status = showStatus('Projekt wird heruntergeladen…');
  try {
    await saveProjectAsZip({
      ...collectZipParams(projectName),
      onProgress: (pct) => { status.textContent = `Projekt wird heruntergeladen… ${pct}%`; }
    });
    updateStatus(status, 'Datei heruntergeladen ✓', 'success');
  } catch (err) {
    updateStatus(status, `Fehler: ${err.message}`, 'error');
  }
}

// ── Load ─────────────────────────────────────────────────────────────────────

async function handleLoad(file) {
  // Lokale Datei geladen → nächstes Speichern legt ein NEUES Cloud-Projekt an.
  // (Beim Öffnen aus der Cloud setzt openCloudProject die ID danach wieder.)
  currentCloudProjectId = null;

  const loader = document.getElementById('loader');
  const status = showStatus('Projekt wird geladen…');
  if (loader) loader.style.display = 'block';

  try {
    const { metadata, canvasData, labels, settings, imageUrls, sourcePdfBlobs } = await loadProjectFromZip(file);

    // Rebuild the page manifest: canvasData.page_manifest carries id/
    // sourcePdfIndex/sourcePageIndex/size in display order (see project-zip.js
    // migrations for older v1/v2 ZIPs); imageUrls (from the ZIP's pages/
    // folder) is in the same order, so we zip them together. width_mm/height_mm
    // backfilled from settings.json for migrated v1 projects, which never
    // stored them there.
    const fullManifest = (canvasData.page_manifest || []).map((entry, i) => ({
      ...entry,
      imageUrl: imageUrls[i],
      // v3-ZIPs, die vor dem Fix in collectAllPagesCanvasData gespeichert
      // wurden, tragen kein sourcePdfIndex — 1 (die Original-PDF) ist für
      // alle Nicht-"Anhängen"-Projekte die korrekte Zuordnung.
      sourcePdfIndex: entry.sourcePdfIndex ?? 1,
      width_mm:  entry.width_mm  ?? Math.round(parseFloat(settings[entry.id]?.format_width)  || 210),
      height_mm: entry.height_mm ?? Math.round(parseFloat(settings[entry.id]?.format_height) || 297),
    }));
    pdfModule.setPageManifest(fullManifest);

    // Restore state
    if (window.initializePageCanvasData) window.initializePageCanvasData(canvasData);
    pdfModule.setPageSettings(settings);
    pdfModule.setPdfSessionId(null);

    if (labels.length > 0) setCurrentLabels(labels);

    // Store the source PDF(s) for frontend export / session re-establishment
    pdfModule.setAllSourcePdfBlobs(sourcePdfBlobs);

    initSidebarFromProject(metadata.project_name);

    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) resultsSection.style.display = 'block';

    const analyzeBtn = document.getElementById('analyzeCurrentPageBtn');
    if (analyzeBtn) analyzeBtn.disabled = false;

    // Sync all sidebar scale dropdowns with loaded settings
    if (window.syncAllPageScalesInSidebar) window.syncAllPageScalesInSidebar();

    // Navigate to the first page – loads its settings into UI fields
    if (window.navigateToPageNoAnalysis) window.navigateToPageNoAnalysis(fullManifest[0]?.id);

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
      pageManifest:  pdfModule.getPageManifest(),
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
    exportAnnotatedPdfClient({ ...params, sourcePdfBlobs: pdfModule.getAllSourcePdfBlobs() }), 'PDF Export: Plan');
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

// ── Online-Ablage ("Meine Projekte") ─────────────────────────────────────────
// Speichern (Ctrl+S) legt das Projekt-ZIP serverseitig ab; das Dashboard ist
// die Startansicht für eingeloggte Nutzer und listet alle Cloud-Projekte.

function setupCloud() {
  document.getElementById('cloudNewProjectBtn')?.addEventListener('click', () => {
    // Macht, was es sagt: leerer Editor mit sichtbarer Drop-Zone. Nie nur das
    // Overlay schliessen — sonst zeigt der Editor das alte Projekt, aber Ctrl+S
    // würde davon ein Duplikat als neues Cloud-Projekt anlegen.
    currentCloudProjectId = null;
    hideDashboard();
    startNewProject();
  });
  document.getElementById('cloudCloseBtn')?.addEventListener('click', hideDashboard);
  document.getElementById('downloadProjectBtn')?.addEventListener('click', handleDownload);
  document.getElementById('openLocalFileBtn')?.addEventListener('click', () => zipFileInput.click());
  document.getElementById('cloudOpenFileBtn')?.addEventListener('click', () => zipFileInput.click());

  // Linke Options-Spalte: Proxy auf die (im Dashboard ausgeblendeten) Burger-
  // Menü-Einträge — gleiche Handler, keine doppelte Logik. Konto/Abmelden sind
  // direkt Link bzw. POST-Form im Markup.
  const sideProxies = { dashOnboardingBtn: 'onboardingBtn', dashSuggestBtn: 'suggestBtn', dashReportBugBtn: 'reportBugBtn' };
  for (const [sideId, menuId] of Object.entries(sideProxies)) {
    document.getElementById(sideId)?.addEventListener('click',
      () => document.getElementById(menuId)?.click());
  }

  // Frischer PDF-Upload (Dropzone) = neues Projekt → beim Speichern nicht das
  // zuvor geöffnete Cloud-Projekt überschreiben. Hook wird von upload-modal.js
  // nach erfolgreichem Upload aufgerufen.
  window.planliCloudNewUpload = () => { currentCloudProjectId = null; };

  openDashboard(); // Startansicht
}

function hideDashboard() {
  const dash = document.getElementById('cloudDashboard');
  if (dash) dash.style.display = 'none';
  document.body.classList.remove('dashboard-open');
}

async function openDashboard() {
  const dash = document.getElementById('cloudDashboard');
  if (!dash) return;
  dash.style.display = 'block';
  // Dashboard-Modus: blendet die Editor-Aktionen im Header/Menü aus (CSS) und
  // sperrt die Editor-Shortcuts (Keydown-Handler in main.js).
  document.body.classList.add('dashboard-open');
  // "Zurück zum Editor" (✕) nur anbieten, wenn dahinter auch ein Plan geladen ist —
  // beim App-Start führte er sonst in einen leeren Editor.
  const closeBtn = document.getElementById('cloudCloseBtn');
  if (closeBtn) closeBtn.style.display = pdfModule.getAllPdfPages().length ? '' : 'none';
  const listEl = document.getElementById('cloudProjectList');
  try {
    const res = await fetch('/cloud/projects', { headers: { 'X-CSRFToken': getCsrfToken() } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Laden fehlgeschlagen');
    renderDashboard(data);
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div class="cloud-empty">Fehler: ${err.message}</div>`;
  }
}

function formatBytes(bytes) {
  if (!bytes) return '–';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function renderDashboard({ projects, limit }) {
  const listEl  = document.getElementById('cloudProjectList');
  const countEl = document.getElementById('cloudProjectCount');
  if (countEl) countEl.textContent = `${projects.length} von ${limit} Projekten`;
  if (!listEl) return;

  if (!projects.length) {
    listEl.innerHTML = '<div class="cloud-empty">Noch keine Projekte gespeichert.<br>'
      + 'Starte mit „+ Neues Projekt“ und speichere mit Ctrl+S — dein Projekt erscheint dann hier.</div>';
    return;
  }

  listEl.innerHTML = '';
  projects.forEach(p => {
    const row = document.createElement('div');
    row.className = 'cloud-project-row';

    const name = document.createElement('span');
    name.className = 'cloud-project-name';
    name.textContent = p.name;

    const meta = document.createElement('span');
    meta.className = 'cloud-project-meta';
    meta.textContent = `${p.updated_at} · ${formatBytes(p.size_bytes)}`;

    const renameBtn = document.createElement('button');
    renameBtn.className = 'cloud-row-btn';
    renameBtn.textContent = 'Umbenennen';
    renameBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newName = prompt('Neuer Projektname:', p.name);
      if (!newName || newName.trim() === '' || newName === p.name) return;
      const fd = new FormData();
      fd.append('name', newName.trim());
      const res = await fetch(`/cloud/projects/${p.id}/rename`, {
        method: 'POST', body: fd, headers: { 'X-CSRFToken': getCsrfToken() } });
      if (res.ok) {
        // Ist das Projekt gerade im Editor geöffnet, dort mit umbenennen
        if (currentCloudProjectId === p.id) setProjectName(newName.trim());
        openDashboard();
      } else {
        alert('Umbenennen fehlgeschlagen.');
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'cloud-row-btn danger';
    deleteBtn.textContent = 'Löschen';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Projekt „${p.name}“ endgültig löschen?\nTipp: vorher über „Öffnen“ + Menü → „Als Datei herunterladen“ sichern.`)) return;
      const res = await fetch(`/cloud/projects/${p.id}/delete`, {
        method: 'POST', headers: { 'X-CSRFToken': getCsrfToken() } });
      if (res.ok) {
        if (currentCloudProjectId === p.id) currentCloudProjectId = null;
        openDashboard();
      } else {
        alert('Löschen fehlgeschlagen.');
      }
    });

    row.append(name, meta, renameBtn, deleteBtn);
    row.addEventListener('click', () => openCloudProject(p));
    listEl.appendChild(row);
  });
}

async function openCloudProject(p) {
  const status = showStatus(`„${p.name}“ wird geladen…`);
  try {
    const res = await fetch(`/cloud/projects/${p.id}/download`);
    if (!res.ok) throw new Error('Download fehlgeschlagen');
    const blob = await res.blob();
    hideDashboard();
    await handleLoad(new File([blob], `${p.name}.planli`, { type: 'application/zip' }));
    currentCloudProjectId = p.id; // Speichern überschreibt ab jetzt dieses Projekt
    // Der Cloud-Name gewinnt über den (evtl. veralteten) Namen in der ZIP-metadata —
    // ein Umbenennen im Dashboard wirkt so auch im Editor und in Exporten.
    setProjectName(p.name);
    updateStatus(status, `„${p.name}“ geladen ✓`, 'success');
  } catch (err) {
    updateStatus(status, `Fehler: ${err.message}`, 'error');
  }
}

async function saveToCloud(projectName) {
  const status = showStatus('Projekt wird online gespeichert…');
  try {
    const blob = await buildProjectZipBlob(collectZipParams(projectName));
    const fd = new FormData();
    fd.append('project_zip', new File([blob], 'project.planli', { type: 'application/zip' }));
    // Name immer mitsenden: beim Überschreiben aktualisiert der Server den
    // Cloud-Namen mit — Editor-Umbenennungen erscheinen so auch im Dashboard.
    fd.append('name', projectName);
    if (currentCloudProjectId) fd.append('project_id', currentCloudProjectId);
    const res = await fetch('/cloud/projects/save', {
      method: 'POST', body: fd, headers: { 'X-CSRFToken': getCsrfToken() } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen');
    currentCloudProjectId = data.id;
    updateStatus(status, 'Online gespeichert ✓', 'success');
    window.plausible?.('Projekt online gespeichert');
  } catch (err) {
    console.error('Cloud save error:', err);
    updateStatus(status, `Fehler: ${err.message}`, 'error');
  }
}
