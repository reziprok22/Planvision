/**
 * main.js - Fenster-Erkennungstool Main Application
 * Core functionality: Upload, Predict, Annotation Display, Drawing Tools, Zoom
 */

// Import Fabric.js
import { Canvas, FabricImage as Image, Rect, Polygon, Polyline, FabricText as Text, Shadow, util } from 'fabric';

// Import modules
import {
  setupLabels,
  getLabelById,
  getLabelName,
  getLabelColor,
  getCurrentLabels,
  getCurrentLineLabels,
  getLabelsForTool,
  applyLayerOrdering
} from './labels.js';
import {
  resetPdfState,
  getPdfSessionId,
  getPdfPageData,
  getPageSettings,
  getAllPdfPages,
  setPdfSessionId,
  setPdfPageData,
  setPageSettings,
  setPdfNavigationState,
  setOriginalPdfBlob,
  getOriginalPdfBlob
} from './pdf-handler.js';
import { setupProject } from './project.js';
import {
  setupUploadModal,
  setOnPageClick,
  setOnScaleChange,
  setActivePageInList,
  setPageStatus,
  setPageScaleInSidebar,
  getSessionId as getUploadSessionId,
  getPageSizes
} from './upload-modal.js';

// Fabric.js v6 ES6 modules imported successfully
console.log('✅ Fabric.js v6 ES6 modules loaded');

// Global app state
window.data = null;
let canvas = null;
let imageContainer = null;
let uploadedImage = null;

// Multi-Page Canvas State Management
let pageCanvasData    = {}; // Store canvas data for each page: { "1": canvasData, "2": canvasData, ... }
let pageAnalysisData  = {}; // Store raw AI predictions per page: { "1": [...predictions], ... }
let currentPageNumber = 1;

// Make canvas and pageCanvasData globally available for label validation
window.getCanvas = () => canvas;
window.getPageCanvasData = () => pageCanvasData;
window.getCurrentPageNumber = () => currentPageNumber;

// Editor state
let currentTool = 'select';
let drawingMode = false;
let currentPoints = [];
let selectedObjects = [];
let currentRectangle = null;
let currentPolygon = null;
let currentLine = null;
let rectangleStartPoint = null;
let clipboard = [];      // serialised annotations ready to paste
let pasteOffset = 0;     // increases with each paste so copies don't stack

// Undo / Redo history
const HISTORY_LIMIT = 30;
let undoStack = [];      // serialised states; top = current state
let redoStack = [];
let isHistoryAction = false; // true while restoring a state (prevents recursive saves)

// Event timing control
let isProcessingClick = false;
let isPageSwitching = false; // Prevent canvas events during page switches

// Debounced table update
let updateTableTimeout = null;

// Utility Functions
/**
 * Convert hex color to color with opacity
 */
function getLabelColorWithOpacity(color, opacity = '20') {
  return color + opacity;
}

/**
 * Convert points array to Fabric.js format
 */
function convertPointsToFabric(points) {
  return points.map(p => ({ x: p.x, y: p.y }));
}


/**
 * Convert bbox coordinates to canvas coordinates
 */
function convertToCanvasCoordinates(bbox) {
  const [x1, y1, x2, y2] = bbox;
  return {
    x1: x1,
    y1: y1,
    x2: x2,
    y2: y2,
    width: x2 - x1,
    height: y2 - y1
  };
}

function getLabel(labelId) {
  return {
    name: getLabelName(labelId),
    color: getLabelColor(labelId)
  };
}


/**
 * Setup tool button event listeners
 * Ist damit Werkzeuge nach dem Plan analysieren aktiv sind
 */
function setupToolButtons() {
  // Remove existing event listeners to prevent duplicates
  document.querySelectorAll('.tool-button').forEach(button => {
    // Clone node to remove all event listeners
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);
  });
  
  // Add fresh event listeners
  document.querySelectorAll('.tool-button').forEach(button => {
    button.addEventListener('click', function() {
      const tool = this.dataset.tool;
      if (tool === 'delete') {
        deleteSelectedObjects();
      } else {
        setTool(tool);
      }
    });
  });
}

/**
 * Initialize canvas
 */
function initCanvas() {
  startPerfMeasurement('canvas-initialization', 'canvas');
  
  if (!uploadedImage || !uploadedImage.complete || uploadedImage.naturalWidth === 0) {
    console.warn("Image not loaded yet, retrying...");
    setTimeout(initCanvas, 100);
    return;
  }
  
  // Remove existing canvas
  const existingCanvas = document.getElementById('annotationCanvas');
  if (existingCanvas) {
    existingCanvas.remove();
  }
  
  // Create new canvas element with simpler positioning
  const canvasElement = document.createElement('canvas');
  canvasElement.id = 'annotationCanvas';
  canvasElement.style.position = 'absolute';
  canvasElement.style.top = '0';
  canvasElement.style.left = '0';
  canvasElement.style.pointerEvents = 'auto'; // Always enable, let Fabric.js handle
  canvasElement.style.zIndex = '100'; // Much higher z-index
  
  imageContainer.appendChild(canvasElement);
  
  // Initialize Fabric.js canvas
  canvas = new Canvas('annotationCanvas');
  
  // Configure canvas for drawing mode initially
  canvas.selection = false;  // Disable selection by default
  canvas.defaultCursor = 'default';
  canvas.hoverCursor = 'default';
  canvas.moveCursor = 'default';
  
  // Improve selection tolerance for thin lines and complex shapes
  canvas.targetFindTolerance = 10;      // 10px tolerance around objects
  canvas.perPixelTargetFind = true;     // More precise hit detection
  canvas.uniformScaling = false;        // free resize by default; Shift = proportional
  
  // FABRIC.JS NATURAL-SIZE STRATEGY: Canvas = image size, 1:1 coordinates
  const naturalWidth = uploadedImage.naturalWidth;
  const naturalHeight = uploadedImage.naturalHeight;
   
  // Canvas-Größe = Natural Image Size (für 1:1 Koordinaten)
  canvas.setWidth(naturalWidth);
  canvas.setHeight(naturalHeight);
  
  // Add image as Fabric.js v6 background at 1:1 scale
  Image.fromURL(uploadedImage.src).then(img => {
    img.set({
      left: 0,
      top: 0,
      scaleX: 1.0,  // No scaling - natural size
      scaleY: 1.0,  // No scaling - natural size
      selectable: false,
      evented: false,
      excludeFromExport: true
    });
    
    // Set as background image - v6 direct property assignment
    canvas.backgroundImage = img;
    canvas.renderAll();
  });
  
  // Hide the HTML image since we're using Fabric.js background
  uploadedImage.style.display = 'none';
  
  // Enable Fabric.js zoom functionality with Ctrl+Wheel, allow normal scrolling
  canvas.on('mouse:wheel', function(opt) {
    // Only zoom with Ctrl key, otherwise allow normal scrolling
    if (opt.e.ctrlKey) {
      const delta = opt.e.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      if (zoom > 5) zoom = 5;    // Lower max zoom for natural size
      if (zoom < 0.1) zoom = 0.1; // Higher min zoom for natural size
      canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    } else {
      // Allow normal scrolling - don't prevent default
      // The container will handle scrolling naturally
    }
  });
  
  // Position canvas at natural size (scrollable in container)
  const canvasWrapper = canvas.wrapperEl;
  if (canvasWrapper) {
    canvasWrapper.style.position = 'absolute';
    canvasWrapper.style.top = '0';
    canvasWrapper.style.left = '0';
    canvasWrapper.style.width = `${naturalWidth}px`;
    canvasWrapper.style.height = `${naturalHeight}px`;
  }
  
  // Setup enhanced scrolling for container
  setupContainerScrolling();
  
  // Ensure tool buttons and canvas events work after initialization
  setupToolButtons();
  setupCanvasEvents();

  endPerfMeasurement('canvas-initialization', {
    canvas_width: naturalWidth,
    canvas_height: naturalHeight,
    image_size_mb: (naturalWidth * naturalHeight * 4) / (1024 * 1024) // Rough estimate
  });
  
  return canvas;
}

/**
 * Setup enhanced scrolling for the image container. shift+mousewheel = horizonal scroll
 */
function setupContainerScrolling() {
  if (!imageContainer) return;
  
  imageContainer.addEventListener('wheel', function(e) {
    // If Shift key is held, convert vertical scroll to horizontal
    if (e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      imageContainer.scrollBy({ left: e.deltaY * 0.5});
    }
    // Normal vertical scrolling happens automatically if no modifiers
    // Ctrl+Wheel is handled by Fabric.js for zooming
  }, { passive: false });
}

/**
 * Calculate correct area for API prediction based on coordinates
 */
function calculatePredictionArea(coords) {
  const [x1, y1, x2, y2] = coords;
  const pixelToMeter = getPixelToMeterFactor();
  
  // Calculate width and height in natural pixels
  const widthPixels = Math.abs(x2 - x1);
  const heightPixels = Math.abs(y2 - y1);
  
  // Convert to real world dimensions
  const widthM = widthPixels * pixelToMeter;
  const heightM = heightPixels * pixelToMeter;
  const area = widthM * heightM;
  
  return area;
}

