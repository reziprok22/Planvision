/**
 * zoom-manager.js - Konsolidiertes Modul für alle Zoom-Funktionalitäten
 * Ersetzt die bisherigen Zoom-Funktionen in zoom.js und fabric-handler.js
 */

// Modul-Zustand
let currentZoom = 1.0;
const minZoom = 0.1;
const maxZoom = 5.0;
const zoomStep = 0.25;

// DOM-Referenzen
let imageContainer;
let uploadedImage;
let resetZoomBtn;
let canvas; // Fabric.js Canvas

// Event-Handler-Referenzen
let wheelEventHandler;

/**
 * Initialisiert das Zoom-Manager-Modul
 * @param {Object} elements - Notwendige DOM-Elemente
 * @param {Object} options - Optionale Konfigurationsparameter
 */
export function init(elements, options = {}) {
  // DOM-Referenzen speichern
  imageContainer = elements.imageContainer;
  uploadedImage = elements.uploadedImage;
  resetZoomBtn = elements.resetZoomBtn;
  
  // Optionale Fabric.js-Canvas
  if (options.canvas) {
    setCanvas(options.canvas);
  }
  
  // Initialen Zoom setzen
  currentZoom = options.initialZoom || 1.0;
  
  // Event-Listener einrichten
  setupEventListeners();
  
  console.log('Zoom-Manager initialisiert');
  
  // Globale Export-Funktionen
  window.setZoomLevel = setZoomLevel;
  window.resetZoom = resetZoom;
  window.getCurrentZoom = getCurrentZoom;
}

/**
 * Setzt den Fabric.js-Canvas
 * @param {fabric.Canvas} fabricCanvas - Der zu verwendende Canvas
 */
export function setCanvas(fabricCanvas) {
  canvas = fabricCanvas;
  console.log('Canvas im Zoom-Manager gesetzt');
}

/**
 * Richtet alle Event-Listener ein
 */
function setupEventListeners() {
  if (!imageContainer) return;
  
  // Mausrad-Zoom
  wheelEventHandler = handleWheelZoom.bind(this);
  imageContainer.addEventListener('wheel', wheelEventHandler, { passive: false });
  
  // Doppelklick für Reset-Zoom (nur im Ansichts-Modus)
  imageContainer.addEventListener('dblclick', function(e) {
    if (!window.isEditorActive) {
      resetZoom();
    }
  });
  
  // Zoom-Options-Buttons
  document.querySelectorAll('.zoom-option').forEach(option => {
    option.addEventListener('click', function(e) {
      const zoomLevel = parseFloat(this.dataset.zoom);
      setZoomLevel(zoomLevel);
      e.stopPropagation();
    });
  });
  
  // Reset-Zoom-Button
  if (resetZoomBtn) {
    resetZoomBtn.addEventListener('click', function() {
      resetZoom();
    });
  }
  
  console.log('Zoom-Event-Listener eingerichtet');
}

/**
 * Behandelt Mausrad-Zoom-Events
 * @param {WheelEvent} event - Das Wheel-Event
 */
function handleWheelZoom(event) {
  // Nur bei gedrückter Strg-Taste zoomen
  if (!event.ctrlKey) return;
  
  // Standardverhalten verhindern
  event.preventDefault();
  
  // Mausposition im Container ermitteln
  const rect = imageContainer.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  
  // Aktuelle Scroll-Position
  const scrollLeft = imageContainer.scrollLeft;
  const scrollTop = imageContainer.scrollTop;
  
  // Position im gescrollten Inhalt
  const mouseXInContent = mouseX + scrollLeft;
  const mouseYInContent = mouseY + scrollTop;
  
  // Zoom-Richtung und neuen Zoom berechnen
  const delta = event.deltaY;
  let newZoom = currentZoom;
  
  if (delta < 0) {
    // Reinzoomen
    newZoom = Math.min(currentZoom + zoomStep, maxZoom);
  } else {
    // Rauszoomen
    newZoom = Math.max(currentZoom - zoomStep, minZoom);
  }
  
  // Wenn sich der Zoom nicht ändert, keine Aktion
  if (newZoom === currentZoom) return;
  
  // Zu Mausposition zoomen
  zoomToPoint(mouseXInContent, mouseYInContent, newZoom);
}

/**
 * Zentralisierte Zoom-Funktion
 * @param {number} x - X-Koordinate des Zoom-Zentrums
 * @param {number} y - Y-Koordinate des Zoom-Zentrums
 * @param {number} zoom - Neuer Zoom-Faktor
 */
