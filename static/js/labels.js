/**
 * labels.js - Unified label management system with inline editing
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
let applyChangesBtn;
let cancelChangesBtn;
let labelForm;
let labelFormTitle;
let labelIdInput;
let labelNameInput;
let labelColorInput;
let toolRectangleInput;
let toolPolygonInput;
let toolLineInput;
let saveLabelBtn;
let cancelLabelBtn;

// Default unified labels
const defaultLabels = [
  { id: 1, name: "Fenster", color: "#0000FF", tools: { rectangle: true, polygon: true, line: false } },
  { id: 2, name: "Tür", color: "#FF0000", tools: { rectangle: true, polygon: true, line: false } },
  { id: 3, name: "Wand", color: "#D4D638", tools: { rectangle: true, polygon: true, line: false } },
  { id: 4, name: "Lukarne", color: "#FFA500", tools: { rectangle: true, polygon: true, line: false } },
  { id: 5, name: "Dach", color: "#800080", tools: { rectangle: true, polygon: true, line: false } },
  { id: 6, name: "Strecke", color: "#FF9500", tools: { rectangle: false, polygon: false, line: true } },
  { id: 7, name: "Höhe", color: "#00AAFF", tools: { rectangle: false, polygon: false, line: true } },
  { id: 8, name: "Breite", color: "#4CAF50", tools: { rectangle: false, polygon: false, line: true } },
  { id: 9, name: "Abstand", color: "#9C27B0", tools: { rectangle: false, polygon: false, line: true } }
];

// Current unified labels
let currentLabels;
let originalLabels; // For cancel functionality
let hasUnsavedChanges = false;

/**
 * Initialize labels module
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
  
  // Get batch action buttons
  applyChangesBtn = document.getElementById('applyChangesBtn');
  cancelChangesBtn = document.getElementById('cancelChangesBtn');
  
  // Get tool checkboxes
  toolRectangleInput = document.getElementById('toolRectangle');
  toolPolygonInput = document.getElementById('toolPolygon');
  toolLineInput = document.getElementById('toolLine');
  
  // Initialize labels from localStorage or defaults
  currentLabels = JSON.parse(localStorage.getItem('unifiedLabels')) || [...defaultLabels];
  
  // Make labels globally available 
  window.currentLabels = getLabelsForTool('rectangle');
  window.currentLineLabels = getLabelsForTool('line');
  
  // Set up event listeners
  manageLabelBtn.addEventListener('click', openLabelManager);
  closeModalBtn.addEventListener('click', closeLabelManager);
  
  // Window click to close modal
  window.addEventListener('click', function(event) {
    if (event.target === labelManagerModal) {
      if (hasUnsavedChanges) {
        if (confirm('You have unsaved changes. Close without saving?')) {
          cancelChanges();
          closeLabelManager();
        }
      } else {
        closeLabelManager();
      }
    }
  });
  
  // Button event listeners
  addLabelBtn.addEventListener('click', showAddLabelForm);
  importLabelsBtn.addEventListener('click', importLabels);
  exportLabelsBtn.addEventListener('click', exportLabels);
  resetLabelsBtn.addEventListener('click', resetLabels);
  saveLabelBtn.addEventListener('click', saveNewLabel);
  cancelLabelBtn.addEventListener('click', hideForm);
  applyChangesBtn.addEventListener('click', applyAllChanges);
  cancelChangesBtn.addEventListener('click', cancelChanges);
  
  // Update UI with current labels
  updateUIForLabels();
}

/**
 * Open label manager modal
 */
function openLabelManager() {
  // Store original state for cancel functionality
  originalLabels = JSON.parse(JSON.stringify(currentLabels));
  hasUnsavedChanges = false;
  refreshLabelTable();
  labelManagerModal.style.display = 'block';
}

/**
 * Close label manager modal
 */
function closeLabelManager() {
  if (hasUnsavedChanges) {
    if (confirm('You have unsaved changes. Close without saving?')) {
      cancelChanges();
    } else {
      return;
    }
  }
  labelManagerModal.style.display = 'none';
  hideForm();
}

/**
 * Refresh the label table with current labels
 */
