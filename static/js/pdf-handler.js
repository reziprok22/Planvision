/**
 * pdf-handler.js - Module for handling PDF files, navigation and analysis
 * Part of the Fenster-Erkennungstool project
 */

// Module state
let pdfSessionId = null;
let currentPdfPage = 1;
let totalPdfPages = 1;
let allPdfPages = [];
let pdfPageData = {};
let pageSettings = {};

// DOM references
let pdfNavigation;
let currentPageSpan;
let totalPagesSpan;
let prevPageBtn;
let nextPageBtn;
let reprocessBtn;
let loader;
let errorMessage;

// External callback reference
let displayPdfPageCallback = null;

/**
 * Initialize the PDF handler with required DOM elements
 * @param {Object} elements - Object containing DOM references
 */
export function setupPdfHandler(elements) {
  // Store DOM references
  pdfNavigation = elements.pdfNavigation;
  currentPageSpan = elements.currentPageSpan;
  totalPagesSpan = elements.totalPagesSpan;
  prevPageBtn = elements.prevPageBtn;
  nextPageBtn = elements.nextPageBtn;
  reprocessBtn = elements.reprocessBtn;
  loader = elements.loader;
  errorMessage = elements.errorMessage;
  
  // Set up event listeners
  prevPageBtn.addEventListener('click', function() {
    if (currentPdfPage > 1) {
      navigateToPdfPage(currentPdfPage - 1);
    }
  });
  
  nextPageBtn.addEventListener('click', function() {
    if (currentPdfPage < totalPdfPages) {
      navigateToPdfPage(currentPdfPage + 1);
    }
  });
  
  if (reprocessBtn) {
    reprocessBtn.addEventListener('click', function() {
      // Aktuelle Seite neu verarbeiten mit den momentanen Formularwerten
      navigateToPdfPage(currentPdfPage, true);
    });
  }
  
  console.log('PDF handler initialized');
}

/**
 * Set the callback for displaying PDF pages
 * @param {Function} callback - The function to call when displaying a PDF page
 */
export function setDisplayPageCallback(callback) {
  displayPdfPageCallback = callback;
}

/**
 * Process PDF data and store settings
 * @param {Object} responseData - The response data from the server
 */
export function processPdfData(responseData) {
  const isPdf = responseData.is_pdf || false;
  
  if (isPdf) {
    console.log("PDF detected:", isPdf);
    
    pdfSessionId = responseData.session_id || null;
    currentPdfPage = parseInt(responseData.current_page || 1);
    totalPdfPages = parseInt(responseData.page_count || 1);
    allPdfPages = responseData.all_pages || [];
    
    // Initialize settings for each page
    for (let i = 1; i <= totalPdfPages; i++) {
      if (!pageSettings[i]) {
        // Take values from the form as a base
        let formWidth = document.getElementById('formatWidth').value;
        let formHeight = document.getElementById('formatHeight').value;
        
        // If recognized page sizes are available, use them
        if (responseData.page_sizes && responseData.page_sizes.length >= i) {
          // Round the values and convert them to strings
          formWidth = String(Math.round(responseData.page_sizes[i-1][0]));
          formHeight = String(Math.round(responseData.page_sizes[i-1][1]));
          console.log(`Using detected page size for page ${i}: ${formWidth} × ${formHeight} mm`);
        }
        
        pageSettings[i] = {
          format_width: formWidth,
          format_height: formHeight,
          dpi: document.getElementById('dpi').value,
          plan_scale: document.getElementById('planScale').value,
          threshold: document.getElementById('threshold').value
        };
      }
    }
    
    // Update form fields with values for the current page
    if (pageSettings[currentPdfPage]) {
      document.getElementById('formatWidth').value = pageSettings[currentPdfPage].format_width;
      document.getElementById('formatHeight').value = pageSettings[currentPdfPage].format_height;
    }
    
    // Store current page data
    pdfPageData[currentPdfPage] = responseData;

    console.log("PDF Navigation Debug:", {
      totalPdfPages,
      pdfSessionId,
      anyPages: allPdfPages.length > 0
    });
    
    // Show navigation if multiple pages
    if (totalPdfPages > 1 && pdfSessionId) {
      updatePdfNavigation();
      pdfNavigation.style.display = 'flex';

      // Show loading indicator for background processing
      showBackgroundProcessingIndicator();
      
      // Start background processing after a short delay
      setTimeout(() => {
        processRemainingPagesInBackground();
      }, 1000);
    } else {
      pdfNavigation.style.display = 'none';
    }
  } else {
    pdfNavigation.style.display = 'none';
  }
}

