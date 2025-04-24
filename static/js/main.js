/**
 * Hauptdatei für Fenster-Erkennungstool
 * Diese Datei enthält die Hauptfunktionalität, die Editor-Funktionen wurden in editor.js ausgelagert
 */

// Globale Variablen
window.data = null;

// PDF-spezifische Variablen
let pdfSessionId = null;
let currentPdfPage = 1;
let totalPdfPages = 1;
let allPdfPages = [];

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

    // PDF-Navigation event listeners
    const pdfNavigation = document.getElementById('pdfNavigation');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const currentPageSpan = document.getElementById('currentPage'); // Richtige ID
    const totalPagesSpan = document.getElementById('totalPages');   // Richtige ID

    // In der vorhandenen prevPageBtn.addEventListener-Funktion
    prevPageBtn.addEventListener('click', function() {
        console.log("Klick auf vorherige Seite", currentPdfPage);
        if (currentPdfPage > 1) {
            navigateToPdfPage(currentPdfPage - 1);
        }
    });
    
    nextPageBtn.addEventListener('click', function() {
        console.log("Klick auf nächste Seite", currentPdfPage, totalPdfPages);
        if (currentPdfPage < totalPdfPages) {
            navigateToPdfPage(currentPdfPage + 1);
        }
    });
    
    // Überprüfen, ob alle Elemente vorhanden sind
    console.log("Haupt-UI-Elemente geladen:", {
        uploadForm: !!uploadForm,
        resultsSection: !!resultsSection,
        uploadedImage: !!uploadedImage
    });
    
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
        .then(data => {
            console.log("Originale API-Antwort:", data);
            
            // Prüfen, ob die Daten vorhanden sind
            if (!data.predictions || data.predictions.length === 0) {
                console.warn("Keine Vorhersagen in der Antwort gefunden!");
            } else {
                console.log(`${data.predictions.length} Vorhersagen erhalten`);
            }
            
            // PDF-Infos extrahieren bevor wir die Daten umwandeln
            const isPdf = data.is_pdf || false;
            const pdfImageUrl = data.pdf_image_url || null;
            
            // Verarbeite die Rückgabedaten und konvertiere in das gewünschte Format
            const processedData = processApiResponse(data);
            
            // PDF-Infos wieder hinzufügen
            processedData.is_pdf = isPdf;
            processedData.pdf_image_url = pdfImageUrl;
            
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

    // Funktion zum Laden einer bestimmten PDF-Seite
    function loadPdfPage(pageNumber) {
        console.log(`Lade PDF-Seite ${pageNumber} von ${totalPages}`);
        
        if (pageNumber < 1 || pageNumber > totalPages || !isPdf) {
            return;
        }
        
        // UI zurücksetzen
        clearAnnotations();
        loader.style.display = 'block';
        
        // Aktualisiere aktuelle Seite
        currentPage = pageNumber;
        
        // Formulardaten vorbereiten (alle Formularfelder beibehalten)
        const formData = new FormData(uploadForm);
        formData.set('page', pageNumber);
        
        // API-Aufruf für neue Seitenvorhersage
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
        .then(data => {
            console.log("Seitenantwort:", data);
            
            // Bild der aktuellen Seite anzeigen
            if (data.image_paths && data.image_paths[currentPage-1]) {
                uploadedImage.src = data.image_paths[currentPage-1];
            }
            
            // Seitennavigation aktualisieren
            updatePageNavigation();
            
            // Verarbeite die Rückgabedaten
            const processedData = processApiResponse(data);
            
            // Nur die Anmerkungen aktualisieren, nicht das Bild erneut laden
            updateResults(processedData);
        })
        .catch(error => {
            console.error('Error:', error);
            errorMessage.textContent = 'Fehler: ' + error.message;
            errorMessage.style.display = 'block';
        })
        .finally(() => {
            loader.style.display = 'none';
        });
    }

    // Funktion zum Navigieren zwischen PDF-Seiten
    function navigateToPdfPage(pageNumber) {
        console.log(`Navigiere zu PDF-Seite ${pageNumber} von ${totalPdfPages}`);
        
        // UI-Status aktualisieren
        loader.style.display = 'block';
        errorMessage.style.display = 'none';
        
        // Formulardaten vorbereiten
        const formData = new FormData();
        formData.append('session_id', pdfSessionId);
        formData.append('page', pageNumber);
        
        // Parameterwerte aus dem Formular übernehmen
        formData.append('format_width', document.getElementById('formatWidth').value);
        formData.append('format_height', document.getElementById('formatHeight').value);
        formData.append('dpi', document.getElementById('dpi').value);
        formData.append('plan_scale', document.getElementById('planScale').value);
        formData.append('threshold', document.getElementById('threshold').value);
        
        console.log("Senden von Anfrage für Seite", pageNumber, "mit Session", pdfSessionId);
        
        // API-Aufruf für die Seitenanalyse
        fetch('/analyze_page', {
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
        .then(data => {
            console.log("Seitenanalyse-Ergebnis:", data);
            
            // Verarbeite die Rückgabedaten und konvertiere in das gewünschte Format
            const processedData = processApiResponse(data);
            
            // PDF-Infos wieder hinzufügen
            processedData.is_pdf = data.is_pdf || false;
            processedData.pdf_image_url = data.pdf_image_url || null;
            processedData.session_id = data.session_id;
            processedData.current_page = data.current_page;
            processedData.page_count = data.page_count;
            processedData.all_pages = data.all_pages;
            
            // Aktualisiere die globalen Variablen
            pdfSessionId = data.session_id;
            currentPdfPage = data.current_page;
            totalPdfPages = data.page_count;
            allPdfPages = data.all_pages;
            
            // Ergebnisse anzeigen
            displayResults(processedData);
        })
        .catch(error => {
            console.error('Error:', error);
            errorMessage.textContent = 'Fehler: ' + error.message;
            errorMessage.style.display = 'block';
        })
        .finally(() => {
            loader.style.display = 'none';
        });
    }

    // Funktion zum Aktualisieren der PDF-Navigations-UI
    function updatePdfNavigation() {
        console.log("updatePdfNavigation aufgerufen:", currentPdfPage, totalPdfPages);
        currentPageSpan.textContent = currentPdfPage;
        totalPagesSpan.textContent = totalPdfPages || 1;  // Falls undefined, 1 verwenden
        
        // Buttons je nach aktueller Seite aktivieren/deaktivieren
        prevPageBtn.disabled = currentPdfPage <= 1;
        nextPageBtn.disabled = currentPdfPage >= totalPdfPages;
        
        // Navigation immer anzeigen, wenn es sich um eine PDF handelt
        pdfNavigation.style.display = 'flex';
        console.log("PDF-Navigation wird angezeigt:", pdfNavigation.style.display);
    }

    // Funktion zum Aktualisieren der Seitennavigation
    function updatePageNavigation() {
        pageDisplay.textContent = `Seite ${currentPage} von ${totalPages}`;
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
    }

    // Funktion zum Löschen aller Anmerkungen ohne das Bild zu löschen
    function clearAnnotations() {
        // Alle Annotationen entfernen
        const boxes = imageContainer.querySelectorAll('.bounding-box, .box-label');
        boxes.forEach(box => box.remove());
        
        // SVG leeren
        while (annotationOverlay.firstChild) {
            annotationOverlay.removeChild(annotationOverlay.firstChild);
        }
    }

    // Funktion zum Aktualisieren der Ergebnisse ohne das Bild neu zu laden
    function updateResults(responseData) {
        // Lokale und globale Daten setzen
        window.data = responseData;
        
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
        console.log("API-Antwort:", responseData);
        console.log("PDF erkannt:", responseData.is_pdf);
        console.log("PDF-Seiten:", responseData.page_count);
        console.log("Vollständige API-Antwort:", JSON.stringify(responseData));
        
        // PDF-spezifische Informationen verarbeiten
        const isPdf = responseData.is_pdf || false;
        
        // In der Funktion displayResults - stellen wir sicher, dass das richtig gesetzt wird
        if (isPdf) {
            pdfSessionId = responseData.session_id;
            currentPdfPage = parseInt(responseData.current_page || 1);
            totalPdfPages = parseInt(responseData.page_count || 1);
            allPdfPages = responseData.all_pages || [];
            
            console.log("PDF vollständige Info:", {
                session: pdfSessionId,
                current: currentPdfPage,
                total: totalPdfPages,
                pages: allPdfPages
            });
            
            // PDF-Navigation aktualisieren
            updatePdfNavigation();
        } else {
            console.log("Keine PDF erkannt, Navigation ausblenden");
            // Keine PDF, Navigation ausblenden
            pdfNavigation.style.display = 'none';
}
        
        // Lokale und globale Daten setzen
        window.data = responseData;
        
        // Bild anzeigen - entweder aus PDF oder direkt
        if (isPdf && responseData.pdf_image_url) {
            console.log("PDF erkannt - Bild-URL:", responseData.pdf_image_url);
            uploadedImage.src = responseData.pdf_image_url + '?t=' + new Date().getTime(); // Cache-Busting
        } else {
            // Normale Bilddatei
            const uploadedFile = document.getElementById('file').files[0];
            const displayImageUrl = URL.createObjectURL(uploadedFile);
            uploadedImage.src = displayImageUrl;
        }
        
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
                element.style.borderWidth = '4px';
                element.style.opacity = '1.0';
            } else { // Polygone
                element.style.strokeWidth = '3px';
                element.style.fillOpacity = '0.5';
            }
            labelElement.style.opacity = '1.0';
        } else {
            if (element.classList.contains('bounding-box')) {
                element.style.borderWidth = '2px';
                element.style.opacity = '0.8';
            } else {
                element.style.strokeWidth = '2px';
                element.style.fillOpacity = '0.1';
            }
            labelElement.style.opacity = '1.0';
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
        pdfNavigation.style.display = 'none';
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
        
        // PDF-spezifische Variablen zurücksetzen
        pdfSessionId = null;
        currentPdfPage = 1;
        totalPdfPages = 1;
        allPdfPages = [];
        pdfNavigation.style.display = 'none';
        
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
    
    // Editor-Zugriff initialisieren mit Elementen, die in beiden Dateien verwendet werden
    if(typeof window.initEditor === 'function') {
        window.initEditor({
            uploadedImage: uploadedImage,
            imageContainer: imageContainer,
            annotationOverlay: annotationOverlay,
            resultsSection: resultsSection,
            updateSummary: updateSummary,
            updateResultsTable: updateResultsTable,
            addAnnotation: addAnnotation
        });
    } else {
        console.warn("Editor-Initialisierungsfunktion nicht gefunden. Bitte stellen Sie sicher, dass editor.js vor der Hauptdatei geladen wird.");
    }
});