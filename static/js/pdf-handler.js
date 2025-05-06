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

// Background processing state
let activeRequests = 0;
let maxConcurrentRequests = 2; // Maximum number of concurrent API calls
let processingQueue = [];
let processingCancelled = false;

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
      // Process current page with current form values
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
  
  // Make sure main loader is hidden
  if (loader) {
    loader.style.display = 'none';
  }
}

/**
 * Navigate to a specific PDF page
 * @param {number} pageNumber - The page number to navigate to
 * @param {boolean} forceReprocess - Whether to force reprocessing
 */
export function navigateToPdfPage(pageNumber, forceReprocess = false) {
  console.log(`Navigating to PDF page ${pageNumber} of ${totalPdfPages}, Force reprocess: ${forceReprocess}`);
  
  // Cancel any ongoing background processing when navigating
  cancelBackgroundProcessing();
  
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
    
    // After navigating to a page, restart background processing with adjusted priorities
    setTimeout(() => {
      processRemainingPagesInBackground();
    }, 500);
    
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
  
  // Show the main loader in the upload section
  if (loader) {
    loader.style.display = 'block';
  }
  if (errorMessage) {
    errorMessage.style.display = 'none';
  }
  
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
    
    // After loading a new page, restart background processing
    setTimeout(() => {
      processRemainingPagesInBackground();
    }, 500);
  })
  .catch(error => {
    console.error('Error:', error);
    if (errorMessage) {
      errorMessage.textContent = 'Error: ' + error.message;
      errorMessage.style.display = 'block';
    }
  })
  .finally(() => {
    // Hide the main loader in the upload section when finished
    if (loader) {
      loader.style.display = 'none';
    }
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
 * Show background processing indicator with cancel button
 */
function showBackgroundProcessingIndicator() {
  // Remove any existing indicator
  const existingIndicator = document.getElementById('backgroundProcessingIndicator');
  if (existingIndicator) {
    existingIndicator.remove();
  }
  
  const indicator = document.createElement('div');
  indicator.id = 'backgroundProcessingIndicator';
  indicator.className = 'background-processing';
  indicator.innerHTML = `
    <div class="processing-spinner" id="processingSpinner"></div>
    <div>
      <div>Analyzing pages in background: <span id="processedPagesCount">1</span>/${totalPdfPages}</div>
      <div id="currentProcessingText">Starting analysis...</div>
    </div>
    <button id="cancelProcessingBtn">Cancel</button>
  `;
  document.body.appendChild(indicator);
  
  // Add cancel button event listener
  const cancelBtn = document.getElementById('cancelProcessingBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', cancelBackgroundProcessing);
  }
}

/**
 * Process remaining PDF pages in background with throttling
 */
function processRemainingPagesInBackground() {
  // Reset state
  processingCancelled = false;
  processingQueue = [];
  activeRequests = 0;
  
  // Build the queue of pages to process (skip current page which is already loaded)
  for (let i = 1; i <= totalPdfPages; i++) {
    if (i !== currentPdfPage && !pdfPageData[i]) {
      processingQueue.push(i);
    }
  }
  
  // Start processing if there are pages in the queue
  if (processingQueue.length > 0) {
    updateProcessingIndicator();
    processNextBatch();
  } else {
    // All pages already processed
    showProcessingComplete();
  }
}

/**
 * Process the next batch of pages (up to maxConcurrentRequests)
 */
function processNextBatch() {
  if (processingCancelled || processingQueue.length === 0) {
    if (activeRequests === 0) {
      showProcessingComplete();
    }
    return;
  }
  
  // Process up to maxConcurrentRequests pages at once
  const availableSlots = maxConcurrentRequests - activeRequests;
  
  for (let i = 0; i < availableSlots && processingQueue.length > 0; i++) {
    const pageNum = processingQueue.shift();
    processPdfPage(pageNum);
  }
}

/**
 * Process a single PDF page
 * @param {number} pageNumber - The page number to process
 */
function processPdfPage(pageNumber) {
  // Skip already processed pages or if processing is cancelled
  if (pdfPageData[pageNumber] || processingCancelled) {
    return;
  }
  
  console.log(`Processing page ${pageNumber} in background`);
  activeRequests++;
  
  // Update the indicator to show which page is being processed
  updateProcessingIndicator(pageNumber);
  
  // Prepare form data
  const formData = new FormData();
  formData.append('session_id', pdfSessionId);
  formData.append('page', pageNumber);
  
  // Use settings for this page
  const currentPageSettings = pageSettings[pageNumber] || createDefaultPageSettings(pageNumber);
  
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
    processedData.page_sizes = data.page_sizes || [];
    
    // Store in pdfPageData
    pdfPageData[pageNumber] = processedData;
    
    console.log(`Page ${pageNumber} analyzed in background`);
  })
  .catch(error => {
    console.error(`Error analyzing page ${pageNumber}:`, error);
  })
  .finally(() => {
    activeRequests--;
    updateProcessingIndicator(0); // Update with no specific page
    
    // Process more pages if available
    setTimeout(processNextBatch, 300);
  });
}

