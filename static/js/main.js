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
    const uploadedImage = document.getElementById('uploadedImage');
    const imageContainer = document.getElementById('imageContainer');
    const annotationOverlay = document.getElementById('annotationOverlay');
    const resultsBody = document.getElementById('resultsBody');
    const summary = document.getElementById('summary');
    const loader = document.getElementById('loader');
    const errorMessage = document.getElementById('errorMessage');
    
    // ID-Korrekturen - Anpassung an die HTML-IDs
    const toggleFenster = document.getElementById('toggleFenster');
    const toggleTuer = document.getElementById('toggleTuer');
    const toggleWand = document.getElementById('toggleWand');
    const toggleLukarne = document.getElementById('toggleLukarne');
    const toggleDach = document.getElementById('toggleDach');

    
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
    
    // Toggle-Button-Handler - Korrigiert mit den richtigen IDs
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
        let wandCount = 0;
        let fensterArea = 0;
        let wandArea = 0;
        
        // Vorhersagen verarbeiten
        apiResponse.predictions.forEach(pred => {
            const isWand = pred.label === 0;
            
            // Zähler erhöhen
            if (isWand) {
                wandCount++;
                wandArea += pred.area;
            } else {
                fensterCount++;
                fensterArea += pred.area;
            }
            
            // Typ bestimmen basierend auf vorhandenen Eigenschaften
            const type = "box" in pred || "bbox" in pred ? "rectangle" : "polygon";
            
            // Verarbeitete Vorhersage hinzufügen
            result.predictions.push({
                ...pred,
                type: type,
                label_name: isWand ? "Wand" : "Fenster"
            });
        });
        
        // Zusammenfassungsdaten setzen
        result.count = {
            fenster: fensterCount,
            wand: wandCount
        };
        
        result.total_area = {
            fenster: fensterArea,
            wand: wandArea
        };
        
        return result;
    }

    // Funktion zum Abrufen von Dummy-Daten für Entwicklungszwecke
    function getDummyData() {
        return {
            count: {
                "fenster": 5,
                "wand": 3
            },
            total_area: {
                "fenster": 12.5,
                "wand": 25.3
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
                // Polygonales Fenster
                {
                    label: 1,
                    label_name: "Fenster",
                    score: 0.92,
                    area: 2.8,
                    polygon: {
                        all_points_x: [500, 550, 600, 580, 520],
                        all_points_y: [100, 80, 110, 180, 170]
                    },
                    type: "polygon"
                },
                // Rechteckige Wand
                {
                    label: 0,
                    label_name: "Wand",
                    score: 0.98,
                    area: 8.7,
                    box: [50, 300, 250, 500],
                    type: "rectangle"
                },
                // Polygonale Wand
                {
                    label: 0,
                    label_name: "Wand",
                    score: 0.94,
                    area: 16.6,
                    polygon: {
                        all_points_x: [300, 500, 480, 450, 320],
                        all_points_y: [300, 320, 450, 480, 440]
                    },
                    type: "polygon"
                }
            ]
        };
    }
    
    // Füge eine globale Datenvariable hinzu, um auf die Daten zuzugreifen
    let data = null;

    // Funktion zur Anzeige der Ergebnisse
    function displayResults(responseData) {
        // Lokale Variable für main.js
        data = responseData;
        
        // Globale Variable für editor.js
        window.data = JSON.parse(JSON.stringify(responseData));
        
        // Bild anzeigen
        const file = document.getElementById('file').files[0];
        const imageUrl = URL.createObjectURL(file);
        uploadedImage.src = imageUrl;
        
        // Auf Bild-Ladung warten
        uploadedImage.onload = function() {
            // SVG-Container anpassen
            adaptSvgOverlay();
            
            // Ergebnisse anzeigen
            resultsSection.style.display = 'block';
            
            // Zusammenfassung
            let summaryHtml = '';
            if (data.count && data.count.fenster) {
                summaryHtml += `<p>Gefundene Fenster: <strong>${data.count.fenster}</strong> (${data.total_area.fenster.toFixed(2)} m²)</p>`;
            } else if (data.count) {
                summaryHtml += `<p>Gefundene Objekte: <strong>${data.count}</strong> (${data.total_area.toFixed(2)} m²)</p>`;
            }
            if (data.count && data.count.wand) {
                summaryHtml += `<p>Gefundene Wände: <strong>${data.count.wand}</strong> (${data.total_area.wand.toFixed(2)} m²)</p>`;
            }
            summary.innerHTML = summaryHtml;
            
            // Tabelle füllen
            resultsBody.innerHTML = '';
            data.predictions.forEach((pred, index) => {
                const row = document.createElement('tr');
                // Label-Name aus dem Label oder einen Standardwert verwenden
                const className = pred.label_name || (pred.label === 0 ? "Wand" : "Fenster");
                
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
                
                // Highlight beim Hovern über Tabelle
                const elementId = `annotation-${index}`;
                row.addEventListener('mouseover', () => {
                    const element = document.getElementById(elementId);
                    if (element) {
                        // Farben basierend auf der Kategorie anpassen
                        let backgroundColor, borderColor;
                        switch(pred.label) {
                            case 1:
                                backgroundColor = 'rgba(0, 0, 255, 0.3)';  // Fenster
                                borderColor = 'rgba(0, 0, 255, 1)';
                                break;
                            case 2:
                                backgroundColor = 'rgba(255, 0, 0, 0.3)';  // Tür
                                borderColor = 'rgba(255, 0, 0, 1)';
                                break;
                            case 3:
                                backgroundColor = 'rgba(212, 214, 56, 0.3)';  // Wand
                                borderColor = 'rgba(212, 214, 56, 0.1)';
                                break;
                            case 4:
                                backgroundColor = 'rgba(168, 136, 136, 0.3)';  // Lukarne
                                borderColor = 'rgba(168, 136, 136, 0.1)';
                                break;
                            case 5:
                                backgroundColor = 'rgba(119, 211, 165, 0.3)';  // Dach
                                borderColor = 'rgba(119, 211, 165, 0.1)';
                                break;
                            default:
                                backgroundColor = 'rgba(128, 128, 128, 0.3)';  // Andere
                                borderColor = 'rgba(128, 128, 128, 1)';
                        }
                        
                        if (pred.type === "rectangle" || pred.box) {
                            element.style.backgroundColor = backgroundColor;
                        } else {
                            element.style.fillOpacity = '0.5';
                        }
                                                
                        document.getElementById(`label-${elementId}`).style.backgroundColor = borderColor;
                    }
                });
                row.addEventListener('mouseout', () => {
                    const element = document.getElementById(elementId);
                    if (element) {
                          let backgroundColor, borderColor;
                          switch(pred.label) {
                              case 1:
                                  backgroundColor = 'rgba(0, 0, 255, 0.1)';  // Fenster
                                  borderColor = 'rgba(0, 0, 255, 0.8)';
                                  break;
                              case 2:
                                  backgroundColor = 'rgba(255, 0, 0, 0.1)';  // Tür
                                  borderColor = 'rgba(255, 0, 0, 0.8)';
                                  break;
                              case 3:
                                  backgroundColor = 'rgba(212, 214, 56, 0.1)';  // Wand
                                  borderColor = 'rgba(212, 214, 56, 0.8)';
                                  break;
                              case 4:
                                  backgroundColor = 'rgba(168, 136, 136, 0.1)';  // Lukarne
                                  borderColor = 'rgba(168, 136, 136, 0.8)';
                                  break;
                              case 5:
                                  backgroundColor = 'rgba(119, 211, 165, 0.1)';  // Dach
                                  borderColor = 'rgba(119, 211, 165, 0.8)';
                                  break;
                              default:
                                  backgroundColor = 'rgba(128, 128, 128, 0.1)';  // Andere
                                  borderColor = 'rgba(128, 128, 128, 0.8)';
                          }

                          if (pred.type === "rectangle" || pred.box) {
                            element.style.backgroundColor = backgroundColor;
                        } else {
                            element.style.fillOpacity = '0.1';
                        }
                        
                        document.getElementById(`label-${elementId}`).style.backgroundColor = borderColor;
                    }
                });
                                                  
                // Annotation hinzufügen
                addAnnotation(pred, index);
            });
            
            // Zu den Ergebnissen scrollen
            resultsSection.scrollIntoView({ behavior: 'smooth' });
        };
    }
    
    // Funktion zum Zurücksetzen der Ergebnisse
    function clearResults() {
        resultsSection.style.display = 'none';
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
    
    function adaptSvgOverlay() {
        // SVG-Größe an das angezeigte Bild anpassen
        annotationOverlay.setAttribute('width', uploadedImage.width);
        annotationOverlay.setAttribute('height', uploadedImage.height);
        
        // Bestehende Annotationen neu positionieren, falls vorhanden
        repositionAllAnnotations();
    }
    
    // Neue Funktion zum Neupositionieren aller Annotationen
    function repositionAllAnnotations() {
        // Skalierungsfaktor berechnen
        const scale = uploadedImage.width / uploadedImage.naturalWidth;
        
        // Alle Rechtecke neu positionieren
        document.querySelectorAll('.bounding-box').forEach(box => {
            const id = box.id;
            const index = parseInt(id.split('-')[1]);
            if (data && data.predictions && data.predictions[index]) {
                const pred = data.predictions[index];
                if (pred.type === "rectangle") {
                    const [x1, y1, x2, y2] = pred.box;
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
                if (pred.type === "polygon") {
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
                if (pred.type === "rectangle") {
                    const [x1, y1] = pred.box;
                    label.style.left = `${x1 * scale}px`;
                    label.style.top = `${y1 * scale}px`;
                } else if (pred.type === "polygon") {
                    const { all_points_x, all_points_y } = pred.polygon;
                    let centerX = 0;
                    let centerY = 0;
                    for (let i = 0; i < all_points_x.length; i++) {
                        centerX += all_points_x[i];
                        centerY += all_points_y[i];
                    }
                    centerX = (centerX / all_points_x.length) * scale;
                    centerY = (centerY / all_points_x.length) * scale - 20 * scale;
                    label.style.left = `${centerX}px`;
                    label.style.top = `${centerY}px`;
                }
            }
        });
    }
    
    // Funktion zum Hinzufügen einer Annotation (Rechteck oder Polygon)
    function addAnnotation(prediction, index) {
        // Skalierungsfaktor berechnen
        const originalWidth = uploadedImage.naturalWidth;
        const displayedWidth = uploadedImage.width;
        const scale = displayedWidth / originalWidth;
        
        const elementId = `annotation-${index}`;
        
        // Hier die Klassen-Präfixe basierend auf der Kategorie festlegen
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
                classPrefix = 'lukarne';    // Lukarne = 4
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
        if (prediction.type === "rectangle" || "box" in prediction) {
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
        } else if (prediction.type === "polygon" || "polygon" in prediction) {
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
    
    // Event-Listener für Bildgrößenänderungen
    window.addEventListener('resize', function() {
        if (uploadedImage.src) {
            // Wenn das Bild geladen ist, SVG und Annotationen neu anpassen
            adaptSvgOverlay();
        }
    });
});