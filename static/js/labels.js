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
export function closeLabelManager() {
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
        <button class="layer-move-btn" data-id="${label.id}" data-direction="down" ${isFirst ? 'disabled' : ''} title="Layer nach vorne">▲</button>
        <button class="layer-move-btn" data-id="${label.id}" data-direction="up" ${isLast ? 'disabled' : ''} title="Layer nach hinten">▼</button>
      </td>
      <td>
        <input type="text" class="inline-edit" data-field="name" data-id="${label.id}" value="${label.name}" />
      </td>
      <td>
        <div class="color-cell">
          <input type="color" class="inline-edit" data-field="color" data-id="${label.id}" value="${label.color}" />
        </div>
      </td>
      <td>
        <input type="range" class="inline-edit opacity-slider" data-field="opacity" data-id="${label.id}"
               min="0" max="100" step="5" value="${opacityPercent}"
               title="Opacity: ${opacityPercent}%" />
        <span class="opacity-value">${opacityPercent}%</span>
      </td>
      <td>
        <input type="number" class="inline-edit stroke-width-input" data-field="strokeWidth" data-id="${label.id}"
               min="1" max="20" step="1" value="${label.strokeWidth || 2}" />
      </td>
      <td style="text-align:center;"><input type="checkbox" class="inline-edit" data-field="rectangle" data-id="${label.id}" ${label.tools.rectangle ? 'checked' : ''}></td>
      <td style="text-align:center;"><input type="checkbox" class="inline-edit" data-field="polygon" data-id="${label.id}" ${label.tools.polygon ? 'checked' : ''}></td>
      <td style="text-align:center;"><input type="checkbox" class="inline-edit" data-field="line" data-id="${label.id}" ${label.tools.line ? 'checked' : ''}></td>
      <td>
        <button class="copy-label-btn" data-id="${label.id}" title="Label kopieren">⧉</button>
        <button class="delete-label-btn" data-id="${label.id}" title="Label löschen">×</button>
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
  
  // Event listeners for Copy buttons
  document.querySelectorAll('.copy-label-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const labelId = parseInt(this.dataset.id);
      copyLabel(labelId);
    });
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
    updateCanvasLabels();
  } else if (field === 'strokeWidth') {
    label.strokeWidth = Math.max(1, parseInt(value) || 1);
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
 * Show form to add a new label — inserts a row at the bottom of the table
 */
function showAddLabelForm() {
  if (document.getElementById('newLabelRow')) return; // already open

  const PALETTE = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e'];
  const randomColor = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const defaultOpacity = 70;

  const tr = document.createElement('tr');
  tr.id = 'newLabelRow';
  tr.style.background = '#f0f7ff';
  tr.innerHTML = `
    <td></td>
    <td>
      <input type="text" class="inline-edit" id="newLabel-name" placeholder="Name…" style="width:100%;" />
    </td>
    <td>
      <div class="color-cell">
        <input type="color" class="inline-edit" id="newLabel-color" value="${randomColor}" />
      </div>
    </td>
    <td>
      <input type="range" class="inline-edit opacity-slider" id="newLabel-opacity"
             min="0" max="100" step="5" value="${defaultOpacity}" title="Opacity: ${defaultOpacity}%" />
      <span class="opacity-value" id="newLabel-opacity-val">${defaultOpacity}%</span>
    </td>
    <td>
      <input type="number" class="stroke-width-input" id="newLabel-stroke" min="1" max="20" step="1" value="2" />
    </td>
    <td style="text-align:center;"><input type="checkbox" id="newLabel-rect" checked></td>
    <td style="text-align:center;"><input type="checkbox" id="newLabel-poly" checked></td>
    <td style="text-align:center;"><input type="checkbox" id="newLabel-line" checked></td>
    <td>
      <button class="save-label-btn" title="Speichern (Enter)">✓ Speichern</button>
      <button class="delete-label-btn" title="Abbrechen">×</button>
    </td>
  `;
  labelTableBody.appendChild(tr);

  tr.querySelector('.opacity-slider').addEventListener('input', function() {
    tr.querySelector('#newLabel-opacity-val').textContent = this.value + '%';
    this.title = `Opacity: ${this.value}%`;
  });

  tr.querySelector('.save-label-btn').addEventListener('click', saveNewLabel);
  tr.querySelector('.delete-label-btn').addEventListener('click', hideForm);

  tr.querySelector('#newLabel-name').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveNewLabel();
  });

  tr.querySelector('#newLabel-name').focus();
}

