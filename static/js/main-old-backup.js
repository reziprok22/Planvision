/**
 * main.js - Main application for Fenster-Erkennungstool
 * This file coordinates the modules and handles the primary application flow
 */

// Fabric.js text baseline patch
if (typeof fabric !== 'undefined') {
  const originalInitialize = fabric.Text.prototype.initialize;
  fabric.Text.prototype.initialize = function() {
    const result = originalInitialize.apply(this, arguments);
    if (this.textBaseline === 'alphabetical') {
      this.textBaseline = 'alphabetic';
    }
    return result;
  };
}

// Import modules
import * as ZoomManager from './zoom-manager.js';
import * as PdfModule from './pdf-handler.js';
import * as ProjectModule from './project.js';
import * as LabelsModule from './labels.js';
import * as FabricHandler from './fabric-handler.js';

// Global app state
window.data = null;
window.isEditorActive = false;

/**
 * Update results table with current predictions
 */
function updateResultsTable() {
  const resultsBody = document.getElementById('resultsBody');
  if (!resultsBody || !window.data || !window.data.predictions) {
    return;
  }
  
  resultsBody.innerHTML = '';
  
  window.data.predictions.forEach((pred, index) => {
    const row = document.createElement('tr');
    
    // Determine measurement type (area or length)
    let measurementValue = '';
    
    if (pred.type === "line") {
      // For lines, display length
      measurementValue = pred.length ? `${pred.length.toFixed(2)} m` : 'N/A';
    } else {
      // For areas (rectangles, polygons), display area
      measurementValue = pred.area ? `${pred.area.toFixed(2)} m²` : 'N/A';
    }
    
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${pred.label_name || "Andere"}</td>
      <td>${pred.type || (pred.polygon ? "Polygon" : "Rechteck")}</td>
      <td>${(pred.score * 100).toFixed(1)}%</td>
      <td>${measurementValue}</td>
    `;
    
    resultsBody.appendChild(row);
    
    // Add highlight and selection functionality if FabricHandler is available
    if (window.FabricHandler) {
      // Highlight on hover
      row.addEventListener('mouseover', () => {
        window.FabricHandler.highlightObject(index, true);
      });
      
      row.addEventListener('mouseout', () => {
        window.FabricHandler.highlightObject(index, false);
      });
      
      // Select on click
      row.addEventListener('click', () => {
        window.FabricHandler.selectObjectByIndex(index);
      });
    }
  });
}

/**
 * Clear all results and reset the display
 */
function clearResults() {
  console.log("Clearing all results");
  
  // Reset global data
  window.data = null;
  
  // Clear image
  const uploadedImage = document.getElementById('uploadedImage');
  if (uploadedImage) {
    uploadedImage.src = '';
  }
  
  // Hide results areas
  const resultsSection = document.getElementById('resultsSection');
  const resultsTableSection = document.getElementById('resultsTableSection');
  if (resultsSection) resultsSection.style.display = 'none';
  if (resultsTableSection) resultsTableSection.style.display = 'none';
  
  // Clear summary and results table
  const summary = document.getElementById('summary');
  const resultsBody = document.getElementById('resultsBody');
  if (summary) summary.innerHTML = '';
  if (resultsBody) resultsBody.innerHTML = '';
  
  // Clear annotations
  if (window.FabricHandler && typeof window.FabricHandler.clearAnnotations === 'function') {
    window.FabricHandler.clearAnnotations();
  }
  
  // Reset zoom through ZoomManager
  if (typeof ZoomManager.resetZoom === 'function') {
    ZoomManager.resetZoom();
  }
  
  // Reset PDF state if PDF handler is available
  if (PdfModule && typeof PdfModule.resetPdfState === 'function') {
    PdfModule.resetPdfState();
  }
  
  // Hide PDF navigation
  const pdfNavigation = document.getElementById('pdfNavigation');
  if (pdfNavigation) {
    pdfNavigation.style.display = 'none';
  }
  
  // Reset editor state if it was active
  if (window.isEditorActive) {
    const editorToggle = document.getElementById('editorToggle');
    if (editorToggle) editorToggle.click(); // Toggle editor off
  }
  
  console.log("Results cleared successfully");
}

/**
 * Initialize and set up event handlers for the application
 */
function initApp() {
  console.log("DOM fully loaded. Initializing application...");

  // Collect DOM elements
  const elements = {
    // Main UI elements
    uploadForm: document.getElementById('uploadForm'),
    formatSelect: document.getElementById('formatSelect'),
    customFormatFields: document.getElementById('customFormatFields'),
    formatWidth: document.getElementById('formatWidth'),
    formatHeight: document.getElementById('formatHeight'),
    resultsSection: document.getElementById('resultsSection'),
    resultsTableSection: document.getElementById('resultsTableSection'),
    uploadedImage: document.getElementById('uploadedImage'),
    imageContainer: document.getElementById('imageContainer'),
    resultsBody: document.getElementById('resultsBody'),
    summary: document.getElementById('summary'),
    loader: document.getElementById('loader'),
    errorMessage: document.getElementById('errorMessage'),

    // PDF navigation elements
    pdfNavigation: document.getElementById('pdfNavigation'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    currentPageSpan: document.getElementById('currentPage'),
    totalPagesSpan: document.getElementById('totalPages'),
    reprocessBtn: document.getElementById('reprocessBtn'),

    // Editor controls
    editorToggle: document.getElementById('editorToggle'),
    editorControls: document.querySelector('.editor-controls'),
    addBoxBtn: document.getElementById('addBoxBtn'),
    addPolygonBtn: document.getElementById('addPolygonBtn'),
    addLineBtn: document.getElementById('addLineBtn'),
    editBoxBtn: document.getElementById('editBoxBtn'),
    deleteBoxBtn: document.getElementById('deleteBoxBtn'),
    objectTypeSelect: document.getElementById('objectTypeSelect'),
    lineTypeSelect: document.getElementById('lineTypeSelect'),
    saveEditBtn: document.getElementById('saveEditBtn'),
    cancelEditBtn: document.getElementById('cancelEditBtn'),
    
    // Project elements
    projectList: document.getElementById('projectList'),
    saveProjectBtn: document.getElementById('saveProjectBtn'),
    loadProjectBtn: document.getElementById('loadProjectBtn'),
    exportPdfBtn: document.getElementById('exportPdfBtn'),
    exportAnnotatedPdfBtn: document.getElementById('exportAnnotatedPdfBtn'),
    
    // Label manager elements
    labelManagerModal: document.getElementById('labelManagerModal'),
    manageLabelBtn: document.getElementById('manageLabelBtn'),
    closeModalBtn: document.getElementById('labelManagerModal') ? 
      document.getElementById('labelManagerModal').querySelector('.close') : null,
    labelTableBody: document.getElementById('labelTableBody'),
    addLabelBtn: document.getElementById('addLabelBtn'),
    importLabelsBtn: document.getElementById('importLabelsBtn'),
    exportLabelsBtn: document.getElementById('exportLabelsBtn'),
    resetLabelsBtn: document.getElementById('resetLabelsBtn'),
    labelForm: document.getElementById('labelForm'),
    labelFormTitle: document.getElementById('labelFormTitle'),
    labelIdInput: document.getElementById('labelId'),
    labelNameInput: document.getElementById('labelName'),
    labelColorInput: document.getElementById('labelColor'),
    saveLabelBtn: document.getElementById('saveLabelBtn'),
    cancelLabelBtn: document.getElementById('cancelLabelBtn'),
    areaLabelsTab: document.getElementById('areaLabelsTab'),
    lineLabelsTab: document.getElementById('lineLabelsTab'),
    resetZoomBtn: document.getElementById('resetZoomBtn'),
  };

  // Initialize modules
  initializeModules(elements);
  
  // Set up event handlers
  setupEventHandlers(elements);

  // Make functions globally accessible
  exposeGlobalFunctions();
}

/**
 * Initialize all modules with required elements
 * @param {Object} elements - DOM elements for initialization
 */
function initializeModules(elements) {
  // 1. Setup zoom functionality
  ZoomManager.init({
    imageContainer: elements.imageContainer,
    uploadedImage: elements.uploadedImage,
    resetZoomBtn: elements.resetZoomBtn
  });
  
  // 2. Setup PDF handler
  PdfModule.setupPdfHandler({
    pdfNavigation: elements.pdfNavigation,
    currentPageSpan: elements.currentPageSpan,
    totalPagesSpan: elements.totalPagesSpan,
    prevPageBtn: elements.prevPageBtn,
    nextPageBtn: elements.nextPageBtn,
    reprocessBtn: elements.reprocessBtn,
    loader: elements.loader,
    errorMessage: elements.errorMessage
  });
  
  // Set callback for displaying PDF pages
  PdfModule.setDisplayPageCallback(displayPdfPage);
  
  // 3. Setup project functionality
  ProjectModule.setupProject({
    projectList: elements.projectList,
    saveProjectBtn: elements.saveProjectBtn,
    loadProjectBtn: elements.loadProjectBtn,
    exportPdfBtn: elements.exportPdfBtn,
    exportAnnotatedPdfBtn: elements.exportAnnotatedPdfBtn
  }, {
    pdfModule: PdfModule
  });
  
  // 4. Setup labels management
  LabelsModule.setupLabels({
    labelManagerModal: elements.labelManagerModal,
    manageLabelBtn: elements.manageLabelBtn,
    closeModalBtn: elements.closeModalBtn,
    labelTableBody: elements.labelTableBody,
    addLabelBtn: elements.addLabelBtn,
    importLabelsBtn: elements.importLabelsBtn,
    exportLabelsBtn: elements.exportLabelsBtn,
    resetLabelsBtn: elements.resetLabelsBtn,
    labelForm: elements.labelForm,
    labelFormTitle: elements.labelFormTitle,
    labelIdInput: elements.labelIdInput,
    labelNameInput: elements.labelNameInput,
    labelColorInput: elements.labelColorInput,
    saveLabelBtn: elements.saveLabelBtn,
    cancelLabelBtn: elements.cancelLabelBtn,
    areaLabelsTab: elements.areaLabelsTab,
    lineLabelsTab: elements.lineLabelsTab
  });
  
  // 5. Setup Fabric.js handler
  FabricHandler.setupFabricHandler({
    imageContainer: elements.imageContainer,
    uploadedImage: elements.uploadedImage
  });
  
  // Editor functionality is handled through fabric-handler module
  console.log('Editor functionality initialized through fabric-handler module');
}

/**
 * Set up all event handlers for the application - consolidated and simplified version
 * @param {Object} elements - DOM elements for event handlers
 */
function setupEventHandlers(elements) {
  // Add click event listener with null check
  const addClickHandler = (element, handler) => {
    if (element) element.addEventListener('click', handler);
  };
  
  // Add change event listener with null check
  const addChangeHandler = (element, handler) => {
    if (element) element.addEventListener('change', handler);
  };
  
  // Format selection handling
  if (elements.formatSelect && elements.customFormatFields) {
    elements.formatSelect.addEventListener('change', function() {
      const isCustom = this.value === 'custom';
      elements.customFormatFields.style.display = isCustom ? 'block' : 'none';
      
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
        if (size && elements.formatWidth && elements.formatHeight) {
          elements.formatWidth.value = size[0];
          elements.formatHeight.value = size[1];
        }
      }
    });
  }
  
  // Form submission handler
  if (elements.uploadForm) {
    elements.uploadForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      // Check if data already exists
      const hasExistingData = Object.keys(PdfModule.getPdfPageData()).length > 0;
      
      if (hasExistingData) {
        // Ask for confirmation if data already exists
        if (!confirm("All existing changes will be lost. Do you really want to analyze the plan again?")) {
          return; // Abort if user clicks "Cancel"
        }
      }
      
      // Reset UI
      clearResults();
      if (elements.loader) elements.loader.style.display = 'block';
      if (elements.errorMessage) elements.errorMessage.style.display = 'none';
      
      // Reset stored data when starting a new analysis
      PdfModule.resetPdfState();
      
      const formData = new FormData(elements.uploadForm);
      
      // API call for data
      fetch('/predict', {
        method: 'POST',
        body: formData
      })
      .then(response => {
        if (!response.ok) {
          return response.json().then(data => {
            throw new Error(data.error || 'Error with request');
          });
        }
        return response.json();
      })
      .then(data => {
        console.log("Original API response:", data);
        
        // Process the response data and convert to desired format
        const processedData = processApiResponse(data);
        
        // Process PDF-specific data
        if (data.is_pdf) {
          PdfModule.processPdfData(processedData);
        }
        
        displayResults(processedData);
      })
      .catch(error => {
        console.error('Error:', error);
        if (elements.errorMessage) {
          elements.errorMessage.textContent = 'Error: ' + error.message;
          elements.errorMessage.style.display = 'block';
        }
      })
      .finally(() => {
        if (elements.loader) elements.loader.style.display = 'none';
      });
    });
  }
  
  // Add editor toggle handler
  addClickHandler(elements.editorToggle, toggleEditor);
  
  // Editor button handlers (consolidated version)
  if (elements.addBoxBtn && elements.objectTypeSelect) {
    addClickHandler(elements.addBoxBtn, function() {
      setActiveButton(this);
      const labelId = parseInt(elements.objectTypeSelect.value);
      if (window.FabricHandler) window.FabricHandler.enableDrawingMode('rectangle', labelId);
    });
  }
  
  if (elements.addPolygonBtn && elements.objectTypeSelect) {
    addClickHandler(elements.addPolygonBtn, function() {
      setActiveButton(this);
      const labelId = parseInt(elements.objectTypeSelect.value);
      if (window.FabricHandler) window.FabricHandler.enableDrawingMode('polygon', labelId);
    });
  }
  
  if (elements.addLineBtn && elements.lineTypeSelect) {
    addClickHandler(elements.addLineBtn, function() {
      setActiveButton(this);
      const labelId = parseInt(elements.lineTypeSelect.value || '1');
      if (window.FabricHandler) window.FabricHandler.enableDrawingMode('line', labelId);
      toggleLabelSelectors('line');
    });
  }
  
  if (elements.editBoxBtn) {
    addClickHandler(elements.editBoxBtn, function() {
      setActiveButton(this);
      if (window.FabricHandler) window.FabricHandler.enableEditing();
      toggleLabelSelectors('area');
    });
  }
  
  if (elements.deleteBoxBtn) {
    addClickHandler(elements.deleteBoxBtn, function() {
      if (window.FabricHandler) window.FabricHandler.deleteSelected();
    });
  }
  
  // Action button handlers
  addClickHandler(elements.saveEditBtn, function() {
    if (window.FabricHandler) window.FabricHandler.saveAnnotations();
    toggleEditor(); // Exit editor mode
  });
  
  addClickHandler(elements.cancelEditBtn, function() {
    if (window.FabricHandler) window.FabricHandler.cancelEditing();
    toggleEditor(); // Exit editor mode
  });
  
  // Type select handlers
  if (elements.objectTypeSelect) {
    addChangeHandler(elements.objectTypeSelect, function() {
      const labelId = parseInt(this.value);
      if (window.FabricHandler) window.FabricHandler.changeSelectedLabel(labelId);
    });
  }
  
  if (elements.lineTypeSelect) {
    addChangeHandler(elements.lineTypeSelect, function() {
      const labelId = parseInt(this.value);
      if (window.FabricHandler) window.FabricHandler.changeSelectedLineType(labelId);
    });
  }
  
  // Setup keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    // Skip if in text input or editor is not active
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    // Only apply shortcuts when editor is active
    if (window.isEditorActive) {
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          if (window.FabricHandler) window.FabricHandler.deleteSelected();
          break;
        case 'Escape':
          // Cancel drawing mode or selection
          if (window.FabricHandler) {
            const canvas = window.FabricHandler.getCanvas();
            if (canvas) canvas.discardActiveObject();
            canvas.renderAll();
          }
          break;
        case 'e':
          // Toggle edit mode
          if (elements.editBoxBtn) elements.editBoxBtn.click();
          break;
        case 'r':
          // Rectangle tool
          if (elements.addBoxBtn) elements.addBoxBtn.click();
          break;
        case 'p':
          // Polygon tool
          if (elements.addPolygonBtn) elements.addPolygonBtn.click();
          break;
        case 'l':
          // Line tool
          if (elements.addLineBtn) elements.addLineBtn.click();
          break;
      }
    }
  });
}

/**
 * Hilfsfunktion für aktiven Button
 * @param {HTMLElement} activeButton - Der zu aktivierende Button
 */
function setActiveButton(activeButton) {
  const buttons = [
    document.getElementById('addBoxBtn'),
    document.getElementById('addPolygonBtn'),
    document.getElementById('addLineBtn'),
    document.getElementById('editBoxBtn')
  ];
  
  buttons.forEach(button => {
    if (button && button !== activeButton) {
      button.classList.remove('active');
    }
  });
  
  if (activeButton) {
    activeButton.classList.add('active');
  }
}

/**
 * Toggle between area and line label selectors
 * @param {string} type - The type of selector to show ('area' or 'line')
 */
function toggleLabelSelectors(type) {
  const objectTypeSelect = document.getElementById('objectTypeSelect');
  const lineTypeSelect = document.getElementById('lineTypeSelect');
  
  if (!objectTypeSelect || !lineTypeSelect) return;
  
  if (type === 'line') {
    objectTypeSelect.style.display = 'none';
    lineTypeSelect.style.display = 'inline-block';
  } else {
    objectTypeSelect.style.display = 'inline-block';
    lineTypeSelect.style.display = 'none';
  }
}

/**
 * Toggle editor mode
 */
function toggleEditor() {
  console.log("Toggling editor mode, current state:", window.isEditorActive);
  
  // Toggle editor state
  window.isEditorActive = !window.isEditorActive;
  
  // Update UI elements
  const editorToggle = document.getElementById('editorToggle');
  const editorControls = document.querySelector('.editor-controls');
  const imageContainer = document.getElementById('imageContainer');
  
  if (!editorToggle) {
    console.error("Editor-Toggle-Button nicht gefunden!");
    return;
  }
  
  if (window.isEditorActive) {
    // Activate editor mode
    editorToggle.textContent = 'Ansichtsmodus';
    editorToggle.classList.add('active');
    
    if (editorControls) editorControls.style.display = 'flex';
    if (imageContainer) imageContainer.classList.add('editing-mode');
    
    // Enable editing mode in FabricHandler
    if (window.FabricHandler) {
      try {
        // Save original state for comparison or cancellation
        window.FabricHandler.saveOriginalState();
        window.FabricHandler.enableEditing();
      } catch (e) {
        console.error("Fehler beim Aktivieren des Bearbeitungsmodus:", e);
      }
    }
  } else {
    // Deactivate editor mode
    editorToggle.textContent = 'Bearbeitungsmodus';
    editorToggle.classList.remove('active');
    
    if (editorControls) editorControls.style.display = 'none';
    if (imageContainer) imageContainer.classList.remove('editing-mode');
    
    // Save changes and disable editing mode
    if (window.FabricHandler) {
      try {
        window.FabricHandler.saveAnnotations();
        window.FabricHandler.disableEditing();
        
        // Update UI
        updateSummary();
        updateResultsTable();
      } catch (e) {
        console.error("Fehler beim Deaktivieren des Bearbeitungsmodus:", e);
      }
    }
  }
}

/**
 * Process API response to a standardized format
 * @param {Object} apiResponse - The API response
 * @returns {Object} The processed data
 */
function processApiResponse(apiResponse) {
  // Create output format
  const result = {
    count: {
      fenster: 0,
      tuer: 0,
      wand: 0,
      lukarne: 0,
      dach: 0,
      other: 0,
      line: 0
    },
    total_area: {
      fenster: 0,
      tuer: 0,
      wand: 0,
      lukarne: 0,
      dach: 0,
      other: 0
    },
    predictions: []
  };
  
  // Process predictions if they exist
  if (Array.isArray(apiResponse.predictions)) {
    apiResponse.predictions.forEach(pred => {
      // Determine type based on existing properties
      let predType = "rectangle";
      if (pred.type === "line" || (pred.line && pred.length !== undefined)) {
        predType = "line";
        result.count.line++;
      } else if (pred.type === "polygon" || pred.polygon) {
        predType = "polygon";
      } else if (pred.box || pred.bbox) {
        predType = "rectangle";
      }
      
      // Get label information
      let label_name;
      let color;
      
      if (predType === "line") {
        label_name = window.LabelsManager?.getLabelName(pred.label || 1, 'line') || 'Strecke';
        color = window.LabelsManager?.getLabelColor(pred.label || 1, 'line') || '#FF9500';
      } else {
        label_name = window.LabelsManager?.getLabelName(pred.label || 0, 'area') || 'Andere';
        color = window.LabelsManager?.getLabelColor(pred.label || 0, 'area') || '#808080';
        
        // Update counts and areas based on label
        switch(pred.label) {
          case 1: 
            result.count.fenster++; 
            result.total_area.fenster += pred.area || 0; 
            break;
          case 2: 
            result.count.tuer++; 
            result.total_area.tuer += pred.area || 0; 
            break;
          case 3: 
            result.count.wand++; 
            result.total_area.wand += pred.area || 0; 
            break;
          case 4: 
            result.count.lukarne++; 
            result.total_area.lukarne += pred.area || 0; 
            break;
          case 5: 
            result.count.dach++; 
            result.total_area.dach += pred.area || 0; 
            break;
          default: 
            result.count.other++; 
            result.total_area.other += pred.area || 0;
        }
      }
      
      // Add processed prediction
      result.predictions.push({
        ...pred,
        type: predType,
        label_name: label_name,
        color: color
      });
    });
  }
  
  // Copy PDF-specific properties
  if (apiResponse.is_pdf) {
    result.is_pdf = apiResponse.is_pdf;
    result.pdf_image_url = apiResponse.pdf_image_url;
    result.session_id = apiResponse.session_id;
    result.current_page = apiResponse.current_page;
    result.page_count = apiResponse.page_count;
    result.all_pages = apiResponse.all_pages;
    result.page_sizes = apiResponse.page_sizes;
  }
  
  return result;
}

/**
 * Display results in the UI
 * @param {Object} responseData - The processed response data
 */
function displayResults(responseData) {
  console.log("Displaying results:", responseData);
  
  // Get references to UI elements
  const uploadedImage = document.getElementById('uploadedImage');
  const resultsSection = document.getElementById('resultsSection');
  const resultsTableSection = document.getElementById('resultsTableSection');
  
  // Set local and global data
  window.data = responseData;
  
  // Show results area
  if (resultsSection) resultsSection.style.display = 'block';
  if (resultsTableSection) resultsTableSection.style.display = 'block';
  
  // Set image source
  if (responseData.is_pdf && responseData.pdf_image_url) {
    console.log("PDF detected - Image URL:", responseData.pdf_image_url);
    uploadedImage.src = responseData.pdf_image_url + '?t=' + new Date().getTime(); // Cache-busting
    
    // Process PDF-specific data
    PdfModule.processPdfData(responseData);
  } else {
    // Regular image file
    const uploadedFile = document.getElementById('file').files[0];
    if (uploadedFile) {
      const displayImageUrl = URL.createObjectURL(uploadedFile);
      uploadedImage.src = displayImageUrl;
    }
  }

  // Wait for image to load before displaying annotations
  uploadedImage.onload = function() {
    console.log("Image loaded:", uploadedImage.width, "x", uploadedImage.height);
    
    // Display annotations using Fabric.js
    if (window.FabricHandler && typeof window.FabricHandler.displayAnnotations === 'function') {
      window.FabricHandler.displayAnnotations(responseData.predictions);
      
      // Ensure canvas positioning after annotations are displayed
      setTimeout(function() {
        if (window.FabricHandler && typeof window.FabricHandler.updateCanvasContainer === 'function') {
          window.FabricHandler.updateCanvasContainer();
        }
      }, 200);
    }
    
    // Update summary and table
    updateSummary();
    updateResultsTable();
  };
}

/**
 * Display a specific PDF page
 * @param {number} pageNumber - The page number to display
 * @param {Object} pageData - The page data
 */
function displayPdfPage(pageNumber, pageData) {
  console.log(`Displaying page ${pageNumber}:`, pageData);

  // Remember current editor state
  const wasEditorActive = window.isEditorActive;
  
  // Validate data
  if (!pageData) {
    console.error(`No data found for page ${pageNumber}!`);
    return;
  }
  
  // Set global data
  window.data = JSON.parse(JSON.stringify(pageData)); // Deep copy
  
  // Update form fields with values for this page
  const pageSettings = PdfModule.getPageSettings();
  if (pageSettings[pageNumber]) {
    document.getElementById('formatWidth').value = pageSettings[pageNumber].format_width;
    document.getElementById('formatHeight').value = pageSettings[pageNumber].format_height;
    document.getElementById('dpi').value = pageSettings[pageNumber].dpi;
    document.getElementById('planScale').value = pageSettings[pageNumber].plan_scale;
    document.getElementById('threshold').value = pageSettings[pageNumber].threshold;
  }
  
  // Display image
  const uploadedImage = document.getElementById('uploadedImage');
  const allPdfPages = window.getAllPdfPages ? window.getAllPdfPages() : [];
  const imageUrl = pageData.pdf_image_url || (allPdfPages[pageNumber-1] || '');
  
  console.log(`Displaying image: ${imageUrl}`);
  
  // Store current zoom
  const currentZoom = typeof ZoomManager.getCurrentZoom === 'function' ? ZoomManager.getCurrentZoom() : 1.0;
  
  // Load image
  uploadedImage.src = imageUrl + '?t=' + new Date().getTime(); // Cache-busting

  // Show results areas
  const resultsSection = document.getElementById('resultsSection');
  const resultsTableSection = document.getElementById('resultsTableSection');
  if (resultsSection) resultsSection.style.display = 'block';
  if (resultsTableSection) resultsTableSection.style.display = 'block';
  
  // Update PDF navigation
  PdfModule.updatePdfNavigation();
  
  // Wait for image to load
  uploadedImage.onload = function() {
    console.log("Image loaded:", uploadedImage.width, "x", uploadedImage.height);
    
    // Reset and redraw canvas
    if (window.FabricHandler) {
      // Clear canvas
      window.FabricHandler.clearAnnotations();
      
      // Initialize with correct zoom and display annotations
      setTimeout(function() {
        // Ensure image has correct zoom
        uploadedImage.style.transform = `scale(${currentZoom})`;
        uploadedImage.style.transformOrigin = 'top left';
        
        // Initialize canvas
        if (typeof window.FabricHandler.initCanvas === 'function') {
          const canvas = window.FabricHandler.initCanvas();
          
          if (canvas) {
            // Display annotations
            setTimeout(function() {
              if (pageData.predictions && pageData.predictions.length > 0) {
                window.FabricHandler.displayAnnotations(pageData.predictions);
              }
              
              // Restore editor state if needed
              if (wasEditorActive) {
                window.FabricHandler.enableEditing();
              } else {
                window.FabricHandler.disableEditing();
              }
            }, 50);
          }
        }
      }, 100);
    }
    
    // Update summary and table
    updateSummary();
    updateResultsTable();
  };
}

/**
 * Update the PDF page data with current annotations
 * @param {Object} data - The updated data
 */
function updatePdfPageData(data) {
  if (!data) return;
  
  // Get current page
  let currentPage = 1;
  if (data.current_page) {
    currentPage = parseInt(data.current_page);
  }
  
  console.log(`Updating PDF data for page ${currentPage}`);
  
  // Update page data if PDF module is available
  if (PdfModule && typeof PdfModule.getPdfPageData === 'function') {
    const pdfPageData = PdfModule.getPdfPageData();
    if (pdfPageData) {
      pdfPageData[currentPage] = JSON.parse(JSON.stringify(data));
      console.log(`PDF page data updated for page ${currentPage}`);
    }
  }
}

/**
 * Update summary display
 */
function updateSummary() {
  const summary = document.getElementById('summary');
  if (!summary || !window.data || !window.data.count) {
    return;
  }

  let summaryHtml = '';
  
  // Add each counted item to the summary
  if (window.data.count.fenster > 0) {
    summaryHtml += `<p>Gefundene Fenster: <strong>${window.data.count.fenster}</strong> (${window.data.total_area.fenster.toFixed(2)} m²)</p>`;
  }
  
  if (window.data.count.tuer > 0) {
    summaryHtml += `<p>Gefundene Türen: <strong>${window.data.count.tuer}</strong> (${window.data.total_area.tuer.toFixed(2)} m²)</p>`;
  }
  
  if (window.data.count.wand > 0) {
    summaryHtml += `<p>Gefundene Wände: <strong>${window.data.count.wand}</strong> (${window.data.total_area.wand.toFixed(2)} m²)</p>`;
  }
  
  if (window.data.count.lukarne > 0) {
    summaryHtml += `<p>Gefundene Lukarnen: <strong>${window.data.count.lukarne}</strong> (${window.data.total_area.lukarne.toFixed(2)} m²)</p>`;
  }
  
  if (window.data.count.dach > 0) {
    summaryHtml += `<p>Gefundene Dächer: <strong>${window.data.count.dach}</strong> (${window.data.total_area.dach.toFixed(2)} m²)</p>`;
  }
  
  if (window.data.count.other > 0) {
    summaryHtml += `<p>Andere Objekte: <strong>${window.data.count.other}</strong> (${window.data.total_area.other.toFixed(2)} m²)</p>`;
  }

  // For line measurements, display separately
  if (window.data.count.line > 0) {
    summaryHtml += `<p>Linienmessungen: <strong>${window.data.count.line}</strong></p>`;
  }
  
  summary.innerHTML = summaryHtml;
}


/**
 * Make key functions available globally
 */
function exposeGlobalFunctions() {
  // Expose functions for external access
  window.displayPdfPage = displayPdfPage;
  window.updatePdfPageData = updatePdfPageData;
  window.clearResults = clearResults;
  window.updateSummary = updateSummary;
  window.updateResultsTable = updateResultsTable;
  window.processApiResponse = processApiResponse;
  window.getAllPdfPages = function() {
    return PdfModule.getAllPdfPages();
  };
  window.updateAnnotationsDisplay = function() {
    if (window.data && window.data.predictions && window.FabricHandler) {
      window.FabricHandler.displayAnnotations(window.data.predictions);
    }
  };
}

// Initialize app when DOM is fully loaded
document.addEventListener('DOMContentLoaded', initApp);