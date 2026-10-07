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
  getSourcePdfBlob,
  nextSourcePdfIndex,
  getPageSettings,
  getPageTitle,
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

// ── Seiten-Vorschaubilder ────────────────────────────────────────────
// Die Liste zeigt 28×36 px (siehe .page-thumb in app.html), das Seitenrender
// hat aber 150 DPI. Es direkt als <img src> zu benutzen hiess: eine A1-Seite
// als 3508×4967-Bitmap dekodieren (69.7 MB) für 1008 sichtbare Pixel —
// 17'000-fache Überabtastung, bei 10 Seiten ~700 MB. Der Browser wirft die
// Bitmaps unter diesem Druck wieder weg und muss sie beim nächsten Neuzeichnen
// des Listeneintrags (schon ein :hover reicht) neu dekodieren: das waren die
// 1–2 s Verzögerung beim Drüberfahren.
//
// Deshalb wird pro Bild EINMAL ein kleines Vorschaubild erzeugt.
// createImageBitmap dekodiert direkt heruntergerechnet, statt erst das volle
// Bitmap aufzubauen: 256 px breit ≈ 0.37 MB statt 69.7 MB.
const THUMB_WIDTH = 256;

// Schlüssel ist die Bild-URL, nicht die Seiten-ID: duplizierte Seiten teilen
// sich dasselbe Vorschaubild, und der Neuaufbau der Liste (buildPageList wirft
// sie bei jeder Seiten-Aktion komplett weg) kostet nichts mehr.
const thumbCache = new Map();   // imageUrl -> Promise<objectURL>

function getThumbUrl(imageUrl) {
    const cached = thumbCache.get(imageUrl);
    if (cached) return cached;

    const pending = (async () => {
        const blob   = await fetch(imageUrl).then(r => r.blob());
        const bitmap = await createImageBitmap(blob, {
            resizeWidth: THUMB_WIDTH, resizeQuality: 'medium' });
        const canvas = document.createElement('canvas');
        canvas.width  = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close();
        const small = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8));
        return URL.createObjectURL(small);
    })().catch(e => {
        // Kein Vorschaubild ist besser als ein hängender Ladezustand — und
        // deutlich besser als der alte Vollbild-Fallback.
        console.warn('Vorschaubild fehlgeschlagen:', e);
        thumbCache.delete(imageUrl);
        return '';
    });

    thumbCache.set(imageUrl, pending);
    return pending;
}

/** Objekt-URLs freigeben — sonst sammeln sie sich über mehrere Projekte an. */
export function clearThumbCache() {
    for (const pending of thumbCache.values()) {
        Promise.resolve(pending).then(url => { if (url) URL.revokeObjectURL(url); });
    }
    thumbCache.clear();
}

// Der Observer lädt ein Seitenbild erst, wenn sein Eintrag wirklich sichtbar
// wird — natives loading="lazy" ist grosszügiger darin, was "nahe am Viewport"
// heisst, und das Seitenrender ist ein grosser Download.
let thumbObserver = null;

function getThumbObserver() {
    if (thumbObserver) return thumbObserver;
    const root = pageList?.closest('.left-column') || null;
    thumbObserver = new IntersectionObserver((entries, obs) => {
        for (const e of entries) {
            if (!e.isIntersecting) continue;
            const img = e.target;
            const src = img.dataset.src;
            if (src) {
                delete img.dataset.src;
                getThumbUrl(src).then(url => { if (url) img.src = url; });
            }
            obs.unobserve(img);
        }
    }, { root, rootMargin: '100px 0px' });
    return thumbObserver;
}

// ── Callbacks wired by main.js ────────────────────────────────────────
let onPageClickCallback   = null;
let onScaleChangeCallback = null;
let onPageActionCallback  = null; // (action, pageId, value?) => void — duplicate/delete/move/rename

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
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });

    // ── Click on zone or browse link ──
    dropZone.addEventListener('click', () => fileInput.click());
    if (browseLink) browseLink.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    fileInput.addEventListener('change', () => {
        // Kopie vor dem Leeren: FileList ist live an das Input gebunden
        const files = [...fileInput.files];
        fileInput.value = ''; // dieselbe Auswahl darf nochmals "change" auslösen
        if (files.length) handleFiles(files);
    });

    // ── "Change file" button ──
    if (changeFileBtn) changeFileBtn.addEventListener('click', () => {
        if (confirmDiscardChanges()) startNewProject();
    });

    // ── Projektname umbenennen (Klick auf den Namen) ──
    // Der angezeigte Name ist der kanonische Projektname: er landet beim
    // Speichern in der Cloud/ZIP-metadata und benennt Downloads/PDF-Exporte.
    if (fileNameEl) fileNameEl.addEventListener('click', () => {
        if (window.PLANLI_READ_ONLY || !currentFileName) return;
        const newName = prompt('Projektname:', getUploadedBaseName());
        if (!newName || !newName.trim()) return;
        setProjectName(newName.trim());
    });

    // ── "Seiten anhängen" (append an additional PDF to the current project) ──
    if (appendPageBtn) appendPageBtn.addEventListener('click', () => appendFileInput?.click());
    if (appendFileInput) appendFileInput.addEventListener('change', () => {
        const files = [...appendFileInput.files];
        appendFileInput.value = '';
        if (files.length) handleAppendFiles(files);
    });

}

