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
  
  // Überprüfe, ob das Bild geladen ist
  if (!uploadedImage || !uploadedImage.complete || uploadedImage.naturalWidth === 0) {
    console.warn("Image not fully loaded yet, delaying canvas initialization");
    setTimeout(initCanvas, 100);
    return null;
  }
  
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
  
  // Set canvas size to match the NATURAL size of the image
  const naturalWidth = uploadedImage.naturalWidth;
  const naturalHeight = uploadedImage.naturalHeight;
  
  console.log(`Setting canvas size to ${naturalWidth}x${naturalHeight} (natural image dimensions)`);
  canvas.setWidth(naturalWidth);
  canvas.setHeight(naturalHeight);
  
  // Set the canvas container to match the DISPLAYED size of the image
  const displayWidth = uploadedImage.offsetWidth;
  const displayHeight = uploadedImage.offsetHeight;
  
  // WICHTIG: Berechne einen vernünftigen Zoom-Faktor
  const containerWidth = imageContainer.clientWidth;
  const containerHeight = imageContainer.clientHeight;
  
  // Berechne Zoom-Faktoren, um das Bild in den Container zu passen
  const zoomX = containerWidth / naturalWidth;
  const zoomY = containerHeight / naturalHeight;
  let zoom = Math.min(zoomX, zoomY) * 0.95; // 95% der verfügbaren Größe nutzen
  
  // Stelle sicher, dass der Zoom vernünftig ist
  if (zoom < 0.05) zoom = 0.05; // Mindest-Zoom
  if (zoom > 1.0) zoom = 1.0;  // Maximal-Zoom
  
  console.log(`Calculated initial zoom: ${zoom.toFixed(4)}`);
  canvas.setZoom(zoom);
  
  // Get canvas container
  const canvasContainer = document.getElementsByClassName('canvas-container')[0];
  if (canvasContainer) {
    // WICHTIG: Setze die Canvas-Container-Größe
    canvasContainer.style.position = 'absolute';
    canvasContainer.style.top = '0';
    canvasContainer.style.left = '0';
    canvasContainer.style.width = `${containerWidth}px`;
    canvasContainer.style.height = `${containerHeight}px`;
    
    // Setze Overflow für Scrolling
    canvasContainer.style.overflow = 'auto';
    canvasContainer.style.display = 'block';
  }
  
  // Stelle sicher, dass der Canvas sichtbar ist
  canvasElement.style.display = 'block';
  
  // Set up event listeners
  setupEventListeners();
  
  // Sync with global zoom if needed
  if (typeof window.getCurrentZoom === 'function') {
    const globalZoom = window.getCurrentZoom();
    if (globalZoom !== 1.0) {
      syncEditorZoom(globalZoom);
    }
  }
  
  console.log("Canvas initialized, size:", canvas.width, "x", canvas.height, "zoom:", canvas.getZoom());
  
  return canvas;
}

function checkImageAspectRatio() {
  if (!uploadedImage) return;
  
  // Überprüfe, ob das Bild verzerrt dargestellt wird
  const naturalRatio = uploadedImage.naturalWidth / uploadedImage.naturalHeight;
  const displayedRatio = uploadedImage.offsetWidth / uploadedImage.offsetHeight;
  
  const ratioDifference = Math.abs(naturalRatio - displayedRatio);
  
  if (ratioDifference > 0.01) { // Mehr als 1% Unterschied
    console.warn(`Image aspect ratio mismatch: natural=${naturalRatio.toFixed(4)}, displayed=${displayedRatio.toFixed(4)}`);
    console.warn("This may cause annotation positioning issues!");
  }
}

/**
 * Resize canvas to match container size
 */
function resizeCanvas() {
  if (!canvas || !imageContainer || !uploadedImage) return;

    // Überprüfe Seitenverhältnis
    checkImageAspectRatio();
  
  // Warte bis das Bild vollständig geladen ist
  if (uploadedImage.complete && uploadedImage.naturalWidth > 0) {
    // Hole die natürlichen Dimensionen des Bildes
    const width = uploadedImage.naturalWidth;
    const height = uploadedImage.naturalHeight;
    
    console.log(`Setting canvas size to ${width}x${height} (natural: ${width}x${height})`);
    
    // Setze die Canvas-Dimensionen auf die NATÜRLICHEN Dimensionen des Bildes
    canvas.setWidth(width);
    canvas.setHeight(height);
    
    // Stelle sicher, dass der Canvas-Container der angezeigten Bildgröße entspricht
    const canvasContainer = document.getElementsByClassName('canvas-container')[0];
    if (canvasContainer) {
      // Setze exakte Position des Canvas-Containers
      canvasContainer.style.position = 'absolute';
      canvasContainer.style.top = '0';
      canvasContainer.style.left = '0';
      
      // WICHTIG: Übernimm die exakte Position und Dimensionen des Bildes
      const imageRect = uploadedImage.getBoundingClientRect();
      const containerRect = imageContainer.getBoundingClientRect();
      
      // Berechne relative Position des Bildes innerhalb des Containers
      const relativeTop = imageRect.top - containerRect.top;
      const relativeLeft = imageRect.left - containerRect.left;
      
      canvasContainer.style.top = `${relativeTop}px`;
      canvasContainer.style.left = `${relativeLeft}px`;
      canvasContainer.style.width = `${uploadedImage.offsetWidth}px`;
      canvasContainer.style.height = `${uploadedImage.offsetHeight}px`;
      
      // Berechne das Skalierungsverhältnis
      // KRITISCH: Wenn das angezeigte Bild die gleiche Größe hat wie das Original,
      // sollte der Zoom-Wert 1.0, nicht 0.01 sein!
      let scaleX, scaleY;
      
      // Prüfe, ob die offsetWidth/Height korrekt sind
      if (uploadedImage.offsetWidth === 0 || uploadedImage.offsetHeight === 0) {
        console.warn("Image offset dimensions are zero, using default scale of 1.0");
        scaleX = scaleY = 1.0;
      } else {
        scaleX = uploadedImage.offsetWidth / width;
        scaleY = uploadedImage.offsetHeight / height;
      }
      
      // WICHTIG: Wenn die Werte fast gleich sind (kleine Rundungsfehler), verwende 1.0
      if (Math.abs(scaleX - 1.0) < 0.05) scaleX = 1.0;
      if (Math.abs(scaleY - 1.0) < 0.05) scaleY = 1.0;
      
      console.log(`Calculated scale factors: X=${scaleX.toFixed(4)}, Y=${scaleY.toFixed(4)}`);
      
      // Verwende einen sinnvollen Mindestwert für die Skalierung
      const zoomLevel = Math.max(scaleX, 0.1); // Verwende mindestens 0.1 (10%)
      
      console.log(`Setting canvas zoom to: ${zoomLevel}`);
      canvas.setZoom(zoomLevel);
      
      // WICHTIG: Stelle sicher, dass der Wrapper die korrekten Dimensionen hat
      if (canvas.wrapperEl) {
        canvas.wrapperEl.style.width = `${uploadedImage.offsetWidth}px`;
        canvas.wrapperEl.style.height = `${uploadedImage.offsetHeight}px`;
      }
    }
    
    canvas.renderAll();
    console.log(`Final canvas state: size=${canvas.width}x${canvas.height}, zoom=${canvas.getZoom()}`);
  } else {
    console.warn("Image not fully loaded, delaying canvas resizing");
    // Wenn das Bild noch nicht geladen ist, richte einen Event-Listener ein
    uploadedImage.onload = function() {
      console.log("Image finished loading, now resizing canvas");
      setTimeout(resizeCanvas, 100);
    };
  }
}

