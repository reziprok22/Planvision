/**
 * upload-modal.js - Upload-Modal mit Drag & Drop und Seitentabelle
 * Implementiert die getrennte Upload/Analyse-Funktionalität
 */

// Global variables für Upload-Modal
let currentUploadSession = null;
let uploadedPages = [];
let selectedPagesForAnalysis = new Set();

/**
 * Initialize Upload Modal
 */
export function setupUploadModal() {
    console.log('🚀 Upload Modal wird initialisiert...');
    
    // DOM Elements
    const uploadModal = document.getElementById('uploadModal');
    const uploadDropZone = document.getElementById('uploadDropZone');
    const uploadFileInput = document.getElementById('uploadFileInput');
    const uploadBrowseBtn = document.getElementById('uploadBrowseBtn');
    const closeUploadModal = document.getElementById('closeUploadModal');
    const uploadedFileInfo = document.getElementById('uploadedFileInfo');
    const pagesTable = document.getElementById('pagesTable');
    const analysisParameters = document.getElementById('analysisParameters');
    const startAnalysisBtn = document.getElementById('startAnalysisBtn');
    const modalFormatSelect = document.getElementById('modalFormatSelect');
    const modalCustomFormatFields = document.getElementById('modalCustomFormatFields');
    
    // Show modal on load
    if (uploadModal) {
        uploadModal.classList.add('active');
    }
    
    // Format selection logic (copy from original form)
    if (modalFormatSelect && modalCustomFormatFields) {
        modalFormatSelect.addEventListener('change', function() {
            const isCustom = this.value === 'custom';
            modalCustomFormatFields.style.display = isCustom ? 'block' : 'none';
            
            // Handle predefined formats
            if (this.value !== 'auto' && this.value !== 'custom') {
                const formatSizes = {
                    'A4 (Hochformat)': [210, 297],
                    'A4 (Querformat)': [297, 210],
                    'A3 (Hochformat)': [297, 420],
                    'A3 (Querformat)': [420, 297],
                    'A2 (Hochformat)': [420, 594],
                    'A2 (Querformat)': [594, 420],
                    'A1 (Hochformat)': [594, 841],
                    'A1 (Querformat)': [841, 594],
                    'A0 (Hochformat)': [841, 1189],
                    'A0 (Querformat)': [1189, 841]
                };
                
                const size = formatSizes[this.value];
                if (size) {
                    document.getElementById('modalFormatWidth').value = size[0];
                    document.getElementById('modalFormatHeight').value = size[1];
                }
            }
        });
    }
    
    // Close modal event
    if (closeUploadModal) {
        closeUploadModal.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            if (!currentUploadSession) {
                uploadModal.classList.remove('active');
            } else {
                const confirm = window.confirm('Möchten Sie das Upload-Modal wirklich schließen? Die hochgeladene Datei bleibt erhalten.');
                if (confirm) {
                    uploadModal.classList.remove('active');
                }
            }
        });
    }
    
    // Prevent modal background clicks from interfering
    if (uploadModal) {
        uploadModal.addEventListener('click', function(e) {
            if (e.target === uploadModal) {
                e.preventDefault();
                e.stopPropagation();
                // Optionally close modal when clicking background
                // closeUploadModal.click();
            }
        });
    }
    
    // File input change event
    if (uploadFileInput) {
        uploadFileInput.addEventListener('change', function(e) {
            console.log('File input changed:', e.target.files.length, 'files');
            if (e.target.files.length > 0) {
                handleFileUpload(e.target.files[0]);
            }
        });
    }
    
    // Browse button click event
    if (uploadBrowseBtn) {
        uploadBrowseBtn.addEventListener('click', function(e) {
            console.log('Browse button clicked');
            e.preventDefault();
            e.stopPropagation();
            
            // Small delay to prevent modal interference
            setTimeout(() => {
                console.log('Triggering file input click');
                try {
                    uploadFileInput.click();
                } catch (err) {
                    console.error('Failed to trigger file input:', err);
                }
            }, 100);
        });
    }
    
    // Drag & Drop events
    if (uploadDropZone) {
        setupDragAndDrop(uploadDropZone, uploadFileInput);
    }
    
    // Pages table control events
    setupPageTableControls();
    
    // Start analysis event
    if (startAnalysisBtn) {
        startAnalysisBtn.addEventListener('click', startSelectedAnalysis);
    }
    
    console.log('✅ Upload Modal initialisiert');
}

