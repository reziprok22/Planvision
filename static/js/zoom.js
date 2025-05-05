/**
 * zoom.js - Module for handling image zooming functionality
 * Part of the Fenster-Erkennungstool project
 */

// Global variables for zoom functionality (dann braucht es let oder const nicht)
window.currentZoom = 1.0;
window.minZoom = 0.25;
window.maxZoom = 6.0;
window.zoomStep = 0.25;

// DOM references - will be initialized when setupZoom is called
let imageContainer;
let uploadedImage;
let annotationOverlay;
let resetZoomBtn;

/**
 * Initialize the zoom module with required DOM elements
 * @param {Object} elements - Object containing DOM references
 */
export function setupZoom(elements) {
  console.log("Setting up zoom module");
  
  // Store DOM references
  imageContainer = elements.imageContainer;
  uploadedImage = elements.uploadedImage;
  annotationOverlay = elements.annotationOverlay;
  resetZoomBtn = elements.resetZoomBtn;
  
  // Validate required elements
  if (!imageContainer || !uploadedImage || !annotationOverlay) {
    console.warn("Missing required elements for zoom functionality:", {
      imageContainer: !!imageContainer,
      uploadedImage: !!uploadedImage,
      annotationOverlay: !!annotationOverlay
    });
    
    // Create annotationOverlay if it doesn't exist
    if (imageContainer && !annotationOverlay) {
      annotationOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      annotationOverlay.id = "annotationOverlay";
      annotationOverlay.style.position = "absolute";
      annotationOverlay.style.top = "0";
      annotationOverlay.style.left = "0";
      annotationOverlay.style.pointerEvents = "none";
      annotationOverlay.style.zIndex = "5";
      imageContainer.appendChild(annotationOverlay);
      
      // Update the elements object to include the new overlay
      elements.annotationOverlay = annotationOverlay;
      console.log("Created missing annotationOverlay element");
    } else {
      return; // Exit if essential elements are still missing
    }
  }
  
  // Continue with setup...
  setupZoomEventListeners();
  // Set up event listeners after DOM elements are stored
  setupZoomEventListeners();
  
  // Add double-click event listener to reset zoom
  imageContainer.addEventListener('dblclick', function(event) {
    // Check if editor is active using the external variable
    const editorActive = typeof window.isEditorActive !== 'undefined' ? window.isEditorActive : false;
    
    // Only reset zoom on double click if editor is not active
    if (!editorActive) {
      resetZoom();
    }
  });
  
  // Set up zoom option buttons
  document.querySelectorAll('.zoom-option').forEach(option => {
    option.addEventListener('click', function(e) {
      console.log("Zoom option clicked:", this.dataset.zoom);
      const zoomLevel = parseFloat(this.dataset.zoom);
      setZoomLevel(zoomLevel);
      // Prevent the click from bubbling up
      e.stopPropagation();
    });
  });
  
  // Update the resetZoomBtn click handler
  if (resetZoomBtn) {
    resetZoomBtn.addEventListener('click', function() {
      setZoomLevel(1.0); // Reset to 100%
    });
  }
  
  console.log('Zoom module initialized successfully');
}

/**
 * Set up zoom event listeners
 */
export function setupZoomEventListeners() {
  console.log("Setting up zoom event listeners");
  
  // Check if imageContainer exists before using it
  if (!imageContainer) {
    console.warn("imageContainer not initialized yet, cannot set up zoom event listeners");
    return;
  }
  
  // Remove existing listeners first to avoid duplicates
  try {
    imageContainer.removeEventListener('wheel', handleZoom);
  } catch (error) {
    console.warn("Error removing wheel event listener:", error);
  }
  
  // Add the wheel event listener with the correct options
  try {
    imageContainer.addEventListener('wheel', handleZoom, { passive: false });
    console.log("Wheel event listener added to imageContainer");
  } catch (error) {
    console.error("Error adding wheel event listener:", error);
  }
}

/**
 * Handle mouse wheel zoom events
 * @param {Event} event - The wheel event
 */