/**
 * Set up event listeners for canvas interactions
 */
function setupEventListeners() {
  if (!canvas) return;

  // Füge einen Scroll-Event-Listener hinzu
  if (imageContainer) {
    imageContainer.addEventListener('scroll', function() {
      // Aktualisiere Canvas-Position beim Scrollen
      const imageRect = uploadedImage.getBoundingClientRect();
      const containerRect = imageContainer.getBoundingClientRect();
      
      // Berechne relative Position unter Berücksichtigung der Scroll-Position
      const relLeft = imageRect.left - containerRect.left + imageContainer.scrollLeft;
      const relTop = imageRect.top - containerRect.top + imageContainer.scrollTop;
      
      // Aktualisiere Canvas-Container-Position
      const canvasContainer = document.getElementsByClassName('canvas-container')[0];
      if (canvasContainer) {
        canvasContainer.style.top = `${relTop}px`;
        canvasContainer.style.left = `${relLeft}px`;
      }
    });
  }
  
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

  // Event-Listener für Objektmodifikationen
  canvas.on('object:modified', function(opt) {
    const modifiedObject = opt.target;
    if (modifiedObject && modifiedObject.objectType === 'annotation') {
      // Wenn ein Objekt modifiziert wurde, aktualisiere seine Fläche/Länge
      if (modifiedObject.annotationType === 'rectangle') {
        const area = calculateRectangleArea(modifiedObject.width, modifiedObject.height);
        modifiedObject.area = area;
        
        // Label aktualisieren
        updateObjectLabel(modifiedObject);
      } else if (modifiedObject.annotationType === 'polygon') {
        const area = calculatePolygonArea(modifiedObject.points);
        modifiedObject.area = area;
        
        // Label aktualisieren
        updateObjectLabel(modifiedObject);
      } else if (modifiedObject.annotationType === 'line') {
        const length = calculateLineLength(modifiedObject.points);
        modifiedObject.length = length;
        
        // Label aktualisieren
        updateObjectLabel(modifiedObject);
      }
    }
  });

  // Objekt-Änderungen verfolgen
  canvas.on('object:modified', function(opt) {
    const obj = opt.target;
    if (obj && obj.objectType === 'annotation') {
      console.log(`Objekt vom Typ ${obj.annotationType} wurde modifiziert`);
      
      if (obj.annotationType === 'rectangle') {
        // Fläche neu berechnen
        const area = calculateRectangleArea(obj.width, obj.height);
        obj.area = area;
        
        // Label aktualisieren
        const label = canvas.getObjects().find(l => l.objectType === 'label' && l.annotationIndex === obj.annotationIndex);
        if (label) {
          label.set({
            text: `#${obj.annotationIndex + 1}: ${area.toFixed(2)} m²`,
            left: obj.left,
            top: obj.top - 20
          });
        }
      } else if (obj.annotationType === 'polygon') {
        // Fläche neu berechnen
        const area = calculatePolygonArea(obj.points);
        obj.area = area;
        
        // Zentrum berechnen für Label-Position
        let centerX = 0, centerY = 0;
        for (let i = 0; i < obj.points.length; i++) {
          centerX += obj.points[i].x;
          centerY += obj.points[i].y;
        }
        centerX /= obj.points.length;
        centerY /= obj.points.length;
        
        // Label aktualisieren
        const label = canvas.getObjects().find(l => l.objectType === 'label' && l.annotationIndex === obj.annotationIndex);
        if (label) {
          label.set({
            text: `#${obj.annotationIndex + 1}: ${area.toFixed(2)} m²`,
            left: centerX,
            top: centerY - 20
          });
        }
      } else if (obj.annotationType === 'line') {
        // Länge neu berechnen
        const length = calculateLineLength(obj.points);
        obj.length = length;
        
        // Label aktualisieren
        const label = canvas.getObjects().find(l => l.objectType === 'label' && l.annotationIndex === obj.annotationIndex);
        if (label) {
          const lastPoint = obj.points[obj.points.length - 1];
          label.set({
            text: `${length.toFixed(2)} m`,
            left: lastPoint.x + 5,
            top: lastPoint.y - 15
          });
        }
      }
      
      canvas.renderAll();
    }
  });
}

// Hilfsfunktion um ein einzelnes Label zu aktualisieren
function updateObjectLabel(obj) {
  if (!canvas) return;
  
  const annotationIndex = obj.annotationIndex;
  const label = canvas.getObjects().find(l => 
    l.objectType === 'label' && l.annotationIndex === annotationIndex);
  
  if (label) {
    if (obj.annotationType === 'line') {
      label.set({
        text: `${obj.length.toFixed(2)} m`
      });
    } else {
      label.set({
        text: `#${annotationIndex + 1}: ${obj.area.toFixed(2)} m²`
      });
    }
    
    // Positioniere das Label korrekt für Polygone
    if (obj.annotationType === 'polygon') {
      // Berechne Zentrum des Polygons
      let centerX = 0, centerY = 0;
      for (let i = 0; i < obj.points.length; i++) {
        centerX += obj.points[i].x;
        centerY += obj.points[i].y;
      }
      centerX /= obj.points.length;
      centerY /= obj.points.length;
      
      // Aktualisiere Label-Position
      label.set({
        left: centerX,
        top: centerY - 20
      });
    }
    
    canvas.renderAll();
  }
}

/**
 * Sync with global zoom functionality
 * @param {number} zoomLevel - Current global zoom level
 */