function zoomToPoint(x, y, zoom) {
  // Alten Zoom speichern für Verhältnisberechnung
  const oldZoom = currentZoom;
  
  // Neuen Zoom setzen
  currentZoom = zoom;
  
  // Verhältnis zwischen altem und neuem Zoom
  const ratio = zoom / oldZoom;
  
  // 1. Immer das Bild zoomen
  uploadedImage.style.transform = `scale(${zoom})`;
  uploadedImage.style.transformOrigin = 'top left';
  
  // 2. Scroll-Position anpassen für Zoom zum Punkt
  imageContainer.scrollLeft = x * ratio - (x - imageContainer.scrollLeft);
  imageContainer.scrollTop = y * ratio - (y - imageContainer.scrollTop);
  
  // 3. Wenn Fabric.js Canvas vorhanden ist, auch diesen zoomen
  if (canvas) {
    canvas.setZoom(zoom);
    
    // Canvas-Container anpassen - rufe die Fabric-Handler Funktion auf
    if (window.FabricHandler && typeof window.FabricHandler.updateCanvasContainer === 'function') {
      window.FabricHandler.updateCanvasContainer();
    } else {
      updateCanvasContainer();
    }
  }
  
  // 4. UI aktualisieren
  updateZoomUI();
  
  // 5. Event auslösen, damit andere Module informiert werden
  const zoomEvent = new CustomEvent('zoomchanged', { 
    detail: { zoom: zoom, center: { x, y } } 
  });
  document.dispatchEvent(zoomEvent);
}

/**
 * Aktualisiert den Canvas-Container basierend auf dem aktuellen Zoom
 */
function updateCanvasContainer() {
  if (!canvas) return;
  
  // Canvas-Container finden
  const canvasContainer = document.getElementsByClassName('canvas-container')[0];
  if (!canvasContainer) return;
  
  // Position des Bildes relativ zum Container
  const imageRect = uploadedImage.getBoundingClientRect();
  const containerRect = imageContainer.getBoundingClientRect();
  
  // Scroll-Offsets berücksichtigen
  const scrollLeft = imageContainer.scrollLeft;
  const scrollTop = imageContainer.scrollTop;
  
  // Exakte Position berechnen (keine negativen Werte)
  const relLeft = Math.max(0, imageRect.left - containerRect.left + scrollLeft);
  const relTop = Math.max(0, imageRect.top - containerRect.top + scrollTop);
  
  // Canvas-Container positionieren und dimensionieren
  canvasContainer.style.position = 'absolute';
  canvasContainer.style.top = `${relTop}px`;
  canvasContainer.style.left = `${relLeft}px`;
  canvasContainer.style.width = `${imageRect.width}px`;
  canvasContainer.style.height = `${imageRect.height}px`;
  canvasContainer.style.zIndex = '10';
}

/**
 * Aktualisiert alle Zoom-bezogenen UI-Elemente
 */
function updateZoomUI() {
  // Zoom-Prozent berechnen
  const zoomPercent = Math.round(currentZoom * 100);
  
  // Zoom-Button-Text aktualisieren
  if (resetZoomBtn) {
    resetZoomBtn.textContent = `${zoomPercent}%`;
  }
  
  // Editor-Zoom-Button aktualisieren
  const editorZoomBtn = document.getElementById('editorResetZoomBtn');
  if (editorZoomBtn) {
    editorZoomBtn.textContent = `${zoomPercent}%`;
  }
  
  // Zoom-Indikator anzeigen
  showZoomIndicator();
}

/**
 * Zeigt einen temporären Zoom-Indikator an
 */
function showZoomIndicator() {
  // Zoom-Indikator erstellen oder aktualisieren
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
  
  // Text aktualisieren
  zoomIndicator.textContent = `Zoom: ${Math.round(currentZoom * 100)}%`;
  zoomIndicator.style.opacity = '1';
  
  // Nach Verzögerung ausblenden
  clearTimeout(zoomIndicator.timeout);
  zoomIndicator.timeout = setTimeout(() => {
    zoomIndicator.style.opacity = '0';
  }, 2000);
}

/**
 * Setzt den Zoom auf einen bestimmten Wert
 * @param {number} zoom - Der neue Zoom-Faktor
 * @param {boolean} silent - Bei true wird kein Event ausgelöst (optional)
 */
export function setZoomLevel(zoom, silent = false) {
  // Zoom-Grenzen einhalten
  zoom = Math.max(minZoom, Math.min(maxZoom, zoom));
  
  // Wenn sich der Zoom nicht ändert, nichts tun
  if (zoom === currentZoom) return;
  
  // Mitte des sichtbaren Bereichs berechnen
  const containerRect = imageContainer.getBoundingClientRect();
  const centerX = containerRect.width / 2;
  const centerY = containerRect.height / 2;
  
  // Scroll-Position berücksichtigen
  const centerXInContent = centerX + imageContainer.scrollLeft;
  const centerYInContent = centerY + imageContainer.scrollTop;
  
  // Zu diesem Punkt zoomen
  zoomToPoint(centerXInContent, centerYInContent, zoom);
}

/**
 * Setzt den Zoom zurück auf 100%
 */
export function resetZoom() {
  setZoomLevel(1.0);
}

/**
 * Gibt den aktuellen Zoom-Faktor zurück
 * @returns {number} Der aktuelle Zoom-Faktor
 */
export function getCurrentZoom() {
  return currentZoom;
}

/**
 * Entfernt alle Event-Listener
 */
export function cleanup() {
  if (imageContainer && wheelEventHandler) {
    imageContainer.removeEventListener('wheel', wheelEventHandler);
  }
  
  document.querySelectorAll('.zoom-option').forEach(option => {
    option.removeEventListener('click', null);
  });
  
  if (resetZoomBtn) {
    resetZoomBtn.removeEventListener('click', null);
  }
}