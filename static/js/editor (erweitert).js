/**
 * Fenster-Editor für die Fenstererkennungs-Webapp
 * Ermöglicht das manuelle Hinzufügen, Bearbeiten und Löschen von erkannten Objekten
 */

document.addEventListener('DOMContentLoaded', function() {
    // Warte, bis alle DOM-Elemente verfügbar sind
    setTimeout(initializeEditor, 500);
});

function initializeEditor() {
    // Editor-Elemente
    const editorSection = document.getElementById('editorSection');
    const editorCanvas = document.getElementById('editorCanvas');
    const editorContext = editorCanvas ? editorCanvas.getContext('2d') : null;
    const editorToggle = document.getElementById('editorToggle');
    const addBoxBtn = document.getElementById('addBoxBtn');
    const editBoxBtn = document.getElementById('editBoxBtn');
    const deleteBoxBtn = document.getElementById('deleteBoxBtn');
    const saveEditBtn = document.getElementById('saveEditBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const objectTypeSelect = document.getElementById('objectTypeSelect');
    
    // Prüfe, ob alle notwendigen Elemente vorhanden sind
    if (!editorSection || !editorCanvas || !editorContext || !editorToggle || 
        !addBoxBtn || !editBoxBtn || !deleteBoxBtn || !saveEditBtn || 
        !cancelEditBtn || !objectTypeSelect) {
        console.error("Nicht alle Editor-Elemente wurden gefunden!", {
            editorSection, editorCanvas, editorToggle, addBoxBtn, 
            editBoxBtn, deleteBoxBtn, saveEditBtn, cancelEditBtn, objectTypeSelect
        });
        return;
    }
    
    // Debug-Funktion zum Überprüfen des Datenzustands
    function logDataState() {
        console.log("=== Editor Datenzustand ===");
        console.log("window.data vorhanden:", window.data ? "Ja" : "Nein");
        if (window.data) {
            console.log("window.data.predictions:", window.data.predictions ? 
                        `${window.data.predictions.length} Einträge` : "Nicht vorhanden");
            if (window.data.predictions && window.data.predictions.length > 0) {
                console.log("Beispiel-Eintrag:", window.data.predictions[0]);
            }
        }
        console.log("originalResults:", originalResults ? `${originalResults.length} Einträge` : "Nicht initialisiert");
        console.log("editingResults:", editingResults ? `${editingResults.length} Einträge` : "Nicht initialisiert");
        console.log("========================")
    }
    
    // Farben für verschiedene Kategorien
    const categoryColors = {
        0: { color: 'gray', name: 'Andere' },
        1: { color: 'blue', name: 'Fenster' },
        2: { color: 'red', name: 'Tür' },
        3: { color: 'yellow', name: 'Wand' },
        4: { color: 'orange', name: 'Lukarne/Gaube' },
        5: { color: 'purple', name: 'Dach' }
    };
    
    // Globale Variablen im richtigen Scope definieren
    let isEditorActive = false;
    let currentMode = 'view'; // 'view', 'add', 'edit', 'delete'
    let currentImage = null;
    let originalResults = null;
    let editingResults = null;
    let selectedBoxIndex = -1;
    let newBox = null;
    let startX, startY;
    let scale = 1.0;
    
    // Event-Listener für Editor-Toggle hinzufügen, wenn er noch nicht vorhanden ist
    if (editorToggle) {
        // Entferne alle bestehenden Event-Listener, um Duplikate zu vermeiden
        editorToggle.removeEventListener('click', toggleEditor);
        // Füge neuen Event-Listener hinzu
        editorToggle.addEventListener('click', toggleEditor);
    }
    
    // Event-Listener für Modus-Buttons
    addBoxBtn.addEventListener('click', function() {
        setEditorMode('add');
    });
    
    editBoxBtn.addEventListener('click', function() {
        setEditorMode('edit');
    });
    
    deleteBoxBtn.addEventListener('click', function() {
        setEditorMode('delete');
    });
    
    saveEditBtn.addEventListener('click', function() {
        saveEditorChanges();
    });
    
    cancelEditBtn.addEventListener('click', function() {
        cancelEditorChanges();
    });
    
    // Canvas Event-Listener
    editorCanvas.addEventListener('mousedown', handleMouseDown);
    editorCanvas.addEventListener('mousemove', handleMouseMove);
    editorCanvas.addEventListener('mouseup', handleMouseUp);
    editorCanvas.addEventListener('click', handleClick);
    
    // Funktion zum Ein-/Ausschalten des Editors
    function toggleEditor() {
        isEditorActive = !isEditorActive;
        
        if (isEditorActive) {
            // Prüfen, ob die Daten bereit sind
            if (!window.data || !window.data.predictions) {
                console.warn("Keine Erkennungsdaten vorhanden. Wurde bereits ein Plan analysiert?");
                alert('Bitte laden Sie zuerst ein Bild hoch und analysieren Sie es.');
                isEditorActive = false;
                if (editorToggle) {
                    editorToggle.textContent = 'Editor einschalten';
                    editorToggle.classList.remove('active');
                }
                if (editorSection) {
                    editorSection.style.display = 'none';
                }
                return;
            }
            
            // Editor aktivieren
            editorToggle.textContent = 'Editor ausschalten';
            editorToggle.classList.add('active');
            editorSection.style.display = 'block';
            
            // Debug: Datenzustand loggen
            logDataState();
            
            // Originaldaten sichern
            const imageContainer = document.getElementById('imageContainer');
            const uploadedImage = document.getElementById('uploadedImage');
            
            if (uploadedImage && uploadedImage.src) {
                // Bildgröße anpassen
                editorCanvas.width = uploadedImage.width;
                editorCanvas.height = uploadedImage.height;
                
                // Bild auf den Canvas zeichnen
                currentImage = uploadedImage;
                editorContext.drawImage(uploadedImage, 0, 0, editorCanvas.width, editorCanvas.height);
                
                // Berechnete Skalierung basierend auf dem aktuellen Bild
                scale = uploadedImage.width / uploadedImage.naturalWidth;
                console.log("Skalierungsfaktor berechnet:", scale);
                
                // Daten vorbereiten
                initializeEditorData();
                
                // Boxen zeichnen
                drawAllBoxes();
                
                // Standard-Modus setzen
                setEditorMode('view');
                
                // Original-Image-Container ausblenden, Canvas einblenden
                if (imageContainer) {
                    imageContainer.style.display = 'none';
                }
                editorCanvas.style.display = 'block';
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
            
            // Original-Image-Container wieder einblenden, Canvas ausblenden
            const imageContainer = document.getElementById('imageContainer');
            if (imageContainer) {
                imageContainer.style.display = 'block';
            }
            editorCanvas.style.display = 'none';
            
            // Variablen zurücksetzen
            currentMode = 'view';
            selectedBoxIndex = -1;
            newBox = null;
        }
    }
    
    // Funktion zum Setzen des Editor-Modus
    function setEditorMode(mode) {
        currentMode = mode;
        
        // UI-Buttons aktualisieren
        addBoxBtn.classList.toggle('active', mode === 'add');
        editBoxBtn.classList.toggle('active', mode === 'edit');
        deleteBoxBtn.classList.toggle('active', mode === 'delete');
        
        // Bei Modusänderung Auswahl zurücksetzen
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
    
    // Initialisieren der Editor-Daten aus den Erkennungsergebnissen
    function initializeEditorData() {
        // Globale Variable für die Erkennungsergebnisse
        if (window.data && window.data.predictions) {
            originalResults = JSON.parse(JSON.stringify(window.data.predictions));
            editingResults = JSON.parse(JSON.stringify(window.data.predictions));
            console.log("Erkennungsergebnisse geladen:", editingResults.length, "Objekte");
        } else {
            console.warn("Keine Erkennungsergebnisse gefunden in window.data");
            originalResults = [];
            editingResults = [];
        }
    }
    
    // Canvas neu zeichnen mit allen Boxen
    function redrawCanvas() {
        // Canvas löschen
        editorContext.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
        
        // Bild neu zeichnen
        if (currentImage) {
            editorContext.drawImage(currentImage, 0, 0, editorCanvas.width, editorCanvas.height);
        }
        
        // Alle Boxen zeichnen
        drawAllBoxes();
    }
    
    // Alle Boxen zeichnen
    function drawAllBoxes() {
        if (!editingResults) return;
        
        editingResults.forEach((pred, index) => {
            const isSelected = index === selectedBoxIndex;
            drawBox(pred, index, isSelected);
        });
        
        // Wenn im Hinzufügen-Modus und eine neue Box gezeichnet wird
        if (currentMode === 'add' && newBox) {
            editorContext.strokeStyle = 'lime';
            editorContext.lineWidth = 2;
            editorContext.strokeRect(
                newBox.x, 
                newBox.y, 
                newBox.width, 
                newBox.height
            );
        }
    }
    
    // Einzelne Box zeichnen
    function drawBox(prediction, index, isSelected) {
        if (!prediction.box && !prediction.bbox) return;
        
        const [x1, y1, x2, y2] = prediction.box || prediction.bbox;
        const scaledX1 = x1 * scale;
        const scaledY1 = y1 * scale;
        const scaledWidth = (x2 - x1) * scale;
        const scaledHeight = (y2 - y1) * scale;
        
        // Box-Farbe basierend auf Kategorie
        const categoryData = categoryColors[prediction.label] || categoryColors[0];
        
        // Stil festlegen
        if (isSelected) {
            editorContext.strokeStyle = 'lime';
            editorContext.lineWidth = 3;
        } else {
            editorContext.strokeStyle = categoryData.color;
            editorContext.lineWidth = 2;
        }
        
        // Box zeichnen
        editorContext.strokeRect(scaledX1, scaledY1, scaledWidth, scaledHeight);
        
        // Label zeichnen
        editorContext.fillStyle = categoryData.color;
        editorContext.font = '12px Arial';
        
        const label = `#${index + 1}: ${categoryData.name} (${prediction.area.toFixed(2)} m²)`;
        editorContext.fillRect(scaledX1, scaledY1 - 20, editorContext.measureText(label).width + 10, 20);
        
        editorContext.fillStyle = 'white';
        editorContext.fillText(label, scaledX1 + 5, scaledY1 - 5);
    }
    
    // Mausklick-Handler
    function handleClick(event) {
        const rect = editorCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        if (currentMode === 'delete') {
            // Suche nach Box unter dem Cursor
            const boxIndex = findBoxAtPosition(x, y);
            if (boxIndex >= 0) {
                // Box löschen
                editingResults.splice(boxIndex, 1);
                redrawCanvas();
            }
        } else if (currentMode === 'edit') {
            // Suche nach Box unter dem Cursor
            const boxIndex = findBoxAtPosition(x, y);
            if (boxIndex >= 0) {
                // Box auswählen
                selectedBoxIndex = boxIndex;
                // Typ in der Auswahlbox setzen
                objectTypeSelect.value = editingResults[boxIndex].label;
                redrawCanvas();
            } else {
                // Auswahl aufheben
                selectedBoxIndex = -1;
                redrawCanvas();
            }
        }
    }
    
    // Suche nach einer Box an einer Position
    function findBoxAtPosition(x, y) {
        if (!editingResults) return -1;
        
        for (let i = editingResults.length - 1; i >= 0; i--) {
            const pred = editingResults[i];
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
    
    // Mouse-Down-Handler für das Zeichnen neuer Boxen
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
    
    // Mouse-Move-Handler für das Zeichnen neuer Boxen
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
    
    // Mouse-Up-Handler für das Abschließen neuer Boxen
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
        
        // Box-Koordinaten zurück zur Originalbildgröße skalieren
        x1 = x1 / scale;
        y1 = y1 / scale;
        x2 = x2 / scale;
        y2 = y2 / scale;
        
        // Neue Box zu den Ergebnissen hinzufügen
        const selectedType = parseInt(objectTypeSelect.value);
        const newPrediction = {
            label: selectedType,
            label_name: categoryColors[selectedType].name,
            score: 1.0, // Manuell hinzugefügt, daher maximaler Score
            area: calculateArea([x1, y1, x2, y2], scale), // Fläche berechnen
            box: [x1, y1, x2, y2],
            type: "rectangle"
        };
        
        editingResults.push(newPrediction);
        
        // Zurücksetzen
        newBox = null;
        redrawCanvas();
    }
    
    // Berechnung der Fläche in m²
    function calculateArea(box, scale) {
        const [x1, y1, x2, y2] = box;
        
        // Breite und Höhe in Pixeln
        const widthPixels = x2 - x1;
        const heightPixels = y2 - y1;
        
        // Aktuelle Pixel pro Meter abrufen (aus dem Ursprungsbild)
        // Vereinfachte Berechnung, könnte genauer sein
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
    objectTypeSelect.addEventListener('change', function() {
        if (selectedBoxIndex >= 0) {
            const selectedType = parseInt(objectTypeSelect.value);
            editingResults[selectedBoxIndex].label = selectedType;
            editingResults[selectedBoxIndex].label_name = categoryColors[selectedType].name;
            redrawCanvas();
        }
    });
    
    // Änderungen speichern
    function saveEditorChanges() {
        // Tiefe Kopie der bearbeiteten Ergebnisse erstellen
        const updatedResults = JSON.parse(JSON.stringify(editingResults));
        
        // Originaldaten aktualisieren
        window.data.predictions = updatedResults;
        
        // Aktualisiere die Ergebnis-Tabelle und Zusammenfassung
        updateResultsDisplay();
        
        // Optional: Sende Daten an den Server zur permanenten Speicherung
        // Diese Funktion ist auskommentiert, da der Server möglicherweise noch nicht 
        // die entsprechende Route implementiert hat
        /*
        fetch('/save_edits', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                predictions: updatedResults,
                count: window.data.count,
                total_area: window.data.total_area
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Speicherantwort:', data);
        })
        .catch(error => {
            console.error('Fehler beim Speichern:', error);
        });
        */
        
        // Editor ausschalten
        toggleEditor();
        
        alert('Änderungen wurden gespeichert.');
    }
    
    // Änderungen verwerfen
    function cancelEditorChanges() {
        // Zurück zu den Originaldaten
        editingResults = JSON.parse(JSON.stringify(originalResults));
        
        // Editor ausschalten
        toggleEditor();
    }
    
    // Aktualisierung der Ergebnisanzeige
    function updateResultsDisplay() {
        // Zählung und Flächensummen zurücksetzen
        let fensterCount = 0;
        let tuerCount = 0;
        let wandCount = 0;
        let lukarneCount = 0;
        let dachCount = 0;
        let otherCount = 0;
        
        let fensterArea = 0;
        let tuerArea = 0;
        let wandArea = 0;
        let lukarneArea = 0;
        let dachArea = 0;
        let otherArea = 0;
        
        // Neue Zählung und Flächensummen berechnen
        editingResults.forEach(pred => {
            switch (pred.label) {
                case 1:
                    fensterCount++;
                    fensterArea += pred.area;
                    break;
                case 2:
                    tuerCount++;
                    tuerArea += pred.area;
                    break;
                case 3:
                    wandCount++;
                    wandArea += pred.area;
                    break;
                case 4:
                    lukarneCount++;
                    lukarneArea += pred.area;
                    break;
                case 5:
                    dachCount++;
                    dachArea += pred.area;
                    break;
                default:
                    otherCount++;
                    otherArea += pred.area;
            }
        });
        
        // Daten aktualisieren
        window.data.count = {
            fenster: fensterCount,
            tuer: tuerCount,
            wand: wandCount,
            lukarne: lukarneCount,
            dach: dachCount,
            other: otherCount
        };
        
        window.data.total_area = {
            fenster: fensterArea,
            tuer: tuerArea,
            wand: wandArea,
            lukarne: lukarneArea,
            dach: dachArea,
            other: otherArea
        };
        
        // UI aktualisieren - Zusammenfassung
        const summary = document.getElementById('summary');
        if (summary) {
            let summaryHtml = '';
            
            if (fensterCount > 0) {
                summaryHtml += `<p>Gefundene Fenster: <strong>${fensterCount}</strong> (${fensterArea.toFixed(2)} m²)</p>`;
            }
            if (tuerCount > 0) {
                summaryHtml += `<p>Gefundene Türen: <strong>${tuerCount}</strong> (${tuerArea.toFixed(2)} m²)</p>`;
            }
            if (wandCount > 0) {
                summaryHtml += `<p>Gefundene Wände: <strong>${wandCount}</strong> (${wandArea.toFixed(2)} m²)</p>`;
            }
            if (lukarneCount > 0) {
                summaryHtml += `<p>Gefundene Lukarnen: <strong>${lukarneCount}</strong> (${lukarneArea.toFixed(2)} m²)</p>`;
            }
            if (dachCount > 0) {
                summaryHtml += `<p>Gefundene Dächer: <strong>${dachCount}</strong> (${dachArea.toFixed(2)} m²)</p>`;
            }
            if (otherCount > 0) {
                summaryHtml += `<p>Andere Objekte: <strong>${otherCount}</strong> (${otherArea.toFixed(2)} m²)</p>`;
            }
            
            summary.innerHTML = summaryHtml;
        }
        
        // UI aktualisieren - Tabelle
        updateResultsTable();
        
        // UI aktualisieren - Visualisierung
        updateVisualization();
    }
    
    // Aktualisieren der Ergebnistabelle
    function updateResultsTable() {
        const resultsBody = document.getElementById('resultsBody');
        if (!resultsBody) return;
        
        resultsBody.innerHTML = '';
        
        editingResults.forEach((pred, index) => {
            const row = document.createElement('tr');
            // Klassennamen basierend auf dem Label
            const className = pred.label_name || categoryColors[pred.label].name;
            
            // Details für die Box
            const detailsText = pred.type === "rectangle" || pred.box ? 
                `(${Math.round(pred.box ? pred.box[0] : pred.bbox[0])}, ${Math.round(pred.box ? pred.box[1] : pred.bbox[1])}) - ` +
                `(${Math.round(pred.box ? pred.box[2] : pred.bbox[2])}, ${Math.round(pred.box ? pred.box[3] : pred.bbox[3])})` : 
                `Polygon mit ${pred.polygon.all_points_x.length} Punkten`;
                
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${className}</td>
                <td>${pred.type || (pred.polygon ? "Polygon" : "Rechteck")}</td>
                <td>${(pred.score * 100).toFixed(1)}%</td>
                <td>${pred.area.toFixed(2)} m²</td>
                <td>${detailsText}</td>
            `;
            resultsBody.appendChild(row);
            
            // Event-Listener für Hover-Effekt
            const elementId = `annotation-${index}`;
            row.addEventListener('mouseover', () => highlightBox(elementId, true));
            row.addEventListener('mouseout', () => highlightBox(elementId, false));
        });
    }
    
    // Aktualisieren der visuellen Darstellung
    function updateVisualization() {
        // Alle bestehenden Annotationen entfernen
        const imageContainer = document.getElementById('imageContainer');
        if (!imageContainer) return;
        
        const boxes = imageContainer.querySelectorAll('.bounding-box, .box-label');
        boxes.forEach(box => box.remove());
        
        const annotationOverlay = document.getElementById('annotationOverlay');
        if (!annotationOverlay) return;
        
        while (annotationOverlay.firstChild) {
            annotationOverlay.removeChild(annotationOverlay.firstChild);
        }
        
        // Neue Annotationen hinzufügen
        const uploadedImage = document.getElementById('uploadedImage');
        if (!uploadedImage) return;
        
        const displayScale = uploadedImage.width / uploadedImage.naturalWidth;
        
        editingResults.forEach((pred, index) => {
            // Boxen oder Polygone hinzufügen
            if (pred.type === "rectangle" || pred.box) {
                addBoxAnnotation(pred, index, displayScale);
            } else if (pred.type === "polygon" || pred.polygon) {
                addPolygonAnnotation(pred, index, displayScale);
            }
        });
    }
    
    // Funktion zum Hervorheben einer Box beim Hover
    function highlightBox(elementId, isHighlighted) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        const labelElement = document.getElementById(`label-${elementId}`);
        if (!labelElement) return;
        
        // Anpassung der Stile basierend auf dem Hover-Status
        if (isHighlighted) {
            if (element.classList.contains('bounding-box')) {
                element.style.borderWidth = '3px';
                element.style.opacity = '0.8';
            } else {
                element.style.strokeWidth = '3px';
                element.style.fillOpacity = '0.5';
            }
            labelElement.style.opacity = '1';
        } else {
            if (element.classList.contains('bounding-box')) {
                element.style.borderWidth = '2px';
                element.style.opacity = '0.3';
            } else {
                element.style.strokeWidth = '2px';
                element.style.fillOpacity = '0.1';
            }
            labelElement.style.opacity = '0.8';
        }
    }
    
    // Funktion zum Hinzufügen einer Box-Annotation
    function addBoxAnnotation(prediction, index, scale) {
        const imageContainer = document.getElementById('imageContainer');
        if (!imageContainer) return;
        
        const [x1, y1, x2, y2] = prediction.box || prediction.bbox;
        
        // Skalierte Koordinaten
        const scaledX1 = x1 * scale;
        const scaledY1 = y1 * scale;
        const scaledWidth = (x2 - x1) * scale;
        const scaledHeight = (y2 - y1) * scale;
        
        // Klassen-Präfix basierend auf der Kategorie
        let classPrefix;
        switch(prediction.label) {
            case 1:
                classPrefix = 'fenster'; // Fenster = 1
                break;
            case 2:
                classPrefix = 'tuer';    // Tür = 2
                break;
            case 3:
                classPrefix = 'wand';    // Wand = 3
                break;
            case 4:
                classPrefix = 'lukarne'; // Lukarne = 4
                break;
            case 5:
                classPrefix = 'dach';    // Dach = 5
                break;
            default:
                classPrefix = 'other';   // Andere Kategorien
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
        label.textContent = `#${index + 1}: ${prediction.area.toFixed(2)} m²`;
        label.style.left = `${scaledX1}px`;
        label.style.top = `${scaledY1 - 20}px`;
        imageContainer.appendChild(label);
    }

    // Funktion zum Hinzufügen einer Polygon-Annotation
    function addPolygonAnnotation(prediction, index, scale) {
        const annotationOverlay = document.getElementById('annotationOverlay');
        const imageContainer = document.getElementById('imageContainer');
        
        // Polygon-Punkte skalieren
        const scaledPoints = [];
        const poly = prediction.polygon || prediction;
        const all_points_x = poly.all_points_x;
        const all_points_y = poly.all_points_y;
        
        // Mittelpunkt für Label berechnen
        let centerX = 0;
        let centerY = 0;
        
        for (let i = 0; i < all_points_x.length; i++) {
            const x = all_points_x[i] * scale;
            const y = all_points_y[i] * scale;
            scaledPoints.push(`${x},${y}`);
            
            centerX += x;
            centerY += y;
        }
        
        centerX /= all_points_x.length;
        centerY /= all_points_x.length;
        
        // Klassen-Präfix basierend auf der Kategorie
        let classPrefix;
        switch(prediction.label) {
            case 1:
                classPrefix = 'fenster'; // Fenster = 1
                break;
            case 2:
                classPrefix = 'tuer';    // Tür = 2
                break;
            case 3:
                classPrefix = 'wand';    // Wand = 3
                break;
            case 4:
                classPrefix = 'lukarne'; // Lukarne = 4
                break;
            case 5:
                classPrefix = 'dach';    // Dach = 5
                break;
            default:
                classPrefix = 'other';   // Andere Kategorien
        }
        
        // Polygon zum SVG hinzufügen
        const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        polygon.setAttribute("points", scaledPoints.join(" "));
        polygon.setAttribute("class", `polygon-annotation ${classPrefix}-annotation`);
        polygon.id = `annotation-${index}`;
        annotationOverlay.appendChild(polygon);
        
        // Label hinzufügen
        const label = document.createElement('div');
        label.className = `box-label ${classPrefix}-label`;
        label.id = `label-annotation-${index}`;
        label.textContent = `#${index + 1}: ${prediction.area.toFixed(2)} m²`;
        label.style.left = `${centerX}px`;
        label.style.top = `${centerY - 20}px`;
        imageContainer.appendChild(label);
    }
};