/**
 * Load Canvas data directly into the canvas (Single Source of Truth approach)
 * @param {Object} canvasData - Canvas data from saved project
 */
function loadCanvasData(canvasData) {
  startPerfMeasurement('canvas-data-loading', 'canvas');
  
  if (!canvas) {
    initCanvas();
  }
  
  if (!canvas || !canvasData || !canvasData.canvas_annotations) {
    console.error("Cannot load canvas data: missing canvas or data");
    endPerfMeasurement('canvas-data-loading', { success: false });
    return;
  }
  
  // Clear existing canvas content
  canvas.clear();
  
  // Reinitialize canvas to set background image
  initCanvas();
  
  console.log(`Loading ${canvasData.canvas_annotations.length} annotations from canvas data`);
  
  // Load each annotation from saved canvas data
  canvasData.canvas_annotations.forEach((annotationData, index) => {
    // Use Fabric.js enlivenObjects to recreate objects from saved data
    util.enlivenObjects([annotationData]).then(objects => {
      const annotation = objects[0];
      
      if (annotation) {
        // Ensure our custom properties are set
        annotation.set({
          objectType: 'annotation',
          selectable: true,
          evented: true
        });
        
        // Add to canvas
        canvas.add(annotation);
        
        // Create text label for this annotation
        setTimeout(() => {
          createSingleTextLabel(annotation);
        }, 10);
      }
    });
  });
  
  // Restore canvas viewport if saved
  if (canvasData.canvas_viewport) {
    canvas.setViewportTransform(canvasData.canvas_viewport);
  }
  
  // Restore zoom if saved
  if (canvasData.canvas_zoom) {
    canvas.setZoom(canvasData.canvas_zoom);
  }
  
  canvas.renderAll();

  // Re-setup canvas events
  setupCanvasEvents();

  // Update UI
  setTimeout(() => {
    applyLayerOrdering(); // enforce label z-order after all async enlivenObjects settle
    updateResultsTable();
    updateSummary();
    saveHistorySnapshot();

    endPerfMeasurement('canvas-data-loading', {
      annotations_loaded: canvasData.canvas_annotations.length,
      success: true
    });
  }, 100);
}


/**
 * Convert predictions to canvas data format (for new uploads only)
 */
function convertPredictionsToCanvasData(predictions, pageNumber = 1) {
  if (!predictions || predictions.length === 0) {
    return {
      page_number: pageNumber,
      canvas_annotations: [],
      annotation_count: 0,
      canvas_available: true
    };
  }
  
  // Convert predictions to Fabric.js serializable format
  const canvasAnnotations = predictions.map((pred, index) => {
    const labelId = pred.label || 1;
    let label, labelColor;
    
    if (pred.annotationType === 'line') {
      const lineLabel = getLabelById ? getLabelById(labelId, 'line') : null;
      label = lineLabel ? { name: lineLabel.name, color: lineLabel.color } : { name: 'Strecke', color: '#FF0000' };
      labelColor = label.color;
    } else {
      label = getLabel(labelId);
      labelColor = label.color;
    }
    
    if (pred.box || pred.bbox) {
      // Rectangle from bounding box
      const coords = pred.box || pred.bbox;
      const canvasCoords = convertToCanvasCoordinates(coords);
      
      return {
        type: 'rect',
        objectType: 'annotation',
        annotationType: 'rectangle',
        left: canvasCoords.x1,
        top: canvasCoords.y1,
        width: canvasCoords.width,
        height: canvasCoords.height,
        fill: getLabelColorWithOpacity(labelColor),
        stroke: labelColor,
        strokeWidth: 2,
        labelId: labelId,
        objectLabel: labelId,
        displayIndex: index + 1,
        userCreated: false,
        selectable: true,
        evented: true
      };
    } else if (pred.annotationType === 'polygon' && pred.points) {
      // Polygon from points
      const fabricPoints = convertPointsToFabric(pred.points);
      
      return {
        type: 'polygon',
        objectType: 'annotation',
        annotationType: 'polygon',
        points: fabricPoints,
        fill: getLabelColorWithOpacity(labelColor),
        stroke: labelColor,
        strokeWidth: 2,
        labelId: labelId,
        objectLabel: labelId,
        displayIndex: index + 1,
        userCreated: false,
        selectable: true,
        evented: true,
        objectCaching: false
      };
    } else if (pred.annotationType === 'line' && pred.points) {
      // Line from points
      const fabricPoints = convertPointsToFabric(pred.points);
      
      return {
        type: 'polyline',
        objectType: 'annotation',
        annotationType: 'line',
        points: fabricPoints,
        fill: '',
        stroke: labelColor,
        strokeWidth: 3,
        labelId: labelId,
        objectLabel: labelId,
        displayIndex: index + 1,
        userCreated: false,
        selectable: true,
        evented: true,
        objectCaching: false
      };
    }
  }).filter(Boolean);
  
  return {
    page_number: pageNumber,
    canvas_annotations: canvasAnnotations,
    annotation_count: canvasAnnotations.length,
    canvas_available: true,
    saved_at: new Date().toISOString()
  };
}


/**
 * Debounced table update - delays update to avoid too frequent calls
 */
function debouncedTableUpdate() {
  if (updateTableTimeout) {
    clearTimeout(updateTableTimeout);
  }
  updateTableTimeout = setTimeout(() => {
    updateResultsTable();
    updateSummary();
  }, 500); // 500ms delay
}




/**
 * Update results table - reads directly from canvas objects
 */
function updateResultsTable() {
  const resultsBody = document.getElementById('resultsBody');
  if (!resultsBody || !canvas) return;
  
  resultsBody.innerHTML = '';
  
  // Get all annotation objects from canvas
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  
  annotations.forEach((annotation, index) => {
    // Get label info
    const labelId = annotation.labelId || annotation.objectLabel || 1;
    let label;
    
    if (annotation.annotationType === 'line') {
      // Use line labels for line annotations
      const lineLabel = getLabelById ? getLabelById(labelId, 'line') : null;
      label = lineLabel ? { name: lineLabel.name, color: lineLabel.color } : { name: 'Strecke', color: '#FF0000' };
    } else {
      // Use area labels for rectangles and polygons
      label = getLabel(labelId);
    }
    
    // Determine annotation type and calculate measurement
    let annotationType = 'Rechteck';
    let measurement = 'N/A';
    
    if (annotation.type === 'rect') {
      annotationType = 'Rechteck';
      const area = calculateRectangleAreaFromCanvas(annotation);
      measurement = `${area.toFixed(2)} m²`;
    } else if (annotation.type === 'polygon') {
      annotationType = 'Polygon';
      const area = calculatePolygonAreaFromCanvas(annotation);
      measurement = `${area.toFixed(2)} m²`;
    } else if (annotation.type === 'polyline') {
      annotationType = 'Linie';
      const length = calculatePolylineLength(annotation.points || []);
      measurement = `${length.toFixed(2)} m`;
    }
    
    // Determine confidence score
    const confidence = annotation.userCreated ? 100 : (annotation.score || 0) * 100;
    
    const row = document.createElement('tr');
    const displayNumber = annotation.displayIndex || (index + 1);
    row.innerHTML = `
      <td>${displayNumber}</td>
      <td>${label.name}</td>
      <td>${annotationType}</td>
      <td>${confidence.toFixed(1)}%</td>
      <td>${measurement}</td>
    `;
    
    // Add visual indicator for user-created annotations
    if (annotation.userCreated) {
      row.style.fontStyle = 'italic';
      row.title = 'Benutzer-erstellt';
    }
    
    // Add hover functionality to highlight annotation on canvas
    row.addEventListener('mouseenter', () => highlightAnnotation(index));
    row.addEventListener('mouseleave', () => removeHighlight(index));
    
    resultsBody.appendChild(row);
  });
}

/**
 * Calculate rectangle area from canvas object
 */
function calculateRectangleAreaFromCanvas(rectObject) {
  const pixelToMeter = getPixelToMeterFactor();
  const actualWidth = rectObject.width * (rectObject.scaleX || 1);
  const actualHeight = rectObject.height * (rectObject.scaleY || 1);
  const widthM = actualWidth * pixelToMeter;
  const heightM = actualHeight * pixelToMeter;
  return widthM * heightM;
}

/**
 * Calculate polygon area from canvas object
 */
function calculatePolygonAreaFromCanvas(polygonObject) {
  if (!polygonObject.points || polygonObject.points.length < 3) return 0;
  
  const pixelToMeter = getPixelToMeterFactor();
  const scaleX = polygonObject.scaleX || 1;
  const scaleY = polygonObject.scaleY || 1;
  
  // Transform points with scaling
  const scaledPoints = polygonObject.points.map(p => ({
    x: p.x * scaleX,
    y: p.y * scaleY
  }));
  
  // Shoelace formula for polygon area in pixels
  let areaPixels = 0;
  for (let i = 0; i < scaledPoints.length; i++) {
    const j = (i + 1) % scaledPoints.length;
    areaPixels += scaledPoints[i].x * scaledPoints[j].y;
    areaPixels -= scaledPoints[j].x * scaledPoints[i].y;
  }
  areaPixels = Math.abs(areaPixels) / 2;
  
  // Convert to square meters
  return areaPixels * pixelToMeter * pixelToMeter;
}

