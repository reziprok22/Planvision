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
let labelOpacityInput;
let opacityValueDisplay;
let toolRectangleInput;
let toolPolygonInput;
let toolLineInput;
let saveLabelBtn;
let cancelLabelBtn;

// Default unified labels - will be loaded from JSON file
let defaultLabels = [];

// Current unified labels
let currentLabels;
let originalLabels; // For cancel functionality
let hasUnsavedChanges = false;

/**
 * Load default labels from JSON file
 */
async function loadDefaultLabels() {
  try {
    const response = await fetch('/static/config/default_labels.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    defaultLabels = await response.json();
  } catch (error) {
    console.error('Fehler beim Laden der Default-Labels:', error);
    // Fallback auf leeres Array
    defaultLabels = [];
  }
}

/**
 * Initialize labels module
 */
export async function setupLabels(elements) {
  // Lade zuerst die Default-Labels
  await loadDefaultLabels();
  
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
  
  // Get opacity elements
  labelOpacityInput = document.getElementById('labelOpacity');
  opacityValueDisplay = document.getElementById('opacityValueDisplay');
  
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
  
  // Opacity slider in form
  if (labelOpacityInput && opacityValueDisplay) {
    labelOpacityInput.addEventListener('input', function() {
      opacityValueDisplay.textContent = this.value + '%';
    });
  }
  
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
    
    const isFirst = (currentLabels.indexOf(label) === 0);
    const isLast = (currentLabels.indexOf(label) === currentLabels.length - 1);
    
    // Get opacity value from label data
    const opacityPercent = Math.round((1 - label.opacity) * 100); // Umkehrung: 1 - opacity

    row.innerHTML = `
      <td>
        <button class="layer-move-btn" data-id="${label.id}" data-direction="down" ${isFirst ? 'disabled' : ''} title="In der Tabelle nach oben (Layer nach vorne)">⬆️</button>
        <button class="layer-move-btn" data-id="${label.id}" data-direction="up" ${isLast ? 'disabled' : ''} title="In der Tabelle nach unten (Layer nach hinten)">⬇️</button>
      </td>
      <td>${label.id}</td>
      <td>
        <input type="text" class="inline-edit" data-field="name" data-id="${label.id}" value="${label.name}" />
      </td>
      <td>
        <input type="color" class="inline-edit" data-field="color" data-id="${label.id}" value="${label.color}" />
        <span class="color-preview" style="background-color:${label.color}; margin-left: 5px;"></span>
      </td>
      <td>
        <input type="range" class="inline-edit opacity-slider" data-field="opacity" data-id="${label.id}" 
               min="0" max="100" step="5" value="${opacityPercent}" 
               title="Opacity: ${opacityPercent}%" />
        <span class="opacity-value">${opacityPercent}%</span>
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
    
    // Special handling for opacity slider to update display and tooltip
    if (input.classList.contains('opacity-slider')) {
      input.addEventListener('input', function() {
        const opacityValue = this.nextElementSibling;
        if (opacityValue && opacityValue.classList.contains('opacity-value')) {
          opacityValue.textContent = this.value + '%';
        }
        this.title = `Opacity: ${this.value}%`;
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
  
  // Event listeners for Layer Move buttons
  document.querySelectorAll('.layer-move-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const labelId = parseInt(this.dataset.id);
      const direction = this.dataset.direction;
      moveLabelLayer(labelId, direction);
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
  } else if (field === 'opacity') {
    // Convert percentage back to decimal (0-1 range), umgekehrt: 100% = 0.0, 0% = 1.0
    label.opacity = 1 - (parseInt(value) / 100);
    
    // Update canvas immediately to show opacity changes
    updateCanvasLabels();
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
  
  // Update canvas layer order with new label order
  updateCanvasLayerOrder();
  
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
  
  // Set default opacity (70% opaque = 30% transparent in internal storage)
  if (labelOpacityInput && opacityValueDisplay) {
    labelOpacityInput.value = 70; // 70% opaque wird angezeigt
    opacityValueDisplay.textContent = '70%';
  }
  
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
  const opacity = 1 - (parseInt(labelOpacityInput.value) / 100);
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
  
  // Add new label at the end (highest layer priority - most in front)
  const maxId = currentLabels.reduce((max, label) => Math.max(max, label.id), 0);
  currentLabels.push({
    id: maxId + 1,
    name: name,
    color: color,
    opacity: opacity,
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
 * Move a label up or down in the layer order
 */
function moveLabelLayer(labelId, direction) {
  const currentIndex = currentLabels.findIndex(label => label.id === labelId);
  
  if (currentIndex === -1) return;
  
  let newIndex;
  if (direction === 'up') {
    // Move up in display (towards end of array) = higher layer priority (more in front)
    newIndex = Math.min(currentIndex + 1, currentLabels.length - 1);
  } else if (direction === 'down') {
    // Move down in display (towards start of array) = lower layer priority (more in back)  
    newIndex = Math.max(currentIndex - 1, 0);
  } else {
    return;
  }
  
  if (newIndex === currentIndex) return;
  
  // Move the label in the array
  const label = currentLabels.splice(currentIndex, 1)[0];
  currentLabels.splice(newIndex, 0, label);
  
  hasUnsavedChanges = true;
  refreshLabelTable();
  
  // Update canvas layers immediately
  updateCanvasLayerOrder();
}

/**
 * Update canvas layer order based on current label order
 */
function updateCanvasLayerOrder() {
  const canvas = typeof window.getCanvas === 'function' ? window.getCanvas() : null;
  
  if (canvas) {
    sortCanvasObjectsByLabelOrder(canvas);
  }
  
  // Also update all pages in pageCanvasData if available
  const pageCanvasData = typeof window.getPageCanvasData === 'function' ? window.getPageCanvasData() : null;
  
  if (pageCanvasData) {
    for (const pageNum in pageCanvasData) {
      const pageData = pageCanvasData[pageNum];
      if (pageData && pageData.canvas_annotations) {
        // Sort the stored annotations by label order
        pageData.canvas_annotations.sort((a, b) => {
          const labelIdA = a.labelId || a.objectLabel || 999;
          const labelIdB = b.labelId || b.objectLabel || 999;
          
          const indexA = currentLabels.findIndex(label => label.id === labelIdA);
          const indexB = currentLabels.findIndex(label => label.id === labelIdB);
          
          // UMGEKEHRTE Logik: Lower table index = higher layer (front), higher table index = lower layer (behind)
          return indexB - indexA;
        });
      }
    }
  }
}

/**
 * Sort canvas objects by label order (low index = back, high index = front)
 */
function sortCanvasObjectsByLabelOrder(canvas) {
  if (!canvas) return;
  
  // Get all objects by type
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  const textLabels = canvas.getObjects().filter(obj => obj.objectType === 'textLabel');
  const backgroundImages = canvas.getObjects().filter(obj => 
    obj.type === 'image' && !obj.objectType
  );
  const otherObjects = canvas.getObjects().filter(obj => 
    obj.objectType !== 'annotation' && 
    obj.objectType !== 'textLabel' && 
    !(obj.type === 'image' && !obj.objectType)
  );
  
  // Sort annotations by label order
  annotations.sort((a, b) => {
    const labelIdA = a.labelId || a.objectLabel || 999;
    const labelIdB = b.labelId || b.objectLabel || 999;
    
    const indexA = currentLabels.findIndex(label => label.id === labelIdA);
    const indexB = currentLabels.findIndex(label => label.id === labelIdB);
    
    // If labels are not found, put them at the end
    const finalIndexA = indexA === -1 ? 999 : indexA;
    const finalIndexB = indexB === -1 ? 999 : indexB;
    
    // UMGEKEHRTE Logik: Lower table index = higher layer (front), higher table index = lower layer (behind)
    return finalIndexB - finalIndexA;
  });
  
  // Instead of clearing the entire canvas, just reorder the objects
  // This preserves all canvas properties and event handlers
  
  // Remove all objects temporarily
  const allObjects = canvas.getObjects().slice();
  allObjects.forEach(obj => canvas.remove(obj));
  
  // Add back in correct order:
  // 1. Background images - always at the very back
  // 2. Other objects (if any)
  // 3. Annotations sorted by label order
  // 4. Text labels - always at the front
  backgroundImages.forEach(obj => canvas.add(obj));
  otherObjects.forEach(obj => canvas.add(obj));
  annotations.forEach(obj => canvas.add(obj));
  textLabels.forEach(obj => canvas.add(obj));
  
  canvas.renderAll();
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
  
  // Update existing canvas annotations with new label information
  updateCanvasLabels();
}

/**
 * Update existing canvas annotations with new label information
 */
function updateCanvasLabels() {
  // Update current canvas if available
  const canvas = typeof window.getCanvas === 'function' ? window.getCanvas() : null;
  
  if (canvas) {
    updateCanvasAnnotations(canvas);
    
    // Update results table and UI elements for current canvas
    if (typeof window.updateResultsTable === 'function') {
      window.updateResultsTable();
    }
  }
  
  // Update all pages in pageCanvasData if available
  const pageCanvasData = typeof window.getPageCanvasData === 'function' ? window.getPageCanvasData() : null;
  
  if (pageCanvasData) {
    for (const pageNum in pageCanvasData) {
      const pageData = pageCanvasData[pageNum];
      if (pageData && pageData.canvas_annotations) {
        // Update each annotation in the stored page data
        pageData.canvas_annotations.forEach(annotation => {
          const labelId = annotation.labelId || annotation.objectLabel;
          if (!labelId) return;
          
          // Find the current label
          const label = getLabelById(labelId);
          if (!label) return;
          
          // Update stored annotation colors and styles
          annotation.stroke = label.color;
          if (annotation.annotationType === 'rectangle' || annotation.annotationType === 'polygon') {
            annotation.fill = getLabelColorWithOpacity(label.color, label.opacity);
          } else if (annotation.annotationType === 'line') {
            // Ensure lines never have a fill
            annotation.fill = '';
          }
        });
      }
    }
  }
}

/**
 * Helper function to update annotations on a specific canvas
 */
function updateCanvasAnnotations(canvas) {
  // Get all annotation objects from canvas
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  
  // Update each annotation with current label information
  annotations.forEach(annotation => {
    const labelId = annotation.labelId || annotation.objectLabel;
    if (!labelId) return;
    
    // Find the current label
    const label = getLabelById(labelId);
    if (!label) return;
    
    // Update annotation colors and styles
    const needsFill = annotation.annotationType === 'rectangle' || annotation.annotationType === 'polygon';
    annotation.set({
      stroke: label.color,
      fill: needsFill ? getLabelColorWithOpacity(label.color, label.opacity) : ''
    });
  });
  
  // Recreate all text labels to ensure they use updated colors
  initializeCanvasTextLabels(canvas);
}

/**
 * Initialize text labels for all existing annotations on canvas
 * Moved from main.js to labels.js for better organization
 */
function initializeCanvasTextLabels(canvas) {
  if (!canvas) return;
  
  // Remove all existing text labels first
  const textLabels = canvas.getObjects().filter(obj => obj.objectType === 'textLabel');
  textLabels.forEach(label => canvas.remove(label));
  
  // Get all annotations and create text labels for each
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  annotations.forEach((annotation) => {
    createSingleTextLabel(canvas, annotation);
  });
  
  canvas.renderAll();
  
  // Update results table if available
  if (typeof window.updateResultsTable === 'function') {
    window.updateResultsTable();
  }
}

/**
 * Create a text label for a single annotation
 */
function createSingleTextLabel(canvas, annotation) {
  if (!annotation || !canvas) return;
  
  // Use the main.js function which has all the proper calculations
  if (typeof window.createSingleTextLabel === 'function') {
    return window.createSingleTextLabel(annotation);
  }
}


/**
 * Helper function to get label color with opacity for fill
 */
function getLabelColorWithOpacity(color, opacity = 0.3) {
  // Convert hex color to rgba with opacity
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
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

/**
 * Get current labels for rectangles/polygons
 */
export function getCurrentLabels() {
  return getLabelsForTool('rectangle');
}

/**
 * Get current labels for lines
 */
export function getCurrentLineLabels() {
  return getLabelsForTool('line');
}

/**
 * Apply layer ordering to current canvas (can be called from other modules)
 */
export function applyLayerOrdering() {
  updateCanvasLayerOrder();
}