function refreshLabelTable() {
  labelTableBody.innerHTML = '';
  
  currentLabels.forEach(label => {
    const row = document.createElement('tr');
    
    row.innerHTML = `
      <td>${label.id}</td>
      <td>
        <input type="text" class="inline-edit" data-field="name" data-id="${label.id}" value="${label.name}" />
      </td>
      <td>
        <input type="color" class="inline-edit" data-field="color" data-id="${label.id}" value="${label.color}" />
        <span class="color-preview" style="background-color:${label.color}; margin-left: 5px;"></span>
      </td>
      <td><input type="checkbox" class="inline-edit" data-field="rectangle" data-id="${label.id}" ${label.tools.rectangle ? 'checked' : ''}></td>
      <td><input type="checkbox" class="inline-edit" data-field="polygon" data-id="${label.id}" ${label.tools.polygon ? 'checked' : ''}></td>
      <td><input type="checkbox" class="inline-edit" data-field="line" data-id="${label.id}" ${label.tools.line ? 'checked' : ''}></td>
      <td>
        <button class="delete-label-btn" data-id="${label.id}">Delete</button>
      </td>
    `;
    
    labelTableBody.appendChild(row);
  });
  
  // Event listeners for inline editing
  document.querySelectorAll('.inline-edit').forEach(input => {
    input.addEventListener('input', handleInlineEdit);
    
    // Special handling for color input to update preview
    if (input.type === 'color') {
      input.addEventListener('change', function() {
        const preview = this.nextElementSibling;
        if (preview && preview.classList.contains('color-preview')) {
          preview.style.backgroundColor = this.value;
        }
      });
    }
  });
  
  // Event listeners for Delete buttons
  document.querySelectorAll('.delete-label-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const labelId = parseInt(this.dataset.id);
      deleteLabel(labelId);
    });
  });
  
  // Show/hide batch action buttons based on changes
  updateBatchActionVisibility();
}

/**
 * Handle inline editing changes
 */
function handleInlineEdit(event) {
  const input = event.target;
  const labelId = parseInt(input.dataset.id);
  const field = input.dataset.field;
  const value = input.type === 'checkbox' ? input.checked : input.value;
  
  // Find and update the label
  const label = currentLabels.find(l => l.id === labelId);
  if (!label) return;
  
  if (field === 'name') {
    label.name = value;
  } else if (field === 'color') {
    label.color = value;
  } else if (['rectangle', 'polygon', 'line'].includes(field)) {
    // Check if disabling a tool that's currently used by existing annotations
    if (!value) { // User is unchecking the tool
      const affectedAnnotations = getAnnotationsUsingLabelForTool(labelId, field);
      
      if (affectedAnnotations.length > 0) {
        input.checked = true; // Revert the change
        alert(`Cannot disable "${field}" for label "${label.name}" because ${affectedAnnotations.length} existing annotation(s) of this type exist. Please delete or change these annotations first:\n\n${getAnnotationSummary(affectedAnnotations)}`);
        return;
      }
    }
    
    label.tools[field] = value;
    
    // Validate: at least one tool must be selected
    if (!label.tools.rectangle && !label.tools.polygon && !label.tools.line) {
      input.checked = true;
      label.tools[field] = true;
      alert('At least one tool must be selected for each label.');
    }
  }
  
  hasUnsavedChanges = true;
  updateBatchActionVisibility();
}

/**
 * Show/hide batch action buttons
 */
function updateBatchActionVisibility() {
  const batchActions = document.querySelector('.label-batch-actions');
  if (hasUnsavedChanges) {
    batchActions.style.display = 'block';
  } else {
    batchActions.style.display = 'none';
  }
}

/**
 * Apply all changes
 */
function applyAllChanges() {
  // Validate all labels
  let isValid = true;
  currentLabels.forEach(label => {
    if (!label.name.trim()) {
      alert(`Label with ID ${label.id} must have a name.`);
      isValid = false;
    }
    if (!label.tools.rectangle && !label.tools.polygon && !label.tools.line) {
      alert(`Label "${label.name}" must have at least one tool selected.`);
      isValid = false;
    }
  });
  
  if (!isValid) return;
  
  // Save to localStorage and update UI
  saveLabels();
  
  // Update original state and reset change tracking
  originalLabels = JSON.parse(JSON.stringify(currentLabels));
  hasUnsavedChanges = false;
  updateBatchActionVisibility();
  
  alert('Changes applied successfully!');
  
  // Close the modal after successful apply
  closeLabelManager();
}

/**
 * Cancel all changes
 */
function cancelChanges() {
  // Restore original state
  currentLabels = JSON.parse(JSON.stringify(originalLabels));
  hasUnsavedChanges = false;
  refreshLabelTable();
  updateBatchActionVisibility();
}

/**
 * Show form to add a new label
 */
function showAddLabelForm() {
  labelFormTitle.textContent = 'Add Label';
  labelIdInput.value = '';
  labelNameInput.value = '';
  labelColorInput.value = '#' + Math.floor(Math.random()*16777215).toString(16);
  toolRectangleInput.checked = false;
  toolPolygonInput.checked = false;
  toolLineInput.checked = false;
  labelForm.style.display = 'block';
}

/**
 * Save a new label from the form
 */
