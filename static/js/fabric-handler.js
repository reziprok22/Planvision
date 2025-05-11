/**
 * fabric-handler.js - Module for handling annotations using Fabric.js
 * Part of the Fenster-Erkennungstool project
 */

// Module state
let canvas = null;
let imageContainer;
let uploadedImage;
let currentZoom = 1.0;
let isDragging = false;
let lastPosX, lastPosY;
let labelFont = '12px Arial';
let currentLabels = [];
let currentLineLabels = [];

/**
 * Initialize the Fabric.js handler with required DOM elements
 * @param {Object} elements - Object containing DOM references
 */
export function setupFabricHandler(elements) {
  // Store DOM references
  imageContainer = elements.imageContainer;
  uploadedImage = elements.uploadedImage;
  
  // Load labels from LabelsManager if available
  if (window.LabelsManager) {
    currentLabels = window.LabelsManager.getAreaLabels();
    currentLineLabels = window.LabelsManager.getLineLabels();
  }
  
  // Add window resize handler
  window.addEventListener('resize', function() {
    // Throttle resize events
    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(function() {
      console.log("Window resized, adjusting canvas");
      if (canvas) resizeCanvas();
    }, 200);
  });
  
  console.log('Fabric.js handler initialized');
}

/**
 * Initialize the Fabric.js canvas
 */
export function initCanvas() {
  console.log("Initializing Fabric.js canvas");
  
  // Create canvas element if it doesn't exist
  let canvasElement = document.getElementById('annotationCanvas');
  if (!canvasElement) {
    canvasElement = document.createElement('canvas');
    canvasElement.id = 'annotationCanvas';
    
    // Position the canvas over the image
    canvasElement.style.position = 'absolute';
    canvasElement.style.top = '0';
    canvasElement.style.left = '0';
    canvasElement.style.pointerEvents = 'all'; // Enable interactions
    
    imageContainer.appendChild(canvasElement);
  }
  
  // Initialize Fabric.js canvas
  canvas = new fabric.Canvas('annotationCanvas');
  
  // Set canvas size to match container
  resizeCanvas();
  
  // Set up event listeners
  setupEventListeners();
  
  return canvas;
}

/**
 * Resize canvas to match container size
 */
function resizeCanvas() {
  if (!canvas || !imageContainer || !uploadedImage) return;
  
  console.log("Resizing Fabric.js canvas to match image dimensions");
  
  // Wait for the image to be fully loaded
  if (uploadedImage.complete && uploadedImage.naturalWidth > 0) {
    // Use the natural dimensions of the image
    const width = uploadedImage.naturalWidth;
    const height = uploadedImage.naturalHeight;
    
    console.log(`Setting canvas size to ${width}x${height} (natural: ${uploadedImage.naturalWidth}x${uploadedImage.naturalHeight})`);
    
    // Set canvas dimensions to match the NATURAL dimensions of the image
    canvas.setWidth(width);
    canvas.setHeight(height);
    
    // Make sure the canvas container matches the displayed image size
    const canvasContainer = document.getElementsByClassName('canvas-container')[0];
    if (canvasContainer) {
      canvasContainer.style.position = 'absolute';
      canvasContainer.style.top = '0';
      canvasContainer.style.left = '0';
      // Set the container to match the image's DISPLAYED size, not natural size
      canvasContainer.style.width = `${uploadedImage.offsetWidth}px`;
      canvasContainer.style.height = `${uploadedImage.offsetHeight}px`;
      
      // Set canvas scale to match the display scale of the image
      const scaleX = uploadedImage.offsetWidth / width;
      const scaleY = uploadedImage.offsetHeight / height;
      
      console.log(`Image display scale: ${scaleX.toFixed(4)} x ${scaleY.toFixed(4)}`);
      
      // Apply scaling transformation to the canvas
      canvas.setZoom(scaleX);
      
      // Make sure the canvas is responsive
      if (canvas.wrapperEl) {
        canvas.wrapperEl.style.width = `${uploadedImage.offsetWidth}px`;
        canvas.wrapperEl.style.height = `${uploadedImage.offsetHeight}px`;
      }
    }
    
    canvas.renderAll();
  } else {
    // If image isn't loaded yet, set up an event listener
    uploadedImage.onload = function() {
      setTimeout(resizeCanvas, 100); // Small delay to ensure image is fully rendered
    };
  }
}

/**
 * Set up event listeners for canvas interactions
 */
function setupEventListeners() {
  if (!canvas) return;
  
  // Zoom with mouse wheel
  canvas.on('mouse:wheel', function(opt) {
    // If we're using global zoom functionality, don't apply canvas zoom
    if (typeof window.setZoomLevel === 'function') {
      return; // Let the global zoom handler take care of it
    }
    
    const delta = opt.e.deltaY;
    let zoom = canvas.getZoom();
    zoom *= 0.999 ** delta;
    
    // Set zoom limits
    if (zoom > 10) zoom = 10;
    if (zoom < 0.1) zoom = 0.1;
    
    // Zoom to point where mouse is
    canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
    
    opt.e.preventDefault();
    opt.e.stopPropagation();
  });
  
  // Pan with Alt + Mouse drag
  canvas.on('mouse:down', function(opt) {
    const evt = opt.e;
    if (evt.altKey === true) {
      isDragging = true;
      lastPosX = evt.clientX;
      lastPosY = evt.clientY;
      canvas.selection = false;
    }
  });
  
  canvas.on('mouse:move', function(opt) {
    if (isDragging) {
      const evt = opt.e;
      const vpt = canvas.viewportTransform;
      vpt[4] += evt.clientX - lastPosX;
      vpt[5] += evt.clientY - lastPosY;
      canvas.requestRenderAll();
      lastPosX = evt.clientX;
      lastPosY = evt.clientY;
    }
  });
  
  canvas.on('mouse:up', function() {
    isDragging = false;
    canvas.selection = true;
  });
  
  // Object selection event
  canvas.on('selection:created', function(opt) {
    const selectedObject = opt.selected[0];
    if (selectedObject && selectedObject.objectType === 'annotation') {
      // Update object type selector if available
      const objectTypeSelect = document.getElementById('objectTypeSelect');
      if (objectTypeSelect && selectedObject.labelId !== undefined) {
        objectTypeSelect.value = selectedObject.labelId;
      }
    }
  });
}

