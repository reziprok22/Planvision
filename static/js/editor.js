/**
 * Verbesserter Editor zum Hinzufügen von Bounding Boxes
 */

// Globale Variablen für den Editor
let isEditorActive = false;
let currentMode = 'view'; // 'view', 'add', 'edit', 'delete'
let selectedBoxIndex = -1;
let newBox = null;
let startX, startY;
let editorOriginalState = null;

// Editor-Elemente
const editorSection = document.getElementById('editorSection');
const editorCanvas = document.getElementById('editorCanvas');
const editorToggle = document.getElementById('editorToggle');
const addBoxBtn = document.getElementById('addBoxBtn');
const editBoxBtn = document.getElementById('editBoxBtn');
const deleteBoxBtn = document.getElementById('deleteBoxBtn');
const saveEditBtn = document.getElementById('saveEditBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const objectTypeSelect = document.getElementById('objectTypeSelect');

// Editor-Toggle-Handler
if (editorToggle) {
    editorToggle.addEventListener('click', function() {
        toggleEditor();
    });
}

// Event-Listener für Modus-Buttons
if (addBoxBtn) {
    addBoxBtn.addEventListener('click', function() {
        setEditorMode('add');
    });
}

if (editBoxBtn) {
    editBoxBtn.addEventListener('click', function() {
        setEditorMode('edit');
    });
}

if (deleteBoxBtn) {
    deleteBoxBtn.addEventListener('click', function() {
        setEditorMode('delete');
    });
}

if (saveEditBtn) {
    saveEditBtn.addEventListener('click', function() {
        saveEditorChanges();
    });
}

if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', function() {
        cancelEditorChanges();
    });
}

// Canvas Event-Listener
if (editorCanvas) {
    editorCanvas.addEventListener('mousedown', handleMouseDown);
    editorCanvas.addEventListener('mousemove', handleMouseMove);
    editorCanvas.addEventListener('mouseup', handleMouseUp);
    editorCanvas.addEventListener('click', handleClick);
}

// Funktion zum Ein-/Ausschalten des Editors
function toggleEditor() {
    isEditorActive = !isEditorActive;
    
    if (isEditorActive) {
        // Editor aktivieren
        editorToggle.textContent = 'Editor ausschalten';
        editorToggle.classList.add('active');
        editorSection.style.display = 'block';
        
        // Aktuelle Ergebnisse sichern
        editorOriginalState = JSON.parse(JSON.stringify(data.predictions));
        
        // Canvas initialisieren
        const uploadedImage = document.getElementById('uploadedImage');
        const ctx = editorCanvas.getContext('2d');
        
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
        document.getElementById('resultsSection').style.display = 'block';
        editorCanvas.style.display = 'none';
    }
}

// Editor initialisieren
function initializeEditor(image) {
    // Bildgröße anpassen
    editorCanvas.width = image.width;
    editorCanvas.height = image.height;
    
    // Context abrufen
    const ctx = editorCanvas.getContext('2d');
    
    // Bild auf den Canvas zeichnen
    ctx.drawImage(image, 0, 0, editorCanvas.width, editorCanvas.height);
    
    // Standardmodus setzen
    setEditorMode('view');
    
    // Ergebnisanzeige ausblenden
    document.getElementById('resultsSection').style.display = 'none';
    
    // Canvas einblenden
    editorCanvas.style.display = 'block';
    
    // Boxen zeichnen
    drawAllBoxes();
}

// Editor-Modus setzen
function setEditorMode(mode) {
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
    const ctx = editorCanvas.getContext('2d');
    
    // Canvas löschen
    ctx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    
    // Bild neu zeichnen
    const uploadedImage = document.getElementById('uploadedImage');
    ctx.drawImage(uploadedImage, 0, 0, editorCanvas.width, editorCanvas.height);
    
    // Alle Boxen zeichnen
    drawAllBoxes();
}

