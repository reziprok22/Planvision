/**
 * labels.js - Centralized module for label management
 * Part of the Fenster-Erkennungstool project
 */

// DOM references
let labelManagerModal;
let manageLabelBtn;
let closeModalBtn;
let labelTableBody;
let addLabelBtn;
let importLabelsBtn;
let exportLabelsBtn;
let resetLabelsBtn;
let labelForm;
let labelFormTitle;
let labelIdInput;
let labelNameInput;
let labelColorInput;
let saveLabelBtn;
let cancelLabelBtn;
let areaLabelsTab;
let lineLabelsTab;

// Default labels
const defaultLabels = [
  { id: 1, name: "Fenster", color: "#0000FF" },  // Blue
  { id: 2, name: "Tür", color: "#FF0000" },      // Red
  { id: 3, name: "Wand", color: "#D4D638" },     // Yellow
  { id: 4, name: "Lukarne", color: "#FFA500" },  // Orange
  { id: 5, name: "Dach", color: "#800080" }      // Purple
];

// Default line labels
const defaultLineLabels = [
  { id: 1, name: "Strecke", color: "#FF9500" },  // Orange
  { id: 2, name: "Höhe", color: "#00AAFF" },     // Blue
  { id: 3, name: "Breite", color: "#4CAF50" },   // Green
  { id: 4, name: "Abstand", color: "#9C27B0" }   // Purple
];

// Current labels (initialized from localStorage or defaults)
let currentLabels;
let currentLineLabels;

/**
 * Initialize labels module
 * @param {Object} elements - DOM elements needed for the module
 */
export function setupLabels(elements) {
  // Store DOM references
  labelManagerModal = elements.labelManagerModal;
  manageLabelBtn = elements.manageLabelBtn;
  closeModalBtn = elements.closeModalBtn;
  labelTableBody = elements.labelTableBody;
  addLabelBtn = elements.addLabelBtn;
  importLabelsBtn = elements.importLabelsBtn;
  exportLabelsBtn = elements.exportLabelsBtn;
  resetLabelsBtn = elements.resetLabelsBtn;
  labelForm = elements.labelForm;
  labelFormTitle = elements.labelFormTitle;
  labelIdInput = elements.labelIdInput;
  labelNameInput = elements.labelNameInput;
  labelColorInput = elements.labelColorInput;
  saveLabelBtn = elements.saveLabelBtn;
  cancelLabelBtn = elements.cancelLabelBtn;
  areaLabelsTab = elements.areaLabelsTab;
  lineLabelsTab = elements.lineLabelsTab;
  
  // Initialize labels from localStorage or defaults
  currentLabels = JSON.parse(localStorage.getItem('labels')) || [...defaultLabels];
  currentLineLabels = JSON.parse(localStorage.getItem('lineLabels')) || [...defaultLineLabels];
  
  // Make labels globally available 
  window.currentLabels = currentLabels;
  window.currentLineLabels = currentLineLabels;
  
  // Set up event listeners
  manageLabelBtn.addEventListener('click', openLabelManager);
  closeModalBtn.addEventListener('click', closeLabelManager);
  
  // Tab switching event listeners
  if (areaLabelsTab) {
    areaLabelsTab.addEventListener('click', function() {
      this.classList.add('active');
      lineLabelsTab.classList.remove('active');
      refreshLabelTable('area');
    });
  }
  
  if (lineLabelsTab) {
    lineLabelsTab.addEventListener('click', function() {
      this.classList.add('active');
      areaLabelsTab.classList.remove('active');
      refreshLabelTable('line');
    });
  }
  
  // Window click to close modal
  window.addEventListener('click', function(event) {
    if (event.target === labelManagerModal) {
      closeLabelManager();
    }
  });
  
  // Button event listeners
  addLabelBtn.addEventListener('click', showAddLabelForm);
  importLabelsBtn.addEventListener('click', importLabels);
  exportLabelsBtn.addEventListener('click', exportLabels);
  resetLabelsBtn.addEventListener('click', resetLabels);
  saveLabelBtn.addEventListener('click', saveLabel);
  cancelLabelBtn.addEventListener('click', hideForm);
  
  // Update UI with current labels
  updateUIForLabels('both');
  
  console.log('Labels module initialized');
}

/**
 * Open label manager modal
 */
function openLabelManager() {
  refreshLabelTable('area');  // Start with area labels by default
  labelManagerModal.style.display = 'block';
}

/**
 * Close label manager modal
 */
function closeLabelManager() {
  labelManagerModal.style.display = 'none';
  hideForm();
}

/**
 * Refresh the label table with current labels
 * @param {string} type - The type of labels to display ('area' or 'line')
 */
