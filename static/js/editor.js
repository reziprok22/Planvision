/**
 * Editor-Funktionen für Fenster-Erkennungstool
 */

// Globale Variablen für den Editor
let isEditorActive = false;
let currentMode = 'view'; // 'view', 'add', 'edit', 'delete'
let selectedBoxIndex = -1;
let newBox = null;
let startX, startY;
let editorOriginalState = null;
let ctx = null;
let currentPolygon = null;
let polygonPoints = [];
let isDrawingPolygon = false;
let currentLine = null;
let linePoints = [];
let isDrawingLine = false;
let lastKnownZoom = 1.0;

window.isEditorActive = false;



// Hauptelemente für Editor-Zugriff
let uploadedImage, imageContainer, annotationOverlay, resultsSection;

// Editor-Elemente
let editorSection, editorCanvas, editorToggle, addBoxBtn, editBoxBtn, deleteBoxBtn;
let addPolygonBtn = document.getElementById('addPolygonBtn');
let saveEditBtn, cancelEditBtn, objectTypeSelect;

// Funktionen aus der Hauptdatei, die der Editor benötigt
let updateSummary, updateResultsTable, addAnnotation;

// Initialisierungsfunktion, die beim Laden der Haupt-JS-Datei aufgerufen wird
function initEditor(elements) {
    // Haupt-UI-Elemente übernehmen
    uploadedImage = elements.uploadedImage;
    imageContainer = elements.imageContainer;
    annotationOverlay = elements.annotationOverlay;
    resultsSection = elements.resultsSection;
    
    // Funktionen aus der Hauptdatei übernehmen
    updateSummary = elements.updateSummary;
    updateResultsTable = elements.updateResultsTable;
    addAnnotation = elements.addAnnotation;
    
    // Editor-Elemente übernehmen
    editorSection = document.getElementById('editorSection');
    editorCanvas = document.getElementById('editorCanvas');
    editorToggle = document.getElementById('editorToggle');
    addBoxBtn = document.getElementById('addBoxBtn');
    editBoxBtn = document.getElementById('editBoxBtn');
    deleteBoxBtn = document.getElementById('deleteBoxBtn');
    saveEditBtn = document.getElementById('saveEditBtn');
    cancelEditBtn = document.getElementById('cancelEditBtn');
    objectTypeSelect = document.getElementById('objectTypeSelect');
    addLineBtn = document.getElementById('addLineBtn');

    // Anstatt onclick="window.initEditor.toggleEditor() im index.html
    if (editorToggle) {
        // Remove any existing event listeners first
        editorToggle.removeEventListener('click', toggleEditor);
        // Add the click event listener
        editorToggle.addEventListener('click', toggleEditor);
        console.log("Editor-Toggle-Event-Listener hinzugefügt");
    }
    
    // Überprüfen, ob alle Editor-Elemente vorhanden sind
    console.log("Editor-Elemente geladen:", {
        editorSection: !!editorSection,
        editorCanvas: !!editorCanvas,
        editorToggle: !!editorToggle
    });
    
    // Event-Listener hinzufügen
    if (editorToggle) {
        editorToggle.addEventListener('click', toggleEditor);
        console.log("Editor-Toggle-Event-Listener hinzugefügt");
    }
    
    // Weitere Event-Listener hinzufügen für den Editor
    if (addBoxBtn) addBoxBtn.addEventListener('click', () => setEditorMode('add'));
    if (editBoxBtn) editBoxBtn.addEventListener('click', () => setEditorMode('edit'));
    if (deleteBoxBtn) deleteBoxBtn.addEventListener('click', () => setEditorMode('delete'));
    if (saveEditBtn) saveEditBtn.addEventListener('click', saveEditorChanges);
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', cancelEditorChanges);
    if (addPolygonBtn) addPolygonBtn.addEventListener('click', () => setEditorMode('addPolygon'));
    if (addLineBtn) addLineBtn.addEventListener('click', () => setEditorMode('addLine'));


    
    // Canvas Event-Listener
    if (editorCanvas) {
        editorCanvas.addEventListener('mousedown', handleMouseDown);
        editorCanvas.addEventListener('mousemove', handleMouseMove);
        editorCanvas.addEventListener('mouseup', handleMouseUp);
        editorCanvas.addEventListener('click', handleClick);
        editorCanvas.addEventListener('dblclick', handleDoubleClick);
        console.log("Canvas-Event-Listener hinzugefügt");
    }

    // Tastatur-Event-Listener für die Escape-Taste
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            if (currentMode === 'addLine' && isDrawingLine && linePoints.length >= 1) {
                // Linie abschließen
                finishLine();
            }
        }
    });
    
    // Event-Listener für Objekttyp-Änderung
    if (objectTypeSelect) {
        objectTypeSelect.addEventListener('change', function() {
            if (selectedBoxIndex >= 0) {
                const selectedType = parseInt(objectTypeSelect.value);
                window.data.predictions[selectedBoxIndex].label = selectedType;
                
                // Label-Name aktualisieren
                switch (selectedType) {
                    case 1: window.data.predictions[selectedBoxIndex].label_name = "Fenster"; break;
                    case 2: window.data.predictions[selectedBoxIndex].label_name = "Tür"; break;
                    case 3: window.data.predictions[selectedBoxIndex].label_name = "Wand"; break;
                    case 4: window.data.predictions[selectedBoxIndex].label_name = "Lukarne"; break;
                    case 5: window.data.predictions[selectedBoxIndex].label_name = "Dach"; break;
                    default: window.data.predictions[selectedBoxIndex].label_name = "Andere";
                }
                
                redrawCanvas();
            }
        });
    }
}