/**
 * Sync with global zoom functionality
 * @param {number} zoomLevel - Current global zoom level
 */
export function syncEditorZoom(zoomLevel) {
  if (!canvas) return;
  
  console.log(`Syncing fabric canvas zoom to ${zoomLevel}`);
  
  // First, calculate the base scale (displayed size / natural size)
  const baseScaleX = uploadedImage.offsetWidth / uploadedImage.naturalWidth;
  const baseScaleY = uploadedImage.offsetHeight / uploadedImage.naturalHeight;
  
  // Apply combined scaling (base scale * zoom level)
  const newZoom = baseScaleX * zoomLevel;
  canvas.setZoom(newZoom);
  
  // Update container sizes if needed
  if (canvas.wrapperEl) {
    canvas.wrapperEl.style.width = `${uploadedImage.offsetWidth * zoomLevel}px`;
    canvas.wrapperEl.style.height = `${uploadedImage.offsetHeight * zoomLevel}px`;
  }
  
  canvas.renderAll();
}

/**
 * Get the current Fabric.js canvas instance
 * @returns {fabric.Canvas} The canvas instance
 */
export function getCanvas() {
  return canvas;
}

/**
 * Get the current zoom level
 * @returns {number} The current zoom level
 */
export function getCurrentZoom() {
  return currentZoom;
}

/**
 * Set the current labels for annotations
 * @param {Array} labels - The labels configuration
 */
export function setLabels(labels) {
  currentLabels = labels;
}

/**
 * Set the current line labels for annotations
 * @param {Array} labels - The line labels configuration
 */
export function setLineLabels(labels) {
  currentLineLabels = labels;
}

/**
 * Clear all annotations from the canvas
 */
export function clearAnnotations() {
  if (!canvas) return;
  canvas.clear();
}

/**
 * Reset zoom and pan to default values
 */
export function resetView() {
  if (!canvas) return;
  currentZoom = 1.0;
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
}

/**
 * Add a rectangle annotation to the canvas
 * @param {Object} data - The annotation data
 * @param {number} index - The annotation index
 * @returns {Object} The created fabric objects
 */
export function addRectangleAnnotation(data, index) {
  if (!canvas) return null;
  
  // Extract data
  const [x1, y1, x2, y2] = data.box || data.bbox;
  const width = x2 - x1;
  const height = y2 - y1;
  const labelId = data.label || 0;
    
  // Get color and label name from LabelsManager if available
  let color = 'gray';
  let label_name = 'Other';
  
  if (window.LabelsManager) {
    color = window.LabelsManager.getLabelColor(labelId, 'area');
    label_name = window.LabelsManager.getLabelName(labelId, 'area');
  } else {
    // Fallback colors
    switch (labelId) {
      case 1: color = 'blue'; label_name = 'Fenster'; break;
      case 2: color = 'red'; label_name = 'Tür'; break;
      case 3: color = '#d4d638'; label_name = 'Wand'; break;
      case 4: color = 'orange'; label_name = 'Lukarne'; break;
      case 5: color = 'purple'; label_name = 'Dach'; break;
    }
  }
    
  // Create rectangle
  const rect = new fabric.Rect({
    left: x1,
    top: y1,
    width: width,
    height: height,
    fill: color + '20', // 20% opacity
    stroke: color,
    strokeWidth: 2,
    objectType: 'annotation',
    annotationType: 'rectangle',
    annotationIndex: index,
    originalData: { ...data },
    labelId: labelId,
    labelName: label_name,
    area: data.area || 0
  });
    
  // Add rectangle to canvas
  canvas.add(rect);
    
  // Create text label
  const labelText = `#${index + 1}: ${(data.area || 0).toFixed(2)} m²`;
  const text = new fabric.Text(labelText, {
    left: x1,
    top: y1 - 20,
    fontSize: 12,
    fill: 'white',
    backgroundColor: color,
    padding: 5,
    objectType: 'label',
    annotationIndex: index,
    textBaseline: 'alphabetic'
  });
    
  // Add text to canvas
  canvas.add(text);
  canvas.bringToFront(text);
    
  // Return objects
  return { rect, text };
}

/**
 * Add a polygon annotation to the canvas
 * @param {Object} data - The annotation data
 * @param {number} index - The annotation index
 * @returns {Object} The created fabric objects
 */
