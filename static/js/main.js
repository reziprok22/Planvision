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

    // Standard-Labels definieren (werden nur verwendet, wenn keine Labels vom Server kommen)
    const defaultLabels = [
        { id: 1, name: "Fenster", color: "#0000FF" },  // Blau
        { id: 2, name: "Tür", color: "#FF0000" },      // Rot
        { id: 3, name: "Wand", color: "#D4D638" },     // Gelb
        { id: 4, name: "Lukarne", color: "#FFA500" },  // Orange
        { id: 5, name: "Dach", color: "#800080" }      // Lila
    ];

    // Default line labels
    const defaultLineLabels = [
        { id: 1, name: "Strecke", color: "#FF9500" },  // Orange, standard measurement
        { id: 2, name: "Höhe", color: "#00AAFF" },     // Blue, for height measurements
        { id: 3, name: "Breite", color: "#4CAF50" },   // Green, for width measurements
        { id: 4, name: "Abstand", color: "#9C27B0" }   // Purple, for distance measurements
    ];

    // Verwende die Labels aus dem localStorage oder die Standard-Labels
    let currentLabels = JSON.parse(localStorage.getItem('labels')) || [...defaultLabels];
    window.currentLabels = currentLabels; // Global verfügbar machen

    // Verwende die Line-Labels aus dem localStorage oder die Standard-Labels
    let currentLineLabels = JSON.parse(localStorage.getItem('lineLabels')) || [...defaultLineLabels];
    window.currentLineLabels = currentLineLabels; // Global verfügbar machen
    
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
    
    // Formatauswahl-Handler für manuelle Anpassungen
    formatSelect.addEventListener('change', function() {
        if (formatSelect.value === 'auto') {
            // Automatische Erkennung aktivieren (Format-Felder ausblenden)
            customFormatFields.style.display = 'none';
            // Hier könnten Sie die erkannten Werte wiederherstellen
        } else if (formatSelect.value === 'custom') {
            // Benutzerdefiniertes Format (Felder einblenden)
            customFormatFields.style.display = 'block';
        } else {
            // Vordefinierte Formate
            customFormatFields.style.display = 'none';
            
            // Standard-Formatgrößen setzen
            const formatSizes = {
                'A4 (Hochformat)': [210, 297],
                'A4 (Querformat)': [297, 210],
                'A3 (Hochformat)': [297, 420],
                'A3 (Querformat)': [420, 297],
                'A2 (Hochformat)': [420, 594],
                'A2 (Querformat)': [594, 420],
                'A1 (Hochformat)': [594, 841],
                'A1 (Querformat)': [841, 594],
                'A0 (Hochformat)': [841, 1189],
                'A0 (Querformat)': [1189, 841]
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

        // Debug vor dem Speichern
        console.log("pageSettings, die zum Server gesendet werden:", JSON.parse(JSON.stringify(pageSettings)));
        Object.keys(pageSettings).forEach(pageNum => {
            console.log(`Einstellungen für Seite ${pageNum}:`, pageSettings[pageNum]);
        });
        

        // Daten für den Server vorbereiten (Labels)
        const projectData = {
            project_name: projectName,
            session_id: pdfSessionId,
            analysis_data: analysisData,
            settings: pageSettings,
            labels: currentLabels,
            lineLabels: currentLineLabels
        };

        // In der saveProject-Funktion in main.js, direkt bevor die Daten an den Server gesendet werden:
        console.log("pageSettings, die zum Server gesendet werden:", pageSettings);

        // Überprüfen Sie, ob die Werte für jede Seite korrekt sind
        Object.keys(pageSettings).forEach(pageNum => {
            console.log(`Einstellungen für Seite ${pageNum}:`, pageSettings[pageNum]);
        });

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

                // rojekt automatisch neu laden
                const oldSessionId = pdfSessionId;
                pdfSessionId = data.project_id;

                // Labels laden, falls vorhanden
                if (data.labels && Array.isArray(data.labels) && data.labels.length > 0) {
                    currentLabels = data.labels;
                    localStorage.setItem('labels', JSON.stringify(currentLabels));
                    updateUIForLabels(); // UI mit den geladenen Labels aktualisieren
                }

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
            const pageSizes = data.page_sizes || [];
            
            // Verarbeite die Rückgabedaten und konvertiere in das gewünschte Format
            const processedData = processApiResponse(data);
            
            // PDF-Infos wieder hinzufügen
            processedData.is_pdf = isPdf;
            processedData.pdf_image_url = pdfImageUrl;
            processedData.session_id = sessionId;
            processedData.page_count = pageCount;
            processedData.current_page = currentPage;
            processedData.all_pages = allPages;
            processedData.page_sizes = pageSizes;
            
            // Debug-Ausgabe zu PDF-Informationen
            if (isPdf) {
                console.log("PDF-Informationen nach Verarbeitung:", {
                    is_pdf: processedData.is_pdf,
                    session_id: processedData.session_id,
                    page_count: processedData.page_count,
                    current_page: processedData.current_page,
                    pages: processedData.all_pages ? processedData.all_pages.length : 0,
                    page_sizes: processedData.page_sizes
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
    let lineCount = 0; // Add this for line measurements
    
    let fensterArea = 0;
    let tuerArea = 0;
    let wandArea = 0;
    let lukarneArea = 0;
    let dachArea = 0;
    let otherArea = 0;
    
    // Sicherstellen, dass predictions ein Array ist
    const predictions = apiResponse.predictions || [];
    
    // Überprüfen ob predictions vorhanden ist
    if (Array.isArray(predictions)) {
        // Vorhersagen verarbeiten
        predictions.forEach(pred => {
            // Typ bestimmen basierend auf vorhandenen Eigenschaften
            let predType = "rectangle";
            if (pred.type === "line" || (pred.line && pred.length !== undefined)) {
                predType = "line";
                lineCount++;
            } else if (pred.type === "polygon" || pred.polygon) {
                predType = "polygon";
            } else if (pred.box || pred.bbox) {
                predType = "rectangle";
            }
            
            // Prüfe, ob ein benutzerdefiniertes Label für diese ID existiert
            const customLabel = window.currentLabels ? window.currentLabels.find(l => l.id === pred.label) : null;
            let label_name;
            
            if (customLabel) {
                label_name = customLabel.name;
            } else {
                // Fallback auf die Standard-Namen
                switch(pred.label) {
                    case 1: 
                        label_name = "Fenster";
                        if (predType !== "line") { // Only count areas for non-line objects
                            fensterCount++;
                            fensterArea += pred.area || 0;
                        }
                        break;
                    case 2: 
                        label_name = "Tür";
                        if (predType !== "line") {
                            tuerCount++;
                            tuerArea += pred.area || 0;
                        }
                        break;
                    case 3: 
                        label_name = "Wand";
                        if (predType !== "line") {
                            wandCount++;
                            wandArea += pred.area || 0;
                        }
                        break;
                    case 4: 
                        label_name = "Lukarne";
                        if (predType !== "line") {
                            lukarneCount++;
                            lukarneArea += pred.area || 0;
                        }
                        break;
                    case 5: 
                        label_name = "Dach";
                        if (predType !== "line") {
                            dachCount++;
                            dachArea += pred.area || 0;
                        }
                        break;
                    default: 
                        label_name = predType === "line" ? "Messlinie" : "Andere";
                        if (predType !== "line") {
                            otherCount++;
                            otherArea += pred.area || 0;
                        }
                }
            }
            
            // Aktualisiere Zähler und Flächen basierend auf dem Label
            if (customLabel && predType !== "line") {
                switch(pred.label) {
                    case 1: fensterCount++; fensterArea += pred.area || 0; break;
                    case 2: tuerCount++; tuerArea += pred.area || 0; break;
                    case 3: wandCount++; wandArea += pred.area || 0; break;
                    case 4: lukarneCount++; lukarneArea += pred.area || 0; break;
                    case 5: dachCount++; dachArea += pred.area || 0; break;
                    default: otherCount++; otherArea += pred.area || 0;
                }
            }
            
            // Verarbeitete Vorhersage hinzufügen
            result.predictions.push({
                ...pred,
                type: predType,
                label_name: label_name
            });
        });
    } else {
        console.warn("Keine predictions in der API-Antwort gefunden oder nicht als Array");
    }
    
    // Zusammenfassungsdaten setzen
    result.count = {
        fenster: fensterCount,
        tuer: tuerCount,
        wand: wandCount,
        lukarne: lukarneCount,
        dach: dachCount,
        other: otherCount,
        line: lineCount // Add this line count
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
            const pageSizes = window.data.page_sizes || [];
            
            // Nur Formularwerte verwenden, wenn keine ausgelesenen Seitengrößen vorhanden sind
            let formatWidth = document.getElementById('formatWidth').value;
            let formatHeight = document.getElementById('formatHeight').value;
            
            // Falls Seitengrößen für diese spezifische Seite vorhanden, diese verwenden
            if (pageSizes.length >= pageNumber) {
                // Verwende ausgelesene Seitengrößen (als String)
                formatWidth = String(Math.round(pageSizes[pageNumber-1][0]));
                formatHeight = String(Math.round(pageSizes[pageNumber-1][1]));
                console.log(`Verwende ausgelesene Größe bei Neuverarbeitung von Seite ${pageNumber}: ${formatWidth} × ${formatHeight} mm`);
            }
            
            pageSettings[pageNumber] = {
                format_width: formatWidth,
                format_height: formatHeight,
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
            processedData.page_sizes = data.page_sizes || [];
            
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
            document.getElementById('formatWidth').value = pageSettings[pageNumber].format_width;
            document.getElementById('formatHeight').value = pageSettings[pageNumber].format_height;
            document.getElementById('dpi').value = pageSettings[pageNumber].dpi;
            document.getElementById('planScale').value = pageSettings[pageNumber].plan_scale;
            document.getElementById('threshold').value = pageSettings[pageNumber].threshold;
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
    // Clear all SVG elements including labels
    while (annotationOverlay.firstChild) {
        annotationOverlay.removeChild(annotationOverlay.firstChild);
    }
}

// Funktion zum Aktualisieren der Ergebnisse ohne das Bild neu zu laden
function updateResultsTable() {
    console.log("Updating results table with line labels:", JSON.stringify(window.currentLineLabels));
    
    resultsBody.innerHTML = '';
    
    window.data.predictions.forEach((pred, index) => {
        const row = document.createElement('tr');
        
        // Debug this specific prediction
        if (pred.type === "line") {
            console.log(`Line measurement #${index}:`, JSON.stringify(pred));
            console.log(`Searching for line label with ID ${pred.label} in:`, JSON.stringify(window.currentLineLabels));
            const foundLineLabel = window.currentLineLabels ? 
                window.currentLineLabels.find(l => l.id === pred.label) : null;
            console.log("Found line label:", foundLineLabel);
        }
        
        // Suche das passende Label für diese Vorhersage
        let labelName = pred.label_name || "Andere";
        
        // Choose label collection based on type
        if (pred.type === "line") {
            // Important: For lines, use the stored label_name directly
            // This is already set correctly in finishLine
            labelName = pred.label_name || "Messlinie";
            console.log(`Using label name directly from pred.label_name: ${labelName}`);
        } else {
            // For area objects, look up in currentLabels
            const customLabel = window.currentLabels ? 
                window.currentLabels.find(l => l.id === pred.label) : null;
            if (customLabel) {
                labelName = customLabel.name;
                console.log(`Found area label: ${labelName}`);
            }
        }
        
        // Bestimme die Art der Messung (Fläche oder Länge)
        let measurementValue = '';
        
        if (pred.type === "line") {
            // Bei Linien zeigen wir die Länge an
            measurementValue = pred.length ? `${pred.length.toFixed(2)} m` : 'N/A';
        } else {
            // Bei Flächen (Rechtecke, Polygone) zeigen wir die Fläche an
            measurementValue = pred.area ? `${pred.area.toFixed(2)} m²` : 'N/A';
        }
        
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${labelName}</td>
            <td>${pred.type || (pred.polygon ? "Polygon" : "Rechteck")}</td>
            <td>${(pred.score * 100).toFixed(1)}%</td>
            <td>${measurementValue}</td>
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
    console.log("Aktuelle Labels:", window.currentLabels);
    
    // Prüfen, ob Vorhersagen vorhanden sind
    if (!responseData.predictions || responseData.predictions.length === 0) {
        console.warn("Keine Vorhersagen in responseData gefunden!");
    }
    
    // Auf Label-Namen prüfen
    if (responseData.predictions && responseData.predictions.length > 0) {
        console.log("Erste Vorhersage:", responseData.predictions[0]);
        console.log("Label-Name in erster Vorhersage:", responseData.predictions[0].label_name);
    }
    
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
        
        for (let i = 1; i <= totalPdfPages; i++) {
            if (!pageSettings[i]) {
                // Werte aus dem Formular als Basis nehmen
                let formWidth = document.getElementById('formatWidth').value;
                let formHeight = document.getElementById('formatHeight').value;
                
                // Falls erkannte Seitengrößen vorhanden, diese verwenden
                if (responseData.page_sizes && responseData.page_sizes.length >= i) {
                    // Runde die Werte und wandle sie in Strings um
                    formWidth = String(Math.round(responseData.page_sizes[i-1][0]));
                    formHeight = String(Math.round(responseData.page_sizes[i-1][1]));
                    console.log(`Verwende erkannte Seitengröße für Seite ${i}: ${formWidth} × ${formHeight} mm`);
                }
                
                pageSettings[i] = {
                    format_width: formWidth,
                    format_height: formHeight,
                    dpi: document.getElementById('dpi').value,
                    plan_scale: document.getElementById('planScale').value,
                    threshold: document.getElementById('threshold').value
                };
            }
        }
        
        // Aktualisiere die Eingabefelder mit den Werten für die aktuelle Seite
        if (pageSettings[currentPdfPage]) {
            document.getElementById('formatWidth').value = pageSettings[currentPdfPage].format_width;
            document.getElementById('formatHeight').value = pageSettings[currentPdfPage].format_height;
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

        // Clear annotations
        clearAnnotations();
        
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
        
        // Hier sicherstellen, dass wir die korrekten Einstellungen für DIESE Seite verwenden
        let currentPageSettings = pageSettings[currentProcessingPage];
        
        // Falls keine Einstellungen für diese Seite vorhanden, erstelle sie
        if (!currentPageSettings) {
            // Werte aus dem Formular als Basis nehmen
            let formWidth = document.getElementById('formatWidth').value;
            let formHeight = document.getElementById('formatHeight').value;
            
            // Falls erkannte Seitengrößen vorhanden, diese für die jeweilige Seite verwenden
            if (window.data && window.data.page_sizes && window.data.page_sizes.length >= currentProcessingPage) {
                // Runde die Werte und wandle sie in Strings um
                formWidth = String(Math.round(window.data.page_sizes[currentProcessingPage-1][0]));
                formHeight = String(Math.round(window.data.page_sizes[currentProcessingPage-1][1]));
                console.log(`Verwende erkannte Seitengröße für Seite ${currentProcessingPage}: ${formWidth} × ${formHeight} mm`);
            }
            
            currentPageSettings = {
                format_width: formWidth,
                format_height: formHeight,
                dpi: document.getElementById('dpi').value,
                plan_scale: document.getElementById('planScale').value,
                threshold: document.getElementById('threshold').value
            };
            
            // Speichere die Einstellungen
            pageSettings[currentProcessingPage] = currentPageSettings;
        }
        
        formData.append('format_width', currentPageSettings.format_width);
        formData.append('format_height', currentPageSettings.format_height);
        formData.append('dpi', currentPageSettings.dpi);
        formData.append('plan_scale', currentPageSettings.plan_scale);
        formData.append('threshold', currentPageSettings.threshold);
        
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

    // Für Linienmessungen separat anzeigen
    if (window.data.count && window.data.count.line && window.data.count.line > 0) {
        summaryHtml += `<p>Linienmessungen: <strong>${window.data.count.line}</strong></p>`;
    }
    
    summary.innerHTML = summaryHtml;
}

// Funktion zur Aktualisierung der Ergebnistabelle
function updateResultsTable() {
    resultsBody.innerHTML = '';
    
    window.data.predictions.forEach((pred, index) => {
        const row = document.createElement('tr');
        
        // Suche das passende Label für diese Vorhersage
        let labelName = pred.label_name || "Andere";
        
        // Suche in den benutzerdefinierten Labels nach einer passenden ID
        if (pred.type === "line") {
            // Für Linien: Suche in den Linien-Labels
            const lineLabel = window.currentLineLabels ? 
                window.currentLineLabels.find(l => l.id === pred.label) : null;
            if (lineLabel) {
                labelName = lineLabel.name;
            }
        } else {
            // Für Flächen: Suche in den Flächen-Labels
            const customLabel = window.currentLabels ? 
                window.currentLabels.find(l => l.id === pred.label) : null;
            if (customLabel) {
                labelName = customLabel.name;
            }
        }
        
        // Bestimme die Art der Messung (Fläche oder Länge)
        let measurementValue = '';
        
        if (pred.type === "line") {
            // Bei Linien zeigen wir die Länge an
            measurementValue = pred.length ? `${pred.length.toFixed(2)} m` : 'N/A';
        } else {
            // Bei Flächen (Rechtecke, Polygone) zeigen wir die Fläche an
            measurementValue = pred.area ? `${pred.area.toFixed(2)} m²` : 'N/A';
        }
        
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${labelName}</td>
            <td>${pred.type || (pred.polygon ? "Polygon" : "Rechteck")}</td>
            <td>${(pred.score * 100).toFixed(1)}%</td>
            <td>${measurementValue}</td>
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
// In the highlightBox function:
function highlightBox(elementId, isHighlighted) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const labelElement = document.getElementById(`label-${elementId}`);
    if (!labelElement) return;
    
    if (isHighlighted) {
        // All elements use strokeWidth now
        element.style.strokeWidth = '3px';
        element.style.fillOpacity = '0.5';
        
        // For SVG labels, adjust opacity
        const labelRect = labelElement.querySelector('rect');
        if (labelRect) {
            labelRect.setAttribute('opacity', '1.0');
        }
    } else {
        element.style.strokeWidth = '2px';
        element.style.fillOpacity = '0.1';
        
        // For SVG labels, restore default opacity
        const labelRect = labelElement.querySelector('rect');
        if (labelRect) {
            labelRect.setAttribute('opacity', '0.8');
        }
    }
}

// Funktion zum Hinzufügen einer Annotation (Rechteck oder Polygon)
// Funktion zum Hinzufügen einer Annotation (Rechteck oder Polygon)
function addAnnotation(prediction, index) {
    // Skalierungsfaktor berechnen
    const scale = uploadedImage.width / uploadedImage.naturalWidth;
    
    const elementId = `annotation-${index}`;
    
    // Klassen-Präfix basierend auf der Kategorie
    let classPrefix;
    let color;
    
    // Suche das entsprechende Label
    const label = window.currentLabels.find(l => l.id === prediction.label);
    
    if (label) {
        // Verwende den Namen als Klassenpräfix und die definierte Farbe
        classPrefix = label.name.toLowerCase()
            .replace('ä', 'ae')
            .replace('ö', 'oe')
            .replace('ü', 'ue')
            .replace(' ', '_');
        color = label.color;
    } else {
        // Fallback für unbekannte Labels
        switch(prediction.label) {
            case 1: classPrefix = 'fenster'; color = 'blue'; break;
            case 2: classPrefix = 'tuer'; color = 'red'; break;
            case 3: classPrefix = 'wand'; color = '#d4d638'; break;
            case 4: classPrefix = 'lukarne'; color = 'orange'; break;
            case 5: classPrefix = 'dach'; color = 'purple'; break;
            default: classPrefix = 'other'; color = 'gray';
        }
    }
    
    // Label-Text vorbereiten, je nach Typ
    let labelText;
    
    if (prediction.type === "line" && prediction.length !== undefined) {
        labelText = `#${index + 1}: ${prediction.length.toFixed(2)} m`;
        // For lines, use the stored color if available
        color = prediction.color || '#FF9500'; // Fallback to orange if no color set
        classPrefix = 'line';
    } else {
        if (prediction.area !== undefined) {
            labelText = `#${index + 1}: ${prediction.area.toFixed(2)} m²`;
        } else {
            labelText = `#${index + 1}`;
        }
    }
    
    // Je nach Typ (Rechteck, Polygon, oder Linie) unterschiedlich behandeln
    if (prediction.type === "rectangle" || prediction.box || prediction.bbox) {
        const [x1, y1, x2, y2] = prediction.box || prediction.bbox;
        
        // Skalierte Koordinaten
        const scaledX1 = x1 * scale;
        const scaledY1 = y1 * scale;
        const scaledWidth = (x2 - x1) * scale;
        const scaledHeight = (y2 - y1) * scale;
        
        // Create SVG rectangle instead of div
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", scaledX1);
        rect.setAttribute("y", scaledY1);
        rect.setAttribute("width", scaledWidth);
        rect.setAttribute("height", scaledHeight);
        rect.setAttribute("class", `rect-annotation ${classPrefix}-annotation`);
        rect.id = elementId;
        
        // Apply color directly
        if (label && label.color) {
            rect.style.fill = `${label.color}20`; // 20% opacity
            rect.style.stroke = label.color;
        }
        
        // Add to SVG overlay instead of image container
        annotationOverlay.appendChild(rect);
        
        // Label positioning stays similar
        addLabel(scaledX1, scaledY1 - 20, labelText, elementId, classPrefix, label ? label.color : null);
    } else if (prediction.type === "polygon" && prediction.polygon) {
        // Polygon-Daten extrahieren
        const { all_points_x, all_points_y } = prediction.polygon;
        
        if (!all_points_x || !all_points_y || all_points_x.length < 3) {
            console.warn("Ungültiges Polygon gefunden:", prediction);
            return;
        }
        
        // Skalierte Punkte für das SVG-Polygon
        const scaledPoints = [];
        for (let i = 0; i < all_points_x.length; i++) {
            scaledPoints.push(`${all_points_x[i] * scale},${all_points_y[i] * scale}`);
        }
        
        // SVG-Polygon erstellen
        const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        polygon.setAttribute("points", scaledPoints.join(" "));
        polygon.setAttribute("class", `polygon-annotation ${classPrefix}-annotation`);
        polygon.id = elementId;
        
        // Farbe direkt anwenden
        if (label && label.color) {
            polygon.style.fill = `${label.color}20`; // Mit 20% Opacity
            polygon.style.stroke = label.color;
        }
        
        annotationOverlay.appendChild(polygon);
        
        // Berechne den Schwerpunkt für das Label
        let centerX = 0, centerY = 0;
        for (let i = 0; i < all_points_x.length; i++) {
            centerX += all_points_x[i] * scale;
            centerY += all_points_y[i] * scale;
        }
        centerX /= all_points_x.length;
        centerY /= all_points_y.length;
        
        // Label am Schwerpunkt hinzufügen
        addLabel(centerX, centerY - 20, labelText, elementId, classPrefix, label ? label.color : null);
    } else if ((prediction.type === "line" && prediction.line) || (prediction.type === "line" && prediction.length !== undefined)) {
        // Spezieller Fall für Linien
        const { all_points_x, all_points_y } = prediction.line || { all_points_x: [], all_points_y: [] };
        
        if (!all_points_x || !all_points_y || all_points_x.length < 2) {
            console.warn("Ungültige Linie gefunden:", prediction);
            return;
        }
        
        // Get the line color (from prediction or use default orange)
        const lineColor = prediction.color || "#FF9500";
        
        // SVG-Linie erstellen als Pfad (path)
        const linePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        
        // Pfad erstellen (move to first point, then line to all other points)
        let pathData = `M ${all_points_x[0] * scale},${all_points_y[0] * scale}`;
        for (let i = 1; i < all_points_x.length; i++) {
            pathData += ` L ${all_points_x[i] * scale},${all_points_y[i] * scale}`;
        }
        
        linePath.setAttribute("d", pathData);
        linePath.setAttribute("class", "line-annotation");
        linePath.id = elementId;
        
        // Farbe direkt anwenden
        linePath.style.stroke = lineColor; // Use the color from the line object
        linePath.style.strokeWidth = "2px";
        linePath.style.fill = "none";
        
        annotationOverlay.appendChild(linePath);
        
        // Füge Punkte an den Eckpunkten hinzu
        for (let i = 0; i < all_points_x.length; i++) {
            const point = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            point.setAttribute("cx", all_points_x[i] * scale);
            point.setAttribute("cy", all_points_y[i] * scale);
            point.setAttribute("r", "4");
            point.setAttribute("fill", lineColor); // Use same color for points
            point.setAttribute("class", "line-point");
            annotationOverlay.appendChild(point);
        }
        
        // Label am Ende der Linie hinzufügen
        const lastX = all_points_x[all_points_x.length - 1] * scale;
        const lastY = all_points_y[all_points_y.length - 1] * scale;
        
        addLabel(lastX + 5, lastY - 5, labelText, elementId, "line", lineColor);
    }
}

// Funktion zum Hinzufügen eines Labels
// Replace the current addLabel function with this
function addLabel(x, y, text, parentId, classPrefix, color) {
    // Create an SVG text element instead of a div
    const label = document.createElementNS("http://www.w3.org/2000/svg", "g");
    label.id = `label-${parentId}`;
    label.setAttribute("class", `svg-label ${classPrefix}-label`);
    
    // Create a background rectangle
    const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    background.setAttribute("rx", "3"); // Rounded corners
    background.setAttribute("ry", "3");
    
    // Set the background color
    if (color) {
        background.setAttribute("fill", color);
    } else {
        // Default colors based on class prefix if no specific color
        switch(classPrefix) {
            case 'fenster': background.setAttribute("fill", "blue"); break;
            case 'tuer': background.setAttribute("fill", "red"); break;
            case 'wand': background.setAttribute("fill", "#d4d638"); break;
            case 'lukarne': background.setAttribute("fill", "orange"); break;
            case 'dach': background.setAttribute("fill", "purple"); break;
            case 'line': background.setAttribute("fill", "#FF9500"); break;
            default: background.setAttribute("fill", "gray");
        }
    }
    
    // Create the text element
    const textElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textElement.setAttribute("fill", "white");
    textElement.setAttribute("font-size", "12");
    textElement.setAttribute("x", "5"); // Padding within the background
    textElement.setAttribute("y", "14"); // Text baseline position
    
    // Special color for labels that need darker text
    if (classPrefix === 'wand') {
        textElement.setAttribute("fill", "#333");
    }
    
    // Set the text content
    textElement.textContent = text;
    
    // Add elements to the group
    label.appendChild(background);
    label.appendChild(textElement);
    
    // Position the group
    label.setAttribute("transform", `translate(${x}, ${y - 20})`);
    
    // Calculate background width based on text width (approximate for SVG)
    // We'll need to adjust this width after the text is added to the DOM
    
    // Add the label to the SVG overlay
    annotationOverlay.appendChild(label);
    
    // Now that the text is in the DOM, we can get its actual width
    const textWidth = textElement.getComputedTextLength();
    
    // Set the background width and height based on text dimensions
    background.setAttribute("width", textWidth + 10); // Text width plus padding
    background.setAttribute("height", "20");
    
    return label;
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
    
    // Calculate the current dimensions of the image, accounting for any scaling
    const currentWidth = uploadedImage.width;
    const currentHeight = uploadedImage.height;
    
    // SVG auf gleiche Größe wie das Bild setzen
    annotationOverlay.setAttribute('width', currentWidth);
    annotationOverlay.setAttribute('height', currentHeight);
    
    // Position exakt an Bild ausrichten
    const offsetX = imageRect.left - containerRect.left;
    const offsetY = imageRect.top - containerRect.top;
    
    annotationOverlay.style.position = 'absolute';
    annotationOverlay.style.left = `${offsetX}px`;
    annotationOverlay.style.top = `${offsetY}px`;
    
    // Wichtig: ViewBox setzen für bessere Skalierung
    annotationOverlay.setAttribute('viewBox', `0 0 ${currentWidth} ${currentHeight}`);
    annotationOverlay.style.width = `${currentWidth}px`;
    annotationOverlay.style.height = `${currentHeight}px`;
    
    // After setting position and size, reposition all annotations
    repositionAllAnnotations();
    
    // Make sure we also apply the current zoom level
    if (currentZoom !== 1.0) {
        uploadedImage.style.transform = `scale(${currentZoom})`;
        uploadedImage.style.transformOrigin = 'top left';
        
        annotationOverlay.style.transform = `scale(${currentZoom})`;
        annotationOverlay.style.transformOrigin = 'top left';
    }
}

// Global zoom variables
let currentZoom = 1.0;
const minZoom = 0.1;
const maxZoom = 10.0;
const zoomStep = 0.1;

// Function to handle zoom - improved to center on mouse position
// Modified handleZoom function to properly scale rectangular boxes
function handleZoom(event) {
    // Only handle zoom events when Ctrl key is pressed
    if (!event.ctrlKey) return;
    
    // Prevent default browser zoom behavior
    event.preventDefault();
    
    // Get the mouse position relative to the image container
    const rect = imageContainer.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    // Get the current scroll position
    const scrollLeft = imageContainer.scrollLeft;
    const scrollTop = imageContainer.scrollTop;
    
    // Calculate position within the scrolled content
    const mouseXInContent = mouseX + scrollLeft;
    const mouseYInContent = mouseY + scrollTop;
    
    // Determine zoom direction
    const delta = event.deltaY || event.detail || event.wheelDelta;
    const zoomIn = delta < 0;
    
    // Calculate new zoom level
    let newZoom = currentZoom;
    if (zoomIn) {
        newZoom = Math.min(currentZoom + zoomStep, maxZoom);
    } else {
        newZoom = Math.max(currentZoom - zoomStep, minZoom);
    }
    
    // Only proceed if zoom level changed
    if (newZoom === currentZoom) return;
    
    // Calculate the scale ratio
    const ratio = newZoom / currentZoom;
    currentZoom = newZoom;
    
    // Apply zoom to the image and SVG overlay
    uploadedImage.style.transform = `scale(${currentZoom})`;
    uploadedImage.style.transformOrigin = 'top left';
    
    // Also apply the same transform to the SVG overlay
    annotationOverlay.style.transform = `scale(${currentZoom})`;
    annotationOverlay.style.transformOrigin = 'top left';
    
    // Calculate new scroll position to keep the mouse point fixed
    const newScrollLeft = mouseXInContent * ratio - mouseX;
    const newScrollTop = mouseYInContent * ratio - mouseY;
    
    // Set the new scroll position
    imageContainer.scrollLeft = newScrollLeft;
    imageContainer.scrollTop = newScrollTop;
    
    // Update all bounding boxes and labels
    updateAnnotationsForZoom();
    
    // Display current zoom level
    showZoomLevel();
}

// Function to set zoom to a specific level
function setZoomLevel(level) {
    // Store old zoom for ratio calculation
    const oldZoom = currentZoom;
    currentZoom = level;
    
    // Get the center of the viewport
    const containerRect = imageContainer.getBoundingClientRect();
    const centerX = containerRect.width / 2;
    const centerY = containerRect.height / 2;
    
    // Get the current scroll position
    const scrollLeft = imageContainer.scrollLeft;
    const scrollTop = imageContainer.scrollTop;
    
    // Calculate position within the scrolled content
    const centerXInContent = centerX + scrollLeft;
    const centerYInContent = centerY + scrollTop;
    
    // Apply zoom to the image and SVG overlay
    uploadedImage.style.transform = `scale(${currentZoom})`;
    uploadedImage.style.transformOrigin = 'top left';
    
    annotationOverlay.style.transform = `scale(${currentZoom})`;
    annotationOverlay.style.transformOrigin = 'top left';
    
    // Calculate the scale ratio
    const ratio = currentZoom / oldZoom;
    
    // Calculate new scroll position to keep the center point fixed
    const newScrollLeft = centerXInContent * ratio - centerX;
    const newScrollTop = centerYInContent * ratio - centerY;
    
    // Set the new scroll position
    imageContainer.scrollLeft = newScrollLeft;
    imageContainer.scrollTop = newScrollTop;
    
    // Update all bounding boxes and labels
    updateAnnotationsForZoom();
    
    // Update the zoom button text
    resetZoomBtn.textContent = `${Math.round(currentZoom * 100)}%`;
    
    // Display current zoom level
    showZoomLevel();
}

// Add event listeners for zoom options in DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
    // Existing zoom event listeners...
    
    // Add event listeners for zoom preset options
    document.querySelectorAll('.zoom-option').forEach(option => {
        option.addEventListener('click', function() {
            const zoomLevel = parseFloat(this.dataset.zoom);
            setZoomLevel(zoomLevel);
        });
    });
    
    // Update the resetZoomBtn click handler to use the new function
    const resetZoomBtn = document.getElementById('resetZoomBtn');
    if (resetZoomBtn) {
        resetZoomBtn.addEventListener('click', function() {
            setZoomLevel(1.0); // Reset to 100%
        });
        
        // Update the zoom button text when zoom changes
        const originalShowZoomLevel = showZoomLevel;
        showZoomLevel = function() {
            originalShowZoomLevel();
            resetZoomBtn.textContent = `${Math.round(currentZoom * 100)}%`;
        };
    }
});

// Function to update annotation positions after zooming
function updateAnnotationsForZoom() {
    console.log("Updating annotations for zoom level:", currentZoom);
    
    // SVG elements don't need position updates
    // because they'll be transformed with the parent SVG element
    
    // For SVG label text elements, we DON'T want to counteract the zoom
    // Instead, let the text scale naturally with the zoom
    document.querySelectorAll('g.svg-label').forEach(labelGroup => {
        // Get the text and rectangle elements
        const textElement = labelGroup.querySelector('text');
        const rect = labelGroup.querySelector('rect');
        
        if (textElement && rect) {
            // Calculate the width of the text at current zoom level
            // We need to make sure the background rectangle scales appropriately
            const textWidth = textElement.getComputedTextLength();
            
            // Update the rectangle width to match the text
            rect.setAttribute('width', textWidth + 10);
        }
    });
    
    // If there are still any old HTML/DOM labels (during transition period),
    // we handle them the old way but WITHOUT inverse scaling
    document.querySelectorAll('.box-label:not(.svg-label)').forEach(label => {
        // Store original values if not already stored
        if (!label.hasAttribute('data-original-left')) {
            label.setAttribute('data-original-left', label.style.left.replace('px', ''));
            label.setAttribute('data-original-top', label.style.top.replace('px', ''));
        }
        
        // Get original positions
        const originalLeft = parseFloat(label.getAttribute('data-original-left'));
        const originalTop = parseFloat(label.getAttribute('data-original-top'));
        
        // Scale positions with current zoom level
        const newLeft = originalLeft * currentZoom;
        const newTop = originalTop * currentZoom;
        
        // Apply the new positions
        label.style.left = `${newLeft}px`;
        label.style.top = `${newTop}px`;
        
        // Remove any previous font size and padding adjustments
        // so the text can scale naturally with zoom
        label.style.removeProperty('font-size');
        label.style.removeProperty('padding');
    });
}


// Function to display current zoom level
function showZoomLevel() {
    // Create or update zoom indicator
    let zoomIndicator = document.getElementById('zoomIndicator');
    
    if (!zoomIndicator) {
        zoomIndicator = document.createElement('div');
        zoomIndicator.id = 'zoomIndicator';
        zoomIndicator.style.position = 'fixed';
        zoomIndicator.style.bottom = '20px';
        zoomIndicator.style.right = '20px';
        zoomIndicator.style.padding = '8px 12px';
        zoomIndicator.style.background = 'rgba(0, 0, 0, 0.7)';
        zoomIndicator.style.color = 'white';
        zoomIndicator.style.borderRadius = '4px';
        zoomIndicator.style.fontSize = '14px';
        zoomIndicator.style.zIndex = '1000';
        zoomIndicator.style.transition = 'opacity 1s';
        document.body.appendChild(zoomIndicator);
    }
    
    // Update the text
    zoomIndicator.textContent = `Zoom: ${Math.round(currentZoom * 100)}%`;
    zoomIndicator.style.opacity = '1';
    
    // Hide the indicator after a delay
    clearTimeout(zoomIndicator.timeout);
    zoomIndicator.timeout = setTimeout(() => {
        zoomIndicator.style.opacity = '0';
    }, 2000);
}

// Reset zoom function
function resetZoom() {
    console.log("Resetting zoom from:", currentZoom, "to 1.0");

    currentZoom = 1.0;
    uploadedImage.style.transform = '';
    annotationOverlay.style.transform = '';
    
    // Reset all stored original positions
    document.querySelectorAll('[data-original-left]').forEach(el => {
        el.removeAttribute('data-original-left');
        el.removeAttribute('data-original-top');
        if (el.hasAttribute('data-original-width')) {
            el.removeAttribute('data-original-width');
            el.removeAttribute('data-original-height');
        }
    });
    
    showZoomLevel();
}

// Make sure to set up zoom event handlers after DOM is loaded
function setupZoomEventListeners() {
    console.log("Setting up zoom event listeners");
    
    // Remove existing listeners first to avoid duplicates
    imageContainer.removeEventListener('wheel', handleZoom);
    
    // Add the wheel event listener with the correct options
    imageContainer.addEventListener('wheel', handleZoom, { passive: false });
    console.log("Wheel event listener added to imageContainer");
}

// Function to receive editor state updates
window.updateEditorState = function(isActive) {
    console.log("Editor state updated:", isActive);
    isEditorActive = isActive;
};

// Call this function after DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Wait a bit to ensure imageContainer is fully loaded
    setTimeout(setupZoomEventListeners, 500);
    
    // Debug output to check if isEditorActive is accessible
    console.log("DOM loaded, isEditorActive accessible:", typeof window.isEditorActive !== 'undefined');
    
    // Add double-click event listener to reset zoom
    imageContainer.addEventListener('dblclick', function(event) {
        console.log("Double-click detected");
        // Check if editor is active using the existing variable
        const editorActive = typeof window.isEditorActive !== 'undefined' ? window.isEditorActive : false;
        console.log("Editor active state:", editorActive);
        
        // Only reset zoom on double click if editor is not active
        if (!editorActive) {
            resetZoom();
        }
    });
});

// Also set it up when image is loaded
if (uploadedImage) {
    uploadedImage.addEventListener('load', function() {
        console.log("Image loaded, setting up zoom listeners");
        setupZoomEventListeners();
    });
}


// Modify the adaptSvgOverlay function to work with zoom
const originalAdaptSvgOverlay = adaptSvgOverlay;
adaptSvgOverlay = function() {
    // Call the original function first
    originalAdaptSvgOverlay();
    
    // Then apply current zoom if not at 1.0
    if (currentZoom !== 1.0) {
        uploadedImage.style.transform = `scale(${currentZoom})`;
        uploadedImage.style.transformOrigin = 'top left';
        
        annotationOverlay.style.transform = `scale(${currentZoom})`;
        annotationOverlay.style.transformOrigin = 'top left';
    }
};

// Alle Annotationen neu positionieren
function repositionAllAnnotations() {
    console.log("Repositioning annotations, zoom level:", currentZoom);

    // Berechne Skalierungsfaktoren
    const scaleX = uploadedImage.width / uploadedImage.naturalWidth;
    const scaleY = uploadedImage.height / uploadedImage.naturalHeight;
    
    // Erhalte tatsächliche Position des Bildes
    const imageRect = uploadedImage.getBoundingClientRect();
    const containerRect = imageContainer.getBoundingClientRect();
    
    // Berechne Offset
    const offsetX = imageRect.left - containerRect.left;
    const offsetY = imageRect.top - containerRect.top;
    
    console.log("Skalierung:", scaleX, scaleY, "Offset:", offsetX, offsetY);
    
    // 2. SVG-Elemente neu positionieren
    // Anstatt die einzelnen Elemente zu verschieben, passen wir das SVG-Overlay an
    annotationOverlay.style.left = `${offsetX}px`;
    annotationOverlay.style.top = `${offsetY}px`;

    // 2a. Rechtecke neu skalieren
    document.querySelectorAll('rect.rect-annotation').forEach(rect => {
        const id = rect.id;
        const index = parseInt(id.split('-')[1]);
        if (window.data && window.data.predictions && window.data.predictions[index]) {
            const pred = window.data.predictions[index];
            if (pred.box || pred.bbox) {
                const [x1, y1, x2, y2] = pred.box || pred.bbox;
                rect.setAttribute("x", x1 * scaleX);
                rect.setAttribute("y", y1 * scaleY);
                rect.setAttribute("width", (x2 - x1) * scaleX);
                rect.setAttribute("height", (y2 - y1) * scaleY);
            }
        }
    });

    
    // 2b. Polygone neu skalieren
    document.querySelectorAll('polygon.polygon-annotation').forEach(polygon => {
        const id = polygon.id;
        const index = parseInt(id.split('-')[1]);
        if (window.data && window.data.predictions && window.data.predictions[index]) {
            const pred = window.data.predictions[index];
            if (pred.polygon) {
                const { all_points_x, all_points_y } = pred.polygon;
                const scaledPoints = [];
                for (let i = 0; i < all_points_x.length; i++) {
                    const x = all_points_x[i] * scaleX;
                    const y = all_points_y[i] * scaleY;
                    scaledPoints.push(`${x},${y}`);
                }
                polygon.setAttribute("points", scaledPoints.join(" "));
            }
        }
    });
    
    // 2c. Linien neu skalieren
    document.querySelectorAll('path.line-annotation').forEach(path => {
        const id = path.id;
        const index = parseInt(id.split('-')[1]);
        if (window.data && window.data.predictions && window.data.predictions[index]) {
            const pred = window.data.predictions[index];
            if (pred.line) {
                const { all_points_x, all_points_y } = pred.line;
                
                // Pfad neu erstellen
                let pathData = `M ${all_points_x[0] * scaleX},${all_points_y[0] * scaleY}`;
                for (let i = 1; i < all_points_x.length; i++) {
                    pathData += ` L ${all_points_x[i] * scaleX},${all_points_y[i] * scaleY}`;
                }
                
                path.setAttribute("d", pathData);
            }
        }
    });
    
    // 2d. Linienpunkte neu skalieren
    document.querySelectorAll('circle.line-point').forEach(circle => {
        // Wir müssen die Zugehörigkeit zu einer Linie ermitteln
        const parentNodes = Array.from(annotationOverlay.children);
        const lineIndex = parentNodes.findIndex(node => 
            node.tagName.toLowerCase() === 'path' && 
            node.classList.contains('line-annotation'));
        
        if (lineIndex >= 0) {
            const lineId = parentNodes[lineIndex].id;
            const dataIndex = parseInt(lineId.split('-')[1]);
            const pred = window.data.predictions[dataIndex];
            
            if (pred && pred.line) {
                const { all_points_x, all_points_y } = pred.line;
                const circleIndex = Array.from(annotationOverlay.querySelectorAll('circle.line-point')).indexOf(circle);
                
                if (circleIndex < all_points_x.length) {
                    circle.setAttribute("cx", all_points_x[circleIndex] * scaleX);
                    circle.setAttribute("cy", all_points_y[circleIndex] * scaleY);
                    circle.setAttribute("r", "4");
                }
            }
        }
    });

    // 3. Alle Labels neu positionieren
    document.querySelectorAll('g.svg-label').forEach(label => {
        const id = label.id.replace('label-', '');
        const index = parseInt(id.split('-')[1]);
        
        if (window.data && window.data.predictions && window.data.predictions[index]) {
            const pred = window.data.predictions[index];
            
            // Get the current transform to extract the translation components
            const transform = label.getAttribute('transform');
            
            if (pred.box || pred.bbox) {
                // For rectangle labels
                const [x1, y1] = pred.box || pred.bbox;
                const newX = x1 * scaleX;
                const newY = y1 * scaleY - 20; // Adjust for label height
                
                label.setAttribute("transform", `translate(${newX}, ${newY})`);
            } 
            else if (pred.polygon && pred.polygon.all_points_x && pred.polygon.all_points_y) {
                // For polygon labels - calculate centroid
                const { all_points_x, all_points_y } = pred.polygon;
                let centerX = 0, centerY = 0;
                
                for (let i = 0; i < all_points_x.length; i++) {
                    centerX += all_points_x[i];
                    centerY += all_points_y[i];
                }
                
                centerX = (centerX / all_points_x.length) * scaleX;
                centerY = (centerY / all_points_y.length) * scaleY - 20;
                
                label.setAttribute("transform", `translate(${centerX}, ${centerY})`);
            }
            else if (pred.type === "line" && pred.line) {
                // For line labels - position at the end point
                const { all_points_x, all_points_y } = pred.line;
                
                if (all_points_x && all_points_y && all_points_x.length > 0) {
                    const lastX = all_points_x[all_points_x.length - 1] * scaleX;
                    const lastY = all_points_y[all_points_y.length - 1] * scaleY - 5;
                    
                    label.setAttribute("transform", `translate(${lastX + 5}, ${lastY})`);
                }
            }
        }
    });
}

// Event-Listener für Bildgrößenänderungen
window.addEventListener('resize', function() {
    if (uploadedImage.src) {
        // When the window is resized, reset the SVG overlay
        console.log("Window resize detected - updating SVG overlay");
        adaptSvgOverlay();
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

// Add this to your DOMContentLoaded event handler in main.js
const resetZoomBtn = document.getElementById('resetZoomBtn');
if (resetZoomBtn) {
    resetZoomBtn.addEventListener('click', resetZoom);
    
    // Update the zoom button text when zoom changes
    const originalShowZoomLevel = showZoomLevel;
    showZoomLevel = function() {
        originalShowZoomLevel();
        resetZoomBtn.textContent = `${Math.round(currentZoom * 100)}%`;
    };
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
            .then(response => {
                // Prüfen, ob die Antwort ein JSON ist
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    return response.json();
                } else {
                    // Wenn keine JSON-Antwort, Text extrahieren für Fehlermeldung
                    return response.text().then(text => {
                        throw new Error(`Server hat keine gültige JSON-Antwort gesendet. Antwort: ${text.substring(0, 100)}...`);
                    });
                }
            })
            .then(data => {
                if (data.success) {
                    exportStatus.textContent = 'PDF-Bericht wurde erfolgreich erstellt!';
                    exportStatus.style.backgroundColor = '#4CAF50';
                    
                    // Öffne das PDF in einem neuen Tab
                    window.open(data.pdf_url, '_blank');
                } else {
                    exportStatus.textContent = `Fehler: ${data.error}`;
                    exportStatus.style.backgroundColor = '#f44336';
                    console.error("PDF-Export-Fehler:", data.error);
                }
                
                // Status nach 3 Sekunden ausblenden
                setTimeout(() => {
                    exportStatus.style.opacity = '0';
                    setTimeout(() => exportStatus.remove(), 500);
                }, 3000);
            })
            .catch(error => {
                console.error("PDF-Export-Fehler:", error);
                exportStatus.textContent = `Fehler: ${error.message}`;
                exportStatus.style.backgroundColor = '#f44336';
                
                // Status nach 5 Sekunden ausblenden
                setTimeout(() => {
                    exportStatus.style.opacity = '0';
                    setTimeout(() => exportStatus.remove(), 500);
                }, 5000);
            });
    });
}

// Verbesserter Event-Listener für den exportAnnotatedPdfBtn
const exportAnnotatedPdfBtn = document.getElementById('exportAnnotatedPdfBtn');
if (exportAnnotatedPdfBtn) {
    exportAnnotatedPdfBtn.addEventListener('click', function() {
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
        exportStatus.textContent = 'Erstelle annotierte Original-PDF...';
        document.body.appendChild(exportStatus);
        
        // PDF-Export-Anfrage senden
        fetch(`/export_annotated_pdf/${pdfSessionId}`)
            .then(response => {
                // Prüfen, ob die Antwort ein JSON ist
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    return response.json();
                } else {
                    // Wenn keine JSON-Antwort, Text extrahieren für Fehlermeldung
                    return response.text().then(text => {
                        throw new Error(`Server hat keine gültige JSON-Antwort gesendet. Antwort: ${text.substring(0, 100)}...`);
                    });
                }
            })
            .then(data => {
                if (data.success) {
                    exportStatus.textContent = 'Annotierte Original-PDF wurde erfolgreich erstellt!';
                    exportStatus.style.backgroundColor = '#4CAF50';
                    
                    // Öffne das PDF in einem neuen Tab
                    window.open(data.pdf_url, '_blank');
                } else {
                    exportStatus.textContent = `Fehler: ${data.error}`;
                    exportStatus.style.backgroundColor = '#f44336';
                    console.error("PDF-Export-Fehler:", data.error);
                }
                
                // Status nach 3 Sekunden ausblenden
                setTimeout(() => {
                    exportStatus.style.opacity = '0';
                    setTimeout(() => exportStatus.remove(), 500);
                }, 3000);
            })
            .catch(error => {
                console.error("PDF-Export-Fehler:", error);
                exportStatus.textContent = `Fehler: ${error.message}`;
                exportStatus.style.backgroundColor = '#f44336';
                
                // Status nach 5 Sekunden ausblenden
                setTimeout(() => {
                    exportStatus.style.opacity = '0';
                    setTimeout(() => exportStatus.remove(), 500);
                }, 5000);
            });
    });
}


// Modal-Elements
const labelManagerModal = document.getElementById('labelManagerModal');
const manageLabelBtn = document.getElementById('manageLabelBtn');
const closeModalBtn = labelManagerModal.querySelector('.close');
const labelTableBody = document.getElementById('labelTableBody');
const addLabelBtn = document.getElementById('addLabelBtn');
const importLabelsBtn = document.getElementById('importLabelsBtn');
const exportLabelsBtn = document.getElementById('exportLabelsBtn');
const resetLabelsBtn = document.getElementById('resetLabelsBtn');

// Formular-Elemente
const labelForm = document.getElementById('labelForm');
const labelFormTitle = document.getElementById('labelFormTitle');
const labelIdInput = document.getElementById('labelId');
const labelNameInput = document.getElementById('labelName');
const labelColorInput = document.getElementById('labelColor');
const saveLabelBtn = document.getElementById('saveLabelBtn');
const cancelLabelBtn = document.getElementById('cancelLabelBtn');

// Event-Listener für Modal öffnen/schließen
manageLabelBtn.addEventListener('click', openLabelManager);
closeModalBtn.addEventListener('click', closeLabelManager);
window.addEventListener('click', function(event) {
    if (event.target === labelManagerModal) {
        closeLabelManager();
    }
});

// Event-Listener für Buttons
addLabelBtn.addEventListener('click', showAddLabelForm);
importLabelsBtn.addEventListener('click', importLabels);
exportLabelsBtn.addEventListener('click', exportLabels);
resetLabelsBtn.addEventListener('click', resetLabels);
saveLabelBtn.addEventListener('click', saveLabel);
cancelLabelBtn.addEventListener('click', hideForm);

// Label-Manager öffnen
function openLabelManager() {
    refreshLabelTable('area');  // Start with area labels by default
    labelManagerModal.style.display = 'block';
}

// Label-Manager schließen
function closeLabelManager() {
    labelManagerModal.style.display = 'none';
    hideForm();
}

// Tab-switching for label manager
const areaLabelsTab = document.getElementById('areaLabelsTab');
const lineLabelsTab = document.getElementById('lineLabelsTab');

if (areaLabelsTab) {
    areaLabelsTab.addEventListener('click', function() {
        this.classList.add('active');
        lineLabelsTab.classList.remove('active');
        refreshLabelTable('area');
    });
}

if (lineLabelsTab) {
    lineLabelsTab.addEventListener('click', function() {
        this.classList.add('active');
        areaLabelsTab.classList.remove('active');
        refreshLabelTable('line');
    });
}

// Updated refreshLabelTable function to handle both label types
function refreshLabelTable(type = 'area') {
    labelTableBody.innerHTML = '';
    
    // Determine which labels to display
    const labels = type === 'area' ? currentLabels : currentLineLabels;
    
    labels.forEach(label => {
        const row = document.createElement('tr');
        
        row.innerHTML = `
            <td>${label.id}</td>
            <td>
                <span class="color-preview" style="background-color:${label.color}"></span>
                ${label.name}
            </td>
            <td>${label.color}</td>
            <td>
                <button class="edit-label-btn" data-id="${label.id}" data-type="${type}">Bearbeiten</button>
                <button class="delete-label-btn" data-id="${label.id}" data-type="${type}">Löschen</button>
            </td>
        `;
        
        labelTableBody.appendChild(row);
    });
    
    // Event-Listener für Edit- und Delete-Buttons
    document.querySelectorAll('.edit-label-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const labelId = parseInt(this.dataset.id);
            const labelType = this.dataset.type;
            editLabel(labelId, labelType);
        });
    });
    
    document.querySelectorAll('.delete-label-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const labelId = parseInt(this.dataset.id);
            const labelType = this.dataset.type;
            deleteLabel(labelId, labelType);
        });
    });
}

// Formular zum Hinzufügen anzeigen
function showAddLabelForm() {
    // Get the active tab to determine label type
    const activeTab = document.querySelector('.label-tab.active');
    const labelType = activeTab.id === 'lineLabelsTab' ? 'line' : 'area';
    
    labelFormTitle.textContent = 'Label hinzufügen';
    labelIdInput.value = '';
    labelNameInput.value = '';
    labelColorInput.value = '#' + Math.floor(Math.random()*16777215).toString(16); // Zufällige Farbe
    // Store the label type in the form's dataset
    labelForm.dataset.type = labelType;
    labelForm.style.display = 'block';
}

// Formular zum Bearbeiten anzeigen
function editLabel(labelId, labelType = 'area') {
    const labels = labelType === 'area' ? currentLabels : currentLineLabels;
    const label = labels.find(l => l.id === labelId);
    if (!label) return;
    
    labelFormTitle.textContent = 'Label bearbeiten';
    labelIdInput.value = label.id;
    labelNameInput.value = label.name;
    labelColorInput.value = label.color;
    // Store the label type
    labelForm.dataset.type = labelType;
    labelForm.style.display = 'block';
}

// Label löschen
function deleteLabel(labelId, labelType = 'area') {
    const labels = labelType === 'area' ? currentLabels : currentLineLabels;
    
    if (labels.length <= 1) {
        alert('Es muss mindestens ein Label vorhanden sein.');
        return;
    }
    
    if (confirm('Möchten Sie dieses Label wirklich löschen?')) {
        if (labelType === 'area') {
            currentLabels = currentLabels.filter(label => label.id !== labelId);
        } else {
            currentLineLabels = currentLineLabels.filter(label => label.id !== labelId);
        }
        saveLabels(labelType);
        refreshLabelTable(labelType);
    }
}

// Label speichern
function saveLabel() {
    const name = labelNameInput.value.trim();
    const color = labelColorInput.value;
    // Get the label type from the form's dataset
    const labelType = labelForm.dataset.type || 'area';
    
    if (!name) {
        alert('Bitte geben Sie einen Namen ein.');
        return;
    }
    
    const labelId = labelIdInput.value ? parseInt(labelIdInput.value) : null;
    
    // Determine which label array to modify based on type
    if (labelType === 'area') {
        if (labelId) {
            // Edit existing area label
            const index = currentLabels.findIndex(l => l.id === labelId);
            if (index !== -1) {
                currentLabels[index].name = name;
                currentLabels[index].color = color;
            }
        } else {
            // Add new area label
            const maxId = currentLabels.reduce((max, label) => Math.max(max, label.id), 0);
            currentLabels.push({
                id: maxId + 1,
                name: name,
                color: color
            });
        }
    } else {
        // Line labels
        if (labelId) {
            // Edit existing line label
            const index = currentLineLabels.findIndex(l => l.id === labelId);
            if (index !== -1) {
                currentLineLabels[index].name = name;
                currentLineLabels[index].color = color;
            }
        } else {
            // Add new line label
            const maxId = currentLineLabels.reduce((max, label) => Math.max(max, label.id), 0);
            currentLineLabels.push({
                id: maxId + 1,
                name: name,
                color: color
            });
        }
    }
    
    // Save only the type of labels that was modified
    saveLabels(labelType);
    refreshLabelTable(labelType);
    hideForm();
}


// Formular ausblenden
function hideForm() {
    labelForm.style.display = 'none';
}

// Labels speichern
function saveLabels(type = 'area') {
    if (type === 'area' || type === 'both') {
        localStorage.setItem('labels', JSON.stringify(currentLabels));
        window.currentLabels = currentLabels;
    }
    
    if (type === 'line' || type === 'both') {
        localStorage.setItem('lineLabels', JSON.stringify(currentLineLabels));
        window.currentLineLabels = currentLineLabels;
    }
    
    updateUIForLabels(type);
    
    // Falls ein Projekt geladen ist, speichere die Änderungen auch dort
    if (pdfSessionId && pdfSessionId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        // Projekt speichern mit aktuellen Labels
        saveProject();
    }
}

// Labels importieren
function importLabels() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importedLabels = JSON.parse(e.target.result);
                
                // Validieren
                if (!Array.isArray(importedLabels) || !importedLabels.every(l => l.id && l.name && l.color)) {
                    throw new Error('Ungültiges Label-Format');
                }
                
                currentLabels = importedLabels;
                saveLabels();
                refreshLabelTable();
                
                alert('Labels erfolgreich importiert!');
            } catch (error) {
                alert('Fehler beim Importieren der Labels: ' + error.message);
            }
        };
        
        reader.readAsText(file);
    });
    
    input.click();
}

