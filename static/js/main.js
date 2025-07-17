/**
 * main.js - Fenster-Erkennungstool Main Application
 * Core functionality: Upload, Predict, Annotation Display, Drawing Tools, Zoom
 */

// Import modules
import { setupLabels, updateUIForLabels, getAreaLabels, getLabelById, getLabelName, getLabelColor } from './labels.js';
import { 
  setupPdfHandler, 
  setDisplayPageCallback, 
  processPdfData, 
  navigateToPdfPage, 
  resetPdfState,
  getPdfSessionId,
  getPdfPageData,
  getPageSettings,
  getCurrentPdfPage,
  getTotalPdfPages,
  setPdfSessionId,
  setPdfPageData,
  setPageSettings
} from './pdf-handler.js';
import { 
  setupProject, 
  saveProject, 
  loadProject, 
  loadProjectList, 
  exportPdf, 
  exportAnnotatedPdf 
} from './project.js';

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

// Global app state
window.data = null;
let canvas = null;
let imageContainer = null;
let uploadedImage = null;

// Editor state
let isEditorActive = false;
let currentTool = 'rectangle';
let drawingMode = false;
let currentPath = null;
let currentPoints = [];
let selectedObjects = [];
let currentPolygon = null;
let currentLine = null;
let rectangleStartPoint = null;

// Event timing control
let isProcessingClick = false;

// Dynamic Labels (replaced by labels.js functionality)
function getLabel(labelId) {
  // Try to get from dynamic labels first
  const dynamicLabel = getLabelById(labelId, 'area');
  if (dynamicLabel) {
    return { name: dynamicLabel.name, color: dynamicLabel.color };
  }
  
  // Fallback to hardcoded labels if dynamic labels not available
  const FALLBACK_LABELS = {
    0: { name: "Andere", color: "#808080" },
    1: { name: "Fenster", color: "#0000FF" },
    2: { name: "Tür", color: "#FF0000" },
    3: { name: "Wand", color: "#D4D638" },
    4: { name: "Lukarne", color: "#FFA500" },
    5: { name: "Dach", color: "#800080" }
  };
  return FALLBACK_LABELS[labelId] || FALLBACK_LABELS[0];
}


/**
 * Initialize canvas
 */
function initCanvas() {
  console.log("=== INITIALIZING CANVAS ===");
  
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
  canvas = new fabric.Canvas('annotationCanvas');
  
  // Configure canvas for drawing mode initially
  canvas.selection = false;  // Disable selection by default
  canvas.defaultCursor = 'default';
  canvas.hoverCursor = 'default';
  canvas.moveCursor = 'default';
  
  // FABRIC.JS NATURAL-SIZE STRATEGY: Canvas = image size, 1:1 coordinates
  const naturalWidth = uploadedImage.naturalWidth;
  const naturalHeight = uploadedImage.naturalHeight;
 
  console.log(`Canvas size set to natural size: ${naturalWidth}x${naturalHeight}`);
  
  // Canvas-Größe = Natural Image Size (für 1:1 Koordinaten)
  canvas.setWidth(naturalWidth);
  canvas.setHeight(naturalHeight);
  
  // Add image as Fabric.js background at 1:1 scale
  fabric.Image.fromURL(uploadedImage.src, function(img) {
    img.set({
      left: 0,
      top: 0,
      scaleX: 1.0,  // No scaling - natural size
      scaleY: 1.0,  // No scaling - natural size
      selectable: false,
      evented: false,
      excludeFromExport: true
    });
    
    // Add as background (lowest layer)
    canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
    console.log('Image added as Fabric.js background at natural size');
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
  
  // Setup editor event handlers if editor is active
  if (isEditorActive) {
    setupCanvasEvents();
  }
    
  console.log("Canvas initialized successfully");

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
      imageContainer.scrollLeft += e.deltaY;
    }
    // Normal vertical scrolling happens automatically if no modifiers
    // Ctrl+Wheel is handled by Fabric.js for zooming
  }, { passive: false });
  
  console.log('Enhanced container scrolling setup complete');
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
  
  console.log(`Prediction area calculation:
    - Coordinates: (${x1},${y1}) to (${x2},${y2})
    - Size: ${widthPixels} x ${heightPixels}px
    - Real world: ${widthM.toFixed(3)} x ${heightM.toFixed(3)}m
    - Area: ${area.toFixed(4)}m²`);
  
  return area;
}

/**
 * Display annotations
 */