export function addPolygonAnnotation(data, index) {
  if (!canvas) return null;
  
  let points = [];
  
  // Extract data - support multiple polygon formats
  if (data.polygon && (data.polygon.all_points_x || data.polygon.all_points_y)) {
    // Format: {polygon: {all_points_x: [...], all_points_y: [...]}}
    const { all_points_x, all_points_y } = data.polygon;
    
    // Validate polygon data
    if (!all_points_x || !all_points_y || all_points_x.length < 3) {
      console.warn("Invalid polygon data:", data);
      return null;
    }
    
    // Create points array
    for (let i = 0; i < all_points_x.length; i++) {
      points.push({
        x: all_points_x[i],
        y: all_points_y[i]
      });
    }
  } else if (data.points) {
    // Format: {points: [{x: ..., y: ...}, ...]}
    points = data.points;
  } else {
    console.warn("Unsupported polygon format:", data);
    return null;
  }
  
  const labelId = data.label || 0;
  
  // Get color and label name
  let color = 'gray';
  let label_name = 'Other';
  
  if (window.LabelsManager) {
    color = window.LabelsManager.getLabelColor(labelId, 'area');
    label_name = window.LabelsManager.getLabelName(labelId, 'area');
  } else {
    // Fallback colors
    switch (labelId) {
      case 1: color = 'blue'; label_name = 'Fenster'; break;
      case 2: color = 'red'; label_name = 'Tür'; break;
      case 3: color = '#d4d638'; label_name = 'Wand'; break;
      case 4: color = 'orange'; label_name = 'Lukarne'; break;
      case 5: color = 'purple'; label_name = 'Dach'; break;
    }
  }
  
  // Create polygon
  const polygon = new fabric.Polygon(points, {
    fill: color + '20', // 20% opacity
    stroke: color,
    strokeWidth: 2,
    objectType: 'annotation',
    annotationType: 'polygon',
    annotationIndex: index,
    originalData: { ...data },
    labelId: labelId,
    labelName: label_name,
    area: data.area || 0
  });
  
  // Add polygon to canvas
  canvas.add(polygon);
  
  // Calculate centroid for label positioning
  let centerX = 0, centerY = 0;
  for (let i = 0; i < points.length; i++) {
    centerX += points[i].x;
    centerY += points[i].y;
  }
  centerX /= points.length;
  centerY /= points.length;
  
  // Create text label
  const labelText = `#${index + 1}: ${(data.area || 0).toFixed(2)} m²`;
  const text = new fabric.Text(labelText, {
    left: centerX,
    top: centerY - 20,
    fontSize: 12,
    fill: 'white',
    backgroundColor: color,
    padding: 5,
    objectType: 'label',
    annotationIndex: index,
    textBaseline: 'alphabetic'
  });
  
  // Add text to canvas
  canvas.add(text);
  canvas.bringToFront(text);
  
  // Return objects
  return { polygon, text };
}

/**
 * Add a line annotation to the canvas
 * @param {Object} data - The annotation data
 * @param {number} index - The annotation index
 * @returns {Object} The created fabric objects
 */
export function addLineAnnotation(data, index) {
  if (!canvas) return null;
  
  let points = [];
  
  // Extract data - support multiple line formats
  if (data.line && (data.line.all_points_x || data.line.all_points_y)) {
    // Format: {line: {all_points_x: [...], all_points_y: [...]}}
    const { all_points_x, all_points_y } = data.line;
    
    // Validate line data
    if (!all_points_x || !all_points_y || all_points_x.length < 2) {
      console.warn("Invalid line data:", data);
      return null;
    }
    
    // Create points array
    for (let i = 0; i < all_points_x.length; i++) {
      points.push({
        x: all_points_x[i],
        y: all_points_y[i]
      });
    }
  } else if (data.points) {
    // Format: {points: [{x: ..., y: ...}, ...]}
    points = data.points;
  } else {
    console.warn("Unsupported line format:", data);
    return null;
  }
  
  const labelId = data.lineType || 1;
  
  // Get color from line labels
  let color = '#FF9500'; // Default orange
  let label_name = 'Strecke';
  
  if (window.LabelsManager) {
    color = window.LabelsManager.getLabelColor(labelId, 'line');
    label_name = window.LabelsManager.getLabelName(labelId, 'line');
  }
  
  // Create polyline
  const line = new fabric.Polyline(points, {
    fill: '',
    stroke: color,
    strokeWidth: 2,
    objectType: 'annotation',
    annotationType: 'line',
    annotationIndex: index,
    originalData: { ...data },
    lineType: labelId,
    lineName: label_name,
    length: data.length || 0
  });
  
  // Add line to canvas
  canvas.add(line);
  
  // Add circles at line points
  const circles = [];
  for (let i = 0; i < points.length; i++) {
    const circle = new fabric.Circle({
      left: points[i].x - 4, // Adjust for radius
      top: points[i].y - 4,  // Adjust for radius
      radius: 4,
      fill: color,
      stroke: '#fff',
      strokeWidth: 1,
      objectType: 'linePoint',
      lineIndex: index,
      pointIndex: i
    });
    canvas.add(circle);
    circles.push(circle);
  }
  
  // Get last point for text positioning
  const lastPoint = points[points.length - 1];
  
  // Create text label
  const labelText = `${(data.length || 0).toFixed(2)} m`;
  const text = new fabric.Text(labelText, {
    left: lastPoint.x + 5,
    top: lastPoint.y - 15,
    fontSize: 12,
    fill: color,
    objectType: 'label',
    annotationIndex: index,
    textBaseline: 'alphabetic'
  });
  
  // Add text to canvas
  canvas.add(text);
  canvas.bringToFront(text);
  
  // Return objects
  return { line, circles, text };
}

