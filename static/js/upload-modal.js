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

// ── Internal state ──────────────────────────────────────────────────
let currentSessionId = null;
let uploadedPages    = [];       // URL paths (for frontend)
let uploadedPageSizes = [];      // [{width_mm, height_mm}] per page
let currentFileName  = '';

// ── DOM refs ─────────────────────────────────────────────────────────
let dropZone, fileInput, browseLink, fileInfo, fileNameEl,
    changeFileBtn, pageListSection, pageList, pageCountBadge,
    analysisSettingsSection, leftLoader;

// ── Callbacks wired by main.js ────────────────────────────────────────
//  Called when the user clicks a page in the sidebar
let onPageClickCallback = null;

export function setOnPageClick(fn) { onPageClickCallback = fn; }

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
    analysisSettingsSection = document.getElementById('analysisSettingsSection');
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

    // ── Analysis settings toggle ──
    const toggle = document.getElementById('analysisSettingsToggle');
    const body   = document.getElementById('analysisSettingsBody');
    if (toggle && body) {
        toggle.addEventListener('click', () => {
            const open = body.classList.toggle('open');
            toggle.classList.toggle('open', open);
        });
    }
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
    if (analysisSettingsSection) analysisSettingsSection.style.display = 'none';
    if (leftLoader)     leftLoader.classList.remove('active');
    if (pageList)       pageList.innerHTML = '';
    if (fileInput)      fileInput.value = '';
}

// ── Accessors used by main.js ─────────────────────────────────────────
export function getSessionId()    { return currentSessionId; }
export function getUploadedPages(){ return uploadedPages; }
export function getPageSizes()    { return uploadedPageSizes; }

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

        const response = await fetch('/upload', { method: 'POST', body: formData });
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
        showAnalysisSettings();

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
    if (dropZone) dropZone.style.display = active ? 'none' : 'block';
}

function showFileInfo(name) {
    if (dropZone) dropZone.style.display = 'none';
    if (fileInfo) {
        fileInfo.style.display = 'flex';
        if (fileNameEl) fileNameEl.textContent = name;
    }
}

function showAnalysisSettings() {
    if (analysisSettingsSection) analysisSettingsSection.style.display = 'block';
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
        li.innerHTML = `
            <img class="page-thumb"
                 src="${uploadedPages[i-1] || ''}"
                 alt="Seite ${i}"
                 loading="lazy">
            <span class="page-label">
                Seite ${i}
                ${sizeText ? `<span class="page-size-hint">${sizeText}</span>` : ''}
            </span>
            <span class="page-status-dot" id="pageStatusDot_${i}"></span>
        `;

        li.addEventListener('click', () => {
            // Highlight active
            document.querySelectorAll('.page-list-item').forEach(el => el.classList.remove('active'));
            li.classList.add('active');

            // Update format fields from page metadata
            if (size) {
                const fw = document.getElementById('formatWidth');
                const fh = document.getElementById('formatHeight');
                if (fw) fw.value = size.width_mm;
                if (fh) fh.value = size.height_mm;
            }

            // Delegate to main.js
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
  uploadedPages     = imageUrls || [];
  uploadedPageSizes = pageSizes  || [];
  currentFileName   = projectName;

  showFileInfo(projectName);
  buildPageList(imageUrls.length);
  showAnalysisSettings();
  setActivePageInList(1);
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

/**
 * Mark a page as analyzed (green dot) or analyzing (orange pulsing dot).
 * @param {number}  pageNumber
 * @param {'analyzing'|'analyzed'|'none'} status
 */
export function setPageStatus(pageNumber, status) {
    const dot = document.getElementById(`pageStatusDot_${pageNumber}`);
    if (!dot) return;
    dot.className = 'page-status-dot';
    if (status === 'analyzing') dot.classList.add('analyzing');
    else if (status === 'analyzed') dot.classList.add('analyzed');
}