/**
 * Save a new label from the inline table row
 */
function saveNewLabel() {
  const nameInput = document.getElementById('newLabel-name');
  const colorInput = document.getElementById('newLabel-color');
  const opacityInput = document.getElementById('newLabel-opacity');
  const strokeInput = document.getElementById('newLabel-stroke');
  const rectInput = document.getElementById('newLabel-rect');
  const polyInput = document.getElementById('newLabel-poly');
  const lineInput = document.getElementById('newLabel-line');

  if (!nameInput) return;

  const name = nameInput.value.trim();
  const color = colorInput.value;
  const opacity = 1 - (parseInt(opacityInput.value) / 100);
  const strokeWidth = Math.max(1, parseInt(strokeInput.value) || 2);
  const tools = {
    rectangle: rectInput.checked,
    polygon: polyInput.checked,
    line: lineInput.checked
  };

  if (!name) {
    alert('Bitte einen Namen eingeben.');
    nameInput.focus();
    return;
  }

  if (!tools.rectangle && !tools.polygon && !tools.line) {
    alert('Bitte mindestens ein Werkzeug auswählen.');
    return;
  }

  const maxId = currentLabels.reduce((max, label) => Math.max(max, label.id), 0);
  currentLabels.push({ id: maxId + 1, name, color, opacity, strokeWidth, tools });

  hasUnsavedChanges = true;
  refreshLabelTable();
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
 * Duplicate a label and insert it directly below the original
 */
function copyLabel(labelId) {
  const index = currentLabels.findIndex(l => l.id === labelId);
  if (index === -1) return;

  const original = currentLabels[index];
  const maxId = currentLabels.reduce((max, l) => Math.max(max, l.id), 0);
  const copy = {
    id: maxId + 1,
    name: original.name + ' (Kopie)',
    color: original.color,
    opacity: original.opacity,
    strokeWidth: original.strokeWidth || 2,
    tools: { ...original.tools }
  };

  currentLabels.splice(index + 1, 0, copy);
  hasUnsavedChanges = true;
  refreshLabelTable();
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
 * Sort canvas objects by label order.
 * Layer groups (back→front): backgrounds → annotations → textLabels.
 * Within annotations: higher currentLabels index = more behind; lower index = more in front.
 * Operates directly on canvas._objects to avoid firing object:removed/added events.
 */
function sortCanvasObjectsByLabelOrder(canvas) {
  if (!canvas) return;

  const layerRank = obj => {
    if (obj.objectType === 'textLabel') return 3;   // always front
    if (obj.objectType === 'dimension') return 2;   // helper lines above annotations
    if (obj.objectType === 'textNote')  return 2;   // text notes above annotations too
    if (obj.objectType === 'annotation') return 1;   // middle
    return 0;                                         // background / other → back
  };

  canvas._objects.sort((a, b) => {
    const ra = layerRank(a);
    const rb = layerRank(b);
    if (ra !== rb) return ra - rb;

    // Both annotations: lower currentLabels index → front (later in _objects)
    if (ra === 1) {
      const idA = a.labelId || a.objectLabel || 999;
      const idB = b.labelId || b.objectLabel || 999;
      const ia = currentLabels.findIndex(l => l.id === idA);
      const ib = currentLabels.findIndex(l => l.id === idB);
      const fa = ia === -1 ? 999 : ia;
      const fb = ib === -1 ? 999 : ib;
      return fb - fa; // higher index first → lower index last (front)
    }
    return 0;
  });

  canvas.requestRenderAll();
}

/**
 * Hide/remove the new-label row
 */
function hideForm() {
  const row = document.getElementById('newLabelRow');
  if (row) row.remove();
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
      fill: needsFill ? getLabelColorWithOpacity(label.color, label.opacity) : '',
      strokeWidth: label.strokeWidth || 2
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
  downloadAnchorNode.setAttribute("download", "planli_labels.json");
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

  // Update AI analysis target-label select ("Erkennen als" in Analyse-Einstellungen)
  const aiLabelSelect = document.getElementById('aiLabelSelect');
  if (aiLabelSelect) {
    const selectedValue = aiLabelSelect.value;

    aiLabelSelect.innerHTML = '';
    getLabelsForTool('rectangle').forEach(label => {
      const option = document.createElement('option');
      option.value = label.id;
      option.textContent = label.name;
      aiLabelSelect.appendChild(option);
    });

    if (selectedValue && aiLabelSelect.querySelector(`option[value="${selectedValue}"]`)) {
      aiLabelSelect.value = selectedValue;
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


