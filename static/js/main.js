/**
 * main.js - Main application for Fenster-Erkennungstool
 * This file coordinates the modules and handles the primary application flow
 */

// Import modules
import * as ZoomModule from './zoom.js';
import * as AnnotationsModule from './annotations.js';
import * as PdfModule from './pdf-handler.js';
import * as ProjectModule from './project.js';
import * as LabelsModule from './labels.js';

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
        
        // Check if a custom label exists for this ID
        const customLabel = window.currentLabels ? window.currentLabels.find(l => l.id === pred.label) : null;
        let label_name;
        
        if (customLabel) {
          label_name = customLabel.name;
        } else {
          // Fallback to standard names
          switch(pred.label) {
            case 1: 
              label_name = "Fenster";
              if (predType !== "line") {
                fensterCount++;
                fensterArea += pred.area || 0;
              }
              break;
            case 2: 
              label_name = "Tür";
              if (predType !== "line") {
                tuerCount++;
                tuerArea += pred.area || 0;
              }
              break;
            case 3: 
              label_name = "Wand";
              if (predType !== "line") {
                wandCount++;
                wandArea += pred.area || 0;
              }
              break;
            case 4: 
              label_name = "Lukarne";
              if (predType !== "line") {
                lukarneCount++;
                lukarneArea += pred.area || 0;
              }
              break;
            case 5: 
              label_name = "Dach";
              if (predType !== "line") {
                dachCount++;
                dachArea += pred.area || 0;
              }
              break;
            default: 
              label_name = predType === "line" ? "Messlinie" : "Andere";
              if (predType !== "line") {
                otherCount++;
                otherArea += pred.area || 0;
              }
          }
        }
        
        // Update counts and areas based on label
        if (customLabel && predType !== "line") {
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
          label_name: label_name
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
  const annotationOverlay = document.getElementById('annotationOverlay');
  const resultsBody = document.getElementById('resultsBody');
  const summary = document.getElementById('summary');
  const loader = document.getElementById('loader');
  const errorMessage = document.getElementById('errorMessage');
  
  // Toggle buttons
  const toggleFenster = document.getElementById('toggleFenster');
  const toggleTuer = document.getElementById('toggleTuer');
  const toggleWand = document.getElementById('toggleWand');
  const toggleLukarne = document.getElementById('toggleLukarne');
  const toggleDach = document.getElementById('toggleDach');

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

  // Check if all required elements are present
  console.log("Main UI elements loaded:", {
    uploadForm: !!uploadForm,
    resultsSection: !!resultsSection,
    uploadedImage: !!uploadedImage
  })
});
 
/**
 * Display results in the UI
 * @param {Object} responseData - The processed response data
 */