/**
 * Create default page settings based on current form values
 * @param {number} pageNumber - The page number
 * @returns {Object} The default settings
 */
function createDefaultPageSettings(pageNumber) {
  // Take values from the form as a base
  let formWidth = document.getElementById('formatWidth').value;
  let formHeight = document.getElementById('formatHeight').value;
  
  // If detected page sizes are available, use them
  if (window.data && window.data.page_sizes && window.data.page_sizes.length >= pageNumber) {
    // Round the values and convert them to strings
    formWidth = String(Math.round(window.data.page_sizes[pageNumber-1][0]));
    formHeight = String(Math.round(window.data.page_sizes[pageNumber-1][1]));
    console.log(`Using detected page size for page ${pageNumber}: ${formWidth} × ${formHeight} mm`);
  }
  
  return {
    format_width: formWidth,
    format_height: formHeight,
    dpi: document.getElementById('dpi').value,
    plan_scale: document.getElementById('planScale').value,
    threshold: document.getElementById('threshold').value
  };
}

/**
 * Update processing indicator to show progress
 * @param {number} processingPage - The page currently being processed (0 if none)
 */
function updateProcessingIndicator(processingPage = 0) {
  const indicator = document.getElementById('backgroundProcessingIndicator');
  const counter = document.getElementById('processedPagesCount');
  const currentProcessingText = document.getElementById('currentProcessingText');
  const spinner = document.getElementById('processingSpinner');
  
  if (!indicator || !counter || !currentProcessingText) return;
  
  // Count processed pages (excluding the current page which is always processed)
  const totalProcessed = Object.keys(pdfPageData).length;
  const remainingCount = processingQueue.length;
  
  // Update the counter
  counter.textContent = totalProcessed;
  
  // Update processing text
  if (processingPage > 0) {
    currentProcessingText.textContent = `Currently analyzing page ${processingPage}...`;
  } else if (activeRequests > 0) {
    const pages = Array.from({ length: activeRequests }).map((_, i) => 
      processingQueue[i] || '?').join(', ');
    currentProcessingText.textContent = `Processing ${activeRequests} page(s) in parallel...`;
  } else if (processingQueue.length > 0) {
    currentProcessingText.textContent = `Queued: ${processingQueue.length} pages remaining...`;
  } else {
    currentProcessingText.textContent = `Complete!`;
  }
  
  // Update text based on processing state
  if (processingCancelled) {
    currentProcessingText.textContent = 'Processing cancelled';
    if (spinner) spinner.style.display = 'none';  // Hide spinner
    
    setTimeout(() => {
      indicator.style.opacity = '0';
      setTimeout(() => indicator.remove(), 500);
    }, 2000);
  } else if (totalProcessed >= totalPdfPages || (remainingCount === 0 && activeRequests === 0)) {
    showProcessingComplete();
  }
}

/**
 * Show processing complete message
 */
function showProcessingComplete() {
  const indicator = document.getElementById('backgroundProcessingIndicator');
  const spinner = document.getElementById('processingSpinner');
  if (!indicator) return;
  
  const totalProcessed = Object.keys(pdfPageData).length;
  
  // Stop the spinner animation
  if (spinner) {
    spinner.style.animation = 'none';
    spinner.style.display = 'none';
  }
  
  // Update text
  indicator.innerHTML = `<span>All ${totalProcessed} pages analyzed successfully!</span>`;
  
  // Hide indicator after a short delay
  setTimeout(() => {
    indicator.style.opacity = '0';
    setTimeout(() => indicator.remove(), 500);
  }, 3000);
}

/**
 * Cancel ongoing background processing
 */
export function cancelBackgroundProcessing() {
  if (!processingCancelled) {
    console.log("Cancelling background processing");
    processingCancelled = true;
    processingQueue = [];
    
    const indicator = document.getElementById('backgroundProcessingIndicator');
    const spinner = document.getElementById('processingSpinner');
    
    if (indicator) {
      if (spinner) {
        spinner.style.animation = 'none';
        spinner.style.display = 'none';
      }
      
      indicator.innerHTML = `<span>Processing cancelled</span>`;
      setTimeout(() => {
        indicator.style.opacity = '0';
        setTimeout(() => indicator.remove(), 500);
      }, 2000);
    }
  }
}

/**
 * Reset PDF state
 */
export function resetPdfState() {
  // Cancel any ongoing processing
  cancelBackgroundProcessing();
  
  // Reset all state variables
  pdfSessionId = null;
  currentPdfPage = 1;
  totalPdfPages = 1;
  allPdfPages = [];
  pdfPageData = {};
  pageSettings = {};
  processingQueue = [];
  activeRequests = 0;
  processingCancelled = true;

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

/**
 * Get all PDF pages URLs
 * @returns {Array} Array of page URLs
 */
export function getAllPdfPages() {
  return allPdfPages;
}

// Make key functions available globally
window.resetPdfState = resetPdfState;
window.processPdfData = processPdfData;
window.pdfPageData = pdfPageData;