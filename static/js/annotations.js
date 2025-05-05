/**
 * annotations.js - Module for handling annotations (boxes, polygons, lines)
 * Part of the Fenster-Erkennungstool project
 */

// DOM references
let imageContainer;
let uploadedImage;
let annotationOverlay;
let currentLabels;
let currentLineLabels;

/**
 * Initialize the annotations module with required DOM elements
 * @param {Object} elements - Object containing DOM references
 */
export function setupAnnotations(elements) {
  imageContainer = elements.imageContainer;
  uploadedImage = elements.uploadedImage;
  annotationOverlay = elements.annotationOverlay;
  currentLabels = window.currentLabels || [];
  currentLineLabels = window.currentLineLabels || [];
  
  console.log('Annotations module initialized');
}

/**
 * Add an annotation (rectangle, polygon, or line) to the SVG overlay
 * @param {Object} prediction - The prediction data
 * @param {number} index - The index of the prediction
 */
export function addAnnotation(prediction, index) {
  console.log("Adding annotation:", index, prediction);
  
  // Calculate the scale factor
  const scale = uploadedImage.width / uploadedImage.naturalWidth;
  console.log("Scale factor:", scale, "Image width:", uploadedImage.width, "Natural width:", uploadedImage.naturalWidth);
  
  const elementId = `annotation-${index}`;
  
  // Class prefix based on category
  let classPrefix;
  let color;
  
  // Ensure we have access to current labels
  const labels = window.currentLabels || currentLabels;
  const lineLabels = window.currentLineLabels || currentLineLabels;
  
  // Find the corresponding label
  const label = labels.find(l => l.id === prediction.label);
  
  if (label) {
    // Use the name as class prefix and the defined color
    classPrefix = label.name.toLowerCase()
      .replace('ä', 'ae')
      .replace('ö', 'oe')
      .replace('ü', 'ue')
      .replace(' ', '_');
    color = label.color;
  } else {
    // Fallback for unknown labels
    switch(prediction.label) {
      case 1: classPrefix = 'fenster'; color = 'blue'; break;
      case 2: classPrefix = 'tuer'; color = 'red'; break;
      case 3: classPrefix = 'wand'; color = '#d4d638'; break;
      case 4: classPrefix = 'lukarne'; color = 'orange'; break;
      case 5: classPrefix = 'dach'; color = 'purple'; break;
      default: classPrefix = 'other'; color = 'gray';
    }
  }
  
  // Prepare label text based on type
  let labelText;
  
  if (prediction.type === "line" && prediction.length !== undefined) {
    labelText = `#${index + 1}: ${prediction.length.toFixed(2)} m`;
    // For lines, use the stored color if available
    color = prediction.color || '#FF9500'; // Fallback to orange if no color set
    classPrefix = 'line';
  } else {
    if (prediction.area !== undefined) {
      labelText = `#${index + 1}: ${prediction.area.toFixed(2)} m²`;
    } else {
      labelText = `#${index + 1}`;
    }
  }
  
  // Handle different types (rectangle, polygon, or line)
  if (prediction.type === "rectangle" || prediction.box || prediction.bbox) {
    addRectangleAnnotation(prediction, index, scale, classPrefix, color, labelText, elementId);
  } else if (prediction.type === "polygon" && prediction.polygon) {
    addPolygonAnnotation(prediction, index, scale, classPrefix, color, labelText, elementId);
  } else if ((prediction.type === "line" && prediction.line) || (prediction.type === "line" && prediction.length !== undefined)) {
    addLineAnnotation(prediction, index, scale, color, labelText, elementId);
  }
}

/**
 * Add a rectangle annotation
 * @private
 */
