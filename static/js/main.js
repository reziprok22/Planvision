/**
 * Hauptdatei für Fenster-Erkennungstool
 * Diese Datei enthält die Hauptfunktionalität, die Editor-Funktionen wurden in editor.js ausgelagert
 */

// Globale Variablen
window.data = null;

let pdfPageData = {}; // Speichert Daten aller verarbeiteten Seiten
let pageSettings = {}; // Speichert die Einstellungen pro Seite

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

    // Event-Listener für den "Seite neu verarbeiten"-Button hinzufügen
    const reprocessBtn = document.getElementById('reprocessBtn');
    if (reprocessBtn) {
        reprocessBtn.addEventListener('click', function() {
            // Aktuelle Seite neu verarbeiten mit den momentanen Formularwerten
            navigateToPdfPage(currentPdfPage, true);
        });
    }
    
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

    // Projekt speichern
    function saveProject() {
    // Projektname vom Nutzer abfragen
    const projectName = prompt("Geben Sie einen Namen für das Projekt ein:", 
        `Fensterprojekt ${new Date().toLocaleDateString()}`);

    if (!projectName) return; // Abbruch wenn kein Name eingegeben

    // Status anzeigen
    const saveStatus = document.createElement('div');
    saveStatus.className = 'save-status';
    saveStatus.textContent = 'Speichere Projekt...';
    document.body.appendChild(saveStatus);

    // Alle Analysedaten sammeln
    const analysisData = {};
    Object.keys(pdfPageData).forEach(pageNum => {
    analysisData[pageNum] = pdfPageData[pageNum];
    });

    // Daten für den Server vorbereiten
    const projectData = {
    project_name: projectName,
    session_id: pdfSessionId,
    analysis_data: analysisData,
    settings: pageSettings
    };

    // Projekt auf dem Server speichern
    fetch('/save_project', {
    method: 'POST',
    headers: {
    'Content-Type': 'application/json',
    },
    body: JSON.stringify(projectData)
    })
    .then(response => response.json())
    .then(data => {
    if (data.success) {
    saveStatus.textContent = `Projekt "${data.project_name}" erfolgreich gespeichert!`;
    saveStatus.style.backgroundColor = '#4CAF50';

    // Projektliste aktualisieren, falls sichtbar
    if (document.getElementById('projectList')) {
    loadProjectList();
    }

    // Hier die neue Funktionalität: Projekt automatisch neu laden
    const oldSessionId = pdfSessionId;
    pdfSessionId = data.project_id;

    // Nur wenn sich die ID geändert hat (Erstmalige Speicherung)
    if (oldSessionId !== data.project_id) {
    setTimeout(() => {
    saveStatus.textContent = `Lade Projekt "${data.project_name}" neu...`;
    loadProject(data.project_id);
    }, 1000);
    }
    } else {
    saveStatus.textContent = `Fehler: ${data.error}`;
    saveStatus.style.backgroundColor = '#f44336';
    }

    // Status nach 3 Sekunden ausblenden
    setTimeout(() => {
    saveStatus.style.opacity = '0';
    setTimeout(() => saveStatus.remove(), 500);
    }, 3000);
    })
    .catch(error => {
    saveStatus.textContent = `Fehler: ${error.message}`;
    saveStatus.style.backgroundColor = '#f44336';
    });
    }
    window.saveProject = saveProject;


    // Projektliste laden
    function loadProjectList() {
        console.log("loadProjectList aufgerufen");
        const projectList = document.getElementById('projectList');
        if (!projectList) {
            console.error("Projektliste-Element nicht gefunden!");
            return;
        }
        
        projectList.innerHTML = '<p>Lade Projekte...</p>';
        console.log("Sende Anfrage an /list_projects");
        
        fetch('/list_projects')
            .then(response => {
                console.log("Antwort erhalten:", response);
                return response.json();
            })
            .then(data => {
                console.log("Daten erhalten:", data);
                if (data.success) {
                    if (data.projects.length === 0) {
                        projectList.innerHTML = '<p>Keine Projekte gefunden.</p>';
                        return;
                    }
                    
                    projectList.innerHTML = '';
                    const table = document.createElement('table');
                    table.className = 'project-table';
                    
                    // Tabellenkopf
                    const thead = document.createElement('thead');
                    thead.innerHTML = `
                        <tr>
                            <th>Projektname</th>
                            <th>Erstellt am</th>
                            <th>Seiten</th>
                            <th>Aktionen</th>
                        </tr>
                    `;
                    table.appendChild(thead);
                    
                    // Tabellenkörper
                    const tbody = document.createElement('tbody');
                    data.projects.forEach(project => {
                        const tr = document.createElement('tr');
                        
                        // Datum formatieren
                        const date = new Date(project.created_at);
                        const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
                        
                        tr.innerHTML = `
                            <td>${project.project_name}</td>
                            <td>${formattedDate}</td>
                            <td>${project.page_count}</td>
                            <td>
                                <button class="load-project-btn" data-id="${project.project_id}">Laden</button>
                            </td>
                        `;
                        tbody.appendChild(tr);
                    });
                    table.appendChild(tbody);
                    projectList.appendChild(table);
                    
                    // Event-Listener für "Laden"-Buttons
                    document.querySelectorAll('.load-project-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const projectId = btn.dataset.id;
                            console.log(`Lade Projekt mit ID: ${projectId}`);
                            loadProject(projectId);
                        });
                    });
                } else {
                    console.error("Fehler:", data.error);
                    projectList.innerHTML = `<p>Fehler: ${data.error}</p>`;
                }
            })
            .catch(error => {
                console.error("Fetch-Fehler:", error);
                projectList.innerHTML = `<p>Fehler: ${error.message}</p>`;
            });
    }
    // Funktion global verfügbar machen
    window.loadProjectList = loadProjectList;

    // Projekt laden
    function loadProject(projectId) {
        console.log(`loadProject aufgerufen mit ID: ${projectId}`);
        
        // UI zurücksetzen
        clearResults();
        loader.style.display = 'block';
        errorMessage.style.display = 'none';
        
        fetch(`/load_project/${projectId}`)
            .then(response => {
                console.log("Antwort erhalten:", response);
                if (!response.ok) {
                    throw new Error(`Server-Fehler: ${response.status} ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                console.log("Projekt-Daten erhalten:", data);
                if (data.success) {
                    // Globale Variablen zurücksetzen und mit Projektdaten füllen
                    pdfPageData = data.analysis_data;
                    pageSettings = data.settings;
                    pdfSessionId = projectId; // Wir verwenden die Projekt-ID als Session-ID
                    currentPdfPage = 1;
                    totalPdfPages = data.metadata.page_count;
                    allPdfPages = data.image_urls;
                    
                    // Debug-Ausgabe der Daten für die erste Seite
                    console.log("Daten für Seite 1:", pdfPageData["1"]);
                    console.log("Anzahl Vorhersagen:", pdfPageData["1"]?.predictions?.length);
                    
                    // Erste Seite anzeigen
                    displayPdfPage(1, pdfPageData["1"]);
                    
                    // Projekttitel anzeigen
                    document.title = `Fenster-Erkennungstool - ${data.metadata.project_name}`;
                    
                    // Projektliste ausblenden
                    const projectList = document.getElementById('projectList');
                    if (projectList) {
                        projectList.style.display = 'none';
                    }
                    const loadProjectBtn = document.getElementById('loadProjectBtn');
                    if (loadProjectBtn) {
                        loadProjectBtn.textContent = 'Projekt öffnen';
                    }
                } else {
                    errorMessage.textContent = data.error;
                    errorMessage.style.display = 'block';
                }
            })
            .catch(error => {
                console.error("Fehler beim Laden des Projekts:", error);
                errorMessage.textContent = error.message;
                errorMessage.style.display = 'block';
            })
            .finally(() => {
                loader.style.display = 'none';
            });
    }


    
    // Formular-Submit-Handler
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Prüfe, ob bereits Daten gespeichert wurden
        const hasExistingData = Object.keys(pdfPageData).length > 0;
        
        if (hasExistingData) {
            // Frage nach Bestätigung, wenn bereits Daten existieren
            if (!confirm("Alle bisherigen Änderungen gehen verloren. Möchten Sie den Plan wirklich neu analysieren?")) {
                return; // Abbruch, wenn der Nutzer "Abbrechen" klickt
            }
        }
        
        // UI zurücksetzen
        clearResults();
        loader.style.display = 'block';
        errorMessage.style.display = 'none';
        
        // Zurücksetzen der gespeicherten Daten und Einstellungen, wenn wir eine neue Analyse starten
        pdfPageData = {};  // Seiten-Daten zurücksetzen
        pageSettings = {}; // Einstellungen zurücksetzen
        
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
            const sessionId = data.session_id || null;
            const pageCount = data.page_count || 1;
            const currentPage = data.current_page || 1;
            const allPages = data.all_pages || [];
            
            // Verarbeite die Rückgabedaten und konvertiere in das gewünschte Format
            const processedData = processApiResponse(data);
            
            // PDF-Infos wieder hinzufügen
            processedData.is_pdf = isPdf;
            processedData.pdf_image_url = pdfImageUrl;
            processedData.session_id = sessionId;
            processedData.page_count = pageCount;
            processedData.current_page = currentPage;
            processedData.all_pages = allPages;
            
            // Debug-Ausgabe zu PDF-Informationen
            if (isPdf) {
                console.log("PDF-Informationen nach Verarbeitung:", {
                    is_pdf: processedData.is_pdf,
                    session_id: processedData.session_id,
                    page_count: processedData.page_count,
                    current_page: processedData.current_page,
                    pages: processedData.all_pages ? processedData.all_pages.length : 0
                });
            }
            
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
    function navigateToPdfPage(pageNumber, forceReprocess = false) {
        console.log(`Navigiere zu PDF-Seite ${pageNumber} von ${totalPdfPages}, Neu-Verarbeitung: ${forceReprocess}`);
        
        // Speichere aktuelle Bearbeitungen der momentanen Seite, falls vorhanden
        if (window.data && currentPdfPage) {
            console.log(`Speichere Daten für Seite ${currentPdfPage} mit ${window.data.predictions?.length || 0} Vorhersagen`);
            pdfPageData[currentPdfPage] = JSON.parse(JSON.stringify(window.data));
        }
        
        // Wenn wir bereits Daten für diese Seite haben und keine Neu-Verarbeitung erzwingen
        if (!forceReprocess && pdfPageData[pageNumber]) {
            console.log(`Verwende gespeicherte Daten für Seite ${pageNumber}`);
            
            // Aktuelle Seite aktualisieren
            currentPdfPage = pageNumber;
            
            // Verwende die gespeicherten Daten
            displayPdfPage(pageNumber, pdfPageData[pageNumber]);
            return;
        }
        
        // Wenn eine Neuverarbeitung erzwungen wird, aktualisieren wir die Einstellungen für diese Seite
        if (forceReprocess) {
            pageSettings[pageNumber] = {
                format_width: document.getElementById('formatWidth').value,
                format_height: document.getElementById('formatHeight').value,
                dpi: document.getElementById('dpi').value,
                plan_scale: document.getElementById('planScale').value,
                threshold: document.getElementById('threshold').value
            };
            console.log(`Einstellungen für Seite ${pageNumber} aktualisiert:`, pageSettings[pageNumber]);
        }
        
        // UI-Status aktualisieren
        loader.style.display = 'block';
        errorMessage.style.display = 'none';
        
        // Formulardaten vorbereiten
        const formData = new FormData();
        formData.append('session_id', pdfSessionId);
        formData.append('page', pageNumber);
        
        // Verwende die Einstellungen für diese Seite
        formData.append('format_width', pageSettings[pageNumber].format_width);
        formData.append('format_height', pageSettings[pageNumber].format_height);
        formData.append('dpi', pageSettings[pageNumber].dpi);
        formData.append('plan_scale', pageSettings[pageNumber].plan_scale);
        formData.append('threshold', pageSettings[pageNumber].threshold);
        
        console.log(`API-Aufruf für Seite ${pageNumber} mit Einstellungen:`, {
            width: pageSettings[pageNumber].format_width,
            height: pageSettings[pageNumber].format_height,
            dpi: pageSettings[pageNumber].dpi,
            scale: pageSettings[pageNumber].plan_scale,
            threshold: pageSettings[pageNumber].threshold
        });
        
        // API-Aufruf für die Seitenanalyse
        fetch('/analyze_page', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            // Rest des Codes bleibt weitgehend unverändert
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
            currentPdfPage = parseInt(data.current_page);
            totalPdfPages = parseInt(data.page_count);
            allPdfPages = data.all_pages;
            
            // Daten für diese Seite speichern
            pdfPageData[pageNumber] = processedData;
            
            // Ergebnisse anzeigen
            displayPdfPage(pageNumber, processedData);
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

    // Funktion zum Anzeigen einer PDF-Seite mit vorhandenen Daten
    function displayPdfPage(pageNumber, pageData) {
        console.log("Seitenstruktur für Seite 1:", JSON.stringify(pdfPageData[1], null, 2));
        console.log(`Zeige Seite ${pageNumber} an mit Daten:`, pageData);


        // Überprüfe Format der Daten
        if (!pageData) {
            console.error(`Keine Daten für Seite ${pageNumber} gefunden!`);
            return;
        }
        
        // Überprüfe, ob die Seitendaten die erwartete Struktur haben
        if (!pageData.predictions || !Array.isArray(pageData.predictions)) {
            console.error(`Ungültiges Datenformat für Seite ${pageNumber}:`, pageData);
            
            // Versuch einer Korrektur, falls möglich
            if (pageData.count !== undefined && pageData.total_area !== undefined) {
                console.log("Datenformat scheint korrekt zu sein, führe fort...");
            } else {
                console.error("Keine Vorhersagen gefunden, kann Seite nicht anzeigen");
                errorMessage.textContent = `Keine gültigen Daten für Seite ${pageNumber}`;
                errorMessage.style.display = 'block';
                return;
            }
        }
        
        // Globale Daten setzen
        window.data = JSON.parse(JSON.stringify(pageData)); // Tiefe Kopie, um Referenzprobleme zu vermeiden
        
        // Aktualisiere die Eingabefelder auf die Werte für diese Seite
        if (pageSettings[pageNumber]) {
            document.getElementById('formatWidth').value = pageSettings[pageNumber].format_width || 210;
            document.getElementById('formatHeight').value = pageSettings[pageNumber].format_height || 297;
            document.getElementById('dpi').value = pageSettings[pageNumber].dpi || 300;
            document.getElementById('planScale').value = pageSettings[pageNumber].plan_scale || 100;
            document.getElementById('threshold').value = pageSettings[pageNumber].threshold || 0.5;
        }
        
        // Bild anzeigen
        const imageUrl = pageData.pdf_image_url || allPdfPages[pageNumber-1];
        
        console.log(`Zeige Bild an: ${imageUrl}`);
        uploadedImage.src = imageUrl + '?t=' + new Date().getTime(); // Cache-Busting
        
        // Ergebnisbereiche anzeigen
        resultsSection.style.display = 'block';
        resultsTableSection.style.display = 'block';
        
        // PDF-Navigation anzeigen, wenn mehrere Seiten vorhanden sind
        if (totalPdfPages > 1) {
            pdfNavigation.style.display = 'flex';
            updatePdfNavigation();
        } else {
            pdfNavigation.style.display = 'none';
        }
        
        // Auf Bild-Ladung warten
        uploadedImage.onload = function() {
            console.log("Bild geladen:", uploadedImage.width, "x", uploadedImage.height);
            
            // Alte Annotationen entfernen
            clearAnnotations();
            
            // SVG-Container anpassen
            adaptSvgOverlay();
            
            // Zusammenfassung
            updateSummary();
            
            // Tabelle füllen
            updateResultsTable();
            
            // Annotationen hinzufügen
            if (window.data && window.data.predictions && window.data.predictions.length > 0) {
                console.log(`Füge ${window.data.predictions.length} Annotationen hinzu`);
                window.data.predictions.forEach((pred, index) => {
                    addAnnotation(pred, index);
                });
            } else {
                console.warn("Keine Vorhersagen für Annotationen gefunden");
            }
            
            // Simuliere ein Resize-Event nach kurzer Verzögerung
            setTimeout(function() {
                window.dispatchEvent(new Event('resize'));
            }, 200);
        };
    }
    // Funktion zum Aktualisieren der PDF-Navigations-UI
    function updatePdfNavigation() {
        // Aktualisieren der Navigations-UI
        const currentPageSpan = document.getElementById('currentPage');
        const totalPagesSpan = document.getElementById('totalPages');
        
        if (currentPageSpan && totalPagesSpan) {
            currentPageSpan.textContent = currentPdfPage;
            totalPagesSpan.textContent = totalPdfPages;
            
            // Buttons je nach aktueller Seite aktivieren/deaktivieren
            const prevPageBtn = document.getElementById('prevPageBtn');
            const nextPageBtn = document.getElementById('nextPageBtn');
            
            if (prevPageBtn) prevPageBtn.disabled = currentPdfPage <= 1;
            if (nextPageBtn) nextPageBtn.disabled = currentPdfPage >= totalPdfPages;
        }
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
        
        // Lokale und globale Daten setzen
        window.data = responseData;
        
        // PDF-spezifische Informationen verarbeiten
        const isPdf = responseData.is_pdf || false;
        
        if (isPdf) {
            console.log("PDF erkannt:", isPdf);
            
            pdfSessionId = responseData.session_id || null;
            currentPdfPage = parseInt(responseData.current_page || 1);
            totalPdfPages = parseInt(responseData.page_count || 1);
            allPdfPages = responseData.all_pages || [];
            
            // Aktuelle Formularwerte für ALLE Seiten initialisieren, falls nicht bereits vorhanden
            for (let i = 1; i <= totalPdfPages; i++) {
                if (!pageSettings[i]) {
                    pageSettings[i] = {
                        format_width: document.getElementById('formatWidth').value,
                        format_height: document.getElementById('formatHeight').value,
                        dpi: document.getElementById('dpi').value,
                        plan_scale: document.getElementById('planScale').value,
                        threshold: document.getElementById('threshold').value
                    };
                }
            }
            
            // Aktuelle Seite im pdfPageData speichern
            pdfPageData[currentPdfPage] = responseData;
            
            if (totalPdfPages > 1 && pdfSessionId) {
                updatePdfNavigation();
                pdfNavigation.style.display = 'flex';

                // Zeige einen Ladeindikator für Hintergrundverarbeitung
                const loadingIndicator = document.createElement('div');
                loadingIndicator.id = 'backgroundProcessingIndicator';
                loadingIndicator.className = 'background-processing';
                loadingIndicator.innerHTML = `
                    <div class="processing-spinner"></div>
                    <span>Analysiere weitere Seiten im Hintergrund: <span id="processedPagesCount">1</span>/${totalPdfPages}</span>
                `;
                document.body.appendChild(loadingIndicator);
                
                // Starte die Hintergrundverarbeitung nach kurzer Verzögerung
                setTimeout(() => {
                    processRemainingPagesInBackground();
                }, 1000);
            } else {
                pdfNavigation.style.display = 'none';
            }
        } else {
            pdfNavigation.style.display = 'none';
        }
        
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
            
            // Alte Annotationen entfernen. Ist um bestehende Boxen beim Navigieren zu neuen Plan zu entfernen.
            const boxes = imageContainer.querySelectorAll('.bounding-box, .box-label');
            boxes.forEach(box => box.remove());
            
            // SVG leeren
            while (annotationOverlay.firstChild) {
                annotationOverlay.removeChild(annotationOverlay.firstChild);
            }

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

    // Funktion zum Verarbeiten der verbleibenden Seiten im Hintergrund
    function processRemainingPagesInBackground() {
        const indicator = document.getElementById('backgroundProcessingIndicator');
        const counter = document.getElementById('processedPagesCount');
        
        // Starte mit Seite 2, da Seite 1 bereits geladen ist
        let currentProcessingPage = 2;
        
        function processNextPage() {
            if (currentProcessingPage > totalPdfPages) {
                // Alle Seiten verarbeitet
                if (indicator) {
                    indicator.innerHTML = `<span>Alle ${totalPdfPages} Seiten analysiert!</span>`;
                    // Indikator nach kurzer Zeit ausblenden
                    setTimeout(() => {
                        indicator.style.opacity = '0';
                        setTimeout(() => indicator.remove(), 500);
                    }, 3000);
                }
                return;
            }
            
            // Aktuellen Fortschritt anzeigen
            if (counter) counter.textContent = currentProcessingPage;
            
            // Seitenanalyse im Hintergrund durchführen
            const formData = new FormData();
            formData.append('session_id', pdfSessionId);
            formData.append('page', currentProcessingPage);
            
            // Aktuelle Formulareinstellungen verwenden
            formData.append('format_width', document.getElementById('formatWidth').value);
            formData.append('format_height', document.getElementById('formatHeight').value);
            formData.append('dpi', document.getElementById('dpi').value);
            formData.append('plan_scale', document.getElementById('planScale').value);
            formData.append('threshold', document.getElementById('threshold').value);
            
            // Speichere diese Einstellungen auch für diese Seite
            pageSettings[currentProcessingPage] = {
                format_width: document.getElementById('formatWidth').value,
                format_height: document.getElementById('formatHeight').value,
                dpi: document.getElementById('dpi').value,
                plan_scale: document.getElementById('planScale').value,
                threshold: document.getElementById('threshold').value
            };
            
            fetch('/analyze_page', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                // Daten verarbeiten und speichern
                const processedData = processApiResponse(data);
                
                // PDF-Infos beibehalten
                processedData.is_pdf = data.is_pdf || false;
                processedData.pdf_image_url = data.pdf_image_url || null;
                processedData.session_id = data.session_id;
                processedData.current_page = data.current_page;
                processedData.page_count = data.page_count;
                processedData.all_pages = data.all_pages;
                
                // In pdfPageData speichern
                pdfPageData[currentProcessingPage] = processedData;
                
                console.log(`Seite ${currentProcessingPage} im Hintergrund analysieren`);
                
                // Zur nächsten Seite gehen
                currentProcessingPage++;
                // Kurze Pause zwischen den Anfragen
                setTimeout(processNextPage, 500);
            })
            .catch(error => {
                console.error(`Fehler bei Analyse von Seite ${currentProcessingPage}:`, error);
                
                // Trotz Fehler weitermachen
                currentProcessingPage++;
                setTimeout(processNextPage, 500);
            });
        }
        
        // Start der Verarbeitung
        processNextPage();
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

    // Event-Listener für Projekt-Buttons
    const saveProjectBtn = document.getElementById('saveProjectBtn');
    const loadProjectBtn = document.getElementById('loadProjectBtn');
    const projectList = document.getElementById('projectList');

    if (saveProjectBtn) {
        saveProjectBtn.addEventListener('click', function() {
            if (!pdfSessionId) {
                alert('Bitte laden Sie zuerst eine PDF-Datei hoch und analysieren Sie sie.');
                return;
            }
            saveProject();
        });
    }

    if (loadProjectBtn) {
        loadProjectBtn.addEventListener('click', function() {
            if (projectList.style.display === 'none') {
                loadProjectList();
                projectList.style.display = 'block';
                loadProjectBtn.textContent = 'Projektliste schließen';
            } else {
                projectList.style.display = 'none';
                loadProjectBtn.textContent = 'Projekt öffnen';
            }
        });
    }
    
    // Event-Listener für den Export-Button am Ende des DOMContentLoaded-Handlers
    const exportPdfBtn = document.getElementById('exportPdfBtn');
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', function() {
            if (!pdfSessionId) {
                alert('Bitte laden Sie zuerst eine PDF-Datei hoch und analysieren Sie sie.');
                return;
            }
            
    // Prüfen, ob die Session-ID eine gültige Projekt-ID ist (beginnt mit einer UUID)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(pdfSessionId)) {
        alert('Bitte speichern Sie das Projekt zuerst, bevor Sie es als PDF exportieren.');
        return;
    }
            
            // Speicherstatus anzeigen
            const exportStatus = document.createElement('div');
            exportStatus.className = 'save-status';
            exportStatus.textContent = 'Erstelle PDF-Bericht...';
            document.body.appendChild(exportStatus);
            
            // PDF-Export-Anfrage senden
            fetch(`/export_pdf/${pdfSessionId}`)
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        exportStatus.textContent = 'PDF-Bericht wurde erfolgreich erstellt!';
                        exportStatus.style.backgroundColor = '#4CAF50';
                        
                        // Öffne das PDF in einem neuen Tab
                        window.open(data.pdf_url, '_blank');
                    } else {
                        exportStatus.textContent = `Fehler: ${data.error}`;
                        exportStatus.style.backgroundColor = '#f44336';
                    }
                    
                    // Status nach 3 Sekunden ausblenden
                    setTimeout(() => {
                        exportStatus.style.opacity = '0';
                        setTimeout(() => exportStatus.remove(), 500);
                    }, 3000);
                })
                .catch(error => {
                    exportStatus.textContent = `Fehler: ${error.message}`;
                    exportStatus.style.backgroundColor = '#f44336';
                });
        });
    }
});