function refreshLabelTable(type = 'area') {
  labelTableBody.innerHTML = '';
  
  // Determine which labels to display
  const labels = type === 'area' ? currentLabels : currentLineLabels;
  
  labels.forEach(label => {
    const row = document.createElement('tr');
    
    row.innerHTML = `
      <td>${label.id}</td>
      <td>
        <span class="color-preview" style="background-color:${label.color}"></span>
        ${label.name}
      </td>
      <td>${label.color}</td>
      <td>
        <button class="edit-label-btn" data-id="${label.id}" data-type="${type}">Edit</button>
        <button class="delete-label-btn" data-id="${label.id}" data-type="${type}">Delete</button>
      </td>
    `;
    
    labelTableBody.appendChild(row);
  });
  
  // Event listeners for Edit and Delete buttons
  document.querySelectorAll('.edit-label-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const labelId = parseInt(this.dataset.id);
      const labelType = this.dataset.type;
      editLabel(labelId, labelType);
    });
  });
  
  document.querySelectorAll('.delete-label-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const labelId = parseInt(this.dataset.id);
      const labelType = this.dataset.type;
      deleteLabel(labelId, labelType);
    });
  });
}

/**
 * Show form to add a new label
 */
function showAddLabelForm() {
  // Get the active tab to determine label type
  const activeTab = document.querySelector('.label-tab.active');
  const labelType = activeTab.id === 'lineLabelsTab' ? 'line' : 'area';
  
  labelFormTitle.textContent = 'Add Label';
  labelIdInput.value = '';
  labelNameInput.value = '';
  labelColorInput.value = '#' + Math.floor(Math.random()*16777215).toString(16); // Random color
  // Store the label type in the form's dataset
  labelForm.dataset.type = labelType;
  labelForm.style.display = 'block';
}

/**
 * Show form to edit an existing label
 * @param {number} labelId - The ID of the label to edit
 * @param {string} labelType - The type of label ('area' or 'line')
 */
function editLabel(labelId, labelType = 'area') {
  const labels = labelType === 'area' ? currentLabels : currentLineLabels;
  const label = labels.find(l => l.id === labelId);
  if (!label) return;
  
  labelFormTitle.textContent = 'Edit Label';
  labelIdInput.value = label.id;
  labelNameInput.value = label.name;
  labelColorInput.value = label.color;
  // Store the label type
  labelForm.dataset.type = labelType;
  labelForm.style.display = 'block';
}

/**
 * Delete a label
 * @param {number} labelId - The ID of the label to delete
 * @param {string} labelType - The type of label ('area' or 'line')
 */
function deleteLabel(labelId, labelType = 'area') {
  const labels = labelType === 'area' ? currentLabels : currentLineLabels;
  
  if (labels.length <= 1) {
    alert('At least one label must remain.');
    return;
  }
  
  if (confirm('Are you sure you want to delete this label?')) {
    if (labelType === 'area') {
      currentLabels = currentLabels.filter(label => label.id !== labelId);
    } else {
      currentLineLabels = currentLineLabels.filter(label => label.id !== labelId);
    }
    saveLabels(labelType);
    refreshLabelTable(labelType);
  }
}

/**
 * Save a label (add new or update existing)
 */
function saveLabel() {
  const name = labelNameInput.value.trim();
  const color = labelColorInput.value;
  // Get the label type from the form's dataset
  const labelType = labelForm.dataset.type || 'area';
  
  if (!name) {
    alert('Please enter a name.');
    return;
  }
  
  const labelId = labelIdInput.value ? parseInt(labelIdInput.value) : null;
  
  // Determine which label array to modify based on type
  if (labelType === 'area') {
    if (labelId) {
      // Edit existing area label
      const index = currentLabels.findIndex(l => l.id === labelId);
      if (index !== -1) {
        currentLabels[index].name = name;
        currentLabels[index].color = color;
      }
    } else {
      // Add new area label
      const maxId = currentLabels.reduce((max, label) => Math.max(max, label.id), 0);
      currentLabels.push({
        id: maxId + 1,
        name: name,
        color: color
      });
    }
  } else {
    // Line labels
    if (labelId) {
      // Edit existing line label
      const index = currentLineLabels.findIndex(l => l.id === labelId);
      if (index !== -1) {
        currentLineLabels[index].name = name;
        currentLineLabels[index].color = color;
      }
    } else {
      // Add new line label
      const maxId = currentLineLabels.reduce((max, label) => Math.max(max, label.id), 0);
      currentLineLabels.push({
        id: maxId + 1,
        name: name,
        color: color
      });
    }
  }
  
  // Save only the type of labels that was modified
  saveLabels(labelType);
  refreshLabelTable(labelType);
  hideForm();
}