/**
 * Highlight annotation on canvas when hovering over table row
 */
function highlightAnnotation(index) {
  if (!canvas) return;
  
  // Get annotation by array position
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  const targetAnnotation = annotations[index];
  
  if (targetAnnotation) {
    // Store original stroke width on the annotation object
    if (!targetAnnotation.originalStrokeWidth) {
      targetAnnotation.originalStrokeWidth = targetAnnotation.strokeWidth;
    }
    
    // Make annotation bold
    targetAnnotation.set({
      strokeWidth: targetAnnotation.originalStrokeWidth * 2,
      shadow: new Shadow({
        color: targetAnnotation.stroke,
        blur: 5,
        offsetX: 0,
        offsetY: 0
      })
    });
    
    // Bring annotation to front - v6 API
    canvas.bringObjectToFront(targetAnnotation);
    canvas.renderAll();
  }
}

/**
 * Remove highlight from annotation
 */
function removeHighlight(index) {
  if (!canvas) return;
  
  // Get annotation by array position
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  const targetAnnotation = annotations[index];
  
  if (targetAnnotation && targetAnnotation.originalStrokeWidth) {
    // Restore original stroke width
    targetAnnotation.set({
      strokeWidth: targetAnnotation.originalStrokeWidth,
      shadow: null
    });
    
    canvas.renderAll();
  }
}

/**
 * Highlight table row when hovering over annotation
 */
function highlightTableRow(index) {
  const resultsBody = document.getElementById('resultsBody');
  if (!resultsBody) return;
  
  const rows = resultsBody.querySelectorAll('tr');
  if (index < rows.length) {
    const targetRow = rows[index];
    targetRow.style.backgroundColor = '#e3f2fd'; // Light blue background
    targetRow.style.transform = 'scale(1.02)'; // Slight scale effect
    targetRow.style.transition = 'all 0.2s ease';
  }
}

/**
 * Remove highlight from table row
 */
function removeTableRowHighlight(index) {
  const resultsBody = document.getElementById('resultsBody');
  if (!resultsBody) return;
  
  const rows = resultsBody.querySelectorAll('tr');
  if (index < rows.length) {
    const targetRow = rows[index];
    targetRow.style.backgroundColor = ''; // Remove background
    targetRow.style.transform = ''; // Remove scale
    targetRow.style.transition = 'all 0.2s ease';
  }
}

/**
 * Update summary - reads directly from canvas objects
 */
function updateSummary() {
  const summary = document.getElementById('summary');
  if (!summary || !canvas) return;
  
  const counts = {};
  const areas  = {};
  const colors = {};
  const units  = {};

  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');

  annotations.forEach(annotation => {
    const labelId = annotation.labelId || annotation.objectLabel || 1;
    const label   = getLabel(labelId);
    const key     = label.name;

    if (!counts[key]) {
      counts[key] = 0;
      areas[key]  = 0;
      colors[key] = annotation.stroke || label.color || '#888';
      units[key]  = annotation.type === 'polyline' ? 'm' : 'm²';
    }
    counts[key]++;

    if (annotation.type === 'rect') {
      areas[key] += calculateRectangleAreaFromCanvas(annotation);
    } else if (annotation.type === 'polygon') {
      areas[key] += calculatePolygonAreaFromCanvas(annotation);
    } else if (annotation.type === 'polyline') {
      areas[key] += calculatePolylineLength(annotation.points || []);
    }
  });

  let summaryHtml = '';
  Object.entries(counts).forEach(([name, count]) => {
    const color = colors[name];
    const unit  = units[name];
    summaryHtml += `
      <div class="summary-row">
        <span class="summary-color" style="background:${color}"></span>
        <span class="summary-name">${name}</span>
        <span class="summary-count"><strong>${count}</strong></span>
        <span class="summary-area">${areas[name].toFixed(2)} ${unit}</span>
      </div>`;
  });

  summary.innerHTML = summaryHtml || '<p><em>Keine Annotationen.</em></p>';
}

/**
 * Clear all results
 */
