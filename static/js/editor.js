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

// Hauptelemente für Editor-Zugriff
let uploadedImage, imageContainer, annotationOverlay, resultsSection;

// Editor-Elemente
let editorSection, editorCanvas, editorToggle, addBoxBtn, editBoxBtn, deleteBoxBtn;
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
    
    // Canvas Event-Listener
    if (editorCanvas) {
        editorCanvas.addEventListener('mousedown', handleMouseDown);
        editorCanvas.addEventListener('mousemove', handleMouseMove);
        editorCanvas.addEventListener('mouseup', handleMouseUp);
        editorCanvas.addEventListener('click', handleClick);
        console.log("Canvas-Event-Listener hinzugefügt");
    }
    
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
    
    if (isEditorActive) {
        // Editor aktivieren
        editorToggle.textContent = 'Editor ausschalten';
        editorToggle.classList.add('active');
        editorSection.style.display = 'block';
        
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
    }
}

// Editor initialisieren
function initializeEditor(image) {
    console.log("Editor initialisieren mit Bild:", image.width, "x", image.height);
    
    // Bildgröße anpassen
    editorCanvas.width = image.width;
    editorCanvas.height = image.height;
    
    // Context abrufen
    ctx = editorCanvas.getContext('2d');
    
    // Bild auf den Canvas zeichnen
    ctx.drawImage(image, 0, 0, editorCanvas.width, editorCanvas.height);
    
    // Standardmodus setzen
    setEditorMode('view');
    
    // Ergebnisanzeige ausblenden
    resultsSection.style.display = 'none';
    
    // Canvas einblenden
    editorCanvas.style.display = 'block';
    
    // Boxen zeichnen
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
    
    // Auswahl zurücksetzen
    selectedBoxIndex = -1;
    newBox = null;
    
    // Canvas neu zeichnen
    redrawCanvas();
    
    // Cursor-Stil anpassen
    switch(mode) {
        case 'add':
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
    if (!ctx) {
        console.warn("Kein Canvas-Kontext verfügbar!");
        return;
    }
    
    // Canvas löschen
    ctx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    
    // Bild neu zeichnen
    ctx.drawImage(uploadedImage, 0, 0, editorCanvas.width, editorCanvas.height);
    
    // Alle Boxen zeichnen
    drawAllBoxes();
}

// Alle Boxen zeichnen
function drawAllBoxes() {
    if (!ctx) {
        console.warn("Kein Canvas-Kontext verfügbar!");
        return;
    }
    
    // Daten überprüfen
    if (!window.data || !window.data.predictions || window.data.predictions.length === 0) {
        console.warn("Keine Daten für das Zeichnen der Boxen verfügbar!");
        return;
    }
    
    const scale = editorCanvas.width / uploadedImage.naturalWidth;
    
    window.data.predictions.forEach((pred, index) => {
        const isSelected = index === selectedBoxIndex;
        
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
            
            // Label zeichnen
            ctx.fillStyle = color;
            ctx.font = '12px Arial';
            
            const label_text = `#${index + 1}: ${pred.area.toFixed(2)} m²`;
            const labelWidth = ctx.measureText(label_text).width + 10;
            
            ctx.fillRect(scaledX1, scaledY1 - 20, labelWidth, 20);
            ctx.fillStyle = 'white';
            ctx.fillText(label_text, scaledX1 + 5, scaledY1 - 5);
        }
    });
    
    // Neue Box im Hinzufügen-Modus zeichnen
    if (currentMode === 'add' && newBox) {
        ctx.strokeStyle = 'lime';
        ctx.lineWidth = 2;
        ctx.strokeRect(newBox.x, newBox.y, newBox.width, newBox.height);
    }
}

// Mouse-Down-Handler
function handleMouseDown(event) {
    if (currentMode !== 'add') return;
    
    const rect = editorCanvas.getBoundingClientRect();
    startX = event.clientX - rect.left;
    startY = event.clientY - rect.top;
    
    console.log("Mouse down bei:", startX, startY);
    
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
    if (currentMode !== 'add' || !newBox) return;
    
    const rect = editorCanvas.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;
    
    // Box-Dimensionen aktualisieren
    newBox.width = currentX - startX;
    newBox.height = currentY - startY;
    
    // Canvas neu zeichnen
    redrawCanvas();
}

// Mouse-Up-Handler
function handleMouseUp(event) {
    if (currentMode !== 'add' || !newBox) return;
    
    // Finale Box-Dimensionen
    const rect = editorCanvas.getBoundingClientRect();
    const endX = event.clientX - rect.left;
    const endY = event.clientY - rect.top;
    
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
    if (currentMode === 'delete' || currentMode === 'edit') {
        const rect = editorCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        console.log("Klick bei:", x, y, "im Modus:", currentMode);
        
        // Box an der Position finden
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
// In der saveEditorChanges-Funktion (im Editor-Teil)
function saveEditorChanges() {
    console.log("Speichere Editor-Änderungen");
    
    // Aktualisiere die Ergebnis-Tabelle und Zusammenfassung
    updateEditorResults();
    
    // Speichere die aktuellen Daten in pdfPageData für die aktuelle Seite
    if (currentPdfPage) {
        pdfPageData[currentPdfPage] = JSON.parse(JSON.stringify(window.data));
    }
    
    // Editor ausschalten
    toggleEditor();
    
    // Bestätigung anzeigen
    alert('Änderungen wurden gespeichert.');
}

// Änderungen verwerfen
function cancelEditorChanges() {
    console.log("Verwerfe Editor-Änderungen");
    
    // Zurück zu den Originaldaten
    if (editorOriginalState) {
        window.data.predictions = JSON.parse(JSON.stringify(editorOriginalState));
    }
    
    // Editor ausschalten
    toggleEditor();
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
        other: 0
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
        switch (pred.label) {
            case 1:
                counts.fenster++;
                areas.fenster += pred.area;
                break;
            case 2:
                counts.tuer++;
                areas.tuer += pred.area;
                break;
            case 3:
                counts.wand++;
                areas.wand += pred.area;
                break;
            case 4:
                counts.lukarne++;
                areas.lukarne += pred.area;
                break;
            case 5:
                counts.dach++;
                areas.dach += pred.area;
                break;
            default:
                counts.other++;
                areas.other += pred.area;
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
        addAnnotation(pred, index);
    });
    
    // Simuliere ein Resize-Event nach kurzer Verzögerung, um Positionierungsprobleme zu beheben
    setTimeout(function() {
        window.dispatchEvent(new Event('resize'));
    }, 200);
}

// Exportiere die Editor-Initialisierungsfunktion
window.initEditor = initEditor;