/**
 * Hide the label form
 */
function hideForm() {
  labelForm.style.display = 'none';
}

/**
 * Save labels to localStorage and update UI
 * @param {string} type - The type of labels to save ('area', 'line', or 'both')
 */
function saveLabels(type = 'area') {
  if (type === 'area' || type === 'both') {
    localStorage.setItem('labels', JSON.stringify(currentLabels));
    window.currentLabels = currentLabels;
  }
  
  if (type === 'line' || type === 'both') {
    localStorage.setItem('lineLabels', JSON.stringify(currentLineLabels));
    window.currentLineLabels = currentLineLabels;
  }
  
  updateUIForLabels(type);
  
  // Notify FabricHandler about label changes if available
  if (typeof window.FabricHandler !== 'undefined' && typeof window.FabricHandler.setLabels === 'function') {
    if (type === 'area' || type === 'both') {
      window.FabricHandler.setLabels(currentLabels);
    }
  }
}

/**
 * Import labels from a JSON file
 */
function importLabels() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const importedLabels = JSON.parse(e.target.result);
        
        // Validate
        if (!Array.isArray(importedLabels) || !importedLabels.every(l => l.id && l.name && l.color)) {
          throw new Error('Invalid label format');
        }
        
        // Get active tab to determine which labels to import
        const activeTab = document.querySelector('.label-tab.active');
        const labelType = activeTab.id === 'lineLabelsTab' ? 'line' : 'area';
        
        if (labelType === 'area') {
          currentLabels = importedLabels;
        } else {
          currentLineLabels = importedLabels;
        }
        
        saveLabels(labelType);
        refreshLabelTable(labelType);
        
        alert('Labels imported successfully!');
      } catch (error) {
        alert('Error importing labels: ' + error.message);
      }
    };
    
    reader.readAsText(file);
  });
  
  input.click();
}

/**
 * Export labels to a JSON file
 */
function exportLabels() {
  // Get active tab to determine which labels to export
  const activeTab = document.querySelector('.label-tab.active');
  const labelType = activeTab.id === 'lineLabelsTab' ? 'line' : 'area';
  const labels = labelType === 'area' ? currentLabels : currentLineLabels;
  
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(labels, null, 2));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", `fenster_${labelType}_labels.json`);
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
}

/**
 * Reset labels to default values
 */
function resetLabels() {
  // Get active tab to determine which labels to reset
  const activeTab = document.querySelector('.label-tab.active');
  const labelType = activeTab.id === 'lineLabelsTab' ? 'line' : 'area';
  
  if (confirm(`Are you sure you want to reset all ${labelType} labels to default values?`)) {
    if (labelType === 'area') {
      currentLabels = [...defaultLabels];
    } else {
      currentLineLabels = [...defaultLineLabels]; 
    }
    saveLabels(labelType);
    refreshLabelTable(labelType);
  }
}

/**
 * Update UI elements based on current labels
 * @param {string} type - The type of labels to update UI for ('area', 'line', or 'both')
 */
export function updateUIForLabels(type = 'both') {
  // Update legend for area labels
  if (type === 'area' || type === 'both') {
    const legend = document.querySelector('.legend');
    if (legend) {
      legend.innerHTML = '';
      
      currentLabels.forEach(label => {
        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item';
        legendItem.innerHTML = `
          <div class="legend-color" style="background-color:${label.color}"></div>
          <span>${label.name} (${label.id})</span>
        `;
        legend.appendChild(legendItem);
      });
    }
    
    // Update universal label select for area labels
    const universalLabelSelect = document.getElementById('universalLabelSelect');
    if (universalLabelSelect) {
      // Remember current selection
      const selectedValue = universalLabelSelect.value;
      
      // Recreate options with current labels
      universalLabelSelect.innerHTML = '';
      currentLabels.forEach(label => {
        const option = document.createElement('option');
        option.value = label.id;
        option.textContent = label.name;
        universalLabelSelect.appendChild(option);
      });
      
      // Restore previous selection if possible
      if (selectedValue && universalLabelSelect.querySelector(`option[value="${selectedValue}"]`)) {
        universalLabelSelect.value = selectedValue;
      }
    }
    
    // Legacy support: Update object type selection in the editor (if it exists)
    const objectTypeSelect = document.getElementById('objectTypeSelect');
    if (objectTypeSelect) {
      // Remember current selection
      const selectedValue = objectTypeSelect.value;
      
      // Recreate options
      objectTypeSelect.innerHTML = '';
      
      // Option for "Other" (0)
      const otherOption = document.createElement('option');
      otherOption.value = '0';
      otherOption.textContent = 'Other';
      objectTypeSelect.appendChild(otherOption);
      
      // Options for custom labels
      currentLabels.forEach(label => {
        const option = document.createElement('option');
        option.value = label.id;
        option.textContent = label.name;
        objectTypeSelect.appendChild(option);
      });
      
      // Restore previous selection if possible
      if (selectedValue && objectTypeSelect.querySelector(`option[value="${selectedValue}"]`)) {
        objectTypeSelect.value = selectedValue;
      }
    }
  }
  
  // Update line type dropdown for line labels
  if (type === 'line' || type === 'both') {
    const lineTypeSelect = document.getElementById('lineTypeSelect');
    if (lineTypeSelect) {
      // Remember current selection
      const selectedLineValue = lineTypeSelect.value;
      
      // Recreate options
      lineTypeSelect.innerHTML = '';
      
      // Options for line labels
      currentLineLabels.forEach(label => {
        const option = document.createElement('option');
        option.value = label.id;
        option.textContent = label.name;
        lineTypeSelect.appendChild(option);
      });
      
      // Restore previous selection if possible
      if (selectedLineValue && lineTypeSelect.querySelector(`option[value="${selectedLineValue}"]`)) {
        lineTypeSelect.value = selectedLineValue;
      }
    }
  }
}