function clearResults() {  
  window.data = null;
  
  // Reset PDF state
  resetPdfState();
  
  if (uploadedImage) {
    uploadedImage.src = '';
  }
  const resultsSection = document.getElementById('resultsSection');
  if (resultsSection) resultsSection.style.display = 'none';
  const summary = document.getElementById('summary');
  const resultsBody = document.getElementById('resultsBody');
  if (summary) summary.innerHTML = '<p><em>Keine Analyse durchgeführt.</em></p>';
  if (resultsBody) {
    resultsBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: #666; font-style: italic;">
          Lade eine Datei hoch und starte die Analyse, um Ergebnisse zu sehen.
        </td>
      </tr>
    `;
  }
  
  // Clear canvas
  if (canvas) {
    canvas.clear();
  }
  
  // Reset canvas zoom to 1.0
  if (canvas) {
    canvas.setZoom(1.0);
  }
  
  // Results cleared
}


// ── Copy / Paste ──────────────────────────────────────────────────────────────

function copySelectedAnnotations() {
  const annotations = selectedObjects.filter(o => o.objectType === 'annotation');
  if (!annotations.length) return;
  // Serialise with custom properties so paste recreates them faithfully
  clipboard = annotations.map(o => o.toObject([
    'objectType', 'annotationType', 'labelId', 'objectLabel',
  ]));
  pasteOffset = 0;
}

async function pasteAnnotations() {
  if (!clipboard.length) return;
  pasteOffset += 20;

  const objects = await util.enlivenObjects(JSON.parse(JSON.stringify(clipboard)));
  for (const obj of objects) {
    obj.set({
      left:        (obj.left  || 0) + pasteOffset,
      top:         (obj.top   || 0) + pasteOffset,
      objectType:  'annotation',
      selectable:  currentTool === 'select',
      evented:     currentTool === 'select',
    });
    // Remove stale id/index so createSingleTextLabel assigns fresh ones
    delete obj.id;
    obj.displayIndex = undefined;
    canvas.add(obj);
    obj.setCoords();
    createSingleTextLabel(obj);
  }

  applyLayerOrdering();
  canvas.requestRenderAll();
  saveHistorySnapshot();
}

// ─────────────────────────────────────────────────────────────────────────────
// Undo / Redo helpers

function serializeAnnotations() {
  if (!canvas) return '[]';
  return JSON.stringify(
    canvas.getObjects()
      .filter(o => o.objectType === 'annotation')
      .map(o => o.toObject(['objectType', 'annotationType', 'labelId', 'objectLabel', 'id', 'displayIndex']))
  );
}

function initHistory() {
  undoStack = [];
  redoStack = [];
}

function saveHistorySnapshot() {
  if (isHistoryAction || isPageSwitching || !canvas) return;
  const state = serializeAnnotations();
  if (undoStack.length > 0 && undoStack[undoStack.length - 1] === state) return;
  undoStack.push(state);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
}

async function applyHistoryState(stateJson) {
  isHistoryAction = true;
  // Remove all annotation objects and their text labels
  canvas.getObjects()
    .filter(o => o.objectType === 'annotation' || o.objectType === 'textLabel')
    .forEach(o => canvas.remove(o));

  const annotations = JSON.parse(stateJson);
  if (annotations.length) {
    const objects = await util.enlivenObjects(annotations);
    for (const obj of objects) {
      obj.set({ selectable: currentTool === 'select', evented: currentTool === 'select' });
      canvas.add(obj);
      obj.setCoords();
    }
    applyLayerOrdering();
    for (const obj of objects) createSingleTextLabel(obj);
  }

  canvas.discardActiveObject();
  selectedObjects = [];
  canvas.requestRenderAll();
  updateResultsTable();
  updateSummary();
  isHistoryAction = false;
}

async function undoHistory() {
  if (undoStack.length < 2) return;
  redoStack.push(undoStack.pop());
  await applyHistoryState(undoStack[undoStack.length - 1]);
}

async function redoHistory() {
  if (!redoStack.length) return;
  const state = redoStack.pop();
  undoStack.push(state);
  await applyHistoryState(state);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Setup Canvas Events for Editor - Pure Fabric.js approach
 */
function setupCanvasEvents() {
  if (!canvas) {
    console.warn('Cannot setup canvas events - canvas not available');
    return;
  }
    
  // Clear all existing events first
  canvas.off('mouse:down');
  canvas.off('mouse:move');
  canvas.off('mouse:up');
  canvas.off('mouse:dblclick');
  canvas.off('selection:created');
  canvas.off('selection:updated');
  canvas.off('selection:cleared');
  
  // Mouse down event - handles all drawing tools
  canvas.on('mouse:down', function(options) {    
    if (isProcessingClick) return;
    
    // If there's a target object (user clicked on an existing annotation), don't start drawing
    if (options.target && options.target.objectType === 'annotation') {
      return; // Let Fabric.js handle object selection/manipulation
    }
    
    const pointer = canvas.getPointer(options.e);
    
    // Handle different tools
    if (currentTool === 'rectangle') {
      isProcessingClick = true;
      startDrawingRectangle(pointer);
      setTimeout(() => { isProcessingClick = false; }, 50);
    } else if (currentTool === 'polygon') {
      addPolygonPoint(pointer, options.e);
    } else if (currentTool === 'line') {
      addLinePoint(pointer, options.e);
    }
    // For 'select' tool, let Fabric.js handle selection naturally
  });
  
  // Mouse move event - for drawing previews
  canvas.on('mouse:move', function(options) {
    if (!drawingMode) return;
    
    const pointer = canvas.getPointer(options.e);
    
    if (currentTool === 'rectangle' && currentRectangle) {
      updateDrawingRectangle(pointer);
    } else if (currentTool === 'polygon' && currentPolygon) {
      updatePolygonPreview(pointer);
    } else if (currentTool === 'line' && currentLine) {
      updateLinePreview(pointer);
    }
  });
  
  // Mouse up event - finish drawing operations
  canvas.on('mouse:up', function(options) {
        
    if (currentTool === 'rectangle' && drawingMode) {
      finishDrawingRectangle();
    }
  });
  
  // Double-click event - for polygon and line finishing
  canvas.on('mouse:dblclick', function(options) {
        
    if (currentTool === 'polygon' && currentPoints.length >= 3) {
      finishPolygonDrawing();
    } else if (currentTool === 'line' && currentPoints.length >= 2) {
      finishLineDrawing();
    }
  });
  
  // Selection events
  canvas.on('selection:created', function(e) {
    selectedObjects = e.selected || [];
    if (currentTool === 'select' && selectedObjects.length > 0) {
      updateUniversalLabelDropdown(currentTool, selectedObjects[0]);
    }
  });
  
  canvas.on('selection:updated', function(e) {
    selectedObjects = e.selected || [];
    if (currentTool === 'select' && selectedObjects.length > 0) {
      updateUniversalLabelDropdown(currentTool, selectedObjects[0]);
    }
  });
  
  canvas.on('selection:cleared', function(e) {
    // Update text labels only for annotations that were actually selected/modified
    if (selectedObjects && selectedObjects.length > 0) {
      selectedObjects.forEach(selectedObj => {
        if (selectedObj.objectType === 'annotation') {
          updateLinkedTextLabelPosition(selectedObj);
        }
      });
      debouncedTableUpdate();
    }
    
    selectedObjects = [];
    if (currentTool === 'select') {
      updateUniversalLabelDropdown(currentTool);
    }
  });
  
  // Object modified (resize/scale) – recalculate measurements
  canvas.on('object:modified', function(e) {
    if (!e.target || e.target.objectType !== 'annotation') return;
    updateLinkedTextLabelPosition(e.target);
    saveHistorySnapshot();
    debouncedTableUpdate();
  });

  // Object removal events - update table when annotations are deleted
  canvas.on('object:removed', function(e) {
    if (isPageSwitching || isHistoryAction || !e.target) return;
    if (e.target.objectType === 'annotation') {
      // Find and remove linked text label
      const linkedTextLabel = canvas.getObjects().find(obj => 
        obj.objectType === 'textLabel' && obj.linkedAnnotationId === e.target.id
      );
      if (linkedTextLabel) {
        canvas.remove(linkedTextLabel);
      }
      debouncedTableUpdate();
    }
  });
  
  // Mouse hover events for annotation highlighting
  canvas.on('mouse:over', function(e) {
    if (!e.target) return;
    if (e.target.objectType === 'annotation') {
      // Find index in annotations array
      const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
      const index = annotations.indexOf(e.target);
      if (index >= 0) {
        highlightTableRow(index);
      }
    }
  });
  
  canvas.on('mouse:out', function(e) {
    if (!e.target) return;
    if (e.target.objectType === 'annotation') {
      // Find index in annotations array
      const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
      const index = annotations.indexOf(e.target);
      if (index >= 0) {
        removeTableRowHighlight(index);
      }
    }
  });
}


/**
 * Set Current Tool
 */
function setTool(toolName) {

  // Clean up current tool state first
  cleanupCurrentTool();
  
  currentTool = toolName;
  
  // Update button states
  document.querySelectorAll('.tool-button').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tool="${toolName}"]`).classList.add('active');
  
  // Reset all drawing states
  resetAllDrawingStates();
  
  // Update universal label dropdown based on tool
  updateUniversalLabelDropdown(toolName);
  
  // Update canvas selection mode (Auswahl-Modul)
  if (canvas) {
    if (toolName === 'select') {
      canvas.selection = true; // Es können mehrere Objekte gleichzeitig mit Auswahlrahmen ausgewählt werden
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = 'move';
      canvas.forEachObject(obj => {
        // Nur Annotation-Objekte selektierbar machen, nicht Text-Labels
        if (obj.objectType === 'annotation') {
          obj.selectable = true;
          obj.evented = true;
          obj.setCoords(); // ensure hit-detection bounds are current
        } else if (obj.objectType === 'textLabel') {
          // Text labels should never be selectable or interactive
          obj.selectable = false;
          obj.evented = false;
        } else {
          obj.selectable = false;
          obj.evented = false;
        }
      });
    } else {
      canvas.selection = false;
      canvas.defaultCursor = 'crosshair';
      canvas.hoverCursor = 'crosshair';
      canvas.discardActiveObject();
      canvas.forEachObject(obj => {
        obj.selectable = false;
        obj.evented = false;
      });
      // Clear selection when switching away from select tool
    }
    canvas.renderAll();
  }
}

/**
 * Update universal label dropdown based on current tool and selection
 */
function updateUniversalLabelDropdown(toolName, selectedObject = null) {
  const universalLabelSelect = document.getElementById('universalLabelSelect');
  if (!universalLabelSelect) return;
  
  // Determine tool type and get appropriate labels
  let labels;
  
  if (toolName === 'line' || (selectedObject && selectedObject.annotationType === 'line')) {
    // Line tool - use line labels
    labels = getCurrentLineLabels();
  } else if (toolName === 'polygon' || (selectedObject && selectedObject.annotationType === 'polygon')) {
    // Polygon tool - use polygon labels  
    labels = getLabelsForTool('polygon');
  } else {
    // Rectangle tool or other - use rectangle labels
    labels = getCurrentLabels();
  }
  
  // Remember current selection
  const currentValue = universalLabelSelect.value;
  
  // Clear and repopulate dropdown
  universalLabelSelect.innerHTML = '';
  labels.forEach(label => {
    const option = document.createElement('option');
    option.value = label.id;
    option.textContent = label.name;
    universalLabelSelect.appendChild(option);
  });
  
  // Set selection based on context
  if (selectedObject && selectedObject.labelId) {
    // Use object's current label
    universalLabelSelect.value = selectedObject.labelId;
  } else if (universalLabelSelect.querySelector(`option[value="${currentValue}"]`)) {
    // Restore previous selection if still valid
    universalLabelSelect.value = currentValue;
  } else {
    // Default to first option
    universalLabelSelect.value = labels[0].id;
  }
}

/**
 * Tool State Management
 */
function cleanupCurrentTool() {
  if (currentTool === 'rectangle' && currentRectangle) {
    canvas.remove(currentRectangle);
    currentRectangle = null;
  } else if (currentTool === 'polygon' && currentPolygon) {
    canvas.remove(currentPolygon);
    currentPolygon = null;
  } else if (currentTool === 'line' && currentLine) {
    canvas.remove(currentLine);
    currentLine = null;
  }
  
  if (canvas) {
    canvas.renderAll();
  }
}

function resetAllDrawingStates() {
  
  drawingMode = false;
  currentRectangle = null;
  currentPoints = [];
  currentPolygon = null;
  currentLine = null;
  rectangleStartPoint = null;
  isProcessingClick = false;
}

/**
 * Rectangle Drawing Functions
 */
function startDrawingRectangle(pointer) {
  if (!canvas) return;
  
  drawingMode = true;
  
  // Store the original start point
  rectangleStartPoint = { x: pointer.x, y: pointer.y };
  
  // Get current selected label and its color
  const selectedLabelId = getCurrentSelectedLabel();
  const label = getLabel(selectedLabelId);
  
  const rect = new Rect({
    left: pointer.x,
    top: pointer.y,
    width: 0,
    height: 0,
    fill: label.color + '20', // 20% opacity
    stroke: label.color,
    strokeWidth: 2,
    objectType: 'annotation',
    annotationType: 'rectangle',
    selectable: currentTool === 'select',
    evented: currentTool === 'select'
  });
  
  canvas.add(rect);
  currentRectangle = rect;
}

function updateDrawingRectangle(pointer) {
  if (!currentRectangle || !rectangleStartPoint) return;
  
  const startX = rectangleStartPoint.x;
  const startY = rectangleStartPoint.y;
  const width = pointer.x - startX;
  const height = pointer.y - startY;
    
  currentRectangle.set({
    width: Math.abs(width),
    height: Math.abs(height),
    left: width < 0 ? pointer.x : startX,
    top: height < 0 ? pointer.y : startY
  });
    
  canvas.renderAll();
}

