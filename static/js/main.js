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
window.isEditorActive = false;


/**
 * Convert API response to desired format
 * @param {Object} apiResponse - The original API response
 * @returns {Object} Processed data in the desired format
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
  
  // Make sure predictions is an array
  const predictions = apiResponse.predictions || [];
  
  if (Array.isArray(predictions)) {
    // Process each prediction
    predictions.forEach(pred => {
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
  } else {
    console.warn("No predictions found in API response or not an array");
  }
  
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
 * Funktion wird am Anfang nach "Plan analysieren" aufgerufen
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
  
  // WICHTIG: Standardmäßig Ergebnisbereich anzeigen
  resultsSection.style.display = 'block';
  resultsTableSection.style.display = 'block';
  
  // Get image source - either from PDF or direct upload
  if (responseData.is_pdf && responseData.pdf_image_url) {
    console.log("PDF detected - Image URL:", responseData.pdf_image_url);
    uploadedImage.src = responseData.pdf_image_url + '?t=' + new Date().getTime(); // Cache-busting
    
    // Process PDF-specific data first, um sicherzustellen, dass das PdfModule richtig eingerichtet ist
    // REIHENFOLGE GEÄNDERT: Zuerst PDF-Daten verarbeiten
    PdfModule.processPdfData(responseData);
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
    
    // NEUE LÖSUNG: Eine minimale "Bewegung" simulieren, um die Annotationen zu aktualisieren
    setTimeout(function() {
      // Eine "minimale" Zoom-Änderung, die den Nebeneffekt hat, die Annotationen neu zu positionieren
      if (window.FabricHandler && typeof window.FabricHandler.syncEditorZoom === 'function') {
        console.log("Applying micro-adjustment to trigger correct positioning");
        const currentZoom = window.getCurrentZoom ? window.getCurrentZoom() : 1.0;
        
        // Zoom minimal ändern und zurücksetzen, um die Neupositionierung auszulösen
        window.FabricHandler.syncEditorZoom(currentZoom + 0.001);
        
        // Nach kurzer Verzögerung den originalen Zoom wiederherstellen
        setTimeout(function() {
          window.FabricHandler.syncEditorZoom(currentZoom);
        }, 20);
      }
    }, 100);
  };
}

/**
 * Display a specific PDF page
 * Funktion wird beim Seitenwechsel aufgerufen
 * @param {number} pageNumber - The page number to display
 * @param {Object} pageData - The page data
 */
function displayPdfPage(pageNumber, pageData) {
  console.log(`Displaying page ${pageNumber}:`, pageData);

  // Speichern des aktuellen Editor-Modus
  const wasEditorActive = window.isEditorActive;
  
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
  
  // WICHTIG: Speichere den aktuellen Zoom-Wert vor dem Laden des neuen Bildes
  const currentZoom = window.getCurrentZoom ? window.getCurrentZoom() : 1.0;
  console.log(`Current zoom before loading page: ${currentZoom}`);
  
  // Lade das Bild
  uploadedImage.src = imageUrl + '?t=' + new Date().getTime(); // Cache-busting

  // Nach Abschluss des Ladens den richtigen Modus wiederherstellen
  if (wasEditorActive && typeof window.FabricHandler !== 'undefined') {
    window.FabricHandler.enableEditing();
  } else if (typeof window.FabricHandler !== 'undefined') {
    window.FabricHandler.disableEditing();
  }
  
  // Show results areas
  resultsSection.style.display = 'block';
  resultsTableSection.style.display = 'block';
  
  // Update PDF navigation
  PdfModule.updatePdfNavigation();
  
  // Wait for image to load
  uploadedImage.onload = function() {
    console.log("Image loaded:", uploadedImage.width, "x", uploadedImage.height);
    
    // WICHTIGE ÄNDERUNG: Canvas komplett zurücksetzen und neu initialisieren
    if (window.FabricHandler) {
      // 1. Canvas zurücksetzen
      window.FabricHandler.clearAnnotations();
      
      // 2. Canvas mit dem gespeicherten Zoom-Wert initialisieren
      setTimeout(function() {
        // Stell sicher, dass das Bild den richtigen Zoom hat
        uploadedImage.style.transform = `scale(${currentZoom})`;
        uploadedImage.style.transformOrigin = 'top left';
        
        console.log("Reinitializing canvas with zoom:", currentZoom);
        
        // Canvas neu initialisieren (damit er die aktuelle Bildgröße berücksichtigt)
        if (typeof window.FabricHandler.initCanvas === 'function') {
          const canvas = window.FabricHandler.initCanvas();
          
          // 3. Erst danach die Annotationen anzeigen
          if (canvas) {
            setTimeout(function() {
              console.log("Displaying annotations after canvas initialization");
              window.FabricHandler.displayAnnotations(pageData.predictions);
              
              // Explizit den Canvas mit dem aktuellen Zoom synchronisieren
              window.FabricHandler.syncEditorZoom(currentZoom);
            }, 50);
          }
        }
      }, 100);
    }
    
    // Update summary
    updateSummary();
    
    // Fill table
    updateResultsTable();
    
    // Simulate a resize event after a short delay
    //setTimeout(function() {
    //  window.dispatchEvent(new Event('resize'));
    //}, 200);
  };
}

