/**
 * editor.js - UI Controller for Fabric.js editor integration
 * Part of the Fenster-Erkennungstool project
 */

// Global variables
let isEditorActive = false;
window.isEditorActive = false;

// DOM references
let uploadedImage, imageContainer, resultsSection;
let editorSection, editorToggle;

// Initialize the editor UI controller
function initEditor(elements) {
    console.log("Initializing editor UI controller");
    
    // Store DOM references
    uploadedImage = elements.uploadedImage;
    imageContainer = elements.imageContainer;
    resultsSection = elements.resultsSection;
    
    // Editor elements
    editorSection = document.getElementById('editorSection');
    editorToggle = document.getElementById('editorToggle');
    
    // Set up event listeners
    setupEditorButtons();
    
    console.log("Editor UI controller initialized");
}

// Set up all editor-related button handlers
function setupEditorButtons() {
    // Main editor toggle
    if (editorToggle) {
        editorToggle.addEventListener('click', toggleEditor);
    }
    
    // Drawing mode buttons
    const addBoxBtn = document.getElementById('addBoxBtn');
    const addPolygonBtn = document.getElementById('addPolygonBtn');
    const addLineBtn = document.getElementById('addLineBtn');
    const editBoxBtn = document.getElementById('editBoxBtn');
    const deleteBoxBtn = document.getElementById('deleteBoxBtn');
    
    if (addBoxBtn) {
        addBoxBtn.addEventListener('click', function() {
            setActiveButton(this);
            const labelId = parseInt(document.getElementById('objectTypeSelect').value);
            window.FabricHandler.enableDrawingMode('rectangle', labelId);
        });
    }
    
    if (addPolygonBtn) {
        addPolygonBtn.addEventListener('click', function() {
            setActiveButton(this);
            const labelId = parseInt(document.getElementById('objectTypeSelect').value);
            window.FabricHandler.enableDrawingMode('polygon', labelId);
        });
    }
    
    if (addLineBtn) {
        addLineBtn.addEventListener('click', function() {
            setActiveButton(this);
            const lineTypeSelect = document.getElementById('lineTypeSelect');
            const labelId = lineTypeSelect ? parseInt(lineTypeSelect.value) : 1;
            window.FabricHandler.enableDrawingMode('line', labelId);
            
            // Toggle visibility of label selectors
            toggleLabelSelectors('line');
        });
    }
    
    if (editBoxBtn) {
        editBoxBtn.addEventListener('click', function() {
            setActiveButton(this);
            window.FabricHandler.enableEditing();
            toggleLabelSelectors('area');
        });
    }
    
    if (deleteBoxBtn) {
        deleteBoxBtn.addEventListener('click', function() {
            window.FabricHandler.deleteSelected();
        });
    }
    
    // Action buttons
    const saveEditBtn = document.getElementById('saveEditBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    
    if (saveEditBtn) {
        saveEditBtn.addEventListener('click', function() {
            window.FabricHandler.saveAnnotations();
            toggleEditor(); // Exit editor mode
        });
    }
    
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', function() {
            window.FabricHandler.cancelEditing();
            toggleEditor(); // Exit editor mode
        });
    }
    
    // Type select changes
    const objectTypeSelect = document.getElementById('objectTypeSelect');
    if (objectTypeSelect) {
        objectTypeSelect.addEventListener('change', function() {
            const labelId = parseInt(this.value);
            window.FabricHandler.changeSelectedLabel(labelId);
        });
    }
    
    const lineTypeSelect = document.getElementById('lineTypeSelect');
    if (lineTypeSelect) {
        lineTypeSelect.addEventListener('change', function() {
            const labelId = parseInt(this.value);
            window.FabricHandler.changeSelectedLineType(labelId);
        });
    }
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
}

// Toggle editor on/off
function toggleEditor() {
    console.log("Toggling editor, current state:", isEditorActive);
    
    isEditorActive = !isEditorActive;
    window.isEditorActive = isEditorActive;
    
    if (isEditorActive) {
        // Enable editor
        editorToggle.textContent = 'Editor ausschalten';
        editorToggle.classList.add('active');
        editorSection.style.display = 'block';
        
        // Hide results section (the regular image view)
        if (resultsSection) {
            resultsSection.style.display = 'none';
        }
        
        // Initialize fabric canvas if image is loaded
        if (uploadedImage.src) {
            if (typeof window.FabricHandler.initCanvas === 'function') {
                window.FabricHandler.initCanvas();
                window.FabricHandler.enableEditing();
            } else {
                console.error("FabricHandler.initCanvas function not found");
            }
        } else {
            alert('Bitte laden Sie zuerst ein Bild hoch und analysieren Sie es.');
            isEditorActive = false;
            window.isEditorActive = false;
            editorToggle.textContent = 'Editor einschalten';
            editorToggle.classList.remove('active');
            editorSection.style.display = 'none';
        }
    } else {
        // Disable editor
        editorToggle.textContent = 'Editor einschalten';
        editorToggle.classList.remove('active');
        editorSection.style.display = 'none';
        
        // Show results section again
        if (resultsSection) {
            resultsSection.style.display = 'block';
        }
        
        // Save changes
        if (typeof window.FabricHandler.saveAnnotations === 'function') {
            window.FabricHandler.saveAnnotations();
        }
    }
}

// Handle keyboard shortcuts
function handleKeyboardShortcuts(e) {
    if (!isEditorActive) return;
    
    // Delete key - delete selected
    if (e.key === 'Delete' || e.key === 'Backspace') {
        window.FabricHandler.deleteSelected();
    }
    
    // Ctrl+C - Copy 
    if (e.ctrlKey && e.key === 'c') {
        window.FabricHandler.copySelected();
    }
    
    // Esc - Exit drawing mode
    if (e.key === 'Escape') {
        const editBoxBtn = document.getElementById('editBoxBtn');
        if (editBoxBtn) {
            setActiveButton(editBoxBtn);
        }
        window.FabricHandler.enableEditing();
        toggleLabelSelectors('area');
    }
}

// Toggle between area and line label selectors
function toggleLabelSelectors(type) {
    const objectTypeSelect = document.getElementById('objectTypeSelect');
    const lineTypeSelect = document.getElementById('lineTypeSelect');
    
    if (!objectTypeSelect || !lineTypeSelect) return;
    
    if (type === 'line') {
        objectTypeSelect.style.display = 'none';
        lineTypeSelect.style.display = 'inline-block';
    } else {
        objectTypeSelect.style.display = 'inline-block';
        lineTypeSelect.style.display = 'none';
    }
}

// Set active state for editor buttons
function setActiveButton(activeButton) {
    const buttons = [
        document.getElementById('addBoxBtn'),
        document.getElementById('addPolygonBtn'),
        document.getElementById('addLineBtn'),
        document.getElementById('editBoxBtn'),
        document.getElementById('deleteBoxBtn')
    ];
    
    buttons.forEach(button => {
        if (button && button !== activeButton) {
            button.classList.remove('active');
        }
    });
    
    if (activeButton) {
        activeButton.classList.add('active');
    }
}

// Make functions globally accessible
window.initEditor = initEditor;
window.toggleEditor = toggleEditor;