function addRectangleAnnotation(prediction, index, scale, classPrefix, color, labelText, elementId) {
  const [x1, y1, x2, y2] = prediction.box || prediction.bbox;
  
  // Skalierte Koordinaten
  const scaledX1 = x1 * scale;
  const scaledY1 = y1 * scale;
  const scaledWidth = (x2 - x1) * scale;
  const scaledHeight = (y2 - y1) * scale;
  
  // Create SVG rectangle instead of div
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", scaledX1);
  rect.setAttribute("y", scaledY1);
  rect.setAttribute("width", scaledWidth);
  rect.setAttribute("height", scaledHeight);
  rect.setAttribute("class", `rect-annotation ${classPrefix}-annotation`);
  rect.id = elementId;
  
  // Apply color directly
  if (color) {
    rect.style.fill = `${color}20`; // 20% opacity
    rect.style.stroke = color;
  }
  
  // Add to SVG overlay
  annotationOverlay.appendChild(rect);
  
  // Add label
  addLabel(scaledX1, scaledY1 - 20, labelText, elementId, classPrefix, color);
}

/**
 * Add a polygon annotation
 * @private
 */
function addPolygonAnnotation(prediction, index, scale, classPrefix, color, labelText, elementId) {
  // Polygon-Daten extrahieren
  const { all_points_x, all_points_y } = prediction.polygon;
  
  if (!all_points_x || !all_points_y || all_points_x.length < 3) {
    console.warn("Ungültiges Polygon gefunden:", prediction);
    return;
  }
  
  // Skalierte Punkte für das SVG-Polygon
  const scaledPoints = [];
  for (let i = 0; i < all_points_x.length; i++) {
    scaledPoints.push(`${all_points_x[i] * scale},${all_points_y[i] * scale}`);
  }
  
  // SVG-Polygon erstellen
  const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  polygon.setAttribute("points", scaledPoints.join(" "));
  polygon.setAttribute("class", `polygon-annotation ${classPrefix}-annotation`);
  polygon.id = elementId;
  
  // Farbe direkt anwenden
  if (color) {
    polygon.style.fill = `${color}20`; // Mit 20% Opacity
    polygon.style.stroke = color;
  }
  
  annotationOverlay.appendChild(polygon);
  
  // Berechne den Schwerpunkt für das Label
  let centerX = 0, centerY = 0;
  for (let i = 0; i < all_points_x.length; i++) {
    centerX += all_points_x[i] * scale;
    centerY += all_points_y[i] * scale;
  }
  centerX /= all_points_x.length;
  centerY /= all_points_y.length;
  
  // Label am Schwerpunkt hinzufügen
  addLabel(centerX, centerY - 20, labelText, elementId, classPrefix, color);
}

/**
 * Add a line annotation
 * @private
 */
function addLineAnnotation(prediction, index, scale, color, labelText, elementId) {
  // Spezieller Fall für Linien
  const { all_points_x, all_points_y } = prediction.line || { all_points_x: [], all_points_y: [] };
  
  if (!all_points_x || !all_points_y || all_points_x.length < 2) {
    console.warn("Ungültige Linie gefunden:", prediction);
    return;
  }
  
  // Get the line color (from prediction or use default orange)
  const lineColor = color || prediction.color || "#FF9500";
  
  // SVG-Linie erstellen als Pfad (path)
  const linePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  
  // Pfad erstellen (move to first point, then line to all other points)
  let pathData = `M ${all_points_x[0] * scale},${all_points_y[0] * scale}`;
  for (let i = 1; i < all_points_x.length; i++) {
    pathData += ` L ${all_points_x[i] * scale},${all_points_y[i] * scale}`;
  }
  
  linePath.setAttribute("d", pathData);
  linePath.setAttribute("class", "line-annotation");
  linePath.id = elementId;
  
  // Farbe direkt anwenden
  linePath.style.stroke = lineColor; // Use the color from the line object
  linePath.style.strokeWidth = "2px";
  linePath.style.fill = "none";
  
  annotationOverlay.appendChild(linePath);
  
  // Füge Punkte an den Eckpunkten hinzu
  for (let i = 0; i < all_points_x.length; i++) {
    const point = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    point.setAttribute("cx", all_points_x[i] * scale);
    point.setAttribute("cy", all_points_y[i] * scale);
    point.setAttribute("r", "4");
    point.setAttribute("fill", lineColor); // Use same color for points
    point.setAttribute("class", "line-point");
    annotationOverlay.appendChild(point);
  }
  
  // Label am Ende der Linie hinzufügen
  const lastX = all_points_x[all_points_x.length - 1] * scale;
  const lastY = all_points_y[all_points_y.length - 1] * scale;
  
  addLabel(lastX + 5, lastY - 5, labelText, elementId, "line", lineColor);
}