/**
 * Setup Drag and Drop functionality
 */
function setupDragAndDrop(dropZone, fileInput) {
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });
    
    // Highlight drop zone when dragging over it
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });
    
    // Handle dropped files
    dropZone.addEventListener('drop', handleDrop, false);
    
    // Click to upload (but not on the browse button)
    dropZone.addEventListener('click', function(e) {
        // Don't trigger if clicking on the browse button
        if (e.target.id !== 'uploadBrowseBtn' && !e.target.closest('#uploadBrowseBtn')) {
            e.preventDefault();
            e.stopPropagation();
            fileInput.click();
        }
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    function highlight(e) {
        dropZone.classList.add('drag-over');
    }
    
    function unhighlight(e) {
        dropZone.classList.remove('drag-over');
    }
    
    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    }
}

/**
 * Handle file upload
 */
async function handleFileUpload(file) {
    console.log('📁 Datei wird hochgeladen:', file.name);
    
    // Validate file
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
        alert('Nur PDF-, JPG-, JPEG- und PNG-Dateien sind erlaubt.');
        return;
    }
    
    if (file.size > 50 * 1024 * 1024) { // 50MB limit
        alert('Die Datei ist zu groß. Maximum 50MB.');
        return;
    }
    
    // Show loading
    showUploadLoading(true);
    
    try {
        // Create FormData
        const formData = new FormData();
        formData.append('file', file);
        
        // Update loading message for PDF processing
        if (file.name.toLowerCase().endsWith('.pdf')) {
            showUploadLoading(true, 'PDF wird verarbeitet...');
        }
        
        // Call new upload endpoint
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Upload failed');
        }
        
        const uploadData = await response.json();
        console.log('✅ Upload erfolgreich:', uploadData);
        
        // Store upload session data
        currentUploadSession = uploadData.session_id;
        uploadedPages = uploadData.all_pages;
        
        // Update UI
        updateFileInfoDisplay(file, uploadData);
        
        if (uploadData.is_pdf && uploadData.page_count > 1) {
            // Update loading message for page table
            showUploadLoading(true, 'Seitentabelle wird erstellt...');
            
            // Small delay for UI feedback
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Show pages table for multi-page PDF
            await showPagesTable(uploadData);
        } else {
            // Single page - select automatically
            selectedPagesForAnalysis.clear();
            selectedPagesForAnalysis.add(1);
            showAnalysisParameters();
        }
        
    } catch (error) {
        console.error('❌ Upload-Fehler:', error);
        alert('Fehler beim Hochladen: ' + error.message);
    } finally {
        showUploadLoading(false);
    }
}

/**
 * Show/hide upload loading
 */
function showUploadLoading(show, message = 'Datei wird hochgeladen...') {
    const uploadModal = document.getElementById('uploadModal');
    let loadingOverlay = uploadModal.querySelector('.modal-loading-overlay');
    
    if (show) {
        if (!loadingOverlay) {
            loadingOverlay = document.createElement('div');
            loadingOverlay.className = 'modal-loading-overlay';
            uploadModal.querySelector('.upload-modal-content').appendChild(loadingOverlay);
        }
        
        loadingOverlay.innerHTML = `
            <div class="modal-loading-content">
                <div class="modal-loading-spinner"></div>
                <div class="modal-loading-text">${message}</div>
            </div>
        `;
    } else {
        if (loadingOverlay) {
            loadingOverlay.remove();
        }
    }
}

/**
 * Update file info display
 */
function updateFileInfoDisplay(file, uploadData) {
    const uploadedFileInfo = document.getElementById('uploadedFileInfo');
    const uploadedFileName = document.getElementById('uploadedFileName');
    const uploadedFileSize = document.getElementById('uploadedFileSize');
    const uploadDropZone = document.getElementById('uploadDropZone');
    
    if (uploadedFileInfo && uploadedFileName && uploadedFileSize) {
        uploadedFileName.textContent = uploadData.filename;
        uploadedFileSize.textContent = formatFileSize(file.size);
        uploadedFileInfo.style.display = 'block';
    }
    
    // Hide drop zone
    if (uploadDropZone) {
        uploadDropZone.style.display = 'none';
    }
}

