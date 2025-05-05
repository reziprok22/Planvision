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

/**
 * Initialize the Fabric.js handler with required DOM elements
 * @param {Object} elements - Object containing DOM references
 */
export function setupFabricHandler(elements) {
  // Store DOM references
  imageContainer = elements.imageContainer;
  uploadedImage = elements.uploadedImage;
  
  // Initialize Fabric.js canvas
  initCanvas();
  
  // Set up event listeners
  setupEventListeners();
  
  console.log('Fabric.js handler initialized');
}

/**
 * Initialize the Fabric.js canvas
 */
function initCanvas() {
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
  
  // Add window resize handler
  window.addEventListener('resize', resizeCanvas);
}

/**
 * Resize canvas to match container size
 */
function resizeCanvas() {
  if (!canvas || !imageContainer) return;
  
  // Make sure uploadedImage is loaded before setting dimensions
  if (uploadedImage.complete) {
    canvas.setWidth(uploadedImage.width);
    canvas.setHeight(uploadedImage.height);
  } else {
    uploadedImage.onload = function() {
      canvas.setWidth(uploadedImage.width);
      canvas.setHeight(uploadedImage.height);
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
    const delta = opt.e.deltaY;
    let zoom = canvas.getZoom();
    zoom *= 0.999 ** delta;
    
    // Set zoom limits
    if (zoom > 10) zoom = 10;
    if (zoom < 0.1) zoom = 0.1;
    
    // Store current zoom
    currentZoom = zoom;
    
    // Zoom to point where mouse is
    canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
    
    // Update UI indicator if available
    updateZoomIndicator(zoom);
    
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
}

/**
 * Update zoom indicator UI element if it exists
 * @param {number} zoom - Current zoom level
 */
function updateZoomIndicator(zoom) {
  // Check if zoom indicator exists
  let zoomIndicator = document.getElementById('zoomIndicator');
  
  if (!zoomIndicator) {
    // Create indicator if it doesn't exist
    zoomIndicator = document.createElement('div');
    zoomIndicator.id = 'zoomIndicator';
    zoomIndicator.style.position = 'fixed';
    zoomIndicator.style.bottom = '20px';
    zoomIndicator.style.right = '20px';
    zoomIndicator.style.padding = '8px 12px';
    zoomIndicator.style.background = 'rgba(0, 0, 0, 0.7)';
    zoomIndicator.style.color = 'white';
    zoomIndicator.style.borderRadius = '4px';
    zoomIndicator.style.fontSize = '14px';
    zoomIndicator.style.zIndex = '1000';
    zoomIndicator.style.transition = 'opacity 1s';
    document.body.appendChild(zoomIndicator);
  }
  
  // Update text
  zoomIndicator.textContent = `Zoom: ${Math.round(zoom * 100)}%`;
  zoomIndicator.style.opacity = '1';
  
  // Hide after delay
  clearTimeout(zoomIndicator.timeout);
  zoomIndicator.timeout = setTimeout(() => {
    zoomIndicator.style.opacity = '0';
  }, 2000);
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
  updateZoomIndicator(1.0);
}

// Export functions to be accessible from outside
window.getCurrentZoom = getCurrentZoom;
window.resetFabricView = resetView;


/**
 * Add a rectangle annotation to the canvas
 * @param {Object} data - The annotation data
 * @param {number} index - The annotation index
 * @returns {fabric.Object} The created fabric object
 */
export function addRectangleAnnotation(data, index) {
    if (!canvas) return null;
    
    // Extract data
    const [x1, y1, x2, y2] = data.box || data.bbox;
    const width = x2 - x1;
    const height = y2 - y1;
    const labelId = data.label || 0;
    
    // Get color from labels if available
    let color = 'gray';
    let label_name = 'Other';
    
    // Find matching label
    const label = currentLabels.find(l => l.id === labelId);
    if (label) {
      color = label.color;
      label_name = label.name;
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
      annotationIndex: index
    });
    
    // Add text to canvas
    canvas.add(text);
    canvas.bringToFront(text);
    
    // Return objects
    return { rect, text };
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
      // Delete single object
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
    const label = currentLabels.find(l => l.id === labelId);
    
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
    // Find the line label for this ID using currentLineLabels if available
    const lineLabels = window.currentLineLabels || [
      { id: 1, name: "Strecke", color: "#FF9500" },
      { id: 2, name: "Höhe", color: "#00AAFF" },
      { id: 3, name: "Breite", color: "#4CAF50" },
      { id: 4, name: "Abstand", color: "#9C27B0" }
    ];
    
    const label = lineLabels.find(l => l.id === typeId);
    
    if (label) {
      const color = label.color;
      
      // Update line properties
      activeObject.set({
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
  if (!canvas) return;
  
  // Disable selection
  disableEditing();
  
  // Set cursor
  canvas.defaultCursor = 'crosshair';
  
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
  
  // Remove existing handlers
  canvas.off('mouse:down');
  canvas.off('mouse:move');
  canvas.off('mouse:up');
  
  // Mouse down handler
  canvas.on('mouse:down', function(o) {
    const pointer = canvas.getPointer(o.e);
    startX = pointer.x;
    startY = pointer.y;
    
    // Get color for the label
    let color = 'gray';
    let labelName = 'Other';
    
    const label = currentLabels.find(l => l.id === labelId);
    if (label) {
      color = label.color;
      labelName = label.name;
    }
    
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
    
    // Create label text
    const labelText = `#${canvas.getObjects().filter(obj => obj.objectType === 'annotation').length}: ${area.toFixed(2)} m²`;
    
    // Get color
    let color = 'gray';
    const label = currentLabels.find(l => l.id === labelId);
    if (label) {
      color = label.color;
    }
    
    // Create text
    const text = new fabric.Text(labelText, {
      left: rect.left,
      top: rect.top - 20,
      fontSize: 12,
      fill: 'white',
      backgroundColor: color,
      padding: 5,
      objectType: 'label',
      annotationIndex: canvas.getObjects().indexOf(rect)
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

// Function for polygon and line drawing would go here too
  
  /**
   * Add a polygon annotation to the canvas
   * @param {Object} data - The annotation data
   * @param {number} index - The annotation index
   * @returns {fabric.Object} The created fabric object
   */
  export function addPolygonAnnotation(data, index) {
    if (!canvas || !data.polygon) return null;
    
    // Extract data
    const { all_points_x, all_points_y } = data.polygon;
    const labelId = data.label || 0;
    
    // Validate polygon data
    if (!all_points_x || !all_points_y || all_points_x.length < 3) {
      console.warn("Invalid polygon data:", data);
      return null;
    }
    
    // Create points array for fabric.js
    const points = [];
    for (let i = 0; i < all_points_x.length; i++) {
      points.push({
        x: all_points_x[i],
        y: all_points_y[i]
      });
    }
    
    // Get color from labels if available
    let color = 'gray';
    let label_name = 'Other';
    
    // Find matching label
    const label = currentLabels.find(l => l.id === labelId);
    if (label) {
      color = label.color;
      label_name = label.name;
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
      annotationIndex: index
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
   * @returns {fabric.Object} The created fabric object
   */
  export function addLineAnnotation(data, index) {
    if (!canvas || !data.line) return null;
    
    // Extract data
    const { all_points_x, all_points_y } = data.line;
    
    // Validate line data
    if (!all_points_x || !all_points_y || all_points_x.length < 2) {
      console.warn("Invalid line data:", data);
      return null;
    }
    
    // Create points array for fabric.js
    const points = [];
    for (let i = 0; i < all_points_x.length; i++) {
      points.push({
        x: all_points_x[i],
        y: all_points_y[i]
      });
    }
    
    // Get line color
    const color = data.color || '#FF9500';
    
    // Create polyline
    const line = new fabric.Polyline(points, {
      fill: '',
      stroke: color,
      strokeWidth: 2,
      objectType: 'annotation',
      annotationType: 'line',
      annotationIndex: index,
      originalData: { ...data },
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
      annotationIndex: index
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
    if (prediction.type === "line" || (prediction.line && prediction.length !== undefined)) {
      return addLineAnnotation(prediction, index);
    } else if (prediction.type === "polygon" || prediction.polygon) {
      return addPolygonAnnotation(prediction, index);
    } else if (prediction.box || prediction.bbox) {
      return addRectangleAnnotation(prediction, index);
    }
  }
  
  /**
   * Display annotations from prediction data
   * @param {Array} predictions - The predictions data
   */
  export function displayAnnotations(predictions) {
    if (!canvas || !predictions) return;
    
    // Clear canvas
    clearAnnotations();
    
    // Add each annotation
    predictions.forEach((prediction, index) => {
      addAnnotation(prediction, index);
    });
    
    // Render canvas
    canvas.renderAll();
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
          ...obj.originalData,
          box: [x1, y1, x2, y2],
          label: obj.labelId,
          label_name: obj.labelName,
          type: 'rectangle',
          area: calculateRectangleArea(obj.width, obj.height)
        });
      } else if (obj.annotationType === 'polygon') {
        // Polygon format
        const points = obj.points;
        const all_points_x = points.map(p => p.x);
        const all_points_y = points.map(p => p.y);
        
        annotations.push({
          ...obj.originalData,
          polygon: {
            all_points_x,
            all_points_y
          },
          label: obj.labelId,
          label_name: obj.labelName,
          type: 'polygon',
          area: calculatePolygonArea(points)
        });
      } else if (obj.annotationType === 'line') {
        // Line format
        const points = obj.points;
        const all_points_x = points.map(p => p.x);
        const all_points_y = points.map(p => p.y);
        
        annotations.push({
          ...obj.originalData,
          line: {
            all_points_x,
            all_points_y
          },
          type: 'line',
          length: calculateLineLength(points)
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
  
