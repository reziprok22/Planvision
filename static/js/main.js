/**
 * main.js - Fenster-Erkennungstool Main Application
 * Core functionality: Upload, Predict, Annotation Display, Drawing Tools, Zoom
 */

// Import Fabric.js
import { Canvas, FabricImage as Image, Rect, Polygon, Polyline, FabricText as Text, Shadow, util, Circle } from 'fabric';

// Import modules
import {
  setupLabels,
  getLabelById,
  getLabelName,
  getLabelColor,
  getCurrentLabels,
  getCurrentLineLabels,
  getLabelsForTool,
  applyLayerOrdering,
  closeLabelManager
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
let clipboard = [];                // serialised annotations ready to paste
let clipboardSourceIds = [];       // canvas IDs of originals at copy time
let clipboardSourcePositions = {}; // {id: {left, top}} of originals at copy time
let editingPolygon = null;         // polygon currently in vertex-edit mode
let vertexHandles = [];            // Circle handles shown during vertex editing
let pasteOffset = 0;               // increases with each paste so copies don't stack

// Crosshair overlay for drawing tools
let crosshairCanvas = null;
let crosshairCtx = null;
let crosshairVisible = false;

// Currently held drawing-tool key (q/w/e) for scroll-to-cycle
let heldDrawingKey = null;

// Label cursor tooltip
let labelTooltipEl = null;
let labelTooltipTimer = null;
let lastMouseClientX = 0;
let lastMouseClientY = 0;

// Undo / Redo history
const HISTORY_LIMIT = 30;
let undoStack = [];      // serialised states; top = current state
let redoStack = [];
let isHistoryAction = false; // true while restoring a state (prevents recursive saves)

// Per-page session cache for projects loaded without a PDF blob (image-only projects).
// Maps pageNumber → { sessionId, pageNumOnServer } so we avoid re-uploading on every click.
let imageSessionCache = {};

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
  // Only touch buttons with data-tool — others (shortcuts, recalculate) manage their own listeners
  document.querySelectorAll('.tool-button[data-tool]').forEach(button => {
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);
  });

  document.querySelectorAll('.tool-button[data-tool]').forEach(button => {
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
  canvas.perPixelTargetFind = false;    // Bounding-box hit detection — perPixel scans every pixel of every object on each mousemove, kills perf with many annotations
  canvas.uniformScaling = false;        // free resize by default; Shift = proportional
  
  const naturalWidth  = uploadedImage.naturalWidth;
  const naturalHeight = uploadedImage.naturalHeight;

  // Canvas buffer = viewport size (fixed). A #scrollSpacer div drives the scroll area.
  // viewportTransform handles both zoom and pan translation — no more mega-buffers at high zoom.
  const containerW = imageContainer.clientWidth  || naturalWidth;
  const containerH = imageContainer.clientHeight || naturalHeight;
  canvas.setWidth(containerW);
  canvas.setHeight(containerH);

  // Scroll spacer: invisible div that creates the virtual scroll area for the container.
  // Sized to natW × natH initially; zoom handler resizes it.
  const existingSpacer = document.getElementById('scrollSpacer');
  if (existingSpacer) existingSpacer.remove();
  const scrollSpacer = document.createElement('div');
  scrollSpacer.id = 'scrollSpacer';
  scrollSpacer.style.cssText = `flex-shrink:0;width:${naturalWidth}px;height:${naturalHeight}px;pointer-events:none;`;
  imageContainer.appendChild(scrollSpacer);
  
  // Add image as Fabric.js v6 background at 1:1 scale.
  // Use the already-loaded HTMLImageElement directly to avoid a redundant network fetch/decode.
  const bgImg = new Image(uploadedImage, {
    left: 0,
    top: 0,
    scaleX: 1.0,
    scaleY: 1.0,
    selectable: false,
    evented: false,
    excludeFromExport: true
  });
  canvas.backgroundImage = bgImg;
  canvas.renderAll();
  
  // Hide the HTML image since we're using Fabric.js background
  uploadedImage.style.display = 'none';
  
  // Enable Fabric.js zoom functionality with Ctrl+Wheel, allow normal scrolling
  canvas.on('mouse:wheel', function(opt) {
    // Drawing-key held + scroll → cycle through labels
    if (heldDrawingKey && !opt.e.ctrlKey) {
      const sel = document.getElementById('universalLabelSelect');
      if (sel && sel.options.length > 1) {
        const dir = opt.e.deltaY > 0 ? 1 : -1;
        const next = (sel.selectedIndex + dir + sel.options.length) % sel.options.length;
        sel.selectedIndex = next;
        sel.dispatchEvent(new Event('change'));
      }
      opt.e.preventDefault();
      opt.e.stopPropagation();
      return;
    }
    // Only zoom with Ctrl key, otherwise allow normal scrolling
    if (opt.e.ctrlKey) {
      const delta = opt.e.deltaY;
      const oldZoom = canvas.getZoom();
      let newZoom = oldZoom * (0.999 ** delta);
      if (newZoom > 5) newZoom = 5;
      // Minimum zoom: unused empty space must not exceed 150 % of the image size.
      // Constraint: containerSize ≤ 2.5 × (naturalSize × zoom)  →  zoom ≥ containerSize / (2.5 × naturalSize)
      const minZoom = Math.max(0.02,
        imageContainer.clientWidth  / (1.5 * uploadedImage.naturalWidth),
        imageContainer.clientHeight / (1.5 * uploadedImage.naturalHeight)
      );
      if (newZoom < minZoom) newZoom = minZoom;

      // Canvas is viewport-sized: offsetX/Y are already viewport-relative (0..containerW).
      const mouseContainerX = opt.e.offsetX;
      const mouseContainerY = opt.e.offsetY;

      // Image coordinate under the mouse before zoom (viewport pos + current scroll → image space).
      const natW = uploadedImage.naturalWidth;
      const natH = uploadedImage.naturalHeight;
      const imageX = (opt.e.offsetX + imageContainer.scrollLeft) / oldZoom;
      const imageY = (opt.e.offsetY + imageContainer.scrollTop)  / oldZoom;

      // Resize the scroll spacer (drives scroll bars) — canvas buffer stays viewport-sized.
      const spacer = document.getElementById('scrollSpacer');
      if (spacer) {
        spacer.style.width  = `${natW * newZoom}px`;
        spacer.style.height = `${natH * newZoom}px`;
      }

      // Scroll so the same image point stays under the mouse.
      imageContainer.scrollLeft = imageX * newZoom - mouseContainerX;
      imageContainer.scrollTop  = imageY * newZoom - mouseContainerY;

      // Sync wrapperEl position and Fabric viewportTransform (scale + pan translation).
      const sl = imageContainer.scrollLeft;
      const st = imageContainer.scrollTop;
      if (canvas.wrapperEl) canvas.wrapperEl.style.transform = `translate(${sl}px,${st}px)`;
      canvas.setViewportTransform([newZoom, 0, 0, newZoom, -sl, -st]);

      // Refresh bounding-box cache of the active drawing object so Fabric
      // doesn't skip it as "off-screen" after the viewport transform changes.
      if (currentPolygon) currentPolygon.setCoords();
      if (currentLine) currentLine.setCoords();
      if (currentRectangle) currentRectangle.setCoords();
      opt.e.preventDefault();
      opt.e.stopPropagation();
    } else {
      // Allow normal scrolling - don't prevent default
      // The container will handle scrolling naturally
    }
  });
  
  // WrapperEl: viewport-sized and absolute. On scroll, a transform keeps it in the visible area.
  const canvasWrapper = canvas.wrapperEl;
  if (canvasWrapper) {
    canvasWrapper.style.position  = 'absolute';
    canvasWrapper.style.top       = '0';
    canvasWrapper.style.left      = '0';
    canvasWrapper.style.width     = `${containerW}px`;
    canvasWrapper.style.height    = `${containerH}px`;
    canvasWrapper.style.transform = '';
  }
  
  // Setup enhanced scrolling for container
  setupContainerScrolling();
  
  // Ensure tool buttons and canvas events work after initialization
  setupToolButtons();
  setupCanvasEvents();
  createCrosshairOverlay();

  endPerfMeasurement('canvas-initialization', {
    canvas_width: naturalWidth,
    canvas_height: naturalHeight,
    image_size_mb: (naturalWidth * naturalHeight * 4) / (1024 * 1024) // Rough estimate
  });
  
  return canvas;
}

/**
 * Clamp the container's scroll position so it never scrolls past the image edge.
 * Called on every scroll event to enforce the boundary regardless of CSS layout.
 */
function clampScrollToImageBounds() {
  if (!imageContainer || !canvas || !uploadedImage) return;
  const zoom = canvas.getZoom();
  const maxX = Math.max(0, Math.round(uploadedImage.naturalWidth  * zoom) - imageContainer.clientWidth);
  const maxY = Math.max(0, Math.round(uploadedImage.naturalHeight * zoom) - imageContainer.clientHeight);
  if (imageContainer.scrollLeft > maxX) imageContainer.scrollLeft = maxX;
  if (imageContainer.scrollTop  > maxY) imageContainer.scrollTop  = maxY;
}

/**
 * Setup enhanced scrolling for the image container. shift+mousewheel = horizonal scroll
 */
function setupContainerScrolling() {
  if (!imageContainer) return;

  imageContainer.addEventListener('scroll', () => {
    clampScrollToImageBounds();
    if (!canvas) return;
    const sl = imageContainer.scrollLeft;
    const st = imageContainer.scrollTop;
    // Keep the viewport-sized wrapperEl visually in the top-left of the container.
    if (canvas.wrapperEl) canvas.wrapperEl.style.transform = `translate(${sl}px,${st}px)`;
    // Update Fabric's pan so objects render at the correct scroll position.
    const zoom = canvas.getZoom();
    canvas.setViewportTransform([zoom, 0, 0, zoom, -sl, -st]);
    canvas.requestRenderAll();
  }, { passive: true });

  imageContainer.addEventListener('wheel', function(e) {
    // If Shift key is held, convert vertical scroll to horizontal
    if (e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      imageContainer.scrollBy({ left: e.deltaY * 0.5 });
    }
    // Normal vertical scrolling happens automatically if no modifiers
    // Ctrl+Wheel is handled by Fabric.js for zooming
  }, { passive: false });
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

  // Load all annotations in one batch instead of N individual promises.
  util.enlivenObjects(canvasData.canvas_annotations).then(objects => {
    canvas.renderOnAddRemove = false;
    objects.forEach(annotation => {
      if (!annotation) return;
      annotation.set({ objectType: 'annotation', selectable: true, evented: true });
      canvas.add(annotation);
    });
    canvas.renderOnAddRemove = true;
    canvas.requestRenderAll();
    objects.filter(Boolean).forEach(annotation => createSingleTextLabel(annotation, { batch: true }));
  });
  
  // Restore zoom: resize scroll spacer (not the canvas buffer).
  const restoredZoom = canvasData.canvas_zoom || 1;
  if (uploadedImage) {
    const spacer = document.getElementById('scrollSpacer');
    if (spacer) {
      spacer.style.width  = `${uploadedImage.naturalWidth  * restoredZoom}px`;
      spacer.style.height = `${uploadedImage.naturalHeight * restoredZoom}px`;
    }
  }
  imageContainer.scrollLeft = 0;
  imageContainer.scrollTop  = 0;
  canvas.setViewportTransform([restoredZoom, 0, 0, restoredZoom, 0, 0]);
  if (canvas.wrapperEl) canvas.wrapperEl.style.transform = '';
  
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
    const fullLabel = getLabelById ? getLabelById(labelId) : null;
    const labelColor = fullLabel ? fullLabel.color : getLabel(labelId).color;
    const labelStrokeWidth = fullLabel ? (fullLabel.strokeWidth || 2) : 2;

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
        strokeWidth: labelStrokeWidth,
        labelId: labelId,
        objectLabel: labelId,
        score: pred.score ?? 0,
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
        strokeWidth: labelStrokeWidth,
        labelId: labelId,
        objectLabel: labelId,
        score: pred.score ?? 0,
        displayIndex: index + 1,
        userCreated: false,
        selectable: true,
        evented: true,
        objectCaching: true
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
        strokeWidth: labelStrokeWidth,
        labelId: labelId,
        objectLabel: labelId,
        score: pred.score ?? 0,
        displayIndex: index + 1,
        userCreated: false,
        selectable: true,
        evented: true,
        objectCaching: true
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
  
  // Get all annotation objects from canvas, sorted ascending by displayIndex
  const annotations = canvas.getObjects()
    .filter(obj => obj.objectType === 'annotation')
    .sort((a, b) => (a.displayIndex ?? Infinity) - (b.displayIndex ?? Infinity));

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
    row.addEventListener('mouseleave', () => removeHighlight());
    
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

// Currently highlighted annotation object reference (avoids index-based lookup after z-order changes)
let _highlightedAnnotation = null;

/**
 * Highlight annotation on canvas when hovering over table row
 */
function highlightAnnotation(index) {
  if (!canvas) return;
  removeHighlight(); // clear any leftover highlight first
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  const target = annotations[index];
  if (!target) return;

  _highlightedAnnotation = target;
  target._origStrokeWidth = target.strokeWidth;
  target.set({
    strokeWidth: target._origStrokeWidth * 2,
    shadow: new Shadow({ color: target.stroke, blur: 5, offsetX: 0, offsetY: 0 })
  });
  canvas.bringObjectToFront(target);
  canvas.renderAll();
}

/**
 * Remove highlight from annotation
 */
function removeHighlight() {
  if (!canvas || !_highlightedAnnotation) return;
  _highlightedAnnotation.set({
    strokeWidth: _highlightedAnnotation._origStrokeWidth ?? _highlightedAnnotation.strokeWidth,
    shadow: null
  });
  _highlightedAnnotation = null;
  canvas.renderAll();
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

// ── Copy / Paste ──────────────────────────────────────────────────────────────

function copySelectedAnnotations() {
  const annotations = selectedObjects.filter(o => o.objectType === 'annotation');
  if (!annotations.length) return;
  // Serialise with custom properties so paste recreates them faithfully
  clipboardSourceIds = annotations.map(o => o.id).filter(Boolean);
  clipboardSourcePositions = {};
  clipboard = annotations.map(o => {
    const serialized = o.toObject(['objectType', 'annotationType', 'labelId', 'objectLabel']);
    // When objects are part of an ActiveSelection their left/top are
    // relative to the selection centre.  Use the absolute transform matrix
    // to recover canvas-absolute coordinates before serialising.
    if (o.group) {
      const m = o.calcTransformMatrix(); // [4],[5] = absolute centre of object
      serialized.left = m[4] - o.getScaledWidth()  / 2;
      serialized.top  = m[5] - o.getScaledHeight() / 2;
    }
    if (o.id) clipboardSourcePositions[o.id] = { left: serialized.left, top: serialized.top };
    return serialized;
  });
  pasteOffset = 0;
}

function cutSelectedAnnotations() {
  if (!selectedObjects.filter(o => o.objectType === 'annotation').length) return;
  copySelectedAnnotations();
  deleteSelectedObjects();
}

async function pasteAnnotations() {
  if (!clipboard.length) return;

  // Apply offset only when the original is still at its copied position (not moved).
  // This prevents pasting on top of an unmoved original while allowing exact-position
  // paste when the original has been relocated or deleted.
  const originalsUnmoved = clipboardSourceIds.some(id => {
    const obj = canvas.getObjects().find(o => o.id === id);
    if (!obj) return false;
    const saved = clipboardSourcePositions[id];
    if (!saved) return false;
    const curLeft = obj.group ? obj.calcTransformMatrix()[4] - obj.getScaledWidth()  / 2 : obj.left;
    const curTop  = obj.group ? obj.calcTransformMatrix()[5] - obj.getScaledHeight() / 2 : obj.top;
    return Math.abs(curLeft - saved.left) < 1 && Math.abs(curTop - saved.top) < 1;
  });
  if (originalsUnmoved) {
    pasteOffset += 20;
  } else {
    pasteOffset = 0;
  }

  const objects = await util.enlivenObjects(JSON.parse(JSON.stringify(clipboard)));
  canvas.renderOnAddRemove = false;
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
    createSingleTextLabel(obj, { batch: true });
  }
  canvas.renderOnAddRemove = true;

  applyLayerOrdering();
  canvas.requestRenderAll();
  updateResultsTable();
  updateSummary();
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
  canvas.renderOnAddRemove = false;
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
    canvas.renderOnAddRemove = true;
    applyLayerOrdering();
    for (const obj of objects) createSingleTextLabel(obj, { batch: true });
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
 * Crosshair overlay — a separate <canvas> with pointer-events:none drawn on top
 * of the Fabric canvas. Completely independent of Fabric objects / undo history.
 */
function createCrosshairOverlay() {
  const existing = document.getElementById('crosshairCanvas');
  if (existing) existing.remove();

  crosshairCanvas = document.createElement('canvas');
  crosshairCanvas.id = 'crosshairCanvas';
  // Canvas buffer = viewport size (same as the Fabric canvas buffer).
  crosshairCanvas.width  = canvas.getWidth();
  crosshairCanvas.height = canvas.getHeight();
  Object.assign(crosshairCanvas.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width:  `${canvas.getWidth()}px`,
    height: `${canvas.getHeight()}px`,
    pointerEvents: 'none',
    zIndex: '200',
  });

  // Inside wrapperEl: moves as one unit with the Fabric canvases when scroll-transform fires.
  canvas.wrapperEl.appendChild(crosshairCanvas);
  crosshairCtx = crosshairCanvas.getContext('2d');

  canvas.upperCanvasEl.addEventListener('mouseleave', clearCrosshair);
}

function drawCrosshair(imageX, imageY) {
  if (!crosshairCtx || !crosshairCanvas) return;
  const w = crosshairCanvas.width;
  const h = crosshairCanvas.height;
  crosshairCtx.clearRect(0, 0, w, h);

  // Convert image coordinates to screen/viewport coordinates.
  const zoom = canvas.getZoom();
  const x = imageX * zoom - imageContainer.scrollLeft;
  const y = imageY * zoom - imageContainer.scrollTop;

  if (x < 0 || x > w || y < 0 || y > h) return;

  crosshairCtx.save();
  crosshairCtx.strokeStyle = 'rgba(30, 80, 200, 0.65)';
  crosshairCtx.lineWidth = 1;
  crosshairCtx.setLineDash([5, 5]);

  crosshairCtx.beginPath();
  crosshairCtx.moveTo(0, y);
  crosshairCtx.lineTo(w, y);
  crosshairCtx.stroke();

  crosshairCtx.beginPath();
  crosshairCtx.moveTo(x, 0);
  crosshairCtx.lineTo(x, h);
  crosshairCtx.stroke();

  crosshairCtx.restore();
}

function clearCrosshair() {
  if (crosshairCtx && crosshairCanvas) {
    crosshairCtx.clearRect(0, 0, crosshairCanvas.width, crosshairCanvas.height);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Label cursor tooltip — appears near the cursor for ~1.5 s after a label change.
 */
function createLabelTooltip() {
  if (document.getElementById('labelCursorTooltip')) return;
  labelTooltipEl = document.createElement('div');
  labelTooltipEl.id = 'labelCursorTooltip';
  Object.assign(labelTooltipEl.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '10000',
    background: 'rgba(20, 20, 20, 0.52)',
    color: '#fff',
    padding: '4px 10px 4px 8px',
    borderRadius: '5px',
    fontSize: '12px',
    fontWeight: '600',
    whiteSpace: 'nowrap',
    display: 'none',
    opacity: '0',
    transition: 'opacity 0.12s ease',
    borderLeft: '4px solid #fff',
    letterSpacing: '0.02em',
  });
  document.body.appendChild(labelTooltipEl);
}

function showLabelTooltip(labelName, labelColor) {
  if (!labelTooltipEl) return;
  clearTimeout(labelTooltipTimer);

  labelTooltipEl.textContent = labelName;
  labelTooltipEl.style.borderLeftColor = labelColor || '#888';
  labelTooltipEl.style.left = `${lastMouseClientX + 18}px`;
  labelTooltipEl.style.top  = `${lastMouseClientY - 28}px`;
  labelTooltipEl.style.display = 'block';
  // Force reflow so the transition fires
  labelTooltipEl.offsetHeight;
  labelTooltipEl.style.opacity = '1';

  labelTooltipTimer = setTimeout(() => {
    labelTooltipEl.style.opacity = '0';
    setTimeout(() => { labelTooltipEl.style.display = 'none'; }, 130);
  }, 1500);
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

    // Vertex edit mode interactions
    if (editingPolygon && currentTool === 'select') {
      const targetType = options.target?.objectType;
      if (targetType === 'midpointHandle') {
        insertVertexAtMidpoint(options.target);
        return;
      }
      if (targetType !== 'vertexHandle') {
        exitPolygonEditMode();
        return;
      }
    }

    // If there's a target object (user clicked on an existing annotation or handle), don't start drawing
    if (options.target && (options.target.objectType === 'annotation' || options.target.objectType === 'vertexHandle' || options.target.objectType === 'midpointHandle')) {
      return;
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
  
  // Mouse move event - for drawing previews and crosshair
  canvas.on('mouse:move', function(options) {
    const pointer = canvas.getPointer(options.e);

    if (crosshairVisible) {
      drawCrosshair(pointer.x, pointer.y);
    }

    if (!drawingMode) return;

    if (currentTool === 'rectangle' && currentRectangle) {
      updateDrawingRectangle(pointer);
    } else if (currentTool === 'polygon' && currentPolygon) {
      updatePolygonPreview(pointer, options.e.shiftKey);
    } else if (currentTool === 'line' && currentLine) {
      updateLinePreview(pointer, options.e.shiftKey);
    }
  });
  
  // Vertex handle dragging — update polygon + adjacent midpoint handles live
  canvas.on('object:moving', function(e) {
    const obj = e.target;
    if (obj.objectType === 'vertexHandle' && editingPolygon) {
      updatePolygonVertex(editingPolygon, obj.pointIndex, obj.left, obj.top);
      updateAdjacentMidpoints(obj.pointIndex);
    }
  });

  // Mouse up event - finish drawing operations
  canvas.on('mouse:up', function(options) {

    if (currentTool === 'rectangle' && drawingMode) {
      finishDrawingRectangle();
    }
  });
  
  // Double-click event - polygon/line finishing + vertex edit mode
  canvas.on('mouse:dblclick', function(options) {
    // Vertex edit mode: toggle on double-click of polygon in select mode
    if (currentTool === 'select') {
      const target = options.target;
      if (target?.annotationType === 'polygon' || target?.annotationType === 'line') {
        if (editingPolygon === target) {
          exitPolygonEditMode();
        } else {
          enterPolygonEditMode(target);
        }
        return;
      }
    }

    if (currentTool === 'polygon' && currentPoints.length >= 3) {
      finishPolygonDrawing();
    } else if (currentTool === 'line' && currentPoints.length >= 2) {
      finishLineDrawing();
    }
  });
  
  // Selection events
  canvas.on('selection:created', function(e) {
    selectedObjects = canvas.getActiveObjects();
    if (currentTool === 'select' && selectedObjects.length > 0) {
      updateUniversalLabelDropdown(currentTool, selectedObjects[0]);
    }
  });

  canvas.on('selection:updated', function(e) {
    // e.selected contains only the newly added/removed object;
    // getActiveObjects() returns the full current selection.
    selectedObjects = canvas.getActiveObjects();
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
  if (editingPolygon) exitPolygonEditMode();

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
      crosshairVisible = false;
      clearCrosshair();
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
      crosshairVisible = true;
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

  // Select tool with no annotation selected: placeholder, disabled
  if (toolName === 'select' && !selectedObject) {
    universalLabelSelect.innerHTML = '<option value="">–</option>';
    universalLabelSelect.disabled = true;
    universalLabelSelect.classList.add('no-selection');
    updateLabelQuickList();
    return;
  }
  universalLabelSelect.disabled = false;
  universalLabelSelect.classList.remove('no-selection');

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
  labels.forEach((label, i) => {
    const option = document.createElement('option');
    option.value = label.id;
    option.textContent = i < 9 ? `${i + 1}: ${label.name}` : label.name;
    universalLabelSelect.appendChild(option);
  });
  
  // Set selection based on context
  if (selectedObject && selectedObject.labelId) {
    universalLabelSelect.value = selectedObject.labelId;
  } else if (universalLabelSelect.querySelector(`option[value="${currentValue}"]`)) {
    universalLabelSelect.value = currentValue;
  } else {
    universalLabelSelect.value = labels[0].id;
  }

  updateLabelQuickList();
}

function updateLabelQuickList() {
  const container = document.getElementById('labelQuickList');
  const select = document.getElementById('universalLabelSelect');
  if (!container || !select) return;

  container.innerHTML = '';

  const options = Array.from(select.options);
  if (options.length === 0 || select.disabled) {
    const hint = document.createElement('div');
    hint.className = 'label-quick-disabled-hint';
    hint.textContent = 'Annotation auswählen';
    container.appendChild(hint);
    return;
  }

  options.forEach((opt, i) => {
    const id = parseInt(opt.value);
    const label = getLabelById(id);
    const color = label ? label.color : '#888';
    const isActive = opt.value === select.value;

    const item = document.createElement('div');
    item.className = 'label-quick-item' + (isActive ? ' active' : '');
    item.dataset.value = opt.value;
    item.innerHTML = `
      <span class="label-quick-dot" style="background:${color};"></span>
      <span class="label-quick-name">${label ? label.name : opt.textContent}</span>
      ${i < 9 ? `<span class="label-quick-key">${i + 1}</span>` : ''}
    `;
    item.addEventListener('click', () => {
      select.value = opt.value;
      select.dispatchEvent(new Event('change'));
      updateLabelQuickList();
    });
    container.appendChild(item);
  });
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
  const label = getLabelById ? getLabelById(selectedLabelId) : getLabel(selectedLabelId);

  const rect = new Rect({
    left: pointer.x,
    top: pointer.y,
    width: 0,
    height: 0,
    fill: label.color + '20', // 20% opacity
    stroke: label.color,
    strokeWidth: label.strokeWidth || 2,
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

  canvas.requestRenderAll();
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
function getContrastTextColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  // Perceived luminance (sRGB coefficients)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#222222' : 'white';
}

function calculateLabelPosition(annotationObject) {
  // Rectangle: top-left corner is the first vertex
  if (annotationObject.type === 'rect') {
    return { x: annotationObject.left, y: annotationObject.top };
  }

  // Polygon / Polyline: transform first point to absolute canvas coordinates
  if ((annotationObject.type === 'polygon' || annotationObject.type === 'polyline') &&
      annotationObject.points && annotationObject.points.length > 0 &&
      annotationObject.pathOffset) {
    return getVertexAbsPosition(annotationObject, 0);
  }

  // Fallback
  return { x: annotationObject.left || 0, y: annotationObject.top || 0 };
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
 * Snaps point `to` to the nearest angle multiple of `stepDeg` from point `from`.
 * Used when Shift is held during polygon/line drawing.
 */
function snapToAngle(from, to, stepDeg = 22.5) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return to;
  const step = stepDeg * Math.PI / 180;
  const snapped = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + dist * Math.cos(snapped), y: from.y + dist * Math.sin(snapped) };
}

/**
 * Polygon Drawing Functions
 */
function addPolygonPoint(pointer, e) {  
  if (!canvas || isProcessingClick) return;
  
  isProcessingClick = true;

  // Shift held → snap to nearest 22.5° angle from last point
  const pt = (e?.shiftKey && currentPoints.length > 0)
    ? snapToAngle(currentPoints[currentPoints.length - 1], pointer)
    : pointer;

  // Add point to current polygon
  currentPoints.push(pt);
  
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
  const label = getLabelById ? getLabelById(selectedLabelId) : getLabel(selectedLabelId);

  // Create initial polygon with first point duplicated to make it visible
  const firstPoint = currentPoints[0];
  const points = [
    { x: firstPoint.x, y: firstPoint.y },
    { x: firstPoint.x + 1, y: firstPoint.y + 1 } // Slightly offset to make it visible
  ];
  
  currentPolygon = new Polygon(points, {
    fill: label.color + '20', // 20% opacity
    stroke: label.color,
    strokeWidth: label.strokeWidth || 2,
    objectType: 'annotation',
    annotationType: 'polygon',
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    objectCaching: false
  });
  
  canvas.add(currentPolygon);
  canvas.renderAll();
}

function updatePolygonFromPoints() {
  if (!currentPolygon || currentPoints.length < 2) return;

  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));
  currentPolygon.set({ points: fabricPoints, hasBorders: true, hasControls: true });
  currentPolygon.setBoundingBox(true);
  currentPolygon.setCoords();
  canvas.renderAll();
}

function updatePolygonPreview(pointer, shiftKey = false) {
  if (!currentPolygon || currentPoints.length === 0) return;

  const previewEnd = (shiftKey && currentPoints.length > 0)
    ? snapToAngle(currentPoints[currentPoints.length - 1], pointer)
    : pointer;

  const fabricPoints = [...currentPoints, previewEnd].map(p => ({ x: p.x, y: p.y }));
  currentPolygon.set({ points: fabricPoints });
  currentPolygon.setBoundingBox(true);
  currentPolygon.setCoords();
  canvas.requestRenderAll();
}

function finishPolygonDrawing() {
  // The dblclick always fires AFTER two mouse:down events, so the second click
  // of the double-click has already added an unwanted extra point — remove it.
  currentPoints.pop();

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
  const label = getLabelById ? getLabelById(selectedLabelId) : getLabel(selectedLabelId);

  // SIMPLE APPROACH: Use original points, prevent Fabric.js offset
  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));

  // Create polygon with original points
  const finalPolygon = new Polygon(fabricPoints, {
    fill: label.color + '20', // 20% opacity
    stroke: label.color,
    strokeWidth: label.strokeWidth || 2,
    objectType: 'annotation',
    annotationType: 'polygon',
    selectable: true,
    evented: true,
    labelId: selectedLabelId,
    objectLabel: selectedLabelId,
    hasControls: true,
    hasBorders: true,
    objectCaching: true
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
 * Polygon Vertex Editing
 */

// Returns the absolute canvas position of vertex i of a polygon
function getVertexAbsPosition(polygon, i) {
  const p = polygon.points[i];
  return util.transformPoint(
    { x: p.x - polygon.pathOffset.x, y: p.y - polygon.pathOffset.y },
    polygon.calcTransformMatrix()
  );
}

// Moves vertex i to absolute canvas position (canvasX, canvasY)
function updatePolygonVertex(polygon, pointIndex, canvasX, canvasY) {
  const invMatrix = util.invertTransform(polygon.calcTransformMatrix());
  const local = util.transformPoint({ x: canvasX, y: canvasY }, invMatrix);

  // Save bounding-box top-left BEFORE changing the point.
  // polygon.left is the LEFT EDGE (not the center), so minX = pathOffset.x - width/2.
  const oldMinX = polygon.pathOffset.x - polygon.width  / 2;
  const oldMinY = polygon.pathOffset.y - polygon.height / 2;

  polygon.points[pointIndex] = {
    x: local.x + polygon.pathOffset.x,
    y: local.y + polygon.pathOffset.y,
  };

  // Recalculate bounding box (updates pathOffset/width/height, without repositioning).
  polygon.setBoundingBox(false);

  // Shift left/top by Δ(minX) — not Δ(pathOffset) — so every unchanged vertex
  // stays on the same canvas pixel even when the bounding-box width/height changes.
  const newMinX = polygon.pathOffset.x - polygon.width  / 2;
  const newMinY = polygon.pathOffset.y - polygon.height / 2;
  polygon.left += newMinX - oldMinX;
  polygon.top  += newMinY - oldMinY;
  polygon.setCoords();
}

function enterPolygonEditMode(polygon) {
  if (editingPolygon) exitPolygonEditMode();
  editingPolygon = polygon;

  polygon.lockMovementX = true;
  polygon.lockMovementY = true;
  polygon.hasControls = false;
  polygon.hasBorders = false;

  // Visual edit-mode indicator (dashed only for closed shapes, not lines)
  polygon._origStrokeWidth = polygon.strokeWidth;
  polygon.set('strokeWidth', polygon.strokeWidth + 1);
  if (polygon.annotationType === 'polygon') {
    polygon.set('strokeDashArray', [6, 3]);
  }

  refreshVertexHandles();
  canvas.discardActiveObject();
  canvas.renderAll();
}

function exitPolygonEditMode() {
  if (!editingPolygon) return;

  vertexHandles.forEach(h => canvas.remove(h));
  vertexHandles = [];

  editingPolygon.lockMovementX = false;
  editingPolygon.lockMovementY = false;
  editingPolygon.hasControls = true;
  editingPolygon.hasBorders = true;
  editingPolygon.set('strokeWidth', editingPolygon._origStrokeWidth ?? 2);
  editingPolygon.set('strokeDashArray', null);
  editingPolygon.setCoords();

  updateLinkedTextLabelPosition(editingPolygon);

  editingPolygon = null;

  saveHistorySnapshot();
  canvas.renderAll();
}

// Rebuild all vertex + midpoint handles for the current editingPolygon
function refreshVertexHandles() {
  if (!editingPolygon) return;
  vertexHandles.forEach(h => canvas.remove(h));
  vertexHandles = [];

  const pts = editingPolygon.points;
  const isClosedShape = editingPolygon.annotationType === 'polygon';
  const n = pts.length;

  pts.forEach((p, i) => {
    const abs = getVertexAbsPosition(editingPolygon, i);

    // Full vertex handle (draggable)
    const handle = new Circle({
      left: abs.x, top: abs.y,
      originX: 'center', originY: 'center',
      radius: 6,
      fill: '#1976d2', stroke: '#ffffff', strokeWidth: 2,
      objectType: 'vertexHandle', pointIndex: i,
      hasBorders: false, hasControls: false,
      hoverCursor: 'crosshair', moveCursor: 'crosshair',
      selectable: true, evented: true,
    });
    vertexHandles.push(handle);
    canvas.add(handle);

    // Midpoint handle between vertex i and i+1
    const hasNext = isClosedShape ? true : i < n - 1;
    if (hasNext) {
      const nextI = isClosedShape ? (i + 1) % n : i + 1;
      const nextAbs = getVertexAbsPosition(editingPolygon, nextI);
      const mid = new Circle({
        left: (abs.x + nextAbs.x) / 2,
        top:  (abs.y + nextAbs.y) / 2,
        originX: 'center', originY: 'center',
        radius: 4,
        fill: '#ffffff', stroke: '#1976d2', strokeWidth: 1.5,
        opacity: 0.4,
        objectType: 'midpointHandle', midIndex: i,
        hasBorders: false, hasControls: false,
        lockMovementX: true, lockMovementY: true,
        hoverCursor: 'copy',
        selectable: true, evented: true,
      });
      vertexHandles.push(mid);
      canvas.add(mid);
    }
  });

  canvas.renderAll();
}

// Reposition the midpoint handles adjacent to a moved vertex (avoids full refresh during drag)
function updateAdjacentMidpoints(pointIndex) {
  if (!editingPolygon) return;
  const pts = editingPolygon.points;
  const n   = pts.length;
  const isPolygon = editingPolygon.annotationType === 'polygon';

  vertexHandles.forEach(h => {
    if (h.objectType !== 'midpointHandle') return;
    const mi    = h.midIndex;
    const nextI = isPolygon ? (mi + 1) % n : mi + 1;
    if (mi === pointIndex || nextI === pointIndex) {
      const a = getVertexAbsPosition(editingPolygon, mi);
      const b = getVertexAbsPosition(editingPolygon, nextI);
      h.set({ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 });
      h.setCoords();
    }
  });
}

// Shared helper to adjust left/top after points array changed and setBoundingBox was called
function _applyBoundingBoxShift(obj, oldMinX, oldMinY) {
  const newMinX = obj.pathOffset.x - obj.width  / 2;
  const newMinY = obj.pathOffset.y - obj.height / 2;
  obj.left += newMinX - oldMinX;
  obj.top  += newMinY - oldMinY;
  obj.setCoords();
}

// Insert a new vertex at the midpoint handle position
function insertVertexAtMidpoint(midHandle) {
  const insertIndex = midHandle.midIndex + 1;
  const oldMinX = editingPolygon.pathOffset.x - editingPolygon.width  / 2;
  const oldMinY = editingPolygon.pathOffset.y - editingPolygon.height / 2;

  const invMatrix = util.invertTransform(editingPolygon.calcTransformMatrix());
  const local = util.transformPoint({ x: midHandle.left, y: midHandle.top }, invMatrix);
  editingPolygon.points.splice(insertIndex, 0, {
    x: local.x + editingPolygon.pathOffset.x,
    y: local.y + editingPolygon.pathOffset.y,
  });

  editingPolygon.setBoundingBox(false);
  _applyBoundingBoxShift(editingPolygon, oldMinX, oldMinY);
  refreshVertexHandles();
}

// Delete vertex at pointIndex (respects minimum vertex count)
function deleteVertex(pointIndex) {
  const minPts = editingPolygon.annotationType === 'polygon' ? 3 : 2;
  if (editingPolygon.points.length <= minPts) return;

  const oldMinX = editingPolygon.pathOffset.x - editingPolygon.width  / 2;
  const oldMinY = editingPolygon.pathOffset.y - editingPolygon.height / 2;

  editingPolygon.points.splice(pointIndex, 1);

  editingPolygon.setBoundingBox(false);
  _applyBoundingBoxShift(editingPolygon, oldMinX, oldMinY);
  refreshVertexHandles();
}

/**
 * Line Drawing Functions - Multi-segment perimeter tool
 */
function addLinePoint(pointer, e) {
  if (!canvas || isProcessingClick) return;

  isProcessingClick = true;

  // Shift held → snap to nearest 22.5° angle from last point
  const pt = (e?.shiftKey && currentPoints.length > 0)
    ? snapToAngle(currentPoints[currentPoints.length - 1], pointer)
    : pointer;

  // Add point to current line sequence
  currentPoints.push(pt);
  
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
  const lineSW = lineLabel ? (lineLabel.strokeWidth || 2) : 2;

  // Create initial polyline with first point duplicated to make it visible
  const firstPoint = currentPoints[0];
  const points = [
    { x: firstPoint.x, y: firstPoint.y },
    { x: firstPoint.x + 1, y: firstPoint.y + 1 } // Slightly offset to make it visible
  ];

  currentLine = new Polyline(points, {
    fill: '',
    stroke: labelColor,
    strokeWidth: lineSW,
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

  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));
  currentLine.set({ points: fabricPoints });
  currentLine.setBoundingBox(true);
  currentLine.setCoords();
  canvas.renderAll();
}

function updateLinePreview(pointer, shiftKey = false) {
  if (!currentLine || currentPoints.length === 0) return;

  const previewEnd = (shiftKey && currentPoints.length > 0)
    ? snapToAngle(currentPoints[currentPoints.length - 1], pointer)
    : pointer;

  const fabricPoints = [...currentPoints, previewEnd].map(p => ({ x: p.x, y: p.y }));
  currentLine.set({ points: fabricPoints });
  currentLine.setBoundingBox(true);
  currentLine.setCoords();
  canvas.requestRenderAll();
}

function finishLineDrawing() {
  // Same as finishPolygonDrawing: dblclick fires after two mouse:down events,
  // so the second click always adds an unwanted extra point — remove it.
  currentPoints.pop();

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
    strokeWidth: lineLabel ? (lineLabel.strokeWidth || 2) : 2,
    objectType: 'annotation',
    annotationType: 'line',
    selectable: true,
    evented: true,
    labelId: selectedLabelId,
    objectLabel: selectedLabelId,
    hasControls: true,
    hasBorders: true,
    objectCaching: true
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
function createSingleTextLabel(annotation, { batch = false } = {}) {
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
    fill: getContrastTextColor(labelColor),
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
  if (!batch) {
    applyLayerOrdering();
    canvas.renderAll();
    updateResultsTable();
    updateSummary();
  }

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
      backgroundColor: annotationColor,
      fill: getContrastTextColor(annotationColor)
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
      'annotationType',   // Type: rectangle, polygon, line
      'score'             // AI confidence score (0–1)
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
  let sessionId = getPdfSessionId() || getUploadSessionId();
  let analyzePageNum = currentPageNumber;

  if (!sessionId) {
    // Check per-page cache first (avoids re-uploading on repeated clicks for the same page)
    const cached = imageSessionCache[currentPageNumber];
    if (cached) {
      sessionId    = cached.sessionId;
      analyzePageNum = cached.pageNumOnServer;
    } else if (uploadedImage?.src) {
      // Re-upload the current page image to establish a temporary server session.
      // This handles projects loaded from ZIP that contained no original PDF blob.
      try {
        const blob = await fetch(uploadedImage.src).then(r => r.blob());
        const fd = new FormData();
        fd.append('file', new File([blob], 'page.jpg', { type: blob.type || 'image/jpeg' }));
        const res = await fetch('/upload', { method: 'POST', body: fd });
        if (!res.ok) throw new Error();
        const data = await res.json();
        sessionId    = data.session_id;
        analyzePageNum = 1; // single-image upload → always page 1 on server
        imageSessionCache[currentPageNumber] = { sessionId, pageNumOnServer: 1 };
      } catch {
        alert('Bitte zuerst eine Datei hochladen.');
        return;
      }
    } else {
      alert('Bitte zuerst eine Datei hochladen.');
      return;
    }
  }

  const btn = document.getElementById('analyzeCurrentPageBtn');
  const loader = document.getElementById('loader');
  const errorMessage = document.getElementById('errorMessage');

  // UI: busy state
  if (btn) { btn.disabled = true; btn.classList.add('analyzing'); btn.innerHTML = '<svg class="btn-spinner" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="4" stroke-dasharray="11 9"/></svg> Analysiert…'; }
  if (loader) loader.style.display = 'block';
  if (errorMessage) errorMessage.style.display = 'none';

  // Mark page as "analyzing" in sidebar

  try {
    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('page', analyzePageNum);
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

  } catch (err) {
    console.error('Analyse-Fehler:', err);
    if (errorMessage) {
      errorMessage.textContent = 'Fehler: ' + err.message;
      errorMessage.style.display = 'block';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('analyzing');
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><circle cx="5.5" cy="5.5" r="3.5"/><line x1="8.5" y1="8.5" x2="11.5" y2="11.5"/></svg> Fenster erkennen';
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

  // Label tooltip setup
  createLabelTooltip();
  document.addEventListener('mousemove', (e) => {
    lastMouseClientX = e.clientX;
    lastMouseClientY = e.clientY;
  });
  
   // ── New upload flow: called by upload-modal.js after successful /upload ──
  window.onUploadReady = function(uploadInfo) {
    console.log('Upload ready:', uploadInfo);

    // Store session + all pages in PDF handler so navigation and project-save work
    setPdfSessionId(uploadInfo.session_id);
    imageSessionCache = {}; // clear per-page cache from any previous project
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

  // Track held drawing-tool keys for scroll-to-cycle
  document.addEventListener('keydown', function(e) {
    const key = e.key.toLowerCase();
    if ((key === 'q' || key === 'w' || key === 'e') && !e.ctrlKey && !e.metaKey) {
      heldDrawingKey = key;
    }
  });
  document.addEventListener('keyup', function(e) {
    const key = e.key.toLowerCase();
    if (key === heldDrawingKey) heldDrawingKey = null;
  });

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
      if (e.key === 'c' || e.key === 'C') { copySelectedAnnotations();  e.preventDefault(); return; }
      if (e.key === 'x' || e.key === 'X') { cutSelectedAnnotations();   e.preventDefault(); return; }
      if (e.key === 'v' || e.key === 'V') { pasteAnnotations();         e.preventDefault(); return; }
      if (e.key === 's' || e.key === 'S') { document.getElementById('saveProjectBtn')?.click(); e.preventDefault(); return; }
      if (e.key === 'o' || e.key === 'O') { document.getElementById('loadProjectBtn')?.click(); e.preventDefault(); return; }
      return; // don't let other Ctrl+key combos trigger tool shortcuts
    }

    // Arrow keys: move selected annotations, otherwise let browser scroll
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      if (currentTool === 'select' && selectedObjects.length > 0) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
        selectedObjects.forEach(obj => {
          if (obj.objectType !== 'annotation') return;
          obj.set({ left: (obj.left || 0) + dx, top: (obj.top || 0) + dy });
          obj.setCoords();
          updateLinkedTextLabelPosition(obj);
        });
        canvas.requestRenderAll();
        saveHistorySnapshot();
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 's': case 'S': setTool('select');    break;
      case 'q': case 'Q': setTool('rectangle'); break;
      case 'w': case 'W': setTool('polygon');   break;
      case 'e': case 'E': setTool('line');      break;
      case 'l': case 'L': {
        const modal = document.getElementById('labelManagerModal');
        if (modal && modal.style.display === 'block') { closeLabelManager(); }
        else { document.getElementById('manageLabelBtn')?.click(); }
        break;
      }
      case '?': toggleShortcutsModal(); break;
      case '1': case '2': case '3': case '4': case '5':
      case '6': case '7': case '8': case '9': {
        const idx = parseInt(e.key) - 1;
        const sel = document.getElementById('universalLabelSelect');
        if (sel && sel.options[idx]) {
          sel.value = sel.options[idx].value;
          sel.dispatchEvent(new Event('change'));
          updateLabelQuickList();
        }
        break;
      }
      case 't': case 'T':
      case 'Delete':
      case 'Backspace':
        if (editingPolygon) {
          const activeHandle = canvas.getActiveObject();
          if (activeHandle?.objectType === 'vertexHandle') {
            deleteVertex(activeHandle.pointIndex);
            e.preventDefault();
            break;
          }
        }
        deleteSelectedObjects();
        e.preventDefault();
        break;
      case 'Escape': {
        const shortcutsModal = document.getElementById('shortcutsModal');
        if (shortcutsModal && shortcutsModal.style.display === 'block') { toggleShortcutsModal(); break; }
        const modal = document.getElementById('labelManagerModal');
        if (modal && modal.style.display === 'block') { closeLabelManager(); break; }
        if (editingPolygon) { exitPolygonEditMode(); break; }
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
    }
  });

  // Setup shortcuts modal
  function toggleShortcutsModal() {
    const modal = document.getElementById('shortcutsModal');
    if (!modal) return;
    modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
  }
  document.getElementById('shortcutsBtn')?.addEventListener('click', toggleShortcutsModal);
  document.getElementById('shortcutsModalClose')?.addEventListener('click', toggleShortcutsModal);
  document.getElementById('shortcutsModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('shortcutsModal')) toggleShortcutsModal();
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
      // Show label name near cursor
      const labelId = parseInt(universalLabelSelect.value);
      const label = getLabel(labelId);
      if (label) showLabelTooltip(label.name, label.color);
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
  window.clearImageSessionCache = () => { imageSessionCache = {}; };
  window.getFirstImageSessionId = () => {
    const entry = Object.values(imageSessionCache)[0];
    return entry ? entry.sessionId : null;
  };
  window.getCurrentLabels = getCurrentLabels;

  // Resize canvas when container size changes (e.g. right panel collapse/expand)
  window.addEventListener('resize', function() {
    if (!canvas || !imageContainer) return;
    const w = imageContainer.clientWidth;
    const h = imageContainer.clientHeight;
    if (w > 0 && h > 0) {
      canvas.setWidth(w);
      canvas.setHeight(h);
      canvas.renderAll();
      if (crosshairCanvas) {
        crosshairCanvas.width  = w;
        crosshairCanvas.height = h;
        crosshairCanvas.style.width  = w + 'px';
        crosshairCanvas.style.height = h + 'px';
      }
    }
  });

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