function saveNewLabel() {
  const name = labelNameInput.value.trim();
  const color = labelColorInput.value;
  const tools = {
    rectangle: toolRectangleInput.checked,
    polygon: toolPolygonInput.checked,
    line: toolLineInput.checked
  };
  
  if (!name) {
    alert('Please enter a name.');
    return;
  }
  
  if (!tools.rectangle && !tools.polygon && !tools.line) {
    alert('Please select at least one tool.');
    return;
  }
  
  // Add new label
  const maxId = currentLabels.reduce((max, label) => Math.max(max, label.id), 0);
  currentLabels.push({
    id: maxId + 1,
    name: name,
    color: color,
    tools: tools
  });
  
  hasUnsavedChanges = true;
  refreshLabelTable();
  hideForm();
}

/**
 * Delete a label
 */
function deleteLabel(labelId) {
  if (currentLabels.length <= 1) {
    alert('At least one label must remain.');
    return;
  }
  
  const label = currentLabels.find(l => l.id === labelId);
  const labelName = label ? label.name : `ID ${labelId}`;
  
  // Check if label is used by existing annotations
  const affectedAnnotations = getAnnotationsUsingLabel(labelId);
  
  if (affectedAnnotations.length > 0) {
    alert(`Cannot delete label "${labelName}" because ${affectedAnnotations.length} existing annotation(s) use this label. Please delete or change these annotations first:\n\n${getAnnotationSummary(affectedAnnotations)}`);
    return;
  }
  
  if (confirm(`Are you sure you want to delete label "${labelName}"?`)) {
    currentLabels = currentLabels.filter(label => label.id !== labelId);
    hasUnsavedChanges = true;
    refreshLabelTable();
  }
}

/**
 * Hide the label form
 */
function hideForm() {
  labelForm.style.display = 'none';
}

/**
 * Save labels to localStorage and update UI
 */
export function saveLabels() {
  localStorage.setItem('unifiedLabels', JSON.stringify(currentLabels));
  
  // Update global variables for compatibility
  window.currentLabels = getLabelsForTool('rectangle');
  window.currentLineLabels = getLabelsForTool('line');
  
  updateUIForLabels();
  
  // Notify FabricHandler about label changes if available
  if (typeof window.FabricHandler !== 'undefined' && typeof window.FabricHandler.setLabels === 'function') {
    window.FabricHandler.setLabels(getLabelsForTool('rectangle'));
  }
}

/**
 * Import labels from a JSON file
 */
function importLabels() {
  if (hasUnsavedChanges) {
    if (!confirm('You have unsaved changes. Import will discard them. Continue?')) {
      return;
    }
  }
  
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
        
        // Validate unified format
        if (!Array.isArray(importedLabels) || 
            !importedLabels.every(l => l.id && l.name && l.color && l.tools &&
                                  typeof l.tools.rectangle === 'boolean' &&
                                  typeof l.tools.polygon === 'boolean' &&
                                  typeof l.tools.line === 'boolean')) {
          throw new Error('Invalid unified label format');
        }
        
        currentLabels = importedLabels;
        hasUnsavedChanges = true;
        refreshLabelTable();
        
        alert('Labels imported successfully! Click "Apply Changes" to save.');
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
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentLabels, null, 2));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", "planvision_labels.json");
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
}

/**
 * Reset labels to default values
 */
function resetLabels() {
  if (confirm('Are you sure you want to reset all labels to default values?')) {
    currentLabels = [...defaultLabels];
    hasUnsavedChanges = true;
    refreshLabelTable();
  }
}

/**
 * Get all annotations using a specific label ID
 */
function getAnnotationsUsingLabel(labelId) {
  const allAnnotations = [];
  
  // Check current canvas if available
  const canvas = typeof window.getCanvas === 'function' ? window.getCanvas() : null;
  
  if (canvas) {
    const allCanvasObjects = canvas.getObjects();
    const annotationObjects = allCanvasObjects.filter(obj => obj.objectType === 'annotation');
    const currentAnnotations = annotationObjects.filter(ann => ann.labelId === labelId || ann.objectLabel === labelId);
    
    allAnnotations.push(...currentAnnotations.map(ann => ({
      ...ann,
      page: 'current'
    })));
  }
  
  // Check all pages in pageCanvasData if available
  const pageCanvasData = typeof window.getPageCanvasData === 'function' ? window.getPageCanvasData() : null;
  
  if (pageCanvasData) {
    for (const pageNum in pageCanvasData) {
      const pageData = pageCanvasData[pageNum];
      if (pageData && pageData.canvas_annotations) {
        const pageAnnotations = pageData.canvas_annotations
          .filter(ann => ann.labelId === labelId || ann.objectLabel === labelId);
        
        allAnnotations.push(...pageAnnotations.map(ann => ({
          ...ann,
          page: pageNum
        })));
      }
    }
  }
  
  return allAnnotations;
}

/**
 * Get annotations using a specific label ID for a specific tool type
 */
