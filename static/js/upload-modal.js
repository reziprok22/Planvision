/**
 * upload-modal.js
 *
 * Handles the left-column drag-and-drop upload zone.
 * No overlay modal – the PDF is uploaded immediately and the main app
 * is ready to use. Analysis is triggered manually per page.
 */

import {
  getCsrfToken,
  initPageManifestFromUpload,
  appendPagesToManifest,
  getPageManifest,
  setSourcePdfBlob,
  ensureServerSession,
} from './pdf-handler.js';

// ── Internal state ──────────────────────────────────────────────────
// Page data itself (order, ids, image URLs, sizes) lives in pdf-handler.js's
// page manifest — this module is a view over it. Only upload-specific state
// (session, filename) stays local.
let currentSessionId = null;
let currentFileName  = '';

// ── DOM refs ─────────────────────────────────────────────────────────
let dropZone, fileInput, browseLink, fileInfo, fileNameEl,
    changeFileBtn, pageListSection, pageList, pageCountBadge,
    leftLoader, appendFileInput, appendPageBtn;

// ── Callbacks wired by main.js ────────────────────────────────────────
let onPageClickCallback   = null;
let onScaleChangeCallback = null;
let onPageActionCallback  = null; // (action, pageId) => void — duplicate/delete/move

export function setOnPageClick(fn)   { onPageClickCallback = fn; }
export function setOnScaleChange(fn) { onScaleChangeCallback = fn; }
export function setOnPageAction(fn)  { onPageActionCallback = fn; }

const COMMON_SCALES = [20, 50, 100, 200, 500, 1000];

// ── Public API ────────────────────────────────────────────────────────

/**
 * Initialize the upload handler.
 * Must be called once after DOMContentLoaded.
 */
export function setupUploadModal() {
    dropZone             = document.getElementById('leftDropZone');
    fileInput            = document.getElementById('leftFileInput');
    browseLink           = document.getElementById('leftBrowseLink');
    fileInfo             = document.getElementById('leftFileInfo');
    fileNameEl           = document.getElementById('leftFileName');
    changeFileBtn        = document.getElementById('changeFileBtn');
    pageListSection      = document.getElementById('pageListSection');
    pageList             = document.getElementById('pageList');
    pageCountBadge       = document.getElementById('pageCountBadge');
    leftLoader           = document.getElementById('leftLoader');
    appendFileInput      = document.getElementById('appendFileInput');
    appendPageBtn        = document.getElementById('appendPageBtn');

    if (!dropZone || !fileInput) {
        console.warn('Upload handler: DOM elements not found');
        return;
    }

    // ── Drag & Drop ──
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); });
    });
    dropZone.addEventListener('dragenter', () => dropZone.classList.add('drag-over'));
    dropZone.addEventListener('dragover',  () => dropZone.classList.add('drag-over'));
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    // ── Click on zone or browse link ──
    dropZone.addEventListener('click', () => fileInput.click());
    if (browseLink) browseLink.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    // ── "Change file" button ──
    if (changeFileBtn) changeFileBtn.addEventListener('click', () => {
        resetUploadModal();
        fileInput.click();
    });

    // ── "Seiten anhängen" (append an additional PDF to the current project) ──
    if (appendPageBtn) appendPageBtn.addEventListener('click', () => appendFileInput?.click());
    if (appendFileInput) appendFileInput.addEventListener('change', () => {
        if (appendFileInput.files[0]) handleAppendFile(appendFileInput.files[0]);
        appendFileInput.value = '';
    });

}

/** Reset all state and UI to initial "waiting for file" */
function resetUploadModal() {
    currentSessionId   = null;
    currentFileName    = '';

    if (dropZone)       dropZone.style.display   = 'block';
    if (fileInfo)       fileInfo.style.display    = 'none';
    if (pageListSection) pageListSection.style.display = 'none';
    if (leftLoader)     leftLoader.classList.remove('active');
    if (pageList)       pageList.innerHTML = '';
    if (fileInput)      fileInput.value = '';
}

// ── Accessors used by main.js ─────────────────────────────────────────
export function getSessionId()    { return currentSessionId; }

/**
 * Base name of the currently loaded plan (uploaded filename without extension),
 * used to name saved projects and PDF exports after the plan instead of a
 * generic label. Empty string when nothing is loaded yet.
 */
export function getUploadedBaseName() {
  return (currentFileName || '').replace(/\.[^.]+$/, '').trim();
}

// ── Internal helpers ──────────────────────────────────────────────────

/**
 * Main entry point after a file is selected.
 */
