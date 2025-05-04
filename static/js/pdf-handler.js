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
  pdfNavigation.style.display = 'none';
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