/**
 * Show pages table for PDF
 */
async function showPagesTable(uploadData) {
    const pagesTable = document.getElementById('pagesTable');
    const pagesTableBody = document.getElementById('pagesTableBody');
    
    if (!pagesTable || !pagesTableBody) return;
    
    // Clear existing table
    pagesTableBody.innerHTML = '';
    
    // Reset selected pages
    selectedPagesForAnalysis.clear();
    
    // Create table rows for each page
    for (let i = 1; i <= uploadData.page_count; i++) {
        const pageUrl = uploadData.all_pages[i - 1];
        const pageSize = uploadData.page_sizes && uploadData.page_sizes[i - 1] ? 
            `${Math.round(uploadData.page_sizes[i - 1][0])} × ${Math.round(uploadData.page_sizes[i - 1][1])} mm` : 
            'Unbekannt';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <input type="checkbox" class="page-checkbox" data-page="${i}" checked>
            </td>
            <td>Seite ${i}</td>
            <td>${pageSize}</td>
            <td>
                <img src="${pageUrl}" alt="Seite ${i}" class="page-preview" loading="lazy">
            </td>
        `;
        
        pagesTableBody.appendChild(row);
        
        // Add page to selected by default
        selectedPagesForAnalysis.add(i);
    }
    
    // Show table
    pagesTable.style.display = 'block';
    
    // Show analysis parameters
    showAnalysisParameters();
    
    // Add checkbox event listeners
    const checkboxes = pagesTableBody.querySelectorAll('.page-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const pageNum = parseInt(this.dataset.page);
            if (this.checked) {
                selectedPagesForAnalysis.add(pageNum);
            } else {
                selectedPagesForAnalysis.delete(pageNum);
            }
            updateAnalysisButtonState();
        });
    });
    
    updateAnalysisButtonState();
}

/**
 * Setup page table controls
 */
function setupPageTableControls() {
    const selectAllPages = document.getElementById('selectAllPages');
    const selectNonePages = document.getElementById('selectNonePages');
    
    if (selectAllPages) {
        selectAllPages.addEventListener('click', function() {
            const checkboxes = document.querySelectorAll('.page-checkbox');
            selectedPagesForAnalysis.clear();
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
                selectedPagesForAnalysis.add(parseInt(checkbox.dataset.page));
            });
            updateAnalysisButtonState();
        });
    }
    
    if (selectNonePages) {
        selectNonePages.addEventListener('click', function() {
            const checkboxes = document.querySelectorAll('.page-checkbox');
            selectedPagesForAnalysis.clear();
            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
            });
            updateAnalysisButtonState();
        });
    }
}

/**
 * Show analysis parameters section
 */
function showAnalysisParameters() {
    const analysisParameters = document.getElementById('analysisParameters');
    if (analysisParameters) {
        analysisParameters.style.display = 'block';
    }
    updateAnalysisButtonState();
}

/**
 * Update analysis button state
 */
function updateAnalysisButtonState() {
    const startAnalysisBtn = document.getElementById('startAnalysisBtn');
    if (startAnalysisBtn) {
        const hasSelectedPages = selectedPagesForAnalysis.size > 0;
        startAnalysisBtn.style.display = hasSelectedPages ? 'block' : 'none';
        startAnalysisBtn.disabled = !hasSelectedPages;
        
        // Update button text
        if (hasSelectedPages) {
            const pageCount = selectedPagesForAnalysis.size;
            startAnalysisBtn.textContent = pageCount === 1 ? 
                'Seite analysieren' : 
                `${pageCount} Seiten analysieren`;
        }
    }
}

/**
 * Start analysis for selected pages
 */
async function startSelectedAnalysis() {
    if (!currentUploadSession || selectedPagesForAnalysis.size === 0) {
        alert('Keine Seiten für die Analyse ausgewählt.');
        return;
    }
    
    console.log(`🔍 Starte Analyse für ${selectedPagesForAnalysis.size} Seiten...`);
    
    // Show analysis loading in modal
    const pageCount = selectedPagesForAnalysis.size;
    const loadingMessage = pageCount === 1 ? 
        'Seite wird analysiert...' : 
        `${pageCount} Seiten werden analysiert...`;
    showUploadLoading(true, loadingMessage);
    
    // Get analysis parameters
    const params = getAnalysisParameters();
    
    // Small delay to show loading message
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Close modal
    const uploadModal = document.getElementById('uploadModal');
    uploadModal.classList.remove('active');
    
    // Clear any existing results
    if (window.clearResults) {
        window.clearResults();
    }
    
    // Show results section
    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) resultsSection.style.display = 'block';
    
    // Set up PDF data structure with all pages (analyzed and non-analyzed)
    const pdfData = {
        is_pdf: uploadedPages.length > 1,
        session_id: currentUploadSession,
        page_count: uploadedPages.length,
        all_pages: uploadedPages,
        current_page: Math.min(...selectedPagesForAnalysis),
        predictions: [] // Will be filled after analysis
    };
    
    // Force show navigation for multi-page documents BEFORE initializing PDF handler
    if (uploadedPages.length > 1) {
        const pdfNavigation = document.getElementById('pdfNavigation');
        if (pdfNavigation) {
            pdfNavigation.style.display = 'flex';
            
            // Update navigation immediately with all pages
            const totalPagesSpan = document.getElementById('totalPagesSpan');
            if (totalPagesSpan) totalPagesSpan.textContent = uploadedPages.length;
            
            // Setup dropdown with all pages immediately
            const pageDropdown = document.getElementById('pageDropdown');
            if (pageDropdown) {
                pageDropdown.innerHTML = '';
                for (let i = 1; i <= uploadedPages.length; i++) {
                    const option = document.createElement('option');
                    option.value = i;
                    option.textContent = i;
                    if (i === Math.min(...selectedPagesForAnalysis)) {
                        option.selected = true;
                    }
                    pageDropdown.appendChild(option);
                }
                console.log(`📋 Dropdown populated with ${uploadedPages.length} pages`);
            }
            
            // Setup navigation button handlers for upload modal data
            setupUploadModalNavigation();
            
            console.log(`📋 PDF Navigation shown: ${uploadedPages.length} pages`);
        }
    }
    
    // Initialize PDF handler with all pages AFTER navigation setup
    if (window.processPdfData && pdfData.is_pdf) {
        console.log('📋 Initializing PDF handler with data:', pdfData);
        window.processPdfData(pdfData);
    }
    
    // Create page data storage for selected pages
    window.uploadModalPageData = {
        sessionId: currentUploadSession,
        allPages: uploadedPages,
        selectedPages: selectedPagesForAnalysis,
        analysisParams: params,
        analyzedPages: new Map() // Store analysis results per page
    };
    
    // Start analysis for first selected page
    const firstPage = Math.min(...selectedPagesForAnalysis);
    const analysisData = await analyzePageWithParams(firstPage, params);
    
    // Store analysis result
    if (analysisData) {
        window.uploadModalPageData.analyzedPages.set(firstPage, analysisData);
    }
    
    // Use the analysis data but preserve PDF navigation
    if (analysisData && window.displayPdfPage) {
        // Merge analysis data with PDF structure
        const enhancedData = {
            ...pdfData,
            ...analysisData,
            current_page: firstPage
        };
        window.displayPdfPage(firstPage, enhancedData);
    }
    
    // Set up background processing for remaining pages (sequentially to avoid CUDA issues)
    if (selectedPagesForAnalysis.size > 1) {
        // Don't await - process in background
        processRemainingPagesInBackground(params);
    }
}

/**
 * Process remaining selected pages in background
 */
async function processRemainingPagesInBackground(params) {
    const remainingPages = [...selectedPagesForAnalysis].slice(1);
    console.log(`📋 Verarbeite ${remainingPages.length} weitere Seiten im Hintergrund...`);
    
    for (let i = 0; i < remainingPages.length; i++) {
        const pageNum = remainingPages[i];
        const progress = Math.round(((i + 1) / remainingPages.length) * 100);
        
        try {
            // Show progress in browser title
            document.title = `Analysiert ${i + 1}/${remainingPages.length} Seiten... - Fenster-Erkennungstool`;
            
            const analysisData = await analyzePageWithParams(pageNum, params);
            
            // Store analysis result
            if (analysisData && window.uploadModalPageData) {
                window.uploadModalPageData.analyzedPages.set(pageNum, analysisData);
            }
            
            console.log(`✅ Seite ${pageNum} im Hintergrund analysiert (${progress}%)`);
        } catch (error) {
            console.error(`❌ Fehler bei Seite ${pageNum}:`, error);
        }
    }
    
    // Reset title
    document.title = 'Fenster-Erkennungstool';
    
    console.log('🎉 Alle ausgewählten Seiten analysiert');
}

/**
 * Get analysis parameters from modal form
 */
function getAnalysisParameters() {
    const formatSelect = document.getElementById('modalFormatSelect');
    const formatWidth = document.getElementById('modalFormatWidth');
    const formatHeight = document.getElementById('modalFormatHeight');
    const dpi = document.getElementById('modalDpi');
    const planScale = document.getElementById('modalPlanScale');
    const threshold = document.getElementById('modalThreshold');
    
    const params = {
        session_id: currentUploadSession,
        dpi: dpi ? parseFloat(dpi.value) : 300,
        plan_scale: planScale ? parseFloat(planScale.value) : 100,
        threshold: threshold ? parseFloat(threshold.value) : 0.5
    };
    
    // Handle format
    if (formatSelect && formatSelect.value !== 'auto') {
        if (formatSelect.value === 'custom') {
            params.format_width = formatWidth ? parseFloat(formatWidth.value) : 210;
            params.format_height = formatHeight ? parseFloat(formatHeight.value) : 297;
        } else {
            const formatSizes = {
                'A4 (Hochformat)': [210, 297],
                'A4 (Querformat)': [297, 210],
                'A3 (Hochformat)': [297, 420],
                'A3 (Querformat)': [420, 297]
            };
            const size = formatSizes[formatSelect.value];
            if (size) {
                params.format_width = size[0];
                params.format_height = size[1];
            }
        }
    }
    
    return params;
}

/**
 * Analyze single page with parameters
 */
async function analyzePageWithParams(pageNumber, params) {
    console.log(`🔍 Analysiere Seite ${pageNumber}...`);
    
    // Show loader
    const loader = document.getElementById('loader');
    const errorMessage = document.getElementById('errorMessage');
    if (loader) loader.style.display = 'block';
    if (errorMessage) errorMessage.style.display = 'none';
    
    try {
        // Create FormData for analysis
        const formData = new FormData();
        formData.append('session_id', params.session_id);
        formData.append('page', pageNumber.toString());
        formData.append('dpi', params.dpi.toString());
        formData.append('plan_scale', params.plan_scale.toString());
        formData.append('threshold', params.threshold.toString());
        
        if (params.format_width && params.format_height) {
            formData.append('format_width', params.format_width.toString());
            formData.append('format_height', params.format_height.toString());
        }
        
        // Call analyze endpoint
        const response = await fetch('/analyze_page', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Analysis failed');
        }
        
        const analysisData = await response.json();
        console.log('✅ Analyse abgeschlossen:', analysisData);
        
        return analysisData;
        
    } catch (error) {
        console.error('❌ Analyse-Fehler:', error);
        if (errorMessage) {
            errorMessage.textContent = 'Fehler bei der Analyse: ' + error.message;
            errorMessage.style.display = 'block';
        }
        throw error;
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

/**
 * Setup navigation for upload modal pages
 */
function setupUploadModalNavigation() {
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageDropdown = document.getElementById('pageDropdown');
    
    if (prevPageBtn) {
        prevPageBtn.onclick = function() {
            if (window.uploadModalPageData) {
                const currentPage = getCurrentDisplayedPage();
                const newPage = Math.max(1, currentPage - 1);
                navigateToUploadModalPage(newPage);
            }
        };
    }
    
    if (nextPageBtn) {
        nextPageBtn.onclick = function() {
            if (window.uploadModalPageData) {
                const currentPage = getCurrentDisplayedPage();
                const newPage = Math.min(window.uploadModalPageData.allPages.length, currentPage + 1);
                navigateToUploadModalPage(newPage);
            }
        };
    }
    
    // Setup dropdown navigation
    if (pageDropdown) {
        pageDropdown.onchange = function() {
            const selectedPage = parseInt(this.value);
            if (selectedPage && window.uploadModalPageData) {
                navigateToUploadModalPage(selectedPage);
            }
        };
    }
    
    // Setup reprocess button for upload modal
    const reprocessBtn = document.getElementById('reprocessBtn');
    if (reprocessBtn) {
        reprocessBtn.onclick = function() {
            if (window.uploadModalPageData) {
                const currentPage = getCurrentDisplayedPage();
                reprocessCurrentPage(currentPage);
            }
        };
    }
    
    console.log('🧭 Upload modal navigation handlers installed');
}

/**
 * Get currently displayed page number
 */
function getCurrentDisplayedPage() {
    // Try dropdown first, then span
    const pageDropdown = document.getElementById('pageDropdown');
    if (pageDropdown && pageDropdown.value) {
        return parseInt(pageDropdown.value);
    }
    
    const currentPageSpan = document.getElementById('currentPageSpan');
    return currentPageSpan ? parseInt(currentPageSpan.textContent) : 1;
}

/**
 * Navigate to specific page in upload modal context
 */
function navigateToUploadModalPage(pageNumber) {
    if (!window.uploadModalPageData) return;
    
    const totalPages = window.uploadModalPageData.allPages.length;
    if (pageNumber < 1 || pageNumber > totalPages) return;
    
    console.log(`🧭 Navigating to page ${pageNumber}`);
    
    // Update all navigation elements
    const currentPageSpan = document.getElementById('currentPageSpan');
    if (currentPageSpan) currentPageSpan.textContent = pageNumber;
    
    const pageDropdown = document.getElementById('pageDropdown');
    if (pageDropdown) {
        // Update dropdown without triggering change event
        const originalHandler = pageDropdown.onchange;
        pageDropdown.onchange = null;
        pageDropdown.value = pageNumber;
        pageDropdown.onchange = originalHandler;
    }
    
    // Update button states
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    if (prevPageBtn) prevPageBtn.disabled = pageNumber <= 1;
    if (nextPageBtn) nextPageBtn.disabled = pageNumber >= totalPages;
    
    // Check if page was analyzed
    const analyzedData = window.uploadModalPageData.analyzedPages.get(pageNumber);
    
    let pageData;
    if (analyzedData) {
        // Page was analyzed - use analysis data
        pageData = analyzedData;
        console.log(`📊 Showing analyzed data for page ${pageNumber}`);
    } else {
        // Page was not analyzed - create basic page data
        pageData = {
            is_pdf: true,
            session_id: window.uploadModalPageData.sessionId,
            current_page: pageNumber,
            page_count: totalPages,
            all_pages: window.uploadModalPageData.allPages,
            pdf_image_url: window.uploadModalPageData.allPages[pageNumber - 1],
            predictions: [] // No predictions for non-analyzed pages
        };
        console.log(`📄 Showing non-analyzed page ${pageNumber} (image only)`);
    }
    
    // Display the page
    if (window.displayPdfPage) {
        window.displayPdfPage(pageNumber, pageData);
    }
}

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Reset upload modal to initial state
 */
export function resetUploadModal() {
    currentUploadSession = null;
    uploadedPages = [];
    selectedPagesForAnalysis.clear();
    
    // Reset UI elements
    const uploadDropZone = document.getElementById('uploadDropZone');
    const uploadedFileInfo = document.getElementById('uploadedFileInfo');
    const pagesTable = document.getElementById('pagesTable');
    const analysisParameters = document.getElementById('analysisParameters');
    const startAnalysisBtn = document.getElementById('startAnalysisBtn');
    
    if (uploadDropZone) uploadDropZone.style.display = 'block';
    if (uploadedFileInfo) uploadedFileInfo.style.display = 'none';
    if (pagesTable) pagesTable.style.display = 'none';
    if (analysisParameters) analysisParameters.style.display = 'none';
    if (startAnalysisBtn) startAnalysisBtn.style.display = 'none';
}

/**
 * Show upload modal
 */
export function showUploadModal() {
    const uploadModal = document.getElementById('uploadModal');
    if (uploadModal) {
        resetUploadModal();
        uploadModal.classList.add('active');
    }
}

// Export for global access
window.showUploadModal = showUploadModal;
window.resetUploadModal = resetUploadModal;
window.navigateToUploadModalPage = navigateToUploadModalPage;