function displayAnnotations(predictions) {
  console.log("=== DISPLAYING ANNOTATIONS ===");
  console.log(`Processing ${predictions?.length || 0} predictions`);
  console.log(`Current format settings: ${document.getElementById('formatWidth')?.value || 'N/A'}x${document.getElementById('formatHeight')?.value || 'N/A'}mm`);
  
  if (!canvas) {
    console.log("No canvas, initializing...");
    initCanvas();
  }
  
  if (!canvas || !predictions) {
    console.error("Cannot display annotations: missing canvas or predictions");
    return;
  }
  
  // Clear existing annotations
  canvas.clear();
  
  let rectangleCount = 0;
  let polygonCount = 0;
  let lineCount = 0;
  
  predictions.forEach((pred, index) => {
    console.log(`Processing prediction ${index}:`, pred);
    console.log(`  - Type: ${pred.annotationType}, Has box: ${!!pred.box}, Has points: ${!!pred.points}`);
    
    // Get label info
    const labelId = pred.label || 0;
    let label, labelColor;
    
    if (pred.annotationType === 'line') {
      // Use line labels for line annotations
      const lineLabel = getLabelById ? getLabelById(labelId, 'line') : null;
      label = lineLabel ? { name: lineLabel.name, color: lineLabel.color } : { name: 'Strecke', color: '#FF0000' };
      labelColor = label.color;
    } else {
      // Use area labels for rectangles and polygons
      label = getLabel(labelId);
      labelColor = label.color;
    }
    
    // Process rectangles
    if (pred.box || pred.bbox) {
      const coords = pred.box || pred.bbox;
      const [x1, y1, x2, y2] = coords;
      
      // Calculate correct area for this prediction and store it
      pred.calculatedArea = calculatePredictionArea(coords);
      
      // Canvas coordinates are now 1:1 with natural coordinates (no conversion needed)
      const canvasX1 = x1;
      const canvasY1 = y1;
      const canvasX2 = x2;
      const canvasY2 = y2;
      const canvasWidth = canvasX2 - canvasX1;
      const canvasHeight = canvasY2 - canvasY1;
      
      console.log(`Creating rectangle: natural(${x1},${y1} ${x2-x1}x${y2-y1}) -> canvas(${canvasX1.toFixed(1)},${canvasY1.toFixed(1)} ${canvasWidth.toFixed(1)}x${canvasHeight.toFixed(1)}), label: ${label.name}`);
      
      // Create rectangle with canvas coordinates
      const rect = new fabric.Rect({
        left: canvasX1,
        top: canvasY1,
        width: canvasWidth,
        height: canvasHeight,
        fill: labelColor + '20', // 20% opacity
        stroke: labelColor,
        strokeWidth: 2,
        objectType: 'annotation',
        annotationType: 'rectangle',
        annotationIndex: index,
        labelId: labelId,
        objectLabel: labelId,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        evented: true
      });
      
      canvas.add(rect);
      
      // Create label text with standardized format matching table
      const area = pred.calculatedArea || pred.area || 0;
      const labelText = `#${index + 1}: ${label.name} (${area.toFixed(2)}m²)`;
      createAnnotationLabel({ x: canvasX1, y: canvasY1 }, labelText, labelColor, pred.label);
      rectangleCount++;
      
    } else if (pred.annotationType === 'polygon' && pred.points) {
      // Process polygons
      console.log(`Creating polygon with ${pred.points.length} points, label: ${label.name}`);
      
      // Convert points to Fabric.js format
      const fabricPoints = pred.points.map(p => ({ x: p.x, y: p.y }));
      
      const polygon = new fabric.Polygon(fabricPoints, {
        fill: labelColor + '20', // 20% opacity
        stroke: labelColor,
        strokeWidth: 2,
        objectType: 'annotation',
        annotationType: 'polygon',
        annotationIndex: index,
        labelId: labelId,
        objectLabel: labelId,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        evented: true,
        objectCaching: false
      });
      
      canvas.add(polygon);
      
      // Create label text
      const area = pred.calculatedArea || pred.area || 0;
      const labelText = `#${index + 1}: ${label.name} (${area.toFixed(2)}m²)`;
      const firstPoint = pred.points[0];
      createAnnotationLabel({ x: firstPoint.x, y: firstPoint.y }, labelText, labelColor, pred.label);
      polygonCount++;
      
    } else if (pred.annotationType === 'line' && pred.points) {
      // Process lines
      console.log(`Creating line with ${pred.points.length} points, label: ${label.name}`);
      
      // Convert points to Fabric.js format
      const fabricPoints = pred.points.map(p => ({ x: p.x, y: p.y }));
      
      const line = new fabric.Polyline(fabricPoints, {
        fill: '',
        stroke: labelColor,
        strokeWidth: 3,
        objectType: 'annotation',
        annotationType: 'line',
        annotationIndex: index,
        labelId: labelId,
        objectLabel: labelId,
        selectable: true,
        evented: true,
        objectCaching: false,
        absolutePositioned: true
      });
      
      canvas.add(line);
      
      // Create label text
      const length = pred.calculatedLength || 0;
      const labelText = `#${index + 1}: ${label.name} (${length.toFixed(2)}m)`;
      const midIndex = Math.floor(pred.points.length / 2);
      const labelPosition = pred.points[midIndex];
      createAnnotationLabel({ x: labelPosition.x, y: labelPosition.y }, labelText, labelColor, pred.label);
      lineCount++;
      
    } else {
      console.log(`Skipping annotation ${index}: type=${pred.annotationType}, hasBox=${!!pred.box}, hasPoints=${!!pred.points}`);
    }
  });
  
  canvas.renderAll();
  console.log(`✅ Displayed ${rectangleCount} rectangles, ${polygonCount} polygons, ${lineCount} lines on canvas`);
  
  // Re-setup canvas events if editor is active
  if (isEditorActive) {
    setTimeout(() => {
      setupCanvasEvents();
      console.log('Canvas events re-established after annotation display');
    }, 100);
  }
}


/**
 * Update results table (simplified)
 */