// Labels exportieren
function exportLabels() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentLabels, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "fenster_labels.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

// Labels zurücksetzen
function resetLabels() {
    if (confirm('Möchten Sie wirklich alle Labels auf die Standardwerte zurücksetzen?')) {
        currentLabels = [...defaultLabels];
        saveLabels();
        refreshLabelTable();
    }
}

// UI aktualisieren basierend auf Labels
function updateUIForLabels(type = 'both') {
    // Update legend for area labels
    if (type === 'area' || type === 'both') {
        const legend = document.querySelector('.legend');
        if (legend) {
            legend.innerHTML = '';
            
            currentLabels.forEach(label => {
                const legendItem = document.createElement('div');
                legendItem.className = 'legend-item';
                legendItem.innerHTML = `
                    <div class="legend-color" style="background-color:${label.color}"></div>
                    <span>${label.name} (${label.id})</span>
                `;
                legend.appendChild(legendItem);
            });
        }
        
        // Aktualisiere Objekttyp-Auswahl im Editor
        const objectTypeSelect = document.getElementById('objectTypeSelect');
        if (objectTypeSelect) {
            // Aktuelle Auswahl merken
            const selectedValue = objectTypeSelect.value;
            
            // Optionen neu erstellen
            objectTypeSelect.innerHTML = '';
            
            // Option für "Andere" (0)
            const otherOption = document.createElement('option');
            otherOption.value = '0';
            otherOption.textContent = 'Andere';
            objectTypeSelect.appendChild(otherOption);
            
            // Optionen für benutzerdefinierte Labels
            currentLabels.forEach(label => {
                const option = document.createElement('option');
                option.value = label.id;
                option.textContent = label.name;
                objectTypeSelect.appendChild(option);
            });
            
            // Vorherige Auswahl wiederherstellen, wenn möglich
            if (selectedValue && objectTypeSelect.querySelector(`option[value="${selectedValue}"]`)) {
                objectTypeSelect.value = selectedValue;
            }
        }
    }
    
    // Update line type dropdown for line labels
    if (type === 'line' || type === 'both') {
        const lineTypeSelect = document.getElementById('lineTypeSelect');
        if (lineTypeSelect) {
            // Aktuelle Auswahl merken
            const selectedLineValue = lineTypeSelect.value;
            
            // Optionen neu erstellen
            lineTypeSelect.innerHTML = '';
            
            // Optionen für Line-Labels
            currentLineLabels.forEach(label => {
                const option = document.createElement('option');
                option.value = label.id;
                option.textContent = label.name;
                lineTypeSelect.appendChild(option);
            });
            
            // Vorherige Auswahl wiederherstellen, wenn möglich
            if (selectedLineValue && lineTypeSelect.querySelector(`option[value="${selectedLineValue}"]`)) {
                lineTypeSelect.value = selectedLineValue;
            }
        }
    }
}

// Initial UI aktualisieren, wenn die Seite geladen ist
updateUIForLabels();


});