function finishDrawingRectangle() {
  if (!currentRectangle) return;
  
  // Minimum size check
  if (currentRectangle.width < 10 || currentRectangle.height < 10) {
    canvas.remove(currentRectangle);
  } else {
    // Get selected label
    const selectedLabelId = getCurrentSelectedLabel();
    const label = getLabel(selectedLabelId);
    
    // Update rectangle with correct label and colors
    currentRectangle.set({
      selectable: true,
      evented: true,
      labelId: selectedLabelId,
      objectLabel: selectedLabelId,
      fill: getLabelColorWithOpacity(label.color),
      stroke: label.color
    });
    currentRectangle.setCoords(); // sync hit-detection bounds after resize via set()

    // Create text label with delay to ensure annotation is fully stabilized
    const rectToLabel = currentRectangle; // Store reference before clearing
    setTimeout(() => {
      createSingleTextLabel(rectToLabel);
      saveHistorySnapshot();
    }, 10);
  }
  
  drawingMode = false;
  currentRectangle = null;
  rectangleStartPoint = null;
  canvas.renderAll();
}

/**
 * Get pixel to meter conversion factor based on current settings
 */
function getPixelToMeterFactor() {
  // Get form values
  const formatWidth = parseFloat(document.getElementById('formatWidth')?.value || 210); // mm
  const planScale = parseFloat(document.getElementById('planScale')?.value || 100); // 1:X
  
  if (!uploadedImage || !uploadedImage.naturalWidth) {
    return 0.001; // Default value if image not available
  }
  
  // Real world width in meters (taking plan scale into account)
  const realWorldWidthMm = formatWidth * planScale; // mm in real world
  const realWorldWidthM = realWorldWidthMm / 1000; // convert to meters
  
  // Image width in pixels
  const imageWidthPixels = uploadedImage.naturalWidth;
  
  // Calculate pixel to meter conversion
  const pixelToMeter = realWorldWidthM / imageWidthPixels;
  
  return pixelToMeter;
}

/**
 * Delete selected objects
 */
function deleteSelectedObjects() {
  if (!canvas || selectedObjects.length === 0) return;

  selectedObjects.forEach(obj => {
    canvas.remove(obj);
  });

  selectedObjects = [];
  canvas.renderAll();
  saveHistorySnapshot();
}

/**
 * Calculate optimal position for text label based on annotation's REAL Fabric.js coordinates
 */
function calculateLabelPosition(annotationObject) {
  // Use REAL Fabric.js coordinates instead of calculated bounds
  const actualLeft = annotationObject.left || 0;
  const actualTop = annotationObject.top || 0;
  
  // For polygons, position text at center of actual object
  if (annotationObject.type === 'polygon') {
    return {
      x: actualLeft,  // Center of polygon
      y: actualTop    // Center of polygon
    };
  }
  
  // For rectangles and lines, position slightly above and to the left of actual position
  return {
    x: actualLeft + 10,
    y: actualTop - 5
  };
}

/**
 * Get currently selected label ID from universal dropdown
 */
function getCurrentSelectedLabel() {
  const universalLabelSelect = document.getElementById('universalLabelSelect');
  return universalLabelSelect ? parseInt(universalLabelSelect.value) : 1;
}

/**
 * Apply label change to currently selected object
 */
function applyLabelChangeToSelectedObject() {
  if (!canvas || selectedObjects.length === 0) return;
  
  const universalLabelSelect = document.getElementById('universalLabelSelect');
  if (!universalLabelSelect) return;
  
  const newLabelId = parseInt(universalLabelSelect.value);
  const selectedObject = selectedObjects[0];
  
  // Update object properties
  selectedObject.labelId = newLabelId;
  selectedObject.objectLabel = newLabelId;
  
  // Determine label type based on object
  const isLineObject = selectedObject.annotationType === 'line';
  
  // Get new label info
  let label;
  if (isLineObject && typeof getLabelById !== 'undefined') {
    const lineLabel = getLabelById(newLabelId, 'line');
    label = lineLabel ? { name: lineLabel.name, color: lineLabel.color } : { name: 'Strecke', color: '#FF0000' };
  } else {
    label = getLabel(newLabelId);
  }
  
  // Update visual appearance
  if (isLineObject) {
    selectedObject.set({
      stroke: label.color
    });
  } else {
    selectedObject.set({
      fill: label.color + '20', // 20% opacity
      stroke: label.color
    });
  }
  
  // Update linked text label color
  const linkedTextLabel = canvas.getObjects().find(obj => 
    obj.objectType === 'textLabel' && obj.linkedAnnotationId === selectedObject.id
  );
  if (linkedTextLabel) {
    linkedTextLabel.set({
      backgroundColor: label.color
    });
  }
  
  canvas.renderAll();
  saveHistorySnapshot();
}


// Make functions globally available
window.updateResultsTable = updateResultsTable;
window.createSingleTextLabel = createSingleTextLabel;
window.calculateRectangleAreaFromCanvas = calculateRectangleAreaFromCanvas;
window.calculatePolygonAreaFromCanvas = calculatePolygonAreaFromCanvas;
window.calculatePolylineLength = calculatePolylineLength;

/**
 * Polygon Drawing Functions
 */
function addPolygonPoint(pointer, e) {  
  if (!canvas || isProcessingClick) return;
  
  isProcessingClick = true;
  
  // Add point to current polygon
  currentPoints.push(pointer);
  
  if (currentPoints.length === 1) {
    // First point - start polygon
    startPolygonDrawing();
  } else {
    // Update polygon with new point
    updatePolygonFromPoints();
  }
  
  setTimeout(() => { isProcessingClick = false; }, 50);
}

function startPolygonDrawing() {
  if (!canvas || currentPoints.length === 0) return;
  
  drawingMode = true;
  
  // Get current selected label and its color
  const selectedLabelId = getCurrentSelectedLabel();
  const label = getLabel(selectedLabelId);
  
  // Create initial polygon with first point duplicated to make it visible
  const firstPoint = currentPoints[0];
  const points = [
    { x: firstPoint.x, y: firstPoint.y },
    { x: firstPoint.x + 1, y: firstPoint.y + 1 } // Slightly offset to make it visible
  ];
  
  currentPolygon = new Polygon(points, {
    fill: label.color + '20', // 20% opacity
    stroke: label.color,
    strokeWidth: 2,
    objectType: 'annotation',
    annotationType: 'polygon',
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
    objectCaching: false
  });
  
  canvas.add(currentPolygon);
  canvas.renderAll();
}

function updatePolygonFromPoints() {
  if (!currentPolygon || currentPoints.length < 2) return;
  
  // TEMPORARY DRAWING: Use absolute coordinates (incorrect but works for preview)
  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));
  
  // Update polygon points
  currentPolygon.set({
    points: fabricPoints,
    hasBorders: true,
    hasControls: true,
  });

  canvas.renderAll();
}

function updatePolygonPreview(pointer) {
  if (!currentPolygon || currentPoints.length === 0) return;
  
  // Add current mouse position as preview point
  const previewPoints = [...currentPoints, pointer];
  const fabricPoints = previewPoints.map(p => ({ x: p.x, y: p.y }));
  
  currentPolygon.set({
    points: fabricPoints
  });
  
  canvas.renderAll();
}

function finishPolygonDrawing() {
  if (!currentPolygon || currentPoints.length < 3) {
    console.warn('Need at least 3 points to create polygon');
    if (currentPolygon) {
      canvas.remove(currentPolygon);
    }
    resetPolygonDrawing();
    return;
  }
  
  // Remove the temporary polygon (with wrong coordinates)
  canvas.remove(currentPolygon);
  
  // Get selected label
  const selectedLabelId = getCurrentSelectedLabel();
  const label = getLabel(selectedLabelId);
  
  // SIMPLE APPROACH: Use original points, prevent Fabric.js offset
  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));
  
  // Create polygon with original points
  const finalPolygon = new Polygon(fabricPoints, {
    fill: label.color + '20', // 20% opacity
    stroke: label.color,
    strokeWidth: 2,
    objectType: 'annotation',
    annotationType: 'polygon',
    selectable: true,
    evented: true,
    labelId: selectedLabelId,
    objectLabel: selectedLabelId,
    hasControls: true,
    hasBorders: true,
    objectCaching: false
  });
    
  canvas.add(finalPolygon);
  canvas.renderAll();
  
  // Create text label with delay to ensure annotation is fully stabilized
  setTimeout(() => {
    createSingleTextLabel(finalPolygon);
    saveHistorySnapshot();
  }, 10);

  resetPolygonDrawing();
}

function resetPolygonDrawing() {
  drawingMode = false;
  currentPolygon = null;
  currentPoints = [];
}

/**
 * Line Drawing Functions - Multi-segment perimeter tool
 */
function addLinePoint(pointer, e) {  
  if (!canvas || isProcessingClick) return;
  
  isProcessingClick = true;
  
  // Add point to current line sequence
  currentPoints.push(pointer);
  
  if (currentPoints.length === 1) {
    // First point - start line sequence
    startLineDrawing();
    drawingMode = true; // Enable mouse move for preview
  } else {
    // Additional point - extend the line sequence
    updateLineFromPoints();
  }
  
  setTimeout(() => { isProcessingClick = false; }, 50);
}