function updateResultsTable() {
  const resultsBody = document.getElementById('resultsBody');
  if (!resultsBody || !window.data?.predictions) return;
  
  resultsBody.innerHTML = '';
  
  window.data.predictions.forEach((pred, index) => {
    // Get appropriate label based on annotation type
    let label;
    if (pred.annotationType === 'line') {
      // Use line labels for line annotations
      const lineLabel = getLabelById ? getLabelById(pred.label || 1, 'line') : null;
      label = lineLabel ? { name: lineLabel.name, color: lineLabel.color } : { name: 'Strecke', color: '#FF0000' };
    } else {
      // Use area labels for rectangles and polygons
      label = getLabel(pred.label || 0);
    }
    
    // Determine annotation type and measurement
    let annotationType = 'Rechteck';
    let measurement = 'N/A';
    
    if (pred.annotationType === 'rectangle' || pred.box) {
      annotationType = 'Rechteck';
      measurement = pred.calculatedArea ? `${pred.calculatedArea.toFixed(2)} m²` : 
                   pred.area ? `${pred.area.toFixed(2)} m²` : 'N/A';
    } else if (pred.annotationType === 'polygon') {
      annotationType = 'Polygon';
      measurement = pred.calculatedArea ? `${pred.calculatedArea.toFixed(2)} m²` : 'N/A';
    } else if (pred.annotationType === 'line') {
      annotationType = 'Linie';
      measurement = pred.calculatedLength ? `${pred.calculatedLength.toFixed(2)} m` : 'N/A';
    }
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${label.name}</td>
      <td>${annotationType}</td>
      <td>${((pred.score || 0) * 100).toFixed(1)}%</td>
      <td>${measurement}</td>
    `;
    
    // Add visual indicator for user-created annotations
    if (pred.userCreated) {
      row.style.fontStyle = 'italic';
      row.title = 'Benutzer-erstellt';
    }
    
    resultsBody.appendChild(row);
  });
}

/**
 * Update summary (simplified)
 */
function updateSummary() {
  const summary = document.getElementById('summary');
  if (!summary || !window.data?.predictions) return;
  
  const counts = { fenster: 0, tuer: 0, wand: 0, lukarne: 0, dach: 0, other: 0 };
  const areas = { fenster: 0, tuer: 0, wand: 0, lukarne: 0, dach: 0, other: 0 };
  
  window.data.predictions.forEach(pred => {
    const labelId = pred.label || 0;
    const label = getLabel(labelId);
    // Use the correctly calculated area, fallback to original API area if not available
    const area = pred.calculatedArea || pred.area || 0;
    
    // Create dynamic counting based on label names
    const labelKey = label.name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/\s+/g, '_');
    if (!counts[labelKey]) {
      counts[labelKey] = 0;
      areas[labelKey] = 0;
    }
    counts[labelKey]++;
    areas[labelKey] += area;
  });
  
  let summaryHtml = '';
  Object.entries(counts).forEach(([key, count]) => {
    if (count > 0) {
      // Convert key back to readable name
      const labelName = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const pluralName = count > 1 ? (labelName.endsWith('e') ? labelName + 'n' : labelName) : labelName;
      summaryHtml += `<p>${pluralName}: <strong>${count}</strong> (${areas[key].toFixed(2)} m²)</p>`;
    }
  });
  
  summary.innerHTML = summaryHtml;
}

/**
 * Clear all results
 */
function clearResults() {
  console.log("=== CLEARING ALL RESULTS ===");
  
  window.data = null;
  
  // Reset PDF state
  resetPdfState();
  
  // Clear image
  if (uploadedImage) {
    uploadedImage.src = '';
  }
  
  // Hide results sections
  const resultsSection = document.getElementById('resultsSection');
  const resultsTableSection = document.getElementById('resultsTableSection');
  if (resultsSection) resultsSection.style.display = 'none';
  if (resultsTableSection) resultsTableSection.style.display = 'none';
  
  // Clear tables
  const summary = document.getElementById('summary');
  const resultsBody = document.getElementById('resultsBody');
  if (summary) summary.innerHTML = '';
  if (resultsBody) resultsBody.innerHTML = '';
  
  // Clear canvas
  if (canvas) {
    canvas.clear();
  }
  
  // Reset canvas zoom to 1.0
  if (canvas) {
    canvas.setZoom(1.0);
  }
  
  console.log("Results cleared");
}

/**
 * Toggle Editor Mode
 */
function toggleEditor() {
  isEditorActive = !isEditorActive;
  console.log(`Editor ${isEditorActive ? 'aktiviert' : 'deaktiviert'}`);
  
  const toggleBtn = document.getElementById('toggleEditorBtn');
  const editorTools = document.getElementById('editorTools');
  const canvasElement = document.getElementById('annotationCanvas');
  
  if (isEditorActive) {
    // Aktiviere Editor
    toggleBtn.textContent = '❌ Editor deaktivieren';
    toggleBtn.classList.add('active');
    if (editorTools) editorTools.style.display = 'flex';
    if (canvasElement) canvasElement.style.pointerEvents = 'auto';
    
    // Setup canvas events
    if (canvas) {
      setupCanvasEvents();
    }
  } else {
    // Deaktiviere Editor
    toggleBtn.textContent = '📝 Editor aktivieren';
    toggleBtn.classList.remove('active');
    if (editorTools) editorTools.style.display = 'none';
    if (canvasElement) canvasElement.style.pointerEvents = 'none';
    
    // Deselect all objects and update positioning
    if (canvas) {
      canvas.discardActiveObject();
      canvas.renderAll();
    }
    selectedObjects = [];
  }
}

/**
 * Setup Canvas Events for Editor - Pure Fabric.js approach
 */
function setupCanvasEvents() {
  if (!canvas) {
    console.warn('Cannot setup canvas events - canvas not available');
    return;
  }
  
  console.log('Setting up Fabric.js canvas events for editor');
  
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
    console.log('Fabric.js mouse:down event', { isEditorActive, currentTool });
    
    if (!isEditorActive || isProcessingClick) return;
    
    const pointer = canvas.getPointer(options.e);
    console.log('Fabric pointer position:', pointer);
    
    // Handle different tools
    if (currentTool === 'rectangle') {
      console.log('Starting rectangle drawing');
      isProcessingClick = true;
      startDrawingRectangle(pointer);
      setTimeout(() => { isProcessingClick = false; }, 50);
    } else if (currentTool === 'polygon') {
      console.log('Adding polygon point');
      addPolygonPoint(pointer, options.e);
    } else if (currentTool === 'line') {
      console.log('Adding line point');
      addLinePoint(pointer, options.e);
    }
    // For 'select' tool, let Fabric.js handle selection naturally
  });
  
  // Mouse move event - for drawing previews
  canvas.on('mouse:move', function(options) {
    if (!isEditorActive || !drawingMode) return;
    
    const pointer = canvas.getPointer(options.e);
    
    if (currentTool === 'rectangle' && currentPath) {
      updateDrawingRectangle(pointer);
    } else if (currentTool === 'polygon' && currentPolygon) {
      updatePolygonPreview(pointer);
    } else if (currentTool === 'line' && currentLine) {
      updateLinePreview(pointer);
    }
  });
  
  // Mouse up event - finish drawing operations
  canvas.on('mouse:up', function(options) {
    console.log('Fabric.js mouse:up event', { isEditorActive, drawingMode, currentTool });
    
    if (!isEditorActive) return;
    
    if (currentTool === 'rectangle' && drawingMode) {
      console.log('Finishing rectangle drawing');
      finishDrawingRectangle();
    }
  });
  
  // Double-click event - for polygon and line finishing
  canvas.on('mouse:dblclick', function(options) {
    console.log('Fabric.js double-click event', { currentTool, currentPoints: currentPoints.length });
    
    if (!isEditorActive) return;
    
    if (currentTool === 'polygon' && currentPoints.length >= 3) {
      console.log('Double-click detected, finishing polygon');
      finishPolygonDrawing();
    } else if (currentTool === 'line' && currentPoints.length >= 2) {
      console.log('Double-click detected, finishing line sequence');
      finishLineDrawing();
    }
  });
  
  // Selection events
  canvas.on('selection:created', function(e) {
    if (!isEditorActive) return;
    selectedObjects = e.selected || [];
    console.log('Objects selected:', selectedObjects.length);
    if (currentTool === 'select' && selectedObjects.length > 0) {
      updateUniversalLabelDropdown(currentTool, selectedObjects[0]);
    }
  });
  
  canvas.on('selection:updated', function(e) {
    if (!isEditorActive) return;
    selectedObjects = e.selected || [];
    console.log('Selection updated:', selectedObjects.length);
    if (currentTool === 'select' && selectedObjects.length > 0) {
      updateUniversalLabelDropdown(currentTool, selectedObjects[0]);
    }
  });
  
  canvas.on('selection:cleared', function(e) {
    if (!isEditorActive) return;
    selectedObjects = [];
    console.log('Selection cleared');
    if (currentTool === 'select') {
      updateUniversalLabelDropdown(currentTool);
    }
  });
  
  console.log('Fabric.js canvas events setup complete');
}


/**
 * Set Current Tool
 */
function setTool(toolName) {
  console.log(`Tool switching from ${currentTool} to ${toolName}`);
  
  // Clean up current tool state first
  cleanupCurrentTool();
  
  currentTool = toolName;
  console.log(`Tool switched to: ${toolName}`);
  
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
      console.log('Switching to selection mode');
      canvas.selection = true; // Es können mehrere Objekte gleichzeitig mit Auswahlrahmen ausgewählt werden
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = 'move';
      console.log('Canvas objects:', canvas.getObjects().length);
      canvas.forEachObject(obj => {
        // Nur Annotation-Objekte selektierbar machen, nicht Text-Labels
        if (obj.objectType === 'annotation') {
          obj.selectable = true;
          obj.evented = true;
        } else {
          obj.selectable = false;
          obj.evented = false;
        }
      });
    } else {
      console.log('Switching to drawing mode:', toolName);
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
  
  // Determine if we're dealing with line or area labels
  const isLineTool = toolName === 'line';
  const isLineObject = selectedObject && selectedObject.annotationType === 'line';
  const useLineLabels = isLineTool || isLineObject;
  
  // Get appropriate labels
  const labels = useLineLabels ? 
    (typeof window.currentLineLabels !== 'undefined' ? window.currentLineLabels : [
      { id: 1, name: "Strecke" },
      { id: 2, name: "Höhe" },
      { id: 3, name: "Breite" },
      { id: 4, name: "Abstand" }
    ]) :
    (typeof window.currentLabels !== 'undefined' ? window.currentLabels : [
      { id: 1, name: "Fenster" },
      { id: 2, name: "Tür" },
      { id: 3, name: "Wand" },
      { id: 4, name: "Lukarne" },
      { id: 5, name: "Dach" }
    ]);
  
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
  
  console.log(`Updated universal dropdown for ${useLineLabels ? 'line' : 'area'} labels, selected: ${universalLabelSelect.value}`);
}

/**
 * Tool State Management
 */
function cleanupCurrentTool() {
  console.log(`Cleaning up ${currentTool} tool`);
  
  if (currentTool === 'rectangle' && currentPath) {
    canvas.remove(currentPath);
    currentPath = null;
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
  console.log('Resetting all drawing states');
  
  drawingMode = false;
  currentPath = null;
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
  const selectedLabelId = getCurrentSelectedLabel('area');
  const label = getLabel(selectedLabelId);
  
  const rect = new fabric.Rect({
    left: pointer.x,
    top: pointer.y,
    width: 0,
    height: 0,
    fill: label.color + '20', // 20% opacity
    stroke: label.color,
    strokeWidth: 2,
    objectType: 'annotation',
    annotationType: 'rectangle',
    selectable: isEditorActive && currentTool === 'select',
    evented: isEditorActive && currentTool === 'select'
  });
  
  canvas.add(rect);
  currentPath = rect;
}

function updateDrawingRectangle(pointer) {
  if (!currentPath || !rectangleStartPoint) return;
  
  const startX = rectangleStartPoint.x;
  const startY = rectangleStartPoint.y;
  const width = pointer.x - startX;
  const height = pointer.y - startY;
    
  currentPath.set({
    width: Math.abs(width),
    height: Math.abs(height),
    left: width < 0 ? pointer.x : startX,
    top: height < 0 ? pointer.y : startY
  });
    
  canvas.renderAll();
}

function finishDrawingRectangle() {
  if (!currentPath) return;
  
  // Minimum size check
  if (currentPath.width < 10 || currentPath.height < 10) {
    canvas.remove(currentPath);
  } else {
    // Get selected label
    const selectedLabelId = getCurrentSelectedLabel('area');
    const label = getLabel(selectedLabelId);
    
    // Update rectangle with correct label and colors
    currentPath.set({
      selectable: true,
      evented: true,
      labelId: selectedLabelId,
      objectLabel: selectedLabelId,
      fill: label.color + '20', // 20% opacity
      stroke: label.color
    });
    
    // Calculate area
    const area = calculateRectangleArea(currentPath);
    console.log(`Rectangle created with area: ${area.toFixed(2)} m², Label: ${label.name}`);
    
    // Add to results data
    addAnnotationToResults(currentPath, 'rectangle', area);
    
    // Add text label like other annotations
    const annotationNumber = window.data ? window.data.predictions.length : 1;
    const labelText = `#${annotationNumber}: ${label.name} (${area.toFixed(2)}m²)`;
    createAnnotationLabel({ x: currentPath.left, y: currentPath.top }, labelText, label.color, label.id);
  }
  
  drawingMode = false;
  currentPath = null;
  rectangleStartPoint = null;
  canvas.renderAll();
}

/**
 * Get pixel to meter conversion factor based on current settings
 */
function getPixelToMeterFactor() {
  // Get form values
  const dpi = parseFloat(document.getElementById('dpi')?.value || 300);
  const formatWidth = parseFloat(document.getElementById('formatWidth')?.value || 210); // mm
  const planScale = parseFloat(document.getElementById('planScale')?.value || 100); // 1:X
  
  if (!uploadedImage || !uploadedImage.naturalWidth) {
    console.warn('Image not available for scale calculation');
    return 0.001; // fallback
  }
  
  // Real world width in meters (taking plan scale into account)
  const realWorldWidthMm = formatWidth * planScale; // mm in real world
  const realWorldWidthM = realWorldWidthMm / 1000; // convert to meters
  
  // Image width in pixels
  const imageWidthPixels = uploadedImage.naturalWidth;
  
  // Calculate pixel to meter conversion
  const pixelToMeter = realWorldWidthM / imageWidthPixels;
  
  console.log(`Scale calculation:
    - Format width: ${formatWidth}mm
    - Format height: ${parseFloat(document.getElementById('formatHeight')?.value || 297)}mm
    - Plan scale: 1:${planScale}
    - Real world width: ${realWorldWidthMm}mm = ${realWorldWidthM}m
    - Image width: ${imageWidthPixels}px
    - Image height: ${uploadedImage.naturalHeight}px
    - Pixel to meter factor: ${pixelToMeter}`);
  
  return pixelToMeter;
}

/**
 * Calculate rectangle area
 */
function calculateRectangleArea(rect) {
  const pixelToMeter = getPixelToMeterFactor();
  
  // Canvas coordinates are now 1:1 with natural coordinates (no conversion needed)
  const naturalWidth = rect.width;
  const naturalHeight = rect.height;
  
  // Convert to real world dimensions
  const widthM = naturalWidth * pixelToMeter;
  const heightM = naturalHeight * pixelToMeter;
  
  const area = widthM * heightM;
  
  console.log(`Rectangle area calculation:
    - Canvas size: ${rect.width.toFixed(1)} x ${rect.height.toFixed(1)}px
    - Natural size: ${naturalWidth.toFixed(1)} x ${naturalHeight.toFixed(1)}px  
    - Real world: ${widthM.toFixed(3)} x ${heightM.toFixed(3)}m
    - Area: ${area.toFixed(4)}m²`);
  
  return area;
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
  console.log('Selected objects deleted');
}

/**
 * Create annotation text label
 */
function createAnnotationLabel(position, labelText, backgroundColor, labelId = null) {
  const text = new fabric.Text(labelText, {
    left: position.x,
    top: position.y - 20,
    fontSize: 12,
    fill: 'white',
    backgroundColor: backgroundColor,
    padding: 3,
    objectType: 'label',
    textBaseline: 'alphabetic',
    selectable: false,
    associatedLabelId: labelId // Add this property for label updates
  });
  canvas.add(text);
  return text;
}

/**
 * Get currently selected label ID from universal dropdown
 */
function getCurrentSelectedLabel(type = 'area') {
  const universalLabelSelect = document.getElementById('universalLabelSelect');
  return universalLabelSelect ? parseInt(universalLabelSelect.value) : 1;
}

/**
 * Add annotation to results data structure
 */
function addAnnotationToResults(annotationObject, type, area = null, length = null) {
  if (!window.data) {
    window.data = { predictions: [] };
  }
  if (!window.data.predictions) {
    window.data.predictions = [];
  }
  
  const newPrediction = {
    label: annotationObject.labelId || 1,
    score: 1.0, // User-created annotations have 100% confidence
    objectType: annotationObject.objectType,
    annotationType: type,
    userCreated: true
  };
  
  if (type === 'rectangle') {
    // Add bounding box coordinates
    newPrediction.box = [
      annotationObject.left,
      annotationObject.top,
      annotationObject.left + annotationObject.width,
      annotationObject.top + annotationObject.height
    ];
    newPrediction.calculatedArea = area;
  } else if (type === 'polygon') {
    // Store polygon points
    newPrediction.points = annotationObject.points;
    newPrediction.calculatedArea = area;
  } else if (type === 'line') {
    // Store line points
    newPrediction.points = annotationObject.points;
    newPrediction.calculatedLength = length;
  }
  
  window.data.predictions.push(newPrediction);
  console.log(`Added ${type} annotation to results:`, newPrediction);
  
  // Update UI
  updateResultsTable();
  updateSummary();
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
  
  canvas.renderAll();
  
  console.log(`Label changed to: ${label.name} (ID: ${newLabelId}) for ${isLineObject ? 'line' : 'area'} object`);
}

/**
 * Check if a canvas object matches the specified label type
 */
function isCorrectObjectType(obj, labelType) {
  if (labelType === 'area') {
    return obj.type === 'rect' || obj.type === 'polygon';
  } else if (labelType === 'line') {
    return obj.type === 'polyline' || obj.annotationType === 'line';
  }
  return false;
}

/**
 * Check if a text label matches the specified label type based on its content
 */
function isCorrectTextLabelType(obj, labelType) {
  if (!obj.text) return false;
  
  // Check if text contains measurements that indicate the type
  if (labelType === 'area') {
    return obj.text.includes('m²'); // Area measurements
  } else if (labelType === 'line') {
    return obj.text.includes('m)') && !obj.text.includes('m²'); // Line measurements (but not area)
  }
  return false;
}

/**
 * Update all existing annotations with a specific label ID when label properties change
 */
function updateExistingAnnotationsWithLabel(labelId, newLabelData, labelType = 'area') {
  if (!canvas) {
    console.log('Canvas not available for label update');
    return;
  }
  
  console.log(`Updating all annotations with label ID: ${labelId} to new data:`, newLabelData);
  
  let updatedCount = 0;
  
  // Update all canvas objects with this label ID and matching type
  canvas.forEachObject(obj => {
    if ((obj.labelId === labelId || obj.objectLabel === labelId) && 
        isCorrectObjectType(obj, labelType)) {
      console.log(`Updating canvas object with label ID: ${labelId} and type: ${labelType}`);
      
      // Update visual appearance based on object type
      if (obj.type === 'rect' || obj.type === 'polygon') {
        // Area objects (rectangles and polygons)
        obj.set({
          fill: newLabelData.color + '20', // Semi-transparent fill
          stroke: newLabelData.color,
          strokeWidth: 2
        });
      } else if (obj.type === 'polyline' || obj.annotationType === 'line') {
        // Line objects (Fabric.js polylines)
        obj.set({
          stroke: newLabelData.color,
          strokeWidth: 3
        });
      }
      
      // Update label references
      obj.labelId = labelId;
      obj.objectLabel = labelId;
      
      updatedCount++;
    }
  });
  
  // Update text labels associated with annotations (with type filtering)
  canvas.forEachObject(obj => {
    if (obj.type === 'text' && obj.associatedLabelId === labelId && 
        isCorrectTextLabelType(obj, labelType)) {
      console.log(`Updating text label for label ID: ${labelId}`);
      
      // Update the text content if it contains the old label name
      const currentText = obj.text;
      if (currentText && currentText.includes(':')) {
        // Extract the annotation number and measurements, update label name
        const parts = currentText.split(':');
        if (parts.length >= 2) {
          const annotationNumber = parts[0]; // e.g., "#1"
          const measurementPart = parts[1].trim(); // e.g., "OldName (5.2m²)"
          
          // Find the measurement part (everything in parentheses)
          const measurementMatch = measurementPart.match(/\(([^)]+)\)$/);
          if (measurementMatch) {
            const measurement = measurementMatch[1]; // e.g., "5.2m²"
            const newText = `${annotationNumber}: ${newLabelData.name} (${measurement})`;
            obj.set('text', newText);
          }
        }
      }
      
      obj.set({
        fill: 'white',
        backgroundColor: newLabelData.color
      });
      updatedCount++;
    }
  });
  
  // Update predictions data if available
  if (window.data && window.data.predictions) {
    window.data.predictions.forEach(pred => {
      if (pred.label === labelId) {
        console.log(`Updating prediction data for label ID: ${labelId}`);
        // The prediction data structure doesn't store label details directly,
        // so we mainly need to ensure consistency
      }
    });
  }
  
  // Re-render canvas to show changes
  canvas.renderAll();
  
  console.log(`Updated ${updatedCount} objects with label ID: ${labelId}`);
}

