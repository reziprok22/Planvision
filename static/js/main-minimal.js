/**
 * main-minimal.js - Reduzierte Version für Debugging
 * Nur Kern-Funktionalität: Upload, Predict, Rechteck-Anzeige, Basis-Zoom
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

// Global app state - MINIMAL + EDITOR
window.data = null;
let canvas = null;
let imageContainer = null;
let uploadedImage = null;
let currentZoom = 1.0;

// Editor state
let isEditorActive = false;
let currentTool = 'rectangle';
let drawingMode = false;
let currentPath = null;
let currentPoints = [];
let selectedObjects = [];
let currentPolygon = null;
let currentLine = null;

// Event timing control
let isProcessingClick = false;

// Standard Labels (fest codiert)
const LABELS = {
  0: { name: "Andere", color: "#808080" },
  1: { name: "Fenster", color: "#0000FF" },
  2: { name: "Tür", color: "#FF0000" },
  3: { name: "Wand", color: "#D4D638" },
  4: { name: "Lukarne", color: "#FFA500" },
  5: { name: "Dach", color: "#800080" }
};

/**
 * Debug-Funktionen für Troubleshooting
 */
window.DEBUG = {
  showEditorState: () => {
    console.log('=== EDITOR DEBUG INFO ===');
    console.log('isEditorActive:', isEditorActive);
    console.log('currentTool:', currentTool);
    console.log('drawingMode:', drawingMode);
    console.log('isProcessingClick:', isProcessingClick);
    console.log('currentPoints:', currentPoints.length);
    console.log('currentPath:', !!currentPath);
    console.log('currentPolygon:', !!currentPolygon);
    console.log('currentLine:', !!currentLine);
    console.log('Canvas events bound:', canvas?.__eventListeners ? Object.keys(canvas.__eventListeners) : 'none');
    console.log('Canvas selection enabled:', canvas?.selection);
    console.log('Canvas pointer events:', document.getElementById('annotationCanvas')?.style.pointerEvents);
  },
  showCanvasInfo: () => {
    console.log('=== CANVAS DEBUG INFO ===');
    console.log('Canvas object:', canvas);
    console.log('Canvas size:', canvas?.width, 'x', canvas?.height);
    console.log('Canvas zoom:', canvas?.getZoom());
    console.log('Canvas objects count:', canvas?.getObjects()?.length);
    console.log('Image natural size:', uploadedImage?.naturalWidth, 'x', uploadedImage?.naturalHeight);
    console.log('Image displayed size:', uploadedImage?.offsetWidth, 'x', uploadedImage?.offsetHeight);
    console.log('Current zoom:', currentZoom);
    console.log('Window data:', window.data);
  },
  
  listAnnotations: () => {
    console.log('=== ANNOTATIONS DEBUG ===');
    console.log('Predictions from API:', window.data?.predictions);
    
    // DETAILIERTE Analyse der ersten Prediction
    if (window.data?.predictions?.length > 0) {
      console.log('First prediction structure:', window.data.predictions[0]);
      console.log('First prediction keys:', Object.keys(window.data.predictions[0]));
      console.log('Has box?', !!window.data.predictions[0].box);
      console.log('Has bbox?', !!window.data.predictions[0].bbox);
      console.log('Box value:', window.data.predictions[0].box);
      console.log('BBox value:', window.data.predictions[0].bbox);
    }
    
    console.log('Canvas objects:', canvas?.getObjects()?.map(obj => ({
      type: obj.objectType,
      index: obj.annotationIndex,
      position: `${obj.left},${obj.top}`,
      size: `${obj.width}x${obj.height}`
    })));
  },
  
  testAnnotation: () => {
    console.log('=== CREATING TEST ANNOTATION ===');
    if (!canvas) {
      console.error('No canvas available!');
      return;
    }
    
    // Test-Rechteck erstellen
    const testRect = new fabric.Rect({
      left: 100,
      top: 100,
      width: 200,
      height: 150,
      fill: 'rgba(0, 0, 255, 0.2)',
      stroke: '#0000FF',
      strokeWidth: 2,
      objectType: 'annotation',
      annotationType: 'rectangle'
    });
    
    canvas.add(testRect);
    canvas.renderAll();
    console.log('Test rectangle added');
  },
  
  testDrawing: () => {
    console.log('=== TESTING DRAWING FUNCTIONALITY ===');
    if (!canvas) {
      console.error('No canvas available!');
      return;
    }
    
    // Simuliere eine Rechteck-Zeichnung
    const rect = new fabric.Rect({
      left: 500,
      top: 500,
      width: 150,
      height: 100,
      fill: 'rgba(255, 0, 0, 0.3)',
      stroke: '#FF0000',
      strokeWidth: 3,
      objectType: 'userDrawn',
      annotationType: 'rectangle'
    });
    
    canvas.add(rect);
    canvas.renderAll();
    console.log('Test drawing rectangle added at 500,500');
  },
  
  clearCanvas: () => {
    if (canvas) {
      canvas.clear();
      console.log('Canvas cleared');
    }
  },
  
  checkCanvasEvents: () => {
    console.log('=== CANVAS EVENT CHECK ===');
    const canvasElement = document.getElementById('annotationCanvas');
    const canvasWrapper = canvas?.wrapperEl;
    const lowerCanvas = canvas?.lowerCanvasEl;
    
    console.log('Canvas element pointer events:', canvasElement?.style.pointerEvents);
    console.log('Canvas wrapper pointer events:', canvasWrapper?.style.pointerEvents);
    console.log('Lower canvas pointer events:', lowerCanvas?.style.pointerEvents);
    console.log('Canvas wrapper z-index:', canvasWrapper?.style.zIndex);
    console.log('Canvas wrapper position:', canvasWrapper?.style.position);
    console.log('Canvas wrapper bounds:', canvasWrapper?.getBoundingClientRect());
    
    // Test if the canvas element receives mouse events
    if (lowerCanvas) {
      lowerCanvas.addEventListener('mousedown', (e) => {
        console.log('DIRECT canvas mousedown event!', e);
      }, { once: true });
      console.log('Added direct mousedown listener to lower canvas');
    }
    
    // Test Fabric.js event too
    canvas.on('mouse:down', (e) => {
      console.log('FABRIC.JS mouse:down event!', e);
    });
    console.log('Added Fabric.js test listener');
  },
  
  testCanvasClick: () => {
    console.log('=== TESTING CANVAS CLICK ===');
    if (!canvas || !canvas.lowerCanvasEl) {
      console.error('No canvas available');
      return;
    }
    
    // Simulate a click on the canvas
    const rect = canvas.lowerCanvasEl.getBoundingClientRect();
    const event = new MouseEvent('mousedown', {
      clientX: rect.left + 100,
      clientY: rect.top + 100,
      bubbles: true
    });
    
    console.log('Simulating click at:', rect.left + 100, rect.top + 100);
    canvas.lowerCanvasEl.dispatchEvent(event);
  }
};