/**
 * Vor jedem Weg, der das offene Projekt im Editor ersetzt (Cloud-Projekt öffnen,
 * .planli importieren, Neues Projekt): nachfragen, wenn es ungespeicherte
 * Änderungen gibt. beforeunload greift hier nicht — die Seite bleibt ja geladen,
 * nur der Editor-Inhalt wird ausgetauscht. true = weitermachen.
 */
export function confirmDiscardChanges() {
    if (!window.planliProjectIsDirty?.()) return true;
    return confirm('Das aktuelle Projekt hat ungespeicherte Änderungen, die verloren gehen.\n\nTrotzdem fortfahren?');
}

/**
 * Neues Projekt beginnen: Sidebar UND Editor (Canvas, Ergebnis-Spalte) auf den
 * Ausgangszustand zurücksetzen. Bewusst KEIN automatischer Datei-Dialog — der
 * leere Editor zeigt die Drop-Zone, Drag & Drop und "Datei auswählen" stehen
 * gleichwertig offen. Gemeinsamer Flow für "+ Neu" (Sidebar) und
 * "+ Neues Projekt" (Projektübersicht).
 */
export function startNewProject() {
    resetUploadModal();
    if (typeof window.planliResetEditor === 'function') window.planliResetEditor();
    // Beim Einstieg in den leeren Editor die Erstbesuch-Anleitung anbieten
    // (einmalig via localStorage) — bewusst hier statt über der Projektübersicht.
    if (typeof window.planliMaybeShowOnboarding === 'function') window.planliMaybeShowOnboarding();
}

/** Reset all state and UI to initial "waiting for file" */
function resetUploadModal() {
    projectGeneration++;
    currentSessionId   = null;
    currentFileName    = '';
    clearThumbCache();

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
  // Nur echte Dateiendungen strippen — Projektnamen dürfen Punkte enthalten ("Plan v1.2")
  return (currentFileName || '').replace(/\.(pdf|planli|plan|zip)$/i, '').trim();
}

/**
 * Set the canonical project name (rename in the editor, or the cloud name
 * winning over the ZIP's metadata name after opening from "Projektübersicht").
 */
export function setProjectName(name) {
  currentFileName = name;
  if (fileNameEl) fileNameEl.textContent = name;
}

// ── Internal helpers ──────────────────────────────────────────────────

// Limit kommt aus settings.MAX_UPLOAD_MB (app.html -> window.PLANLI_MAX_UPLOAD_MB),
// damit Browser-Vorabcheck und Server-Prüfung nicht auseinanderlaufen koennen.
function maxUploadMb()    { return window.PLANLI_MAX_UPLOAD_MB || 100; }
function maxUploadBytes() { return maxUploadMb() * 1024 * 1024; }

// Mehrere PDFs auf einmal (Drop oder Mehrfachauswahl): Die Reihenfolge, die
// der Browser liefert, ist je nach OS/Dateimanager mal Auswahl-, mal Namens-
// oder Ansichtsreihenfolge — darauf ist kein Verlass. Deshalb fest nach
// Dateinamen, "natürlich" (Plan 2 vor Plan 10): wer nummeriert ("01 UG",
// "02 EG"), bekommt genau seine Reihenfolge, alles andere lässt sich danach
// in der Seitenliste umsortieren.
const fileNameCollator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Split a FileList into uploadable PDFs (sorted by name) and rejection messages. */
function prepareFiles(fileList) {
    const accepted = [], failed = [];
    for (const file of fileList) {
        // Manche Dateimanager liefern beim Drop keinen MIME-Typ — dann zählt
        // die Endung; der Server prüft ohnehin die PDF-Signatur.
        if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
            failed.push(`${file.name}: keine PDF-Datei`);
        } else if (file.size > maxUploadBytes()) {
            failed.push(`${file.name}: zu gross (max. ${maxUploadMb()} MB)`);
        } else {
            accepted.push(file);
        }
    }
    accepted.sort((a, b) => fileNameCollator.compare(a.name, b.name));
    return { accepted, failed };
}