/**
 * Navigate to a specific PDF page
 * @param {number} pageNumber - The page number to navigate to
 * @param {boolean} forceReprocess - Whether to force reprocessing
 */
export function navigateToPdfPage(pageNumber, forceReprocess = false) {
  console.log(`Navigating to PDF page ${pageNumber} of ${totalPdfPages}, Force reprocess: ${forceReprocess}`);
  
  // Save current edits of the current page
  if (window.data && currentPdfPage) {
    console.log(`Saving data for page ${currentPdfPage} with ${window.data.predictions?.length || 0} predictions`);
    pdfPageData[currentPdfPage] = JSON.parse(JSON.stringify(window.data));
  }
  
  // If we already have data for this page and no reprocessing is forced
  if (!forceReprocess && pdfPageData[pageNumber]) {
    console.log(`Using stored data for page ${pageNumber}`);
    
    // Update current page
    currentPdfPage = pageNumber;
    
    // Use stored data
    if (displayPdfPageCallback) {
      displayPdfPageCallback(pageNumber, pdfPageData[pageNumber]);
    }
    return;
  }
  
  // If reprocessing is forced, update settings for this page
  if (forceReprocess) {
    const pageSizes = window.data.page_sizes || [];
    
    // Only use form values if no detected page sizes
    let formatWidth = document.getElementById('formatWidth').value;
    let formatHeight = document.getElementById('formatHeight').value;
    
    // If page sizes for this specific page exist, use them
    if (pageSizes.length >= pageNumber) {
      // Use detected page sizes (as string)
      formatWidth = String(Math.round(pageSizes[pageNumber-1][0]));
      formatHeight = String(Math.round(pageSizes[pageNumber-1][1]));
      console.log(`Using detected size for reprocessing page ${pageNumber}: ${formatWidth} × ${formatHeight} mm`);
    }
    
    pageSettings[pageNumber] = {
      format_width: formatWidth,
      format_height: formatHeight,
      dpi: document.getElementById('dpi').value,
      plan_scale: document.getElementById('planScale').value,
      threshold: document.getElementById('threshold').value
    };
    
    console.log(`Settings for page ${pageNumber} updated:`, pageSettings[pageNumber]);
  }
  
  // Update UI status
  loader.style.display = 'block';
  errorMessage.style.display = 'none';
  
  // Prepare form data
  const formData = new FormData();
  formData.append('session_id', pdfSessionId);
  formData.append('page', pageNumber);
  
  // Use settings for this page
  formData.append('format_width', pageSettings[pageNumber].format_width);
  formData.append('format_height', pageSettings[pageNumber].format_height);
  formData.append('dpi', pageSettings[pageNumber].dpi);
  formData.append('plan_scale', pageSettings[pageNumber].plan_scale);
  formData.append('threshold', pageSettings[pageNumber].threshold);
  
  console.log(`API call for page ${pageNumber} with settings:`, {
    width: pageSettings[pageNumber].format_width,
    height: pageSettings[pageNumber].format_height,
    dpi: pageSettings[pageNumber].dpi,
    scale: pageSettings[pageNumber].plan_scale,
    threshold: pageSettings[pageNumber].threshold
  });
  
  // API call for page analysis
  fetch('/analyze_page', {
    method: 'POST',
    body: formData
  })
  .then(response => response.json())
  .then(data => {
    // Process the response data to include needed fields
    const processedData = window.processApiResponse ? 
      window.processApiResponse(data) : data;
    
    // Add PDF info back
    processedData.is_pdf = data.is_pdf || false;
    processedData.pdf_image_url = data.pdf_image_url || null;
    processedData.session_id = data.session_id;
    processedData.current_page = data.current_page;
    processedData.page_count = data.page_count;
    processedData.all_pages = data.all_pages;
    processedData.page_sizes = data.page_sizes || [];
    
    // Update global variables
    pdfSessionId = data.session_id;
    currentPdfPage = parseInt(data.current_page);
    totalPdfPages = parseInt(data.page_count);
    allPdfPages = data.all_pages;
    
    // Store data for this page
    pdfPageData[pageNumber] = processedData;
    
    // Display results
    if (displayPdfPageCallback) {
      displayPdfPageCallback(pageNumber, processedData);
    }
  })
  .catch(error => {
    console.error('Error:', error);
    errorMessage.textContent = 'Error: ' + error.message;
    errorMessage.style.display = 'block';
  })
  .finally(() => {
    loader.style.display = 'none';
  });
}