/**
 * Initialize minimal canvas
 */
function initCanvas() {
  console.log("=== INITIALIZING MINIMAL CANVAS ===");
  
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
  
  // NEUE STRATEGIE: Canvas-Größe = angezeigte Bildgröße (nicht natural size!)
  const displayedWidth = uploadedImage.offsetWidth;
  const displayedHeight = uploadedImage.offsetHeight;
  const naturalWidth = uploadedImage.naturalWidth;
  const naturalHeight = uploadedImage.naturalHeight;
  
  // Skalierungsfaktor für Koordinaten-Umrechnung
  window.coordinateScaleFactor = {
    x: naturalWidth / displayedWidth,
    y: naturalHeight / displayedHeight
  };
  
  console.log(`Canvas size set to displayed size: ${displayedWidth}x${displayedHeight}`);
  console.log(`Natural image size: ${naturalWidth}x${naturalHeight}`);
  console.log(`Coordinate scale factor:`, window.coordinateScaleFactor);
  
  // Canvas-Größe = angezeigte Größe (macht Events einfacher)
  canvas.setWidth(displayedWidth);
  canvas.setHeight(displayedHeight);
  
  // Kein Canvas-Zoom mehr nötig - Canvas ist 1:1 mit angezeigtem Bild
  canvas.setZoom(currentZoom);
  console.log(`Canvas zoom set to: ${currentZoom}`);
  
  // Position canvas container
  updateCanvasPosition();
  
  // Setup editor event handlers if editor is active
  if (isEditorActive) {
    setupCanvasEvents();
  }
  
  console.log("Canvas initialized successfully");
  return canvas;
}