function getAnnotationsUsingLabelForTool(labelId, toolType) {
  const allAnnotations = getAnnotationsUsingLabel(labelId);
  
  // Filter by tool type
  const toolTypeMapping = {
    'rectangle': ['rect', 'rectangle'],
    'polygon': ['polygon'],
    'line': ['polyline', 'line']
  };
  
  const validTypes = toolTypeMapping[toolType] || [];
  
  return allAnnotations.filter(ann => 
    validTypes.includes(ann.type) || 
    validTypes.includes(ann.annotationType)
  );
}

/**
 * Generate a summary of affected annotations for user display
 */
function getAnnotationSummary(annotations) {
  const summary = [];
  const groupedByPage = {};
  
  // Group by page
  annotations.forEach(ann => {
    const page = ann.page || 'unknown';
    if (!groupedByPage[page]) {
      groupedByPage[page] = [];
    }
    groupedByPage[page].push(ann);
  });
  
  // Create summary
  for (const page in groupedByPage) {
    const pageAnnotations = groupedByPage[page];
    const typeCount = {};
    
    pageAnnotations.forEach(ann => {
      const type = ann.annotationType || ann.type || 'unknown';
      typeCount[type] = (typeCount[type] || 0) + 1;
    });
    
    const typeSummary = Object.entries(typeCount)
      .map(([type, count]) => `${count} ${type}(s)`)
      .join(', ');
    
    const pageLabel = page === 'current' ? 'Current page' : `Page ${page}`;
    summary.push(`• ${pageLabel}: ${typeSummary}`);
  }
  
  return summary.join('\n');
}

/**
 * Update UI elements based on current labels
 */
export function updateUIForLabels() {
  // Update legend for area labels
  const legend = document.querySelector('.legend');
  if (legend) {
    legend.innerHTML = '';
    
    getLabelsForTool('rectangle').forEach(label => {
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
    const selectedValue = universalLabelSelect.value;
    
    universalLabelSelect.innerHTML = '';
    getLabelsForTool('rectangle').forEach(label => {
      const option = document.createElement('option');
      option.value = label.id;
      option.textContent = label.name;
      universalLabelSelect.appendChild(option);
    });
    
    if (selectedValue && universalLabelSelect.querySelector(`option[value="${selectedValue}"]`)) {
      universalLabelSelect.value = selectedValue;
    }
  }
  
  // Update object type selection in the editor
  const objectTypeSelect = document.getElementById('objectTypeSelect');
  if (objectTypeSelect) {
    const selectedValue = objectTypeSelect.value;
    
    objectTypeSelect.innerHTML = '';
    
    // Option for "Other" (0)
    const otherOption = document.createElement('option');
    otherOption.value = '0';
    otherOption.textContent = 'Other';
    objectTypeSelect.appendChild(otherOption);
    
    // Options for custom labels
    getLabelsForTool('rectangle').forEach(label => {
      const option = document.createElement('option');
      option.value = label.id;
      option.textContent = label.name;
      objectTypeSelect.appendChild(option);
    });
    
    if (selectedValue && objectTypeSelect.querySelector(`option[value="${selectedValue}"]`)) {
      objectTypeSelect.value = selectedValue;
    }
  }
  
  // Update line type dropdown for line labels
  const lineTypeSelect = document.getElementById('lineTypeSelect');
  if (lineTypeSelect) {
    const selectedLineValue = lineTypeSelect.value;
    
    lineTypeSelect.innerHTML = '';
    
    getLabelsForTool('line').forEach(label => {
      const option = document.createElement('option');
      option.value = label.id;
      option.textContent = label.name;
      lineTypeSelect.appendChild(option);
    });
    
    if (selectedLineValue && lineTypeSelect.querySelector(`option[value="${selectedLineValue}"]`)) {
      lineTypeSelect.value = selectedLineValue;
    }
  }
}

/**
 * Get labels filtered by tool type
 */
export function getLabelsForTool(toolType) {
  return currentLabels.filter(label => label.tools[toolType] === true);
}

/**
 * Get all labels
 */
export function getAllLabels() {
  return currentLabels;
}

/**
 * Find a label by ID
 */
export function getLabelById(id) {
  return currentLabels.find(label => label.id === id) || null;
}

/**
 * Generate label name based on ID
 */
export function getLabelName(labelId) {
  const label = getLabelById(labelId);
  return label ? label.name : "Unknown";
}

/**
 * Get color for a label
 */
export function getLabelColor(labelId) {
  const label = getLabelById(labelId);
  return label ? label.color : "#808080";
}

/**
 * Set the current labels
 */
export function setCurrentLabels(labels) {
  currentLabels = labels;
  window.currentLabels = getLabelsForTool('rectangle');
  window.currentLineLabels = getLabelsForTool('line');
  saveLabels();
}