function reportFailures(title, failed) {
    if (failed.length) alert(`${title}\n\n${failed.join('\n')}`);
}

// Zählt jeden Projektwechsel (Upload, Reset, Öffnen). Ein laufender
// Mehrfach-Upload hängt nur an, solange er noch zum selben Projekt gehört —
// sonst landeten seine restlichen PDFs im inzwischen geöffneten Projekt.
let projectGeneration = 0;

/**
 * Main entry point after one or more files were dropped/selected: the first
 * PDF (by name) starts the project, the rest are appended one after another —
 * strictly sequential, so the server renders only one PDF at a time.
 */
async function handleFiles(fileList) {
    const { accepted, failed } = prepareFiles(fileList);
    let rest = accepted;
    let started = false;
    // Scheitert die erste Datei, eröffnet die nächste das Projekt
    while (!started && rest.length) {
        const [file, ...others] = rest;
        rest = others;
        try {
            await uploadNewProject(file);
            started = true;
        } catch (err) {
            console.error('Upload error:', err);
            failed.push(`${file.name}: ${err.message}`);
        }
    }
    if (started && rest.length) await appendFiles(rest, failed, { navigate: false });
    reportFailures(started ? 'Folgende Dateien wurden nicht übernommen:' : 'Fehler beim Hochladen:', failed);
}

/** Upload a single PDF as a new project. Throws on failure. */
async function uploadNewProject(file) {
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
        projectGeneration++;
        currentFileName = file.name;
        currentSessionId = data.session_id;
        const allPages = data.all_pages || [];
        const pageSizes = (data.page_sizes || []).map(s => ({
            width_mm:  Math.round(s[0]),
            height_mm: Math.round(s[1])
        }));

        // Build the page manifest (single source of truth for page order/identity)
        initPageManifestFromUpload(allPages, pageSizes);

        // Online-Ablage: frischer Upload = neues Projekt (nicht das zuvor
        // geöffnete Cloud-Projekt überschreiben)
        if (typeof window.planliCloudNewUpload === 'function') window.planliCloudNewUpload();

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
    } finally {
        showLoading(false);
    }
}

/**
 * "Seiten anhängen" with one or more PDFs: appended in name order, the view
 * jumps to the first appended page.
 */
async function handleAppendFiles(fileList) {
    const { accepted, failed } = prepareFiles(fileList);
    if (accepted.length) await appendFiles(accepted, failed, { navigate: true });
    reportFailures('Fehler beim Anhängen:', failed);
}

/**
 * Append PDFs one after another to the current project. Failures are collected
 * in `failed` (the others still go through); stops if the project is switched
 * meanwhile. `navigate`: jump to the first appended page.
 */
async function appendFiles(files, failed, { navigate }) {
    const generation = projectGeneration;
    let jumped = !navigate;
    try {
        for (let i = 0; i < files.length; i++) {
            if (projectGeneration !== generation) {
                failed.push(...files.slice(i).map(f => `${f.name}: nicht angehängt, das Projekt wurde gewechselt`));
                break;
            }
            setAppendButtonBusy(true, files.length > 1 ? `${i + 1}/${files.length}` : '');
            try {
                await appendFile(files[i], generation, !jumped);
                jumped = true;
            } catch (err) {
                console.error('Append error:', err);
                failed.push(`${files[i].name}: ${err.message}`);
            }
        }
    } finally {
        setAppendButtonBusy(false);
    }
}

/**
 * Append one PDF's pages to the current project (Seiten-Management
 * "Anhängen"). Re-establishes a server session first if the project has none
 * yet (e.g. a ZIP-loaded project that was never analyzed). Throws on failure.
 */
async function appendFile(file, generation, navigate) {
    const sessionId = await ensureServerSession();

    // Die Nummer vergibt der Client (siehe nextSourcePdfIndex) — der
    // Server übernimmt sie, statt selbst weiterzuzählen.
    const sourceIndex = nextSourcePdfIndex();
    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('source_index', sourceIndex);
    formData.append('file', file);

    const response = await fetch('/upload_append', { method: 'POST', body: formData, headers: { 'X-CSRFToken': getCsrfToken() } });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Anhängen fehlgeschlagen');
    }

    const data = await response.json();
    if (projectGeneration !== generation) throw new Error('nicht angehängt, das Projekt wurde gewechselt');
    const pageSizes = (data.page_sizes || []).map(s => ({
        width_mm:  Math.round(s[0]),
        height_mm: Math.round(s[1])
    }));

    // Nie eine vorhandene Quell-PDF überschreiben: deren Seiten zeigten
    // sonst auf eine fremde PDF (Export-Absturz "reading 'node'").
    if (data.source_index !== sourceIndex || getSourcePdfBlob(data.source_index)) {
        throw new Error('Interner Fehler bei der Quell-Nummer – bitte Seite neu laden und nochmals anhängen.');
    }
    setSourcePdfBlob(data.source_index, file);
    const newEntries = appendPagesToManifest(data.all_pages || [], pageSizes, data.source_index);

    buildPageList();
    // Let main.js initialise settings for the new pages (and navigate there)
    if (typeof window.onPagesAppended === 'function') window.onPagesAppended(newEntries, { navigate });
}

