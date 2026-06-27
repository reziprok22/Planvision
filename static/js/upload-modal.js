/**
 * upload-modal.js (Redesigned)
 *
 * Handles the left-column drag-and-drop upload zone.
 * No overlay modal – the PDF is uploaded immediately and the main app
 * is ready to use. Analysis is triggered manually per page.
 *
 * Exports (unchanged names for main.js compatibility):
 *   setupUploadModal()   – initialize drop zone + events
 *   showUploadModal()    – show drop zone / reset to "ready for new file"
 *   resetUploadModal()   – reset internal state
 */

function getCsrfToken() {
  return document.cookie.split(';').map(c => c.trim())
    .find(c => c.startsWith('csrftoken='))?.split('=')[1] ?? '';
}

// ── Internal state ──────────────────────────────────────────────────
let currentSessionId = null;
let uploadedPages    = [];       // URL paths (for frontend)
let uploadedPageSizes = [];      // [{width_mm, height_mm}] per page
let currentFileName  = '';

// ── DOM refs ─────────────────────────────────────────────────────────
let dropZone, fileInput, browseLink, fileInfo, fileNameEl,
    changeFileBtn, pageListSection, pageList, pageCountBadge,
    leftLoader;

// ── Callbacks wired by main.js ────────────────────────────────────────
let onPageClickCallback  = null;
let onScaleChangeCallback = null;

export function setOnPageClick(fn)   { onPageClickCallback = fn; }
export function setOnScaleChange(fn) { onScaleChangeCallback = fn; }

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

}

/** Show the upload area (e.g. after "New file" action) */
export function showUploadModal() {
    resetUploadModal();
}

/** Reset all state and UI to initial "waiting for file" */
export function resetUploadModal() {
    currentSessionId   = null;
    uploadedPages      = [];
    uploadedPageSizes  = [];
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
export function getUploadedPages(){ return uploadedPages; }
export function getPageSizes()    { return uploadedPageSizes; }

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
    // Validate
    const allowed = ['application/pdf','image/jpeg','image/jpg','image/png'];
    if (!allowed.includes(file.type)) {
        alert('Nur PDF-, JPG- und PNG-Dateien sind erlaubt.');
        return;
    }
    if (file.size > 100 * 1024 * 1024) {
        alert('Die Datei ist zu groß (max. 100 MB).');
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
        currentSessionId  = data.session_id;
        uploadedPages     = data.all_pages || [];
        uploadedPageSizes = (data.page_sizes || []).map(s => ({
            width_mm:  Math.round(s[0]),
            height_mm: Math.round(s[1])
        }));

        showFileInfo(file.name);
        buildPageList(data.page_count || 1);

        // Tell main.js that upload is ready
        if (typeof window.onUploadReady === 'function') {
            window.onUploadReady({
                session_id:    currentSessionId,
                page_count:    data.page_count || 1,
                all_pages:     uploadedPages,
                page_sizes:    uploadedPageSizes,
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
 * Build the page list in the left sidebar.
 * @param {number} count  Total page count
 */
function buildPageList(count) {
    if (!pageList || !pageListSection) return;

    pageList.innerHTML = '';
    if (pageCountBadge) pageCountBadge.textContent = count;

    for (let i = 1; i <= count; i++) {
        const size = uploadedPageSizes[i - 1];
        const sizeText = size ? `${size.width_mm} × ${size.height_mm} mm` : '';

        const li = document.createElement('li');
        li.className = 'page-list-item';
        li.dataset.page = i;

        const scaleOptions = COMMON_SCALES.map(s =>
            `<option value="${s}" ${s === 100 ? 'selected' : ''}>${s}</option>`
        ).join('');

        li.innerHTML = `
            <img class="page-thumb"
                 src="${uploadedPages[i-1] || ''}"
                 alt="Seite ${i}"
                 loading="lazy">
            <span class="page-label">
                Seite ${i}
                ${sizeText ? `<span class="page-size-hint">${sizeText}</span>` : ''}
                <span class="page-scale-control">
                    <span class="scale-prefix">1:</span>
                    <select class="page-scale-select" data-page="${i}">
                        ${scaleOptions}
                        <option value="custom">Eigener…</option>
                    </select>
                    <input type="number" class="page-scale-custom" data-page="${i}"
                           min="1" value="100" style="display:none">
                </span>
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
                if (onScaleChangeCallback) onScaleChangeCallback(i, parseFloat(scaleSelect.value));
            }
        });

        scaleInput.addEventListener('blur', () => {
            const val = parseFloat(scaleInput.value);
            if (val > 0 && onScaleChangeCallback) onScaleChangeCallback(i, val);
        });
        scaleInput.addEventListener('keydown', e => { if (e.key === 'Enter') scaleInput.blur(); });

        li.addEventListener('click', () => {
            document.querySelectorAll('.page-list-item').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            if (onPageClickCallback) onPageClickCallback(i);
        });

        pageList.appendChild(li);
    }

    pageListSection.style.display = 'block';
}

/**
 * Initialize the sidebar for a loaded project (no file upload flow).
 * Mirrors what handleFile() does after a successful upload.
 */
export function initSidebarFromProject(projectName, imageUrls, pageSizes) {
  // Drop any session from a previously uploaded file — otherwise analyses of
  // the loaded project would run against the old project's server session
  currentSessionId  = null;
  uploadedPages     = imageUrls || [];
  uploadedPageSizes = pageSizes  || [];
  currentFileName   = projectName;

  showFileInfo(projectName);
  buildPageList(imageUrls.length);
  setActivePageInList(1);
}

/**
 * Update the scale dropdown for a specific page from outside (e.g. after ZIP load).
 */
export function setPageScaleInSidebar(pageNumber, scale) {
    const select = document.querySelector(`.page-scale-select[data-page="${pageNumber}"]`);
    const input  = document.querySelector(`.page-scale-custom[data-page="${pageNumber}"]`);
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
export function setActivePageInList(pageNumber) {
    document.querySelectorAll('.page-list-item').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.page) === pageNumber);
    });
}