/**
 * Update PDF navigation UI
 */
export function updatePdfNavigation() {
  // Update navigation UI
  if (currentPageSpan && totalPagesSpan) {
    currentPageSpan.textContent = currentPdfPage;
    totalPagesSpan.textContent = totalPdfPages;
    
    // Enable/disable buttons based on current page
    if (prevPageBtn) prevPageBtn.disabled = currentPdfPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPdfPage >= totalPdfPages;
  }
}

/**
 * Show background processing indicator
 */
function showBackgroundProcessingIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'backgroundProcessingIndicator';
  indicator.className = 'background-processing';
  indicator.innerHTML = `
    <div class="processing-spinner"></div>
    <span>Analyzing additional pages in background: <span id="processedPagesCount">1</span>/${totalPdfPages}</span>
  `;
  document.body.appendChild(indicator);
}

/**
 * Process remaining PDF pages in background
 */
function processRemainingPagesInBackground() {
  const indicator = document.getElementById('backgroundProcessingIndicator');
  const counter = document.getElementById('processedPagesCount');
  
  // Start with page 2, since page 1 is already loaded
  let currentProcessingPage = 2;
  
  function processNextPage() {
    if (currentProcessingPage > totalPdfPages) {
      // All pages processed
      if (indicator) {
        indicator.innerHTML = `<span>All ${totalPdfPages} pages analyzed!</span>`;
        // Hide indicator after a short delay
        setTimeout(() => {
          indicator.style.opacity = '0';
          setTimeout(() => indicator.remove(), 500);
        }, 3000);
      }
      return;
    }
    
    // Show current progress
    if (counter) counter.textContent = currentProcessingPage;
  
    // Do page analysis in background
    const formData = new FormData();
    formData.append('session_id', pdfSessionId);
    formData.append('page', currentProcessingPage);
    
    // Make sure we use the correct settings for THIS page
    let currentPageSettings = pageSettings[currentProcessingPage];
    
    // If no settings for this page, create them
    if (!currentPageSettings) {
      // Take values from the form as a base
      let formWidth = document.getElementById('formatWidth').value;
      let formHeight = document.getElementById('formatHeight').value;
      
      // If detected page sizes are available, use them for the respective page
      if (window.data && window.data.page_sizes && window.data.page_sizes.length >= currentProcessingPage) {
        // Round the values and convert them to strings
        formWidth = String(Math.round(window.data.page_sizes[currentProcessingPage-1][0]));
        formHeight = String(Math.round(window.data.page_sizes[currentProcessingPage-1][1]));
        console.log(`Using detected page size for page ${currentProcessingPage}: ${formWidth} × ${formHeight} mm`);
      }
      
      currentPageSettings = {
        format_width: formWidth,
        format_height: formHeight,
        dpi: document.getElementById('dpi').value,
        plan_scale: document.getElementById('planScale').value,
        threshold: document.getElementById('threshold').value
      };
      
      // Save the settings
      pageSettings[currentProcessingPage] = currentPageSettings;
    }
    
    formData.append('format_width', currentPageSettings.format_width);
    formData.append('format_height', currentPageSettings.format_height);
    formData.append('dpi', currentPageSettings.dpi);
    formData.append('plan_scale', currentPageSettings.plan_scale);
    formData.append('threshold', currentPageSettings.threshold);
    
    fetch('/analyze_page', {
      method: 'POST',
      body: formData
    })
    .then(response => response.json())
    .then(data => {
      // Process data and store
      const processedData = window.processApiResponse ? 
        window.processApiResponse(data) : data;
      
      // Add PDF info back
      processedData.is_pdf = data.is_pdf || false;
      processedData.pdf_image_url = data.pdf_image_url || null;
      processedData.session_id = data.session_id;
      processedData.current_page = data.current_page;
      processedData.page_count = data.page_count;
      processedData.all_pages = data.all_pages;
      
      // Store in pdfPageData
      pdfPageData[currentProcessingPage] = processedData;
      
      console.log(`Page ${currentProcessingPage} analyzed in background`);
      
      // Go to next page
      currentProcessingPage++;
      // Short pause between requests
      setTimeout(processNextPage, 500);
    })
    .catch(error => {
      console.error(`Error analyzing page ${currentProcessingPage}:`, error);
      
      // Continue despite errors
      currentProcessingPage++;
      setTimeout(processNextPage, 500);
    });
  }
  
  // Start processing
  processNextPage();
}