// In static/js/fabric-handler.js, Funktion syncEditorZoom
export function syncEditorZoom(zoomLevel) {
  if (!canvas) return;
  
  console.log(`Syncing fabric canvas zoom to ${zoomLevel}`);
  
  // Store current zoom for debugging
  currentZoom = zoomLevel;
  
  // WICHTIG: We need accurate image and container positions
  const imageRect = uploadedImage.getBoundingClientRect();
  const containerRect = imageContainer.getBoundingClientRect();
  
  // Calculate the scroll offsets
  const scrollLeft = imageContainer.scrollLeft;
  const scrollTop = imageContainer.scrollTop;
  
  // WICHTIG: HIER IST DAS PROBLEM - Keine negativen Position-Werte verwenden
  // Calculate precise relative position - aber verhindere negative Werte
  const relLeft = Math.max(0, imageRect.left - containerRect.left + scrollLeft);
  const relTop = Math.max(0, imageRect.top - containerRect.top + scrollTop);
  
  // Get canvas container
  const canvasContainer = document.getElementsByClassName('canvas-container')[0];
  if (canvasContainer) {
    // Update position to exactly match the image - Keine negativen Werte
    canvasContainer.style.position = 'absolute';
    canvasContainer.style.top = `${relTop}px`;
    canvasContainer.style.left = `${relLeft}px`;
    
    // Match the exact displayed size of the image
    canvasContainer.style.width = `${imageRect.width}px`;
    canvasContainer.style.height = `${imageRect.height}px`;
    canvasContainer.style.overflow = 'hidden';
    
    // WICHTIG: Stelle sicher, dass der Canvas-Container sichtbar ist
    canvasContainer.style.display = 'block';
    canvasContainer.style.zIndex = '10'; // Höherer z-index, um über anderen Elementen zu sein
    
    console.log(`Canvas container positioned at: ${relLeft}x${relTop}, Size: ${imageRect.width}x${imageRect.height}`);
  }
  
  // Get the base scale - this is critical for correct annotation positioning
  // How much is the displayed image scaled compared to its natural size?
  const scaleX = imageRect.width / uploadedImage.naturalWidth;
  const scaleY = imageRect.height / uploadedImage.naturalHeight;
  
  console.log(`Image scale factors: X=${scaleX.toFixed(4)}, Y=${scaleY.toFixed(4)}`);
  
  // WICHTIG: Verwende einen vernünftigen Zoom-Wert, um zu verhindern, dass Annotationen zu klein sind
  let finalZoom = scaleX;
  if (finalZoom < 0.1) {
    console.warn(`Scale factor ${scaleX.toFixed(6)} is too small, using minimum 0.1`);
    finalZoom = 0.1;
  }
  
  // Set fabric canvas zoom to match this scale
  console.log(`Setting canvas zoom to ${finalZoom.toFixed(4)}`);
  canvas.setZoom(finalZoom);
  
  // Make sure canvas dimensions match image natural dimensions
  canvas.setWidth(uploadedImage.naturalWidth);
  canvas.setHeight(uploadedImage.naturalHeight);
  
  // Force canvas to recalculate its position and render
  canvas.calcOffset();
  canvas.renderAll();

  // Debug Annotation-Position nach dem Ediotr schliessen:
  console.log(`Nach canvas.renderAll(): Canvas hat ${canvas.getObjects().length} Objekte`);
  console.log(`Canvas-Dimensionen: ${canvas.width}x${canvas.height}, Zoom: ${canvas.getZoom()}`);
  console.log(`Canvas-Position: (${canvasContainer.style.left}, ${canvasContainer.style.top})`);
  
  // Debug-Ausgabe
  console.log(`Nach canvas.renderAll(): Canvas hat ${canvas.getObjects().length} Objekte`);
  console.log(`Canvas-Dimensionen: ${canvas.width}x${canvas.height}, Zoom: ${canvas.getZoom()}`);
  console.log(`Canvas-Position: (${canvasContainer.style.left}, ${canvasContainer.style.top})`);
  
  console.log(`Canvas synced - Natural: ${canvas.width}x${canvas.height}, Display: ${imageRect.width}x${imageRect.height}, Zoom: ${canvas.getZoom()}`);
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

function validateCoordinates(coords, index) {
  const [x1, y1, x2, y2] = coords;
  
  // Überprüfe auf ungewöhnliche Werte
  if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0) {
    console.warn(`Annotation #${index} has negative coordinates: [${x1}, ${y1}, ${x2}, ${y2}]`);
  }
  
  if (x1 >= canvas.width || y1 >= canvas.height || x2 >= canvas.width || y2 >= canvas.height) {
    console.warn(`Annotation #${index} has out-of-bounds coordinates: [${x1}, ${y1}, ${x2}, ${y2}]`);
  }
  
  const width = x2 - x1;
  const height = y2 - y1;
  
  if (width <= 0 || height <= 0) {
    console.warn(`Annotation #${index} has invalid dimensions: ${width}x${height}`);
  }
  
  // Alles in Ordnung
  return coords;
}

/**
 * Add a rectangle annotation to the canvas
 * @param {Object} data - The annotation data
 * @param {number} index - The annotation index
 * @returns {Object} The created fabric objects
 */