/**
 * Update canvas position to match image - Simplified for Fabric.js
 */
function updateCanvasPosition() {
  if (!canvas || !imageContainer || !uploadedImage) return;
  
  const canvasWrapper = canvas.wrapperEl;
  if (!canvasWrapper) return;
  
  // Get image position and size
  const imageRect = uploadedImage.getBoundingClientRect();
  const containerRect = imageContainer.getBoundingClientRect();
  
  const relLeft = imageRect.left - containerRect.left + imageContainer.scrollLeft;
  const relTop = imageRect.top - containerRect.top + imageContainer.scrollTop;
  
  // Position the canvas wrapper to exactly overlay the image
  canvasWrapper.style.position = 'absolute';
  canvasWrapper.style.left = `${relLeft}px`;
  canvasWrapper.style.top = `${relTop}px`;
  canvasWrapper.style.width = `${imageRect.width}px`;
  canvasWrapper.style.height = `${imageRect.height}px`;
  canvasWrapper.style.zIndex = '100'; // High z-index
  
  // Always enable pointer events
  canvasWrapper.style.pointerEvents = 'auto';
  
  console.log(`Canvas positioned: ${relLeft}, ${relTop}, ${imageRect.width}x${imageRect.height}`);
}

/**
 * Display annotations (ONLY rectangles in minimal version)
 */
function displayAnnotations(predictions) {
  console.log("=== DISPLAYING ANNOTATIONS ===");
  console.log(`Processing ${predictions?.length || 0} predictions`);
  
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
  
  predictions.forEach((pred, index) => {
    console.log(`Processing prediction ${index}:`, pred);
    console.log(`  - Has box: ${!!pred.box}, Has bbox: ${!!pred.bbox}`);
    console.log(`  - Box value:`, pred.box);
    console.log(`  - BBox value:`, pred.bbox);
    
    // Only process rectangles in minimal version
    if (pred.box || pred.bbox) {
      const coords = pred.box || pred.bbox;
      const [x1, y1, x2, y2] = coords;
      
      // WICHTIG: Koordinaten von Natural-Size auf Canvas-Size umrechnen
      const scaleFactor = window.coordinateScaleFactor;
      const canvasX1 = x1 / scaleFactor.x;
      const canvasY1 = y1 / scaleFactor.y;
      const canvasX2 = x2 / scaleFactor.x;
      const canvasY2 = y2 / scaleFactor.y;
      const canvasWidth = canvasX2 - canvasX1;
      const canvasHeight = canvasY2 - canvasY1;
      
      // Get label info
      const labelId = pred.label || 0;
      const label = LABELS[labelId] || LABELS[0];
      
      console.log(`Creating rectangle: natural(${x1},${y1} ${x2-x1}x${y2-y1}) -> canvas(${canvasX1.toFixed(1)},${canvasY1.toFixed(1)} ${canvasWidth.toFixed(1)}x${canvasHeight.toFixed(1)}), label: ${label.name}`);
      
      // Create rectangle with canvas coordinates
      const rect = new fabric.Rect({
        left: canvasX1,
        top: canvasY1,
        width: canvasWidth,
        height: canvasHeight,
        fill: label.color + '20', // 20% opacity
        stroke: label.color,
        strokeWidth: 2,
        objectType: 'annotation',
        annotationType: 'rectangle',
        annotationIndex: index,
        selectable: isEditorActive && currentTool === 'select',
        evented: isEditorActive && currentTool === 'select'
      });
      
      canvas.add(rect);
      
      // Create label text with canvas coordinates
      const labelText = `#${index + 1}: ${label.name}`;
      const text = new fabric.Text(labelText, {
        left: canvasX1,
        top: canvasY1 - 20,
        fontSize: 12,
        fill: 'white',
        backgroundColor: label.color,
        padding: 3,
        objectType: 'label',
        selectable: isEditorActive && currentTool === 'select',
        evented: isEditorActive && currentTool === 'select'
      });
      
      canvas.add(text);
      rectangleCount++;
    } else {
      console.log(`Skipping non-rectangle annotation ${index}:`, pred.type || 'unknown');
    }
  });
  
  canvas.renderAll();
  console.log(`✅ Displayed ${rectangleCount} rectangles on canvas`);
  
  // Update canvas position after rendering
  setTimeout(updateCanvasPosition, 50);
  
  // Re-setup canvas events if editor is active
  if (isEditorActive) {
    setTimeout(() => {
      setupCanvasEvents();
      console.log('Canvas events re-established after annotation display');
    }, 100);
  }
}