// Make functions globally available
window.updateExistingAnnotationsWithLabel = updateExistingAnnotationsWithLabel;
window.updateResultsTable = updateResultsTable;

/**
 * Polygon Drawing Functions
 */
function addPolygonPoint(pointer, e) {
  console.log('Polygon tool - point added at:', pointer);
  
  if (!canvas || isProcessingClick) return;
  
  isProcessingClick = true;
  
  // Add point to current polygon
  currentPoints.push(pointer);
  console.log(`Added point ${currentPoints.length}:`, pointer);
  
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
  
  console.log('Starting polygon drawing');
  drawingMode = true;
  
  // Get current selected label and its color
  const selectedLabelId = getCurrentSelectedLabel('area');
  const label = getLabel(selectedLabelId);
  
  // Create initial polygon with first point duplicated to make it visible
  const firstPoint = currentPoints[0];
  const points = [
    { x: firstPoint.x, y: firstPoint.y },
    { x: firstPoint.x + 1, y: firstPoint.y + 1 } // Slightly offset to make it visible
  ];
  
  currentPolygon = new fabric.Polygon(points, {
    fill: label.color + '20', // 20% opacity
    stroke: label.color,
    strokeWidth: 2,
    objectType: 'annotation',
    annotationType: 'polygon',
    selectable: isEditorActive,
    evented: isEditorActive,
    hasControls: true,
    hasBorders: true,
    objectCaching: false
  });
  
  canvas.add(currentPolygon);
  canvas.renderAll();
  console.log('Polygon added to canvas');
}