// In static/js/fabric-handler.js, Funktion addRectangleAnnotation() anpassen
export function addRectangleAnnotation(data, index) {
  if (!canvas) return null;
  
  // Extrahiere Daten
  const coords = validateCoordinates(data.box || data.bbox, index);
  const [x1, y1, x2, y2] = coords;
  const width = x2 - x1;
  const height = y2 - y1;
  const labelId = data.label || 0;
  
  // Debug-Informationen
  // console.log(`Adding rectangle #${index}: [${x1}, ${y1}, ${x2}, ${y2}], size: ${width}x${height}`);
  
  // WICHTIG: Überprüfe den Zoom-Faktor und korrigiere ihn bei Bedarf
  const currentZoom = canvas.getZoom();
  if (currentZoom < 0.05) {
    console.log(`Canvas zoom too low (${currentZoom}), using minimum 0.05`);
    canvas.setZoom(0.05);
  }
  
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
    area: data.area || 0,
    selectable: true,  // WICHTIG: Stelle sicher, dass es auswählbar ist
    hasControls: true, // WICHTIG: Stelle sicher, dass es Steuerelemente hat
    hasBorders: true   // WICHTIG: Stelle sicher, dass es Ränder hat
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
    textBaseline: 'alphabetic', // Wichtig: Korrektes textBaseline
    selectable: false // Texte nicht auswählbar machen
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
// displayAnnotations zeichnet die Annotations
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
  
  // WICHTIG: Mit Zoom 1.0 arbeiten im Editor
  // Braucht es den? Claude fragen.
  if (window.isEditorActive) {
    canvas.setZoom(1.0);
  }
  
  // Log current canvas state
  console.log(`Canvas state: size=${canvas.width}x${canvas.height}, zoom=${canvas.getZoom()}`);
  
  // Add each annotation with debug info
  predictions.forEach((prediction, index) => {
    console.log(`Adding annotation #${index}: Type: ${prediction.type || 'unknown'}, Label: ${prediction.label || 'unknown'}`);
    
    const result = addAnnotation(prediction, index);
    if (!result) {
      console.warn(`Failed to add annotation #${index}`);
    }
  });
  
  // Render canvas 
  canvas.renderAll();
  
  // WICHTIG: Versuche zum Zentrum der Objekte zu scrollen (nur im Editor)
  if (window.isEditorActive) {
    try {
      const scrollContainer = document.querySelector('.scroll-container');
      if (scrollContainer) {
        const objects = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
        if (objects.length > 0) {
          // Berechne den Mittelpunkt aller Objekte
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          
          objects.forEach(obj => {
            const left = obj.left || 0;
            const top = obj.top || 0;
            const width = obj.width || 0;
            const height = obj.height || 0;
            
            minX = Math.min(minX, left);
            minY = Math.min(minY, top);
            maxX = Math.max(maxX, left + width);
            maxY = Math.max(maxY, top + height);
          });
          
          // Berechne das Zentrum
          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          
          // Scroll zur Mitte (mit Offset für Containergrößen)
          const scrollX = centerX - scrollContainer.clientWidth / 2;
          const scrollY = centerY - scrollContainer.clientHeight / 2;
          
          console.log(`Scrolling to center of objects: ${centerX},${centerY} (scroll: ${scrollX},${scrollY})`);
          
          // Sanft scrollen mit Animation
          setTimeout(function() {
            scrollContainer.scrollLeft = Math.max(0, scrollX);
            scrollContainer.scrollTop = Math.max(0, scrollY);
          }, 100);
        }
      }
    } catch (error) {
      console.warn("Error while trying to center objects:", error);
    }
  }
  
  // Log final object count
  console.log(`Canvas now has ${canvas.getObjects().length} objects`);
}

// Neue Funktion zum Zentrieren des Canvas auf die Annotationen
function centerCanvas() {
  if (!canvas) return;
  
  // Finde die Grenzen aller Objekte
  const objects = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  if (objects.length === 0) return;
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  objects.forEach(obj => {
    const bounds = obj.getBoundingRect();
    minX = Math.min(minX, bounds.left);
    minY = Math.min(minY, bounds.top);
    maxX = Math.max(maxX, bounds.left + bounds.width);
    maxY = Math.max(maxY, bounds.top + bounds.height);
  });
  
  // Berechne Zentrum der Annotationen
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  
  // Finde den Container
  const canvasContainer = document.getElementsByClassName('canvas-container')[0];
  if (!canvasContainer) return;
  
  // Berechne die Position zum Scrollen
  const containerWidth = canvasContainer.clientWidth;
  const containerHeight = canvasContainer.clientHeight;
  
  // Setze Scroll-Position, um Annotationen zu zentrieren
  canvasContainer.scrollLeft = centerX * canvas.getZoom() - containerWidth / 2;
  canvasContainer.scrollTop = centerY * canvas.getZoom() - containerHeight / 2;
  
  console.log(`Centered canvas at ${centerX},${centerY} with zoom ${canvas.getZoom()}`);
}

/**
 * Convert annotations from fabric.js objects back to prediction format
 * @returns {Array} Array of prediction objects
 */
// In fabric-handler.js, Änderung in der getAnnotationsData() Funktion
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
      
      // WICHTIG: Fläche neu berechnen basierend auf aktueller Größe
      const area = calculateRectangleArea(obj.width, obj.height);
      
      annotations.push({
        box: [x1, y1, x2, y2],
        label: obj.labelId,
        label_name: obj.labelName,
        type: 'rectangle',
        area: area, // Aktualisierte Fläche verwenden
        score: obj.originalData?.score || 1.0
      });
    } else if (obj.annotationType === 'polygon') {
      // Polygon format
      const points = obj.points;
      const all_points_x = points.map(p => p.x);
      const all_points_y = points.map(p => p.y);
      
      // WICHTIG: Fläche neu berechnen basierend auf aktuellen Punkten
      const area = calculatePolygonArea(points);
      
      annotations.push({
        polygon: {
          all_points_x,
          all_points_y
        },
        label: obj.labelId,
        label_name: obj.labelName,
        type: 'polygon',
        area: area, // Aktualisierte Fläche verwenden
        score: obj.originalData?.score || 1.0
      });
    } else if (obj.annotationType === 'line') {
      // Line format
      const points = obj.points;
      const all_points_x = points.map(p => p.x);
      const all_points_y = points.map(p => p.y);
      
      // WICHTIG: Länge neu berechnen
      const length = calculateLineLength(points);
      
      annotations.push({
        line: {
          all_points_x,
          all_points_y
        },
        type: 'line',
        lineType: obj.lineType || 1,
        length: length, // Aktualisierte Länge verwenden
        score: obj.originalData?.score || 1.0
      });
    }
  });
  
  return annotations;
}