function displayResults(responseData) {
  console.log("Displaying results:", responseData);
  
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
    
    // Clear existing annotations
    AnnotationsModule.clearAnnotations();
    
    // Adapt SVG overlay
    AnnotationsModule.adaptSvgOverlay();
    
    // Show results areas
    resultsSection.style.display = 'block';
    resultsTableSection.style.display = 'block';
    
    // Update summary
    updateSummary();
    
    // Fill table
    updateResultsTable();
    
    // Add annotations
    responseData.predictions.forEach((pred, index) => {
      AnnotationsModule.addAnnotation(pred, index);
    });
    
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
      const errorMessage = document.getElementById('errorMessage');
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
  const imageUrl = pageData.pdf_image_url || PdfModule.getAllPdfPages()[pageNumber-1];
  
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
    
    // Clear existing annotations
    AnnotationsModule.clearAnnotations();
    
    // Adapt SVG overlay
    AnnotationsModule.adaptSvgOverlay();
    
    // Update summary
    updateSummary();
    
    // Fill table
    updateResultsTable();
    
    // Add annotations
    if (window.data && window.data.predictions && window.data.predictions.length > 0) {
      console.log(`Adding ${window.data.predictions.length} annotations`);
      window.data.predictions.forEach((pred, index) => {
        AnnotationsModule.addAnnotation(pred, index);
      });
    } else {
      console.warn("No predictions found for annotations");
    }
    
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
    summaryHtml += `<p>Found windows: <strong>${window.data.count.fenster}</strong> (${window.data.total_area.fenster.toFixed(2)} m²)</p>`;
  }
  
  if (window.data.count.tuer > 0) {
    summaryHtml += `<p>Found doors: <strong>${window.data.count.tuer}</strong> (${window.data.total_area.tuer.toFixed(2)} m²)</p>`;
  }
  
  if (window.data.count.wand > 0) {
    summaryHtml += `<p>Found walls: <strong>${window.data.count.wand}</strong> (${window.data.total_area.wand.toFixed(2)} m²)</p>`;
  }
  
  if (window.data.count.lukarne > 0) {
    summaryHtml += `<p>Found skylights: <strong>${window.data.count.lukarne}</strong> (${window.data.total_area.lukarne.toFixed(2)} m²)</p>`;
  }
  
  if (window.data.count.dach > 0) {
    summaryHtml += `<p>Found roofs: <strong>${window.data.count.dach}</strong> (${window.data.total_area.dach.toFixed(2)} m²)</p>`;
  }
  
  if (window.data.count.other > 0) {
    summaryHtml += `<p>Other objects: <strong>${window.data.count.other}</strong> (${window.data.total_area.other.toFixed(2)} m²)</p>`;
  }

  // For line measurements, display separately
  if (window.data.count && window.data.count.line && window.data.count.line > 0) {
    summaryHtml += `<p>Line measurements: <strong>${window.data.count.line}</strong></p>`;
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
    
    // Find the matching label for this prediction
    let labelName = pred.label_name || "Other";
    
    // Choose label collection based on type
    if (pred.type === "line") {
      // For lines, use the stored label_name directly
      labelName = pred.label_name || "Measurement";
    } else {
      // For area objects, look up in currentLabels
      const customLabel = window.currentLabels ? 
        window.currentLabels.find(l => l.id === pred.label) : null;
      if (customLabel) {
        labelName = customLabel.name;
      }
    }
    
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
      <td>${labelName}</td>
      <td>${pred.type || (pred.polygon ? "Polygon" : "Rectangle")}</td>
      <td>${(pred.score * 100).toFixed(1)}%</td>
      <td>${measurementValue}</td>
    `;
    
    resultsBody.appendChild(row);
    
    // Highlight on hover over table
    const elementId = `annotation-${index}`;
    row.addEventListener('mouseover', () => {
      AnnotationsModule.highlightBox(elementId, true);
    });
    row.addEventListener('mouseout', () => {
      AnnotationsModule.highlightBox(elementId, false);
    });
  });
}

/**
 * Clear all results and reset the UI
 */
function clearResults() {
  resultsSection.style.display = 'none';
  resultsTableSection.style.display = 'none';
  document.getElementById('pdfNavigation').style.display = 'none';
  uploadedImage.src = '';
  document.getElementById('resultsBody').innerHTML = '';
  document.getElementById('summary').innerHTML = '';
  
  // Clear all annotations
  AnnotationsModule.clearAnnotations();
}

// Make clearResults available globally
window.clearResults = clearResults;
  
  // Initialize modules
  
  // 1. Setup zoom functionality
  ZoomModule.setupZoom({
    imageContainer,
    uploadedImage,
    annotationOverlay,
    resetZoomBtn
  });
  
  // Make getCurrentZoom accessible globally for other modules
  window.getCurrentZoom = ZoomModule.getCurrentZoom;
  
  // 2. Setup annotations handling
  AnnotationsModule.setupAnnotations({
    imageContainer,
    uploadedImage,
    annotationOverlay
  });
  
  // Make addAnnotation accessible globally
  window.addAnnotation = AnnotationsModule.addAnnotation;
  window.clearAnnotations = AnnotationsModule.clearAnnotations;
  window.highlightBox = AnnotationsModule.highlightBox;
  
  // 3. Setup PDF handler
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
  
  // 4. Setup project functionality
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
  
  // 5. Setup labels management
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
  
  // Format selection handler for manual adjustments
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
  
  // Toggle button handlers
  toggleFenster.addEventListener('click', function() {
    this.classList.toggle('active');
    const fensterElements = document.querySelectorAll('.fenster-annotation, .fenster-box, .fenster-label');
    fensterElements.forEach(el => {
      el.style.display = this.classList.contains('active') ? 'block' : 'none';
    });
  });
  
  toggleTuer.addEventListener('click', function() {
    this.classList.toggle('active');
    const tuerElements = document.querySelectorAll('.tuer-annotation, .tuer-box, .tuer-label');
    tuerElements.forEach(el => {
      el.style.display = this.classList.contains('active') ? 'block' : 'none';
    });
  });
  
  toggleWand.addEventListener('click', function() {
    this.classList.toggle('active');
    const wandElements = document.querySelectorAll('.wand-annotation, .wand-box, .wand-label');
    wandElements.forEach(el => {
      el.style.display = this.classList.contains('active') ? 'block' : 'none';
    });
  });
  
  toggleLukarne.addEventListener('click', function() {
    this.classList.toggle('active');
    const lukarneElements = document.querySelectorAll('.lukarne-annotation, .lukarne-box, .lukarne-label');
    lukarneElements.forEach(el => {
      el.style.display = this.classList.contains('active') ? 'block' : 'none';
    });
  });
  
  toggleDach.addEventListener('click', function() {
    this.classList.toggle('active');
    const dachElements = document.querySelectorAll('.dach-annotation, .dach-box, .dach-label');
    dachElements.forEach(el => {
      el.style.display = this.classList.contains('active') ? 'block' : 'none';
    });
  });
  
  // Initialize Editor
  if (typeof window.initEditor === 'function') {
    window.initEditor({
      uploadedImage: uploadedImage,
      imageContainer: imageContainer,
      annotationOverlay: annotationOverlay,
      resultsSection: resultsSection,
      updateSummary: updateSummary,
      updateResultsTable: updateResultsTable,
      addAnnotation: AnnotationsModule.addAnnotation
    });
  } else {
    console.warn("Editor initialization function not found. Please ensure editor.js is loaded before the main script.");
  }

  // Form submission handler
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
  
  // Make displayPdfPage available globally
  window.displayPdfPage = displayPdfPage;
  
  // Make processApiResponse available globally
  window.processApiResponse = processApiResponse;