function updatePolygonFromPoints() {
  if (!currentPolygon || currentPoints.length < 2) return;
  
  // Convert points to Fabric.js format
  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));
  console.log('Updating polygon with points:', fabricPoints);
  
  // Update polygon points
  currentPolygon.set({
    points: fabricPoints,
    hasBorders: true,
    hasControls: true,
  });
  
  canvas.renderAll();
  console.log('Polygon updated');
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
  
  console.log(`Polygon finished with ${currentPoints.length} points`);
  
  // Get selected label
  const selectedLabelId = getCurrentSelectedLabel('area');
  const label = getLabel(selectedLabelId);
  
  // Make polygon selectable and apply label
  currentPolygon.set({
    selectable: true,
    evented: true,
    labelId: selectedLabelId,
    objectLabel: selectedLabelId,
    fill: label.color + '20', // 20% opacity
    stroke: label.color
  });
  
  // Calculate area
  const area = calculatePolygonArea(currentPoints);
  console.log(`Polygon created with area: ${area.toFixed(2)} m², Label: ${label.name}`);
  
  // Add to results data
  addAnnotationToResults(currentPolygon, 'polygon', area);
  
  // Add text label positioned near the first point for predictable placement
  const firstPoint = currentPoints[0];
  const annotationNumber = window.data ? window.data.predictions.length : 1;
  const labelText = `#${annotationNumber}: ${label.name} (${area.toFixed(2)}m²)`;
  createAnnotationLabel({ x: firstPoint.x, y: firstPoint.y }, labelText, label.color, label.id);
  
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
  console.log('Line tool - point added at:', pointer);
  
  if (!canvas || isProcessingClick) return;
  
  isProcessingClick = true;
  
  // Add point to current line sequence
  currentPoints.push(pointer);
  console.log(`Added point ${currentPoints.length}:`, pointer);
  
  if (currentPoints.length === 1) {
    // First point - start line sequence
    startLineDrawing();
    drawingMode = true; // Enable mouse move for preview
    console.log('Line sequence started');
  } else {
    // Additional point - extend the line sequence
    updateLineFromPoints();
    console.log(`Line sequence extended to ${currentPoints.length} points`);
  }
  
  setTimeout(() => { isProcessingClick = false; }, 50);
}