function startLineDrawing() {
  if (!canvas || currentPoints.length === 0) return;
    
  // Get current selected label and its color
  const selectedLabelId = getCurrentSelectedLabel();
  const lineLabel = getLabelById ? getLabelById(selectedLabelId) : null;
  const labelColor = lineLabel ? lineLabel.color : '#FF0000';
  
  // Create initial polyline with first point duplicated to make it visible
  const firstPoint = currentPoints[0];
  const points = [
    { x: firstPoint.x, y: firstPoint.y },
    { x: firstPoint.x + 1, y: firstPoint.y + 1 } // Slightly offset to make it visible
  ];
  
  currentLine = new Polyline(points, {
    fill: '',
    stroke: labelColor,
    strokeWidth: 5, // Increased from 3 to 5 for better selection
    objectType: 'annotation',
    annotationType: 'line',
    selectable: currentTool === 'select',
    evented: currentTool === 'select',
    objectCaching: false, // true = verbessert performance und objekte werden schneller gerendert
    absolutePositioned: true, // Wichtig, dass Objekt anhand der canvas-Koordinaten positioniert wird
    clipPath: null, // null = keine Einschränkung bei der Grösse des Polygons. 
    width: canvas.width,
    height: canvas.height
  });
  
  canvas.add(currentLine);
  canvas.renderAll();
}

function updateLineFromPoints() {
  if (!currentLine || currentPoints.length < 2) return;
  
  // TEMPORARY DRAWING: Use absolute coordinates (incorrect but works for preview)
  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));
  
  // Update polyline points
  currentLine.set({
    points: fabricPoints
  });
  
  canvas.renderAll();
}

function updateLinePreview(pointer) {
  if (!currentLine || currentPoints.length === 0) return;
  
  // Add current mouse position as preview point
  const previewPoints = [...currentPoints, pointer];
  const fabricPoints = previewPoints.map(p => ({ x: p.x, y: p.y }));
  
  currentLine.set({
    points: fabricPoints
  });
  
  canvas.renderAll();
}

function finishLineDrawing() {
  if (!currentLine || currentPoints.length < 2) {
    console.warn('Need at least 2 points to create line sequence');
    if (currentLine) {
      canvas.remove(currentLine);
    }
    resetLineDrawing();
    return;
  }
  
  // Remove the temporary line (with wrong coordinates)
  canvas.remove(currentLine);
    
  // Get selected label
  const selectedLabelId = getCurrentSelectedLabel();
  const lineLabel = getLabelById ? getLabelById(selectedLabelId) : null;
  const labelColor = lineLabel ? lineLabel.color : '#FF0000';
  
  // SIMPLE APPROACH: Use original points, prevent Fabric.js offset
  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));
  
  // Create polyline with original points
  const finalLine = new Polyline(fabricPoints, {
    fill: '',
    stroke: labelColor,
    strokeWidth: 5,
    objectType: 'annotation',
    annotationType: 'line',
    selectable: true,
    evented: true,
    labelId: selectedLabelId,
    objectLabel: selectedLabelId,
    hasControls: true,
    hasBorders: true,
    objectCaching: false
  });
  
  
  canvas.add(finalLine);
  canvas.renderAll();
  
  // Create text label with delay to ensure annotation is fully stabilized
  setTimeout(() => {
    createSingleTextLabel(finalLine);
    saveHistorySnapshot();
  }, 10);

  resetLineDrawing();
}

function resetLineDrawing() {
  drawingMode = false;
  currentLine = null;
  currentPoints = [];
}

/**
 * Create a text label for a single new annotation without affecting others
 */
function createSingleTextLabel(annotation) {
  if (!annotation || !canvas) return;
  
  // Generate unique ID for linking
  const linkId = `annotation_${Date.now()}_${Math.random()}`;
  
  // Set ID on annotation
  annotation.set('id', linkId);
  
  // Assign stable display index if not already set
  if (!annotation.displayIndex) {
    const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
    const existingIndices = annotations
      .filter(ann => ann.displayIndex)
      .map(ann => ann.displayIndex);
    
    // Find next available index
    let nextIndex = 1;
    while (existingIndices.includes(nextIndex)) {
      nextIndex++;
    }
    
    annotation.displayIndex = nextIndex;
  }
  
  const displayNumber = annotation.displayIndex;
  
  // Calculate area/length for display
  let measurement = '';
  if (annotation.type === 'rect') {
    const area = calculateRectangleAreaFromCanvas(annotation);
    measurement = `\n${area.toFixed(2)} m²`;
  } else if (annotation.type === 'polygon') {
    const area = calculatePolygonAreaFromCanvas(annotation);
    measurement = `\n${area.toFixed(2)} m²`;
  } else if (annotation.type === 'polyline') {
    const length = calculatePolylineLength(annotation.points || []);
    measurement = `\n${length.toFixed(2)} m`;
  }
  
  // Get annotation color
  const labelColor = annotation.stroke || annotation.fill || '#000000';
  
  // Calculate position
  const labelPosition = calculateLabelPosition(annotation);
  
  // Create text label with number and area/length (no inverse scaling)
  const textLabel = new Text(displayNumber.toString() + measurement, {
    left: labelPosition.x,
    top: labelPosition.y,
    fontSize: 14, // Fixed font size - let Canvas handle zoom scaling
    fill: 'white',
    backgroundColor: labelColor,
    padding: 4, // Fixed padding - let Canvas handle zoom scaling
    textAlign: 'center',
    fontWeight: 'bold',
    originX: 'center',
    originY: 'center',
    selectable: false,
    evented: false,
    objectType: 'textLabel',
    linkedAnnotationId: linkId
  });
  
  canvas.add(textLabel);
  applyLayerOrdering(); // enforce label z-order after every new annotation
  canvas.renderAll();

  updateResultsTable();
  updateSummary();

  return textLabel;
}

/**
 * Update position of linked text label - zoom-safe synchronization
 */
function updateLinkedTextLabelPosition(annotation) {
  if (!canvas || !annotation.id) return;
  
  // Find the linked text label
  const textLabel = canvas.getObjects().find(obj => 
    obj.objectType === 'textLabel' && obj.linkedAnnotationId === annotation.id
  );
  
  if (textLabel) {
    // Calculate new position
    const newPosition = calculateLabelPosition(annotation);
    
    // Recalculate area/length after object modification
    let measurement = '';
    if (annotation.type === 'rect') {
      const area = calculateRectangleAreaFromCanvas(annotation);
      measurement = `\n${area.toFixed(2)} m²`;
    } else if (annotation.type === 'polygon') {
      const area = calculatePolygonAreaFromCanvas(annotation);
      measurement = `\n${area.toFixed(2)} m²`;
    } else if (annotation.type === 'polyline') {
      const length = calculatePolylineLength(annotation.points || []);
      measurement = `\n${length.toFixed(2)} m`;
    }
    
    // Use stable display index instead of dynamic calculation
    const displayNumber = annotation.displayIndex || 1;
    
    // Sync text label color with annotation color
    const annotationColor = annotation.stroke || annotation.fill || '#000000';
    
    // Update position, text content, and color
    textLabel.set({
      left: newPosition.x,
      top: newPosition.y,
      text: displayNumber.toString() + measurement,
      backgroundColor: annotationColor
    });
  }
}

/**
 * Refresh measurement text on all canvas labels after scale/format change.
 */
function refreshAllCanvasLabels() {
  if (!canvas) return;
  canvas.getObjects()
    .filter(obj => obj.objectType === 'annotation' && obj.id)
    .forEach(annotation => updateLinkedTextLabelPosition(annotation));
  canvas.renderAll();
}

/**
 * Recalculate all annotation indices in order of creation or position
 * @param {string} sortBy - 'creation' (default) or 'position' (left-to-right, top-to-bottom)
 */
function recalculateAllIndices(sortBy = 'creation') {
  if (!canvas) return;
  
  // Get all annotations
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  
  if (annotations.length === 0) return;
  
  // Sort annotations based on preference
  let sortedAnnotations;
  if (sortBy === 'position') {
    // Sort by position: first by top (y), then by left (x)
    sortedAnnotations = [...annotations].sort((a, b) => {
      const aTop = a.top || 0;
      const bTop = b.top || 0;
      const aLeft = a.left || 0;
      const bLeft = b.left || 0;
      
      // If same row (within 50px), sort by left position
      if (Math.abs(aTop - bTop) < 50) {
        return aLeft - bLeft;
      }
      return aTop - bTop;
    });
  } else {
    // Sort by creation order (keep existing order in canvas)
    sortedAnnotations = annotations;
  }
  
  // Reassign display indices
  sortedAnnotations.forEach((annotation, index) => {
    annotation.displayIndex = index + 1;
    
    // Update linked text label
    updateLinkedTextLabelPosition(annotation);
  });
  
  // Update UI
  canvas.renderAll();
  updateResultsTable();
  updateSummary();
  
  // Show confirmation
  const statusDiv = document.createElement('div');
  statusDiv.className = 'save-status';
  statusDiv.textContent = `${annotations.length} Annotationen neu nummeriert`;
  statusDiv.style.backgroundColor = '#4CAF50';
  document.body.appendChild(statusDiv);
  
  setTimeout(() => {
    statusDiv.style.opacity = '0';
    setTimeout(() => statusDiv.remove(), 500);
  }, 2000);
}

