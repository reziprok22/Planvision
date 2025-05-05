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
import * as ZoomModule from './zoom.js';
import * as PdfModule from './pdf-handler.js';
import * as ProjectModule from './project.js';
import * as LabelsModule from './labels.js';
import * as FabricHandler from './fabric-handler.js';

// Global variables
window.data = null;

/**
 * Convert API response to desired format
 * @param {Object} apiResponse - The original API response
 * @returns {Object} Processed data in the desired format
 */
function processApiResponse(apiResponse) {
  // Create output format
  const result = {
    count: {},
    total_area: {},
    predictions: []
  };
  
  let fensterCount = 0;
  let tuerCount = 0;
  let wandCount = 0;
  let lukarneCount = 0;
  let dachCount = 0;
  let otherCount = 0;
  let lineCount = 0;
  
  let fensterArea = 0;
  let tuerArea = 0;
  let wandArea = 0;
  let lukarneArea = 0;
  let dachArea = 0;
  let otherArea = 0;
  
  // Make sure predictions is an array
  const predictions = apiResponse.predictions || [];
  
  if (Array.isArray(predictions)) {
    // Process each prediction
    predictions.forEach(pred => {
      // Determine type based on existing properties
      let predType = "rectangle";
      if (pred.type === "line" || (pred.line && pred.length !== undefined)) {
        predType = "line";
        lineCount++;
      } else if (pred.type === "polygon" || pred.polygon) {
        predType = "polygon";
      } else if (pred.box || pred.bbox) {
        predType = "rectangle";
      }
      
      // Get label information from centralized LabelsManager
      let label_name;
      let color;
      
      if (predType === "line") {
        label_name = window.LabelsManager.getLabelName(pred.label || 1, 'line');
        color = window.LabelsManager.getLabelColor(pred.label || 1, 'line');
      } else {
        label_name = window.LabelsManager.getLabelName(pred.label || 0, 'area');
        color = window.LabelsManager.getLabelColor(pred.label || 0, 'area');
        
        // Update counts and areas based on label
        switch(pred.label) {
          case 1: fensterCount++; fensterArea += pred.area || 0; break;
          case 2: tuerCount++; tuerArea += pred.area || 0; break;
          case 3: wandCount++; wandArea += pred.area || 0; break;
          case 4: lukarneCount++; lukarneArea += pred.area || 0; break;
          case 5: dachCount++; dachArea += pred.area || 0; break;
          default: otherCount++; otherArea += pred.area || 0;
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
  } else {
    console.warn("No predictions found in API response or not an array");
  }
  
  // Set summary data
  result.count = {
    fenster: fensterCount,
    tuer: tuerCount,
    wand: wandCount,
    lukarne: lukarneCount,
    dach: dachCount,
    other: otherCount,
    line: lineCount
  };
  
  result.total_area = {
    fenster: fensterArea,
    tuer: tuerArea,
    wand: wandArea,
    lukarne: lukarneArea,
    dach: dachArea,
    other: otherArea
  };
  
  // Copy PDF-specific information from the original response
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
  
  // Get image source - either from PDF or direct upload
  if (responseData.is_pdf && responseData.pdf_image_url) {
    console.log("PDF detected - Image URL:", responseData.pdf_image_url);
    uploadedImage.src = responseData.pdf_image_url + '?t=' + new Date().getTime(); // Cache-busting
  } else {
    // Regular image file
    const uploadedFile = document.getElementById('file').files[0];
    const displayImageUrl = URL.createObjectURL(uploadedFile);
    uploadedImage.src = displayImageUrl;
  }
  
  // Wait for image to load
  uploadedImage.onload = function() {
    console.log("Image loaded:", uploadedImage.width, "x", uploadedImage.height);
    
    // Use Fabric.js to display annotations
    FabricHandler.displayAnnotations(responseData.predictions);
    
    // Show results areas
    resultsSection.style.display = 'block';
    resultsTableSection.style.display = 'block';
    
    // Update summary
    updateSummary();
    
    // Fill table
    updateResultsTable();
    
    // Process PDF data if present
    if (responseData.is_pdf) {
      PdfModule.processPdfData(responseData);
    }
    
    // Simulate a resize event after a short delay to fix positioning issues
    setTimeout(function() {
      window.dispatchEvent(new Event('resize'));
    }, 200);
  };
}

/**
 * Display a specific PDF page
 * @param {number} pageNumber - The page number to display
 * @param {Object} pageData - The page data
 */
function displayPdfPage(pageNumber, pageData) {
  console.log(`Displaying page ${pageNumber}:`, pageData);
  
  // Get references to UI elements
  const uploadedImage = document.getElementById('uploadedImage');
  const resultsSection = document.getElementById('resultsSection');
  const resultsTableSection = document.getElementById('resultsTableSection');
  const errorMessage = document.getElementById('errorMessage');
  
  // Validate data format
  if (!pageData) {
    console.error(`No data found for page ${pageNumber}!`);
    return;
  }
  
  // Validate that page data has the expected structure
  if (!pageData.predictions || !Array.isArray(pageData.predictions)) {
    console.error(`Invalid data format for page ${pageNumber}:`, pageData);
    
    // Try to recover if possible
    if (pageData.count !== undefined && pageData.total_area !== undefined) {
      console.log("Data format seems correct, continuing...");
    } else {
      console.error("No predictions found, cannot display page");
      if (errorMessage) {
        errorMessage.textContent = `No valid data for page ${pageNumber}`;
        errorMessage.style.display = 'block';
      }
      return;
    }
  }
  
  // Set global data
  window.data = JSON.parse(JSON.stringify(pageData)); // Deep copy to avoid reference issues
  
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
  const allPdfPages = window.getAllPdfPages();
  const imageUrl = pageData.pdf_image_url || (allPdfPages[pageNumber-1] || '');
  
  console.log(`Displaying image: ${imageUrl}`);
  uploadedImage.src = imageUrl + '?t=' + new Date().getTime(); // Cache-busting
  
  // Show results areas
  resultsSection.style.display = 'block';
  resultsTableSection.style.display = 'block';
  
  // Update PDF navigation
  PdfModule.updatePdfNavigation();
  
  // Wait for image to load
  uploadedImage.onload = function() {
    console.log("Image loaded:", uploadedImage.width, "x", uploadedImage.height);
    
    // Use Fabric.js to display annotations
    FabricHandler.displayAnnotations(pageData.predictions);
    
    // Update summary
    updateSummary();
    
    // Fill table
    updateResultsTable();
    
    // Simulate a resize event after a short delay
    setTimeout(function() {
      window.dispatchEvent(new Event('resize'));
    }, 200);
  };
}

/**
 * Update summary display
 */
function updateSummary() {
  const summary = document.getElementById('summary');
  let summaryHtml = '';
  
  if (!window.data || !window.data.count) {
    summary.innerHTML = '';
    return;
  }
  
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
  if (window.data.count && window.data.count.line && window.data.count.line > 0) {
    summaryHtml += `<p>Linienmessungen: <strong>${window.data.count.line}</strong></p>`;
  }
  
  summary.innerHTML = summaryHtml;
}

/**
 * Update results table
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
    
    // Add hover and click effects
    row.addEventListener('mouseover', () => {
      FabricHandler.highlightObject(index, true);
    });
    
    row.addEventListener('mouseout', () => {
      FabricHandler.highlightObject(index, false);
    });
    
    // Add click handler to select in Fabric.js
    row.addEventListener('click', () => {
      FabricHandler.selectObjectByIndex(index);
    });
  });
}

/**
 * Clear all results and reset the UI
 */
function clearResults() {
  const resultsSection = document.getElementById('resultsSection');
  const resultsTableSection = document.getElementById('resultsTableSection');
  const pdfNavigation = document.getElementById('pdfNavigation');
  const uploadedImage = document.getElementById('uploadedImage');
  const resultsBody = document.getElementById('resultsBody');
  const summary = document.getElementById('summary');
  
  if (resultsSection) resultsSection.style.display = 'none';
  if (resultsTableSection) resultsTableSection.style.display = 'none';
  if (pdfNavigation) pdfNavigation.style.display = 'none';
  if (uploadedImage) uploadedImage.src = '';
  if (resultsBody) resultsBody.innerHTML = '';
  if (summary) summary.innerHTML = '';
  
  // Clear Fabric.js canvas
  FabricHandler.clearAnnotations();
}

document.addEventListener('DOMContentLoaded', function() {
  console.log("DOM fully loaded. Initializing application...");

  // Get main UI elements
  const uploadForm = document.getElementById('uploadForm');
  const formatSelect = document.getElementById('formatSelect');
  const customFormatFields = document.getElementById('customFormatFields');
  const formatWidth = document.getElementById('formatWidth');
  const formatHeight = document.getElementById('formatHeight');
  const resultsSection = document.getElementById('resultsSection');
  const resultsTableSection = document.getElementById('resultsTableSection');
  const uploadedImage = document.getElementById('uploadedImage');
  const imageContainer = document.getElementById('imageContainer');
  const resultsBody = document.getElementById('resultsBody');
  const summary = document.getElementById('summary');
  const loader = document.getElementById('loader');
  const errorMessage = document.getElementById('errorMessage');

  // PDF navigation elements
  const pdfNavigation = document.getElementById('pdfNavigation');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const currentPageSpan = document.getElementById('currentPage');
  const totalPagesSpan = document.getElementById('totalPages');
  const reprocessBtn = document.getElementById('reprocessBtn');
  
  // Project elements
  const projectList = document.getElementById('projectList');
  const saveProjectBtn = document.getElementById('saveProjectBtn');
  const loadProjectBtn = document.getElementById('loadProjectBtn');
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  const exportAnnotatedPdfBtn = document.getElementById('exportAnnotatedPdfBtn');
  
  // Label manager elements
  const labelManagerModal = document.getElementById('labelManagerModal');
  const manageLabelBtn = document.getElementById('manageLabelBtn');
  const closeModalBtn = labelManagerModal ? labelManagerModal.querySelector('.close') : null;
  const labelTableBody = document.getElementById('labelTableBody');
  const addLabelBtn = document.getElementById('addLabelBtn');
  const importLabelsBtn = document.getElementById('importLabelsBtn');
  const exportLabelsBtn = document.getElementById('exportLabelsBtn');
  const resetLabelsBtn = document.getElementById('resetLabelsBtn');
  const labelForm = document.getElementById('labelForm');
  const labelFormTitle = document.getElementById('labelFormTitle');
  const labelIdInput = document.getElementById('labelId');
  const labelNameInput = document.getElementById('labelName');
  const labelColorInput = document.getElementById('labelColor');
  const saveLabelBtn = document.getElementById('saveLabelBtn');
  const cancelLabelBtn = document.getElementById('cancelLabelBtn');
  const areaLabelsTab = document.getElementById('areaLabelsTab');
  const lineLabelsTab = document.getElementById('lineLabelsTab');
  const resetZoomBtn = document.getElementById('resetZoomBtn');
  
  // Editor elements
  const editorToggle = document.getElementById('editorToggle');
  const addBoxBtn = document.getElementById('addBoxBtn');
  const addPolygonBtn = document.getElementById('addPolygonBtn');
  const addLineBtn = document.getElementById('addLineBtn');
  const editBoxBtn = document.getElementById('editBoxBtn');
  const deleteBoxBtn = document.getElementById('deleteBoxBtn');
  const saveEditBtn = document.getElementById('saveEditBtn');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const objectTypeSelect = document.getElementById('objectTypeSelect');
  const lineTypeSelect = document.getElementById('lineTypeSelect');

  // Check if all required elements are present
  console.log("Main UI elements loaded:", {
    uploadForm: !!uploadForm,
    resultsSection: !!resultsSection,
    uploadedImage: !!uploadedImage
  });
  
  // Initialize modules
  
  // 1. Setup zoom functionality
  ZoomModule.setupZoom({
    imageContainer,
    uploadedImage,
    resetZoomBtn
  });
  
  // Make getCurrentZoom accessible globally for other modules
  window.getCurrentZoom = ZoomModule.getCurrentZoom;
  
  // 2. Setup PDF handler
  PdfModule.setupPdfHandler({
    pdfNavigation,
    currentPageSpan,
    totalPagesSpan,
    prevPageBtn,
    nextPageBtn,
    reprocessBtn,
    loader,
    errorMessage
  });
  
  // Set callback for displaying PDF pages
  PdfModule.setDisplayPageCallback(displayPdfPage);
  
  // 3. Setup project functionality
  ProjectModule.setupProject({
    projectList,
    saveProjectBtn,
    loadProjectBtn,
    exportPdfBtn,
    exportAnnotatedPdfBtn
  }, {
    pdfModule: PdfModule
  });
  
  // Make project functions globally accessible
  window.saveProject = ProjectModule.saveProject;
  window.loadProjectList = ProjectModule.loadProjectList;
  window.loadProject = ProjectModule.loadProject;
  
  // 4. Setup labels management
  LabelsModule.setupLabels({
    labelManagerModal,
    manageLabelBtn,
    closeModalBtn,
    labelTableBody,
    addLabelBtn,
    importLabelsBtn,
    exportLabelsBtn,
    resetLabelsBtn,
    labelForm,
    labelFormTitle,
    labelIdInput,
    labelNameInput,
    labelColorInput,
    saveLabelBtn,
    cancelLabelBtn,
    areaLabelsTab,
    lineLabelsTab
  });
  
  // Make updateUIForLabels globally accessible
  window.updateUIForLabels = LabelsModule.updateUIForLabels;
  
  // 5. Setup Fabric.js handler
  FabricHandler.setupFabricHandler({
    imageContainer,
    uploadedImage
  });
  
  // Format selection handler for manual adjustments
  if (formatSelect) {
    formatSelect.addEventListener('change', function() {
      if (formatSelect.value === 'auto') {
        // Enable automatic detection (hide format fields)
        customFormatFields.style.display = 'none';
        // Here you could restore detected values
      } else if (formatSelect.value === 'custom') {
        // Custom format (show fields)
        customFormatFields.style.display = 'block';
      } else {
        // Predefined formats
        customFormatFields.style.display = 'none';
        
        // Standard format sizes
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
        
        const size = formatSizes[formatSelect.value];
        if (size) {
          formatWidth.value = size[0];
          formatHeight.value = size[1];
        }
      }
    });
  }
  
  // Initialize Editor
  if (typeof window.initEditor === 'function') {
    window.initEditor({
      uploadedImage: uploadedImage,
      imageContainer: imageContainer,
      resultsSection: resultsSection,
      updateSummary: updateSummary,
      updateResultsTable: updateResultsTable
    });
  } else {
    console.warn("Editor initialization function not found. Please ensure editor.js is loaded before the main script.");
  }

  // Setup event handlers for Fabric.js editor buttons
  if (editorToggle) {
    editorToggle.addEventListener('click', function() {
      const isActive = this.classList.contains('active');
      
      if (!isActive) {
        // Enable editor
        this.classList.add('active');
        this.textContent = 'Editor ausschalten';
        
        // Enable Fabric.js editing
        if (typeof FabricHandler.enableEditing === 'function') {
          FabricHandler.enableEditing();
        }
      } else {
        // Disable editor
        this.classList.remove('active');
        this.textContent = 'Editor einschalten';
        
        // Disable Fabric.js editing and save changes
        if (typeof FabricHandler.disableEditing === 'function') {
          FabricHandler.disableEditing();
        }
        
        if (typeof FabricHandler.saveAnnotations === 'function') {
          FabricHandler.saveAnnotations();
        }
      }
    });
  }

  // Add functionality for editor buttons
  if (addBoxBtn) {
    addBoxBtn.addEventListener('click', function() {
      // Get selected label ID
      const labelId = parseInt(objectTypeSelect.value);
      
      // Enable rectangle drawing
      if (typeof FabricHandler.enableDrawingMode === 'function') {
        FabricHandler.enableDrawingMode('rectangle', labelId);
      }
      
      // Update UI
      addBoxBtn.classList.add('active');
      editBoxBtn.classList.remove('active');
      deleteBoxBtn.classList.remove('active');
      if (addPolygonBtn) addPolygonBtn.classList.remove('active');
      if (addLineBtn) addLineBtn.classList.remove('active');
    });
  }

  if (addPolygonBtn) {
    addPolygonBtn.addEventListener('click', function() {
      // Get selected label ID
      const labelId = parseInt(objectTypeSelect.value);
      
      // Enable polygon drawing
      if (typeof FabricHandler.enableDrawingMode === 'function') {
        FabricHandler.enableDrawingMode('polygon', labelId);
      }
      
      // Update UI
      addBoxBtn.classList.remove('active');
      editBoxBtn.classList.remove('active');
      deleteBoxBtn.classList.remove('active');
      addPolygonBtn.classList.add('active');
      if (addLineBtn) addLineBtn.classList.remove('active');
    });
  }

  if (addLineBtn) {
    addLineBtn.addEventListener('click', function() {
      // Get selected line label ID
      const labelId = parseInt(lineTypeSelect ? lineTypeSelect.value : 1);
      
      // Enable line drawing
      if (typeof FabricHandler.enableDrawingMode === 'function') {
        FabricHandler.enableDrawingMode('line', labelId);
      }
      
      // Update UI
      addBoxBtn.classList.remove('active');
      editBoxBtn.classList.remove('active');
      deleteBoxBtn.classList.remove('active');
      if (addPolygonBtn) addPolygonBtn.classList.remove('active');
      addLineBtn.classList.add('active');
    });
  }

  if (editBoxBtn) {
    editBoxBtn.addEventListener('click', function() {
      // Enable editing mode
      if (typeof FabricHandler.enableEditing === 'function') {
        FabricHandler.enableEditing();
      }
      
      // Update UI
      addBoxBtn.classList.remove('active');
      editBoxBtn.classList.add('active');
      deleteBoxBtn.classList.remove('active');
      if (addPolygonBtn) addPolygonBtn.classList.remove('active');
      if (addLineBtn) addLineBtn.classList.remove('active');
    });
  }

  if (deleteBoxBtn) {
    deleteBoxBtn.addEventListener('click', function() {
      // Delete selected object
      if (typeof FabricHandler.deleteSelected === 'function') {
        FabricHandler.deleteSelected();
      }
      
      // Save changes
      if (typeof FabricHandler.saveAnnotations === 'function') {
        FabricHandler.saveAnnotations();
      }
    });
  }

  if (saveEditBtn) {
    saveEditBtn.addEventListener('click', function() {
      // Save annotations
      if (typeof FabricHandler.saveAnnotations === 'function') {
        FabricHandler.saveAnnotations();
      }
      
      // Update UI
      if (editorToggle) {
        editorToggle.classList.remove('active');
        editorToggle.textContent = 'Editor einschalten';
      }
      
      // Disable editing mode
      if (typeof FabricHandler.disableEditing === 'function') {
        FabricHandler.disableEditing();
      }
    });
  }

  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', function() {
      // Reload original annotations without saving changes
      if (typeof FabricHandler.cancelEditing === 'function') {
        FabricHandler.cancelEditing();
      }
      
      // Update UI
      if (editorToggle) {
        editorToggle.classList.remove('active');
        editorToggle.textContent = 'Editor einschalten';
      }
    });
  }

  // Object type selection change handler
  if (objectTypeSelect) {
    objectTypeSelect.addEventListener('change', function() {
      const labelId = parseInt(this.value);
      
      // Change label of selected object
      if (typeof FabricHandler.changeSelectedLabel === 'function') {
        FabricHandler.changeSelectedLabel(labelId);
      }
    });
  }

  // Line type selection change handler
  if (lineTypeSelect) {
    lineTypeSelect.addEventListener('change', function() {
      const labelId = parseInt(this.value);
      
      // Change label of selected line
      if (typeof FabricHandler.changeSelectedLineType === 'function') {
        FabricHandler.changeSelectedLineType(labelId);
      }
    });
  }

  // Add keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    // Check if editor is active
    const isEditorActive = editorToggle && editorToggle.classList.contains('active');
    
    if (isEditorActive) {
      // Delete key - delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typeof FabricHandler.deleteSelected === 'function') {
          FabricHandler.deleteSelected();
          
          // Save changes
          if (typeof FabricHandler.saveAnnotations === 'function') {
            FabricHandler.saveAnnotations();
          }
        }
      }
      
      // Ctrl+C - Copy
      if (e.ctrlKey && e.key === 'c') {
        if (typeof FabricHandler.copySelected === 'function') {
          FabricHandler.copySelected();
        }
      }
      
      // Esc - Exit drawing mode
      if (e.key === 'Escape') {
        // Enable edit mode
        if (typeof FabricHandler.enableEditing === 'function') {
          FabricHandler.enableEditing();
        }
        
        // Update UI
        if (addBoxBtn) addBoxBtn.classList.remove('active');
        if (editBoxBtn) editBoxBtn.classList.add('active');
        if (deleteBoxBtn) deleteBoxBtn.classList.remove('active');
        if (addPolygonBtn) addPolygonBtn.classList.remove('active');
        if (addLineBtn) addLineBtn.classList.remove('active');
      }
    }
  });

  // Form submission handler
  if (uploadForm) {
    uploadForm.addEventListener('submit', function(e) {
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
      loader.style.display = 'block';
      errorMessage.style.display = 'none';
      
      // Reset stored data when starting a new analysis
      PdfModule.resetPdfState();
      
      const formData = new FormData(uploadForm);
      
      // API call for real data
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
        
        // Check if data is present
        if (!data.predictions || data.predictions.length === 0) {
          console.warn("No predictions found in response!");
        } else {
          console.log(`${data.predictions.length} predictions received`);
        }
        
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
        errorMessage.textContent = 'Error: ' + error.message;
        errorMessage.style.display = 'block';
        
        loader.style.display = 'none';
      });
    });
  }
  
  // Create a global function to get PDF pages
  window.getAllPdfPages = function() {
    // Check if the function exists in the module first
    if (typeof PdfModule.getAllPdfPages === 'function') {
      return PdfModule.getAllPdfPages();
    }
    // Fallback to empty array
    return [];
  };
  
  // Make functions available globally
  window.displayPdfPage = displayPdfPage;
  window.processApiResponse = processApiResponse;
  window.updateSummary = updateSummary;
  window.updateResultsTable = updateResultsTable;
  window.clearResults = clearResults;
});