export function handleZoom(event) {
  // Only handle zoom events when Ctrl key is pressed
  if (!event.ctrlKey) return;
  
  // Prevent default browser zoom behavior
  event.preventDefault();
  
  // Get the mouse position relative to the image container
  const rect = imageContainer.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  
  // Get the current scroll position
  const scrollLeft = imageContainer.scrollLeft;
  const scrollTop = imageContainer.scrollTop;
  
  // Calculate position within the scrolled content
  const mouseXInContent = mouseX + scrollLeft;
  const mouseYInContent = mouseY + scrollTop;
  
  // Determine zoom direction
  const delta = event.deltaY || event.detail || event.wheelDelta;
  const zoomIn = delta < 0;
  
  // Calculate new zoom level using global zoomStep
  let newZoom = window.currentZoom;
  if (zoomIn) {
    newZoom = Math.min(window.currentZoom + window.zoomStep, window.maxZoom);
  } else {
    newZoom = Math.max(window.currentZoom - window.zoomStep, window.minZoom);
  }
  
  // Only proceed if zoom level changed
  if (newZoom === window.currentZoom) return;
  
  // Calculate the scale ratio
  const ratio = newZoom / window.currentZoom;
  window.currentZoom = newZoom;
  
  // Apply zoom to the image and SVG overlay
  uploadedImage.style.transform = `scale(${window.currentZoom})`;
  uploadedImage.style.transformOrigin = 'top left';
  
  // Also apply the same transform to the SVG overlay
  annotationOverlay.style.transform = `scale(${window.currentZoom})`;
  annotationOverlay.style.transformOrigin = 'top left';
  
  // Calculate new scroll position to keep the mouse point fixed
  const newScrollLeft = mouseXInContent * ratio - mouseX;
  const newScrollTop = mouseYInContent * ratio - mouseY;
  
  // Set the new scroll position
  imageContainer.scrollLeft = newScrollLeft;
  imageContainer.scrollTop = newScrollTop;
  
  // Update all bounding boxes and labels
  updateAnnotationsForZoom();

  // Update the zoom button text
  if (resetZoomBtn) {
    resetZoomBtn.textContent = `${Math.round(window.currentZoom * 100)}%`;
  }
  
  // Display current zoom level
  showZoomLevel();

  // Notify editor of zoom change if it exists
  if (typeof window.syncEditorZoom === 'function') {
    window.syncEditorZoom(window.currentZoom);
  }
}

/**
 * Set zoom to a specific level
 * @param {number} level - The zoom level to set
 */
export function setZoomLevel(level) {
  console.log(`Setting zoom level to ${level}`);
  
  // Store old zoom for ratio calculation
  const oldZoom = window.currentZoom;
  window.currentZoom = level;
  
  // Get the center of the viewport
  const containerRect = imageContainer.getBoundingClientRect();
  const centerX = containerRect.width / 2;
  const centerY = containerRect.height / 2;
  
  // Get the current scroll position
  const scrollLeft = imageContainer.scrollLeft;
  const scrollTop = imageContainer.scrollTop;
  
  // Calculate position within the scrolled content
  const centerXInContent = centerX + scrollLeft;
  const centerYInContent = centerY + scrollTop;
  
  // Apply zoom to the image and SVG overlay
  uploadedImage.style.transform = `scale(${window.currentZoom})`;
  uploadedImage.style.transformOrigin = 'top left';
  
  annotationOverlay.style.transform = `scale(${window.currentZoom})`;
  annotationOverlay.style.transformOrigin = 'top left';
  
  // Calculate the scale ratio
  const ratio = window.currentZoom / oldZoom;
  
  // Calculate new scroll position to keep the center point fixed
  const newScrollLeft = centerXInContent * ratio - centerX;
  const newScrollTop = centerYInContent * ratio - centerY;
  
  // Set the new scroll position
  imageContainer.scrollLeft = newScrollLeft;
  imageContainer.scrollTop = newScrollTop;
  
  // Update all bounding boxes and labels
  updateAnnotationsForZoom();
  
  // Update the zoom button text
  if (resetZoomBtn) {
    resetZoomBtn.textContent = `${Math.round(window.currentZoom * 100)}%`;
  }
  
  // Display current zoom level
  showZoomLevel();
}

/**
 * Reset zoom to 100%
 */