// ompletten Neuaufbau der Anzeige nach dem schliessen des Editors. 
// In fabric-handler.js, überarbeiten wir die reloadAnnotations-Funktion
export function reloadAnnotations() {
  console.log("=== KOMPLETTE NEUINITIALISIERUNG DER ANNOTATIONS-ANZEIGE ===");
  
  // 1. Canvas vollständig zurücksetzen
  if (canvas) {
    console.log("Bestehenden Canvas zurücksetzen");
    canvas.dispose();
    canvas = null;
  }
  
  // 2. Canvas-Element aus dem DOM entfernen
  const oldCanvas = document.getElementById('annotationCanvas');
  if (oldCanvas) {
    console.log("Canvas-Element aus dem DOM entfernen");
    oldCanvas.parentNode.removeChild(oldCanvas);
  }
  
  // 3. Kurze Verzögerung für DOM-Updates
  setTimeout(function() {
    // 4. Canvas neu initialisieren
    console.log("Canvas neu initialisieren");
    initCanvas();
    
    // 5. Annotationen anzeigen, falls vorhanden
    if (window.data && window.data.predictions) {
      console.log(`Zeichne ${window.data.predictions.length} Annotationen neu`);
      
      // KRITISCH: Ausgabe der ersten Annotation, um sicherzustellen,
      // dass die richtigen Daten verwendet werden
      if (window.data.predictions.length > 0) {
        const firstPrediction = window.data.predictions[0];
        console.log("Erste Annotation:", {
          type: firstPrediction.type,
          box: firstPrediction.box,
          area: firstPrediction.area
        });
      }
      
      // 6. Warten, bis der Canvas fertig initialisiert ist
      setTimeout(function() {
        // Sicherstellen, dass Canvas existiert
        if (!canvas) {
          console.error("Canvas noch nicht initialisiert!");
          initCanvas();
        }
        
        // 7. Annotationen zeichnen
        displayAnnotations(window.data.predictions);
        
        // 8. Zoom anwenden
        if (typeof window.getCurrentZoom === 'function') {
          const zoom = window.getCurrentZoom();
          console.log(`Zoom wird auf ${zoom} gesetzt`);
          syncEditorZoom(zoom);
        }
        
        console.log("=== NEUINITIALISIERUNG ABGESCHLOSSEN ===");
      }, 300);
    } else {
      console.warn("Keine Annotationen zum Anzeigen gefunden!");
    }
  }, 100);
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
  if (!canvas) {
    console.error("Kein Canvas gefunden beim Speichern der Annotationen!");
    return [];
  }
  
  console.log("saveAnnotations: Speichere Änderungen aus dem Editor");
  
  // Zunächst alle Annotation-Objekte sammeln
  const annotationObjects = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  console.log(`Gefunden: ${annotationObjects.length} Annotation-Objekte`);
  
  // Ein neues Array für die konvertierten Annotationen erstellen
  const updatedAnnotations = [];
  
  // Jedes Objekt einzeln konvertieren und Fläche/Länge neu berechnen
  annotationObjects.forEach((obj, index) => {
    if (obj.annotationType === 'rectangle') {
      // Aktuelle Positionen und Dimensionen auslesen
      const x1 = obj.left;
      const y1 = obj.top;
      const x2 = x1 + obj.width;
      const y2 = y1 + obj.height;
      
      // Fläche neu berechnen
      const area = calculateRectangleArea(obj.width, obj.height);
      console.log(`Rechteck #${index}: Neue Fläche ${area.toFixed(2)} m²`);
      
      // Annotation erstellen
      updatedAnnotations.push({
        box: [x1, y1, x2, y2],
        label: obj.labelId,
        label_name: obj.labelName,
        type: 'rectangle',
        area: area,
        score: obj.originalData?.score || 1.0
      });
    } else if (obj.annotationType === 'polygon') {
      // Aktuelle Punkte auslesen
      const points = obj.points;
      const all_points_x = points.map(p => p.x);
      const all_points_y = points.map(p => p.y);
      
      // Fläche neu berechnen
      const area = calculatePolygonArea(points);
      console.log(`Polygon #${index}: Neue Fläche ${area.toFixed(2)} m²`);
      
      // Annotation erstellen
      updatedAnnotations.push({
        polygon: {
          all_points_x,
          all_points_y
        },
        label: obj.labelId,
        label_name: obj.labelName,
        type: 'polygon',
        area: area,
        score: obj.originalData?.score || 1.0
      });
    } else if (obj.annotationType === 'line') {
      // Aktuelle Punkte auslesen
      const points = obj.points;
      const all_points_x = points.map(p => p.x);
      const all_points_y = points.map(p => p.y);
      
      // Länge neu berechnen
      const length = calculateLineLength(points);
      console.log(`Linie #${index}: Neue Länge ${length.toFixed(2)} m`);
      
      // Annotation erstellen
      updatedAnnotations.push({
        line: {
          all_points_x,
          all_points_y
        },
        type: 'line',
        lineType: obj.lineType || 1,
        length: length,
        score: obj.originalData?.score || 1.0
      });
    }
  });
  
  // KRITISCH: Window.data.predictions direkt ersetzen
  if (window.data) {
    console.log(`Ersetze ${window.data.predictions?.length || 0} alte Annotationen mit ${updatedAnnotations.length} neuen Annotationen`);
    window.data.predictions = updatedAnnotations;
    
    // Zusammenfassung aktualisieren
    updateDataSummary();
  }
  
  // Daten für PDF-Anzeige aktualisieren
  if (typeof window.updatePdfPageData === 'function') {
    window.updatePdfPageData(window.data);
  }
  
  console.log("Annotationen erfolgreich gespeichert!");
  return updatedAnnotations;
}