/**
 * Aktualisiert die PDF-Seitendaten mit den aktuellen Annotationen
 * @param {Object} data - Die aktualisierten Daten
 */
function updatePdfPageData(data) {
  if (!data) return;
  
  // Aktualisiere die Daten für die aktuelle Seite
  let currentPage = 1;
  if (data.current_page) {
      currentPage = parseInt(data.current_page);
  }
  
  console.log(`Aktualisiere PDF-Daten für Seite ${currentPage}`);
  
  // PDF-Handler verwenden, falls verfügbar
  if (typeof PdfModule !== 'undefined' && typeof PdfModule.getPdfPageData === 'function') {
      const pdfPageData = PdfModule.getPdfPageData();
      if (pdfPageData) {
          pdfPageData[currentPage] = JSON.parse(JSON.stringify(data));
          console.log(`PDF-Seitendaten für Seite ${currentPage} aktualisiert`);
      }
  }
}

// Funktion global verfügbar machen
window.updatePdfPageData = updatePdfPageData;

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

/**
 * Aktualisiert die Anzeige der Annotationen im normalen Ansichtsview
 */
function updateAnnotationsDisplay() {
  console.log("Aktualisiere Annotations-Anzeige im Ansichtsview");
  
  if (!window.data || !window.data.predictions) {
      console.warn("Keine Daten zum Anzeigen vorhanden");
      return;
  }
  
  // Aktuelle Seite bestimmen (bei PDF)
  let currentPage = 1;
  if (window.data.current_page) {
      currentPage = parseInt(window.data.current_page);
  }
  
  console.log(`Aktualisiere Seite ${currentPage} mit ${window.data.predictions.length} Annotationen`);
  
  // Bei Fabric.js Canvas im Anzeigemodus
  if (typeof window.FabricHandler !== 'undefined' && typeof window.FabricHandler.displayAnnotations === 'function') {
      // Fabric.js Canvas im Anzeigemodus aktualisieren
      window.FabricHandler.clearAnnotations();
      window.FabricHandler.displayAnnotations(window.data.predictions);
  }
  
  // Aktualisiere Zusammenfassung und Tabelle
  if (typeof window.updateSummary === 'function') {
      window.updateSummary();
  }
  
  if (typeof window.updateResultsTable === 'function') {
      window.updateResultsTable();
  }
}