/**
 * Simple zoom functionality
 */
function setZoom(zoomLevel) {
  console.log(`=== SETTING ZOOM TO ${zoomLevel} ===`);
  
  currentZoom = Math.max(0.1, Math.min(5.0, zoomLevel));
  
  // Zoom image
  uploadedImage.style.transform = `scale(${currentZoom})`;
  uploadedImage.style.transformOrigin = 'top left';
  
  // Zoom canvas - einfach da Canvas = angezeigte Bildgröße
  if (canvas) {
    console.log(`Updating canvas zoom to: ${currentZoom}`);
    canvas.setZoom(currentZoom);
    updateCanvasPosition();
  }
  
  // Update zoom button text
  const zoomBtn = document.getElementById('resetZoomBtn');
  if (zoomBtn) {
    zoomBtn.textContent = `${Math.round(currentZoom * 100)}%`;
  }
  
  console.log(`Zoom set to ${currentZoom}`);
}

/**
 * Update results table (simplified)
 */
function updateResultsTable() {
  const resultsBody = document.getElementById('resultsBody');
  if (!resultsBody || !window.data?.predictions) return;
  
  resultsBody.innerHTML = '';
  
  window.data.predictions.forEach((pred, index) => {
    const label = LABELS[pred.label || 0] || LABELS[0];
    const area = pred.area ? `${pred.area.toFixed(2)} m²` : 'N/A';
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${label.name}</td>
      <td>Rechteck</td>
      <td>${((pred.score || 0) * 100).toFixed(1)}%</td>
      <td>${area}</td>
    `;
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
    const area = pred.area || 0;
    
    switch (labelId) {
      case 1: counts.fenster++; areas.fenster += area; break;
      case 2: counts.tuer++; areas.tuer += area; break;
      case 3: counts.wand++; areas.wand += area; break;
      case 4: counts.lukarne++; areas.lukarne += area; break;
      case 5: counts.dach++; areas.dach += area; break;
      default: counts.other++; areas.other += area; break;
    }
  });
  
  let summaryHtml = '';
  Object.entries(counts).forEach(([key, count]) => {
    if (count > 0) {
      const labelName = key === 'fenster' ? 'Fenster' : 
                       key === 'tuer' ? 'Türen' :
                       key === 'wand' ? 'Wände' :
                       key === 'lukarne' ? 'Lukarnen' :
                       key === 'dach' ? 'Dächer' : 'Andere';
      summaryHtml += `<p>${labelName}: <strong>${count}</strong> (${areas[key].toFixed(2)} m²)</p>`;
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
  
  // Reset zoom
  setZoom(1.0);
  
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
      updateCanvasPosition(); // Update positioning when editor is activated
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
      updateCanvasPosition(); // Update positioning when editor is deactivated
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
  
  // Double-click event - for polygon finishing
  canvas.on('mouse:dblclick', function(options) {
    console.log('Fabric.js double-click event', { currentTool, polygonPoints: currentPoints.length });
    
    if (!isEditorActive) return;
    
    if (currentTool === 'polygon' && currentPoints.length >= 3) {
      console.log('Double-click detected, finishing polygon');
      finishPolygonDrawing();
    }
  });
  
  // Selection events
  canvas.on('selection:created', function(e) {
    if (!isEditorActive) return;
    selectedObjects = e.selected || [];
    console.log('Objects selected:', selectedObjects.length);
  });
  
  canvas.on('selection:updated', function(e) {
    if (!isEditorActive) return;
    selectedObjects = e.selected || [];
    console.log('Selection updated:', selectedObjects.length);
  });
  
  canvas.on('selection:cleared', function(e) {
    if (!isEditorActive) return;
    selectedObjects = [];
    console.log('Selection cleared');
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
  
  // Update canvas selection mode
  if (canvas) {
    if (toolName === 'select') {
      console.log('Switching to selection mode');
      canvas.selection = true;
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = 'move';
      canvas.forEachObject(obj => {
        obj.selectable = true;
        obj.evented = true;
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
    }
    canvas.renderAll();
  }
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
  isProcessingClick = false;
}

/**
 * Coordinate Conversion Helpers
 */
function canvasToNaturalCoords(canvasCoords) {
  const scaleFactor = window.coordinateScaleFactor;
  return {
    x: canvasCoords.x * scaleFactor.x,
    y: canvasCoords.y * scaleFactor.y
  };
}

function naturalToCanvasCoords(naturalCoords) {
  const scaleFactor = window.coordinateScaleFactor;
  return {
    x: naturalCoords.x / scaleFactor.x,
    y: naturalCoords.y / scaleFactor.y
  };
}

/**
 * Rectangle Drawing Functions
 */
function startDrawingRectangle(pointer) {
  if (!canvas) return;
  
  drawingMode = true;
  const rect = new fabric.Rect({
    left: pointer.x,
    top: pointer.y,
    width: 0,
    height: 0,
    fill: 'rgba(0, 0, 255, 0.2)',
    stroke: '#0000FF',
    strokeWidth: 2,
    objectType: 'annotation',
    annotationType: 'rectangle',
    selectable: false,
    evented: false
  });
  
  canvas.add(rect);
  currentPath = rect;
}

function updateDrawingRectangle(pointer) {
  if (!currentPath) return;
  
  const startX = currentPath.left;
  const startY = currentPath.top;
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
    // Make rectangle selectable
    currentPath.set({
      selectable: true,
      evented: true
    });
    
    // Calculate area (example)
    const area = calculateRectangleArea(currentPath);
    console.log(`Rectangle created with area: ${area.toFixed(2)} m²`);
  }
  
  drawingMode = false;
  currentPath = null;
  canvas.renderAll();
}

/**
 * Calculate rectangle area
 */
function calculateRectangleArea(rect) {
  // This is a simplified calculation - you'd need actual scale factors
  const pixelToMeter = 0.001; // Example conversion factor
  const widthM = rect.width * pixelToMeter;
  const heightM = rect.height * pixelToMeter;
  return widthM * heightM;
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
  
  // Create initial polygon with first point duplicated to make it visible
  const firstPoint = currentPoints[0];
  const points = [
    { x: firstPoint.x, y: firstPoint.y },
    { x: firstPoint.x + 1, y: firstPoint.y + 1 } // Slightly offset to make it visible
  ];
  
  currentPolygon = new fabric.Polygon(points, {
    fill: 'rgba(0, 255, 0, 0.2)',
    stroke: '#00FF00',
    strokeWidth: 2,
    objectType: 'annotation',
    annotationType: 'polygon',
    selectable: false,
    evented: false
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
    points: fabricPoints
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
  
  // Make polygon selectable
  currentPolygon.set({
    selectable: true,
    evented: true
  });
  
  // Calculate area
  const area = calculatePolygonArea(currentPoints);
  console.log(`Polygon created with area: ${area.toFixed(2)} m²`);
  
  resetPolygonDrawing();
}

function resetPolygonDrawing() {
  drawingMode = false;
  currentPolygon = null;
  currentPoints = [];
}

/**
 * Line Drawing Functions
 */
function addLinePoint(pointer, e) {
  console.log('Line tool - point added at:', pointer);
  
  if (!canvas || isProcessingClick) return;
  
  isProcessingClick = true;
  
  if (currentPoints.length === 0) {
    // First point - start line
    currentPoints.push(pointer);
    startLineDrawing(pointer);
    drawingMode = true; // Enable mouse move for preview
    console.log('Line started, waiting for second point');
  } else if (currentPoints.length === 1) {
    // Second point - finish line
    currentPoints.push(pointer);
    updateLineFromPoints();
    finishLineDrawing(); // Finish immediately on second click
    console.log('Line completed with 2 points');
  } else {
    // Already have a complete line, ignore additional clicks
    console.log('Line already complete, ignoring click');
  }
  
  setTimeout(() => { isProcessingClick = false; }, 50);
}

function startLineDrawing(startPoint) {
  if (!canvas) return;
  
  console.log('Starting line drawing');
  
  // Create initial line
  currentLine = new fabric.Line([startPoint.x, startPoint.y, startPoint.x, startPoint.y], {
    stroke: '#FF0000',
    strokeWidth: 3,
    objectType: 'annotation',
    annotationType: 'line',
    selectable: false,
    evented: false
  });
  
  canvas.add(currentLine);
  canvas.renderAll();
  console.log('Line added to canvas');
}

function updateLineFromPoints() {
  if (!currentLine || currentPoints.length < 2) return;
  
  const [start, end] = currentPoints;
  currentLine.set({
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y
  });
  
  canvas.renderAll();
}

function updateLinePreview(pointer) {
  if (!currentLine || currentPoints.length === 0) return;
  
  const startPoint = currentPoints[0];
  currentLine.set({
    x1: startPoint.x,
    y1: startPoint.y,
    x2: pointer.x,
    y2: pointer.y
  });
  
  canvas.renderAll();
}

function finishLineDrawing() {
  if (!currentLine || currentPoints.length < 2) {
    console.warn('Need 2 points to create line');
    if (currentLine) {
      canvas.remove(currentLine);
    }
    resetLineDrawing();
    return;
  }
  
  console.log('Line finished');
  
  // Make line selectable
  currentLine.set({
    selectable: true,
    evented: true
  });
  
  // Calculate length
  const length = calculateLineLength(currentPoints[0], currentPoints[1]);
  console.log(`Line created with length: ${length.toFixed(2)} m`);
  
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
  
  // Simple conversion factor (this should be based on actual plan scale)
  const pixelToMeter = 0.001;
  
  // Shoelace formula for polygon area
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  area = Math.abs(area) / 2;
  
  // Convert to square meters
  return area * pixelToMeter * pixelToMeter;
}

function calculateLineLength(point1, point2) {
  // Simple conversion factor (this should be based on actual plan scale)
  const pixelToMeter = 0.001;
  
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;
  const lengthInPixels = Math.sqrt(dx * dx + dy * dy);
  
  // Convert to meters
  return lengthInPixels * pixelToMeter;
}

/**
 * Initialize app
 */
function initApp() {
  console.log("=== INITIALIZING MINIMAL APP ===");
  
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
        
        // Set image source
        if (data.is_pdf && data.pdf_image_url) {
          console.log("PDF detected, using image URL:", data.pdf_image_url);
          uploadedImage.src = data.pdf_image_url + '?t=' + new Date().getTime();
        } else {
          const uploadedFile = document.getElementById('file').files[0];
          if (uploadedFile) {
            uploadedImage.src = URL.createObjectURL(uploadedFile);
          }
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
  
  // Setup zoom buttons
  const zoomButtons = document.querySelectorAll('.zoom-option');
  zoomButtons.forEach(button => {
    button.addEventListener('click', function() {
      const zoom = parseFloat(this.dataset.zoom);
      setZoom(zoom);
    });
  });
  
  const resetZoomBtn = document.getElementById('resetZoomBtn');
  if (resetZoomBtn) {
    resetZoomBtn.addEventListener('click', () => setZoom(1.0));
  }
  
  // Setup scroll listener for canvas positioning
  if (imageContainer) {
    imageContainer.addEventListener('scroll', updateCanvasPosition);
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
  
  console.log("✅ Minimal app with editor initialized");
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);