/**
 * Calculate total length of a polyline (multiple connected segments)
 * @param {Array} points - Array of {x,y} points
 * @returns {number} Total length in meters
 */
function calculatePolylineLength(points) {
  if (points.length < 2) return 0;
  
  const pixelToMeter = getPixelToMeterFactor();
  
  // Canvas coordinates are now 1:1 with natural coordinates (no conversion needed)
  const naturalPoints = points;
  
  // Calculate total length by summing all segments
  let totalLength = 0;
  
  for (let i = 0; i < naturalPoints.length - 1; i++) {
    const dx = naturalPoints[i+1].x - naturalPoints[i].x;
    const dy = naturalPoints[i+1].y - naturalPoints[i].y;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);
    totalLength += segmentLength;
  }
  
  // Convert to meters
  const lengthInMeters = totalLength * pixelToMeter;
  
  return lengthInMeters;
}

/**
 * Collect current canvas annotations in Fabric.js format for saving
 * Multi-Page version: collects data for the current page
 * @param {number} pageNumber - The current page number
 * @returns {Object} Canvas data with all annotations and metadata for this page
 */
function collectCurrentCanvasData(pageNumber = 1) {
  if (!canvas) {
    console.warn('No canvas available for data collection');
    return {
      page_number: pageNumber,
      canvas_annotations: [],
      annotation_count: 0,
      canvas_available: false
    };
  }
  
  // Get all annotations from canvas (exclude background image and text labels)
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  
  // Convert canvas objects to serializable format with all custom properties
  const canvasAnnotations = annotations.map(annotation => {
    // Use Fabric.js toObject method to get serializable data
    // Include our custom properties that need to be preserved
    const customProperties = [
      'displayIndex',      // Our stable index system
      'labelId',          // Label assignment
      'objectLabel',      // Alternative label field
      'userCreated',      // User vs AI created flag
      'linkedAnnotationId', // Link to text label
      'annotationType'    // Type: rectangle, polygon, line
    ];
    
    const fabricObject = annotation.toObject(customProperties);
    
    // Add our metadata
    fabricObject.objectType = 'annotation';
    fabricObject.saved_at = new Date().toISOString();
    
    return fabricObject;
  });
  
  return {
    page_number: pageNumber,
    canvas_annotations: canvasAnnotations,
    annotation_count: annotations.length,
    canvas_available: true,
    canvas_zoom: canvas.getZoom(),
    canvas_viewport: canvas.viewportTransform,
    saved_at: new Date().toISOString()
  };
}

/**
 * Save current canvas state to page-specific storage
 * @param {number} pageNum - Page number to save to
 */
function saveCurrentPageCanvasData(pageNum = currentPageNumber) {
  if (canvas) {
    const canvasData = collectCurrentCanvasData(pageNum);
    pageCanvasData[pageNum] = canvasData;
    console.log(`Saved canvas data for page ${pageNum}: ${canvasData.annotation_count} annotations`);
  }
}

/**
 * Load canvas data for a specific page
 * @param {number} pageNum - Page number to load
 */
function loadPageCanvasData(pageNum) {
  const canvasData = pageCanvasData[pageNum];
  if (canvasData && canvasData.canvas_available && window.loadCanvasData) {
    console.log(`Loading canvas data for page ${pageNum}: ${canvasData.annotation_count} annotations`);
    window.loadCanvasData(canvasData);
  } else {
    console.log(`No canvas data available for page ${pageNum}`);
    // Clear canvas for empty page
    if (canvas) {
      canvas.clear();
      initCanvas();
    }
  }
}

/**
 * Set current page number and handle page switching
 * @param {number} pageNum - New current page number
 */
function setCurrentPage(pageNum) {
  if (pageNum !== currentPageNumber) {
    // Save current page before switching
    saveCurrentPageCanvasData(currentPageNumber);
    
    // Switch to new page
    currentPageNumber = pageNum;
    console.log(`Switched to page ${currentPageNumber}`);
  }
}

/**
 * Initialize page canvas data from loaded project data
 * @param {Object} projectCanvasData - Canvas data from loaded project
 */
function initializePageCanvasData(projectCanvasData) {
  // Multi-page format: load all pages
  pageCanvasData = { ...projectCanvasData.pages };
  currentPageNumber = projectCanvasData.current_page || 1;
  console.log(`Initialized ${Object.keys(pageCanvasData).length} pages of canvas data`);
}

/**
 * Collect Canvas data for ALL pages in a multi-page project
 * @returns {Object} Canvas data organized by page number
 */
function collectAllPagesCanvasData() {
  // Save current page first
  saveCurrentPageCanvasData(currentPageNumber);
  
  // Get current page info from PDF module
  const allPages = getAllPdfPages();
  const totalPages = allPages ? allPages.length : 1;
  
  return {
    format: 'multi_page_canvas_v1',
    total_pages: totalPages,
    pages: { ...pageCanvasData }, // Include all pages with data
    current_page: currentPageNumber,
    saved_at: new Date().toISOString()
  };
}

/**
 * Analyze the currently displayed page with the AI model.
 * Reads session_id and settings from current state.
 * Does NOT auto-trigger – only runs when the user clicks the button.
 */
async function analyzeCurrentPage() {
  const sessionId = getPdfSessionId() || getUploadSessionId();
  if (!sessionId) {
    alert('Bitte zuerst eine Datei hochladen.');
    return;
  }

  const btn = document.getElementById('analyzeCurrentPageBtn');
  const loader = document.getElementById('loader');
  const errorMessage = document.getElementById('errorMessage');

  // UI: busy state
  if (btn) { btn.disabled = true; btn.classList.add('analyzing'); btn.textContent = '⏳ Analysiert…'; }
  if (loader) loader.style.display = 'block';
  if (errorMessage) errorMessage.style.display = 'none';

  // Mark page as "analyzing" in sidebar
  setPageStatus(currentPageNumber, 'analyzing');

  try {
    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('page', currentPageNumber);
    formData.append('format_width',  document.getElementById('formatWidth')?.value  || 210);
    formData.append('format_height', document.getElementById('formatHeight')?.value || 297);
    formData.append('dpi',           document.getElementById('dpi')?.value           || 150);
    formData.append('plan_scale',    document.getElementById('planScale')?.value     || 100);
    formData.append('threshold',     document.getElementById('threshold')?.value     || 0.5);

    const response = await fetch('/analyze_page', { method: 'POST', body: formData });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Analyse fehlgeschlagen');
    }

    const data = await response.json();
    window.data = data;

    // Store raw predictions for ZIP export / PDF report generation
    pageAnalysisData[currentPageNumber] = data.predictions || [];

    // Convert AI predictions → canvas annotations for this page
    if (data.predictions && data.predictions.length > 0) {
      const canvasData = convertPredictionsToCanvasData(data.predictions, currentPageNumber);
      loadCanvasData(canvasData);
      pageCanvasData[currentPageNumber] = canvasData;
    }

    updateResultsTable();
    updateSummary();

    // Mark as done in sidebar
    setPageStatus(currentPageNumber, 'analyzed');

  } catch (err) {
    console.error('Analyse-Fehler:', err);
    if (errorMessage) {
      errorMessage.textContent = 'Fehler: ' + err.message;
      errorMessage.style.display = 'block';
    }
    setPageStatus(currentPageNumber, 'none');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('analyzing');
      btn.textContent = '🔍 Fenster erkennen';
    }
    if (loader) loader.style.display = 'none';
  }
}

/**
 * Initialize application
 */