function startLineDrawing() {
  if (!canvas || currentPoints.length === 0) return;
  
  console.log('Starting line sequence drawing');
  
  // Get current selected label and its color
  const selectedLabelId = getCurrentSelectedLabel('line');
  const lineLabel = getLabelById ? getLabelById(selectedLabelId, 'line') : null;
  const labelColor = lineLabel ? lineLabel.color : '#FF0000';
  
  // Create initial polyline with first point duplicated to make it visible
  const firstPoint = currentPoints[0];
  const points = [
    { x: firstPoint.x, y: firstPoint.y },
    { x: firstPoint.x + 1, y: firstPoint.y + 1 } // Slightly offset to make it visible
  ];
  
  currentLine = new fabric.Polyline(points, {
    fill: '',
    stroke: labelColor,
    strokeWidth: 3,
    objectType: 'annotation',
    annotationType: 'line',
    selectable: isEditorActive && currentTool === 'select',
    evented: isEditorActive && currentTool === 'select',
    objectCaching: false, // true = verbessert performance und objekte werden schneller gerendert
    absolutePositioned: true, // Wichtig, dass Objekt anhand der canvas-Koordinaten positioniert wird
    clipPath: null, // null = keine Einschränkung bei der Grösse des Polygons. 
    width: canvas.width,
    height: canvas.height
  });
  
  canvas.add(currentLine);
  canvas.renderAll();
  console.log('Line sequence added to canvas');
}

