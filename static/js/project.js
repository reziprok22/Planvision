/**
 * project.js - Module for project management (save, load, export)
 * Part of the Fenster-Erkennungstool project
 */

// Import required functions from labels module
import { 
  updateUIForLabels, 
  getCurrentLabels, 
  getCurrentLineLabels,
  setCurrentLabels,
  setCurrentLineLabels
} from './labels.js';

// DOM references
let projectList;
let saveProjectBtn;
let loadProjectBtn;
let exportPdfBtn;
let exportAnnotatedPdfBtn;

// External module references
let pdfModule;

/**
 * Initialize the project module with required DOM elements
 * @param {Object} elements - Object containing DOM references
 * @param {Object} modules - Object containing references to other modules
 */
export function setupProject(elements, modules) {
  // Store DOM references
  projectList = elements.projectList;
  saveProjectBtn = elements.saveProjectBtn;
  loadProjectBtn = elements.loadProjectBtn;
  exportPdfBtn = elements.exportPdfBtn;
  exportAnnotatedPdfBtn = elements.exportAnnotatedPdfBtn;
  
  // Store module references
  pdfModule = modules.pdfModule;
  
  // Set up event listeners
  if (saveProjectBtn) {
    saveProjectBtn.addEventListener('click', function() {
      const pdfSessionId = pdfModule.getPdfSessionId();
      if (!pdfSessionId) {
        alert('Please upload a PDF file and analyze it first.');
        return;
      }
      saveProject();
    });
  }
  
  if (loadProjectBtn) {
    loadProjectBtn.addEventListener('click', function() {
      openProjectModal();
    });
  }
  
  // Setup modal event listeners
  setupProjectModal();
  
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', function() {
      exportPdf();
    });
  }
  
  if (exportAnnotatedPdfBtn) {
    exportAnnotatedPdfBtn.addEventListener('click', function() {
      exportAnnotatedPdf();
    });
  }
  
  
  // Make loadSpecificProject globally available for onclick handlers
  window.loadSpecificProject = loadSpecificProject;
}

/**
 * Setup project modal functionality
 */
function setupProjectModal() {
  const modal = document.getElementById('projectManagerModal');
  const closeBtn = document.getElementById('closeProjectModal');
  const closeBtn2 = document.getElementById('closeProjectManagerBtn');
  const refreshBtn = document.getElementById('refreshProjectsBtn');
  
  // Close modal when clicking X or Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', closeProjectModal);
  }
  if (closeBtn2) {
    closeBtn2.addEventListener('click', closeProjectModal);
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadProjectListModal);
  }
  
  // Close modal when clicking outside
  window.addEventListener('click', function(event) {
    if (event.target === modal) {
      closeProjectModal();
    }
  });
}

/**
 * Open the project modal
 */
function openProjectModal() {
  const modal = document.getElementById('projectManagerModal');
  if (modal) {
    modal.style.display = 'block';
    loadProjectListModal();
  }
}

/**
 * Close the project modal
 */