/**
 * Add an annotation to the canvas based on its type
 * @param {Object} prediction - The prediction data
 * @param {number} index - The prediction index
 */
export function addAnnotation(prediction, index) {
  if (!canvas) return;
  
  // Determine annotation type
  if (prediction.type === "line" || (prediction.line !== undefined)) {
    return addLineAnnotation(prediction, index);
  } else if (prediction.type === "polygon" || prediction.polygon !== undefined) {
    return addPolygonAnnotation(prediction, index);
  } else if (prediction.box !== undefined || prediction.bbox !== undefined) {
    return addRectangleAnnotation(prediction, index);
  } else {
    console.warn("Unknown annotation type:", prediction);
  }
}

/**
 * Display annotations from prediction data
 * @param {Array} predictions - The predictions data
 */
export function displayAnnotations(predictions) {
  if (!canvas) {
    // Initialize canvas if it doesn't exist
    initCanvas();
  }
  
  if (!canvas || !predictions) {
    console.warn("Cannot display annotations: canvas or predictions missing");
    return;
  }
  
  console.log(`Displaying ${predictions.length} annotations`);
  
  // Clear canvas
  clearAnnotations();
  
  // Add each annotation with debug info
  predictions.forEach((prediction, index) => {
    console.log(`Adding annotation #${index}: Type: ${prediction.type || 'unknown'}, Label: ${prediction.label || 'unknown'}`);
    
    const result = addAnnotation(prediction, index);
    if (!result) {
      console.warn(`Failed to add annotation #${index}`);
    }
  });
  
  // Render canvas and make sure all objects are visible
  canvas.renderAll();
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]); // Reset transform
  
  // Log final object count
  console.log(`Canvas now has ${canvas.getObjects().length} objects`);
}

/**
 * Convert annotations from fabric.js objects back to prediction format
 * @returns {Array} Array of prediction objects
 */
export function getAnnotationsData() {
  if (!canvas) return [];
  
  const annotations = [];
  
  // Get all annotation objects
  const objects = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  
  // Convert each object to prediction format
  objects.forEach(obj => {
    if (obj.annotationType === 'rectangle') {
      // Rectangle format
      const x1 = obj.left;
      const y1 = obj.top;
      const x2 = obj.left + obj.width;
      const y2 = obj.top + obj.height;
      
      annotations.push({
        box: [x1, y1, x2, y2],
        label: obj.labelId,
        label_name: obj.labelName,
        type: 'rectangle',
        area: calculateRectangleArea(obj.width, obj.height),
        score: obj.originalData?.score || 1.0
      });
    } else if (obj.annotationType === 'polygon') {
      // Polygon format
      const points = obj.points;
      const all_points_x = points.map(p => p.x);
      const all_points_y = points.map(p => p.y);
      
      annotations.push({
        polygon: {
          all_points_x,
          all_points_y
        },
        label: obj.labelId,
        label_name: obj.labelName,
        type: 'polygon',
        area: calculatePolygonArea(points),
        score: obj.originalData?.score || 1.0
      });
    } else if (obj.annotationType === 'line') {
      // Line format
      const points = obj.points;
      const all_points_x = points.map(p => p.x);
      const all_points_y = points.map(p => p.y);
      
      annotations.push({
        line: {
          all_points_x,
          all_points_y
        },
        type: 'line',
        lineType: obj.lineType || 1,
        length: calculateLineLength(points),
        score: obj.originalData?.score || 1.0
      });
    }
  });
  
  return annotations;
}

/**
 * Calculate rectangle area in square meters
 * @param {number} width - Width in pixels
 * @param {number} height - Height in pixels
 * @returns {number} Area in square meters
 */
function calculateRectangleArea(width, height) {
  // Get current settings
  const planScale = parseInt(document.getElementById('planScale').value || 100);
  const dpi = parseInt(document.getElementById('dpi').value || 300);
  
  // Calculate pixels per meter
  const pixelsPerInch = dpi;
  const pixelsPerMm = pixelsPerInch / 25.4;
  const pixelsPerMeter = pixelsPerMm * (1000 / planScale);
  
  // Convert to square meters
  const widthMeters = width / pixelsPerMeter;
  const heightMeters = height / pixelsPerMeter;
  
  return widthMeters * heightMeters;
}

/**
 * Calculate polygon area in square meters
 * @param {Array} points - Array of {x,y} points
 * @returns {number} Area in square meters
 */
function calculatePolygonArea(points) {
  // Get current settings
  const planScale = parseInt(document.getElementById('planScale').value || 100);
  const dpi = parseInt(document.getElementById('dpi').value || 300);
  
  // Calculate pixels per meter
  const pixelsPerInch = dpi;
  const pixelsPerMm = pixelsPerInch / 25.4;
  const pixelsPerMeter = pixelsPerMm * (1000 / planScale);
  
  // Use Shoelace formula to calculate area in pixels
  let area = 0;
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  
  area = Math.abs(area) / 2;
  
  // Convert to square meters
  return area / (pixelsPerMeter * pixelsPerMeter);
}

/**
 * Calculate line length in meters
 * @param {Array} points - Array of {x,y} points
 * @returns {number} Length in meters
 */
