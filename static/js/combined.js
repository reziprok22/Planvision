/**
 * Kombinierte Datei für Fenster-Erkennungstool mit Editor
 * Diese Datei enthält sowohl die Hauptfunktionalität als auch die Editor-Funktionen
 */

// Globale Variablen
window.data = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM vollständig geladen. Initialisiere Anwendung...");
    
    // Hauptelemente abrufen
    const uploadForm = document.getElementById('uploadForm');
    const formatSelect = document.getElementById('formatSelect');
    const customFormatFields = document.getElementById('customFormatFields');
    const formatWidth = document.getElementById('formatWidth');
    const formatHeight = document.getElementById('formatHeight');
    const resultsSection = document.getElementById('resultsSection');
    const resultsTableSection = document.getElementById('resultsTableSection');
    const uploadedImage = document.getElementById('uploadedImage');
    const imageContainer = document.getElementById('imageContainer');
    const annotationOverlay = document.getElementById('annotationOverlay');
    const resultsBody = document.getElementById('resultsBody');
    const summary = document.getElementById('summary');
    const loader = document.getElementById('loader');
    const errorMessage = document.getElementById('errorMessage');
    
    // Toggle-Buttons
    const toggleFenster = document.getElementById('toggleFenster');
    const toggleTuer = document.getElementById('toggleTuer');
    const toggleWand = document.getElementById('toggleWand');
    const toggleLukarne = document.getElementById('toggleLukarne');
    const toggleDach = document.getElementById('toggleDach');
    
    // Überprüfen, ob alle Elemente vorhanden sind
    console.log("Haupt-UI-Elemente geladen:", {
        uploadForm: !!uploadForm,
        resultsSection: !!resultsSection,
        uploadedImage: !!uploadedImage
    });
    
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
    
    // Überprüfen, ob alle Editor-Elemente vorhanden sind
    console.log("Editor-Elemente geladen:", {
        editorSection: !!editorSection,
        editorCanvas: !!editorCanvas,
        editorToggle: !!editorToggle
    });
    
    // Globale Variablen für den Editor
    let isEditorActive = false;
    let currentMode = 'view'; // 'view', 'add', 'edit', 'delete'
    let selectedBoxIndex = -1;
    let newBox = null;
    let startX, startY;
    let editorOriginalState = null;
    let ctx = null;
    
    // Formatauswahl-Handler
    formatSelect.addEventListener('change', function() {
        if (formatSelect.value === 'custom') {
            customFormatFields.style.display = 'block';
        } else {
            customFormatFields.style.display = 'none';
            
            // Standard-Formatgrößen setzen
            const formatSizes = {
                'A4': [210, 297],
                'A3': [297, 420],
                'A2': [420, 594],
                'A1': [594, 841],
                'A0': [841, 1189]
            };
            
            const size = formatSizes[formatSelect.value];
            if (size) {
                formatWidth.value = size[0];
                formatHeight.value = size[1];
            }
        }
    });
    
    // Toggle-Button-Handler
    toggleFenster.addEventListener('click', function() {
        this.classList.toggle('active');
        const fensterElements = document.querySelectorAll('.fenster-annotation, .fenster-box, .fenster-label');
        fensterElements.forEach(el => {
            el.style.display = this.classList.contains('active') ? 'block' : 'none';
        });
    });
    
    toggleTuer.addEventListener('click', function() {
        this.classList.toggle('active');
        const tuerElements = document.querySelectorAll('.tuer-annotation, .tuer-box, .tuer-label');
        tuerElements.forEach(el => {
            el.style.display = this.classList.contains('active') ? 'block' : 'none';
        });
    });
    
    toggleWand.addEventListener('click', function() {
        this.classList.toggle('active');
        const wandElements = document.querySelectorAll('.wand-annotation, .wand-box, .wand-label');
        wandElements.forEach(el => {
            el.style.display = this.classList.contains('active') ? 'block' : 'none';
        });
    });
    
    toggleLukarne.addEventListener('click', function() {
        this.classList.toggle('active');
        const lukarneElements = document.querySelectorAll('.lukarne-annotation, .lukarne-box, .lukarne-label');
        lukarneElements.forEach(el => {
            el.style.display = this.classList.contains('active') ? 'block' : 'none';
        });
    });
    
    toggleDach.addEventListener('click', function() {
        this.classList.toggle('active');
        const dachElements = document.querySelectorAll('.dach-annotation, .dach-box, .dach-label');
        dachElements.forEach(el => {
            el.style.display = this.classList.contains('active') ? 'block' : 'none';
        });
    });
    
    // Editor-Toggle-Handler
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
    
    // Formular-Submit-Handler
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // UI zurücksetzen
        clearResults();
        loader.style.display = 'block';
        errorMessage.style.display = 'none';
        
        const formData = new FormData(uploadForm);
        
        // API-Aufruf für echte Daten
        fetch('/predict', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || 'Fehler bei der Anfrage');
                });
            }
            return response.json();
        })
        .then(responseData => {
            // Verarbeite die Rückgabedaten und konvertiere in das gewünschte Format
            const processedData = processApiResponse(responseData);
            displayResults(processedData);
        })
        .catch(error => {
            console.error('Error:', error);
            errorMessage.textContent = 'Fehler: ' + error.message;
            errorMessage.style.display = 'block';
            
            // Bei Fehler die Dummy-Daten laden (nur für Entwicklungszwecke)
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                console.log('Verwende Dummy-Daten für die lokale Entwicklung');
                const dummyData = getDummyData();
                displayResults(dummyData);
            }
        })
        .finally(() => {
            loader.style.display = 'none';
        });
    });

    // Funktion zum Konvertieren der API-Antwort in das gewünschte Format
    function processApiResponse(apiResponse) {
        // Beispielantwort von der API:
        // { 
        //   predictions: [{box: [...], label: 1, score: 0.98, area: 2.5}, ...], 
        //   total_area: 12.5, 
        //   count: 5 
        // }
        
        // Ausgabeformat erstellen
        const result = {
            count: {},
            total_area: {},
            predictions: []
        };
        
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
        
        // Vorhersagen verarbeiten
        apiResponse.predictions.forEach(pred => {
            // Typ bestimmen basierend auf vorhandenen Eigenschaften
            const type = "box" in pred || "bbox" in pred ? "rectangle" : "polygon";
            
            // Label-Name basierend auf der Kategorie bestimmen
            let label_name;
            switch(pred.label) {
                case 1:
                    label_name = "Fenster";
                    fensterCount++;
                    fensterArea += pred.area;
                    break;
                case 2:
                    label_name = "Tür";
                    tuerCount++;
                    tuerArea += pred.area;
                    break;
                case 3:
                    label_name = "Wand";
                    wandCount++;
                    wandArea += pred.area;
                    break;
                case 4:
                    label_name = "Lukarne";
                    lukarneCount++;
                    lukarneArea += pred.area;
                    break;
                case 5:
                    label_name = "Dach";
                    dachCount++;
                    dachArea += pred.area;
                    break;
                default:
                    label_name = "Andere";
                    otherCount++;
                    otherArea += pred.area;
            }
            
            // Verarbeitete Vorhersage hinzufügen
            result.predictions.push({
                ...pred,
                type: type,
                label_name: label_name
            });
        });
        
        // Zusammenfassungsdaten setzen
        result.count = {
            fenster: fensterCount,
            tuer: tuerCount,
            wand: wandCount,
            lukarne: lukarneCount,
            dach: dachCount,
            other: otherCount
        };
        
        result.total_area = {
            fenster: fensterArea,
            tuer: tuerArea,
            wand: wandArea,
            lukarne: lukarneArea,
            dach: dachArea,
            other: otherArea
        };
        
        return result;
    }

    // Funktion zum Abrufen von Dummy-Daten für Entwicklungszwecke
    function getDummyData() {
        return {
            count: {
                fenster: 5,
                tuer: 2,
                wand: 3,
                lukarne: 1,
                dach: 1,
                other: 0
            },
            total_area: {
                fenster: 12.5,
                tuer: 8.7,
                wand: 25.3,
                lukarne: 3.2,
                dach: 5.6,
                other: 0
            },
            predictions: [
                // Rechteckige Fenster
                {
                    label: 1,
                    label_name: "Fenster",
                    score: 0.95,
                    area: 2.5,
                    box: [100, 100, 200, 200],
                    type: "rectangle"
                },
                {
                    label: 1,
                    label_name: "Fenster",
                    score: 0.87,
                    area: 3.2,
                    box: [300, 150, 450, 250],
                    type: "rectangle"
                },
                // Tür
                {
                    label: 2,
                    label_name: "Tür",
                    score: 0.92,
                    area: 4.3,
                    box: [500, 300, 580, 500],
                    type: "rectangle"
                },
                // Rechteckige Wand
                {
                    label: 3,
                    label_name: "Wand",
                    score: 0.98,
                    area: 8.7,
                    box: [50, 300, 250, 500],
                    type: "rectangle"
                },
                // Lukarne
                {
                    label: 4,
                    label_name: "Lukarne",
                    score: 0.89,
                    area: 3.2,
                    box: [600, 100, 700, 200],
                    type: "rectangle"
                },
                // Dach
                {
                    label: 5,
                    label_name: "Dach",
                    score: 0.91,
                    area: 5.6,
                    box: [400, 50, 600, 150],
                    type: "rectangle"
                }
            ]
        };
    }

    // Funktion zur Anzeige der Ergebnisse
    function displayResults(responseData) {
        console.log("Zeige Ergebnisse an:", responseData);
        
        // Lokale und globale Daten setzen
        window.data = responseData;
        
        // Bild anzeigen
        const file = document.getElementById('file').files[0];
        const imageUrl = URL.createObjectURL(file);
        uploadedImage.src = imageUrl;
        
        // Auf Bild-Ladung warten
        uploadedImage.onload = function() {
            console.log("Bild geladen:", uploadedImage.width, "x", uploadedImage.height);
            
            // SVG-Container anpassen
            adaptSvgOverlay();
            
            // Ergebnisbereiche anzeigen
            resultsSection.style.display = 'block';
            resultsTableSection.style.display = 'block';
            
            // Zusammenfassung
            updateSummary();
            
            // Tabelle füllen
            updateResultsTable();
            
            // Annotationen hinzufügen
            window.data.predictions.forEach((pred, index) => {
                addAnnotation(pred, index);
            });
            
            // Simuliere ein Resize-Event nach kurzer Verzögerung, um Positionierungsprobleme zu beheben
            setTimeout(function() {
                window.dispatchEvent(new Event('resize'));
            }, 200);
        };
    }
    
    
    // Funktion zur Aktualisierung der Zusammenfassung
    function updateSummary() {
        let summaryHtml = '';
        
        if (window.data.count.fenster > 0) {
            summaryHtml += `<p>Gefundene Fenster: <strong>${window.data.count.fenster}</strong> (${window.data.total_area.fenster.toFixed(2)} m²)</p>`;
        }
        
        if (window.data.count.tuer > 0) {
            summaryHtml += `<p>Gefundene Türen: <strong>${window.data.count.tuer}</strong> (${window.data.total_area.tuer.toFixed(2)} m²)</p>`;
        }
        
        if (window.data.count.wand > 0) {
            summaryHtml += `<p>Gefundene Wände: <strong>${window.data.count.wand}</strong> (${window.data.total_area.wand.toFixed(2)} m²)</p>`;
        }
        
        if (window.data.count.lukarne > 0) {
            summaryHtml += `<p>Gefundene Lukarnen: <strong>${window.data.count.lukarne}</strong> (${window.data.total_area.lukarne.toFixed(2)} m²)</p>`;
        }
        
        if (window.data.count.dach > 0) {
            summaryHtml += `<p>Gefundene Dächer: <strong>${window.data.count.dach}</strong> (${window.data.total_area.dach.toFixed(2)} m²)</p>`;
        }
        
        if (window.data.count.other > 0) {
            summaryHtml += `<p>Andere Objekte: <strong>${window.data.count.other}</strong> (${window.data.total_area.other.toFixed(2)} m²)</p>`;
        }
        
        summary.innerHTML = summaryHtml;
    }
    
    // Funktion zur Aktualisierung der Ergebnistabelle
    function updateResultsTable() {
        resultsBody.innerHTML = '';
        
        window.data.predictions.forEach((pred, index) => {
            const row = document.createElement('tr');
            
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${pred.label_name}</td>
                <td>${pred.type || (pred.polygon ? "Polygon" : "Rechteck")}</td>
                <td>${(pred.score * 100).toFixed(1)}%</td>
                <td>${pred.area.toFixed(2)} m²</td>
            `;
            
            resultsBody.appendChild(row);
            
            // Highlight beim Hovern über Tabelle
            const elementId = `annotation-${index}`;
            row.addEventListener('mouseover', () => {
                highlightBox(elementId, true);
            });
            row.addEventListener('mouseout', () => {
                highlightBox(elementId, false);
            });
        });
    }
    
    // Funktion zum Hervorheben einer Box beim Hovern
    function highlightBox(elementId, isHighlighted) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        const labelElement = document.getElementById(`label-${elementId}`);
        if (!labelElement) return;
        
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
    
    // Funktion zum Hinzufügen einer Annotation (Rechteck oder Polygon)
    function addAnnotation(prediction, index) {
        // Skalierungsfaktor berechnen
        const scale = uploadedImage.width / uploadedImage.naturalWidth;
        
        const elementId = `annotation-${index}`;
        
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
        
        // Label vorbereiten
        const labelText = `#${index + 1}: ${prediction.area.toFixed(2)} m²`;
        
        // Je nach Typ (Rechteck oder Polygon) unterschiedlich behandeln
        if (prediction.type === "rectangle" || prediction.box || prediction.bbox) {
            const [x1, y1, x2, y2] = prediction.box || prediction.bbox;
            
            // Skalierte Koordinaten
            const scaledX1 = x1 * scale;
            const scaledY1 = y1 * scale;
            const scaledWidth = (x2 - x1) * scale;
            const scaledHeight = (y2 - y1) * scale;
            
            // Box hinzufügen
            const box = document.createElement('div');
            box.className = `bounding-box ${classPrefix}-box`;
            box.id = elementId;
            box.style.left = `${scaledX1}px`;
            box.style.top = `${scaledY1}px`;
            box.style.width = `${scaledWidth}px`;
            box.style.height = `${scaledHeight}px`;
            imageContainer.appendChild(box);
            
            // Label hinzufügen
            addLabel(scaledX1, scaledY1 - 20, labelText, elementId, classPrefix);
        } else if (prediction.type === "polygon" || prediction.polygon) {
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
            centerY /= all_points_y.length;
            
            // Polygon zum SVG hinzufügen
            const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            polygon.setAttribute("points", scaledPoints.join(" "));
            polygon.setAttribute("class", `polygon-annotation ${classPrefix}-annotation`);
            polygon.id = elementId;
            annotationOverlay.appendChild(polygon);
            
            // Label hinzufügen
            addLabel(centerX, centerY - 20, labelText, elementId, classPrefix);
        }
    }
    
    // Funktion zum Hinzufügen eines Labels
    function addLabel(x, y, text, parentId, classPrefix) {
        const label = document.createElement('div');
        label.className = `box-label ${classPrefix}-label`;
        label.id = `label-${parentId}`;
        label.textContent = text;
        label.style.left = `${x}px`;
        label.style.top = `${y}px`;
        imageContainer.appendChild(label);
    }
    
    // Funktion zum Zurücksetzen der Ergebnisse
    function clearResults() {
        resultsSection.style.display = 'none';
        resultsTableSection.style.display = 'none';
        uploadedImage.src = '';
        resultsBody.innerHTML = '';
        summary.innerHTML = '';
        
        // Alle Annotationen entfernen
        const boxes = imageContainer.querySelectorAll('.bounding-box, .box-label');
        boxes.forEach(box => box.remove());
        
        // SVG leeren
        while (annotationOverlay.firstChild) {
            annotationOverlay.removeChild(annotationOverlay.firstChild);
        }
        
        // Globale Daten zurücksetzen
        window.data = null;
    }
    
    // SVG-Container an das Bild anpassen
    function adaptSvgOverlay() {
        // SVG an die Dimensionen und Position des Bildes anpassen
        const imageRect = uploadedImage.getBoundingClientRect();
        const containerRect = imageContainer.getBoundingClientRect();
        
        annotationOverlay.setAttribute('width', uploadedImage.width);
        annotationOverlay.setAttribute('height', uploadedImage.height);
        
        // Position anpassen
        annotationOverlay.style.left = `${imageRect.left - containerRect.left}px`;
        annotationOverlay.style.top = `${imageRect.top - containerRect.top}px`;
        
        // Bestehende Annotationen neu positionieren
        repositionAllAnnotations();
    }
    
    // Alle Annotationen neu positionieren
    function repositionAllAnnotations() {
        // Berechne sowohl den horizontalen als auch den vertikalen Skalierungsfaktor
        const scaleX = uploadedImage.width / uploadedImage.naturalWidth;
        const scaleY = uploadedImage.height / uploadedImage.naturalHeight;
        
        // Erhalte tatsächliche Position des Bildes
        const imageRect = uploadedImage.getBoundingClientRect();
        const containerRect = imageContainer.getBoundingClientRect();
        
        // Berechne Offset (falls das Bild nicht exakt am Rand des Containers beginnt)
        const offsetX = imageRect.left - containerRect.left;
        const offsetY = imageRect.top - containerRect.top;
        
        console.log("Skalierung:", scaleX, scaleY, "Offset:", offsetX, offsetY);
        
        // Alle Rechtecke neu positionieren
        document.querySelectorAll('.bounding-box').forEach(box => {
            const id = box.id;
            const index = parseInt(id.split('-')[1]);
            if (window.data && window.data.predictions && window.data.predictions[index]) {
                const pred = window.data.predictions[index];
                if (pred.box || pred.bbox) {
                    const [x1, y1, x2, y2] = pred.box || pred.bbox;
                    box.style.left = `${x1 * scaleX + offsetX}px`;
                    box.style.top = `${y1 * scaleY + offsetY}px`;
                    box.style.width = `${(x2 - x1) * scaleX}px`;
                    box.style.height = `${(y2 - y1) * scaleY}px`;
                }
            }
        });

        // Alle Labels neu positionieren
        document.querySelectorAll('.box-label').forEach(label => {
            const id = label.id.replace('label-', '');
            const index = parseInt(id.split('-')[1]);
            if (window.data && window.data.predictions && window.data.predictions[index]) {
                const pred = window.data.predictions[index];
                if (pred.box || pred.bbox) {
                    const [x1, y1] = pred.box || pred.bbox;
                    label.style.left = `${x1 * scaleX + offsetX}px`;
                    label.style.top = `${(y1 * scaleY + offsetY) - 20}px`;
                } else if (pred.polygon) {
                }
            }
        });
        
        // Alle Polygone neu positionieren
        document.querySelectorAll('.polygon-annotation').forEach(polygon => {
            const id = polygon.id;
            const index = parseInt(id.split('-')[1]);
            if (window.data && window.data.predictions && window.data.predictions[index]) {
                const pred = window.data.predictions[index];
                if (pred.polygon) {
                    const { all_points_x, all_points_y } = pred.polygon;
                    const scaledPoints = [];
                    for (let i = 0; i < all_points_x.length; i++) {
                        const x = all_points_x[i] * scale;
                        const y = all_points_y[i] * scale;
                        scaledPoints.push(`${x},${y}`);
                    }
                    polygon.setAttribute("points", scaledPoints.join(" "));
                }
            }
        });

    }
    
    // Event-Listener für Bildgrößenänderungen
    window.addEventListener('resize', function() {
        if (uploadedImage.src) {
            // Wenn das Bild geladen ist, SVG und Annotationen neu anpassen
            setTimeout(adaptSvgOverlay, 100); // Kurze Verzögerung für stabilere Neuberechnung
        }
    });
    
    // ==================== EDITOR-FUNKTIONEN ====================
    
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
        if (!ctx) return;
        
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
    
    // Änderungen speichern
    function saveEditorChanges() {
        console.log("Speichere Editor-Änderungen");
        
        // Aktualisiere die Ergebnis-Tabelle und Zusammenfassung
        updateEditorResults();
        
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
        updateSummary();
        updateResultsTable();
        
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
});