function updateLineFromPoints() {
  if (!currentLine || currentPoints.length < 2) return;
  
  // Convert points to Fabric.js format
  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));
  console.log('Updating line sequence with points:', fabricPoints);
  
  // Update polyline points
  currentLine.set({
    points: fabricPoints
  });
  
  canvas.renderAll();
  console.log('Line sequence updated');
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
  
  console.log(`Line sequence finished with ${currentPoints.length} points`);
  
  // Get selected label
  const selectedLabelId = getCurrentSelectedLabel('line');
  const lineLabel = getLabelById ? getLabelById(selectedLabelId, 'line') : null;
  const labelColor = lineLabel ? lineLabel.color : '#FF0000';
  const labelName = lineLabel ? lineLabel.name : 'Strecke';
  
  // Make line sequence selectable and apply label
  currentLine.set({
    selectable: true,
    evented: true,
    labelId: selectedLabelId,
    objectLabel: selectedLabelId,
    stroke: labelColor
  });
  
  // Calculate total length of all segments
  const totalLength = calculatePolylineLength(currentPoints);
  console.log(`Line sequence created with total length: ${totalLength.toFixed(2)} m, Label: ${labelName}`);
  
  // Add to results data
  addAnnotationToResults(currentLine, 'line', null, totalLength);
  
  // Add text label positioned at the midpoint of the line with same format as table
  const midIndex = Math.floor(currentPoints.length / 2);
  const labelPosition = currentPoints[midIndex];
  const annotationNumber = window.data ? window.data.predictions.length : 1;
  const labelText = `#${annotationNumber}: ${labelName} (${totalLength.toFixed(2)}m)`;
  createAnnotationLabel({ x: labelPosition.x, y: labelPosition.y }, labelText, labelColor, selectedLabelId);
  
  resetLineDrawing();
}

function resetLineDrawing() {
  drawingMode = false;
  currentLine = null;
  currentPoints = [];
}

/**
 * Area and Length Calculations
 */
function calculatePolygonArea(points) {
  if (points.length < 3) return 0;
  
  const pixelToMeter = getPixelToMeterFactor();
  
  // Canvas coordinates are now 1:1 with natural coordinates (no conversion needed)
  const naturalPoints = points;
  
  // Shoelace formula for polygon area in natural pixels
  let areaPixels = 0;
  for (let i = 0; i < naturalPoints.length; i++) {
    const j = (i + 1) % naturalPoints.length;
    areaPixels += naturalPoints[i].x * naturalPoints[j].y;
    areaPixels -= naturalPoints[j].x * naturalPoints[i].y;
  }
  areaPixels = Math.abs(areaPixels) / 2;
  
  // Convert to square meters
  const area = areaPixels * pixelToMeter * pixelToMeter;
  
  console.log(`Polygon area calculation:
    - Canvas points: ${points.length}
    - Natural area: ${areaPixels.toFixed(1)}px²
    - Real world area: ${area.toFixed(4)}m²`);
  
  return area;
}

function calculateLineLength(point1, point2) {
  const pixelToMeter = getPixelToMeterFactor();
  
  // Canvas coordinates are now 1:1 with natural coordinates (no conversion needed)
  const naturalPoint1 = point1;
  const naturalPoint2 = point2;
  
  // Calculate length in natural pixels
  const dx = naturalPoint2.x - naturalPoint1.x;
  const dy = naturalPoint2.y - naturalPoint1.y;
  const lengthInPixels = Math.sqrt(dx * dx + dy * dy);
  
  // Convert to meters
  const length = lengthInPixels * pixelToMeter;
  
  console.log(`Line length calculation:
    - Canvas length: ${Math.sqrt((point2.x - point1.x)**2 + (point2.y - point1.y)**2).toFixed(1)}px
    - Natural length: ${lengthInPixels.toFixed(1)}px
    - Real world length: ${length.toFixed(4)}m`);
  
  return length;
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
  
  console.log(`Polyline length calculation:
    - Number of segments: ${points.length - 1}
    - Total natural length: ${totalLength.toFixed(1)}px
    - Real world length: ${lengthInMeters.toFixed(4)}m`);
  
  return lengthInMeters;
}

/**
 * Display PDF page callback function for pdf-handler
 * @param {number} pageNumber - The page number being displayed
 * @param {Object} pageData - The page data to display
 */
function displayPdfPage(pageNumber, pageData) {
  console.log(`=== DISPLAYING PDF PAGE ${pageNumber} ===`);
  
  // Store the data globally
  window.data = pageData;
  
  // Update form fields with page-specific settings if available
  if (pageData.page_sizes && pageData.page_sizes.length >= pageNumber) {
    const currentPageSize = pageData.page_sizes[pageNumber - 1];
    if (currentPageSize) {
      document.getElementById('formatWidth').value = Math.round(currentPageSize[0]);
      document.getElementById('formatHeight').value = Math.round(currentPageSize[1]);
    }
  }
  
  // Set image source
  if (pageData.pdf_image_url) {
    console.log("Setting PDF image URL:", pageData.pdf_image_url);
    uploadedImage.src = pageData.pdf_image_url + '?t=' + new Date().getTime();
  }
  
  // Wait for image to load and then display annotations
  uploadedImage.onload = function() {
    console.log(`=== PDF PAGE ${pageNumber} IMAGE LOADED ===`);
    console.log(`Image size: ${uploadedImage.width}x${uploadedImage.height}`);
    console.log(`Natural size: ${uploadedImage.naturalWidth}x${uploadedImage.naturalHeight}`);
    
    // Clear existing canvas content
    if (canvas) {
      canvas.clear();
    }
    
    // Reinitialize canvas for the new image
    initCanvas();
    
    // Display annotations if any
    if (pageData.predictions && pageData.predictions.length > 0) {
      console.log(`⚡ DISPLAYING ${pageData.predictions.length} annotations for page ${pageNumber}`);
      displayAnnotations(pageData.predictions);
    } else {
      console.log(`📄 Page ${pageNumber} has no annotations to display`);
    }
    
    // Update UI
    updateSummary();
    updateResultsTable();
  };
  
  uploadedImage.onerror = function() {
    console.error(`Failed to load image for page ${pageNumber}:`, pageData.pdf_image_url);
  };
}