// Funktion global verfügbar machen
window.updateAnnotationsDisplay = updateAnnotationsDisplay;

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
    currentPageSpan: document.getElementById('currentPageSpan'),
    totalPagesSpan: document.getElementById('totalPagesSpan'),
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
  ZoomModule.setupZoom({
    imageContainer: elements.imageContainer,
    uploadedImage: elements.uploadedImage,
    resetZoomBtn: elements.resetZoomBtn
  });
  
  // 2. Setup PDF handler
  PdfModule.setupPdfHandler({
    pdfNavigation: document.getElementById('pdfNavigation'),  // Direkt das Element abrufen
    currentPageSpan: document.getElementById('currentPage'),  // Direkt das Element abrufen
    totalPagesSpan: document.getElementById('totalPages'),    // Direkt das Element abrufen
    prevPageBtn: document.getElementById('prevPageBtn'),      // Direkt das Element abrufen
    nextPageBtn: document.getElementById('nextPageBtn'),      // Direkt das Element abrufen
    reprocessBtn: document.getElementById('reprocessBtn'),    // Direkt das Element abrufen
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
  
  // 6. Initialize Editor if the function exists
  if (typeof window.initEditor === 'function') {
    window.initEditor({
      uploadedImage: elements.uploadedImage,
      imageContainer: elements.imageContainer,
      resultsSection: elements.resultsSection,
      updateSummary: updateSummary,
      updateResultsTable: updateResultsTable
    });
  } else {
    console.warn("Editor initialization function not found. Please ensure editor.js is loaded before the main script.");
  }
}

function toggleEditor() {
  console.log("Toggling editor mode, current state:", window.isEditorActive);
  
  // Toggle editor state
  window.isEditorActive = !window.isEditorActive;
  
  // Update UI - mit Null-Checks
  const editorToggle = document.getElementById('editorToggle');
  const editorControls = document.querySelector('.editor-controls');
  const imageContainer = document.getElementById('imageContainer');
  const editorSection = document.getElementById('editorSection'); // Falls noch verwendet
  
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
    
    // Überprüfen, ob editorSection noch verwendet wird
    if (editorSection) editorSection.style.display = 'block';
    
    // Enable editing mode in FabricHandler
    if (window.FabricHandler && typeof window.FabricHandler.enableEditing === 'function') {
      try {
        // Save original state for comparison or cancellation
        if (typeof window.FabricHandler.saveOriginalState === 'function') {
          window.FabricHandler.saveOriginalState();
        }
        // Enable editing
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
    if (editorSection) editorSection.style.display = 'none';
    
    // Save changes and disable editing mode
    if (window.FabricHandler && typeof window.FabricHandler.saveAnnotations === 'function') {
      try {
        window.FabricHandler.saveAnnotations();
        if (typeof window.FabricHandler.disableEditing === 'function') {
          window.FabricHandler.disableEditing();
        }
        
        // Update UI
        if (typeof window.updateSummary === 'function') window.updateSummary();
        if (typeof window.updateResultsTable === 'function') window.updateResultsTable();
      } catch (e) {
        console.error("Fehler beim Deaktivieren des Bearbeitungsmodus:", e);
      }
    }
  }
}

// Mache die toggleEditor-Funktion global verfügbar
window.toggleEditor = toggleEditor;

// Dieser Block kommt direkt nach der toggleEditor-Funktion
document.addEventListener('DOMContentLoaded', function() {
  // Event-Listener für den Bearbeitungsmodus-Button neu setzen
  const editorToggleBtn = document.getElementById('editorToggle');
  if (editorToggleBtn) {
    // Alte Event-Listener entfernen
    const clone = editorToggleBtn.cloneNode(true);
    editorToggleBtn.parentNode.replaceChild(clone, editorToggleBtn);
    
    // Neuen Event-Listener hinzufügen
    clone.addEventListener('click', toggleEditor);
  }
});



/**
 * Set up all event handlers for the application
 * @param {Object} elements - DOM elements for event handlers
 */
function setupEventHandlers(elements) {
  // Format selection handler
  setupFormatSelection(elements.formatSelect, elements.customFormatFields);
  
  // Form submission handler
  setupFormSubmission(elements.uploadForm, elements.loader, elements.errorMessage);
  
  // Editor toggle
  if (elements.editorToggle) {
    elements.editorToggle.addEventListener('click', toggleEditor);
  }
  
  // Editor buttons
  setupEditorButtons(elements);
  
  // Setup keyboard shortcuts
  setupKeyboardShortcuts();
}

// In main.js
function setupEditorButtons(elements) {
  if (!elements.addBoxBtn || !elements.addPolygonBtn || !elements.addLineBtn || 
      !elements.editBoxBtn || !elements.deleteBoxBtn) {
    return;
  }
  
  // Drawing mode buttons
  elements.addBoxBtn.addEventListener('click', function() {
    setActiveButton(this);
    const labelId = parseInt(elements.objectTypeSelect.value);
    window.FabricHandler.enableDrawingMode('rectangle', labelId);
  });
  
  elements.addPolygonBtn.addEventListener('click', function() {
    setActiveButton(this);
    const labelId = parseInt(elements.objectTypeSelect.value);
    window.FabricHandler.enableDrawingMode('polygon', labelId);
  });
  
  elements.addLineBtn.addEventListener('click', function() {
    setActiveButton(this);
    const lineTypeSelect = elements.lineTypeSelect;
    const labelId = lineTypeSelect ? parseInt(lineTypeSelect.value) : 1;
    window.FabricHandler.enableDrawingMode('line', labelId);
    
    // Toggle visibility of label selectors
    toggleLabelSelectors('line');
  });
  
  elements.editBoxBtn.addEventListener('click', function() {
    setActiveButton(this);
    window.FabricHandler.enableEditing();
    toggleLabelSelectors('area');
  });
  
  elements.deleteBoxBtn.addEventListener('click', function() {
    window.FabricHandler.deleteSelected();
  });
  
  // Action buttons
  elements.saveEditBtn.addEventListener('click', function() {
    window.FabricHandler.saveAnnotations();
    toggleEditor(); // Exit editor mode
  });
  
  elements.cancelEditBtn.addEventListener('click', function() {
    window.FabricHandler.cancelEditing();
    toggleEditor(); // Exit editor mode
  });
  
  // Type select changes
  elements.objectTypeSelect.addEventListener('change', function() {
    const labelId = parseInt(this.value);
    window.FabricHandler.changeSelectedLabel(labelId);
  });
  
  elements.lineTypeSelect.addEventListener('change', function() {
    const labelId = parseInt(this.value);
    window.FabricHandler.changeSelectedLineType(labelId);
  });
}

// Hilfsfunktion für aktiven Button
function setActiveButton(activeButton) {
  const buttons = [
    document.getElementById('addBoxBtn'),
    document.getElementById('addPolygonBtn'),
    document.getElementById('addLineBtn'),
    document.getElementById('editBoxBtn'),
    document.getElementById('deleteBoxBtn')
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

// Hilfsfunktion zum Umschalten zwischen Flächenlabels und Linienlabels
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
 * Set up format selection dropdown handler
 * @param {HTMLElement} formatSelect - Format selection dropdown
 * @param {HTMLElement} customFormatFields - Custom format fields container
 */
function setupFormatSelection(formatSelect, customFormatFields) {
  if (!formatSelect || !customFormatFields) return;
  
  formatSelect.addEventListener('change', function() {
    if (formatSelect.value === 'auto') {
      // Enable automatic detection (hide format fields)
      customFormatFields.style.display = 'none';
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
        document.getElementById('formatWidth').value = size[0];
        document.getElementById('formatHeight').value = size[1];
      }
    }
  });
}

/**
 * Set up form submission handler
 * @param {HTMLElement} uploadForm - Upload form element
 * @param {HTMLElement} loader - Loader element
 * @param {HTMLElement} errorMessage - Error message element
 */
function setupFormSubmission(uploadForm, loader, errorMessage) {
  if (!uploadForm) return;
  
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
      errorMessage.textContent = 'Error: ' + error.message;
      errorMessage.style.display = 'block';
      
      loader.style.display = 'none';
    });
  });
}

