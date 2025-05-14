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

// // Zoom-Dropdown für den Editor
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
// Editor einschalten und speichern oder abbrechen
function toggleEditor() {
    console.log("Toggling editor, current state:", isEditorActive);

    // Speichere den vorherigen Zustand für Vergleiche
    const wasEditorActive = isEditorActive;
    
    isEditorActive = !isEditorActive;
    window.isEditorActive = isEditorActive;
    
    if (isEditorActive) {
        // Enable editor
        editorToggle.textContent = 'Editor ausschalten';
        editorToggle.classList.add('active');

        // Aktuelle Zoom-Level speichern zum Debugging
        const currentGlobalZoom = typeof window.getCurrentZoom === 'function' ? window.getCurrentZoom() : 1.0;
        console.log(`Aktiviere Editor mit aktuellem Zoom-Level: ${currentGlobalZoom}`);
        
        // Hide results section (the regular image view)
        if (resultsSection) {
            resultsSection.style.display = 'none';
        }
        
        // Zeige Editor-Bereich an
        editorSection.style.display = 'block';

        // WICHTIG: Sicherung der Original-Annotationen erstellen
        if (window.data && window.data.predictions) {
            // Tiefe Kopie der Annotationen erstellen, damit Änderungen nicht die Originale beeinflussen
            window.data.original_predictions = JSON.parse(JSON.stringify(window.data.predictions));
            console.log(`Sicherung von ${window.data.original_predictions.length} Original-Annotationen erstellt`);
        }
        
        // Bereinige alle vorherigen Inhalte im Editor-Container
        const editorContainer = document.querySelector('.editor-canvas-container');
        if (editorContainer) {
            // Lösche vorherige Inhalte, behalte nur Scroll-Container
            const scrollContainer = editorContainer.querySelector('.scroll-container');
            if (scrollContainer) {
                // Scroll-Container behalten, Inhalt leeren
                scrollContainer.innerHTML = '';
            } else {
                // Alles löschen
                editorContainer.innerHTML = '';
            }
            
            editorContainer.style.display = 'block';
            editorContainer.style.width = '100%';
            editorContainer.style.height = '70vh';
            
            // WICHTIG: Zoom-Controls für den Editor hinzufügen
            const editorControls = document.querySelector('.editor-controls');
            if (editorControls) {
                // Prüfen, ob der Zoom-Button bereits existiert
                let editorZoomBtn = editorControls.querySelector('#editorResetZoomBtn');
                
                if (!editorZoomBtn) {
                    // Zoom-Button erstellen
                    editorZoomBtn = document.createElement('button');
                    editorZoomBtn.id = 'editorResetZoomBtn';
                    editorZoomBtn.className = 'editor-button';
                    editorZoomBtn.textContent = '100%';
                    
                    // Dropdown für Zoom-Optionen
                    const zoomDropdown = document.createElement('div');
                    zoomDropdown.className = 'zoom-dropdown';
                    
                    // Zoom-Optionen
                    const zoomLevels = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
                    
                    zoomLevels.forEach(level => {
                        const option = document.createElement('button');
                        option.className = 'zoom-option';
                        option.dataset.zoom = level;
                        option.textContent = `${Math.round(level * 100)}%`;
                        
                        option.addEventListener('click', function() {
                            const zoomLevel = parseFloat(this.dataset.zoom);
                            // Verwende die neue synchronizeZoom-Funktion
                            if (typeof window.FabricHandler.synchronizeZoom === 'function') {
                                window.FabricHandler.synchronizeZoom(zoomLevel);
                            } else {
                                // Fallback zur alten Methode
                                window.FabricHandler.setEditorZoom(zoomLevel);
                            }
                        });
                        
                        zoomDropdown.appendChild(option);
                    });
                    
                    // Zoom-Container erstellen und an die Editor-Controls anhängen
                    const zoomContainer = document.createElement('div');
                    zoomContainer.className = 'zoom-control';
                    zoomContainer.appendChild(editorZoomBtn);
                    zoomContainer.appendChild(zoomDropdown);
                    
                    editorControls.appendChild(zoomContainer);
                    
                    // Klick-Event zum Zurücksetzen des Zooms
                    editorZoomBtn.addEventListener('click', function() {
                        window.FabricHandler.setEditorZoom(1.0);
                        this.textContent = '100%';
                    });
                }
                
                // Aktuellen Zoom-Wert aus der Ansicht übernehmen
                if (typeof window.getCurrentZoom === 'function') {
                    const currentZoom = window.getCurrentZoom();
                    editorZoomBtn.textContent = `${Math.round(currentZoom * 100)}%`;
                }
            }
        }
        
        // Bild überprüfen
        if (uploadedImage && uploadedImage.src) {
            // Warten, bis das UI aktualisiert wurde
            setTimeout(function() {
                // Editor initialisieren mit der neuen Funktion
                if (typeof window.FabricHandler.initEditor === 'function') {
                    const editorCanvas = window.FabricHandler.initEditor();
                    
                    // Wenn Annotationen vorhanden sind, nach kurzer Verzögerung anzeigen
                    if (window.data && window.data.predictions && window.data.predictions.length > 0) {
                        setTimeout(function() {
                            console.log(`Zeige ${window.data.predictions.length} Annotationen im Editor an...`);
                            window.FabricHandler.displayAnnotations(window.data.predictions);
                            window.FabricHandler.enableEditing();
                            
                            // WICHTIG: Explizit den Zoom vom Ansichtsview übernehmen
                            if (typeof window.FabricHandler.setEditorZoom === 'function' && typeof window.getCurrentZoom === 'function') {
                                const viewZoom = window.getCurrentZoom();
                                console.log(`Setze Editor-Zoom auf ${viewZoom} (von Ansichtsview)`);
                                window.FabricHandler.setEditorZoom(viewZoom);
                            }
                        }, 300);
                    }
                }
            }, 200);
        } else {
            alert('Bitte laden Sie zuerst ein Bild hoch und analysieren Sie es.');
            isEditorActive = false;
            window.isEditorActive = false;
            editorToggle.textContent = 'Editor einschalten';
            editorToggle.classList.remove('active');
            editorSection.style.display = 'none';
        }
    } else {
            // Vorheriger Zustand war aktiv, jetzt deaktivieren
            editorToggle.textContent = 'Editor einschalten';
            editorToggle.classList.remove('active');
            editorSection.style.display = 'none';
            
            // Änderungen speichern, wenn der Editor aktiv war
            if (wasEditorActive && typeof window.FabricHandler.saveAnnotations === 'function') {
                console.log("Speichere Änderungen aus dem Editor");
                const savedAnnotations = window.FabricHandler.saveAnnotations();
                
                // Debug-Ausgabe
                console.log("DEBUG - Editor wird geschlossen:");
                console.log("window.data existiert:", !!window.data);
                console.log("window.data.predictions:", window.data && window.data.predictions ? window.data.predictions.length : 0);
                console.log("FabricHandler.initCanvas existiert:", typeof window.FabricHandler.initCanvas === 'function');
                console.log("updateAnnotationsDisplay existiert:", typeof window.updateAnnotationsDisplay === 'function');
                console.log("displayResults existiert:", typeof window.displayResults === 'function');
                console.log("getCurrentZoom Wert:", typeof window.getCurrentZoom === 'function' ? window.getCurrentZoom() : "nicht verfügbar");
                
                // Normalen View wieder anzeigen
                if (resultsSection) {
                    resultsSection.style.display = 'block';
                }
                
                // NEUE METHODE: Verwende die robuste reloadAnnotations-Funktion
                if (window.FabricHandler && typeof window.FabricHandler.reloadAnnotations === 'function') {
                    setTimeout(function() {
                        window.FabricHandler.reloadAnnotations();
                    }, 300);
                } 
                // ALTE METHODEN ALS FALLBACK
                else if (typeof window.FabricHandler.initCanvas === 'function' && window.data && window.data.predictions) {
                    window.FabricHandler.clearAnnotations();
                    const canvas = window.FabricHandler.initCanvas();
                    
                    setTimeout(function() {
                        window.FabricHandler.displayAnnotations(window.data.predictions);
                        
                        // Aktuellen Zoom anwenden
                        if (typeof window.getCurrentZoom === 'function') {
                            const currentZoom = window.getCurrentZoom();
                            window.FabricHandler.syncEditorZoom(currentZoom);
                        }
                        
                        // Summary und Tabelle aktualisieren
                        if (typeof window.updateSummary === 'function') {
                            window.updateSummary();
                        }
                        if (typeof window.updateResultsTable === 'function') {
                            window.updateResultsTable();
                        }
                    }, 100);
                } else if (typeof window.updateAnnotationsDisplay === 'function') {
                    window.updateAnnotationsDisplay();
                } else {
                    console.warn("Keine Funktion zum Aktualisieren der Ansicht gefunden");
                }
            } else {
                // Normale Ansicht ohne Speichern anzeigen
                if (resultsSection) {
                    resultsSection.style.display = 'block';

                    // Positioniert Annotations nach kurzer Wartezeit an die richtige Position
                    setTimeout(function() {
                        if (window.FabricHandler && window.data && window.data.predictions) {
                            window.FabricHandler.clearAnnotations();
                            window.FabricHandler.initCanvas();
                            window.FabricHandler.displayAnnotations(window.data.predictions);
                        }
                    }, 100);
                }
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