function closeProjectModal() {
  const modal = document.getElementById('projectManagerModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * Load a specific project and close the modal
 */
function loadSpecificProject(projectId) {
  loadProject(projectId);
  closeProjectModal();
}

/**
 * Save the current project
 */
export function saveProject() {
  const sessionId = pdfModule.getPdfSessionId();
  
  // Check if this is an existing project (UUID format) or new project
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isExistingProject = uuidPattern.test(sessionId);
  
  let projectName;
  if (isExistingProject) {
    // For existing projects, ask if user wants to update or create new
    const choice = confirm("This appears to be an existing project. Click OK to update the existing project, or Cancel to create a new project.");
    if (choice) {
      // Update existing project - don't ask for name change
      projectName = null; // Will be handled by server
    } else {
      // Create new project
      projectName = prompt("Enter a name for the new project:", 
        `Window Project ${new Date().toLocaleDateString()}`);
    }
  } else {
    // New project
    projectName = prompt("Enter a name for this project:", 
      `Window Project ${new Date().toLocaleDateString()}`);
  }

  if (projectName === null && !isExistingProject) return; // Cancel if no name entered for new project

  // Show status
  const saveStatus = document.createElement('div');
  saveStatus.className = 'save-status';
  saveStatus.textContent = 'Saving project...';
  document.body.appendChild(saveStatus);

  // NEW: Collect Multi-Page canvas data
  // This saves Canvas data for all pages (current implementation: current page only)
  const allPagesCanvasData = window.collectAllPagesCanvasData ? window.collectAllPagesCanvasData() : null;
  
  if (!allPagesCanvasData) {
    saveStatus.textContent = 'Error: No canvas data available to save';
    saveStatus.style.backgroundColor = '#f44336';
    setTimeout(() => saveStatus.remove(), 3000);
    return;
  }

  const pageSettings = pdfModule.getPageSettings();

  // Prepare data for the server with Multi-Page Canvas format
  const projectData = {
    project_name: projectName,
    session_id: sessionId,
    is_update: isExistingProject && projectName === null,
    canvas_data: allPagesCanvasData,  // NEW: Multi-page Canvas data
    settings: pageSettings,
    labels: getCurrentLabels(),
    lineLabels: getCurrentLineLabels(),
    data_format: 'multi_page_canvas_v1'  // Multi-page version flag
  };

  // Save project on the server
  fetch('/save_project', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(projectData)
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      saveStatus.textContent = `Project "${data.project_name}" saved successfully!`;
      saveStatus.style.backgroundColor = '#4CAF50';

      // Update project list if visible
      if (document.getElementById('projectList')) {
        loadProjectList();
      }

      // Auto reload project
      const oldSessionId = pdfModule.getPdfSessionId();
      pdfModule.setPdfSessionId(data.project_id);

      // Load labels if available
      if (data.labels && Array.isArray(data.labels) && data.labels.length > 0) {
        setCurrentLabels(data.labels);
        localStorage.setItem('labels', JSON.stringify(data.labels));
        
        // Update UI with loaded labels
        updateUIForLabels('area');
      }

      // Only if the ID has changed (first save)
      if (oldSessionId !== data.project_id) {
        setTimeout(() => {
          saveStatus.textContent = `Loading project "${data.project_name}"...`;
          loadProject(data.project_id);
        }, 1000);
      }
    } else {
      saveStatus.textContent = `Error: ${data.error}`;
      saveStatus.style.backgroundColor = '#f44336';
    }

    // Hide status after 3 seconds
    setTimeout(() => {
      saveStatus.style.opacity = '0';
      setTimeout(() => saveStatus.remove(), 500);
    }, 3000);
  })
  .catch(error => {
    saveStatus.textContent = `Error: ${error.message}`;
    saveStatus.style.backgroundColor = '#f44336';
  });
}

/**
 * Load projects into the modal table
 */
function loadProjectListModal() {
  const tableBody = document.getElementById('projectTableBody');
  if (!tableBody) {
    console.error("Project table body not found!");
    return;
  }
  
  tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Loading projects...</td></tr>';
  
  fetch('/list_projects')
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        if (data.projects.length === 0) {
          tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #666; font-style: italic;">Keine Projekte gefunden.</td></tr>';
        } else {
          tableBody.innerHTML = '';
          
          data.projects.forEach(project => {
            const row = document.createElement('tr');
            
            // Format date
            const date = new Date(project.created_at);
            const formattedDate = date.toLocaleString('de-DE', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            });
            
            row.innerHTML = `
              <td><strong>${project.project_name}</strong></td>
              <td>${formattedDate}</td>
              <td>${project.page_count || 'N/A'}</td>
              <td>${project.detection_count || 0}</td>
              <td>
                <button class="load-project-btn" onclick="loadSpecificProject('${project.project_id}')">
                  📂 Laden
                </button>
              </td>
            `;
            
            tableBody.appendChild(row);
          });
        }
      } else {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Fehler beim Laden der Projekte</td></tr>';
      }
    })
    .catch(error => {
      console.error('Error loading projects:', error);
      tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Fehler beim Laden der Projekte</td></tr>';
    });
}