async function handleFile(file) {
    // Validate — der Server akzeptiert ausschliesslich PDFs (core/views.py)
    if (file.type !== 'application/pdf') {
        alert('Nur PDF-Dateien sind erlaubt.');
        return;
    }
    if (file.size > 100 * 1024 * 1024) {
        alert('Die Datei ist zu gross (max. 100 MB).');
        return;
    }

    currentFileName = file.name;
    showLoading(true);

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/upload', { method: 'POST', body: formData, headers: { 'X-CSRFToken': getCsrfToken() } });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Upload fehlgeschlagen');
        }

        const data = await response.json();
        currentSessionId = data.session_id;
        const allPages = data.all_pages || [];
        const pageSizes = (data.page_sizes || []).map(s => ({
            width_mm:  Math.round(s[0]),
            height_mm: Math.round(s[1])
        }));

        // Build the page manifest (single source of truth for page order/identity)
        initPageManifestFromUpload(allPages, pageSizes);

        showFileInfo(file.name);
        buildPageList();

        // Tell main.js that upload is ready
        if (typeof window.onUploadReady === 'function') {
            window.onUploadReady({
                session_id:    currentSessionId,
                is_pdf:        data.is_pdf,
                original_file: data.is_pdf ? file : null
            });
        }

    } catch (err) {
        alert('Fehler beim Hochladen: ' + err.message);
        console.error('Upload error:', err);
    } finally {
        showLoading(false);
    }
}

/**
 * Append an additional PDF's pages to the current project (Seiten-Management
 * "Anhängen"). Re-establishes a server session first if the project has none
 * yet (e.g. a ZIP-loaded project that was never analyzed).
 */
async function handleAppendFile(file) {
    if (file.type !== 'application/pdf') {
        alert('Nur PDF-Dateien sind erlaubt.');
        return;
    }
    if (file.size > 100 * 1024 * 1024) {
        alert('Die Datei ist zu gross (max. 100 MB).');
        return;
    }

    setAppendButtonBusy(true);
    try {
        const sessionId = await ensureServerSession();

        const formData = new FormData();
        formData.append('session_id', sessionId);
        formData.append('file', file);

        const response = await fetch('/upload_append', { method: 'POST', body: formData, headers: { 'X-CSRFToken': getCsrfToken() } });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Anhängen fehlgeschlagen');
        }

        const data = await response.json();
        const pageSizes = (data.page_sizes || []).map(s => ({
            width_mm:  Math.round(s[0]),
            height_mm: Math.round(s[1])
        }));

        setSourcePdfBlob(data.source_index, file);
        const newEntries = appendPagesToManifest(data.all_pages || [], pageSizes, data.source_index);

        buildPageList();
        // Let main.js initialise settings for the new pages and navigate there
        if (typeof window.onPagesAppended === 'function') window.onPagesAppended(newEntries);

    } catch (err) {
        alert('Fehler beim Anhängen: ' + err.message);
        console.error('Append error:', err);
    } finally {
        setAppendButtonBusy(false);
    }
}

// Same spinner treatment as the "Erkennen"-Button (analyze-page-btn.analyzing)
// during the upload/render round trip — reuses its .btn-spinner CSS/keyframes.
const APPEND_BTN_IDLE = '+ Seiten anhängen';
const APPEND_BTN_BUSY = '<svg class="btn-spinner" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="4" stroke-dasharray="11 9"/></svg> Wird angehängt…';

function setAppendButtonBusy(busy) {
    if (!appendPageBtn) return;
    appendPageBtn.disabled = busy;
    appendPageBtn.classList.toggle('busy', busy);
    appendPageBtn.innerHTML = busy ? APPEND_BTN_BUSY : APPEND_BTN_IDLE;
}

function showLoading(active) {
    if (!leftLoader) return;
    leftLoader.classList.toggle('active', active);
    if (dropZone) {
        // Only show drop zone when not loading AND file info is not displayed
        const fileInfoVisible = fileInfo && fileInfo.style.display !== 'none';
        dropZone.style.display = (!active && !fileInfoVisible) ? 'block' : 'none';
    }
}

function showFileInfo(name) {
    if (dropZone) dropZone.style.display = 'none';
    if (fileInfo) {
        fileInfo.style.display = 'flex';
        if (fileNameEl) fileNameEl.textContent = name;
    }
}

/**
 * (Re)build the page list in the left sidebar from the current page manifest.
 * Call after any structural change (upload, ZIP load, duplicate/delete/reorder).
 */