/**
 * Add a label to an annotation
 * @param {number} x - The x coordinate
 * @param {number} y - The y coordinate
 * @param {string} text - The label text
 * @param {string} parentId - The ID of the parent element
 * @param {string} classPrefix - The class prefix
 * @param {string} color - The color of the label
 * @returns {Element} The created label element
 */
export function addLabel(x, y, text, parentId, classPrefix, color) {
  // Create an SVG text element instead of a div
  const label = document.createElementNS("http://www.w3.org/2000/svg", "g");
  label.id = `label-${parentId}`;
  label.setAttribute("class", `svg-label ${classPrefix}-label`);
  
  // Create a background rectangle
  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("rx", "3"); // Rounded corners
  background.setAttribute("ry", "3");
  
  // Set the background color
  if (color) {
    background.setAttribute("fill", color);
  } else {
    // Default colors based on class prefix if no specific color
    switch(classPrefix) {
      case 'fenster': background.setAttribute("fill", "blue"); break;
      case 'tuer': background.setAttribute("fill", "red"); break;
      case 'wand': background.setAttribute("fill", "#d4d638"); break;
      case 'lukarne': background.setAttribute("fill", "orange"); break;
      case 'dach': background.setAttribute("fill", "purple"); break;
      case 'line': background.setAttribute("fill", "#FF9500"); break;
      default: background.setAttribute("fill", "gray");
    }
  }
  
  // Create the text element
  const textElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
  textElement.setAttribute("fill", "white");
  textElement.setAttribute("font-size", "12");
  textElement.setAttribute("x", "5"); // Padding within the background
  textElement.setAttribute("y", "14"); // Text baseline position
  
  // Special color for labels that need darker text
  if (classPrefix === 'wand') {
    textElement.setAttribute("fill", "#333");
  }
  
  // Set the text content
  textElement.textContent = text;
  
  // Add elements to the group
  label.appendChild(background);
  label.appendChild(textElement);
  
  // Position the group
  label.setAttribute("transform", `translate(${x}, ${y - 20})`);
  
  // Add the label to the SVG overlay
  annotationOverlay.appendChild(label);
  
  // Now that the text is in the DOM, we can get its actual width
  const textWidth = textElement.getComputedTextLength();
  
  // Set the background width and height based on text dimensions
  background.setAttribute("width", textWidth + 10); // Text width plus padding
  background.setAttribute("height", "20");
  
  return label;
}

/**
 * Clear all annotations from the SVG overlay
 */
  // Check if annotationOverlay exists before trying to clear it
  export function clearAnnotations() {
    // Check if annotationOverlay exists before trying to clear it
    if (annotationOverlay) {
      // Clear all SVG elements including labels
      while (annotationOverlay.firstChild) {
        annotationOverlay.removeChild(annotationOverlay.firstChild);
      }
    } else {
      console.warn("annotationOverlay is not initialized yet");
    }
  }

/**
 * Highlight a specific annotation
 * @param {string} elementId - The ID of the element to highlight
 * @param {boolean} isHighlighted - Whether to highlight or unhighlight
 */
export function highlightBox(elementId, isHighlighted) {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  const labelElement = document.getElementById(`label-${elementId}`);
  if (!labelElement) return;
  
  if (isHighlighted) {
    // All elements use strokeWidth now
    element.style.strokeWidth = '3px';
    element.style.fillOpacity = '0.5';
    
    // For SVG labels, adjust opacity
    const labelRect = labelElement.querySelector('rect');
    if (labelRect) {
      labelRect.setAttribute('opacity', '1.0');
    }
  } else {
    element.style.strokeWidth = '2px';
    element.style.fillOpacity = '0.1';
    
    // For SVG labels, restore default opacity
    const labelRect = labelElement.querySelector('rect');
    if (labelRect) {
      labelRect.setAttribute('opacity', '0.8');
    }
  }
}