/**
 * Initialize application
 */
function initApp() {
  console.log("=== INITIALIZING APPLICATION ===");
  
  // Get DOM elements
  imageContainer = document.getElementById('imageContainer');
  uploadedImage = document.getElementById('uploadedImage');
  const uploadForm = document.getElementById('uploadForm');
  const formatSelect = document.getElementById('formatSelect');
  const customFormatFields = document.getElementById('customFormatFields');
  
  // Setup format selection
  if (formatSelect && customFormatFields) {
    formatSelect.addEventListener('change', function() {
      const isCustom = this.value === 'custom';
      customFormatFields.style.display = isCustom ? 'block' : 'none';
      
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
          document.getElementById('formatWidth').value = size[0];
          document.getElementById('formatHeight').value = size[1];
          console.log(`Format changed to ${this.value}: ${size[0]}x${size[1]}mm`);
        }
      }
    });
  }
  
  // Setup form submission
  if (uploadForm) {
    uploadForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      console.log("=== FORM SUBMITTED ===");
      
      // Clear previous results
      clearResults();
      
      // Show loader
      const loader = document.getElementById('loader');
      const errorMessage = document.getElementById('errorMessage');
      if (loader) loader.style.display = 'block';
      if (errorMessage) errorMessage.style.display = 'none';
      
      const formData = new FormData(uploadForm);
      
      // Handle format detection: only send values if NOT auto-detection
      const formatSelect = document.getElementById('formatSelect');
      
      if (formatSelect?.value === 'auto') {
        // For automatic detection, don't send format dimensions - let backend use PDF metadata
        console.log('Auto-detection: Backend will use PDF metadata for format detection');
      } else {
        // For manual selection, send the specified format dimensions
        const formatWidthValue = document.getElementById('formatWidth')?.value || '210';
        const formatHeightValue = document.getElementById('formatHeight')?.value || '297';
        formData.set('format_width', formatWidthValue);
        formData.set('format_height', formatHeightValue);
        console.log(`Form submission with manual format: ${formatWidthValue}x${formatHeightValue}mm`);
      }
      
      // API call
      fetch('/predict', {
        method: 'POST',
        body: formData
      })
      .then(response => {
        if (!response.ok) {
          return response.json().then(data => {
            throw new Error(data.error || 'Request failed');
          });
        }
        return response.json();
      })
      .then(data => {
        console.log("=== API RESPONSE RECEIVED ===", data);
        
        // Store data
        window.data = data;
        
        // Show results sections
        const resultsSection = document.getElementById('resultsSection');
        const resultsTableSection = document.getElementById('resultsTableSection');
        if (resultsSection) resultsSection.style.display = 'block';
        if (resultsTableSection) resultsTableSection.style.display = 'block';
        
        // Handle PDF vs regular image
        if (data.is_pdf) {
          console.log("PDF detected, processing with PDF handler");
          // Process PDF data with the PDF handler
          processPdfData(data);
          
          // The PDF handler will handle navigation and display
          // Initial page display is handled automatically
          displayPdfPage(data.current_page || 1, data);
        } else {
          console.log("Regular image file detected");
          // Handle regular image files as before
          const uploadedFile = document.getElementById('file').files[0];
          if (uploadedFile) {
            uploadedImage.src = URL.createObjectURL(uploadedFile);
          }
          
          // Wait for image to load
          uploadedImage.onload = function() {
            console.log("=== IMAGE LOADED ===");
            console.log(`Image size: ${uploadedImage.width}x${uploadedImage.height}`);
            console.log(`Natural size: ${uploadedImage.naturalWidth}x${uploadedImage.naturalHeight}`);
            
            console.log("=== CHECKING PREDICTIONS ===");
            console.log(`Predictions array:`, data.predictions);
            console.log(`Predictions count:`, data.predictions?.length);
            
            // Display annotations
            if (data.predictions && data.predictions.length > 0) {
              console.log("⚡ CALLING displayAnnotations() with", data.predictions.length, "predictions");
              displayAnnotations(data.predictions);
            } else {
              console.warn("❌ No predictions to display - skipping displayAnnotations()");
              console.log("Data structure:", data);
            }
            
            // Update UI
            updateSummary();
            updateResultsTable();
          };
        }
      })
      .catch(error => {
        console.error('=== API ERROR ===', error);
        if (errorMessage) {
          errorMessage.textContent = 'Error: ' + error.message;
          errorMessage.style.display = 'block';
        }
      })
      .finally(() => {
        if (loader) loader.style.display = 'none';
      });
    });
  }
  
  // Setup editor event listeners
  const toggleEditorBtn = document.getElementById('toggleEditorBtn');
  if (toggleEditorBtn) {
    toggleEditorBtn.addEventListener('click', toggleEditor);
  }
  
  // Setup tool buttons
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
    
  // Initialize labels module
  setupLabels({
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
    cancelLabelBtn: document.getElementById('cancelLabelBtn'),
    areaLabelsTab: document.getElementById('areaLabelsTab'),
    lineLabelsTab: document.getElementById('lineLabelsTab')
  });
  
  // Initialize PDF handler module
  setupPdfHandler({
    pdfNavigation: document.getElementById('pdfNavigation'),
    currentPageSpan: document.getElementById('currentPageSpan'),
    totalPagesSpan: document.getElementById('totalPagesSpan'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    reprocessBtn: document.getElementById('reprocessBtn'),
    loader: document.getElementById('loader'),
    errorMessage: document.getElementById('errorMessage')
  });
  
  // Set PDF page display callback
  setDisplayPageCallback(displayPdfPage);
  
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
      setPdfSessionId,
      setPdfPageData,
      setPageSettings
    }
  });
  
  // Make project functions globally available for compatibility
  window.saveProject = saveProject;
  window.loadProject = loadProject;
  window.displayPdfPage = displayPdfPage;
  
  console.log("✅ Application with editor, labels, PDF navigation, and project management initialized");
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);