export function resetZoom() {
  console.log("Resetting zoom from:", window.currentZoom, "to 1.0");

  window.currentZoom = 1.0;
  uploadedImage.style.transform = '';
  annotationOverlay.style.transform = '';
  
  // Reset all stored original positions
  document.querySelectorAll('[data-original-left]').forEach(el => {
    el.removeAttribute('data-original-left');
    el.removeAttribute('data-original-top');
    if (el.hasAttribute('data-original-width')) {
      el.removeAttribute('data-original-width');
      el.removeAttribute('data-original-height');
    }
  });
  
  showZoomLevel();
}

/**
 * Update annotation positions after zooming
 */
export function updateAnnotationsForZoom() {
  console.log("Updating annotations for zoom level:", window.currentZoom);
  
  // SVG elements don't need position updates
  // because they'll be transformed with the parent SVG element
  
  // For SVG label text elements, we DON'T want to counteract the zoom
  // Instead, let the text scale naturally with the zoom
  document.querySelectorAll('g.svg-label').forEach(labelGroup => {
    // Get the text and rectangle elements
    const textElement = labelGroup.querySelector('text');
    const rect = labelGroup.querySelector('rect');
    
    if (textElement && rect) {
      // Calculate the width of the text at current zoom level
      // We need to make sure the background rectangle scales appropriately
      const textWidth = textElement.getComputedTextLength();
      
      // Update the rectangle width to match the text
      rect.setAttribute('width', textWidth + 10);
    }
  });
  
  // If there are still any old HTML/DOM labels (during transition period),
  // we handle them the old way but WITHOUT inverse scaling
  document.querySelectorAll('.box-label:not(.svg-label)').forEach(label => {
    // Store original values if not already stored
    if (!label.hasAttribute('data-original-left')) {
      label.setAttribute('data-original-left', label.style.left.replace('px', ''));
      label.setAttribute('data-original-top', label.style.top.replace('px', ''));
    }
    
    // Get original positions
    const originalLeft = parseFloat(label.getAttribute('data-original-left'));
    const originalTop = parseFloat(label.getAttribute('data-original-top'));
    
    // Scale positions with current zoom level
    const newLeft = originalLeft * window.currentZoom;
    const newTop = originalTop * window.currentZoom;
    
    // Apply the new positions
    label.style.left = `${newLeft}px`;
    label.style.top = `${newTop}px`;
    
    // Remove any previous font size and padding adjustments
    // so the text can scale naturally with zoom
    label.style.removeProperty('font-size');
    label.style.removeProperty('padding');
  });
}

/**
 * Display current zoom level indicator
 */
export function showZoomLevel() {
  // Create or update zoom indicator
  let zoomIndicator = document.getElementById('zoomIndicator');
  
  if (!zoomIndicator) {
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
  
  // Update the text
  zoomIndicator.textContent = `Zoom: ${Math.round(window.currentZoom * 100)}%`;
  zoomIndicator.style.opacity = '1';
  
  // Hide the indicator after a delay
  clearTimeout(zoomIndicator.timeout);
  zoomIndicator.timeout = setTimeout(() => {
    zoomIndicator.style.opacity = '0';
  }, 2000);
}

/**
 * Apply zoom transformations when the SVG overlay is adapted
 * @param {Function} originalAdaptSvgOverlay - The original function to adapt SVG overlay
 */
export function enhanceAdaptSvgOverlay(originalAdaptSvgOverlay) {
  return function() {
    // Call the original function first
    originalAdaptSvgOverlay();
    
    // Then apply current zoom if not at 1.0
    if (window.currentZoom !== 1.0) {
      uploadedImage.style.transform = `scale(${window.currentZoom})`;
      uploadedImage.style.transformOrigin = 'top left';
      
      annotationOverlay.style.transform = `scale(${window.currentZoom})`;
      annotationOverlay.style.transformOrigin = 'top left';
    }
  };
}



// Make zoom functions globally accessible
window.setZoomLevel = setZoomLevel;
window.resetZoom = resetZoom;
window.getCurrentZoom = getCurrentZoom;

/**
 * Get the current zoom level
 * @returns {number} The current zoom level
 */
export function getCurrentZoom() {
  return window.currentZoom;
}
 
  // Notify editor of zoom change if editor is active
  if (typeof window.syncEditorZoom === 'function') {
    console.log("Notifying editor of zoom change:", window.currentZoom);
    window.syncEditorZoom(window.currentZoom);
  }