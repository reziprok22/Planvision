/**
 * Hauptfunktionalität für die Fenster-Erkennungsanwendung
 */

document.addEventListener('DOMContentLoaded', function() {
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
    
    // Globale Variable für die Ergebnisdaten
    let data = null;
    
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
        // Globale Daten setzen
        data = responseData;
        
        // Bild anzeigen
        const file = document.getElementById('file').files[0];
        const imageUrl = URL.createObjectURL(file);
        uploadedImage.src = imageUrl;
        
        // Auf Bild-Ladung warten
        uploadedImage.onload = function() {
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
            data.predictions.forEach((pred, index) => {
                addAnnotation(pred, index);
            });
        };
    }
    
    // Funktion zur Aktualisierung der Zusammenfassung
    function updateSummary() {
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
    }
    
    // Funktion zur Aktualisierung der Ergebnistabelle
    function updateResultsTable() {
        resultsBody.innerHTML = '';
        
        data.predictions.forEach((pred, index) => {
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
        data = null;
    }
    
    // SVG-Container an das Bild anpassen
    function adaptSvgOverlay() {
        annotationOverlay.setAttribute('width', uploadedImage.width);
        annotationOverlay.setAttribute('height', uploadedImage.height);
        
        // Bestehende Annotationen neu positionieren
        repositionAllAnnotations();
    }
    
    // Alle Annotationen neu positionieren
    function repositionAllAnnotations() {
        // Skalierungsfaktor berechnen
        const scale = uploadedImage.width / uploadedImage.naturalWidth;
        
        // Alle Rechtecke neu positionieren
        document.querySelectorAll('.bounding-box').forEach(box => {
            const id = box.id;
            const index = parseInt(id.split('-')[1]);
            if (data && data.predictions && data.predictions[index]) {
                const pred = data.predictions[index];
                if (pred.box || pred.bbox) {
                    const [x1, y1, x2, y2] = pred.box || pred.bbox;
                    box.style.left = `${x1 * scale}px`;
                    box.style.top = `${y1 * scale}px`;
                    box.style.width = `${(x2 - x1) * scale}px`;
                    box.style.height = `${(y2 - y1) * scale}px`;
                }
            }
        });
        
        // Alle Polygone neu positionieren
        document.querySelectorAll('.polygon-annotation').forEach(polygon => {
            const id = polygon.id;
            const index = parseInt(id.split('-')[1]);
            if (data && data.predictions && data.predictions[index]) {
                const pred = data.predictions[index];
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
        
        // Alle Labels neu positionieren
        document.querySelectorAll('.box-label').forEach(label => {
            const id = label.id.replace('label-', '');
            const index = parseInt(id.split('-')[1]);
            if (data && data.predictions && data.predictions[index]) {
                const pred = data.predictions[index];
                if (pred.box || pred.bbox) {
                    const [x1, y1] = pred.box || pred.bbox;
                    label.style.left = `${x1 * scale}px`;
                    label.style.top = `${(y1 * scale) - 20}px`;
                } else if (pred.polygon) {
                    const { all_points_x, all_points_y } = pred.polygon;
                    let centerX = 0;
                    let centerY = 0;
                    for (let i = 0; i < all_points_x.length; i++) {
                        centerX += all_points_x[i];
                        centerY += all_points_y[i];
                    }
                    centerX = (centerX / all_points_x.length) * scale;
                    centerY = (centerY / all_points_y.length) * scale - 20;
                    label.style.left = `${centerX}px`;
                    label.style.top = `${centerY}px`;
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
    
    // Editor-Funktionalität importieren (aus editor-fix.js)
    // Diese Funktionen werden in einer separaten Datei definiert und hier eingebunden
});

// Weitere Funktionen aus den Fix-Dateien würden hier mit aufgenommen