function calculateLineLength(points) {
  if (points.length < 2) return 0;
  
  // Get current settings
  const planScale = parseInt(document.getElementById('planScale').value || 100);
  const dpi = parseInt(document.getElementById('dpi').value || 300);
  
  // Calculate pixels per meter
  const pixelsPerInch = dpi;
  const pixelsPerMm = pixelsPerInch / 25.4;
  const pixelsPerMeter = pixelsPerMm * (1000 / planScale);
  
  // Calculate length
  let totalLength = 0;
  
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i+1].x - points[i].x;
    const dy = points[i+1].y - points[i].y;
    const segmentLength = Math.sqrt(dx*dx + dy*dy);
    totalLength += segmentLength;
  }
  
  // Convert to meters
  return totalLength / pixelsPerMeter;
}

/**
 * Highlight an object by its annotation index
 * @param {number} index - The annotation index
 * @param {boolean} isHighlighted - Whether to highlight or unhighlight
 */
export function highlightObject(index, isHighlighted) {
  if (!canvas) return;
  
  // Find object with matching annotationIndex
  const objects = canvas.getObjects();
  const targetObj = objects.find(obj => obj.objectType === 'annotation' && obj.annotationIndex === index);
  
  if (targetObj) {
    if (isHighlighted) {
      targetObj.set({
        strokeWidth: 4,
        opacity: 0.8
      });
    } else {
      targetObj.set({
        strokeWidth: 2,
        opacity: 1.0
      });
    }
    canvas.renderAll();
  }
}

/**
 * Select an object by its annotation index
 * @param {number} index - The annotation index
 */
export function selectObjectByIndex(index) {
  if (!canvas) return;
  
  // Find object with matching annotationIndex
  const objects = canvas.getObjects();
  const targetObj = objects.find(obj => obj.objectType === 'annotation' && obj.annotationIndex === index);
  
  if (targetObj) {
    canvas.setActiveObject(targetObj);
    canvas.renderAll();
  }
}

/**
 * Toggle visibility of objects by label ID
 * @param {number} labelId - The label ID
 * @param {boolean} isVisible - Whether objects should be visible
 */
export function toggleObjectsByLabel(labelId, isVisible) {
  if (!canvas) return;
  
  // Find all objects with this label
  canvas.getObjects().forEach(obj => {
    if (obj.objectType === 'annotation' && obj.labelId === labelId) {
      obj.visible = isVisible;
      
      // Also toggle associated labels
      const objIndex = obj.annotationIndex;
      canvas.getObjects().forEach(o => {
        if (o.objectType === 'label' && o.annotationIndex === objIndex) {
          o.visible = isVisible;
        }
      });
    }
  });
  
  canvas.renderAll();
}

/**
 * Enable object selection and editing
 */
export function enableEditing() {
  if (!canvas) return;
  
  // Enable object selection
  canvas.forEachObject(function(obj) {
    if (obj.objectType === 'annotation') {
      obj.selectable = true;
      obj.evented = true;
    }
  });
  
  // Allow selection, movement, scaling, rotation
  canvas.selection = true;
  
  // Update cursor
  canvas.defaultCursor = 'default';
  canvas.hoverCursor = 'move';
  
  canvas.renderAll();
}

/**
 * Disable object selection and editing
 */
export function disableEditing() {
  if (!canvas) return;
  
  // Disable object selection
  canvas.forEachObject(function(obj) {
    obj.selectable = false;
    obj.evented = false;
  });
  
  // Disable selection
  canvas.selection = false;
  
  // Update cursor
  canvas.defaultCursor = 'default';
  canvas.hoverCursor = 'default';
  
  canvas.renderAll();
}

/**
 * Delete the currently selected object
 */
export function deleteSelected() {
  if (!canvas) return;
  
  const activeObject = canvas.getActiveObject();
  
  if (activeObject) {
    // If grouped selection, delete all
    if (activeObject.type === 'activeSelection') {
      activeObject.forEachObject(function(obj) {
        canvas.remove(obj);
      });
    } else {
      // For rectangle and polygon, also delete associated label
      if (activeObject.objectType === 'annotation') {
        const objIndex = activeObject.annotationIndex;
        
        // Delete labels
        canvas.getObjects().forEach(obj => {
          if (obj.objectType === 'label' && obj.annotationIndex === objIndex) {
            canvas.remove(obj);
          }
          
          // Delete line points if it's a line
          if (activeObject.annotationType === 'line' && obj.objectType === 'linePoint' && obj.lineIndex === objIndex) {
            canvas.remove(obj);
          }
        });
      }
      
      // Delete the object itself
      canvas.remove(activeObject);
    }
    
    canvas.discardActiveObject();
    canvas.renderAll();
  }
}

/**
 * Copy the currently selected object
 */
export function copySelected() {
  if (!canvas) return;
  
  const activeObject = canvas.getActiveObject();
  
  if (activeObject) {
    // Clone the object
    activeObject.clone(function(cloned) {
      // If it's a group (multiple selection)
      if (activeObject.type === 'activeSelection') {
        // Create new array for the group
        const clonedObjects = [];
        
        // Clone each object in the group
        activeObject.forEachObject(function(obj) {
          obj.clone(function(clonedObj) {
            // Offset the position slightly
            clonedObj.set({
              left: clonedObj.left + 20,
              top: clonedObj.top + 20
            });
            
            canvas.add(clonedObj);
            clonedObjects.push(clonedObj);
          });
        });
        
        // Create new selection with cloned objects
        const selection = new fabric.ActiveSelection(clonedObjects, {
          canvas: canvas
        });
        
        canvas.setActiveObject(selection);
      } else {
        // Offset the position slightly
        cloned.set({
          left: cloned.left + 20,
          top: cloned.top + 20
        });
        
        canvas.add(cloned);
        canvas.setActiveObject(cloned);
      }
      
      canvas.renderAll();
    });
  }
}