// Neue Hilfsfunktion, die alle Labels aktualisiert
function updateAnnotationLabels() {
  if (!canvas) return;
  
  // Alle Annotationsobjekte durchgehen
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  
  annotations.forEach(obj => {
    if (obj.annotationType === 'rectangle' || obj.annotationType === 'polygon') {
      // Fläche neu berechnen
      let area;
      if (obj.annotationType === 'rectangle') {
        area = calculateRectangleArea(obj.width, obj.height);
      } else {
        area = calculatePolygonArea(obj.points);
      }
      
      // Fläche im Objekt aktualisieren
      obj.area = area;
      
      // Zugehöriges Label suchen und aktualisieren
      const annotationIndex = obj.annotationIndex;
      const label = canvas.getObjects().find(l => 
        l.objectType === 'label' && l.annotationIndex === annotationIndex);
      
      if (label) {
        // Text aktualisieren
        label.set({
          text: `#${annotationIndex + 1}: ${area.toFixed(2)} m²`
        });
      }
    } else if (obj.annotationType === 'line') {
      // Länge neu berechnen
      const length = calculateLineLength(obj.points);
      
      // Länge im Objekt aktualisieren
      obj.length = length;
      
      // Zugehöriges Label suchen und aktualisieren
      const annotationIndex = obj.annotationIndex;
      const label = canvas.getObjects().find(l => 
        l.objectType === 'label' && l.annotationIndex === annotationIndex);
      
      if (label) {
        // Text aktualisieren
        label.set({
          text: `${length.toFixed(2)} m`
        });
      }
    }
  });
  
  // Canvas neu rendern
  canvas.renderAll();
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

// In static/js/fabric-handler.js, neue Funktion hinzufügen
export function setCanvasZoom(zoomLevel) {
  if (!canvas) return;
  
  console.log(`Setting canvas zoom to ${zoomLevel}`);
  
  // Minimalen Zoom-Wert sicherstellen
  if (zoomLevel < 0.05) zoomLevel = 0.05;
  
  // Aktuellen Zoom speichern
  currentZoom = zoomLevel;
  
  // Zoom auf die Mitte des Canvas setzen
  const center = canvas.getCenter();
  canvas.zoomToPoint(new fabric.Point(center.left, center.top), zoomLevel);
  
  // Canvas rendern
  canvas.renderAll();
  
  return zoomLevel;
}

/**
 * Initialisiere den Editor mit vorhandenen Annotationen
 * Diese Funktion sollte explizit aufgerufen werden, wenn der Editor geöffnet wird
 */
export function initEditor() {
  console.log("Initialisiere Editor mit bestehenden Annotationen");
  
  // Canvas zurücksetzen
  if (canvas) {
    canvas.dispose();
    canvas = null;
  }
  
  // Canvas-Element aus dem DOM entfernen, falls vorhanden
  const oldCanvas = document.getElementById('annotationCanvas');
  if (oldCanvas) {
    oldCanvas.parentNode.removeChild(oldCanvas);
  }
  
  // Editor-Container ermitteln
  const editorContainer = document.querySelector('.editor-canvas-container');
  if (!editorContainer) {
    console.error("Editor-Container nicht gefunden");
    return null;
  }
  
  // WICHTIG: Scroll-Container erstellen, der Bild und Canvas enthält
  let scrollContainer = editorContainer.querySelector('.scroll-container');
  if (!scrollContainer) {
    scrollContainer = document.createElement('div');
    scrollContainer.className = 'scroll-container';
    scrollContainer.style.position = 'absolute';
    scrollContainer.style.top = '0';
    scrollContainer.style.left = '0';
    scrollContainer.style.width = '100%';
    scrollContainer.style.height = '100%';
    scrollContainer.style.overflow = 'auto';
    scrollContainer.style.zIndex = '1';
    editorContainer.appendChild(scrollContainer);
  }
  
  // Bild-Element im Scroll-Container hinzufügen/aktualisieren
  let editorImage = scrollContainer.querySelector('#editorImage');
  if (!editorImage) {
    editorImage = document.createElement('img');
    editorImage.id = 'editorImage';
    editorImage.style.position = 'absolute';
    editorImage.style.top = '0';
    editorImage.style.left = '0';
    editorImage.style.maxWidth = 'none'; // WICHTIG: maxWidth entfernen
    editorImage.style.zIndex = '1';
    scrollContainer.appendChild(editorImage);
  }
  editorImage.src = uploadedImage.src;
  
  // Neues Canvas-Element erstellen
  const canvasElement = document.createElement('canvas');
  canvasElement.id = 'annotationCanvas';
  canvasElement.style.position = 'absolute';
  canvasElement.style.top = '0';
  canvasElement.style.left = '0';
  canvasElement.style.pointerEvents = 'all';
  canvasElement.style.zIndex = '2';
  
  // Canvas zum Scroll-Container hinzufügen
  scrollContainer.appendChild(canvasElement);
  
  // Bild-Dimensions aus uploadedImage holen
  const naturalWidth = uploadedImage.naturalWidth;
  const naturalHeight = uploadedImage.naturalHeight;
  
  // WICHTIG: Aktuellen Zoom-Wert aus dem Ansichtsbereich übernehmen
  let zoomFactor = 1.0;
  if (typeof window.getCurrentZoom === 'function') {
    zoomFactor = window.getCurrentZoom();
    console.log(`Übernahme des Zoom-Faktors aus der Ansicht: ${zoomFactor}`);
  }
  
  // Setze Bildgröße basierend auf dem Zoom-Faktor
  const scaledWidth = naturalWidth * zoomFactor;
  const scaledHeight = naturalHeight * zoomFactor;
  
  editorImage.style.width = `${scaledWidth}px`;
  editorImage.style.height = `${scaledHeight}px`;
  
  // Fabric.js Canvas initialisieren
  canvas = new fabric.Canvas('annotationCanvas');
  
  // Canvas auf die natürliche Bildgröße setzen
  canvas.setWidth(naturalWidth);
  canvas.setHeight(naturalHeight);
  
  // WICHTIG: Zoom auf den Wert aus der Ansicht setzen
  canvas.setZoom(zoomFactor);
  
  console.log(`Editor-Canvas erstellt mit Größe ${naturalWidth}x${naturalHeight}, Zoom=${zoomFactor.toFixed(4)}`);
  
  // Stelle sicher, dass der Canvas-Container genau die gleiche Größe wie das skalierte Bild hat
  const canvasContainer = document.getElementsByClassName('canvas-container')[0];
  if (canvasContainer) {
    canvasContainer.style.position = 'absolute';
    canvasContainer.style.top = '0';
    canvasContainer.style.left = '0';
    canvasContainer.style.width = `${scaledWidth}px`;
    canvasContainer.style.height = `${scaledHeight}px`;
    canvasContainer.style.overflow = 'hidden'; // Kein Overflow im Canvas-Container!
  }
  
  // Event-Listener einrichten
  setupEventListeners();
  
  // WICHTIG: Scroll-Position übernehmen
  if (imageContainer && scrollContainer) {
    setTimeout(function() {
      scrollContainer.scrollLeft = imageContainer.scrollLeft;
      scrollContainer.scrollTop = imageContainer.scrollTop;
    }, 100);
  }
    
  // Event-Listener für den Editor einrichten
  setupEditorEventListeners();
  
  return canvas;
}

/**
 * Cancel editing and restore original annotations
 */
export function cancelEditing() {
  if (!canvas) return;
  
  console.log("Bearbeitung abgebrochen, stelle Originalzustand wieder her");
  
  // Wir sollten den Originalzustand wiederherstellen
  if (window.data && window.data.original_predictions) {
    // Wenn es eine Sicherung der Original-Annotationen gibt, diese wiederherstellen
    window.data.predictions = window.data.original_predictions;
    console.log("Original-Annotationen wiederhergestellt:", window.data.original_predictions.length);
  } else if (window.data && window.data.predictions) {
    console.log("Keine Original-Annotationen gefunden, lade aktuelle Annotationen");
  }
  
  // Disable editing
  disableEditing();
}

/**
 * Debug-Funktion zur Überprüfung und Reparatur des Canvas-Zustands
 */
export function debugEditor() {
  console.log("=== EDITOR DEBUG ===");
  
  // Canvas-Zustand überprüfen
  if (!canvas) {
    console.error("Canvas ist nicht initialisiert!");
    return false;
  }
  
  // Canvas-Dimensionen ausgeben
  console.log(`Canvas Dimensionen: ${canvas.width} x ${canvas.height}`);
  console.log(`Canvas Zoom: ${canvas.getZoom()}`);
  
  // Objekte auf dem Canvas zählen
  const objects = canvas.getObjects();
  console.log(`Canvas hat ${objects.length} Objekte`);
  
  // Objekte nach Typ gruppieren
  const annotations = objects.filter(obj => obj.objectType === 'annotation');
  const labels = objects.filter(obj => obj.objectType === 'label');
  
  console.log(`Davon sind ${annotations.length} Annotationen und ${labels.length} Labels`);
  
  // Beispielhaft erstes Objekt ausgeben, falls vorhanden
  if (annotations.length > 0) {
    const firstAnnotation = annotations[0];
    console.log("Erste Annotation:", {
      type: firstAnnotation.annotationType,
      position: `(${firstAnnotation.left}, ${firstAnnotation.top})`,
      size: `${firstAnnotation.width} x ${firstAnnotation.height}`,
      label: firstAnnotation.labelId,
      visible: firstAnnotation.visible,
      selectable: firstAnnotation.selectable
    });
  }
  
  // Versuchen, Zoom zu korrigieren und Annotationen zu zentrieren
  try {
    // Zoom auf vernünftigen Wert setzen
    const newZoom = Math.min(Math.max(0.25, canvas.getZoom()), 1.0);
    if (newZoom !== canvas.getZoom()) {
      console.log(`Korrigiere Zoom von ${canvas.getZoom()} auf ${newZoom}`);
      canvas.setZoom(newZoom);
    }
    
    // Annotationen zentrieren
    if (annotations.length > 0) {
      // Grenzen aller Annotationen berechnen
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      
      annotations.forEach(obj => {
        minX = Math.min(minX, obj.left || 0);
        minY = Math.min(minY, obj.top || 0);
        maxX = Math.max(maxX, (obj.left || 0) + (obj.width || 0));
        maxY = Math.max(maxY, (obj.top || 0) + (obj.height || 0));
      });
      
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      
      // Zum Zentrum scrollen
      const canvasContainer = document.getElementsByClassName('canvas-container')[0];
      if (canvasContainer) {
        const scrollX = centerX * newZoom - canvasContainer.clientWidth / 2;
        const scrollY = centerY * newZoom - canvasContainer.clientHeight / 2;
        
        console.log(`Scrolle zu (${centerX}, ${centerY}), Scroll-Position: (${scrollX}, ${scrollY})`);
        canvasContainer.scrollLeft = scrollX;
        canvasContainer.scrollTop = scrollY;
      }
    }
    
    // Canvas rendern
    canvas.renderAll();
    
    return true;
  } catch (err) {
    console.error("Fehler beim Reparieren des Canvas:", err);
    return false;
  }
}

/**
 * Event-Listener für den Editor einrichten
 */
function setupEditorEventListeners() {
  if (!canvas) return;
  
  // Finde den scroll-container für das Zoomen im Editor
  const scrollContainer = document.querySelector('.scroll-container');
  if (!scrollContainer) return;
  
  // Entferne bisherige Event-Listener
  scrollContainer.removeEventListener('wheel', handleEditorZoom);
  
  // Füge neuen Event-Listener für das Mausrad hinzu
  scrollContainer.addEventListener('wheel', handleEditorZoom, { passive: false });
  
  console.log("Editor-Zoom-Event-Listener hinzugefügt");
}

/**
 * Zoom-Event im Editor verarbeiten
 * @param {Event} event - Das Wheel-Event
 */
function handleEditorZoom(event) {
  // Nur zoomen, wenn Strg gedrückt ist
  if (!event.ctrlKey) return;
  
  // Standardverhalten verhindern
  event.preventDefault();
  
  // Scroll-Container ermitteln
  const scrollContainer = document.querySelector('.scroll-container');
  if (!scrollContainer || !canvas) return;
  
  // Bild ermitteln
  const editorImage = document.getElementById('editorImage');
  if (!editorImage) return;
  
  // Aktuellen Zoom ermitteln
  let currentZoom = canvas.getZoom();
  
  // Zoom-Änderung ermitteln
  const delta = event.deltaY;
  const zoomStep = 0.25;
  
  // Neuen Zoom berechnen
  let newZoom = currentZoom;
  if (delta < 0) {
    // Vergrößern
    newZoom = Math.min(currentZoom + zoomStep, 5.0);
  } else {
    // Verkleinern
    newZoom = Math.max(currentZoom - zoomStep, 0.1);
  }
  
  // Wenn der Zoom sich nicht geändert hat, nichts tun
  if (newZoom === currentZoom) return;
  
  // Position des Mauszeigers relativ zum Scroll-Container
  const containerRect = scrollContainer.getBoundingClientRect();
  const mouseX = event.clientX - containerRect.left + scrollContainer.scrollLeft;
  const mouseY = event.clientY - containerRect.top + scrollContainer.scrollTop;
  
  // Bildgröße anpassen
  const naturalWidth = uploadedImage.naturalWidth;
  const naturalHeight = uploadedImage.naturalHeight;
  
  const oldWidth = parseFloat(editorImage.style.width);
  const oldHeight = parseFloat(editorImage.style.height);
  
  const newWidth = naturalWidth * newZoom;
  const newHeight = naturalHeight * newZoom;
  
  editorImage.style.width = `${newWidth}px`;
  editorImage.style.height = `${newHeight}px`;
  
  // Canvas-Zoom aktualisieren
  canvas.setZoom(newZoom);
  
  // Canvas-Container-Größe anpassen
  const canvasContainer = document.getElementsByClassName('canvas-container')[0];
  if (canvasContainer) {
    canvasContainer.style.width = `${newWidth}px`;
    canvasContainer.style.height = `${newHeight}px`;
  }
  
  // Scroll-Position anpassen, um Zoom zum Mauszeiger zu ermöglichen
  const scaleChange = newZoom / currentZoom;
  
  // Berechne neue Scroll-Position
  const newScrollX = mouseX * scaleChange - (event.clientX - containerRect.left);
  const newScrollY = mouseY * scaleChange - (event.clientY - containerRect.top);
  
  scrollContainer.scrollLeft = newScrollX;
  scrollContainer.scrollTop = newScrollY;
  
  // Canvas neu rendern
  canvas.renderAll();
  
  // Globalen Zoom-Wert aktualisieren
  window.currentZoom = newZoom;
  
  // WICHTIG: BEIDE Zoom-Buttons aktualisieren
  // 1. Editor-Zoom-Button
  const editorZoomBtn = document.getElementById('editorResetZoomBtn');
  if (editorZoomBtn) {
    editorZoomBtn.textContent = `${Math.round(newZoom * 100)}%`;
  }
  
  // 2. Ansichtsview-Zoom-Button
  const viewZoomBtn = document.getElementById('resetZoomBtn');
  if (viewZoomBtn) {
    viewZoomBtn.textContent = `${Math.round(newZoom * 100)}%`;
  }
  
  // 3. Auch globalen Zoom-Wert aktualisieren, falls die Funktion existiert
  if (typeof window.setZoomLevel === 'function') {
    // Der Aufruf sollte nicht triggern, dass der Canvas neu gezeichnet wird
    // Daher nur den internen Wert setzen
    window.currentZoom = newZoom;
    // Falls explizite Funktion zum stillen Update existiert
    if (typeof window.updateZoomLevel === 'function') {
      window.updateZoomLevel(newZoom);
    }
  }
  
  console.log(`Editor-Zoom geändert: ${currentZoom.toFixed(2)} -> ${newZoom.toFixed(2)}`);
}

// In fabric-handler.js, neue Funktion zur Zoom-Synchronisierung
export function synchronizeZoom(newZoom) {
  // Aktuellen Zoom speichern
  window.currentZoom = newZoom;
  
  // 1. Auf den Ansichtsview anwenden
  if (typeof window.setZoomLevel === 'function') {
      window.setZoomLevel(newZoom);
  }
  
  // 2. Auf den Editor anwenden, falls aktiv
  if (window.isEditorActive && canvas) {
      setEditorZoom(newZoom);
  }
  
  // 3. Zoom-Buttons aktualisieren
  const viewZoomBtn = document.getElementById('resetZoomBtn');
  if (viewZoomBtn) {
      viewZoomBtn.textContent = `${Math.round(newZoom * 100)}%`;
  }
  
  const editorZoomBtn = document.getElementById('editorResetZoomBtn');
  if (editorZoomBtn) {
      editorZoomBtn.textContent = `${Math.round(newZoom * 100)}%`;
  }
  
  console.log(`Zoom synchronisiert: ${newZoom.toFixed(2)}`);
}

// Und füge diese Funktion zum FabricHandler-Objekt hinzu
window.FabricHandler = {
  // ... bestehende Funktionen
  synchronizeZoom
};

/**
 * Editor-Zoom auf einen bestimmten Wert setzen
 * @param {number} zoomLevel - Der Zoom-Faktor
 */
export function setEditorZoom(zoomLevel) {
  if (!canvas) return;
  
  console.log(`Setting editor zoom to ${zoomLevel}`);
  
  // Bild ermitteln
  const editorImage = document.getElementById('editorImage');
  if (!editorImage) return;
  
  // Scroll-Container ermitteln
  const scrollContainer = document.querySelector('.scroll-container');
  if (!scrollContainer) return;
  
  // Bildgröße anpassen
  const naturalWidth = uploadedImage.naturalWidth;
  const naturalHeight = uploadedImage.naturalHeight;
  
  const newWidth = naturalWidth * zoomLevel;
  const newHeight = naturalHeight * zoomLevel;
  
  editorImage.style.width = `${newWidth}px`;
  editorImage.style.height = `${newHeight}px`;
  
  // Canvas-Zoom aktualisieren
  canvas.setZoom(zoomLevel);
  
  // Canvas-Container-Größe anpassen
  const canvasContainer = document.getElementsByClassName('canvas-container')[0];
  if (canvasContainer) {
      canvasContainer.style.width = `${newWidth}px`;
      canvasContainer.style.height = `${newHeight}px`;
  }
  
  // Zum Zentrum des Bildes scrollen ODER Position aus Ansichtsview übernehmen
  if (imageContainer && scrollContainer) {
      // Versuche, die Scroll-Position vom Ansichtsview zu übernehmen
      scrollContainer.scrollLeft = imageContainer.scrollLeft;
      scrollContainer.scrollTop = imageContainer.scrollTop;
  } else {
      // Fallback: Zum Zentrum scrollen
      const centerX = newWidth / 2 - scrollContainer.clientWidth / 2;
      const centerY = newHeight / 2 - scrollContainer.clientHeight / 2;
      
      scrollContainer.scrollLeft = Math.max(0, centerX);
      scrollContainer.scrollTop = Math.max(0, centerY);
  }
  
  // Canvas neu rendern
  canvas.renderAll();
  
  // Globalen Zoom-Wert aktualisieren
  window.currentZoom = zoomLevel;
  
  // Zoom-Anzeige aktualisieren, falls vorhanden
  const editorZoomBtn = document.getElementById('editorResetZoomBtn');
  if (editorZoomBtn) {
      editorZoomBtn.textContent = `${Math.round(zoomLevel * 100)}%`;
  }
  
  console.log(`Editor-Zoom gesetzt auf: ${zoomLevel.toFixed(2)}`);
}

// In fabric-handler.js, als neue exportierte Funktion:
/**
 * Aktualisiert die Anzeige der Annotationen, indem der Canvas neu initialisiert und die Annotationen neu gezeichnet werden
 */
export function refreshAnnotations() {
  console.log("Aktualisiere Annotations-Anzeige");
  
  // Canvas löschen und neu initialisieren
  clearAnnotations();
  
  // Neuen Canvas erstellen
  initCanvas();
  
  // Annotationen zeichnen, falls vorhanden
  if (window.data && window.data.predictions && window.data.predictions.length > 0) {
    console.log(`Zeichne ${window.data.predictions.length} Annotationen neu`);
    displayAnnotations(window.data.predictions);
  } else {
    console.warn("Keine Annotationen zum Zeichnen gefunden");
  }
  
  // Aktuellen Zoom anwenden
  if (typeof window.getCurrentZoom === 'function') {
    const currentZoom = window.getCurrentZoom();
    syncEditorZoom(currentZoom);
  }
}

// Expose functions through window.FabricHandler
window.FabricHandler = {
  // Canvas management
  initCanvas,
  getCanvas,
  clearAnnotations,
  resetView,
  
  // Editor-Initialisierung
  initEditor,
  
  // Drawing and editing
  enableDrawingMode,
  enableEditing,
  disableEditing,
  saveAnnotations,
  cancelEditing,
  reloadAnnotations,
  
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
  syncEditorZoom,
  setEditorZoom,
  synchronizeZoom
};