export function buildPageList() {
    if (!pageList || !pageListSection) return;

    const manifest = getPageManifest();
    const activeId = pageList.querySelector('.page-list-item.active')?.dataset.pageId;

    pageList.innerHTML = '';
    if (pageCountBadge) pageCountBadge.textContent = manifest.length;

    const scaleOptions = COMMON_SCALES.map(s =>
        `<option value="${s}" ${s === 100 ? 'selected' : ''}>${s}</option>`
    ).join('');

    manifest.forEach((entry, idx) => {
        const position = idx + 1;
        const sizeText = entry.width_mm ? `${entry.width_mm} × ${entry.height_mm} mm` : '';
        const isFirst = idx === 0;
        const isLast  = idx === manifest.length - 1;
        const canDelete = manifest.length > 1;

        const li = document.createElement('li');
        li.className = 'page-list-item';
        li.dataset.pageId = entry.id;

        li.innerHTML = `
            <img class="page-thumb"
                 src="${entry.imageUrl || ''}"
                 alt="Seite ${position}"
                 loading="lazy">
            <span class="page-label">
                Seite ${position}
                ${sizeText ? `<span class="page-size-hint">${sizeText}</span>` : ''}
                <span class="page-scale-control">
                    <span class="scale-prefix">1:</span>
                    <select class="page-scale-select" data-page-id="${entry.id}">
                        ${scaleOptions}
                        <option value="custom">Eigener…</option>
                    </select>
                    <input type="number" class="page-scale-custom" data-page-id="${entry.id}"
                           min="1" value="100" style="display:none">
                </span>
            </span>
            <span class="page-actions">
                <button class="page-action-btn" data-action="up" ${isFirst ? 'disabled' : ''} title="Seite nach oben">▲</button>
                <button class="page-action-btn" data-action="down" ${isLast ? 'disabled' : ''} title="Seite nach unten">▼</button>
                <button class="page-action-btn" data-action="duplicate" title="Seite duplizieren">⧉</button>
                <button class="page-action-btn" data-action="delete" ${canDelete ? '' : 'disabled'} title="${canDelete ? 'Seite löschen' : 'Die letzte Seite kann nicht gelöscht werden'}">✕</button>
            </span>
        `;

        // Scale dropdown logic (stop propagation so page click isn't triggered)
        const scaleControl = li.querySelector('.page-scale-control');
        const scaleSelect  = li.querySelector('.page-scale-select');
        const scaleInput   = li.querySelector('.page-scale-custom');

        scaleControl.addEventListener('click', e => e.stopPropagation());

        scaleSelect.addEventListener('change', () => {
            if (scaleSelect.value === 'custom') {
                scaleInput.style.display = 'inline-block';
                scaleInput.focus();
            } else {
                scaleInput.style.display = 'none';
                if (onScaleChangeCallback) onScaleChangeCallback(entry.id, parseFloat(scaleSelect.value));
            }
        });

        scaleInput.addEventListener('blur', () => {
            const val = parseFloat(scaleInput.value);
            if (val > 0 && onScaleChangeCallback) onScaleChangeCallback(entry.id, val);
        });
        scaleInput.addEventListener('keydown', e => { if (e.key === 'Enter') scaleInput.blur(); });

        // Page actions (duplicate/delete/move) — stop propagation so it doesn't navigate
        li.querySelector('.page-actions').addEventListener('click', e => {
            e.stopPropagation();
            const btn = e.target.closest('.page-action-btn');
            if (!btn || btn.disabled) return;
            if (onPageActionCallback) onPageActionCallback(btn.dataset.action, entry.id);
        });

        li.addEventListener('click', () => {
            if (onPageClickCallback) onPageClickCallback(entry.id);
        });

        pageList.appendChild(li);
    });

    // Restore highlight (rebuilds tear down and recreate all <li> nodes)
    if (activeId) setActivePageInList(activeId);

    pageListSection.style.display = 'block';
}

/**
 * Initialize the sidebar for a loaded project (no file upload flow).
 * Mirrors what handleFile() does after a successful upload. Assumes the page
 * manifest has already been restored via pdf-handler's setPageManifest().
 */
export function initSidebarFromProject(projectName) {
  // Drop any session from a previously uploaded file — otherwise analyses of
  // the loaded project would run against the old project's server session
  currentSessionId  = null;
  currentFileName   = projectName;

  showFileInfo(projectName);
  buildPageList();
  const firstId = getPageManifest()[0]?.id;
  if (firstId) setActivePageInList(firstId);
}

/**
 * Update the scale dropdown for a specific page from outside (e.g. after ZIP load).
 */
export function setPageScaleInSidebar(pageId, scale) {
    const select = document.querySelector(`.page-scale-select[data-page-id="${pageId}"]`);
    const input  = document.querySelector(`.page-scale-custom[data-page-id="${pageId}"]`);
    if (!select) return;
    if (COMMON_SCALES.includes(scale)) {
        select.value = String(scale);
        if (input) input.style.display = 'none';
    } else {
        select.value = 'custom';
        if (input) { input.value = scale; input.style.display = 'inline-block'; }
    }
}

/**
 * Set the active page highlight in the sidebar list.
 * Called from main.js when page changes.
 */
export function setActivePageInList(pageId) {
    document.querySelectorAll('.page-list-item').forEach(el => {
        el.classList.toggle('active', el.dataset.pageId === String(pageId));
    });
}