// Same spinner treatment as the "Erkennen"-Button (analyze-page-btn.analyzing)
// during the upload/render round trip — reuses its .btn-spinner CSS/keyframes.
const APPEND_BTN_IDLE = '+ Seiten anhängen';
const APPEND_BTN_BUSY = '<svg class="btn-spinner" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="4" stroke-dasharray="11 9"/></svg> Wird angehängt…';

function setAppendButtonBusy(busy, progress = '') {
    if (!appendPageBtn) return;
    appendPageBtn.disabled = busy;
    appendPageBtn.classList.toggle('busy', busy);
    appendPageBtn.innerHTML = busy ? `${APPEND_BTN_BUSY}${progress ? ' ' + progress : ''}` : APPEND_BTN_IDLE;
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

        const title = getPageTitle(entry, position);
        li.innerHTML = `
            <img class="page-thumb"
                 data-src="${entry.imageUrl || ''}"
                 alt="Seite ${position}">
            <span class="page-label">
                <span class="page-title" title="Doppelklick zum Umbenennen">${entry.name
                    ? `<span class="page-pos">${position}</span><span class="page-name"></span>`
                    : `<span class="page-name">${title}</span>`}</span>
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

        // Eigener Name als textContent, nie per innerHTML (Nutzereingabe)
        if (entry.name) li.querySelector('.page-name').textContent = entry.name;
        li.querySelector('.page-title').addEventListener('dblclick', e => {
            e.stopPropagation();
            startPageRename(li, entry, position);
        });

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
        getThumbObserver().observe(li.querySelector('.page-thumb'));
    });

    // Der Neuaufbau erzeugt alle Dropdowns mit 1:100 — gespeicherten Massstab
    // wieder eintragen, sonst zeigen nach Umsortieren/Umbenennen alle anderen
    // Seiten einen falschen Wert an
    for (const [pageId, s] of Object.entries(getPageSettings())) {
        if (s && s.plan_scale != null) setPageScaleInSidebar(pageId, s.plan_scale);
    }

    // Restore highlight (rebuilds tear down and recreate all <li> nodes)
    if (activeId) setActivePageInList(activeId);

    pageListSection.style.display = 'block';
}

/**
 * Inline-Umbenennen einer Seite: ersetzt den Titel durch ein Eingabefeld.
 * Enter/Verlassen übernimmt, Escape bricht ab, leer = zurück auf "Seite N".
 */
function startPageRename(li, entry, position) {
    if (window.PLANLI_READ_ONLY) return;
    const titleEl = li.querySelector('.page-title');
    if (!titleEl || titleEl.querySelector('input')) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'page-name-input';
    input.maxLength = 80;
    input.value = entry.name || '';
    input.placeholder = `Seite ${position}`;
    titleEl.replaceChildren(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
        if (done) return;
        done = true;
        // Callback baut die Liste neu auf (auch beim Abbrechen: alter Titel zurück)
        if (onPageActionCallback) onPageActionCallback('rename', entry.id, commit ? input.value : (entry.name || ''));
    };
    input.addEventListener('keydown', e => {
        e.stopPropagation(); // Editor-Hotkeys (Werkzeuge, Entf …) nicht auslösen
        if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    // Klicks ins Feld sollen nicht die Seite wechseln
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('dblclick', e => e.stopPropagation());
}

/**
 * Initialize the sidebar for a loaded project (no file upload flow).
 * Mirrors what uploadNewProject() does after a successful upload. Assumes the page
 * manifest has already been restored via pdf-handler's setPageManifest().
 */
export function initSidebarFromProject(projectName) {
  // Drop any session from a previously uploaded file — otherwise analyses of
  // the loaded project would run against the old project's server session
  projectGeneration++;
  currentSessionId  = null;
  currentFileName   = projectName;
  // Vorschaubilder des vorher geöffneten Projekts freigeben (ein Projekt kann
  // direkt aus der Projektübersicht heraus gewechselt werden, ohne Reset)
  clearThumbCache();

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