/**
 * Change the label of the selected annotation
 * @param {number} labelId - The new label ID
 */
export function changeSelectedLabel(labelId) {
  if (!canvas) return;
  
  const activeObject = canvas.getActiveObject();
  
  if (activeObject && activeObject.objectType === 'annotation') {
    // Get the label information
    const label = window.LabelsManager.getLabelById(labelId, 'area');
    
    if (label) {
      // Update object properties
      activeObject.set({
        labelId: labelId,
        labelName: label.name,
        stroke: label.color,
        fill: label.color + '20' // 20% opacity
      });
      
      // Find and update associated label
      canvas.getObjects().forEach(function(obj) {
        if (obj.objectType === 'label' && obj.annotationIndex === activeObject.annotationIndex) {
          obj.set({
            backgroundColor: label.color
          });
        }
      });
      
      // Render changes
      canvas.renderAll();
    }
  }
}

/**
 * Change the type of a selected line
 * @param {number} typeId - The new line type ID
 */
export function changeSelectedLineType(typeId) {
  if (!canvas) return;
  
  const activeObject = canvas.getActiveObject();
  
  if (activeObject && activeObject.objectType === 'annotation' && activeObject.annotationType === 'line') {
    // Get the line label information
    const lineLabel = window.LabelsManager.getLabelById(typeId, 'line');
    
    if (lineLabel) {
      const color = lineLabel.color;
      
      // Update line properties
      activeObject.set({
        lineType: typeId,
        lineName: lineLabel.name,
        stroke: color
      });
      
      // Find and update associated points and label
      canvas.getObjects().forEach(function(obj) {
        if (obj.objectType === 'linePoint' && obj.lineIndex === activeObject.annotationIndex) {
          obj.set({
            fill: color
          });
        }
        
        if (obj.objectType === 'label' && obj.annotationIndex === activeObject.annotationIndex) {
          obj.set({
            fill: color
          });
        }
      });
      
      // Render changes
      canvas.renderAll();
    }
  }
}

/**
 * Enable drawing mode for creating new annotations
 * @param {string} type - The type of annotation to create ('rectangle', 'polygon', 'line')
 * @param {number} labelId - The label ID to assign to new annotations
 */
export function enableDrawingMode(type, labelId) {
  if (!canvas) {
    initCanvas();
  }
  
  if (!canvas) return;
  
  // Disable selection
  disableEditing();
  
  // Set cursor
  canvas.defaultCursor = 'crosshair';
  
  // Remove existing drawing event handlers
  canvas.off('mouse:down');
  canvas.off('mouse:move');
  canvas.off('mouse:up');
  
  // Set up drawing handlers based on type
  if (type === 'rectangle') {
    enableRectangleDrawing(labelId);
  } else if (type === 'polygon') {
    enablePolygonDrawing(labelId);
  } else if (type === 'line') {
    enableLineDrawing(labelId);
  }
}

/**
 * Enable rectangle drawing mode
 * @param {number} labelId - The label ID to assign
 */
function enableRectangleDrawing(labelId) {
  let startX, startY;
  let rect;
  
  // Mouse down handler
  canvas.on('mouse:down', function(o) {
    const pointer = canvas.getPointer(o.e);
    startX = pointer.x;
    startY = pointer.y;
    
    // Get color and label name
    const color = window.LabelsManager.getLabelColor(labelId, 'area');
    const labelName = window.LabelsManager.getLabelName(labelId, 'area');
    
    // Create rectangle
    rect = new fabric.Rect({
      left: startX,
      top: startY,
      width: 0,
      height: 0,
      fill: color + '20',
      stroke: color,
      strokeWidth: 2,
      objectType: 'annotation',
      annotationType: 'rectangle',
      labelId: labelId,
      labelName: labelName
    });
    
    canvas.add(rect);
    canvas.renderAll();
  });
  
  // Mouse move handler
  canvas.on('mouse:move', function(o) {
    if (!rect) return;
    
    const pointer = canvas.getPointer(o.e);
    
    // Set width and height based on mouse position
    if (startX > pointer.x) {
      rect.set({ left: pointer.x });
    }
    if (startY > pointer.y) {
      rect.set({ top: pointer.y });
    }
    
    rect.set({
      width: Math.abs(startX - pointer.x),
      height: Math.abs(startY - pointer.y)
    });
    
    canvas.renderAll();
  });
  
  // Mouse up handler
  canvas.on('mouse:up', function() {
    if (!rect) return;
    
    // Calculate area
    const area = calculateRectangleArea(rect.width, rect.height);
    rect.area = area;
    
    // Set annotation index
    const annotationIndex = canvas.getObjects().filter(obj => obj.objectType === 'annotation').length - 1;
    rect.annotationIndex = annotationIndex;
    
    // Create label text
    const labelText = `#${annotationIndex + 1}: ${area.toFixed(2)} m²`;
    
    // Get color
    const color = window.LabelsManager.getLabelColor(labelId, 'area');
    
    // Create text
    const text = new fabric.Text(labelText, {
      left: rect.left,
      top: rect.top - 20,
      fontSize: 12,
      fill: 'white',
      backgroundColor: color,
      padding: 5,
      objectType: 'label',
      annotationIndex: annotationIndex,
      textBaseline: 'alphabetic'
    });
    
    // Add text
    canvas.add(text);
    canvas.bringToFront(text);
    
    // Reset for next rectangle
    rect = null;
    canvas.renderAll();
  });
}