/**
 * Load a specific project
 * @param {string} projectId - The project ID to load
 */
export function loadProject(projectId) {
  // Reset UI
  if (typeof window.clearResults === 'function') {
    window.clearResults();
  }
  
  // Show loading indicator
  const loader = document.getElementById('loader');
  const errorMessage = document.getElementById('errorMessage');
  if (loader) loader.style.display = 'block';
  if (errorMessage) errorMessage.style.display = 'none';
  
  fetch(`/load_project/${projectId}`)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      if (data.success) {
        // Canvas-based project loading (Single Source of Truth)
        console.log('Loading Canvas-based project');
        
        // Initialize Multi-Page Canvas State
        if (window.initializePageCanvasData) {
          window.initializePageCanvasData(data.canvas_data);
        }
        
        // Set up PDF page data structure for Multi-Page Canvas
        const pdfPageData = {};
        const canvasPages = data.canvas_data.pages || {};
        const totalPages = data.canvas_data.total_pages || 1;
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          pdfPageData[pageNum] = {
            canvas_data: canvasPages[pageNum] || null,
            page_number: pageNum
          };
        }
        pdfModule.setPdfPageData(pdfPageData);
        pdfModule.setPageSettings(data.settings);
        pdfModule.setPdfSessionId(projectId); // Use project ID as session ID
        
        // Set PDF navigation state
        const currentPdfPage = 1;
        const totalPdfPages = data.metadata.page_count;
        const allPdfPages = data.image_urls;
        
        // Update PDF navigation state in the module
        pdfModule.setPdfNavigationState(currentPdfPage, totalPdfPages, allPdfPages);
        
        // Show PDF navigation if there are multiple pages
        if (totalPdfPages > 1) {
          const pdfNavigation = document.getElementById('pdfNavigation');
          if (pdfNavigation) {
            pdfNavigation.style.display = 'flex';
          }
        }
        
        // Setup image display for Multi-Page Canvas format
        if (data.image_urls && data.image_urls.length > 0) {
          const uploadedImage = document.getElementById('uploadedImage');
          if (uploadedImage) {
            uploadedImage.onload = function() {
              console.log('Project image loaded, now loading canvas data for page 1');
              
              // Load Canvas data for first page
              const page1CanvasData = data.canvas_data.pages && data.canvas_data.pages['1'];
              
              if (page1CanvasData && window.loadCanvasData) {
                window.loadCanvasData(page1CanvasData);
              }
            };
            // Set image source AFTER setting onload handler
            uploadedImage.src = data.image_urls[0] + '?t=' + new Date().getTime();
          }
        }
        
        // Canvas-based projects have all data already loaded
        // No background processing needed
        
        // Update page title
        document.title = `Window Detection Tool - ${data.metadata.project_name}`;
        
        // Hide project list
        if (projectList) {
          projectList.style.display = 'none';
        }
        if (loadProjectBtn) {
          loadProjectBtn.textContent = 'Open Project';
        }
        
        // Update labels if provided
        if (data.labels && Array.isArray(data.labels) && data.labels.length > 0) {
          window.currentLabels = data.labels;
          localStorage.setItem('labels', JSON.stringify(window.currentLabels));
          
          // Update UI with loaded labels
          updateUIForLabels('area');
        }
        
        // Update line labels if provided
        if (data.lineLabels && Array.isArray(data.lineLabels) && data.lineLabels.length > 0) {
          setCurrentLineLabels(data.lineLabels);
          localStorage.setItem('lineLabels', JSON.stringify(data.lineLabels));
          
          // Update UI with loaded line labels
          updateUIForLabels('line');
        }
      } else {
        if (errorMessage) {
          errorMessage.textContent = data.error;
          errorMessage.style.display = 'block';
        }
      }
    })
    .catch(error => {
      console.error("Error loading project:", error);
      if (errorMessage) {
        errorMessage.textContent = error.message;
        errorMessage.style.display = 'block';
      }
    })
    .finally(() => {
      if (loader) loader.style.display = 'none';
    });
}

