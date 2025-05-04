/**
 * project.js - Module for project management (save, load, export)
 * Part of the Fenster-Erkennungstool project
 */

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
      if (projectList.style.display === 'none') {
        loadProjectList();
        projectList.style.display = 'block';
        loadProjectBtn.textContent = 'Close Project List';
      } else {
        projectList.style.display = 'none';
        loadProjectBtn.textContent = 'Open Project';
      }
    });
  }
  
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
  
  console.log('Project module initialized');
}

/**
 * Save the current project
 */
export function saveProject() {
  // Ask for project name
  const projectName = prompt("Enter a name for this project:", 
    `Window Project ${new Date().toLocaleDateString()}`);

  if (!projectName) return; // Cancel if no name entered

  // Show status
  const saveStatus = document.createElement('div');
  saveStatus.className = 'save-status';
  saveStatus.textContent = 'Saving project...';
  document.body.appendChild(saveStatus);

  // Collect all analysis data
  const pdfPageData = pdfModule.getPdfPageData();
  const analysisData = {};
  Object.keys(pdfPageData).forEach(pageNum => {
    analysisData[pageNum] = pdfPageData[pageNum];
  });

  // Debug before saving
  const pageSettings = pdfModule.getPageSettings();
  console.log("Page settings being sent to server:", JSON.parse(JSON.stringify(pageSettings)));
  Object.keys(pageSettings).forEach(pageNum => {
    console.log(`Settings for page ${pageNum}:`, pageSettings[pageNum]);
  });

  // Prepare data for the server (including labels)
  const projectData = {
    project_name: projectName,
    session_id: pdfModule.getPdfSessionId(),
    analysis_data: analysisData,
    settings: pageSettings,
    labels: window.currentLabels,
    lineLabels: window.currentLineLabels
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
        window.currentLabels = data.labels;
        localStorage.setItem('labels', JSON.stringify(window.currentLabels));
        
        // Update UI with loaded labels
        if (typeof window.updateUIForLabels === 'function') {
          window.updateUIForLabels('area');
        }
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
 * Load the project list
 */
export function loadProjectList() {
  console.log("loadProjectList called");
  
  if (!projectList) {
    console.error("Project list element not found!");
    return;
  }
  
  projectList.innerHTML = '<p>Loading projects...</p>';
  console.log("Sending request to /list_projects");
  
  fetch('/list_projects')
    .then(response => {
      console.log("Response received:", response);
      return response.json();
    })
    .then(data => {
      console.log("Data received:", data);
      if (data.success) {
        if (data.projects.length === 0) {
          projectList.innerHTML = '<p>No projects found.</p>';
          return;
        }
        
        projectList.innerHTML = '';
        const table = document.createElement('table');
        table.className = 'project-table';
        
        // Table header
        const thead = document.createElement('thead');
        thead.innerHTML = `
          <tr>
            <th>Project Name</th>
            <th>Created</th>
            <th>Pages</th>
            <th>Actions</th>
          </tr>
        `;
        table.appendChild(thead);
        
        // Table body
        const tbody = document.createElement('tbody');
        data.projects.forEach(project => {
          const tr = document.createElement('tr');
          
          // Format date
          const date = new Date(project.created_at);
          const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
          
          tr.innerHTML = `
            <td>${project.project_name}</td>
            <td>${formattedDate}</td>
            <td>${project.page_count}</td>
            <td>
              <button class="load-project-btn" data-id="${project.project_id}">Load</button>
            </td>
          `;
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        projectList.appendChild(table);
        
        // Add event listeners for "Load" buttons
        document.querySelectorAll('.load-project-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const projectId = btn.dataset.id;
            console.log(`Loading project with ID: ${projectId}`);
            loadProject(projectId);
          });
        });
      } else {
        console.error("Error:", data.error);
        projectList.innerHTML = `<p>Error: ${data.error}</p>`;
      }
    })
    .catch(error => {
      console.error("Fetch error:", error);
      projectList.innerHTML = `<p>Error: ${error.message}</p>`;
    });
}

/**
 * Load a specific project
 * @param {string} projectId - The project ID to load
 */
export function loadProject(projectId) {
  console.log(`loadProject called with ID: ${projectId}`);
  
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
      console.log("Response received:", response);
      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      console.log("Project data received:", data);
      if (data.success) {
        // Reset and fill with project data
        const pdfPageData = {};
        Object.entries(data.analysis_data).forEach(([pageNum, pageData]) => {
          pdfPageData[pageNum] = pageData;
        });
        
        // Set module data
        pdfModule.setPdfPageData(pdfPageData);
        pdfModule.setPageSettings(data.settings);
        pdfModule.setPdfSessionId(projectId); // Use project ID as session ID
        
        // Set current page and totals
        const currentPdfPage = 1;
        const totalPdfPages = data.metadata.page_count;
        const allPdfPages = data.image_urls;
        
        // Show PDF navigation if there are multiple pages
        if (totalPdfPages > 1) {
          const pdfNavigation = document.getElementById('pdfNavigation');
          if (pdfNavigation) {
            pdfNavigation.style.display = 'flex';
            
            // Update page display
            const currentPageSpan = document.getElementById('currentPage');
            const totalPagesSpan = document.getElementById('totalPages');
            if (currentPageSpan) currentPageSpan.textContent = '1';
            if (totalPagesSpan) totalPagesSpan.textContent = totalPdfPages;
            
            // Enable/disable navigation buttons
            const prevPageBtn = document.getElementById('prevPageBtn');
            const nextPageBtn = document.getElementById('nextPageBtn');
            if (prevPageBtn) prevPageBtn.disabled = true; // First page
            if (nextPageBtn) nextPageBtn.disabled = totalPdfPages <= 1;
          }
        }
        
        // Debug output for first page data
        console.log("Data for page 1:", pdfPageData["1"]);
        console.log("Number of predictions:", pdfPageData["1"]?.predictions?.length);
        
        // Display first page
        if (typeof window.displayPdfPage === 'function') {
          window.displayPdfPage(1, pdfPageData["1"]);
        }
        
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
          if (typeof window.updateUIForLabels === 'function') {
            window.updateUIForLabels('area');
          }
        }
        
        // Update line labels if provided
        if (data.lineLabels && Array.isArray(data.lineLabels) && data.lineLabels.length > 0) {
          window.currentLineLabels = data.lineLabels;
          localStorage.setItem('lineLabels', JSON.stringify(window.currentLineLabels));
          
          // Update UI with loaded line labels
          if (typeof window.updateUIForLabels === 'function') {
            window.updateUIForLabels('line');
          }
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