async function initApp() {
  
  // Fabric.js is now available through ES6 imports
  
  // Get DOM elements
  imageContainer = document.getElementById('imageContainer');
  uploadedImage = document.getElementById('uploadedImage');
  
   // ── New upload flow: called by upload-modal.js after successful /upload ──
  window.onUploadReady = function(uploadInfo) {
    console.log('Upload ready:', uploadInfo);

    // Store session + all pages in PDF handler so navigation and project-save work
    setPdfSessionId(uploadInfo.session_id);
    setPdfNavigationState(1, uploadInfo.page_count, uploadInfo.all_pages);

    // Track original PDF blob so it can be included in ZIP saves
    if (uploadInfo.is_pdf && uploadInfo.original_file) {
      setOriginalPdfBlob(uploadInfo.original_file);
    }

    // Full reset for new upload – clear all previous project state
    pageCanvasData   = {};
    pageAnalysisData = {};
    setPageSettings({});
    setOriginalPdfBlob(null);
    if (canvas) canvas.clear();

    // Show results section + enable toolbar
    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) resultsSection.style.display = 'block';

    // Enable "Analyze page" button
    const analyzeBtn = document.getElementById('analyzeCurrentPageBtn');
    if (analyzeBtn) analyzeBtn.disabled = false;

    // Navigate to page 1 (just display image, no analysis)
    navigateToPageNoAnalysis(1, uploadInfo.all_pages, uploadInfo.page_sizes);
  };

  /** Persist current UI field values into pageSettings for the given page. */
  function saveCurrentPageSettings(pageNum) {
    const current = getPageSettings();
    current[pageNum] = {
      format_width:  parseFloat(document.getElementById('formatWidth')?.value)  || 210,
      format_height: parseFloat(document.getElementById('formatHeight')?.value) || 297,
      dpi:           parseFloat(document.getElementById('dpi')?.value)           || 150,
      plan_scale:    parseFloat(document.getElementById('planScale')?.value)     || 100
    };
    setPageSettings(current);
  }

  /** Restore saved pageSettings into UI fields for the given page. */
  function loadPageSettingsToUI(pageNum) {
    const settings = getPageSettings();
    const s = settings[pageNum] || settings[String(pageNum)];
    if (!s) return;
    const fw    = document.getElementById('formatWidth');
    const fh    = document.getElementById('formatHeight');
    const dpi   = document.getElementById('dpi');
    const scale = document.getElementById('planScale');
    if (fw    && s.format_width  != null) fw.value    = s.format_width;
    if (fh    && s.format_height != null) fh.value    = s.format_height;
    if (dpi   && s.dpi           != null) dpi.value   = s.dpi;
    if (scale && s.plan_scale    != null) scale.value = s.plan_scale;
    // Keep sidebar dropdown in sync
    if (s.plan_scale != null) setPageScaleInSidebar(pageNum, s.plan_scale);
  }

  /**
   * Navigate to a page without running the AI – just show the image.
   * Called from the left sidebar page list and from onUploadReady.
   */
  function navigateToPageNoAnalysis(pageNumber, allPages, pageSizes) {
    const pages = allPages || getAllPdfPages();
    if (!pages || pages.length === 0) return;

    const imageUrl = pages[pageNumber - 1];
    if (!imageUrl) return;

    // Save current page settings before switching
    if (currentPageNumber !== pageNumber) {
      saveCurrentPageSettings(currentPageNumber);
    }

    // Update page state
    setCurrentPage(pageNumber);
    currentPageNumber = pageNumber;

    // Sync sidebar highlight
    setActivePageInList(pageNumber);

    // Restore per-page settings (format, DPI, scale) – falls back to pageSizes for fresh uploads
    const savedSettings = getPageSettings();
    if (savedSettings[pageNumber] || savedSettings[String(pageNumber)]) {
      loadPageSettingsToUI(pageNumber);
    } else {
      // First visit: initialise from PDF-detected page sizes + current DPI/scale defaults
      const sizes = pageSizes || getPageSizes();
      if (sizes && sizes[pageNumber - 1]) {
        const s = sizes[pageNumber - 1];
        const fw = document.getElementById('formatWidth');
        const fh = document.getElementById('formatHeight');
        if (fw) fw.value = s.width_mm ?? Math.round(s[0] ?? 210);
        if (fh) fh.value = s.height_mm ?? Math.round(s[1] ?? 297);
      }
      // Persist these initial values so they're included in ZIP saves
      saveCurrentPageSettings(pageNumber);
    }

    // Load image into canvas
    uploadedImage.style.display = 'block';
    uploadedImage.onload = function() {
      // Check if we already have canvas data for this page (e.g. after analysis)
      if (pageCanvasData[pageNumber]) {
        loadPageCanvasData(pageNumber);
      } else {
        // Empty canvas – just show the image
        if (canvas) {
          canvas.clear();
        }
        initCanvas();
        pageCanvasData[pageNumber] = {
          page_number: pageNumber,
          canvas_annotations: [],
          annotation_count: 0,
          canvas_available: true
        };
      }
      updateResultsTable();
      updateSummary();
      // Reset undo/redo history for each new page
      setTimeout(() => { initHistory(); saveHistorySnapshot(); }, 200);
    };
    // Blob URLs don't support query parameters – only add cache-busting for server paths
    uploadedImage.src = imageUrl.startsWith('blob:') ? imageUrl : imageUrl + '?t=' + Date.now();
  }
  // Expose for upload-modal page-click callback
  window.navigateToPageNoAnalysis = navigateToPageNoAnalysis;
  
  // Editor is always active - setup canvas events when canvas is ready
  // Canvas events will be set up in initCanvas() when editor is active
  
  // Setup tool buttons initially
  setupToolButtons();

  // Keyboard shortcuts for tools
  document.addEventListener('keydown', function(e) {
    // Don't fire when typing in an input, textarea or select
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Ctrl / Cmd shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' || e.key === 'Z') {
        if (e.shiftKey) { redoHistory(); } else { undoHistory(); }
        e.preventDefault(); return;
      }
      if (e.key === 'c' || e.key === 'C') { copySelectedAnnotations(); e.preventDefault(); return; }
      if (e.key === 'v' || e.key === 'V') { pasteAnnotations();        e.preventDefault(); return; }
      return; // don't let other Ctrl+key combos trigger tool shortcuts
    }

    switch (e.key) {
      case 's': case 'S': setTool('select');    break;
      case 'r': case 'R': setTool('rectangle'); break;
      case 'p': case 'P': setTool('polygon');   break;
      case 'l': case 'L': setTool('line');      break;
      case 'Delete':
      case 'Backspace':   deleteSelectedObjects(); e.preventDefault(); break;
      case 'Escape':
        // First Escape cancels in-progress drawing; second Escape switches to select
        if ((currentTool === 'polygon' || currentTool === 'line') && drawingMode) {
          cleanupCurrentTool();
          resetAllDrawingStates();
          canvas?.renderAll();
        } else {
          setTool('select');
        }
        break;
    }
  });

  // Setup recalculate indices button
  const recalculateBtn = document.getElementById('recalculateIndicesBtn');
  if (recalculateBtn) {
    recalculateBtn.addEventListener('click', function() {
      // Ask user for sorting preference
      const sortByPosition = confirm(
        'Möchten Sie die Nummern nach Position sortieren?\n\n' +
        'OK = Nach Position (links-rechts, oben-unten)\n' +
        'Abbrechen = Nach Erstellungsreihenfolge'
      );
      
      const sortBy = sortByPosition ? 'position' : 'creation';
      recalculateAllIndices(sortBy);
    });
  }
  
  // Setup universal label dropdown change listener
  const universalLabelSelect = document.getElementById('universalLabelSelect');
  if (universalLabelSelect) {
    universalLabelSelect.addEventListener('change', function() {
      // If there's a selected object, apply the label change immediately
      if (currentTool === 'select' && selectedObjects.length > 0) {
        applyLabelChangeToSelectedObject();
      }
    });
  }
    
  // Initialize upload handler (left column drop zone)
  setupUploadModal();

  // Wire sidebar page-click → navigate without auto-analysis
  setOnPageClick((pageNumber) => {
    navigateToPageNoAnalysis(pageNumber);
  });

  // When user changes scale in sidebar → update hidden input + pageSettings + canvas labels
  setOnScaleChange((pageNum, scale) => {
    const scaleInput = document.getElementById('planScale');
    if (scaleInput) scaleInput.value = scale;
    const current = getPageSettings();
    const existing = current[pageNum] || current[String(pageNum)] || {};
    current[pageNum] = { ...existing, plan_scale: scale };
    setPageSettings(current);
    // Refresh canvas labels and results table with new scale
    refreshAllCanvasLabels();
    updateResultsTable();
    updateSummary();
  });

  // Wire "Fenster erkennen" button
  const analyzeCurrentPageBtn = document.getElementById('analyzeCurrentPageBtn');
  if (analyzeCurrentPageBtn) {
    analyzeCurrentPageBtn.addEventListener('click', analyzeCurrentPage);
  }

  
  // Initialize labels module (async)
  await setupLabels({
    labelManagerModal: document.getElementById('labelManagerModal'),
    manageLabelBtn: document.getElementById('manageLabelBtn'),
    closeModalBtn: document.querySelector('#labelManagerModal .close'),
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
    cancelLabelBtn: document.getElementById('cancelLabelBtn')
  });
  
  // Initialize project management module
  setupProject({
    projectList: document.getElementById('projectList'),
    saveProjectBtn: document.getElementById('saveProjectBtn'),
    loadProjectBtn: document.getElementById('loadProjectBtn'),
    exportPdfBtn: document.getElementById('exportPdfBtn'),
    exportAnnotatedPdfBtn: document.getElementById('exportAnnotatedPdfBtn')
  }, {
    pdfModule: {
      getPdfSessionId,
      getPdfPageData,
      getPageSettings,
      getAllPdfPages,
      setPdfSessionId,
      setPdfPageData,
      setPageSettings,
      setPdfNavigationState,
      getOriginalPdfBlob,
      setOriginalPdfBlob
    }
  });
  
  // Make essential functions globally available for inter-module communication
  window.collectCurrentCanvasData = collectCurrentCanvasData;
  window.collectAllPagesCanvasData = collectAllPagesCanvasData;
  window.loadCanvasData = loadCanvasData;
  window.initializePageCanvasData = initializePageCanvasData;
  window.collectAllPagesAnalysisData = () => ({ ...pageAnalysisData });

  // Update all sidebar scale dropdowns at once (called after ZIP load)
  window.syncAllPageScalesInSidebar = function() {
    const settings = getPageSettings();
    for (const [page, s] of Object.entries(settings)) {
      if (s && s.plan_scale != null) setPageScaleInSidebar(parseInt(page), s.plan_scale);
    }
  };

}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