/**
 * Adapt SVG overlay to match the image
 */
export function adaptSvgOverlay() {
  // SVG an die Dimensionen und Position des Bildes anpassen
  const imageRect = uploadedImage.getBoundingClientRect();
  const containerRect = imageContainer.getBoundingClientRect();
  
  // Use natural dimensions instead of current dimensions
  const imageWidth = uploadedImage.naturalWidth;
  const imageHeight = uploadedImage.naturalHeight;
  
  // SVG auf gleiche Größe wie das Bild setzen
  annotationOverlay.setAttribute('width', imageWidth);
  annotationOverlay.setAttribute('height', imageHeight);
  
  // Position exakt an Bild ausrichten
  const offsetX = imageRect.left - containerRect.left;
  const offsetY = imageRect.top - containerRect.top;
  
  annotationOverlay.style.position = 'absolute';
  annotationOverlay.style.left = `${offsetX}px`;
  annotationOverlay.style.top = `${offsetY}px`;
  
  // ViewBox setzen für bessere Skalierung
  annotationOverlay.setAttribute('viewBox', `0 0 ${imageWidth} ${imageHeight}`);
  annotationOverlay.style.width = `${imageWidth}px`;
  annotationOverlay.style.height = `${imageHeight}px`;
  
  // After setting position and size, reposition all annotations
  repositionAllAnnotations();
}

/**
 * Reposition all annotations based on image scale
 */