// Funktion zum Ein-/Ausschalten des Editors
function toggleEditor() {
    console.log("Toggle-Editor aufgerufen, aktueller Status:", isEditorActive);
    isEditorActive = !isEditorActive;
    window.isEditorActive = isEditorActive; // Update the global variable
    
    if (isEditorActive) {
        // Editor aktivieren
        editorToggle.textContent = 'Editor ausschalten';
        editorToggle.classList.add('active');
        editorSection.style.display = 'block';

        // Ensure editor section has scroll capabilities
        editorSection.style.overflow = 'auto';

        // Zoom
        initializeZoomAwareCanvas();

        // Sync with current zoom level
        syncWithCurrentZoom();
        
        // Aktuelle Ergebnisse sichern
        if (window.data && window.data.predictions) {
            console.log("Originaldaten sichern, Vorhersagen:", window.data.predictions.length);
            editorOriginalState = JSON.parse(JSON.stringify(window.data.predictions));
        } else {
            console.warn("Keine Daten gefunden!");
            editorOriginalState = [];
        }
        
        // Canvas initialisieren
        if (uploadedImage.src) {
            // Sicherstellen, dass das Bild geladen ist
            if (uploadedImage.complete) {
                initializeEditor(uploadedImage);
            } else {
                uploadedImage.onload = function() {
                    initializeEditor(uploadedImage);
                };
            }
        } else {
            alert('Bitte laden Sie zuerst ein Bild hoch und analysieren Sie es.');
            isEditorActive = false;
            editorToggle.textContent = 'Editor einschalten';
            editorToggle.classList.remove('active');
            editorSection.style.display = 'none';
        }
    } else {
        // Editor deaktivieren
        editorToggle.textContent = 'Editor einschalten';
        editorToggle.classList.remove('active');
        editorSection.style.display = 'none';
        
        // Variablen zurücksetzen
        currentMode = 'view';
        selectedBoxIndex = -1;
        newBox = null;
        
        // Ergebnisanzeige wieder einblenden
        resultsSection.style.display = 'block';
        editorCanvas.style.display = 'none';
        
        // Immer Annotationen aktualisieren, unabhängig von Änderungen
        console.log("Editor wird deaktiviert, aktualisiere Annotationen");
        refreshAnnotations();
    }
}

// Editor initialisieren
function initializeEditor(image) {
    console.log("Editor initialisieren mit Bild:", image.width, "x", image.height);   
    console.log("Current zoom when initializing editor:", lastKnownZoom);
    
    // Bildgröße anpassen
    editorCanvas.width = image.width;
    editorCanvas.height = image.height;
    // editorCanvas.width = image.naturalWidth; // Originalgrösse
    // editorCanvas.height = image.naturalHeight; // Originalgrösse

    // Get current zoom level from window object
    lastKnownZoom = (typeof window.getCurrentZoom === 'function') ? 
    window.getCurrentZoom() : 1.0;

    // Apply zoom to the editor
    applyZoomToEditor();

    // Apply zoom transformation
    // editorCanvas.style.transform = `scale(${lastKnownZoom})`;
    // editorCanvas.style.transformOrigin = 'top left';
    
    // Context abrufen
    ctx = editorCanvas.getContext('2d');
    
    // Bild auf den Canvas zeichnen
    ctx.drawImage(image, 0, 0, editorCanvas.width, editorCanvas.height);
    
    // Überprüfen ob window.data existiert und gültig ist
    if (!window.data || !window.data.predictions) {
        console.warn("Keine Daten oder Vorhersagen gefunden! Initialisiere leeres Array.");
        window.data = window.data || {};
        window.data.predictions = window.data.predictions || [];
    }
    
    // Standardmodus setzen
    setEditorMode('view');
    
    // Ergebnisanzeige ausblenden
    resultsSection.style.display = 'none';
    
    // Canvas einblenden
    editorCanvas.style.display = 'block';
    
    // Boxen zeichnen
    console.log("Rufe drawAllBoxes nach Initialisierung auf");
    drawAllBoxes();
}

// Editor-Modus setzen
function setEditorMode(mode) {
    console.log("Editor-Modus setzen auf:", mode);
    currentMode = mode;
    
    // UI-Buttons aktualisieren
    addBoxBtn.classList.toggle('active', mode === 'add');
    editBoxBtn.classList.toggle('active', mode === 'edit');
    deleteBoxBtn.classList.toggle('active', mode === 'delete');

    // Falls vorhanden, auch Polygon-Button zurücksetzen
    if (addPolygonBtn) addPolygonBtn.classList.remove('active');
    if (addLineBtn) addLineBtn.classList.remove('active');


    // Aktiven Button markieren
    if (mode === 'add') addBoxBtn.classList.add('active');
    if (mode === 'edit') editBoxBtn.classList.add('active');
    if (mode === 'delete') deleteBoxBtn.classList.add('active');
    if (mode === 'addPolygon' && addPolygonBtn) addPolygonBtn.classList.add('active');
    if (mode === 'addLine' && addLineBtn) addLineBtn.classList.add('active');

    // Update label dropdown visibility based on mode
    const objectTypeSelect = document.getElementById('objectTypeSelect');
    const lineTypeSelect = document.getElementById('lineTypeSelect');

    if (mode === 'addLine') {
        if (objectTypeSelect) objectTypeSelect.style.display = 'none';
        if (lineTypeSelect) lineTypeSelect.style.display = 'inline-block';
    } else {
        if (objectTypeSelect) objectTypeSelect.style.display = 'inline-block';
        if (lineTypeSelect) lineTypeSelect.style.display = 'none';
    }

    
    // Auswahl zurücksetzen
    selectedBoxIndex = -1;
    newBox = null;

    // Polygon zurücksetzen, wenn wir vom Polygon-Modus wegwechseln
    if (mode !== 'addPolygon') {
        polygonPoints = [];
        isDrawingPolygon = false;
    } else {
        // Polygon-Zeichnung starten
        polygonPoints = [];
        isDrawingPolygon = true;
    }      

    // Linienmodus aktivieren/deaktivieren
    if (mode !== 'addLine') {
        linePoints = [];
        isDrawingLine = false;
    } else {
        // Linien-Zeichnung starten
        linePoints = [];
        isDrawingLine = true;
    }
    
    // Wenn der Linienmodus aktiviert wird, zeigen wir einen Hilfetext an
    if (mode === 'addLine') {
        // Zeige Tooltip/Hilfeleiste an
        const helpText = document.createElement('div');
        helpText.id = 'lineHelp';
        helpText.className = 'editor-help-text';
        helpText.innerHTML = 'Klicken Sie, um Punkte hinzuzufügen. <b>Doppelklick</b> oder <b>Escape</b> zum Abschließen der Messung. <b>Strg+Klick</b> beendet auch die Linie.';
        
        // Vorhandene Hilfe entfernen
        const oldHelp = document.getElementById('lineHelp');
        if (oldHelp) oldHelp.remove();
        
        // Neue Hilfe einfügen
        editorSection.insertBefore(helpText, editorCanvas);
    } else {
        // Hilfetext entfernen, wenn wir nicht im Linienmodus sind
        const helpText = document.getElementById('lineHelp');
        if (helpText) helpText.remove();
    }
    
    // Canvas neu zeichnen
    redrawCanvas();

    // Cursor-Stil anpassen
    switch(mode) {
        case 'add':
        case 'addPolygon':
        case 'addLine':
            editorCanvas.style.cursor = 'crosshair';
            break;
        case 'edit':
            editorCanvas.style.cursor = 'pointer';
            break;
        case 'delete':
            editorCanvas.style.cursor = 'not-allowed';
            break;
        default:
            editorCanvas.style.cursor = 'default';
    }
}
    