/**
 * Set up editor controls event handlers
 * @param {Object} elements - DOM elements for editor controls
 */
function setupEditorControls(elements) {
  // Skip if editor toggle doesn't exist
  if (!elements.editorToggle) return;
  
  // No need to add event listeners here as they're handled in editor.js
}

/**
 * Set up keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', function(e) {
    // Check if editor is active
    const isEditorActive = document.getElementById('editorToggle') && 
                          document.getElementById('editorToggle').classList.contains('active');
    
    if (isEditorActive) {
      // Editor shortcuts are handled in editor.js
      // We don't need to duplicate them here
    }
  });
}

/**
 * Expose global functions for use by other modules
 */
function exposeGlobalFunctions() {
  // Make zoom functions globally accessible
  window.getCurrentZoom = ZoomModule.getCurrentZoom;
  
  // Make project functions globally accessible
  window.saveProject = ProjectModule.saveProject;
  window.loadProjectList = ProjectModule.loadProjectList;
  window.loadProject = ProjectModule.loadProject;
  
  // Make labels function globally accessible
  window.updateUIForLabels = LabelsModule.updateUIForLabels;
  
  // Make PDF functions globally accessible
  window.getAllPdfPages = function() {
    if (typeof PdfModule.getAllPdfPages === 'function') {
      return PdfModule.getAllPdfPages();
    }
    return [];
  };

  window.debugAnnotationsState = function() {
    console.log("=== DEBUG ANNOTATIONS STATE ===");
    
    if (!window.data) {
      console.error("window.data ist nicht definiert!");
      return false;
    }
    
    if (!window.data.predictions) {
      console.error("window.data.predictions ist nicht definiert!");
      return false;
    }
    
    console.log(`window.data.predictions enthält ${window.data.predictions.length} Annotationen`);
    
    // Die ersten 3 Annotationen anzeigen
    const sample = window.data.predictions.slice(0, Math.min(3, window.data.predictions.length));
    console.log("Beispiel-Annotationen:", sample);
    
    // Canvas überprüfen
    if (window.FabricHandler && window.FabricHandler.getCanvas()) {
      const canvas = window.FabricHandler.getCanvas();
      console.log(`Canvas enthält ${canvas.getObjects().length} Objekte`);
      
      // Gibt es Annotations-Objekte?
      const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
      console.log(`Davon sind ${annotations.length} Annotations`);
      
      // Alles anzeigen
      if (annotations.length === 0 && window.data.predictions.length > 0) {
        console.log("PROBLEM: Canvas enthält keine Annotations, obwohl Daten vorhanden sind!");
        console.log("Versuche, die Annotations neu zu zeichnen...");
        
        window.FabricHandler.displayAnnotations(window.data.predictions);
        return "Annotations neu gezeichnet. Bitte überprüfen!";
      }
      
      return "Debug abgeschlossen.";
    } else {
      console.log("Canvas ist nicht initialisiert!");
      return "Canvas nicht gefunden.";
    }
  };

  // Make main functions globally accessible
  window.displayPdfPage = displayPdfPage;
  window.processApiResponse = processApiResponse;
  window.updateSummary = updateSummary;
  window.updateResultsTable = updateResultsTable;
  window.clearResults = clearResults;
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);