/**
 * Enable polygon drawing mode
 * @param {number} labelId - The label ID to assign
 */
function enablePolygonDrawing(labelId) {
  let points = [];
  let polygon = null;
  let activeLine = null;
  let activeShape = false;
  
  // Get color for the label
  const color = window.LabelsManager.getLabelColor(labelId, 'area');
  const labelName = window.LabelsManager.getLabelName(labelId, 'area');
  
  // Mouse down handler
  canvas.on('mouse:down', function(o) {
    const pointer = canvas.getPointer(o.e);
    
    // Check if double click to close polygon
    if (points.length > 2 && Math.abs(pointer.x - points[0].x) < 20 && Math.abs(pointer.y - points[0].y) < 20) {
      // Close the polygon
      generatePolygon(points);
      
      // Reset for next polygon
      points = [];
      polygon = null;
      activeLine = null;
      activeShape = false;
      
      // Remove all temporary objects
      canvas.getObjects().forEach(function(obj) {
        if (obj.temp) {
          canvas.remove(obj);
        }
      });
      
      canvas.renderAll();
      return;
    }
    
    // Add new point
    points.push({ x: pointer.x, y: pointer.y });
    
    // Create circle for the point
    const circle = new fabric.Circle({
      radius: 5,
      fill: color,
      stroke: '#fff',
      strokeWidth: 1,
      left: pointer.x - 5,
      top: pointer.y - 5,
      originX: 'center',
      originY: 'center',
      temp: true
    });
    
    // If there are already 2 or more points, create a line
    if (points.length > 1) {
      if (activeLine) {
        // Update the last line
        activeLine.set({
          x2: pointer.x,
          y2: pointer.y
        });
      }
      
      // Create a new line
      const line = new fabric.Line([
        points[points.length - 2].x,
        points[points.length - 2].y,
        pointer.x,
        pointer.y
      ], {
        stroke: color,
        strokeWidth: 2,
        temp: true
      });
      
      activeLine = line;
      canvas.add(line);
    }
    
    canvas.add(circle);
    
    // Create or update the active shape (polygon)
    if (points.length > 2) {
      if (activeShape) {
        canvas.remove(activeShape);
      }
      
      activeShape = new fabric.Polygon(points, {
        fill: color + '20',
        stroke: color,
        strokeWidth: 2,
        temp: true
      });
      
      canvas.add(activeShape);
      activeShape.moveTo(-1); // Move to background
    }
    
    canvas.renderAll();
  });
  
  // Function to generate the final polygon
  function generatePolygon(pointsList) {
    // Create the polygon with the collected points
    const annotationIndex = canvas.getObjects().filter(obj => obj.objectType === 'annotation').length;
    
    const finalPolygon = new fabric.Polygon(pointsList, {
      fill: color + '20',
      stroke: color,
      strokeWidth: 2,
      objectType: 'annotation',
      annotationType: 'polygon',
      annotationIndex: annotationIndex,
      labelId: labelId,
      labelName: labelName
    });
    
    // Calculate area
    const area = calculatePolygonArea(pointsList);
    finalPolygon.area = area;
    
    canvas.add(finalPolygon);
    
    // Calculate centroid for label position
    let centerX = 0, centerY = 0;
    for (let i = 0; i < pointsList.length; i++) {
      centerX += pointsList[i].x;
      centerY += pointsList[i].y;
    }
    centerX /= pointsList.length;
    centerY /= pointsList.length;
    
    // Create label
    const labelText = `#${annotationIndex + 1}: ${area.toFixed(2)} m²`;
    const text = new fabric.Text(labelText, {
      left: centerX,
      top: centerY - 20,
      fontSize: 12,
      fill: 'white',
      backgroundColor: color,
      padding: 5,
      objectType: 'label',
      annotationIndex: annotationIndex,
      textBaseline: 'alphabetic'
    });
    
    canvas.add(text);
    canvas.bringToFront(text);
    
    canvas.renderAll();
  }
}

/**
 * Enable line drawing mode
 * @param {number} labelId - The line type ID to assign
 */