/**
 * Export project as PDF report
 */
export function exportPdf() {
  const pdfSessionId = pdfModule.getPdfSessionId();
  
  if (!pdfSessionId) {
    alert('Please upload a PDF file and analyze it first.');
    return;
  }
  
  // Check if the session ID is a valid project ID (starts with a UUID)
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(pdfSessionId)) {
    alert('Please save the project first before exporting as PDF.');
    return;
  }
      
  // Show export status
  const exportStatus = document.createElement('div');
  exportStatus.className = 'save-status';
  exportStatus.textContent = 'Creating PDF report...';
  document.body.appendChild(exportStatus);
  
  // Send PDF export request
  fetch(`/export_pdf/${pdfSessionId}`)
    .then(response => {
      // Check if the response is JSON
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return response.json();
      } else {
        // If not JSON, extract text for error message
        return response.text().then(text => {
          throw new Error(`Server did not send a valid JSON response. Response: ${text.substring(0, 100)}...`);
        });
      }
    })
    .then(data => {
      if (data.success) {
        exportStatus.textContent = 'PDF report created successfully!';
        exportStatus.style.backgroundColor = '#4CAF50';
        
        // Open PDF in new tab
        window.open(data.pdf_url, '_blank');
      } else {
        exportStatus.textContent = `Error: ${data.error}`;
        exportStatus.style.backgroundColor = '#f44336';
        console.error("PDF export error:", data.error);
      }
      
      // Hide status after 3 seconds
      setTimeout(() => {
        exportStatus.style.opacity = '0';
        setTimeout(() => exportStatus.remove(), 500);
      }, 3000);
    })
    .catch(error => {
      console.error("PDF export error:", error);
      exportStatus.textContent = `Error: ${error.message}`;
      exportStatus.style.backgroundColor = '#f44336';
      
      // Hide status after 5 seconds
      setTimeout(() => {
        exportStatus.style.opacity = '0';
        setTimeout(() => exportStatus.remove(), 500);
      }, 5000);
    });
}

/**
 * Export project as annotated original PDF
 */
export function exportAnnotatedPdf() {
  const pdfSessionId = pdfModule.getPdfSessionId();
  
  if (!pdfSessionId) {
    alert('Please upload a PDF file and analyze it first.');
    return;
  }
  
  // Check if the session ID is a valid project ID (starts with a UUID)
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(pdfSessionId)) {
    alert('Please save the project first before exporting as PDF.');
    return;
  }
  
  // Show export status
  const exportStatus = document.createElement('div');
  exportStatus.className = 'save-status';
  exportStatus.textContent = 'Creating annotated original PDF...';
  document.body.appendChild(exportStatus);
  
  // Send PDF export request
  fetch(`/export_annotated_pdf/${pdfSessionId}`)
    .then(response => {
      // Check if the response is JSON
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return response.json();
      } else {
        // If not JSON, extract text for error message
        return response.text().then(text => {
          throw new Error(`Server did not send a valid JSON response. Response: ${text.substring(0, 100)}...`);
        });
      }
    })
    .then(data => {
      if (data.success) {
        exportStatus.textContent = 'Annotated original PDF created successfully!';
        exportStatus.style.backgroundColor = '#4CAF50';
        
        // Open PDF in new tab
        window.open(data.pdf_url, '_blank');
      } else {
        exportStatus.textContent = `Error: ${data.error}`;
        exportStatus.style.backgroundColor = '#f44336';
        console.error("PDF export error:", data.error);
      }
      
      // Hide status after 3 seconds
      setTimeout(() => {
        exportStatus.style.opacity = '0';
        setTimeout(() => exportStatus.remove(), 500);
      }, 3000);
    })
    .catch(error => {
      console.error("PDF export error:", error);
      exportStatus.textContent = `Error: ${error.message}`;
      exportStatus.style.backgroundColor = '#f44336';
      
      // Hide status after 5 seconds
      setTimeout(() => {
        exportStatus.style.opacity = '0';
        setTimeout(() => exportStatus.remove(), 500);
      }, 5000);
    });
}