// Canvas neu zeichnen
function redrawCanvas() {
    console.log("redrawCanvas aufgerufen");
    
    if (!ctx) {
        console.warn("Kein Canvas-Kontext verfügbar!");
        return;
    }
    
    // Überprüfen, ob Canvas-Dimensionen korrekt gesetzt sind
    if (editorCanvas.width === 0 || editorCanvas.height === 0) {
        console.warn("Canvas hat ungültige Dimensionen:", editorCanvas.width, "x", editorCanvas.height);
        return;
    }
    
    // Canvas löschen
    ctx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    
    // Überprüfen, ob das Bild geladen ist
    if (!uploadedImage.complete || uploadedImage.naturalWidth === 0) {
        console.warn("Bild nicht vollständig geladen");
        return;
    }
    
    // Bild neu zeichnen
    ctx.drawImage(uploadedImage, 0, 0, editorCanvas.width, editorCanvas.height);
    
    // Alle Boxen zeichnen
    drawAllBoxes();
}

// Alle Boxen zeichnen
function drawAllBoxes() {
    console.log("drawAllBoxes Details:", {
        ctx: !!ctx,
        predictions: window.data?.predictions?.length || 0,
        currentMode,
        polygonPoints: polygonPoints.length
    });
    
    if (!ctx) {
        console.warn("Kein Canvas-Kontext verfügbar!");
        return;
    }
    
    // Daten überprüfen
    if (!window.data || !window.data.predictions) {
        console.warn("Keine Daten für das Zeichnen der Boxen verfügbar!");
        return;
    }
    
    const scale = editorCanvas.width / uploadedImage.naturalWidth;
    console.log("Skalierungsfaktor:", scale);
    
    // Zeichne alle Boxen aus den Vorhersagen
    window.data.predictions.forEach((pred, index) => {
        const isSelected = index === selectedBoxIndex;
        console.log(`Zeichne Vorhersage #${index}:`, pred.type || "rectangle", isSelected ? "(ausgewählt)" : "");
        
        if (pred.box || pred.bbox) {
            const [x1, y1, x2, y2] = pred.box || pred.bbox;
            const scaledX1 = x1 * scale;
            const scaledY1 = y1 * scale;
            const scaledW = (x2 - x1) * scale;
            const scaledH = (y2 - y1) * scale;
            
            // Box-Farbe basierend auf Kategorie
            let color;
            
            // Suche das entsprechende Label aus den benutzerdefinierten Labels
            const label = window.currentLabels ? window.currentLabels.find(l => l.id === pred.label) : null;
            
            if (label && label.color) {
                // Verwende die benutzerdefinierte Farbe
                color = label.color;
            } else {
                // Fallback auf die Standard-Farben
                switch (pred.label) {
                    case 1: color = 'blue'; break;  // Fenster
                    case 2: color = 'red'; break;   // Tür
                    case 3: color = '#d4d638'; break; // Wand
                    case 4: color = 'orange'; break; // Lukarne
                    case 5: color = 'purple'; break; // Dach
                    default: color = 'gray';
                }
            }
            
            // Stil festlegen
            ctx.strokeStyle = isSelected ? 'lime' : color;
            ctx.lineWidth = isSelected ? 3 : 2;
            
            // Box zeichnen
            ctx.strokeRect(scaledX1, scaledY1, scaledW, scaledH);
            
            // Hintergrund mit leichter Transparenz
            ctx.fillStyle = `${ctx.strokeStyle}20`;  // 20% Opazität
            ctx.fillRect(scaledX1, scaledY1, scaledW, scaledH);
            
            // Label zeichnen
            ctx.fillStyle = color;
            ctx.font = '12px Arial';
            
            const label_text = `#${index + 1}: ${pred.area.toFixed(2)} m²`;
            const labelWidth = ctx.measureText(label_text).width + 10;
            
            ctx.fillRect(scaledX1, scaledY1 - 20, labelWidth, 20);
            ctx.fillStyle = 'white';
            ctx.fillText(label_text, scaledX1 + 5, scaledY1 - 5);
        } else if (pred.type === "polygon" && pred.polygon) {
            const {all_points_x, all_points_y} = pred.polygon;
            
            if (!all_points_x || !all_points_y || all_points_x.length < 3) {
                console.warn("Ungültiges Polygon gefunden, überspringe...");
                return;
            }
            
            // Suche das entsprechende Label
            const label = window.currentLabels ? window.currentLabels.find(l => l.id === pred.label) : null;
            
            // Farbauswahl wie bei den Boxen
            let color;
            if (label && label.color) {
                color = label.color;
            } else {
                switch (pred.label) {
                    case 1: color = 'blue'; break;
                    case 2: color = 'red'; break;
                    case 3: color = '#d4d638'; break;
                    case 4: color = 'orange'; break;
                    case 5: color = 'purple'; break;
                    default: color = 'gray';
                }
            }
            
            // Stil festlegen
            ctx.strokeStyle = isSelected ? 'lime' : color;
            ctx.fillStyle = isSelected ? 'rgba(0, 255, 0, 0.1)' : `${color}20`;
            ctx.lineWidth = isSelected ? 3 : 2;
            
            // Polygon zeichnen
            ctx.beginPath();
            ctx.moveTo(all_points_x[0] * scale, all_points_y[0] * scale);
            
            for (let i = 1; i < all_points_x.length; i++) {
                ctx.lineTo(all_points_x[i] * scale, all_points_y[i] * scale);
            }
            
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // Berechne Schwerpunkt für das Label
            let centerX = 0, centerY = 0;
            for (let i = 0; i < all_points_x.length; i++) {
                centerX += all_points_x[i] * scale;
                centerY += all_points_y[i] * scale;
            }
            centerX /= all_points_x.length;
            centerY /= all_points_y.length;
            
            // Label zeichnen
            ctx.fillStyle = color;
            ctx.font = '12px Arial';
            
            const label_text = `#${index + 1}: ${pred.area.toFixed(2)} m²`;
            const labelWidth = ctx.measureText(label_text).width + 10;
            
            ctx.fillRect(centerX - labelWidth/2, centerY - 20, labelWidth, 20);
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.fillText(label_text, centerX, centerY - 5);
            ctx.textAlign = 'left'; // Text-Ausrichtung zurücksetzen
        }
        // Speichere Linie
        else if (pred.type === "line" && pred.line) {
            const {all_points_x, all_points_y} = pred.line;
            
            if (!all_points_x || !all_points_y || all_points_x.length < 2) {
                console.warn("Ungültige Linie gefunden, überspringe...");
                return;
            }
            
            // Get the color from the prediction object or use fallback color
            const lineColor = pred.color || "#FF9500";
            
            // Stil für Linien setzen
            ctx.strokeStyle = isSelected ? 'lime' : lineColor;
            ctx.lineWidth = isSelected ? 3 : 2;
            
            // Linie zeichnen
            ctx.beginPath();
            ctx.moveTo(all_points_x[0] * scale, all_points_y[0] * scale);
            
            for (let i = 1; i < all_points_x.length; i++) {
                ctx.lineTo(all_points_x[i] * scale, all_points_y[i] * scale);
            }
            
            ctx.stroke();
            
            // Punkte an den Ecken zeichnen
            for (let i = 0; i < all_points_x.length; i++) {
                ctx.fillStyle = lineColor; // Use the same color for points
                ctx.beginPath();
                ctx.arc(all_points_x[i] * scale, all_points_y[i] * scale, 4, 0, 2 * Math.PI);
                ctx.fill();
            }
            
            // Längeninformation anzeigen
            if (pred.length) {
                // Position für den Text (am Ende der Linie)
                const lastX = all_points_x[all_points_x.length - 1] * scale;
                const lastY = all_points_y[all_points_y.length - 1] * scale;
                
                // Text zeichnen
                ctx.font = '12px Arial';
                ctx.fillStyle = lineColor; // Use the same color for text
                ctx.fillText(`${pred.length.toFixed(2)} m`, lastX + 5, lastY - 5);
            }
        }
    });
    
    // Aktives Polygon zeichnen, falls vorhanden
    if (currentMode === 'addPolygon' && polygonPoints.length > 0) {
        console.log("Zeichne aktives Polygon mit", polygonPoints.length, "Punkten");
        // Stil für das aktive Polygon
        ctx.strokeStyle = 'lime';
        ctx.lineWidth = 2;
        
        // Zeichne das aktive Polygon
        ctx.beginPath();
        ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
        
        for (let i = 1; i < polygonPoints.length; i++) {
            ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
        }
        
        // Verbinde mit dem aktuellen Mauszeiger, falls vorhanden
        if (currentPolygon) {
            ctx.lineTo(currentPolygon.x, currentPolygon.y);
        }
        
        ctx.stroke();
        
        // Zeichne Punkte an den Ecken
        for (let i = 0; i < polygonPoints.length; i++) {
            ctx.fillStyle = 'lime';
            ctx.beginPath();
            ctx.arc(polygonPoints[i].x, polygonPoints[i].y, 4, 0, 2 * Math.PI);
            ctx.fill();
        }
    }

    // Aktive Linie zeichnen, falls vorhanden
    if (currentMode === 'addLine' && linePoints.length > 0) {
        console.log("Zeichne aktive Linie mit", linePoints.length, "Punkten");
    
        const lineTypeSelect = document.getElementById('lineTypeSelect');
        const selectedLineType = lineTypeSelect ? parseInt(lineTypeSelect.value) : 1;
        const lineLabel = window.currentLineLabels ? 
            window.currentLineLabels.find(l => l.id === selectedLineType) : null;
        const lineColor = lineLabel && lineLabel.color ? lineLabel.color : "#FF9500";
        
        // Use the selected color for drawing
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        
        // Begin path and move to first point
        ctx.beginPath();
        ctx.moveTo(linePoints[0].x, linePoints[0].y);
        
        // Add line to each subsequent point
        for (let i = 1; i < linePoints.length; i++) {
            ctx.lineTo(linePoints[i].x, linePoints[i].y);
        }
        
        // Connect to the current mouse position if available
        if (currentLine) {
            ctx.lineTo(currentLine.x, currentLine.y);
        }
        
        ctx.stroke();
        
        // Draw points at each vertex
        for (let i = 0; i < linePoints.length; i++) {
            ctx.fillStyle = lineColor;
            ctx.beginPath();
            ctx.arc(linePoints[i].x, linePoints[i].y, 4, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // Show the current measurement
        if (linePoints.length >= 2) {
            const totalLength = calculateLineLength(linePoints);
            
            // Position for the text (last point)
            const lastPoint = linePoints[linePoints.length - 1];
            
            // Draw text
            ctx.font = '14px Arial';
            ctx.fillStyle = lineColor;
            ctx.fillText(`Länge: ${totalLength.toFixed(2)} m`, lastPoint.x + 10, lastPoint.y);
        }
    }
    
    // Neue Box im Hinzufügen-Modus zeichnen
    if (currentMode === 'add' && newBox) {
        ctx.strokeStyle = 'lime';
        ctx.lineWidth = 2;
        ctx.strokeRect(newBox.x, newBox.y, newBox.width, newBox.height);
    }
}

// Zoom-Funktion im Editor
function applyZoomToEditor() {
    // Get current zoom level
    const currentZoom = (typeof window.getCurrentZoom === 'function') ? 
      window.getCurrentZoom() : 1.0;
    
    console.log("Applying zoom to editor:", currentZoom);
    
    // Apply zoom to canvas container instead of the canvas itself
    const canvasContainer = editorSection.querySelector('.editor-canvas-container') || editorSection;
    
    if (canvasContainer) {
      // Set scale transform on the container
      canvasContainer.style.transform = `scale(${currentZoom})`;
      canvasContainer.style.transformOrigin = 'top left';
      canvasContainer.style.width = `${100/currentZoom}%`;
      canvasContainer.style.height = 'auto';
    }
    
    // Adjust editor section overflow
    editorSection.style.overflow = 'auto';
    
    // Store current zoom for future reference
    lastKnownZoom = currentZoom;
  }
  
  // Update the syncWithCurrentZoom function
  function syncWithCurrentZoom() {
    applyZoomToEditor();
    redrawCanvas(); // Redraw with current zoom
  }
  
  // Update the global syncEditorZoom function
  window.syncEditorZoom = function(zoom) {
    lastKnownZoom = zoom;
    if (isEditorActive) {
      applyZoomToEditor();
      redrawCanvas();
    }
  };

// Helper function to get corrected mouse coordinates
function getZoomAdjustedCoordinates(event) {
    const rect = editorCanvas.getBoundingClientRect();
    const zoom = lastKnownZoom;
    
    // Calculate coordinates accounting for zoom
    const x = (event.clientX - rect.left) / zoom;
    const y = (event.clientY - rect.top) / zoom;
    
    return { x, y };
  }


// Mouse-Down-Handler
function handleMouseDown(event) {
    if (currentMode !== 'add') return;
    
    const { x, y } = getZoomAdjustedCoordinates(event);
    startX = x;
    startY = y;
    
    // Neue Box initialisieren
    newBox = {
      x: startX,
      y: startY,
      width: 0,
      height: 0
    };
  }

// Mouse-Move-Handler
function handleMouseMove(event) {
    const rect = editorCanvas.getBoundingClientRect();
    const zoom = (typeof window.getCurrentZoom === 'function') ? 
        window.getCurrentZoom() : lastKnownZoom;
    
    const currentX = (event.clientX - rect.left) / zoom;
    const currentY = (event.clientY - rect.top) / zoom;
    
    if (currentMode === 'add' && newBox) {
        // Box-Dimensionen aktualisieren
        newBox.width = currentX - startX;
        newBox.height = currentY - startY;
        
        // Canvas neu zeichnen
        redrawCanvas();
    } 
    else if (currentMode === 'addPolygon' && isDrawingPolygon && polygonPoints.length > 0) {
        // Aktuelle Mausposition speichern
        currentPolygon = {
            x: currentX,
            y: currentY
        }
        // Canvas neu zeichnen
        redrawCanvas();
    }
    else if (currentMode === 'addLine' && isDrawingLine && linePoints.length > 0) {
        // Aktuelle Mausposition speichern
        currentLine = {
            x: currentX,
            y: currentY
        }
        // Canvas neu zeichnen
        redrawCanvas();
    }
}

// Mouse-Up-Handler
function handleMouseUp(event) {
    if (currentMode !== 'add' || !newBox) return;
    
    // Finale Box-Dimensionen
    const rect = editorCanvas.getBoundingClientRect();
    const zoom = (typeof window.getCurrentZoom === 'function') ? 
        window.getCurrentZoom() : lastKnownZoom;
    
    const endX = (event.clientX - rect.left) / zoom;
    const endY = (event.clientY - rect.top) / zoom;
    
    console.log("Mouse up bei:", endX, endY);
    
    // Negative Dimensionen korrigieren
    let x1 = Math.min(startX, endX);
    let y1 = Math.min(startY, endY);
    let x2 = Math.max(startX, endX);
    let y2 = Math.max(startY, endY);
    
    // Minimale Box-Größe erzwingen
    if (x2 - x1 < 10 || y2 - y1 < 10) {
        console.log("Box zu klein, ignoriere");
        newBox = null;
        redrawCanvas();
        return;
    }
    
    // Skalierung berechnen
    const scale = editorCanvas.width / uploadedImage.naturalWidth;
    
    // Koordinaten zurück zur Originalbildgröße skalieren
    x1 = x1 / scale;
    y1 = y1 / scale;
    x2 = x2 / scale;
    y2 = y2 / scale;
    
    // Fläche berechnen
    const area = calculateArea([x1, y1, x2, y2]);
    
    // Ausgewählten Objekttyp abrufen
    const selectedType = parseInt(objectTypeSelect.value);
    
    // Neue Box zu den Ergebnissen hinzufügen
    const newPrediction = {
        label: selectedType,
        score: 1.0, // Manuell hinzugefügt, daher maximaler Score
        area: area,
        box: [x1, y1, x2, y2],
        type: "rectangle"
    };
    
    // Label-Name basierend auf dem Label
    switch (selectedType) {
        case 1: newPrediction.label_name = "Fenster"; break;
        case 2: newPrediction.label_name = "Tür"; break;
        case 3: newPrediction.label_name = "Wand"; break;
        case 4: newPrediction.label_name = "Lukarne"; break;
        case 5: newPrediction.label_name = "Dach"; break;
        default: newPrediction.label_name = "Andere";
    }
    
    console.log("Neue Vorhersage hinzufügen:", newPrediction);
    
    // Zu den Daten hinzufügen
    window.data.predictions.push(newPrediction);
    
    // Zurücksetzen
    newBox = null;
    redrawCanvas();
}

// Click-Handler
function handleClick(event) {
    if (currentMode !== 'add' || !newBox) return;
    
    // Finale Box-Dimensionen
    const rect = editorCanvas.getBoundingClientRect();
    const zoom = (typeof window.getCurrentZoom === 'function') ? 
        window.getCurrentZoom() : lastKnownZoom;

    const x = (event.clientX - rect.left) / zoom;
    const y = (event.clientY - rect.top) / zoom;
  
    console.log("Klick bei:", x, y, "im Modus:", currentMode);
    
    if (currentMode === 'addPolygon') {
        // Polygon-Punkt hinzufügen
        if (isDrawingPolygon) {
            // Prüfen, ob dies der erste Punkt ist
            if (polygonPoints.length === 0) {
                polygonPoints.push({x, y});
            } else {
                // Prüfen, ob der Klick nahe am Startpunkt ist, um das Polygon zu schließen
                const startPoint = polygonPoints[0];
                const distance = Math.sqrt(Math.pow(x - startPoint.x, 2) + Math.pow(y - startPoint.y, 2));
                
                if (distance <= 10 && polygonPoints.length >= 3) {
                    // Polygon schließen und hinzufügen
                    finishPolygon();
                } else {
                    // Neuen Punkt hinzufügen
                    polygonPoints.push({x, y});
                }
            }
        }
    } else if (currentMode === 'addLine') {
        // Linienpunkt hinzufügen
        if (isDrawingLine) {
            // Prüfen, ob der Klick nahe am Startpunkt ist, wenn mehr als 2 Punkte da sind
            if (linePoints.length >= 2 && event.ctrlKey) {
                // Strg+Klick beendet die Linie
                finishLine();
            } else {
                // Neuen Punkt hinzufügen
                linePoints.push({x, y});
            }
        
            // Canvas neu zeichnen
            redrawCanvas();
        }
    } else if (currentMode === 'delete' || currentMode === 'edit') {
        // Bestehender Code für das Löschen oder Bearbeiten...
        const boxIndex = findBoxAtPosition(x, y);
        
        if (boxIndex >= 0) {
            console.log("Box gefunden bei Index:", boxIndex);
            
            if (currentMode === 'delete') {
                // Box löschen
                window.data.predictions.splice(boxIndex, 1);
                redrawCanvas();
            } else if (currentMode === 'edit') {
                // Box auswählen
                selectedBoxIndex = boxIndex;
                // Objekttyp in der Auswahlliste setzen
                objectTypeSelect.value = window.data.predictions[boxIndex].label;
                redrawCanvas();
            }
        } else if (currentMode === 'edit') {
            // Auswahl aufheben
            selectedBoxIndex = -1;
            redrawCanvas();
        }
    }
}

// Funktion für Doppelklick
function handleDoubleClick(event) {
    const rect = editorCanvas.getBoundingClientRect();
    const zoom = (typeof window.getCurrentZoom === 'function') ? 
        window.getCurrentZoom() : lastKnownZoom;
    
    const x = (event.clientX - rect.left) / zoom;
    const y = (event.clientY - rect.top) / zoom;
    
    console.log("Doppelklick bei:", x, y, "im Modus:", currentMode);
    
    if (currentMode === 'addLine' && isDrawingLine && linePoints.length >= 2) {
        // Linie abschließen
        finishLine();
    }
    else if (currentMode === 'addLine') {
        // Linienpunkt hinzufügen
        if (isDrawingLine) {
            // Neuen Punkt hinzufügen
            linePoints.push({x, y});
            
            // Canvas neu zeichnen
            redrawCanvas();
        }
    }
}

// Add a function to sync the editor with current zoom level
function syncWithCurrentZoom() {
    const currentZoom = (typeof window.getCurrentZoom === 'function') ? 
        window.getCurrentZoom() : 1.0;
    
    if (lastKnownZoom !== currentZoom) {
        lastKnownZoom = currentZoom;
        
        if (editorCanvas) {
            editorCanvas.style.transform = `scale(${currentZoom})`;
            editorCanvas.style.transformOrigin = 'top left';
        }
    }
}

// Initialize the zoom-aware canvas behavior
function initializeZoomAwareCanvas() {
    // Make sure editor canvas respects current zoom
    if (editorCanvas) {
        const currentZoom = (typeof window.getCurrentZoom === 'function') ? 
            window.getCurrentZoom() : 1.0;
        
        editorCanvas.style.transform = `scale(${currentZoom})`;
        editorCanvas.style.transformOrigin = 'top left';
        lastKnownZoom = currentZoom;
        
        console.log("Editor canvas initialized with zoom:", currentZoom);
    }
}

// Funktion zum Abschließen des Polygons hinzufügen
function finishPolygon() {
    if (polygonPoints.length < 3) {
        console.log("Polygon hat zu wenige Punkte, verwerfe...");
        polygonPoints = [];
        isDrawingPolygon = false;
        return;
    }
    
    // Skalierung berechnen
    const scale = editorCanvas.width / uploadedImage.naturalWidth;
    
    // Punkte skalieren und für die Speicherung vorbereiten
    const scaledPoints = polygonPoints.map(point => ({
        x: point.x / scale,
        y: point.y / scale
    }));
    
    // Arrays für x und y Koordinaten erstellen
    const all_points_x = scaledPoints.map(p => p.x);
    const all_points_y = scaledPoints.map(p => p.y);
    
    // Fläche berechnen
    const area = calculatePolygonArea(all_points_x, all_points_y);
    
    // Ausgewählten Objekttyp abrufen
    const selectedType = parseInt(objectTypeSelect.value);
    
    // Neues Polygon zu den Ergebnissen hinzufügen
    const newPrediction = {
        label: selectedType,
        score: 1.0, // Manuell hinzugefügt, daher maximaler Score
        area: area,
        type: "polygon",
        polygon: {
            all_points_x: all_points_x,
            all_points_y: all_points_y
        }
    };
    
    // Label-Name basierend auf dem Label
    switch (selectedType) {
        case 1: newPrediction.label_name = "Fenster"; break;
        case 2: newPrediction.label_name = "Tür"; break;
        case 3: newPrediction.label_name = "Wand"; break;
        case 4: newPrediction.label_name = "Lukarne"; break;
        case 5: newPrediction.label_name = "Dach"; break;
        default: newPrediction.label_name = "Andere";
    }
    
    console.log("Neues Polygon hinzufügen:", newPrediction);
    
    // Zu den Daten hinzufügen
    window.data.predictions.push(newPrediction);
    
    // Zurücksetzen
    polygonPoints = [];
    isDrawingPolygon = false;
    redrawCanvas();
}

// Polygonfläche berechnen (Gaußsche Trapezformel)
function calculatePolygonArea(x, y) {
    let area = 0;
    const n = x.length;
    
    // Berechnung der Fläche in Pixeleinheiten
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += x[i] * y[j];
        area -= y[i] * x[j];
    }
    area = Math.abs(area) / 2;
    
    // Aktuelle Pixel pro Meter abrufen
    const planScale = parseFloat(document.getElementById('planScale').value);
    const dpi = parseFloat(document.getElementById('dpi').value);
    const pixelsPerMeter = (dpi / 25.4) * (1000 / planScale);
    
    // Umrechnung in Quadratmeter
    const areaInSquareMeters = area / (pixelsPerMeter * pixelsPerMeter);
    
    return areaInSquareMeters;
}

// Funktion zum Berechnen der Linienlänge
function calculateLineLength(points) {
    if (points.length < 2) return 0;
    
    let totalLength = 0;
    const scale = editorCanvas.width / uploadedImage.naturalWidth;
    
    for (let i = 0; i < points.length - 1; i++) {
        // Punkte in Original-Bildkoordinaten umrechnen
        const x1 = points[i].x / scale;
        const y1 = points[i].y / scale;
        const x2 = points[i+1].x / scale;
        const y2 = points[i+1].y / scale;
        
        // Euklidischer Abstand
        const segmentLength = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        
        // Aktuelle Pixel pro Meter abrufen
        const planScale = parseFloat(document.getElementById('planScale').value);
        const dpi = parseFloat(document.getElementById('dpi').value);
        const pixelsPerMeter = (dpi / 25.4) * (1000 / planScale);
        
        // Umrechnung in Meter
        const lengthInMeters = segmentLength / pixelsPerMeter;
        
        totalLength += lengthInMeters;
    }
    
    return totalLength;
}

// Funktion zum Abschließen der Linienmessung
function finishLine() {
    if (linePoints.length < 2) {
        console.log("Linie hat zu wenige Punkte, verwerfe...");
        linePoints = [];
        isDrawingLine = false;
        return;
    }
    
    // Skalierung berechnen
    const scale = editorCanvas.width / uploadedImage.naturalWidth;
    
    // Punkte skalieren und für die Speicherung vorbereiten
    const scaledPoints = linePoints.map(point => ({
        x: point.x / scale,
        y: point.y / scale
    }));
    
    // Arrays für x und y Koordinaten erstellen
    const all_points_x = scaledPoints.map(p => p.x);
    const all_points_y = scaledPoints.map(p => p.y);
    
    // Länge berechnen
    const length = calculateLineLength(linePoints);
    
    // Get selected line type
    const lineTypeSelect = document.getElementById('lineTypeSelect');
    const selectedLineType = lineTypeSelect ? parseInt(lineTypeSelect.value) : 1;

    // Find the corresponding line label
    const lineLabel = window.currentLineLabels ? 
        window.currentLineLabels.find(l => l.id === selectedLineType) : null;

    // Use color from the selected line label
    const lineColor = lineLabel && lineLabel.color ? lineLabel.color : "#FF9500";

    // Use the line label name instead of a generic name
    const labelName = lineLabel ? lineLabel.name : "Messlinie";

    // Create the new measurement with correct label name
    const newMeasurement = {
        label: selectedLineType,
        score: 1.0,
        length: length,
        type: "line",
        line: {
            all_points_x: all_points_x,
            all_points_y: all_points_y
        },
        label_name: labelName,  // Use the correct line label name
        color: lineColor
    };
    
    // Set the color based on the line label
    if (lineLabel && lineLabel.color) {
        newMeasurement.color = lineLabel.color;
    }
    
    console.log("Neue Linienmessung hinzufügen:", newMeasurement);
    
    // Zu den Daten hinzufügen
    window.data.predictions.push(newMeasurement);
    
    // Meldung anzeigen
    const measurementNotice = document.createElement('div');
    measurementNotice.className = 'measurement-notice';
    measurementNotice.textContent = `Gemessene Länge: ${length.toFixed(2)} m`;
    document.body.appendChild(measurementNotice);

    // Nach 3 Sekunden ausblenden
    setTimeout(() => {
        measurementNotice.style.opacity = '0';
        setTimeout(() => measurementNotice.remove(), 500);
    }, 3000);
    
    // Zurücksetzen
    linePoints = [];
    isDrawingLine = false;
    redrawCanvas();
}

// Box an einer Position finden
function findBoxAtPosition(x, y) {
    if (!window.data || !window.data.predictions) return -1;
    
    const scale = editorCanvas.width / uploadedImage.naturalWidth;
    
    for (let i = window.data.predictions.length - 1; i >= 0; i--) {
        const pred = window.data.predictions[i];
        if (!pred.box && !pred.bbox) continue;
        
        const [x1, y1, x2, y2] = pred.box || pred.bbox;
        const scaledX1 = x1 * scale;
        const scaledY1 = y1 * scale;
        const scaledX2 = x2 * scale;
        const scaledY2 = y2 * scale;
        
        if (x >= scaledX1 && x <= scaledX2 && y >= scaledY1 && y <= scaledY2) {
            return i;
        }
    }
    
    return -1;
}

// Berechnung der Fläche in m²
function calculateArea(box) {
    const [x1, y1, x2, y2] = box;
    
    // Breite und Höhe in Pixeln
    const widthPixels = x2 - x1;
    const heightPixels = y2 - y1;
    
    // Aktuelle Pixel pro Meter abrufen
    const planScale = parseFloat(document.getElementById('planScale').value);
    const dpi = parseFloat(document.getElementById('dpi').value);
    const pixelsPerMeter = (dpi / 25.4) * (1000 / planScale);
    
    // Umrechnung in Meter
    const widthMeters = widthPixels / pixelsPerMeter;
    const heightMeters = heightPixels / pixelsPerMeter;
    
    // Fläche in m²
    return widthMeters * heightMeters;
}

// Änderungen speichern
function saveEditorChanges() {
    console.log("Speichere Editor-Änderungen");
    
    try {
        // Aktualisiere die Ergebnis-Tabelle und Zusammenfassung
        updateEditorResults();
        
        // Speichere die aktuellen Daten in pdfPageData für die aktuelle Seite
        if (typeof currentPdfPage !== 'undefined' && currentPdfPage) {
            pdfPageData[currentPdfPage] = JSON.parse(JSON.stringify(window.data));
        }
        
        // Editor ausschalten
        toggleEditor();
        
        // Bestätigung anzeigen
        alert('Änderungen wurden gespeichert.');
    } catch (error) {
        console.error("Fehler beim Speichern der Änderungen:", error);
        
        // Trotz Fehler den Editor verlassen
        toggleEditor();
        
        // Bestätigung anzeigen
        alert('Änderungen wurden gespeichert, aber es gab ein Problem bei der Aktualisierung der Anzeige.');
    }
}

// saveEditorChanges hinzufügen
function cancelEditorChanges() {
    console.log("Verwerfe Editor-Änderungen");
    
    // Zurück zu den Originaldaten
    if (editorOriginalState) {
        window.data.predictions = JSON.parse(JSON.stringify(editorOriginalState));
    }
    
    // Editor ausschalten
    toggleEditor();
}

// Neue Hilfsfunktion zum Aktualisieren aller Annotationen
// Neue Hilfsfunktion zum Aktualisieren aller Annotationen
function refreshAnnotations() {
    console.log("Aktualisiere alle Annotationen, Anzahl:", window.data?.predictions?.length || 0);
    
    // Alle Annotationen entfernen
    const boxes = imageContainer.querySelectorAll('.bounding-box, .box-label');
    boxes.forEach(box => box.remove());
    
    // SVG leeren
    while (annotationOverlay.firstChild) {
        annotationOverlay.removeChild(annotationOverlay.firstChild);
    }
    
    // Alle Annotationen neu hinzufügen
    if (window.data && window.data.predictions) {
        window.data.predictions.forEach((pred, index) => {
            try {
                addAnnotation(pred, index);
            } catch (error) {
                console.error(`Fehler beim Hinzufügen der Annotation ${index}:`, error);
            }
        });
    } else {
        console.warn("Keine Vorhersagen gefunden für Annotationen");
    }
    
    // Simuliere ein Resize-Event nach kurzer Verzögerung
    setTimeout(function() {
        window.dispatchEvent(new Event('resize'));
    }, 200);
}

// Ergebnisse aktualisieren
function updateEditorResults() {
    console.log("Aktualisiere Ergebnisse");
    
    // Neuberechnung der Anzahl und Flächen
    let counts = {
        fenster: 0,
        tuer: 0,
        wand: 0,
        lukarne: 0,
        dach: 0,
        other: 0,
        line: 0
    };
    
    let areas = {
        fenster: 0,
        tuer: 0,
        wand: 0,
        lukarne: 0,
        dach: 0,
        other: 0
    };
    
    // Zählen und Flächen summieren
    window.data.predictions.forEach(pred => {
        if (pred.type === "line") {
            // Special handling for line measurements
            counts.line++;
        } else {
            // Normal handling for other objects
            switch (pred.label) {
                case 1:
                    counts.fenster++;
                    areas.fenster += pred.area || 0;
                    break;
                case 2:
                    counts.tuer++;
                    areas.tuer += pred.area || 0;
                    break;
                case 3:
                    counts.wand++;
                    areas.wand += pred.area || 0;
                    break;
                case 4:
                    counts.lukarne++;
                    areas.lukarne += pred.area || 0;
                    break;
                case 5:
                    counts.dach++;
                    areas.dach += pred.area || 0;
                    break;
                default:
                    counts.other++;
                    areas.other += pred.area || 0;
            }
        }
    });
    
    // Globale Daten aktualisieren
    window.data.count = counts;
    window.data.total_area = areas;
    
    // Anzeige aktualisieren
    // Prüfen, ob die Funktionen existieren und aufrufen
    if (typeof updateSummary === 'function') {
        updateSummary();
    } else {
        console.error("updateSummary ist keine Funktion oder nicht definiert");
    }

    if (typeof updateResultsTable === 'function') {
        updateResultsTable();
    } else {
        console.error("updateResultsTable ist keine Funktion oder nicht definiert");
    }
        
    // Annotationen aktualisieren
    // Alle Annotationen entfernen
    const boxes = imageContainer.querySelectorAll('.bounding-box, .box-label');
    boxes.forEach(box => box.remove());
    
    // SVG leeren
    while (annotationOverlay.firstChild) {
        annotationOverlay.removeChild(annotationOverlay.firstChild);
    }
    
    // Neu hinzufügen
    window.data.predictions.forEach((pred, index) => {
        try {
            addAnnotation(pred, index);
        } catch (error) {
            console.error(`Fehler beim Hinzufügen der Annotation ${index}:`, error);
        }
    });
    
    // Simuliere ein Resize-Event nach kurzer Verzögerung, um Positionierungsprobleme zu beheben
    setTimeout(function() {
        window.dispatchEvent(new Event('resize'));
    }, 200);
}

// Make syncWithCurrentZoom accessible globally
window.syncEditorZoom = function(zoom) {
    lastKnownZoom = zoom;
    if (isEditorActive && editorCanvas) {
        editorCanvas.style.transform = `scale(${zoom})`;
        editorCanvas.style.transformOrigin = 'top left';
    }
};

// Exportiere die Editor-Initialisierungsfunktion
window.initEditor = initEditor;
window.toggleEditor = toggleEditor;