/**
 * Reset PDF state
 */
export function resetPdfState() {
  pdfSessionId = null;
  currentPdfPage = 1;
  totalPdfPages = 1;
  allPdfPages = [];
  pdfPageData = {};
  pageSettings = {};

  // Add a check to ensure pdfNavigation exists before accessing its style
  if (pdfNavigation) {
    pdfNavigation.style.display = 'none';
  } else {
    console.warn('pdfNavigation element is undefined in resetPdfState');
  }
}

/**
 * Get current PDF session ID
 * @returns {string} The PDF session ID
 */
export function getPdfSessionId() {
  return pdfSessionId;
}

/**
 * Set PDF session ID
 * @param {string} sessionId - The PDF session ID
 */
export function setPdfSessionId(sessionId) {
  pdfSessionId = sessionId;
}

/**
 * Get PDF page data for all pages
 * @returns {Object} The PDF page data
 */
export function getPdfPageData() {
  return pdfPageData;
}

/**
 * Set PDF page data
 * @param {Object} data - The PDF page data
 */
export function setPdfPageData(data) {
  pdfPageData = data;
}

/**
 * Get page settings for all pages
 * @returns {Object} The page settings
 */
export function getPageSettings() {
  return pageSettings;
}

/**
 * Set page settings
 * @param {Object} settings - The page settings
 */
export function setPageSettings(settings) {
  pageSettings = settings;
}

// Make key functions available globally
window.resetPdfState = resetPdfState;
window.processPdfData = processPdfData;
window.pdfPageData = pdfPageData;

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
 * Duplicate an annotation with its associated labels
 * @param {Object} obj - The Fabric.js object to duplicate
 */