// Alle Boxen zeichnen
function drawAllBoxes() {
    if (!data || !data.predictions) return;
    
    const ctx = editorCanvas.getContext('2d');
    const scale = editorCanvas.width / uploadedImage.naturalWidth;
    
    data.predictions.forEach((pred, index) => {
        const isSelected = index === selectedBoxIndex;
        
        if (pred.box || pred.bbox) {
            const [x1, y1, x2, y2] = pred.box || pred.bbox;
            const scaledX1 = x1 * scale;
            const scaledY1 = y1 * scale;
            const scaledW = (x2 - x1) * scale;
            const scaledH = (y2 - y1) * scale;
            
            // Box-Farbe basierend auf Kategorie
            let color;
            switch (pred.label) {
                case 1: color = 'blue'; break;  // Fenster
                case 2: color = 'red'; break;   // Tür
                case 3: color = '#d4d638'; break; // Wand
                case 4: color = 'orange'; break; // Lukarne
                case 5: color = 'purple'; break; // Dach
                default: color = 'gray';
            }
            
            // Stil festlegen
            ctx.strokeStyle = isSelected ? 'lime' : color;
            ctx.lineWidth = isSelected ? 3 : 2;
            
            // Box zeichnen
            ctx.strokeRect(scaledX1, scaledY1, scaledW, scaledH);
            
            // Label zeichnen
            ctx.fillStyle = color;
            ctx.font = '12px Arial';
            
            const label = `#${index + 1}: ${pred.area.toFixed(2)} m²`;
            const labelWidth = ctx.measureText(label).width + 10;
            
            ctx.fillRect(scaledX1, scaledY1 - 20, labelWidth, 20);
            ctx.fillStyle = 'white';
            ctx.fillText(label, scaledX1 + 5, scaledY1 - 5);
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
    
    // Negative Dimensionen korrigieren
    let x1 = Math.min(startX, endX);
    let y1 = Math.min(startY, endY);
    let x2 = Math.max(startX, endX);
    let y2 = Math.max(startY, endY);
    
    // Minimale Box-Größe erzwingen
    if (x2 - x1 < 10 || y2 - y1 < 10) {
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
    
    // Zu den Daten hinzufügen
    data.predictions.push(newPrediction);
    
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
        
        // Box an der Position finden
        const boxIndex = findBoxAtPosition(x, y);
        
        if (boxIndex >= 0) {
            if (currentMode === 'delete') {
                // Box löschen
                data.predictions.splice(boxIndex, 1);
                redrawCanvas();
            } else if (currentMode === 'edit') {
                // Box auswählen
                selectedBoxIndex = boxIndex;
                // Objekttyp in der Auswahlliste setzen
                objectTypeSelect.value = data.predictions[boxIndex].label;
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
    if (!data || !data.predictions) return -1;
    
    const scale = editorCanvas.width / uploadedImage.naturalWidth;
    
    for (let i = data.predictions.length - 1; i >= 0; i--) {
        const pred = data.predictions[i];
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

// Änderung des Objekttyps für die ausgewählte Box
if (objectTypeSelect) {
    objectTypeSelect.addEventListener('change', function() {
        if (selectedBoxIndex >= 0) {
            const selectedType = parseInt(objectTypeSelect.value);
            data.predictions[selectedBoxIndex].label = selectedType;
            
            // Label-Name aktualisieren
            switch (selectedType) {
                case 1: data.predictions[selectedBoxIndex].label_name = "Fenster"; break;
                case 2: data.predictions[selectedBoxIndex].label_name = "Tür"; break;
                case 3: data.predictions[selectedBoxIndex].label_name = "Wand"; break;
                case 4: data.predictions[selectedBoxIndex].label_name = "Lukarne"; break;
                case 5: data.predictions[selectedBoxIndex].label_name = "Dach"; break;
                default: data.predictions[selectedBoxIndex].label_name = "Andere";
            }
            
            redrawCanvas();
        }
    });
}

// Änderungen speichern
function saveEditorChanges() {
    // Aktualisiere die Ergebnis-Tabelle und Zusammenfassung
    updateResults();
    
    // Editor ausschalten
    toggleEditor();
    
    // Bestätigung anzeigen
    alert('Änderungen wurden gespeichert.');
}

// Änderungen verwerfen
function cancelEditorChanges() {
    // Zurück zu den Originaldaten
    if (editorOriginalState) {
        data.predictions = JSON.parse(JSON.stringify(editorOriginalState));
    }
    
    // Editor ausschalten
    toggleEditor();
}

// Ergebnisse aktualisieren
function updateResults() {
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
    data.predictions.forEach(pred => {
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
    data.count = counts;
    data.total_area = areas;
    
    // Tabelle und Visualisierungen aktualisieren
    updateResultsDisplay();
}

// Tabelle und Visualisierungen aktualisieren
function updateResultsDisplay() {
    // Zusammenfassung aktualisieren
    const summary = document.getElementById('summary');
    let summaryHtml = '';
    
    if (data.count.fenster > 0) {
        summaryHtml += `<p>Gefundene Fenster: <strong>${data.count.fenster}</strong> (${data.total_area.fenster.toFixed(2)} m²)</p>`;
    }
    if (data.count.tuer > 0) {
        summaryHtml += `<p>Gefundene Türen: <strong>${data.count.tuer}</strong> (${data.total_area.tuer.toFixed(2)} m²)</p>`;
    }
    if (data.count.wand > 0) {
        summaryHtml += `<p>Gefundene Wände: <strong>${data.count.wand}</strong> (${data.total_area.wand.toFixed(2)} m²)</p>`;
    }
    if (data.count.lukarne > 0) {
        summaryHtml += `<p>Gefundene Lukarnen: <strong>${data.count.lukarne}</strong> (${data.total_area.lukarne.toFixed(2)} m²)</p>`;
    }
    if (data.count.dach > 0) {
        summaryHtml += `<p>Gefundene Dächer: <strong>${data.count.dach}</strong> (${data.total_area.dach.toFixed(2)} m²)</p>`;
    }
    if (data.count.other > 0) {
        summaryHtml += `<p>Andere Objekte: <strong>${data.count.other}</strong> (${data.total_area.other.toFixed(2)} m²)</p>`;
    }
    
    summary.innerHTML = summaryHtml;
    
    // Tabelle aktualisieren
    const resultsBody = document.getElementById('resultsBody');
    resultsBody.innerHTML = '';
    
    data.predictions.forEach((pred, index) => {
        const row = document.createElement('tr');
        // Label-Name aus dem Label oder einen Standardwert verwenden
        const className = pred.label_name || 
                        (pred.label === 1 ? "Fenster" : 
                         pred.label === 2 ? "Tür" : 
                         pred.label === 3 ? "Wand" : 
                         pred.label === 4 ? "Lukarne" : 
                         pred.label === 5 ? "Dach" : "Andere");
        
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${className}</td>
            <td>${pred.type || (pred.polygon ? "Polygon" : "Rechteck")}</td>
            <td>${(pred.score * 100).toFixed(1)}%</td>
            <td>${pred.area.toFixed(2)} m²</td>
        `;
        resultsBody.appendChild(row);
        
        // Highlight-Handler hinzufügen, falls die entsprechende Funktion vorhanden ist
        if (typeof highlightBox === 'function') {
            const elementId = `annotation-${index}`;
            row.addEventListener('mouseover', () => highlightBox(elementId, true));
            row.addEventListener('mouseout', () => highlightBox(elementId, false));
        }
    });
    
    // Alle Bounding Boxes auf dem Bild aktualisieren
    updateBoxVisualization();
}

// Bounding Boxes auf dem Bild aktualisieren
function updateBoxVisualization() {
    // Alle bestehenden Annotationen entfernen
    const imageContainer = document.getElementById('imageContainer');
    const boxes = imageContainer.querySelectorAll('.bounding-box, .box-label');
    boxes.forEach(box => box.remove());
    
    const annotationOverlay = document.getElementById('annotationOverlay');
    while (annotationOverlay.firstChild) {
        annotationOverlay.removeChild(annotationOverlay.firstChild);
    }
    
    // Skalierungsfaktor berechnen
    const scale = uploadedImage.width / uploadedImage.naturalWidth;
    
    // Neue Boxen hinzufügen
    data.predictions.forEach((pred, index) => {
        if (pred.box || pred.bbox) {
            const [x1, y1, x2, y2] = pred.box || pred.bbox;
            
            // Skalierte Koordinaten
            const scaledX1 = x1 * scale;
            const scaledY1 = y1 * scale;
            const scaledWidth = (x2 - x1) * scale;
            const scaledHeight = (y2 - y1) * scale;
            
            // Klassen-Präfix basierend auf der Kategorie
            let classPrefix;
            switch(pred.label) {
                case 1: classPrefix = 'fenster'; break;
                case 2: classPrefix = 'tuer'; break;
                case 3: classPrefix = 'wand'; break;
                case 4: classPrefix = 'lukarne'; break;
                case 5: classPrefix = 'dach'; break;
                default: classPrefix = 'other';
            }
            
            // Box hinzufügen
            const box = document.createElement('div');
            box.className = `bounding-box ${classPrefix}-box`;
            box.id = `annotation-${index}`;
            box.style.left = `${scaledX1}px`;
            box.style.top = `${scaledY1}px`;
            box.style.width = `${scaledWidth}px`;
            box.style.height = `${scaledHeight}px`;
            imageContainer.appendChild(box);
            
            // Label hinzufügen
            const label = document.createElement('div');
            label.className = `box-label ${classPrefix}-label`;
            label.id = `label-annotation-${index}`;
            label.textContent = `#${index + 1}: ${pred.area.toFixed(2)} m²`;
            label.style.left = `${scaledX1}px`;
            label.style.top = `${scaledY1 - 20}px`;
            imageContainer.appendChild(label);
        } else if (pred.polygon) {
            // Polygon-Unterstützung würde hier implementiert
        }
    });
}