export function repositionAllAnnotations() {
  // Get the current zoom level from the window object if available
  const currentZoom = (typeof window.getCurrentZoom === 'function') ? 
    window.getCurrentZoom() : 1.0;
    
  console.log("Repositioning annotations, zoom level:", currentZoom);

  // Berechne Skalierungsfaktoren
  const scaleX = uploadedImage.width / uploadedImage.naturalWidth;
  const scaleY = uploadedImage.height / uploadedImage.naturalHeight;
  
  // Erhalte tatsächliche Position des Bildes
  const imageRect = uploadedImage.getBoundingClientRect();
  const containerRect = imageContainer.getBoundingClientRect();
  
  // Berechne Offset
  const offsetX = imageRect.left - containerRect.left;
  const offsetY = imageRect.top - containerRect.top;
  
  console.log("Skalierung:", scaleX, scaleY, "Offset:", offsetX, offsetY);
  
  // 2. SVG-Elemente neu positionieren
  // Anstatt die einzelnen Elemente zu verschieben, passen wir das SVG-Overlay an
  annotationOverlay.style.left = `${offsetX}px`;
  annotationOverlay.style.top = `${offsetY}px`;

  // 2a. Rechtecke neu skalieren
  document.querySelectorAll('rect.rect-annotation').forEach(rect => {
    const id = rect.id;
    const index = parseInt(id.split('-')[1]);
    if (window.data && window.data.predictions && window.data.predictions[index]) {
      const pred = window.data.predictions[index];
      if (pred.box || pred.bbox) {
        const [x1, y1, x2, y2] = pred.box || pred.bbox;
        rect.setAttribute("x", x1 * scaleX);
        rect.setAttribute("y", y1 * scaleY);
        rect.setAttribute("width", (x2 - x1) * scaleX);
        rect.setAttribute("height", (y2 - y1) * scaleY);
      }
    }
  });
  
  // 2b. Polygone neu skalieren
  document.querySelectorAll('polygon.polygon-annotation').forEach(polygon => {
    const id = polygon.id;
    const index = parseInt(id.split('-')[1]);
    if (window.data && window.data.predictions && window.data.predictions[index]) {
      const pred = window.data.predictions[index];
      if (pred.polygon) {
        const { all_points_x, all_points_y } = pred.polygon;
        const scaledPoints = [];
        for (let i = 0; i < all_points_x.length; i++) {
          const x = all_points_x[i] * scaleX;
          const y = all_points_y[i] * scaleY;
          scaledPoints.push(`${x},${y}`);
        }
        polygon.setAttribute("points", scaledPoints.join(" "));
      }
    }
  });
  
  // 2c. Linien neu skalieren
  document.querySelectorAll('path.line-annotation').forEach(path => {
    const id = path.id;
    const index = parseInt(id.split('-')[1]);
    if (window.data && window.data.predictions && window.data.predictions[index]) {
      const pred = window.data.predictions[index];
      if (pred.line) {
        const { all_points_x, all_points_y } = pred.line;
        
        // Pfad neu erstellen
        let pathData = `M ${all_points_x[0] * scaleX},${all_points_y[0] * scaleY}`;
        for (let i = 1; i < all_points_x.length; i++) {
          pathData += ` L ${all_points_x[i] * scaleX},${all_points_y[i] * scaleY}`;
        }
        
        path.setAttribute("d", pathData);
      }
    }
  });
  
  // 2d. Linienpunkte neu skalieren
  document.querySelectorAll('circle.line-point').forEach(circle => {
    // Wir müssen die Zugehörigkeit zu einer Linie ermitteln
    const parentNodes = Array.from(annotationOverlay.children);
    const lineIndex = parentNodes.findIndex(node => 
      node.tagName.toLowerCase() === 'path' && 
      node.classList.contains('line-annotation'));
    
    if (lineIndex >= 0) {
      const lineId = parentNodes[lineIndex].id;
      const dataIndex = parseInt(lineId.split('-')[1]);
      const pred = window.data.predictions[dataIndex];
      
      if (pred && pred.line) {
        const { all_points_x, all_points_y } = pred.line;
        const circleIndex = Array.from(annotationOverlay.querySelectorAll('circle.line-point')).indexOf(circle);
        
        if (circleIndex < all_points_x.length) {
          circle.setAttribute("cx", all_points_x[circleIndex] * scaleX);
          circle.setAttribute("cy", all_points_y[circleIndex] * scaleY);
          circle.setAttribute("r", "4");
        }
      }
    }
  });

  // 3. Alle Labels neu positionieren
  document.querySelectorAll('g.svg-label').forEach(label => {
    const id = label.id.replace('label-', '');
    const index = parseInt(id.split('-')[1]);
    
    if (window.data && window.data.predictions && window.data.predictions[index]) {
      const pred = window.data.predictions[index];
      
      // Get the current transform to extract the translation components
      const transform = label.getAttribute('transform');
      
      if (pred.box || pred.bbox) {
        // For rectangle labels
        const [x1, y1] = pred.box || pred.bbox;
        const newX = x1 * scaleX;
        const newY = y1 * scaleY - 20; // Adjust for label height
        
        label.setAttribute("transform", `translate(${newX}, ${newY})`);
      } 
      else if (pred.polygon && pred.polygon.all_points_x && pred.polygon.all_points_y) {
        // For polygon labels - calculate centroid
        const { all_points_x, all_points_y } = pred.polygon;
        let centerX = 0, centerY = 0;
        
        for (let i = 0; i < all_points_x.length; i++) {
          centerX += all_points_x[i];
          centerY += all_points_y[i];
        }
        
        centerX = (centerX / all_points_x.length) * scaleX;
        centerY = (centerY / all_points_y.length) * scaleY - 20;
        
        label.setAttribute("transform", `translate(${centerX}, ${centerY})`);
      }
      else if (pred.type === "line" && pred.line) {
        // For line labels - position at the end point
        const { all_points_x, all_points_y } = pred.line;
        
        if (all_points_x && all_points_y && all_points_x.length > 0) {
          const lastX = all_points_x[all_points_x.length - 1] * scaleX;
          const lastY = all_points_y[all_points_y.length - 1] * scaleY - 5;
          
          label.setAttribute("transform", `translate(${lastX + 5}, ${lastY})`);
        }
      }
    }
  });
}