function duplicateAnnotation(obj) {
  if (!obj.objectType === 'annotation') return;
  
  // Clone the object
  obj.clone(function(clonedObj) {
    // Offset position slightly
    clonedObj.set({
      left: clonedObj.left + 20,
      top: clonedObj.top + 20
    });
    
    // Add to canvas
    canvas.add(clonedObj);
    
    // Find associated label text
    canvas.getObjects().forEach(function(o) {
      if (o.objectType === 'label' && o.annotationIndex === obj.annotationIndex) {
        // Clone the label
        o.clone(function(clonedLabel) {
          // Adjust position to match the cloned object
          clonedLabel.set({
            left: clonedLabel.left + 20,
            top: clonedLabel.top + 20
          });
          
          // Add to canvas
          canvas.add(clonedLabel);
          canvas.bringToFront(clonedLabel);
        });
      }
    });
    
    // Render
    canvas.renderAll();
  });
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
 * Enable polygon drawing mode
 * @param {number} labelId - The label ID to assign
 */
function enablePolygonDrawing(labelId) {
  let points = [];
  let polygon;
  let lines = [];
  
  // Remove existing handlers
  canvas.off('mouse:down');
  canvas.off('mouse:move');
  canvas.off('mouse:up');
  canvas.off('mouse:dblclick');
  
  // Mouse down handler
  canvas.on('mouse:down', function(o) {
    const pointer = canvas.getPointer(o.e);
    
    // Check if this is a double click
    if (o.e.detail === 2 && points.length > 2) {
      // Double click - finish polygon
      finishPolygon();
      return;
    }
    
    // Add point
    points.push({
      x: pointer.x,
      y: pointer.y
    });
    
    // If this is the first point
    if (points.length === 1) {
      // Create a circle to mark the first point
      const circle = new fabric.Circle({
        left: pointer.x - 4,
        top: pointer.y - 4,
        radius: 4,
        fill: 'red',
        selectable: false,
        evented: false
      });
      canvas.add(circle);
    } else {
      // Draw line segment to previous point
      const line = new fabric.Line([
        points[points.length - 2].x,
        points[points.length - 2].y,
        pointer.x,
        pointer.y
      ], {
        stroke: 'red',
        selectable: false,
        evented: false
      });
      canvas.add(line);
      lines.push(line);
    }
    
    canvas.renderAll();
  });
  
  // Mouse move handler
  canvas.on('mouse:move', function(o) {
    if (points.length === 0) return;
    
    const pointer = canvas.getPointer(o.e);
    
    // If we have an active line, update it
    if (lines.length > 0) {
      const activeLine = lines[lines.length - 1];
      activeLine.set({
        x2: pointer.x,
        y2: pointer.y
      });
    }
    
    canvas.renderAll();
  });
  
  // Double click handler to finish polygon
  canvas.on('mouse:dblclick', function() {
    if (points.length > 2) {
      finishPolygon();
    }
  });
  
  // Function to finish and create the polygon
  function finishPolygon() {
    if (points.length < 3) return;
    
    // Remove guide lines and points
    lines.forEach(function(line) {
      canvas.remove(line);
    });
    
    // Remove first point marker
    canvas.getObjects().forEach(function(obj) {
      if (obj.type === 'circle' && obj.fill === 'red') {
        canvas.remove(obj);
      }
    });
    
    // Get color for the label
    let color = 'gray';
    let labelName = 'Other';
    
    const label = currentLabels.find(l => l.id === labelId);
    if (label) {
      color = label.color;
      labelName = label.name;
    }
    
    // Create polygon
    polygon = new fabric.Polygon(points, {
      fill: color + '20',
      stroke: color,
      strokeWidth: 2,
      objectType: 'annotation',
      annotationType: 'polygon',
      labelId: labelId,
      labelName: labelName
    });
    
    // Calculate area
    const area = calculatePolygonArea(points);
    polygon.area = area;
    
    // Add to canvas
    canvas.add(polygon);
    
    // Create label text
    const labelText = `#${canvas.getObjects().filter(obj => obj.objectType === 'annotation').length}: ${area.toFixed(2)} m²`;
    
    // Calculate centroid for label positioning
    let centerX = 0, centerY = 0;
    for (let i = 0; i < points.length; i++) {
      centerX += points[i].x;
      centerY += points[i].y;
    }
    centerX /= points.length;
    centerY /= points.length;
    
    // Create text
    const text = new fabric.Text(labelText, {
      left: centerX,
      top: centerY - 20,
      fontSize: 12,
      fill: 'white',
      backgroundColor: color,
      padding: 5,
      objectType: 'label',
      annotationIndex: canvas.getObjects().indexOf(polygon)
    });
    
    // Add text
    canvas.add(text);
    canvas.bringToFront(text);
    
    // Reset for next polygon
    points = [];
    lines = [];
    polygon = null;
    
    canvas.renderAll();
  }
}

/**
 * Enable line drawing mode
 * @param {number} labelId - The label ID to assign
 */
function enableLineDrawing(labelId) {
  let points = [];
  let line;
  let circles = [];
  let textLabel;
  
  // Remove existing handlers
  canvas.off('mouse:down');
  canvas.off('mouse:move');
  canvas.off('mouse:up');
  canvas.off('mouse:dblclick');
  
  // Mouse down handler
  canvas.on('mouse:down', function(o) {
    const pointer = canvas.getPointer(o.e);
    
    // Check if this is a double click
    if (o.e.detail === 2 && points.length > 1) {
      // Double click - finish line
      finishLine();
      return;
    }
    
    // Add point
    points.push({
      x: pointer.x,
      y: pointer.y
    });
    
    // Create a circle to mark the point
    const circle = new fabric.Circle({
      left: pointer.x - 4,
      top: pointer.y - 4,
      radius: 4,
      fill: '#FF9500',
      selectable: false,
      evented: false
    });
    canvas.add(circle);
    circles.push(circle);
    
    // If we have at least two points, draw or update the line
    if (points.length > 1) {
      if (line) {
        // Update existing line
        line.set({
          points: points
        });
      } else {
        // Create new line
        line = new fabric.Polyline(points, {
          stroke: '#FF9500',
          strokeWidth: 2,
          fill: '',
          selectable: false,
          evented: false
        });
        canvas.add(line);
      }
      
      // Calculate length
      const length = calculateLineLength(points);
      
      // Update or create text label
      if (textLabel) {
        textLabel.set({
          text: `${length.toFixed(2)} m`,
          left: pointer.x + 5,
          top: pointer.y - 15
        });
      } else {
        textLabel = new fabric.Text(`${length.toFixed(2)} m`, {
          left: pointer.x + 5,
          top: pointer.y - 15,
          fontSize: 12,
          fill: '#FF9500',
          selectable: false,
          evented: false
        });
        canvas.add(textLabel);
      }
    }
    
    canvas.renderAll();
  });
  
  // Mouse move handler
  canvas.on('mouse:move', function(o) {
    if (points.length === 0) return;
    
    const pointer = canvas.getPointer(o.e);
    
    // If we have a line, update it
    if (line) {
      const tempPoints = [...points, { x: pointer.x, y: pointer.y }];
      line.set({
        points: tempPoints
      });
      
      // Calculate length
      const length = calculateLineLength(tempPoints);
      
      // Update text label
      if (textLabel) {
        textLabel.set({
          text: `${length.toFixed(2)} m`,
          left: pointer.x + 5,
          top: pointer.y - 15
        });
      }
      
      canvas.renderAll();
    }
  });
  
  // Double click handler to finish line
  canvas.on('mouse:dblclick', function() {
    if (points.length > 1) {
      finishLine();
    }
  });
  
  // Function to finish the line
  function finishLine() {
    if (points.length < 2) return;
    
    // Remove temporary guides
    if (textLabel) {
      canvas.remove(textLabel);
    }
    
    // Get color from label ID
    const selectedLabel = labelId ? 
      currentLabels.find(l => l.id === labelId) : 
      { color: '#FF9500', name: 'Measurement' };
    
    const lineColor = selectedLabel ? selectedLabel.color : '#FF9500';
    
    // Create final line
    const finalLine = new fabric.Polyline(points, {
      stroke: lineColor,
      strokeWidth: 2,
      fill: '',
      objectType: 'annotation',
      annotationType: 'line',
      labelId: labelId,
      length: calculateLineLength(points)
    });
    
    // Add to canvas
    canvas.add(finalLine);
    
    // Create final circles at points
    const finalCircles = [];
    for (let i = 0; i < points.length; i++) {
      const finalCircle = new fabric.Circle({
        left: points[i].x - 4,
        top: points[i].y - 4,
        radius: 4,
        fill: lineColor,
        stroke: '#fff',
        strokeWidth: 1,
        objectType: 'linePoint',
        lineIndex: canvas.getObjects().indexOf(finalLine),
        pointIndex: i
      });
      canvas.add(finalCircle);
      finalCircles.push(finalCircle);
    }
    
    // Create final text label
    const lastPoint = points[points.length - 1];
    const finalText = new fabric.Text(`${calculateLineLength(points).toFixed(2)} m`, {
      left: lastPoint.x + 5,
      top: lastPoint.y - 15,
      fontSize: 12,
      fill: lineColor,
      objectType: 'label',
      annotationIndex: canvas.getObjects().indexOf(finalLine)
    });
    
    // Add text
    canvas.add(finalText);
    canvas.bringToFront(finalText);
    
    // Remove temporary objects
    if (line) {
      canvas.remove(line);
    }
    
    circles.forEach(function(circle) {
      canvas.remove(circle);
    });
    
    // Reset for next line
    points = [];
    line = null;
    circles = [];
    textLabel = null;
    
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
  if (typeof PdfModule !== 'undefined' && 
      typeof PdfModule.getPdfPageData === 'function' && 
      typeof PdfModule.getPdfSessionId === 'function') {
    
    const pageData = PdfModule.getPdfPageData();
    const currentPage = PdfModule.getCurrentPage();
    
    if (pageData && currentPage) {
      pageData[currentPage] = window.data;
    }
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
  if (typeof updateSummary === 'function') {
    updateSummary();
  }
  
  if (typeof updateResultsTable === 'function') {
    updateResultsTable();
  }
}