function enableLineDrawing(labelId) {
  let points = [];
  let line = null;
  let activeLine = null;
  
  // Get color for the line type
  const color = window.LabelsManager.getLabelColor(labelId, 'line');
  const lineName = window.LabelsManager.getLabelName(labelId, 'line');
  
  // Mouse down handler
  canvas.on('mouse:down', function(o) {
    const pointer = canvas.getPointer(o.e);
    
    // Add new point
    points.push({ x: pointer.x, y: pointer.y });
    
    // Create circle for the point
    const circle = new fabric.Circle({
      radius: 5,
      fill: color,
      stroke: '#fff',
      strokeWidth: 1,
      left: pointer.x - 5,
      top: pointer.y - 5,
      originX: 'center',
      originY: 'center',
      temp: true
    });
    
    canvas.add(circle);
    
    // If there are already 2 or more points
    if (points.length > 1) {
      // If there's an active line, remove it
      if (activeLine) {
        canvas.remove(activeLine);
      }
      
      // Create a polyline with all points
      line = new fabric.Polyline(points, {
        fill: '',
        stroke: color,
        strokeWidth: 2,
        temp: true
      });
      
      canvas.add(line);
      
      // Double click to end line
      if (points.length > 1 && 
          Math.abs(pointer.x - points[points.length - 2].x) < 20 && 
          Math.abs(pointer.y - points[points.length - 2].y) < 20) {
        
        // Remove the last point (duplicate)
        points.pop();
        
        // Finish the line
        generateLine(points);
        
        // Reset for next line
        points = [];
        line = null;
        activeLine = null;
        
        // Remove all temporary objects
        canvas.getObjects().forEach(function(obj) {
          if (obj.temp) {
            canvas.remove(obj);
          }
        });
        
        canvas.renderAll();
      }
    }
    
    canvas.renderAll();
  });
  
  // Function to generate the final line
  function generateLine(pointsList) {
    const annotationIndex = canvas.getObjects().filter(obj => obj.objectType === 'annotation').length;
    
    const finalLine = new fabric.Polyline(pointsList, {
      fill: '',
      stroke: color,
      strokeWidth: 2,
      objectType: 'annotation',
      annotationType: 'line',
      annotationIndex: annotationIndex,
      lineType: labelId,
      lineName: lineName
    });
    
    // Calculate length
    const length = calculateLineLength(pointsList);
    finalLine.length = length;
    
    canvas.add(finalLine);
    
    // Add circles at each point
    const circles = [];
    for (let i = 0; i < pointsList.length; i++) {
      const circle = new fabric.Circle({
        left: pointsList[i].x - 4,
        top: pointsList[i].y - 4,
        radius: 4,
        fill: color,
        stroke: '#fff',
        strokeWidth: 1,
        objectType: 'linePoint',
        lineIndex: annotationIndex,
        pointIndex: i
      });
      
      canvas.add(circle);
      circles.push(circle);
    }
    
    // Get last point for label
    const lastPoint = pointsList[pointsList.length - 1];
    
    // Create label
    const labelText = `${length.toFixed(2)} m`;
    const text = new fabric.Text(labelText, {
      left: lastPoint.x + 5,
      top: lastPoint.y - 15,
      fontSize: 12,
      fill: color,
      objectType: 'label',
      annotationIndex: annotationIndex,
      textBaseline: 'alphabetic'
    });
    
    canvas.add(text);
    canvas.bringToFront(text);
    
    canvas.renderAll();
  }
}

/**
 * Save all annotations to the current data format
 */
export function saveAnnotations() {
  if (!canvas) return;
  
  // Get all annotations
  const annotations = getAnnotationsData();
  
  // Update window.data.predictions
  if (window.data) {
    window.data.predictions = annotations;
    
    // Update counts and totals
    updateDataSummary();
  }
  
  // If we have PDF page data
  if (typeof window.updatePdfPageData === 'function') {
    window.updatePdfPageData(window.data);
  }
}

/**
 * Update summary data (counts and areas)
 */
function updateDataSummary() {
  if (!window.data) return;
  
  // Reset counts and areas
  const counts = {
    fenster: 0,
    tuer: 0,
    wand: 0,
    lukarne: 0,
    dach: 0,
    other: 0,
    line: 0
  };
  
  const areas = {
    fenster: 0,
    tuer: 0,
    wand: 0,
    lukarne: 0,
    dach: 0,
    other: 0
  };
  
  // Count and sum areas
  window.data.predictions.forEach(pred => {
    if (pred.type === 'line') {
      counts.line++;
    } else {
      switch (pred.label) {
        case 1:
          counts.fenster++;
          areas.fenster += pred.area || 0;
          break;
        case 2:
          counts.tuer++;
          areas.tuer += pred.area || 0;
          break;
        case 3:
          counts.wand++;
          areas.wand += pred.area || 0;
          break;
        case 4:
          counts.lukarne++;
          areas.lukarne += pred.area || 0;
          break;
        case 5:
          counts.dach++;
          areas.dach += pred.area || 0;
          break;
        default:
          counts.other++;
          areas.other += pred.area || 0;
      }
    }
  });
  
  // Update data
  window.data.count = counts;
  window.data.total_area = areas;
  
  // Update UI if needed
  if (typeof window.updateSummary === 'function') {
    window.updateSummary();
  }
  
  if (typeof window.updateResultsTable === 'function') {
    window.updateResultsTable();
  }
}

/**
 * Cancel editing and restore original annotations
 */
export function cancelEditing() {
  if (!canvas) return;
  
  // Reload original data
  if (window.data && window.data.predictions) {
    displayAnnotations(window.data.predictions);
  }
  
  // Disable editing
  disableEditing();
}

// Expose functions through window.FabricHandler
window.FabricHandler = {
  // Canvas management
  initCanvas,
  getCanvas,
  clearAnnotations,
  resetView,
  
  // Drawing and editing
  enableDrawingMode,
  enableEditing,
  disableEditing,
  saveAnnotations,
  cancelEditing,
  
  // Object manipulation
  deleteSelected,
  copySelected,
  changeSelectedLabel,
  changeSelectedLineType,
  
  // Annotation display
  displayAnnotations,
  highlightObject,
  selectObjectByIndex,
  toggleObjectsByLabel,
  
  // Utilities
  getCurrentZoom,
  setLabels,
  setLineLabels,
  syncEditorZoom
};