/**
 * Get the current area labels
 * @returns {Array} The current area labels
 */
export function getAreaLabels() {
  return currentLabels;
}

/**
 * Get the current line labels
 * @returns {Array} The current line labels
 */
export function getLineLabels() {
  return currentLineLabels;
}

/**
 * Find a label by ID
 * @param {number} id - The label ID
 * @param {string} type - The label type ('area' or 'line')
 * @returns {Object|null} The label object or null if not found
 */
export function getLabelById(id, type = 'area') {
  const labels = type === 'area' ? currentLabels : currentLineLabels;
  return labels.find(label => label.id === id) || null;
}

/**
 * Generate label name based on ID
 * @param {number} labelId - The label ID
 * @param {string} type - Label type ('area' or 'line')
 * @returns {string} The label name
 */
export function getLabelName(labelId, type = 'area') {
  const label = getLabelById(labelId, type);
  
  if (label) {
    return label.name;
  }
  
  // Fallback names if label not found
  if (type === 'area') {
    switch (labelId) {
      case 1: return "Fenster";
      case 2: return "Tür";
      case 3: return "Wand";
      case 4: return "Lukarne";
      case 5: return "Dach";
      default: return "Andere";
    }
  } else { // line
    switch (labelId) {
      case 1: return "Strecke";
      case 2: return "Höhe";
      case 3: return "Breite";
      case 4: return "Abstand";
      default: return "Messlinie";
    }
  }
}

/**
 * Get color for a label
 * @param {number} labelId - The label ID
 * @param {string} type - Label type ('area' or 'line')
 * @returns {string} The label color
 */
export function getLabelColor(labelId, type = 'area') {
  const label = getLabelById(labelId, type);
  
  if (label) {
    return label.color;
  }
  
  // Fallback colors if label not found
  if (type === 'area') {
    switch (labelId) {
      case 1: return "#0000FF"; // Fenster - Blue
      case 2: return "#FF0000"; // Tür - Red
      case 3: return "#D4D638"; // Wand - Yellow
      case 4: return "#FFA500"; // Lukarne - Orange
      case 5: return "#800080"; // Dach - Purple
      default: return "#808080"; // Other - Gray
    }
  } else { // line
    switch (labelId) {
      case 1: return "#FF9500"; // Strecke - Orange
      case 2: return "#00AAFF"; // Höhe - Blue
      case 3: return "#4CAF50"; // Breite - Green
      case 4: return "#9C27B0"; // Abstand - Purple
      default: return "#FF9500"; // Default - Orange
    }
  }
}

/**
 * Set the current area labels
 * @param {Array} labels - The new area labels
 */
export function setAreaLabels(labels) {
  currentLabels = labels;
  window.currentLabels = labels;
  saveLabels('area');
}

/**
 * Set the current line labels
 * @param {Array} labels - The new line labels
 */
export function setLineLabels(labels) {
  currentLineLabels = labels;
  window.currentLineLabels = labels;
  saveLabels('line');
}

// Export functions as a global object for easier access from other modules
window.LabelsManager = {
  getAreaLabels,
  getLineLabels,
  getLabelById,
  getLabelName,
  getLabelColor,
  setAreaLabels,
  setLineLabels,
  updateUIForLabels,
  saveLabels
};