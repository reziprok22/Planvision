/**
 * main.js - Fenster-Erkennungstool Main Application
 * Core functionality: Upload, Predict, Annotation Display, Drawing Tools, Zoom
 */

// Import Fabric.js
import { Canvas, FabricImage as Image, Rect, Polygon, Polyline, FabricText as Text, Textbox, Shadow, util, Circle, Group, Line, ActiveSelection } from 'fabric';

// Import modules
import {
  setupLabels,
  getLabelById,
  getLabelColorWithOpacity,
  getCurrentLabels,
  getCurrentLineLabels,
  getLabelsForTool,
  applyLayerOrdering,
  closeLabelManager
} from './labels.js';
import {
  resetPdfState,
  getPdfSessionId,
  getPageSettings,
  getAllPdfPages,
  setPdfSessionId,
  setPageSettings,
  setSourcePdfBlob,
  getAllSourcePdfBlobs,
  setAllSourcePdfBlobs,
  ensureServerSession,
  autoFontScale,
  getCsrfToken,
  isLightColor,
  getPageManifest,
  setPageManifest,
  getPageEntry,
  getPageIndexById,
  setCurrentPageId,
  duplicatePageInManifest,
  deletePageFromManifest,
  movePageInManifest,
} from './pdf-handler.js';
import { setupProject } from './project.js';
import { setupOnboarding } from './onboarding.js';
import {
  setupUploadModal,
  setOnPageClick,
  setOnScaleChange,
  setOnPageAction,
  setActivePageInList,
  setPageScaleInSidebar,
  getSessionId as getUploadSessionId,
  buildPageList as rebuildSidebarPageList
} from './upload-modal.js';

// Fabric.js v6 ES6 modules imported successfully
console.log('✅ Fabric.js v6 ES6 modules loaded');

// ── Endpoint dots on line annotations ────────────────────────────────────────
// Draw a small filled dot at the first and last vertex of every line annotation
// so the exact start/end of a measured stretch is visible. The number label is
// nudged off the start point (see calculateLabelPosition) so it doesn't hide the
// start dot. Implemented by extending Polyline's own _render → the dots move,
// scale and reload with the line for free, with no separate objects to manage.
// (Line annotations use objectCaching:false so the dots never clip at the bbox.)
const _polylineRender = Polyline.prototype._render;
Polyline.prototype._render = function (ctx) {
  _polylineRender.call(this, ctx);
  if (this.annotationType !== 'line' || !this.points || this.points.length < 2) return;
  const ox = this.pathOffset.x, oy = this.pathOffset.y;
  const r = (this.strokeWidth || 2) + 1.5;   // image-px radius → scales with zoom like the stroke
  const ends = [this.points[0], this.points[this.points.length - 1]];
  ctx.save();
  ctx.fillStyle = this.stroke || '#000000';
  for (const p of ends) {
    ctx.beginPath();
    ctx.arc(p.x - ox, p.y - oy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

// Global app state
let canvas = null;
let imageContainer = null;
let uploadedImage = null;

// Multi-Page Canvas State Management
// Keyed by the stable pageId from pdf-handler.js's page manifest (NOT by
// display position) — this survives duplicate/delete/reorder. See CLAUDE.md
// "Seiten-Management".
let pageCanvasData  = {}; // { "<pageId>": canvasData, ... }
let currentPageId   = null;

// Make canvas globally available for label validation (labels.js);
// getPageCanvasData/getCurrentPageNumber werden in initApp() gesetzt.
window.getCanvas = () => canvas;

// Read-Only-Modus: Trial/Lizenz abgelaufen (Flag setzt app.html vor dem Bundle).
// Ansehen, Zoomen, Öffnen und Exportieren bleiben erlaubt; Zeichnen, Bearbeiten
// und KI-Analyse sind gesperrt (Analyse zusätzlich serverseitig).
const READ_ONLY = !!window.PLANLI_READ_ONLY;
const READ_ONLY_MSG = 'Deine Testphase ist abgelaufen — Bearbeiten und KI-Analyse '
  + 'sind nur mit aktiver Lizenz möglich. Lizenz: Menü → Konto.';

// Editor state
let currentTool = 'select';
let drawingMode = false;
let currentPoints = [];
let selectedObjects = [];
let currentRectangle = null;
let currentPolygon = null;
let currentLine = null;
let rectangleStartPoint = null;
// Dimension ("Bemassung") helper tool — 3-click flow: start → end → parallel offset.
// Not an annotation (own objectType 'dimension'): never in results table/summary/
// label manager. dimPhase: 0 idle, 1 have p1 (awaiting p2), 2 have p1+p2 (choosing offset).
let dimPhase = 0;
let dimP1 = null;
let dimP2 = null;
let dimPreview = null;             // temp preview group while drawing
// Text field ("Textfeld") helper tool — drag a box, then type inside it.
// Own objectType 'textNote' (not an annotation): stays out of results/summary/labels.
let textStartPoint = null;         // drag start while defining the box width
let textPreviewRect = null;        // dashed preview rect during the drag
let clipboard = [];                // serialised annotations ready to paste
let clipboardSourceIds = [];       // canvas IDs of originals at copy time
let clipboardSourcePositions = {}; // {id: {left, top}} of originals at copy time
let editingPolygon = null;         // polygon currently in vertex-edit mode
let vertexHandles = [];            // Circle handles shown during vertex editing
let editingDimension = null;       // dimension group currently in edit mode
let dimHandles = [];               // Circle handles shown while editing a dimension
let pasteOffset = 0;               // increases with each paste so copies don't stack
let dupArmed = false;              // Ctrl/Alt + drag duplicate: armed at mouse:down
let dupSerialized = null;          // originals serialised at their start position, to clone on first move
let dupCreated = false;            // clones already spawned for this drag
let dupClonesAdded = false;        // async clone insertion has finished
let dupNeedsFinalize = false;      // mouse:up happened before the async insertion finished

// Overscan: render this many px beyond the viewport on each side so the canvas
// already holds content where a scroll-edge would otherwise flicker for one frame
// (compositor scroll vs. main-thread redraw). Set to 0 to fully disable (then the
// math below reduces exactly to the viewport-sized buffer behaviour).
const OVERSCAN = 96;

// DEBUG/Performance-Experiment: Textlabels im Canvas komplett abschalten.
// false → es werden weder neue Labels erzeugt noch gespeicherte geladen/gezeichnet.
// Ergebnistabelle, PDF-Export (labelText) und Nummerierung bleiben unberührt, weil
// createSingleTextLabel labelText/displayIndex weiterhin auf der Annotation setzt.
// Zum Wiedereinschalten auf true setzen. NUR zum Messen gedacht.
const SHOW_TEXT_LABELS = true;

// Perf: Textlabels während der Zoom-Geste ausblenden. Jeder Zoom-Tick ändert die
// viewportTransform und invalidiert damit Fabrics Objekt-Cache aller sichtbaren
// Objekte (die Cache-Auflösung hängt am Viewport-Zoom) → jedes Label würde pro
// Wheel-Tick komplett neu gerastert (Textlayout + Glyphen + Hintergrund), das
// dominiert die Zoom-Kosten bei vielen Annotationen. Unsichtbare Objekte
// überspringt Fabric dagegen vollständig. Nach dem letzten Wheel-Tick blendet
// ein Debounce die Labels wieder ein. Beim Pan/Scroll bleiben die Caches gültig
// (Zoom unverändert), dort lohnt sich das Ausblenden nicht.
const ZOOM_LABEL_HIDE_MS = 360;
let zoomLabelRestoreTimer = null;

function hideTextLabelsDuringZoom() {
  if (!canvas) return;
  canvas.getObjects().forEach(o => {
    if (o.objectType === 'textLabel') o.visible = false;
  });
  clearTimeout(zoomLabelRestoreTimer);
  zoomLabelRestoreTimer = setTimeout(restoreTextLabelsAfterZoom, ZOOM_LABEL_HIDE_MS);
}

// Auch als synchroner Flush nutzbar (vor dem Serialisieren): ohne ihn würde ein
// mitten im Debounce ausgelöstes Speichern/Seitenwechseln visible:false in die
// Projektdaten schreiben und die Labels blieben nach dem Laden unsichtbar.
function restoreTextLabelsAfterZoom() {
  if (zoomLabelRestoreTimer === null) return;
  clearTimeout(zoomLabelRestoreTimer);
  zoomLabelRestoreTimer = null;
  if (!canvas) return;
  canvas.getObjects().forEach(o => {
    if (o.objectType === 'textLabel') o.visible = true;
  });
  canvas.requestRenderAll();
}

// Crosshair overlay for drawing tools
let crosshairCanvas = null;
let crosshairCtx = null;
let crosshairVisible = false;

// Currently held drawing-tool key (q/w/e) for scroll-to-cycle
let heldDrawingKey = null;

// Label cursor tooltip
let labelTooltipEl = null;
let labelTooltipTimer = null;
let lastMouseClientX = 0;
let lastMouseClientY = 0;

// Undo / Redo history
const HISTORY_LIMIT = 30;
let undoStack = [];      // serialised states; top = current state
let redoStack = [];
let isHistoryAction = false; // true while restoring a state (prevents recursive saves)

// Event timing control
let isProcessingClick = false;
let isPageSwitching = false; // Prevent canvas events during page switches

// Debounced table update
let updateTableTimeout = null;

// Utility Functions
/**
 * Convert points array to Fabric.js format
 */
function convertPointsToFabric(points) {
  return points.map(p => ({ x: p.x, y: p.y }));
}


function getLabel(labelId) {
  const label = getLabelById(labelId);
  return {
    name:  label ? label.name  : 'Unknown',
    color: label ? label.color : '#808080'
  };
}

/**
 * Resolve the label object for an annotation, with the shared fallbacks:
 * line annotations fall back to a generic "Strecke" label, area annotations
 * to the name/color pair from getLabel().
 */
function resolveAnnotationLabel(labelId, isLine = false) {
  return getLabelById(labelId)
    || (isLine ? { name: 'Strecke', color: '#FF0000' } : getLabel(labelId));
}


/**
 * Axis-aligned bounding box {x1,y1,x2,y2} of a serialized annotation spec.
 * Handles rectangles (left/top/width/height) and point-based shapes (polygon/line).
 * Returns null if no geometry can be derived.
 */
function specBBox(a) {
  if (a.width != null && a.height != null) {
    const sx = a.scaleX || 1, sy = a.scaleY || 1;
    return { x1: a.left, y1: a.top, x2: a.left + a.width * sx, y2: a.top + a.height * sy };
  }
  if (Array.isArray(a.points) && a.points.length) {
    const xs = a.points.map(p => p.x), ys = a.points.map(p => p.y);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  return null;
}

/**
 * Suppress AI annotations that overlap each other, keeping the highest-confidence
 * one (greedy NMS by score). Needed because the backend only de-duplicates within
 * a class, but here every prediction is relabeled to the single "Erkennen als"
 * target — so two boxes the model emitted as different classes at the same spot
 * would otherwise both survive as duplicates of that label.
 */
function dedupeAnnotationsByScore(anns) {
  const sorted = [...anns].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const kept = [];
  const keptBoxes = [];
  for (const a of sorted) {
    const box = specBBox(a);
    if (box && keptBoxes.some(k => boxesOverlap(box, k))) continue; // overlaps a stronger one
    kept.push(a);
    if (box) keptBoxes.push(box);
  }
  return kept;
}

/**
 * True when two boxes {x1,y1,x2,y2} sit at "roughly the same place": either their
 * IoU is high enough, or one largely covers the other (handles size mismatches).
 */
function boxesOverlap(a, b, iouThresh = 0.3, coverThresh = 0.5) {
  const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2);
  const iw = ix2 - ix1, ih = iy2 - iy1;
  if (iw <= 0 || ih <= 0) return false;
  const inter = iw * ih;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  const iou = inter / (areaA + areaB - inter);
  const cover = inter / Math.min(areaA, areaB);
  return iou >= iouThresh || cover >= coverThresh;
}


/**
 * Setup tool button event listeners
 * Ist damit Werkzeuge nach dem Plan analysieren aktiv sind
 */
function setupToolButtons() {
  // Only touch buttons with data-tool — others (shortcuts, recalculate) manage their own listeners
  document.querySelectorAll('.tool-button[data-tool]').forEach(button => {
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);
  });

  document.querySelectorAll('.tool-button[data-tool]').forEach(button => {
    button.addEventListener('click', function() {
      const tool = this.dataset.tool;
      if (tool === 'delete') {
        deleteSelectedObjects();
      } else {
        setTool(tool);
      }
    });
  });

  // Trash startet ausgegraut – erst eine Auswahl aktiviert es (siehe updateDeleteButtonState)
  updateDeleteButtonState();
}

/**
 * Initialize canvas
 */
function initCanvas() {
  if (!uploadedImage || !uploadedImage.complete || uploadedImage.naturalWidth === 0) {
    console.warn("Image not loaded yet, retrying...");
    setTimeout(initCanvas, 100);
    return;
  }
  
  // Alte Fabric-Instanz entsorgen: dispose() entfernt den Wrapper-Div samt
  // Upper-Canvas aus dem DOM und hängt Fabrics Event-Listener ab. Ohne das
  // bleibt pro Seitenwechsel ein verwaister .canvas-container zurück
  // (DOM-/Speicher-Leak, Performance sinkt mit jedem Wechsel).
  if (canvas) {
    canvas.dispose();
    canvas = null;
  }
  // Remove existing canvas element. Muss NACH dispose() passieren: dispose
  // setzt das ursprüngliche <canvas>-Element anstelle des Wrappers zurück ins DOM.
  const existingCanvas = document.getElementById('annotationCanvas');
  if (existingCanvas) {
    existingCanvas.remove();
  }
  
  // Create new canvas element with simpler positioning
  const canvasElement = document.createElement('canvas');
  canvasElement.id = 'annotationCanvas';
  canvasElement.style.position = 'absolute';
  canvasElement.style.top = '0';
  canvasElement.style.left = '0';
  canvasElement.style.pointerEvents = 'auto'; // Always enable, let Fabric.js handle
  canvasElement.style.zIndex = '100'; // Much higher z-index
  
  imageContainer.appendChild(canvasElement);
  
  // Initialize Fabric.js canvas.
  // enableRetinaScaling:false → Canvas rendert mit devicePixelRatio 1 statt 2–3.
  // Auf HiDPI-/Retina-/4K-Displays viertelt das die zu zeichnende Pixelmenge und
  // spürbar flüssigeres Zoomen/Scrollen bei grossen Plänen mit vielen Annotationen.
  // Tradeoff: minimal weniger gestochen scharf – beim ohnehin gerasterten JPG-
  // Hintergrund praktisch unsichtbar.
  canvas = new Canvas('annotationCanvas', { enableRetinaScaling: false });
  
  // Match the canvas interaction state to the active tool (default 'select').
  // initCanvas runs on every upload/project-load/page-switch; hardcoding a
  // non-select state here meant the drag-selection rectangle stayed off until
  // the user re-picked the select tool, even though 'select' was already active.
  const selectMode = currentTool === 'select';
  canvas.selection = selectMode;
  canvas.defaultCursor = 'default';
  canvas.hoverCursor = selectMode ? 'move' : 'crosshair';
  canvas.moveCursor = 'default';

  if (READ_ONLY) {
    // Zentrale Sperre: ohne Hit-Testing ist kein Objekt anklick-/selektierbar,
    // egal was einzelne Objekte als selectable/evented gesetzt haben.
    canvas.selection = false;
    canvas.skipTargetFind = true;
    canvas.hoverCursor = 'default';
  }
  
  // Improve selection tolerance for thin lines and complex shapes
  canvas.targetFindTolerance = 10;      // 10px tolerance around objects
  canvas.perPixelTargetFind = false;    // Bounding-box hit detection — perPixel scans every pixel of every object on each mousemove, kills perf with many annotations
  canvas.uniformScaling = false;        // free resize by default; Shift = proportional
  
  const naturalWidth  = uploadedImage.naturalWidth;
  const naturalHeight = uploadedImage.naturalHeight;

  // Canvas buffer = viewport size (fixed). A #scrollSpacer div drives the scroll area.
  // viewportTransform handles both zoom and pan translation — no more mega-buffers at high zoom.
  const containerW = imageContainer.clientWidth  || naturalWidth;
  const containerH = imageContainer.clientHeight || naturalHeight;
  // Buffer = viewport + overscan margin on all sides (see OVERSCAN).
  canvas.setWidth(containerW  + 2 * OVERSCAN);
  canvas.setHeight(containerH + 2 * OVERSCAN);

  // Scroll spacer: invisible div that creates the virtual scroll area for the container.
  // Sized to natW × natH initially; zoom handler resizes it.
  const existingSpacer = document.getElementById('scrollSpacer');
  if (existingSpacer) existingSpacer.remove();
  const scrollSpacer = document.createElement('div');
  scrollSpacer.id = 'scrollSpacer';
  scrollSpacer.style.cssText = `flex-shrink:0;width:${naturalWidth}px;height:${naturalHeight}px;pointer-events:none;`;
  imageContainer.appendChild(scrollSpacer);
  
  // Add image as Fabric.js v6 background at 1:1 scale.
  // Use the already-loaded HTMLImageElement directly to avoid a redundant network fetch/decode.
  const bgImg = new Image(uploadedImage, {
    left: 0,
    top: 0,
    scaleX: 1.0,
    scaleY: 1.0,
    selectable: false,
    evented: false,
    excludeFromExport: true
  });
  canvas.backgroundImage = bgImg;
  canvas.renderAll();

  // Direkt nach dem (Neu-)Erzeugen des Canvas ist das Hintergrund-Bitmap manchmal
  // noch nicht zeichenbereit – der erste renderAll malt es dann nicht und der
  // Hintergrund bleibt grau, bis eine Interaktion (Scroll/Pan) ein erneutes
  // renderAll auslöst. Ein zweites Render, sobald das Bild garantiert dekodiert
  // ist, malt den Hintergrund zuverlässig auch ohne Nutzer-Interaktion.
  const rerenderBg = () => { if (canvas) canvas.renderAll(); };
  if (uploadedImage.decode) {
    uploadedImage.decode().then(rerenderBg).catch(rerenderBg);
  } else {
    requestAnimationFrame(rerenderBg);
  }

  // Hide the HTML image since we're using Fabric.js background
  uploadedImage.style.display = 'none';
  
  // Enable Fabric.js zoom functionality with Ctrl+Wheel, allow normal scrolling
  canvas.on('mouse:wheel', function(opt) {
    // Drawing-key held + scroll → cycle through labels
    if (heldDrawingKey && !opt.e.ctrlKey) {
      const sel = document.getElementById('universalLabelSelect');
      if (sel && sel.options.length > 1) {
        const dir = opt.e.deltaY > 0 ? 1 : -1;
        const next = (sel.selectedIndex + dir + sel.options.length) % sel.options.length;
        sel.selectedIndex = next;
        sel.dispatchEvent(new Event('change'));
        updateLabelQuickList();
      }
      opt.e.preventDefault();
      opt.e.stopPropagation();
      return;
    }
    // Only zoom with Ctrl key, otherwise allow normal scrolling
    if (opt.e.ctrlKey) {
      const delta = opt.e.deltaY;
      const oldZoom = canvas.getZoom();
      let newZoom = oldZoom * (0.999 ** delta);
      if (newZoom > 5) newZoom = 5;
      // Minimum zoom: unused empty space must not exceed 150 % of the image size.
      // Constraint: containerSize ≤ 2.5 × (naturalSize × zoom)  →  zoom ≥ containerSize / (2.5 × naturalSize)
      const emptySpaceMin = Math.max(0.02,
        imageContainer.clientWidth  / (1.5 * uploadedImage.naturalWidth),
        imageContainer.clientHeight / (1.5 * uploadedImage.naturalHeight)
      );
      // Der Fit-Zoom ("ganze Seite sichtbar", contain) ist die unterste sinnvolle
      // Stufe. Bei hohen Seiten (A3 hochkant) ist er KLEINER als emptySpaceMin —
      // dann darf minZoom nicht grösser sein als der Fit-Zoom, sonst schnappt das
      // Reinzoomen aus der Fit-Ansicht nach oben und man kommt nie zurück.
      const fitZoom = Math.min(
        imageContainer.clientWidth  / uploadedImage.naturalWidth,
        imageContainer.clientHeight / uploadedImage.naturalHeight
      );
      const minZoom = Math.min(emptySpaceMin, fitZoom);
      if (newZoom < minZoom) newZoom = minZoom;

      // offsetX/Y are relative to the (overscanned) canvas top-left, which sits
      // OVERSCAN px above/left of the viewport → subtract it to get viewport coords.
      const mouseContainerX = opt.e.offsetX - OVERSCAN;
      const mouseContainerY = opt.e.offsetY - OVERSCAN;

      // Image coordinate under the mouse before zoom (viewport pos + current scroll → image space).
      const natW = uploadedImage.naturalWidth;
      const natH = uploadedImage.naturalHeight;
      const imageX = (mouseContainerX + imageContainer.scrollLeft) / oldZoom;
      const imageY = (mouseContainerY + imageContainer.scrollTop)  / oldZoom;

      // Resize the scroll spacer (drives scroll bars) — canvas buffer stays viewport-sized.
      const spacer = document.getElementById('scrollSpacer');
      if (spacer) {
        // Ganze Pixel: muss zur Clamp-Grenze (Math.round) passen, siehe fitToViewport.
        spacer.style.width  = `${Math.round(natW * newZoom)}px`;
        spacer.style.height = `${Math.round(natH * newZoom)}px`;
      }

      // Scroll so the same image point stays under the mouse.
      imageContainer.scrollLeft = imageX * newZoom - mouseContainerX;
      imageContainer.scrollTop  = imageY * newZoom - mouseContainerY;

      // Sync wrapperEl position and Fabric viewportTransform (scale + pan translation).
      const sl = imageContainer.scrollLeft;
      const st = imageContainer.scrollTop;
      if (canvas.wrapperEl) canvas.wrapperEl.style.transform = `translate(${sl - OVERSCAN}px,${st - OVERSCAN}px)`;
      hideTextLabelsDuringZoom();
      canvas.setViewportTransform([newZoom, 0, 0, newZoom, OVERSCAN - sl, OVERSCAN - st]);

      // Refresh bounding-box cache of the active drawing object so Fabric
      // doesn't skip it as "off-screen" after the viewport transform changes.
      if (currentPolygon) currentPolygon.setCoords();
      if (currentLine) currentLine.setCoords();
      if (currentRectangle) currentRectangle.setCoords();
      opt.e.preventDefault();
      opt.e.stopPropagation();
    } else {
      // Allow normal scrolling - don't prevent default
      // The container will handle scrolling naturally
    }
  });
  
  // WrapperEl: viewport-sized and absolute. On scroll, a transform keeps it in the visible area.
  const canvasWrapper = canvas.wrapperEl;
  if (canvasWrapper) {
    canvasWrapper.style.position  = 'absolute';
    canvasWrapper.style.top       = '0';
    canvasWrapper.style.left      = '0';
    canvasWrapper.style.width     = `${containerW + 2 * OVERSCAN}px`;
    canvasWrapper.style.height    = `${containerH + 2 * OVERSCAN}px`;
    // Initial transform offsets the overscan margin off the top-left (scroll = 0).
    canvasWrapper.style.transform = `translate(${-OVERSCAN}px, ${-OVERSCAN}px)`;
  }
  
  // Setup enhanced scrolling for container
  setupContainerScrolling();
  
  // Ensure tool buttons and canvas events work after initialization
  setupToolButtons();
  setupCanvasEvents();
  createCrosshairOverlay();

  // Seite vollständig einpassen (ganze Seite sichtbar). Siehe fitToViewport.
  fitToViewport();

  return canvas;
}

/**
 * Passt die ganze Seite in den Viewport ein (Fit-Whole-Page / "contain"): die
 * komplette Seite ist sichtbar, oben-links ausgerichtet. Setzt alle vier Grössen
 * konsistent, die den Zoom in dieser App steuern: Canvas-viewportTransform,
 * #scrollSpacer (treibt die Scrollbalken), Container-Scroll und wrapperEl-Transform.
 *
 * Wird bei jeder Seitenanzeige aufgerufen (Upload, Projekt öffnen, Seitenwechsel),
 * damit man immer die ganze Seite sieht statt eines 1:1-Ausschnitts.
 */
function fitToViewport() {
  if (!canvas || !uploadedImage || !imageContainer) return;
  const natW = uploadedImage.naturalWidth;
  const natH = uploadedImage.naturalHeight;
  const containerW = imageContainer.clientWidth;
  const containerH = imageContainer.clientHeight;
  if (!natW || !natH || !containerW || !containerH) return;

  // contain: limitierende Achse bestimmt den Zoom -> ganze Seite passt rein
  const zoom = Math.min(containerW / natW, containerH / natH);

  const spacer = document.getElementById('scrollSpacer');
  if (spacer) {
    // Auf ganze Pixel runden: muss exakt zur Clamp-Grenze (Math.round) passen,
    // sonst lässt der Browser am unteren/rechten Rand 1px weiter scrollen als der
    // Clamp erlaubt → reaktives Zurückziehen ("Viewport springt leicht nach oben").
    spacer.style.width  = `${Math.round(natW * zoom)}px`;
    spacer.style.height = `${Math.round(natH * zoom)}px`;
  }
  imageContainer.scrollLeft = 0;
  imageContainer.scrollTop  = 0;
  canvas.setViewportTransform([zoom, 0, 0, zoom, OVERSCAN, OVERSCAN]);
  if (canvas.wrapperEl) canvas.wrapperEl.style.transform = `translate(${-OVERSCAN}px, ${-OVERSCAN}px)`;
  canvas.renderAll();
}

/**
 * Clamp the container's scroll position so it never scrolls past the image edge.
 * Called on every scroll event to enforce the boundary regardless of CSS layout.
 */
// Toleranz (px) für die Scroll-Begrenzung. Firefox zählt den per CSS-transform
// verschobenen Fabric-wrapperEl zur scrollHeight, daher MUSS hier an die Bildgrenze
// (natH*zoom) geklammert werden, sonst wächst die scrollbare Fläche beim Scrollen
// mit → endloses Scrollen. Die Toleranz absorbiert den Sub-Pixel-Überstand des
// nativen Scrollens, damit der Viewport am Rand nicht zurückgerissen wird ("Sprung").
const SCROLL_BOUND_SLACK = 2;
function clampScrollToImageBounds() {
  if (!imageContainer || !canvas || !uploadedImage) return;
  const zoom = canvas.getZoom();
  const maxX = Math.max(0, Math.round(uploadedImage.naturalWidth  * zoom) - imageContainer.clientWidth  + SCROLL_BOUND_SLACK);
  const maxY = Math.max(0, Math.round(uploadedImage.naturalHeight * zoom) - imageContainer.clientHeight + SCROLL_BOUND_SLACK);
  if (imageContainer.scrollLeft > maxX) imageContainer.scrollLeft = maxX;
  if (imageContainer.scrollTop  > maxY) imageContainer.scrollTop  = maxY;
}

/**
 * Setup enhanced scrolling for the image container. shift+mousewheel = horizonal scroll
 *
 * Die Listener hängen am persistenten #imageContainer und dürfen nur EINMAL
 * registriert werden — initCanvas() läuft aber bei jedem Seitenwechsel. Ohne
 * Guard stapeln sich die Handler: Shift+Wheel springt dann N×H_SCROLL_STEP
 * und jedes Scroll-Event rendert den Canvas N-fach (Ruckeln). Die Handler
 * greifen auf die Modul-Variable `canvas` zu und folgen damit automatisch
 * der jeweils aktuellen Canvas-Instanz.
 */
let containerScrollingSetup = false;
function setupContainerScrolling() {
  if (!imageContainer || containerScrollingSetup) return;
  containerScrollingSetup = true;

  // macOS: Ctrl+Klick ist der Sekundärklick und öffnet das Kontextmenü, was den
  // Ctrl+Ziehen-Duplizieren-Drag unterbricht. Im Canvas-Bereich gibt es kein
  // eigenes Kontextmenü → unterdrücken, damit Ctrl-Drag auch auf dem Mac geht.
  imageContainer.addEventListener('contextmenu', e => e.preventDefault());

  imageContainer.addEventListener('scroll', () => {
    clampScrollToImageBounds();
    if (!canvas) return;
    const sl = imageContainer.scrollLeft;
    const st = imageContainer.scrollTop;
    // Keep the wrapperEl in the visible area; the OVERSCAN offset keeps the extra
    // margin off-screen on the top-left so it can absorb the scroll-edge.
    if (canvas.wrapperEl) canvas.wrapperEl.style.transform = `translate(${sl - OVERSCAN}px,${st - OVERSCAN}px)`;
    // Update Fabric's pan so objects render at the correct scroll position.
    const zoom = canvas.getZoom();
    canvas.setViewportTransform([zoom, 0, 0, zoom, OVERSCAN - sl, OVERSCAN - st]);
    // Render synchronously (not requestRenderAll): the wrapperEl CSS transform
    // above is applied immediately, so deferring the redraw to the next frame
    // leaves the newly exposed edge blank for one frame → visible flicker.
    // Drawing in the same frame keeps the canvas and the transform in sync.
    canvas.renderAll();
  }, { passive: true });

  imageContainer.addEventListener('wheel', function(e) {
    // Ctrl+Wheel = Canvas-Zoom (Fabrics mouse:wheel-Handler macht den Zoom). Das
    // native Page-Zoom MUSS hier deterministisch unterdrückt werden: sich allein
    // auf Fabrics preventDefault zu verlassen ist unzuverlässig, wenn unter Last
    // oder an der Zoom-Grenze das Handler-Timing kippt → sonst zoomt die ganze
    // Seite. Dieser Listener ist {passive:false}, darf also preventDefault.
    if (e.ctrlKey) {
      e.preventDefault();
      return;
    }
    // If Shift key is held, convert vertical scroll to horizontal
    if (e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      // Safari (macOS) puts the Shift+wheel delta on the X axis, Chrome/Firefox
      // on the Y axis → take whichever axis dominates in magnitude.
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (raw === 0) return;
      // Browsers disagree wildly on delta magnitude and unit for Shift+wheel
      // (Firefox: axis swap + line/page mode, Chromium: ~120 px pixels), so the
      // magnitude is NOT trusted for wheel notches. A notch only carries its
      // direction and jumps a fixed fraction of the visible width — deterministic
      // across browsers and zoom levels, matching the feel of native vertical
      // scrolling. Trackpads are the exception: they emit many small pixel-mode
      // deltas per gesture, which would explode if each counted as a notch →
      // small pixel deltas scroll 1:1 instead.
      let dx;
      if (e.deltaMode === 0 && Math.abs(raw) < 50) {
        dx = raw; // trackpad / smooth-scroll: follow the gesture directly
      } else {
        dx = Math.sign(raw) * imageContainer.clientWidth * H_SCROLL_STEP;
      }
      imageContainer.scrollLeft += dx;
    }
    // Normal vertical scrolling happens automatically if no modifiers
    // Ctrl+Wheel is handled by Fabric.js for zooming
  }, { passive: false });
}

// Horizontal jump per wheel notch (Shift+wheel), as a fraction of the visible width.
const H_SCROLL_STEP = 0.05;

/**
 * Load Canvas data directly into the canvas (Single Source of Truth approach)
 * @param {Object} canvasData - Canvas data from saved project
 */
function loadCanvasData(canvasData) {
  if (!canvas) {
    initCanvas();
  }

  if (!canvas || !canvasData || !canvasData.canvas_annotations) {
    console.error("Cannot load canvas data: missing canvas or data");
    return;
  }
  
  // Clear existing canvas content
  canvas.clear();

  // Drop any stale edit-mode state — its objects are about to be removed
  editingDimension = null;
  dimHandles = [];

  // Reinitialize canvas to set background image
  initCanvas();
  
  console.log(`Loading ${canvasData.canvas_annotations.length} annotations from canvas data`);

  // Load all annotations in one batch instead of N individual promises.
  util.enlivenObjects(canvasData.canvas_annotations).then(objects => {
    canvas.renderOnAddRemove = false;
    objects.forEach(annotation => {
      if (!annotation) return;
      annotation.set({ objectType: 'annotation', selectable: true, evented: true });
      // Lines draw endpoint dots in _render → disable caching so they don't clip.
      if (annotation.type === 'polyline') annotation.set('objectCaching', false);
      canvas.add(annotation);
    });

    const savedLabels = canvasData.canvas_text_labels;
    if (!SHOW_TEXT_LABELS) {
      // Perf-Experiment: gespeicherte Labels NICHT laden/zeichnen. Trotzdem pro
      // Annotation labelText/displayIndex setzen (batch → kein Canvas-Objekt, kein
      // Render), damit Tabelle, Nummerierung und PDF-Export stimmen.
      objects.filter(Boolean).forEach(annotation => createSingleTextLabel(annotation, { batch: true }));
      applyLayerOrdering();
      canvas.requestRenderAll();
    } else if (savedLabels?.length > 0) {
      // Restore text labels at their saved positions (preserves user moves).
      // Font size is NOT taken from the save but re-derived from the page size,
      // so saves from before the auto font scale render consistently.
      const labelK = getAutoFontScale();
      util.enlivenObjects(savedLabels).then(textLabels => {
        const linkedIds = new Set();
        textLabels.filter(Boolean).forEach(tl => {
          tl.set({
            objectType: 'textLabel', selectable: false, evented: false,
            fontSize: 14 * labelK, padding: 4 * labelK,
          });
          canvas.add(tl);
          if (tl.linkedAnnotationId != null) linkedIds.add(tl.linkedAnnotationId);
        });
        // Annotations without a restored label (e.g. freshly merged AI boxes after
        // a detection run) get a fresh label + index. Normal full loads have a label
        // for every annotation, so this creates nothing there.
        objects.filter(Boolean).forEach(annotation => {
          if (annotation.id == null || !linkedIds.has(annotation.id)) {
            createSingleTextLabel(annotation, { batch: true });
          }
        });
        applyLayerOrdering();
        canvas.requestRenderAll();
      });
    } else {
      // Fallback for old saves without canvas_text_labels
      objects.filter(Boolean).forEach(annotation => createSingleTextLabel(annotation, { batch: true }));
    }

    canvas.renderOnAddRemove = true;
    canvas.requestRenderAll();
  });

  // Rebuild dimension helpers (own objectType, not annotations). Synchronous —
  // the delayed applyLayerOrdering() below fixes their z-order once everything settled.
  (canvasData.canvas_dimensions || []).forEach(d => {
    canvas.add(buildDimensionGroup(d));
  });

  // Rebuild text notes (async enliven); z-order fixed by the delayed applyLayerOrdering.
  rebuildTextNotes(canvasData.canvas_text_notes).then(() => canvas.requestRenderAll());

  // Ganze Seite einpassen (statt gespeicherten Zoom wiederherzustellen) – so sieht
  // man bei jedem Seitenwechsel/Öffnen die komplette Seite. Siehe fitToViewport.
  fitToViewport();

  // Re-setup canvas events
  setupCanvasEvents();

  // Update UI
  setTimeout(() => {
    applyLayerOrdering(); // enforce label z-order after all async enlivenObjects settle
    updateResultsTable();
    updateSummary();
    // Restore on-plan legend at its saved position (after annotations are live,
    // so the rebuilt content reflects the loaded page)
    if (canvasData.legend_position) {
      buildCanvasLegend(canvasData.legend_position);
    }
    saveHistorySnapshot();
  }, 100);
}


/**
 * Convert predictions to canvas data format (for new uploads only)
 */
function convertPredictionsToCanvasData(predictions, pageId = currentPageId) {
  if (!predictions || predictions.length === 0) {
    return {
      page_id: pageId,
      canvas_annotations: [],
      annotation_count: 0,
      canvas_available: true
    };
  }
  
  // Target label from the "Erkennen als" select in the Analyse-Einstellungen;
  // falls back to the model's class id if the select is missing/empty
  const aiSelect = document.getElementById('aiLabelSelect');
  const targetLabelId = aiSelect?.value ? parseInt(aiSelect.value) : null;

  // Convert predictions to Fabric.js serializable format
  const canvasAnnotations = predictions.map((pred, index) => {
    const labelId = targetLabelId ?? (pred.label || 1);
    const fullLabel = resolveAnnotationLabel(labelId);
    const labelColor = fullLabel.color;
    const labelStrokeWidth = fullLabel.strokeWidth || 2;

    if (pred.box || pred.bbox) {
      // Rectangle from bounding box
      const [x1, y1, x2, y2] = pred.box || pred.bbox;

      return {
        type: 'rect',
        objectType: 'annotation',
        annotationType: 'rectangle',
        left: x1,
        top: y1,
        width: x2 - x1,
        height: y2 - y1,
        fill: getLabelColorWithOpacity(labelColor, fullLabel?.opacity),
        stroke: labelColor,
        strokeWidth: labelStrokeWidth,
        labelId: labelId,
        objectLabel: labelId,
        score: pred.score ?? 0,
        displayIndex: index + 1,
        userCreated: false,
        selectable: true,
        evented: true
      };
    } else if (pred.annotationType === 'polygon' && pred.points) {
      // Polygon from points
      const fabricPoints = convertPointsToFabric(pred.points);

      return {
        type: 'polygon',
        objectType: 'annotation',
        annotationType: 'polygon',
        points: fabricPoints,
        fill: getLabelColorWithOpacity(labelColor, fullLabel?.opacity),
        stroke: labelColor,
        strokeWidth: labelStrokeWidth,
        labelId: labelId,
        objectLabel: labelId,
        score: pred.score ?? 0,
        displayIndex: index + 1,
        userCreated: false,
        selectable: true,
        evented: true,
        objectCaching: true
      };
    } else if (pred.annotationType === 'line' && pred.points) {
      // Line from points
      const fabricPoints = convertPointsToFabric(pred.points);

      return {
        type: 'polyline',
        objectType: 'annotation',
        annotationType: 'line',
        points: fabricPoints,
        fill: '',
        stroke: labelColor,
        strokeWidth: labelStrokeWidth,
        labelId: labelId,
        objectLabel: labelId,
        score: pred.score ?? 0,
        displayIndex: index + 1,
        userCreated: false,
        selectable: true,
        evented: true,
        objectCaching: true
      };
    }
  }).filter(Boolean);
  
  return {
    page_id: pageId,
    canvas_annotations: canvasAnnotations,
    annotation_count: canvasAnnotations.length,
    canvas_available: true,
    saved_at: new Date().toISOString()
  };
}


/**
 * Debounced table update - delays update to avoid too frequent calls
 */
function debouncedTableUpdate() {
  if (updateTableTimeout) {
    clearTimeout(updateTableTimeout);
  }
  updateTableTimeout = setTimeout(() => {
    updateResultsTable();
    updateSummary();
  }, 500); // 500ms delay
}




/**
 * Update results table - reads directly from canvas objects
 */
function updateResultsTable() {
  const resultsBody = document.getElementById('resultsBody');
  if (!resultsBody || !canvas) return;

  resultsBody.innerHTML = '';

  // Get all annotation objects from canvas, sorted ascending by displayIndex
  const annotations = canvas.getObjects()
    .filter(obj => obj.objectType === 'annotation')
    .sort((a, b) => (a.displayIndex ?? Infinity) - (b.displayIndex ?? Infinity));

  // Header. The AI confidence (Wahrscheinlichkeit) is a process value and lives
  // in the detection modal, not here – this table shows result values only.
  const headRow = document.querySelector('#resultsTable thead tr');
  if (headRow) {
    headRow.innerHTML = `
      <th>Nr.</th>
      <th>Label</th>
      <th>Typ</th>
      <th>Länge</th>
      <th>Höhe</th>
      <th>Fläche</th>
    `;
  }

  const pixelToMeter = getPixelToMeterFactor();

  annotations.forEach((annotation, index) => {
    // Get label info
    const labelId = annotation.labelId || annotation.objectLabel || 1;
    const label = resolveAnnotationLabel(labelId, annotation.annotationType === 'line');

    // Determine annotation type, dimensions and measurement
    let typeKey = 'rectangle';
    let typeName = 'Rechteck';
    let measurement = 'N/A';
    let widthCell = '–';
    let heightCell = '–';

    const measured = measureAnnotation(annotation);
    if (annotation.type === 'rect') {
      measurement = `${measured.value.toFixed(2)} m²`;
      const widthM  = annotation.width  * (annotation.scaleX || 1) * pixelToMeter;
      const heightM = annotation.height * (annotation.scaleY || 1) * pixelToMeter;
      widthCell  = `${widthM.toFixed(2)} m`;
      heightCell = `${heightM.toFixed(2)} m`;
    } else if (annotation.type === 'polygon') {
      typeKey = 'polygon';
      typeName = 'Polygon';
      measurement = `${measured.value.toFixed(2)} m²`;
    } else if (annotation.type === 'polyline') {
      typeKey = 'line';
      typeName = 'Linie';
      widthCell = `${measured.value.toFixed(2)} m`; // length goes in the "Länge" column
      measurement = '–';                             // a line has no area
    }

    const row = document.createElement('tr');
    const displayNumber = annotation.displayIndex || (index + 1);
    // Type as icon (same SVGs as the toolbar buttons), name via tooltip
    const typeIcon = `<span title="${typeName}" style="display:inline-flex; vertical-align:middle; color:#666;">${LABEL_TOOL_INDICATORS[typeKey].svg}</span>`;
    row.innerHTML = `
      <td>${displayNumber}</td>
      <td>${label.name}</td>
      <td>${typeIcon}</td>
      <td>${widthCell}</td>
      <td>${heightCell}</td>
      <td>${measurement}</td>
    `;

    // Tooltip-Hinweis für selbst gezeichnete Annotationen (ohne kursive Schrift –
    // die optische Hervorhebung in der Tabelle ist nicht mehr erwünscht).
    if (annotation.userCreated) {
      row.title = 'Benutzer-erstellt';
    }

    // Hover linking uses the stable annotation id, not a positional index: the
    // table is sorted by displayIndex while the canvas is in z-order, so indices
    // would point at different objects in each.
    if (annotation.id != null) row.dataset.annotationId = annotation.id;
    row.addEventListener('mouseenter', () => highlightAnnotation(annotation));
    row.addEventListener('mouseleave', () => removeHighlight());

    resultsBody.appendChild(row);
  });

  // Keep the detection modal's list in sync (derived from the same canvas objects)
  updateDetectionTable();
}

/**
 * Update the detection list in the "Fenster erkennen" modal.
 * Derived from the AI annotations on the canvas (userCreated === false, with a
 * score), so it persists with the project, is overwritten on a new detection run,
 * and updates automatically when the user deletes an AI annotation.
 * Columns: Nr. | Label | Wahrscheinlichkeit.
 */
function updateDetectionTable() {
  const body = document.getElementById('detectionResultsBody');
  if (!body || !canvas) return;

  const aiAnnotations = canvas.getObjects()
    .filter(obj => obj.objectType === 'annotation'
                && obj.userCreated === false
                && typeof obj.score === 'number' && obj.score > 0)
    .sort((a, b) => (a.displayIndex ?? Infinity) - (b.displayIndex ?? Infinity));

  const removeBtn = document.getElementById('removeAiAnnotationsBtn');
  if (removeBtn) removeBtn.disabled = aiAnnotations.length === 0;

  if (aiAnnotations.length === 0) {
    body.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#999; font-style:italic; padding:16px;">Noch keine Erkennung durchgeführt.</td></tr>';
    return;
  }

  body.innerHTML = '';
  aiAnnotations.forEach(annotation => {
    const labelId = annotation.labelId || annotation.objectLabel || 1;
    const label = resolveAnnotationLabel(labelId, annotation.annotationType === 'line');
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${annotation.displayIndex ?? '–'}</td>
      <td>${label.name}</td>
      <td>${(annotation.score * 100).toFixed(1)}%</td>
    `;
    body.appendChild(row);
  });
}

/**
 * Remove every AI-detected annotation (userCreated === false) from the current
 * page. User-drawn annotations are kept. Undoable via history. Linked text labels
 * and the tables are cleaned up by the canvas 'object:removed' handler.
 */
function removeAllAiAnnotations() {
  if (!canvas) return;
  const aiAnnotations = canvas.getObjects()
    .filter(o => o.objectType === 'annotation' && o.userCreated === false);
  if (aiAnnotations.length === 0) return;
  if (!confirm(`${aiAnnotations.length} erkannte Objekt(e) entfernen? Selbst gezeichnete bleiben erhalten.`)) return;

  aiAnnotations.forEach(o => canvas.remove(o));
  canvas.renderAll();
  updateResultsTable();   // also refreshes the detection list
  updateSummary();
  saveHistorySnapshot();
}

/**
 * Calculate rectangle area from canvas object
 */
function calculateRectangleAreaFromCanvas(rectObject) {
  const pixelToMeter = getPixelToMeterFactor();
  const actualWidth = rectObject.width * (rectObject.scaleX || 1);
  const actualHeight = rectObject.height * (rectObject.scaleY || 1);
  const widthM = actualWidth * pixelToMeter;
  const heightM = actualHeight * pixelToMeter;
  return widthM * heightM;
}

/**
 * Calculate polygon area from canvas object
 */
function calculatePolygonAreaFromCanvas(polygonObject) {
  if (!polygonObject.points || polygonObject.points.length < 3) return 0;
  
  const pixelToMeter = getPixelToMeterFactor();
  const scaleX = polygonObject.scaleX || 1;
  const scaleY = polygonObject.scaleY || 1;
  
  // Transform points with scaling
  const scaledPoints = polygonObject.points.map(p => ({
    x: p.x * scaleX,
    y: p.y * scaleY
  }));
  
  // Shoelace formula for polygon area in pixels
  let areaPixels = 0;
  for (let i = 0; i < scaledPoints.length; i++) {
    const j = (i + 1) % scaledPoints.length;
    areaPixels += scaledPoints[i].x * scaledPoints[j].y;
    areaPixels -= scaledPoints[j].x * scaledPoints[i].y;
  }
  areaPixels = Math.abs(areaPixels) / 2;
  
  // Convert to square meters
  return areaPixels * pixelToMeter * pixelToMeter;
}

/**
 * Measured value of an annotation: area (m²) for rectangles/polygons, length (m)
 * for lines. Single source for the results table, summary/legend and text labels.
 */
function measureAnnotation(annotation) {
  if (annotation.type === 'rect') {
    return { value: calculateRectangleAreaFromCanvas(annotation), unit: 'm²' };
  }
  if (annotation.type === 'polygon') {
    return { value: calculatePolygonAreaFromCanvas(annotation), unit: 'm²' };
  }
  if (annotation.type === 'polyline') {
    return { value: calculatePolylineLength(annotation.points || []), unit: 'm' };
  }
  return null;
}

/** Text-label content for an annotation: display number + measurement line. */
function buildLabelText(annotation) {
  const measured = measureAnnotation(annotation);
  const number = annotation.displayIndex || 1;
  return measured ? `${number}\n${measured.value.toFixed(2)} ${measured.unit}` : String(number);
}

// Currently highlighted annotation object reference (avoids index-based lookup after z-order changes)
let _highlightedAnnotation = null;

/**
 * Highlight annotation on canvas when hovering over table row
 */
function highlightAnnotation(target) {
  if (!canvas || !target) return;
  removeHighlight(); // clear any leftover highlight first

  _highlightedAnnotation = target;
  target._origStrokeWidth = target.strokeWidth;
  target.set({
    strokeWidth: target._origStrokeWidth * 2,
    shadow: new Shadow({ color: target.stroke, blur: 5, offsetX: 0, offsetY: 0 })
  });
  canvas.bringObjectToFront(target);
  canvas.renderAll();
}

/**
 * Remove highlight from annotation
 */
function removeHighlight() {
  if (!canvas || !_highlightedAnnotation) return;
  _highlightedAnnotation.set({
    strokeWidth: _highlightedAnnotation._origStrokeWidth ?? _highlightedAnnotation.strokeWidth,
    shadow: null
  });
  _highlightedAnnotation = null;
  // highlightAnnotation() brought the annotation to the front so the hover glow
  // sits on top — restore the canonical z-order so its text label is in front again.
  applyLayerOrdering();
  canvas.renderAll();
}

/**
 * Find the results-table row belonging to an annotation (matched by stable id).
 */
function findResultRow(annotation) {
  if (!annotation?.id) return null;
  const rows = document.getElementById('resultsBody')?.querySelectorAll('tr');
  if (!rows) return null;
  for (const r of rows) {
    if (r.dataset.annotationId === annotation.id) return r;
  }
  return null;
}

/**
 * Highlight table row when hovering over its annotation
 */
function highlightTableRow(annotation) {
  const targetRow = findResultRow(annotation);
  if (targetRow) {
    targetRow.style.backgroundColor = '#e3f2fd'; // Light blue background
    targetRow.style.transform = 'scale(1.02)'; // Slight scale effect
    targetRow.style.transition = 'all 0.2s ease';
  }
}

/**
 * Remove highlight from the table row of an annotation
 */
function removeTableRowHighlight(annotation) {
  const targetRow = findResultRow(annotation);
  if (targetRow) {
    targetRow.style.backgroundColor = ''; // Remove background
    targetRow.style.transform = ''; // Remove scale
    targetRow.style.transition = 'all 0.2s ease';
  }
}

/**
 * Collect per-label summary data (count, area, color, unit) from canvas objects.
 * Shared by the results summary and the on-plan legend.
 */
function collectSummaryData() {
  if (!canvas) return [];

  const items = new Map();
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');

  annotations.forEach(annotation => {
    const labelId = annotation.labelId || annotation.objectLabel || 1;
    const label   = getLabel(labelId);
    const key     = label.name;

    if (!items.has(key)) {
      items.set(key, {
        name:  key,
        count: 0,
        area:  0,
        color: annotation.stroke || label.color || '#888',
        unit:  annotation.type === 'polyline' ? 'm' : 'm²',
      });
    }
    const item = items.get(key);
    item.count++;

    const measured = measureAnnotation(annotation);
    if (measured) item.area += measured.value;
  });

  return [...items.values()];
}

/**
 * Update summary - reads directly from canvas objects
 */
function updateSummary() {
  const summary = document.getElementById('summary');
  if (!summary || !canvas) return;

  const items = collectSummaryData();

  let summaryHtml = '';
  items.forEach(({ name, count, area, color, unit }) => {
    summaryHtml += `
      <div class="summary-row">
        <span class="summary-color" style="background:${color}"></span>
        <span class="summary-name">${name}</span>
        <span class="summary-count"><strong>${count}</strong></span>
        <span class="summary-area">${area.toFixed(2)} ${unit}</span>
      </div>`;
  });

  summary.innerHTML = summaryHtml || '<p><em>Keine Objekte.</em></p>';

  // Keep the on-plan legend (if placed) in sync with the data
  refreshCanvasLegend();
  syncLegendButton();
}

// Auto font scale for the current page (see autoFontScale in pdf-handler.js):
// text sizes are tuned for A4; bigger formats scale proportionally per page.
function getAutoFontScale() {
  return autoFontScale(uploadedImage?.naturalWidth, uploadedImage?.naturalHeight);
}

// ── On-plan legend ────────────────────────────────────────────────────────────
// A Fabric Group on the canvas showing the label summary. Content is derived
// from the annotations on every updateSummary(); only its POSITION is state
// (persisted per page as legend_position in the canvas data).

// Base values for A4 — buildCanvasLegend() scales them by getAutoFontScale().
const LEGEND_STYLE = { font: 14, titleFont: 15, rowH: 24, pad: 14, swatch: 14, gap: 8 };

function getCanvasLegend() {
  return canvas ? canvas.getObjects().find(o => o.objectType === 'legend') : null;
}

function buildCanvasLegend(position) {
  if (!canvas) return;
  const old = getCanvasLegend();
  if (old) canvas.remove(old);

  const items = collectSummaryData();
  const k = getAutoFontScale();
  const S = Object.fromEntries(Object.entries(LEGEND_STYLE).map(([key, v]) => [key, v * k]));

  const textOpts = { fontSize: S.font, fill: '#222', fontFamily: 'Arial', selectable: false, evented: false };
  const title = new Text('Legende', {
    ...textOpts, fontSize: S.titleFont, fontWeight: 'bold',
  });
  // Table columns: swatch | name | count (right) | area (right)
  const nameTexts  = items.map(it => new Text(it.name, { ...textOpts }));
  const countTexts = items.map(it => new Text(String(it.count), { ...textOpts }));
  const areaTexts  = items.map(it => new Text(`${it.area.toFixed(2)} ${it.unit}`, { ...textOpts }));
  const emptyText = items.length ? null : new Text('Keine Objekte', {
    ...textOpts, fill: '#888', fontStyle: 'italic',
  });

  const colGap = 18 * k;
  const nameW  = Math.max(emptyText?.width || 0, ...nameTexts.map(t => t.width), 0);
  const countW = Math.max(...countTexts.map(t => t.width), 0);
  const areaW  = Math.max(...areaTexts.map(t => t.width), 0);

  const nameX      = S.pad + S.swatch + S.gap;
  const countRight = nameX + nameW + (items.length ? colGap + countW : 0);
  const areaRight  = countRight + (items.length ? colGap + areaW : 0);

  const rowCount = Math.max(items.length, 1);
  const boxW = Math.max(areaRight + S.pad, S.pad * 2 + title.width);
  const boxH = S.pad * 2 + S.titleFont + 10 * k + rowCount * S.rowH;

  const children = [
    new Rect({
      left: 0, top: 0, width: boxW, height: boxH,
      fill: 'rgba(255,255,255,0.92)', stroke: '#999', strokeWidth: k, rx: 6 * k, ry: 6 * k,
      selectable: false, evented: false,
    }),
  ];
  title.set({ left: S.pad, top: S.pad });
  children.push(title);

  const rowsTop = S.pad + S.titleFont + 10 * k;
  if (emptyText) {
    emptyText.set({ left: nameX, top: rowsTop });
    children.push(emptyText);
  }
  items.forEach((it, i) => {
    const rowY = rowsTop + i * S.rowH;
    children.push(new Rect({
      left: S.pad, top: rowY + (S.font - S.swatch) / 2 + 2 * k,
      width: S.swatch, height: S.swatch,
      fill: it.color, stroke: '#666', strokeWidth: 0.5 * k,
      selectable: false, evented: false,
    }));
    nameTexts[i].set({ left: nameX, top: rowY });
    children.push(nameTexts[i]);
    countTexts[i].set({ left: countRight, top: rowY, originX: 'right' });
    children.push(countTexts[i]);
    areaTexts[i].set({ left: areaRight, top: rowY, originX: 'right' });
    children.push(areaTexts[i]);
  });

  const legend = new Group(children, {
    left: position.left,
    top: position.top,
    objectType: 'legend',
    selectable: true,
    evented: true,
    hasControls: false,
    hasBorders: true,
    lockRotation: true,
    hoverCursor: 'move',
  });

  canvas.add(legend);
  canvas.bringObjectToFront(legend);
  canvas.requestRenderAll();
  syncLegendButton();
}

function removeCanvasLegend() {
  const legend = getCanvasLegend();
  if (legend) {
    canvas.remove(legend);
    canvas.requestRenderAll();
  }
  syncLegendButton();
}

/** Rebuild the legend in place so its content follows annotation changes. */
function refreshCanvasLegend() {
  const legend = getCanvasLegend();
  if (legend) buildCanvasLegend({ left: legend.left, top: legend.top });
}

function toggleCanvasLegend() {
  if (!canvas) return;
  if (getCanvasLegend()) {
    removeCanvasLegend();
  } else {
    // Place at the top-left of the currently visible viewport area
    const zoom = canvas.getZoom() || 1;
    buildCanvasLegend({
      left: (imageContainer.scrollLeft + 40) / zoom,
      top:  (imageContainer.scrollTop  + 40) / zoom,
    });
  }
}

function syncLegendButton() {
  const btn = document.getElementById('legendBtn');
  if (btn) btn.classList.toggle('toggled', !!getCanvasLegend());
}

// ── Copy / Paste ──────────────────────────────────────────────────────────────

function copySelectedAnnotations() {
  const annotations = selectedObjects.filter(o => o.objectType === 'annotation');
  if (!annotations.length) return;
  clipboardSourceIds = annotations.map(o => o.id).filter(Boolean);
  clipboard = serializeAnnotationsAbsolute(annotations);
  clipboardSourcePositions = {};
  annotations.forEach((o, i) => {
    if (o.id) clipboardSourcePositions[o.id] = { left: clipboard[i].left, top: clipboard[i].top };
  });
  pasteOffset = 0;
}

function cutSelectedAnnotations() {
  if (!selectedObjects.filter(o => o.objectType === 'annotation').length) return;
  copySelectedAnnotations();
  deleteSelectedObjects();
}

/**
 * Enliven serialized annotations and add them to the canvas as fresh copies:
 * new id/displayIndex (assigned by createSingleTextLabel), optional position
 * offset. Shared by paste and the Ctrl/Alt duplicate-drag.
 */
async function addClonedAnnotations(serialized, { offset = 0, interactive = true } = {}) {
  const objects = await util.enlivenObjects(JSON.parse(JSON.stringify(serialized)));
  canvas.renderOnAddRemove = false;
  for (const obj of objects) {
    obj.set({
      left:       (obj.left || 0) + offset,
      top:        (obj.top  || 0) + offset,
      objectType: 'annotation',
      selectable: interactive,
      evented:    interactive,
    });
    // Remove stale id/index so createSingleTextLabel assigns fresh ones
    delete obj.id;
    obj.displayIndex = undefined;
    canvas.add(obj);
    obj.setCoords();
    createSingleTextLabel(obj, { batch: true });
  }
  canvas.renderOnAddRemove = true;
  return objects;
}

async function pasteAnnotations() {
  if (!clipboard.length) return;

  // Apply offset only when the original is still at its copied position (not moved).
  // This prevents pasting on top of an unmoved original while allowing exact-position
  // paste when the original has been relocated or deleted.
  const originalsUnmoved = clipboardSourceIds.some(id => {
    const obj = canvas.getObjects().find(o => o.id === id);
    if (!obj) return false;
    const saved = clipboardSourcePositions[id];
    if (!saved) return false;
    const curLeft = obj.group ? obj.calcTransformMatrix()[4] - obj.getScaledWidth()  / 2 : obj.left;
    const curTop  = obj.group ? obj.calcTransformMatrix()[5] - obj.getScaledHeight() / 2 : obj.top;
    return Math.abs(curLeft - saved.left) < 1 && Math.abs(curTop - saved.top) < 1;
  });
  if (originalsUnmoved) {
    pasteOffset += 20;
  } else {
    pasteOffset = 0;
  }

  const pasted = await addClonedAnnotations(clipboard, {
    offset: pasteOffset,
    interactive: currentTool === 'select',
  });

  applyLayerOrdering();

  // Select the freshly pasted objects (not the copied originals) so they can be
  // moved straight away. Only in select mode, where the new objects are selectable.
  if (currentTool === 'select' && pasted.length) {
    canvas.discardActiveObject();
    const sel = pasted.length === 1
      ? pasted[0]
      : new ActiveSelection(pasted, { canvas });
    canvas.setActiveObject(sel);
    selectedObjects = pasted;
    updateDeleteButtonState();
  }

  canvas.requestRenderAll();
  updateResultsTable();
  updateSummary();
  saveHistorySnapshot();
}

/**
 * Serialise annotation objects with their ABSOLUTE canvas coordinates. Objects
 * inside an ActiveSelection store left/top relative to the selection centre, so
 * recover the absolute position from the transform matrix (same as copy/paste).
 */
function serializeAnnotationsAbsolute(objs) {
  return objs.map(o => {
    const s = o.toObject(['objectType', 'annotationType', 'labelId', 'objectLabel']);
    if (o.group) {
      const m = o.calcTransformMatrix();
      s.left = m[4] - o.getScaledWidth()  / 2;
      s.top  = m[5] - o.getScaledHeight() / 2;
    }
    return s;
  });
}

/**
 * Finish a Ctrl/Alt duplicate-drag: refresh tables and store a single history
 * snapshot. The copies were already dropped at the start position on first move;
 * the dragged originals stay selected so they can be moved on.
 */
function finalizeDragDuplicate() {
  dupCreated = false;
  dupClonesAdded = false;
  dupNeedsFinalize = false;
  dupSerialized = null;
  applyLayerOrdering();
  canvas.requestRenderAll();
  updateResultsTable();
  updateSummary();
  saveHistorySnapshot();
}

// ─────────────────────────────────────────────────────────────────────────────
// Undo / Redo helpers

function serializeAnnotations() {
  if (!canvas) return '[]';
  return JSON.stringify(
    canvas.getObjects()
      .filter(o => o.objectType === 'annotation')
      .map(o => o.toObject(['objectType', 'annotationType', 'labelId', 'objectLabel', 'id', 'displayIndex']))
  );
}

function initHistory() {
  undoStack = [];
  redoStack = [];
}

function saveHistorySnapshot() {
  if (isHistoryAction || isPageSwitching || !canvas) return;
  const state = JSON.stringify({
    annotations: JSON.parse(serializeAnnotations()),
    dimensions: serializeDimensions(),
    textNotes: serializeTextNotes(),
  });
  if (undoStack.length > 0 && undoStack[undoStack.length - 1] === state) return;
  undoStack.push(state);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
}

async function applyHistoryState(stateJson) {
  isHistoryAction = true;
  // Remove all annotation objects, their text labels and dimension helpers
  canvas.renderOnAddRemove = false;
  canvas.getObjects()
    .filter(o => o.objectType === 'annotation' || o.objectType === 'textLabel' || o.objectType === 'dimension' || o.objectType === 'textNote')
    .forEach(o => canvas.remove(o));

  // State shape: { annotations, dimensions, textNotes } (older bare arrays tolerated).
  const parsed = JSON.parse(stateJson);
  const annotations = Array.isArray(parsed) ? parsed : (parsed.annotations || []);
  const dimensions  = Array.isArray(parsed) ? []     : (parsed.dimensions  || []);
  const textNotes   = Array.isArray(parsed) ? []     : (parsed.textNotes   || []);

  if (annotations.length) {
    const objects = await util.enlivenObjects(annotations);
    for (const obj of objects) {
      obj.set({ selectable: currentTool === 'select' && !READ_ONLY, evented: currentTool === 'select' && !READ_ONLY });
      if (obj.type === 'polyline') obj.set('objectCaching', false);
      canvas.add(obj);
      obj.setCoords();
    }
    for (const obj of objects) createSingleTextLabel(obj, { batch: true });
  }

  dimensions.forEach(d => canvas.add(buildDimensionGroup(d)));
  await rebuildTextNotes(textNotes);

  canvas.renderOnAddRemove = true;
  applyLayerOrdering();

  canvas.discardActiveObject();
  selectedObjects = [];
  canvas.requestRenderAll();
  updateResultsTable();
  updateSummary();
  isHistoryAction = false;
}

async function undoHistory() {
  if (undoStack.length < 2) return;
  redoStack.push(undoStack.pop());
  await applyHistoryState(undoStack[undoStack.length - 1]);
}

async function redoHistory() {
  if (!redoStack.length) return;
  const state = redoStack.pop();
  undoStack.push(state);
  await applyHistoryState(state);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crosshair overlay — a separate <canvas> with pointer-events:none drawn on top
 * of the Fabric canvas. Completely independent of Fabric objects / undo history.
 */
function createCrosshairOverlay() {
  const existing = document.getElementById('crosshairCanvas');
  if (existing) existing.remove();

  crosshairCanvas = document.createElement('canvas');
  crosshairCanvas.id = 'crosshairCanvas';
  // Canvas buffer = viewport size (same as the Fabric canvas buffer).
  crosshairCanvas.width  = canvas.getWidth();
  crosshairCanvas.height = canvas.getHeight();
  Object.assign(crosshairCanvas.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width:  `${canvas.getWidth()}px`,
    height: `${canvas.getHeight()}px`,
    pointerEvents: 'none',
    zIndex: '200',
  });

  // Inside wrapperEl: moves as one unit with the Fabric canvases when scroll-transform fires.
  canvas.wrapperEl.appendChild(crosshairCanvas);
  crosshairCtx = crosshairCanvas.getContext('2d');

  canvas.upperCanvasEl.addEventListener('mouseleave', clearCrosshair);
}

function drawCrosshair(imageX, imageY) {
  if (!crosshairCtx || !crosshairCanvas) return;
  const w = crosshairCanvas.width;
  const h = crosshairCanvas.height;
  crosshairCtx.clearRect(0, 0, w, h);

  // Convert image coordinates to canvas-local coordinates. The crosshair canvas
  // shares the overscanned buffer, so add OVERSCAN to the viewport position.
  const zoom = canvas.getZoom();
  const x = imageX * zoom - imageContainer.scrollLeft + OVERSCAN;
  const y = imageY * zoom - imageContainer.scrollTop  + OVERSCAN;

  if (x < 0 || x > w || y < 0 || y > h) return;

  crosshairCtx.save();
  crosshairCtx.strokeStyle = 'rgba(30, 80, 200, 0.65)';
  crosshairCtx.lineWidth = 1;
  crosshairCtx.setLineDash([5, 5]);

  crosshairCtx.beginPath();
  crosshairCtx.moveTo(0, y);
  crosshairCtx.lineTo(w, y);
  crosshairCtx.stroke();

  crosshairCtx.beginPath();
  crosshairCtx.moveTo(x, 0);
  crosshairCtx.lineTo(x, h);
  crosshairCtx.stroke();

  crosshairCtx.restore();
}

function clearCrosshair() {
  if (crosshairCtx && crosshairCanvas) {
    crosshairCtx.clearRect(0, 0, crosshairCanvas.width, crosshairCanvas.height);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Label cursor tooltip — appears near the cursor for ~1.5 s after a label change.
 */
function createLabelTooltip() {
  if (document.getElementById('labelCursorTooltip')) return;
  labelTooltipEl = document.createElement('div');
  labelTooltipEl.id = 'labelCursorTooltip';
  Object.assign(labelTooltipEl.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '10000',
    background: 'rgba(20, 20, 20, 0.52)',
    color: '#fff',
    padding: '4px 10px 4px 8px',
    borderRadius: '5px',
    fontSize: '12px',
    fontWeight: '600',
    whiteSpace: 'nowrap',
    display: 'none',
    opacity: '0',
    transition: 'opacity 0.12s ease',
    borderLeft: '4px solid #fff',
    letterSpacing: '0.02em',
  });
  document.body.appendChild(labelTooltipEl);
}

/** True when the cursor is actually over the canvas area (not over toolbar,
 *  dropdowns or panels that may overlap it). */
function isCursorOverCanvas() {
  if (!imageContainer) return false;
  const el = document.elementFromPoint(lastMouseClientX, lastMouseClientY);
  return !!el && imageContainer.contains(el);
}

function showLabelTooltip(labelName, labelColor) {
  if (!labelTooltipEl) return;
  // Tooltip follows the crosshair workflow — only show it on the canvas itself
  if (!isCursorOverCanvas()) return;
  clearTimeout(labelTooltipTimer);

  labelTooltipEl.textContent = labelName;
  labelTooltipEl.style.borderLeftColor = labelColor || '#888';
  labelTooltipEl.style.left = `${lastMouseClientX + 18}px`;
  labelTooltipEl.style.top  = `${lastMouseClientY - 28}px`;
  labelTooltipEl.style.display = 'block';
  // Force reflow so the transition fires
  labelTooltipEl.offsetHeight;
  labelTooltipEl.style.opacity = '1';

  labelTooltipTimer = setTimeout(() => {
    labelTooltipEl.style.opacity = '0';
    setTimeout(() => { labelTooltipEl.style.display = 'none'; }, 130);
  }, 1500);
}

/**
 * Live-Distanzanzeige beim Zeichnen — kleines Tooltip, das dem Cursor folgt,
 * solange ein Zeichenvorgang läuft (Rechteck: B × H, Linie/Polygon/Bemassung:
 * Distanz zum letzten gesetzten Punkt). Sitzt unter-rechts vom Cursor, damit
 * es nicht mit dem Label-Tooltip (oben-rechts) kollidiert.
 */
let drawDistanceEl = null;

function ensureDrawDistanceEl() {
  if (drawDistanceEl) return drawDistanceEl;
  drawDistanceEl = document.createElement('div');
  drawDistanceEl.id = 'drawDistanceTooltip';
  Object.assign(drawDistanceEl.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '10000',
    background: 'rgba(20, 20, 20, 0.62)',
    color: '#fff',
    padding: '2px 7px',
    borderRadius: '4px',
    fontSize: '11.5px',
    fontWeight: '600',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    display: 'none',
  });
  document.body.appendChild(drawDistanceEl);
  return drawDistanceEl;
}

function showDrawDistance(text, e) {
  const el = ensureDrawDistanceEl();
  el.textContent = text;
  el.style.left = `${e.clientX + 16}px`;
  el.style.top  = `${e.clientY + 18}px`;
  el.style.display = 'block';
}

function hideDrawDistance() {
  if (drawDistanceEl) drawDistanceEl.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Setup Canvas Events for Editor - Pure Fabric.js approach
 */
function setupCanvasEvents() {
  if (!canvas) {
    console.warn('Cannot setup canvas events - canvas not available');
    return;
  }
    
  // Clear all existing events first. setupCanvasEvents läuft pro Seite mehrfach
  // auf derselben Canvas-Instanz (initCanvas + nach loadCanvasData) — die Liste
  // muss ALLE unten registrierten Events abdecken, sonst feuern Handler doppelt
  // (z.B. doppelte Undo-Snapshots via object:modified).
  canvas.off('mouse:down');
  canvas.off('mouse:move');
  canvas.off('mouse:up');
  canvas.off('mouse:dblclick');
  canvas.off('selection:created');
  canvas.off('selection:updated');
  canvas.off('selection:cleared');
  canvas.off('object:moving');
  canvas.off('object:modified');
  canvas.off('object:removed');
  canvas.off('mouse:over');
  canvas.off('mouse:out');
  
  // Mouse down event - handles all drawing tools
  canvas.on('mouse:down', function(options) {
    if (isProcessingClick) return;

    // Vertex edit mode interactions
    if (editingPolygon && currentTool === 'select') {
      const targetType = options.target?.objectType;
      if (targetType === 'midpointHandle') {
        insertVertexAtMidpoint(options.target);
        return;
      }
      if (targetType !== 'vertexHandle') {
        exitPolygonEditMode();
        return;
      }
    }

    // Dimension edit mode: a click anywhere but on a dimension handle exits it.
    if (editingDimension && currentTool === 'select') {
      if (options.target?.objectType !== 'dimHandle') {
        exitDimensionEditMode();
        return;
      }
    }

    // Ctrl/Alt + drag on an annotation body → duplicate-on-drag. We arm here and
    // serialise the selection at its START position; on the first move a copy is
    // dropped there immediately (visible at once), while the originals are dragged
    // on. __corner is set when a resize/rotate handle was grabbed → skip those.
    // On a multi-selection the drag target is the ActiveSelection (a group), not
    // an annotation – handle both so Ctrl/Alt-drag duplicates groups too.
    const t = options.target;
    const multiSel = canvas.getActiveObject() instanceof ActiveSelection ? canvas.getActiveObject() : null;
    const onMulti  = multiSel && (t === multiSel || multiSel.getObjects().includes(t));
    const onAnno   = t?.objectType === 'annotation';
    dupArmed = currentTool === 'select'
            && (options.e.ctrlKey || options.e.altKey)
            && (onMulti || onAnno)
            && !t?.__corner;
    if (dupArmed) {
      const set = onMulti
        ? multiSel.getObjects().filter(o => o.objectType === 'annotation')
        : [t];
      dupSerialized = serializeAnnotationsAbsolute(set);
      dupCreated = false;
      dupClonesAdded = false;
      dupNeedsFinalize = false;
    }

    // If there's a target object (user clicked on an existing annotation or handle), don't start drawing
    if (options.target && (options.target.objectType === 'annotation' || options.target.objectType === 'dimension' || options.target.objectType === 'vertexHandle' || options.target.objectType === 'midpointHandle')) {
      return;
    }
    
    const pointer = canvas.getPointer(options.e);
    
    // Handle different tools
    if (currentTool === 'rectangle') {
      isProcessingClick = true;
      startDrawingRectangle(pointer);
      setTimeout(() => { isProcessingClick = false; }, 50);
    } else if (currentTool === 'polygon') {
      addPolygonPoint(pointer, options.e);
    } else if (currentTool === 'line') {
      addLinePoint(pointer, options.e);
    } else if (currentTool === 'dimension') {
      dimHandleClick(pointer, options.e);
    } else if (currentTool === 'text') {
      isProcessingClick = true;
      startTextDrawing(pointer);
      setTimeout(() => { isProcessingClick = false; }, 50);
    }
    // For 'select' tool, let Fabric.js handle selection naturally
  });
  
  // Mouse move event - for drawing previews and crosshair
  canvas.on('mouse:move', function(options) {
    const pointer = canvas.getPointer(options.e);

    if (crosshairVisible) {
      drawCrosshair(pointer.x, pointer.y);
    }

    if (!drawingMode) { hideDrawDistance(); return; }

    if (currentTool === 'rectangle' && currentRectangle) {
      updateDrawingRectangle(pointer);
      if (rectangleStartPoint) {
        const f = getPixelToMeterFactor();
        const w = Math.abs(pointer.x - rectangleStartPoint.x) * f;
        const h = Math.abs(pointer.y - rectangleStartPoint.y) * f;
        showDrawDistance(`${w.toFixed(2)} × ${h.toFixed(2)} m`, options.e);
      }
    } else if (currentTool === 'polygon' && currentPolygon) {
      updatePolygonPreview(pointer, options.e.shiftKey);
      if (currentPoints.length > 0) {
        const last = currentPoints[currentPoints.length - 1];
        const end = options.e.shiftKey ? snapToAngle(last, pointer) : pointer;
        showDrawDistance(dimMeasurementText(Math.hypot(end.x - last.x, end.y - last.y)), options.e);
      }
    } else if (currentTool === 'line' && currentLine) {
      updateLinePreview(pointer, options.e.shiftKey);
      if (currentPoints.length > 0) {
        const last = currentPoints[currentPoints.length - 1];
        const end = options.e.shiftKey ? snapToAngle(last, pointer) : pointer;
        showDrawDistance(dimMeasurementText(Math.hypot(end.x - last.x, end.y - last.y)), options.e);
      }
    } else if (currentTool === 'dimension') {
      dimHandleMove(pointer, options.e);
      if (dimPhase === 1 && dimP1) {
        const pt = options.e.shiftKey ? snapToAngle(dimP1, pointer) : pointer;
        showDrawDistance(dimMeasurementText(Math.hypot(pt.x - dimP1.x, pt.y - dimP1.y)), options.e);
      } else {
        // Phase 2 (Parallel-Offset): das Mass steht bereits in der Vorschau selbst
        hideDrawDistance();
      }
    } else if (currentTool === 'text' && textPreviewRect) {
      updateTextDrawing(pointer);
    }
  });
  
  // Vertex handle dragging — update polygon + adjacent midpoint handles live
  canvas.on('object:moving', function(e) {
    const obj = e.target;
    if (obj.objectType === 'vertexHandle' && editingPolygon) {
      updatePolygonVertex(editingPolygon, obj.pointIndex, obj.left, obj.top);
      updateAdjacentMidpoints(obj.pointIndex);
    }
    if (obj.objectType === 'dimHandle' && editingDimension) {
      updateDimensionFromHandle(obj, e.e?.shiftKey);
    }

    // First move of a Ctrl/Alt-drag → drop the copies at the start position right
    // away, so the duplicate is visible immediately while the originals are dragged.
    if (dupArmed && !dupCreated) {
      dupCreated = true;
      addClonedAnnotations(dupSerialized).then(() => {
        dupClonesAdded = true;
        applyLayerOrdering();
        canvas.requestRenderAll();
        if (dupNeedsFinalize) finalizeDragDuplicate();
      });
    }
  });

  // Mouse up event - finish drawing operations
  canvas.on('mouse:up', function(options) {

    if (currentTool === 'rectangle' && drawingMode) {
      finishDrawingRectangle();
    }

    if (currentTool === 'text' && drawingMode) {
      finishTextDrawing();
    }

    // Ctrl/Alt + drag duplicate: finalise once the drag ends. If the async clone
    // insertion is still pending, finalizeDragDuplicate runs from its callback.
    if (dupArmed) {
      dupArmed = false;
      if (dupCreated) {
        if (dupClonesAdded) finalizeDragDuplicate();
        else dupNeedsFinalize = true;
      } else {
        dupSerialized = null; // armed but no drag happened (plain Ctrl/Alt-click)
      }
    }
  });
  
  // Double-click event - polygon/line finishing + vertex edit mode
  canvas.on('mouse:dblclick', function(options) {
    // Vertex edit mode: toggle on double-click of polygon in select mode
    if (currentTool === 'select') {
      const target = options.target;
      if (target?.annotationType === 'polygon' || target?.annotationType === 'line') {
        if (editingPolygon === target) {
          exitPolygonEditMode();
        } else {
          enterPolygonEditMode(target);
        }
        return;
      }
      if (target?.objectType === 'dimension') {
        if (editingDimension === target) {
          exitDimensionEditMode();
        } else {
          enterDimensionEditMode(target);
        }
        return;
      }
    }

    if (currentTool === 'polygon' && currentPoints.length >= 3) {
      finishPolygonDrawing();
    } else if (currentTool === 'line' && currentPoints.length >= 2) {
      finishLineDrawing();
    }
  });
  
  // Selection events. e.selected contains only the newly added/removed object;
  // getActiveObjects() returns the full current selection.
  const onSelectionChanged = function() {
    selectedObjects = canvas.getActiveObjects();
    updateDeleteButtonState();
    if (currentTool === 'select' && selectedObjects.length > 0) {
      updateUniversalLabelDropdown(currentTool, selectedObjects[0]);
    }
  };
  canvas.on('selection:created', onSelectionChanged);
  canvas.on('selection:updated', onSelectionChanged);
  
  canvas.on('selection:cleared', function(e) {
    // Update text labels only for annotations that were actually selected/modified
    if (selectedObjects && selectedObjects.length > 0) {
      selectedObjects.forEach(selectedObj => {
        if (selectedObj.objectType === 'annotation') {
          updateLinkedTextLabelPosition(selectedObj);
        } else if (selectedObj.objectType === 'dimension') {
          // A dimension moved inside a multi-selection reports object:modified on the
          // ActiveSelection, not the group, so its geometry is only reconciled here —
          // coords are absolute again after Fabric discards the selection.
          bakeDimensionMove(selectedObj);
        }
      });
      debouncedTableUpdate();
    }
    
    selectedObjects = [];
    updateDeleteButtonState();
    if (currentTool === 'select') {
      updateUniversalLabelDropdown(currentTool);
    }
  });
  
  // Shift while rotating a text note or annotation → snap to 22.5° steps (matches
  // the drawing snap). Origins are top-left, so setting only `angle` would pivot
  // around the corner and make the object drift — keep its centre fixed instead.
  canvas.on('object:rotating', function(e) {
    const t = e.target;
    if (!t || !e.e?.shiftKey) return;
    if (t.objectType !== 'textNote' && t.objectType !== 'annotation') return;
    const step = 22.5;
    const snapped = Math.round(t.angle / step) * step;
    if (snapped === t.angle) return;
    const center = t.getCenterPoint();
    t.set('angle', snapped);
    t.setPositionByOrigin(center, 'center', 'center');
    t.setCoords();
    if (t.objectType === 'annotation') updateLinkedTextLabelPosition(t);
  });

  // Text note finished editing → drop it if left empty, otherwise record the edit.
  canvas.on('text:editing:exited', function(e) {
    const t = e.target;
    if (!t || t.objectType !== 'textNote') return;
    if (!t.text || !t.text.trim()) {
      canvas.remove(t);
      canvas.requestRenderAll();
      return;
    }
    saveHistorySnapshot();
  });

  // Object modified (resize/scale) – recalculate measurements
  canvas.on('object:modified', function(e) {
    // Dimension helper moved → fold the translation back into its stored geometry.
    if (e.target?.objectType === 'dimension') {
      bakeDimensionMove(e.target);
      if (!dupArmed) saveHistorySnapshot();
      return;
    }
    // Text note moved/resized → just record a history step.
    if (e.target?.objectType === 'textNote') {
      if (!dupArmed) saveHistorySnapshot();
      return;
    }
    if (!e.target || e.target.objectType !== 'annotation') return;
    updateLinkedTextLabelPosition(e.target);
    // During a Ctrl/Alt duplicate-drag (still armed here, fires before mouse:up),
    // skip this snapshot – finalizeDragDuplicate saves the final state so the
    // whole duplicate is a single undo step.
    if (!dupArmed) saveHistorySnapshot();
    debouncedTableUpdate();
  });

  // Object removal events - update table when annotations are deleted
  canvas.on('object:removed', function(e) {
    if (isPageSwitching || isHistoryAction || !e.target) return;
    if (e.target.objectType === 'annotation') {
      // Find and remove linked text label
      const linkedTextLabel = canvas.getObjects().find(obj => 
        obj.objectType === 'textLabel' && obj.linkedAnnotationId === e.target.id
      );
      if (linkedTextLabel) {
        canvas.remove(linkedTextLabel);
      }
      debouncedTableUpdate();
    }
  });
  
  // Mouse hover events for annotation highlighting (matched by id, not position)
  canvas.on('mouse:over', function(e) {
    if (e.target?.objectType === 'annotation') highlightTableRow(e.target);
  });

  canvas.on('mouse:out', function(e) {
    if (e.target?.objectType === 'annotation') removeTableRowHighlight(e.target);
  });
}


/**
 * Set Current Tool
 */
function setTool(toolName) {
  if (READ_ONLY) toolName = 'select'; // nur Ansicht: Werkzeuge bleiben gesperrt
  if (editingPolygon) exitPolygonEditMode();
  if (editingDimension) exitDimensionEditMode();

  // Clean up current tool state first
  cleanupCurrentTool();
  
  currentTool = toolName;
  
  // Update button states
  document.querySelectorAll('.tool-button').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tool="${toolName}"]`).classList.add('active');
  
  // Reset all drawing states
  resetAllDrawingStates();
  
  // Update universal label dropdown based on tool
  updateUniversalLabelDropdown(toolName);
  
  // Update canvas selection mode (Auswahl-Modul)
  if (canvas) {
    if (toolName === 'select') {
      canvas.selection = !READ_ONLY; // Es können mehrere Objekte gleichzeitig mit Auswahlrahmen ausgewählt werden
      canvas.skipTargetFind = READ_ONLY; // Hit-Testing wieder an, damit Objekte anklickbar sind (Read-Only: aus)
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = READ_ONLY ? 'default' : 'move';
      if (!READ_ONLY) canvas.forEachObject(obj => {
        // Nur Annotation-Objekte selektierbar machen, nicht Text-Labels
        if (obj.objectType === 'annotation' || obj.objectType === 'dimension' || obj.objectType === 'textNote') {
          obj.selectable = true;
          obj.evented = true;
          obj.setCoords(); // ensure hit-detection bounds are current
        } else if (obj.objectType === 'textLabel') {
          // Text labels should never be selectable or interactive
          obj.selectable = false;
          obj.evented = false;
        } else {
          obj.selectable = false;
          obj.evented = false;
        }
      });
      crosshairVisible = false;
      clearCrosshair();
    } else {
      canvas.selection = false;
      // Zeichen-Modi brauchen kein Hit-Testing (alle Objekte sind hier evented=false).
      // skipTargetFind überspringt die O(n)-Zielsuche bei jedem mouse:move → spürbar
      // flüssiger bei Plänen mit vielen Annotationen.
      canvas.skipTargetFind = true;
      canvas.defaultCursor = 'crosshair';
      canvas.hoverCursor = 'crosshair';
      canvas.discardActiveObject();
      canvas.forEachObject(obj => {
        obj.selectable = false;
        obj.evented = false;
      });
      // Clear selection when switching away from select tool
      crosshairVisible = true;
    }
    canvas.renderAll();
  }
}

// Same icons as the toolbar tool buttons — shown next to the "Labels" title
// so it's clear which shape type the label list currently applies to.
const LABEL_TOOL_INDICATORS = {
  rectangle: {
    name: 'Rechteck',
    svg: '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3" width="11" height="8"/></svg>',
  },
  polygon: {
    name: 'Polygon',
    svg: '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><polygon points="7,1.5 12.5,5.5 10.5,12.5 3.5,12.5 1.5,5.5"/></svg>',
  },
  line: {
    name: 'Linie',
    svg: '<svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" stroke="currentColor" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><line x1="12" y1="2" x2="2" y2="12" stroke-width="1.5"/><circle cx="12" cy="2" r="1.5" stroke="none"/><circle cx="2" cy="12" r="1.5" stroke="none"/></svg>',
  },
};

function updateLabelToolIndicator(type) {
  const el = document.getElementById('labelToolIndicator');
  if (!el) return;
  const indicator = LABEL_TOOL_INDICATORS[type];
  if (!indicator) {
    el.innerHTML = '';
    el.title = '';
    return;
  }
  el.innerHTML = `${indicator.svg}<span>${indicator.name}</span>`;
  el.title = `Labels gelten für: ${indicator.name}`;
}

/**
 * Update universal label dropdown based on current tool and selection
 */
function updateUniversalLabelDropdown(toolName, selectedObject = null) {
  const universalLabelSelect = document.getElementById('universalLabelSelect');
  if (!universalLabelSelect) return;

  // Select tool with no annotation selected: placeholder, disabled.
  // The dimension helper has no label, so treat it (tool or selection) the same way.
  if ((toolName === 'select' && !selectedObject) ||
      toolName === 'dimension' || toolName === 'text' ||
      selectedObject?.objectType === 'dimension' ||
      selectedObject?.objectType === 'textNote') {
    universalLabelSelect.innerHTML = '<option value="">–</option>';
    universalLabelSelect.disabled = true;
    universalLabelSelect.classList.add('no-selection');
    updateLabelToolIndicator(null);
    updateLabelQuickList();
    return;
  }
  universalLabelSelect.disabled = false;
  universalLabelSelect.classList.remove('no-selection');

  // Determine tool type and get appropriate labels
  let labels;
  let indicatorType;

  if (toolName === 'line' || (selectedObject && selectedObject.annotationType === 'line')) {
    // Line tool - use line labels
    labels = getCurrentLineLabels();
    indicatorType = 'line';
  } else if (toolName === 'polygon' || (selectedObject && selectedObject.annotationType === 'polygon')) {
    // Polygon tool - use polygon labels
    labels = getLabelsForTool('polygon');
    indicatorType = 'polygon';
  } else {
    // Rectangle tool or other - use rectangle labels
    labels = getCurrentLabels();
    indicatorType = 'rectangle';
  }
  updateLabelToolIndicator(indicatorType);
  
  // Remember current selection
  const currentValue = universalLabelSelect.value;
  
  // Clear and repopulate dropdown
  universalLabelSelect.innerHTML = '';
  labels.forEach((label, i) => {
    const option = document.createElement('option');
    option.value = label.id;
    option.textContent = i < 9 ? `${i + 1}: ${label.name}` : label.name;
    universalLabelSelect.appendChild(option);
  });
  
  // Set selection based on context
  if (selectedObject && selectedObject.labelId) {
    universalLabelSelect.value = selectedObject.labelId;
  } else if (universalLabelSelect.querySelector(`option[value="${currentValue}"]`)) {
    universalLabelSelect.value = currentValue;
  } else {
    universalLabelSelect.value = labels[0].id;
  }

  updateLabelQuickList();
}

function updateLabelQuickList() {
  const container = document.getElementById('labelQuickList');
  const select = document.getElementById('universalLabelSelect');
  if (!container || !select) return;

  container.innerHTML = '';

  const options = Array.from(select.options);
  if (options.length === 0 || select.disabled) {
    const hint = document.createElement('div');
    hint.className = 'label-quick-disabled-hint';
    hint.textContent = 'Objekt auswählen';
    container.appendChild(hint);
    return;
  }

  options.forEach((opt, i) => {
    const id = parseInt(opt.value);
    const label = getLabelById(id);
    const color = label ? label.color : '#888';
    const isActive = opt.value === select.value;

    const item = document.createElement('div');
    item.className = 'label-quick-item' + (isActive ? ' active' : '');
    item.dataset.value = opt.value;
    item.innerHTML = `
      <span class="label-quick-dot" style="background:${color};"></span>
      <span class="label-quick-name">${label ? label.name : opt.textContent}</span>
      ${i < 9 ? `<span class="label-quick-key">${i + 1}</span>` : ''}
    `;
    item.addEventListener('click', () => {
      select.value = opt.value;
      select.dispatchEvent(new Event('change'));
      updateLabelQuickList();
    });
    container.appendChild(item);
  });

  // Aktives Label in den sichtbaren Bereich holen (Liste hat max-height + overflow).
  // Nur den Scroll der Liste selbst anpassen – kein scrollIntoView, das würde
  // u.U. auch die Seitenleiste/Seite mitscrollen.
  const active = container.querySelector('.label-quick-item.active');
  if (active) {
    const cRect = container.getBoundingClientRect();
    const iRect = active.getBoundingClientRect();
    if (iRect.top < cRect.top) {
      container.scrollTop += iRect.top - cRect.top;
    } else if (iRect.bottom > cRect.bottom) {
      container.scrollTop += iRect.bottom - cRect.bottom;
    }
  }
}

/**
 * Tool State Management
 */
function cleanupCurrentTool() {
  if (currentTool === 'rectangle' && currentRectangle) {
    canvas.remove(currentRectangle);
    currentRectangle = null;
  } else if (currentTool === 'polygon' && currentPolygon) {
    canvas.remove(currentPolygon);
    currentPolygon = null;
  } else if (currentTool === 'line' && currentLine) {
    canvas.remove(currentLine);
    currentLine = null;
  } else if (currentTool === 'dimension') {
    resetDimDrawing();
  } else if (currentTool === 'text') {
    resetTextDrawing();
  }

  hideDrawDistance();

  if (canvas) {
    canvas.renderAll();
  }
}

function resetAllDrawingStates() {
  
  drawingMode = false;
  currentRectangle = null;
  currentPoints = [];
  currentPolygon = null;
  currentLine = null;
  rectangleStartPoint = null;
  isProcessingClick = false;
  // Dimension helper drawing state (preview cleared separately in resetDimDrawing)
  if (dimPreview) { canvas?.remove(dimPreview); dimPreview = null; }
  dimPhase = 0;
  dimP1 = null;
  dimP2 = null;
  // Text field drawing state
  if (textPreviewRect) { canvas?.remove(textPreviewRect); textPreviewRect = null; }
  textStartPoint = null;
  hideDrawDistance();
}

/**
 * Rectangle Drawing Functions
 */
function startDrawingRectangle(pointer) {
  if (!canvas) return;
  
  drawingMode = true;
  
  // Store the original start point
  rectangleStartPoint = { x: pointer.x, y: pointer.y };

  // Get current selected label and its color
  const selectedLabelId = getCurrentSelectedLabel();
  const label = resolveAnnotationLabel(selectedLabelId);

  const rect = new Rect({
    left: pointer.x,
    top: pointer.y,
    width: 0,
    height: 0,
    fill: getLabelColorWithOpacity(label.color, label.opacity),
    stroke: label.color,
    strokeWidth: label.strokeWidth || 2,
    objectType: 'annotation',
    annotationType: 'rectangle',
    userCreated: true,
    selectable: currentTool === 'select',
    evented: currentTool === 'select'
  });
  
  canvas.add(rect);
  currentRectangle = rect;
}

function updateDrawingRectangle(pointer) {
  if (!currentRectangle || !rectangleStartPoint) return;

  const startX = rectangleStartPoint.x;
  const startY = rectangleStartPoint.y;
  const width = pointer.x - startX;
  const height = pointer.y - startY;

  currentRectangle.set({
    width: Math.abs(width),
    height: Math.abs(height),
    left: width < 0 ? pointer.x : startX,
    top: height < 0 ? pointer.y : startY
  });

  canvas.requestRenderAll();
}

function finishDrawingRectangle() {
  if (!currentRectangle) return;
  
  // Minimum size check
  if (currentRectangle.width < 10 || currentRectangle.height < 10) {
    canvas.remove(currentRectangle);
  } else {
    // Get selected label
    const selectedLabelId = getCurrentSelectedLabel();
    const label = resolveAnnotationLabel(selectedLabelId);

    // Update rectangle with correct label and colors
    currentRectangle.set({
      selectable: true,
      evented: true,
      labelId: selectedLabelId,
      objectLabel: selectedLabelId,
      fill: getLabelColorWithOpacity(label.color, label.opacity),
      stroke: label.color
    });
    currentRectangle.setCoords(); // sync hit-detection bounds after resize via set()

    // Create text label with delay to ensure annotation is fully stabilized
    const rectToLabel = currentRectangle; // Store reference before clearing
    setTimeout(() => {
      createSingleTextLabel(rectToLabel);
      saveHistorySnapshot();
    }, 10);
  }
  
  drawingMode = false;
  currentRectangle = null;
  rectangleStartPoint = null;
  hideDrawDistance();
  canvas.renderAll();
}

/**
 * Get pixel to meter conversion factor based on current settings
 */
function getPixelToMeterFactor() {
  // Get form values
  const formatWidth = parseFloat(document.getElementById('formatWidth')?.value || 210); // mm
  const planScale = parseFloat(document.getElementById('planScale')?.value || 100); // 1:X
  
  if (!uploadedImage || !uploadedImage.naturalWidth) {
    return 0.001; // Default value if image not available
  }
  
  // Real world width in meters (taking plan scale into account)
  const realWorldWidthMm = formatWidth * planScale; // mm in real world
  const realWorldWidthM = realWorldWidthMm / 1000; // convert to meters
  
  // Image width in pixels
  const imageWidthPixels = uploadedImage.naturalWidth;
  
  // Calculate pixel to meter conversion
  const pixelToMeter = realWorldWidthM / imageWidthPixels;
  
  return pixelToMeter;
}

/**
 * Delete selected objects
 */
// Brief visual confirmation on an action tool-button (e.g. delete) that has no
// persistent active state: apply the active look for a moment. Works for both
// click and hotkey since it lives in the shared action handler below.
function flashToolButton(tool) {
  const btn = document.querySelector(`.tool-button[data-tool="${tool}"]`);
  if (!btn) return;
  btn.classList.add('flash-active');
  setTimeout(() => btn.classList.remove('flash-active'), 180);
}

function deleteSelectedObjects() {
  if (!canvas || selectedObjects.length === 0) return;

  flashToolButton('delete');

  // Objects inside an ActiveSelection stay rendered by that group until it's
  // cleared, so removing them while selected leaves the annotations on screen
  // until the next deselect. Discard the selection first, then remove — so the
  // annotations and their linked text labels disappear together, immediately.
  const toRemove = selectedObjects;
  canvas.discardActiveObject();       // fires selection:cleared → resets selectedObjects
  selectedObjects = [];

  toRemove.forEach(obj => canvas.remove(obj));

  canvas.renderAll();
  updateDeleteButtonState();
  saveHistorySnapshot();

  // Back to the select tool so the user can immediately pick the next object.
  if (currentTool !== 'select') setTool('select');
}

/**
 * Trash-Button nur aktivieren, wenn etwas ausgewählt ist – ohne Auswahl hat das
 * Löschen keine Wirkung, daher wird das Icon dann ausgegraut (siehe CSS
 * .tool-button:disabled). Wird bei jeder Auswahländerung aufgerufen.
 */
function updateDeleteButtonState() {
  const btn = document.querySelector('.tool-button[data-tool="delete"]');
  if (btn) btn.disabled = !(selectedObjects && selectedObjects.length > 0);
}

function getContrastTextColor(hex) {
  return isLightColor(hex) ? '#222222' : 'white';
}

/**
 * Calculate optimal position for text label based on annotation's REAL Fabric.js coordinates
 */
function calculateLabelPosition(annotationObject) {
  // Rectangle: top-left corner is the first vertex
  if (annotationObject.type === 'rect') {
    return { x: annotationObject.left, y: annotationObject.top };
  }

  // Polygon: transform first point to absolute canvas coordinates
  if (annotationObject.type === 'polygon' &&
      annotationObject.points && annotationObject.points.length > 0 &&
      annotationObject.pathOffset) {
    return getVertexAbsPosition(annotationObject, 0);
  }

  // Line: place the label just past the start point (outward, along the first
  // segment) so it sits beside the start dot instead of covering it.
  if (annotationObject.type === 'polyline' &&
      annotationObject.points && annotationObject.points.length > 0 &&
      annotationObject.pathOffset) {
    const p0 = getVertexAbsPosition(annotationObject, 0);
    if (annotationObject.points.length >= 2) {
      const p1 = getVertexAbsPosition(annotationObject, 1);
      const dx = p0.x - p1.x, dy = p0.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) {
        const OFF = 32 * getAutoFontScale();   // canvas px between start dot and label centre
        return { x: p0.x + (dx / len) * OFF, y: p0.y + (dy / len) * OFF };
      }
    }
    return p0;
  }

  // Fallback
  return { x: annotationObject.left || 0, y: annotationObject.top || 0 };
}

/**
 * Get currently selected label ID from universal dropdown
 */
function getCurrentSelectedLabel() {
  const universalLabelSelect = document.getElementById('universalLabelSelect');
  return universalLabelSelect ? parseInt(universalLabelSelect.value) : 1;
}

/**
 * Apply label change to currently selected object
 */
function applyLabelChangeToSelectedObject() {
  if (!canvas || selectedObjects.length === 0) return;

  const universalLabelSelect = document.getElementById('universalLabelSelect');
  if (!universalLabelSelect) return;

  const newLabelId = parseInt(universalLabelSelect.value);
  if (!newLabelId) return;

  // The dropdown shows labels of one category only (line vs. area, based on the
  // first selected object). Apply the change to EVERY selected object of that
  // same category; leave the other category untouched – a line label must not
  // land on a rectangle/polygon and vice versa.
  const targetIsLine = selectedObjects[0].annotationType === 'line';
  const targets = selectedObjects.filter(o =>
    o.objectType === 'annotation' && (o.annotationType === 'line') === targetIsLine
  );

  targets.forEach(obj => applyLabelToAnnotation(obj, newLabelId));

  canvas.renderAll();
  updateResultsTable();
  updateSummary();
  saveHistorySnapshot();
}

/**
 * Apply a label (id) to a single annotation: update its label fields, fill/stroke
 * and the colour of its linked text label.
 */
function applyLabelToAnnotation(obj, newLabelId) {
  obj.labelId = newLabelId;
  obj.objectLabel = newLabelId;

  const isLineObject = obj.annotationType === 'line';
  const label = resolveAnnotationLabel(newLabelId, isLineObject);

  if (isLineObject) {
    obj.set({ stroke: label.color });
  } else {
    obj.set({ fill: getLabelColorWithOpacity(label.color, label.opacity), stroke: label.color });
  }

  const linkedTextLabel = canvas.getObjects().find(o =>
    o.objectType === 'textLabel' && o.linkedAnnotationId === obj.id
  );
  if (linkedTextLabel) {
    linkedTextLabel.set({
      backgroundColor: label.color,
      fill: getContrastTextColor(label.color)
    });
  }
}


// Make functions globally available
window.updateResultsTable = updateResultsTable;
window.createSingleTextLabel = createSingleTextLabel;

/**
 * Snaps point `to` to the nearest angle multiple of `stepDeg` from point `from`.
 * Used when Shift is held during polygon/line drawing.
 */
function snapToAngle(from, to, stepDeg = 22.5) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return to;
  const step = stepDeg * Math.PI / 180;
  const snapped = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + dist * Math.cos(snapped), y: from.y + dist * Math.sin(snapped) };
}

/**
 * Polygon Drawing Functions
 */
function addPolygonPoint(pointer, e) {  
  if (!canvas || isProcessingClick) return;
  
  isProcessingClick = true;

  // Shift held → snap to nearest 22.5° angle from last point
  const pt = (e?.shiftKey && currentPoints.length > 0)
    ? snapToAngle(currentPoints[currentPoints.length - 1], pointer)
    : pointer;

  // Add point to current polygon
  currentPoints.push(pt);
  
  if (currentPoints.length === 1) {
    // First point - start polygon
    startPolygonDrawing();
  } else {
    // Update polygon with new point
    updatePolygonFromPoints();
  }
  
  setTimeout(() => { isProcessingClick = false; }, 50);
}

function startPolygonDrawing() {
  if (!canvas || currentPoints.length === 0) return;
  
  drawingMode = true;

  // Get current selected label and its color
  const selectedLabelId = getCurrentSelectedLabel();
  const label = resolveAnnotationLabel(selectedLabelId);

  // Create initial polygon with first point duplicated to make it visible
  const firstPoint = currentPoints[0];
  const points = [
    { x: firstPoint.x, y: firstPoint.y },
    { x: firstPoint.x + 1, y: firstPoint.y + 1 } // Slightly offset to make it visible
  ];
  
  currentPolygon = new Polygon(points, {
    fill: getLabelColorWithOpacity(label.color, label.opacity),
    stroke: label.color,
    strokeWidth: label.strokeWidth || 2,
    objectType: 'annotation',
    annotationType: 'polygon',
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    objectCaching: false
  });
  
  canvas.add(currentPolygon);
  canvas.renderAll();
}

function updatePolygonFromPoints() {
  if (!currentPolygon || currentPoints.length < 2) return;

  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));
  currentPolygon.set({ points: fabricPoints, hasBorders: true, hasControls: true });
  currentPolygon.setBoundingBox(true);
  currentPolygon.setCoords();
  canvas.renderAll();
}

function updatePolygonPreview(pointer, shiftKey = false) {
  if (!currentPolygon || currentPoints.length === 0) return;

  const previewEnd = (shiftKey && currentPoints.length > 0)
    ? snapToAngle(currentPoints[currentPoints.length - 1], pointer)
    : pointer;

  const fabricPoints = [...currentPoints, previewEnd].map(p => ({ x: p.x, y: p.y }));
  currentPolygon.set({ points: fabricPoints });
  currentPolygon.setBoundingBox(true);
  currentPolygon.setCoords();
  canvas.requestRenderAll();
}

function finishPolygonDrawing() {
  // The dblclick always fires AFTER two mouse:down events, so the second click
  // of the double-click has already added an unwanted extra point — remove it.
  currentPoints.pop();

  if (!currentPolygon || currentPoints.length < 3) {
    console.warn('Need at least 3 points to create polygon');
    if (currentPolygon) {
      canvas.remove(currentPolygon);
    }
    resetPolygonDrawing();
    return;
  }
  
  // Remove the temporary polygon (with wrong coordinates)
  canvas.remove(currentPolygon);
  
  // Get selected label
  const selectedLabelId = getCurrentSelectedLabel();
  const label = resolveAnnotationLabel(selectedLabelId);

  // SIMPLE APPROACH: Use original points, prevent Fabric.js offset
  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));

  // Create polygon with original points
  const finalPolygon = new Polygon(fabricPoints, {
    fill: getLabelColorWithOpacity(label.color, label.opacity),
    stroke: label.color,
    strokeWidth: label.strokeWidth || 2,
    objectType: 'annotation',
    annotationType: 'polygon',
    userCreated: true,
    selectable: true,
    evented: true,
    labelId: selectedLabelId,
    objectLabel: selectedLabelId,
    hasControls: true,
    hasBorders: true,
    objectCaching: true
  });

  canvas.add(finalPolygon);
  canvas.renderAll();
  
  // Create text label with delay to ensure annotation is fully stabilized
  setTimeout(() => {
    createSingleTextLabel(finalPolygon);
    saveHistorySnapshot();
  }, 10);

  resetPolygonDrawing();
}

function resetPolygonDrawing() {
  drawingMode = false;
  currentPolygon = null;
  currentPoints = [];
  hideDrawDistance();
}

/**
 * Polygon Vertex Editing
 */

// Returns the absolute canvas position of vertex i of a polygon
function getVertexAbsPosition(polygon, i) {
  const p = polygon.points[i];
  return util.transformPoint(
    { x: p.x - polygon.pathOffset.x, y: p.y - polygon.pathOffset.y },
    polygon.calcTransformMatrix()
  );
}

// Moves vertex i to absolute canvas position (canvasX, canvasY)
function updatePolygonVertex(polygon, pointIndex, canvasX, canvasY) {
  const invMatrix = util.invertTransform(polygon.calcTransformMatrix());
  const local = util.transformPoint({ x: canvasX, y: canvasY }, invMatrix);

  // Save bounding-box top-left BEFORE changing the point.
  // polygon.left is the LEFT EDGE (not the center), so minX = pathOffset.x - width/2.
  const oldMinX = polygon.pathOffset.x - polygon.width  / 2;
  const oldMinY = polygon.pathOffset.y - polygon.height / 2;

  polygon.points[pointIndex] = {
    x: local.x + polygon.pathOffset.x,
    y: local.y + polygon.pathOffset.y,
  };

  // Recalculate bounding box (updates pathOffset/width/height, without repositioning).
  polygon.setBoundingBox(false);
  _applyBoundingBoxShift(polygon, oldMinX, oldMinY);
}

function enterPolygonEditMode(polygon) {
  if (editingPolygon) exitPolygonEditMode();
  editingPolygon = polygon;

  polygon.lockMovementX = true;
  polygon.lockMovementY = true;
  polygon.hasControls = false;
  polygon.hasBorders = false;

  // Visual edit-mode indicator (dashed only for closed shapes, not lines)
  polygon._origStrokeWidth = polygon.strokeWidth;
  polygon.set('strokeWidth', polygon.strokeWidth + 1);
  if (polygon.annotationType === 'polygon') {
    polygon.set('strokeDashArray', [6, 3]);
  }

  refreshVertexHandles();
  canvas.discardActiveObject();
  canvas.renderAll();
}

function exitPolygonEditMode() {
  if (!editingPolygon) return;

  vertexHandles.forEach(h => canvas.remove(h));
  vertexHandles = [];

  editingPolygon.lockMovementX = false;
  editingPolygon.lockMovementY = false;
  editingPolygon.hasControls = true;
  editingPolygon.hasBorders = true;
  editingPolygon.set('strokeWidth', editingPolygon._origStrokeWidth ?? 2);
  editingPolygon.set('strokeDashArray', null);
  editingPolygon.setCoords();

  updateLinkedTextLabelPosition(editingPolygon);

  editingPolygon = null;

  saveHistorySnapshot();
  canvas.renderAll();
}

// Rebuild all vertex + midpoint handles for the current editingPolygon
function refreshVertexHandles() {
  if (!editingPolygon) return;
  vertexHandles.forEach(h => canvas.remove(h));
  vertexHandles = [];

  const pts = editingPolygon.points;
  const isClosedShape = editingPolygon.annotationType === 'polygon';
  const n = pts.length;

  pts.forEach((p, i) => {
    const abs = getVertexAbsPosition(editingPolygon, i);

    // Full vertex handle (draggable)
    const handle = new Circle({
      left: abs.x, top: abs.y,
      originX: 'center', originY: 'center',
      radius: 6,
      fill: '#1976d2', stroke: '#ffffff', strokeWidth: 2,
      objectType: 'vertexHandle', pointIndex: i,
      hasBorders: false, hasControls: false,
      hoverCursor: 'crosshair', moveCursor: 'crosshair',
      selectable: true, evented: true,
    });
    vertexHandles.push(handle);
    canvas.add(handle);

    // Midpoint handle between vertex i and i+1
    const hasNext = isClosedShape ? true : i < n - 1;
    if (hasNext) {
      const nextI = isClosedShape ? (i + 1) % n : i + 1;
      const nextAbs = getVertexAbsPosition(editingPolygon, nextI);
      const mid = new Circle({
        left: (abs.x + nextAbs.x) / 2,
        top:  (abs.y + nextAbs.y) / 2,
        originX: 'center', originY: 'center',
        radius: 5,
        fill: '#ffffff', stroke: '#1976d2', strokeWidth: 2,
        opacity: 0.8,
        objectType: 'midpointHandle', midIndex: i,
        hasBorders: false, hasControls: false,
        lockMovementX: true, lockMovementY: true,
        hoverCursor: 'copy',
        selectable: true, evented: true,
      });
      vertexHandles.push(mid);
      canvas.add(mid);
    }
  });

  canvas.renderAll();
}

// Reposition the midpoint handles adjacent to a moved vertex (avoids full refresh during drag)
function updateAdjacentMidpoints(pointIndex) {
  if (!editingPolygon) return;
  const pts = editingPolygon.points;
  const n   = pts.length;
  const isPolygon = editingPolygon.annotationType === 'polygon';

  vertexHandles.forEach(h => {
    if (h.objectType !== 'midpointHandle') return;
    const mi    = h.midIndex;
    const nextI = isPolygon ? (mi + 1) % n : mi + 1;
    if (mi === pointIndex || nextI === pointIndex) {
      const a = getVertexAbsPosition(editingPolygon, mi);
      const b = getVertexAbsPosition(editingPolygon, nextI);
      h.set({ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 });
      h.setCoords();
    }
  });
}

// Shared helper to adjust left/top after points array changed and setBoundingBox
// was called. Shift left/top by Δ(minX) — not Δ(pathOffset) — so every unchanged
// vertex stays on the same canvas pixel even when the bbox width/height changes.
function _applyBoundingBoxShift(obj, oldMinX, oldMinY) {
  const newMinX = obj.pathOffset.x - obj.width  / 2;
  const newMinY = obj.pathOffset.y - obj.height / 2;
  obj.left += newMinX - oldMinX;
  obj.top  += newMinY - oldMinY;
  obj.dirty = true; // points were mutated directly — invalidate Fabric's object cache
  obj.setCoords();
}

// Insert a new vertex at the midpoint handle position
function insertVertexAtMidpoint(midHandle) {
  const insertIndex = midHandle.midIndex + 1;
  const oldMinX = editingPolygon.pathOffset.x - editingPolygon.width  / 2;
  const oldMinY = editingPolygon.pathOffset.y - editingPolygon.height / 2;

  const invMatrix = util.invertTransform(editingPolygon.calcTransformMatrix());
  const local = util.transformPoint({ x: midHandle.left, y: midHandle.top }, invMatrix);
  editingPolygon.points.splice(insertIndex, 0, {
    x: local.x + editingPolygon.pathOffset.x,
    y: local.y + editingPolygon.pathOffset.y,
  });

  editingPolygon.setBoundingBox(false);
  _applyBoundingBoxShift(editingPolygon, oldMinX, oldMinY);
  refreshVertexHandles();
}

// Delete vertex at pointIndex (respects minimum vertex count)
function deleteVertex(pointIndex) {
  const minPts = editingPolygon.annotationType === 'polygon' ? 3 : 2;
  if (editingPolygon.points.length <= minPts) return;

  const oldMinX = editingPolygon.pathOffset.x - editingPolygon.width  / 2;
  const oldMinY = editingPolygon.pathOffset.y - editingPolygon.height / 2;

  editingPolygon.points.splice(pointIndex, 1);

  editingPolygon.setBoundingBox(false);
  _applyBoundingBoxShift(editingPolygon, oldMinX, oldMinY);
  refreshVertexHandles();
}

/**
 * Line Drawing Functions - Multi-segment perimeter tool
 */
function addLinePoint(pointer, e) {
  if (!canvas || isProcessingClick) return;

  isProcessingClick = true;

  // Shift held → snap to nearest 22.5° angle from last point
  const pt = (e?.shiftKey && currentPoints.length > 0)
    ? snapToAngle(currentPoints[currentPoints.length - 1], pointer)
    : pointer;

  // Add point to current line sequence
  currentPoints.push(pt);
  
  if (currentPoints.length === 1) {
    // First point - start line sequence
    startLineDrawing();
    drawingMode = true; // Enable mouse move for preview
  } else {
    // Additional point - extend the line sequence
    updateLineFromPoints();
  }
  
  setTimeout(() => { isProcessingClick = false; }, 50);
}

function startLineDrawing() {
  if (!canvas || currentPoints.length === 0) return;
    
  // Get current selected label and its color
  const selectedLabelId = getCurrentSelectedLabel();
  const label = resolveAnnotationLabel(selectedLabelId, true);

  // Create initial polyline with first point duplicated to make it visible
  const firstPoint = currentPoints[0];
  const points = [
    { x: firstPoint.x, y: firstPoint.y },
    { x: firstPoint.x + 1, y: firstPoint.y + 1 } // Slightly offset to make it visible
  ];

  currentLine = new Polyline(points, {
    fill: '',
    stroke: label.color,
    strokeWidth: label.strokeWidth || 2,
    objectType: 'annotation',
    annotationType: 'line',
    userCreated: true,
    selectable: currentTool === 'select',
    evented: currentTool === 'select',
    objectCaching: false, // true = verbessert performance und objekte werden schneller gerendert
    absolutePositioned: true, // Wichtig, dass Objekt anhand der canvas-Koordinaten positioniert wird
    clipPath: null, // null = keine Einschränkung bei der Grösse des Polygons. 
    width: canvas.width,
    height: canvas.height
  });
  
  canvas.add(currentLine);
  canvas.renderAll();
}

function updateLineFromPoints() {
  if (!currentLine || currentPoints.length < 2) return;

  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));
  currentLine.set({ points: fabricPoints });
  currentLine.setBoundingBox(true);
  currentLine.setCoords();
  canvas.renderAll();
}

function updateLinePreview(pointer, shiftKey = false) {
  if (!currentLine || currentPoints.length === 0) return;

  const previewEnd = (shiftKey && currentPoints.length > 0)
    ? snapToAngle(currentPoints[currentPoints.length - 1], pointer)
    : pointer;

  const fabricPoints = [...currentPoints, previewEnd].map(p => ({ x: p.x, y: p.y }));
  currentLine.set({ points: fabricPoints });
  currentLine.setBoundingBox(true);
  currentLine.setCoords();
  canvas.requestRenderAll();
}

function finishLineDrawing() {
  // Same as finishPolygonDrawing: dblclick fires after two mouse:down events,
  // so the second click always adds an unwanted extra point — remove it.
  currentPoints.pop();

  if (!currentLine || currentPoints.length < 2) {
    console.warn('Need at least 2 points to create line sequence');
    if (currentLine) {
      canvas.remove(currentLine);
    }
    resetLineDrawing();
    return;
  }
  
  // Remove the temporary line (with wrong coordinates)
  canvas.remove(currentLine);
    
  // Get selected label
  const selectedLabelId = getCurrentSelectedLabel();
  const label = resolveAnnotationLabel(selectedLabelId, true);

  // SIMPLE APPROACH: Use original points, prevent Fabric.js offset
  const fabricPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));

  // Create polyline with original points
  const finalLine = new Polyline(fabricPoints, {
    fill: '',
    stroke: label.color,
    strokeWidth: label.strokeWidth || 2,
    objectType: 'annotation',
    annotationType: 'line',
    selectable: true,
    evented: true,
    labelId: selectedLabelId,
    objectLabel: selectedLabelId,
    hasControls: true,
    hasBorders: true,
    objectCaching: false   // endpoint dots (drawn in _render) must not clip at the bbox
  });

  canvas.add(finalLine);
  canvas.renderAll();
  
  // Create text label with delay to ensure annotation is fully stabilized
  setTimeout(() => {
    createSingleTextLabel(finalLine);
    saveHistorySnapshot();
  }, 10);

  resetLineDrawing();
}

function resetLineDrawing() {
  drawingMode = false;
  currentLine = null;
  currentPoints = [];
  hideDrawDistance();
}

// ─────────────────────────────────────────────────────────────────────────────
// Bemassung (CAD-style dimension) — a pure helper with its own objectType
// 'dimension'. It is NEVER an annotation, so it never appears in the results
// table, summary or label manager (all of those filter objectType==='annotation').
//
// Each dimension is a Fabric Group of: 2 witness (extension) lines, the dimension
// line, 2 end ticks and the centred measurement text. After placement it can be
// selected, moved (position only — scaling/rotation locked) and deleted. Its
// canonical geometry lives in group.dimData (image pixels) so save/load, scale
// changes and PDF export all reconstruct it deterministically.
// ─────────────────────────────────────────────────────────────────────────────

const DIM_COLOR  = '#333333';   // technical grey, deliberately independent of label colours
// Base values for A4 — buildDimensionGroup() scales them by getAutoFontScale().
const DIM_STROKE = 1;
const DIM_GAP    = 6;           // gap between measured point and start of witness line
const DIM_EXT    = 6;           // witness-line overshoot past the dimension line
const DIM_TICK   = 9;           // length of the 45° end ticks
const DIM_FONT   = 13;

// Signed perpendicular distance from the p1→p2 line to a pointer (the parallel offset).
function dimOffsetFromPointer(p1, p2, pointer) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  return (pointer.x - p1.x) * nx + (pointer.y - p1.y) * ny;
}

function dimMeasurementText(baseLenPx) {
  return `${(baseLenPx * getPixelToMeterFactor()).toFixed(2)} m`;
}

// Derive full geometry (image px) from two base points + a signed offset.
function computeDimGeometry(p1, p2, offset) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;   // unit along p1→p2
  const nx = -uy, ny = ux;              // unit normal
  const d1 = { x: p1.x + nx * offset, y: p1.y + ny * offset };
  const d2 = { x: p2.x + nx * offset, y: p2.y + ny * offset };
  return { p1, p2, d1, d2, offset, baseLenPx: len, ux, uy, nx, ny };
}

// Build the Fabric group from a dimData record { p1, p2, offset, [color] }.
function buildDimensionGroup(dimData) {
  const g = computeDimGeometry(dimData.p1, dimData.p2, dimData.offset);
  const s = Math.sign(g.offset) || 1;
  const color = dimData.color || DIM_COLOR;
  const parts = [];
  const k = getAutoFontScale();
  const gap = DIM_GAP * k, ext = DIM_EXT * k, tick = DIM_TICK * k, strokeW = DIM_STROKE * k;

  // Witness (extension) lines: from just off each measured point to just past d.
  const w1a = { x: g.p1.x + g.nx * gap * s, y: g.p1.y + g.ny * gap * s };
  const w1b = { x: g.d1.x + g.nx * ext * s, y: g.d1.y + g.ny * ext * s };
  const w2a = { x: g.p2.x + g.nx * gap * s, y: g.p2.y + g.ny * gap * s };
  const w2b = { x: g.d2.x + g.nx * ext * s, y: g.d2.y + g.ny * ext * s };
  parts.push(new Line([w1a.x, w1a.y, w1b.x, w1b.y], { stroke: color, strokeWidth: strokeW }));
  parts.push(new Line([w2a.x, w2a.y, w2b.x, w2b.y], { stroke: color, strokeWidth: strokeW }));

  // Dimension line d1 → d2
  parts.push(new Line([g.d1.x, g.d1.y, g.d2.x, g.d2.y], { stroke: color, strokeWidth: strokeW }));

  // 45° architectural ticks at each end (direction = along + normal)
  const tl = Math.hypot(g.ux + g.nx, g.uy + g.ny) || 1;
  const tux = (g.ux + g.nx) / tl * tick / 2;
  const tuy = (g.uy + g.ny) / tl * tick / 2;
  parts.push(new Line([g.d1.x - tux, g.d1.y - tuy, g.d1.x + tux, g.d1.y + tuy], { stroke: color, strokeWidth: strokeW }));
  parts.push(new Line([g.d2.x - tux, g.d2.y - tuy, g.d2.x + tux, g.d2.y + tuy], { stroke: color, strokeWidth: strokeW }));

  // Measurement text, centred on the dimension line, rotated to the line angle.
  let deg = Math.atan2(g.uy, g.ux) * 180 / Math.PI;
  if (deg > 90 || deg < -90) deg += 180;   // keep upright
  const text = new Text(dimMeasurementText(g.baseLenPx), {
    left: (g.d1.x + g.d2.x) / 2, top: (g.d1.y + g.d2.y) / 2,
    originX: 'center', originY: 'center',
    angle: deg,
    fontSize: DIM_FONT * k, fontFamily: 'Arial', fontWeight: 'bold',
    fill: color, backgroundColor: 'rgba(255,255,255,0.85)',
    __dimText: true,
  });
  parts.push(text);

  const group = new Group(parts, {
    objectType: 'dimension',
    selectable: currentTool === 'select',
    evented:    currentTool === 'select',
    hasControls: false,       // move only — no resize/rotate handles
    hasBorders: true,
    lockScalingX: true, lockScalingY: true, lockRotation: true,
    objectCaching: false,
  });
  // Canonical geometry (image px) — single source of truth for save/PDF/refresh.
  // `text` is stored too so the PDF export (no access to the scale inputs) can
  // render the measurement without recomputing it.
  group.dimData = {
    p1: { ...g.p1 }, p2: { ...g.p2 }, d1: { ...g.d1 }, d2: { ...g.d2 },
    offset: g.offset, baseLenPx: g.baseLenPx, color, text: text.text,
  };
  group.__dimLeft0 = group.left;
  group.__dimTop0  = group.top;
  return group;
}

// Fold a whole-group move back into dimData so the stored geometry stays canonical.
function bakeDimensionMove(group) {
  const dx = group.left - group.__dimLeft0;
  const dy = group.top  - group.__dimTop0;
  if (dx || dy) {
    const d = group.dimData;
    for (const k of ['p1', 'p2', 'd1', 'd2']) {
      d[k] = { x: d[k].x + dx, y: d[k].y + dy };
    }
  }
  group.__dimLeft0 = group.left;
  group.__dimTop0  = group.top;
}

// Recompute the measurement text of all dimensions after a scale/format change.
function refreshAllDimensions() {
  if (!canvas) return;
  canvas.getObjects().filter(o => o.objectType === 'dimension').forEach(group => {
    const txt = group.getObjects().find(c => c.__dimText);
    if (txt && group.dimData) {
      const str = dimMeasurementText(group.dimData.baseLenPx);
      txt.set('text', str);
      group.dimData.text = str;
      group.dirty = true;
    }
  });
  canvas.requestRenderAll();
}

function serializeDimensions() {
  if (!canvas) return [];
  return canvas.getObjects()
    .filter(o => o.objectType === 'dimension' && o.dimData)
    .map(g => ({ ...g.dimData }));
}

function serializeTextNotes() {
  if (!canvas) return [];
  return canvas.getObjects()
    .filter(o => o.objectType === 'textNote')
    .map(t => {
      const o = t.toObject(['objectType', 'userCreated']);
      o.objectType = 'textNote';
      return o;
    });
}

// Rebuild text notes (Fabric Textboxes) from their serialized form.
async function rebuildTextNotes(serialized) {
  if (!canvas || !serialized?.length) return;
  const notes = await util.enlivenObjects(serialized);
  notes.filter(Boolean).forEach(n => {
    n.set({
      objectType: 'textNote', editable: true,
      selectable: currentTool === 'select', evented: currentTool === 'select',
    });
    canvas.add(n);
  });
}

function clearDimPreview() {
  if (dimPreview) { canvas.remove(dimPreview); dimPreview = null; }
}

function resetDimDrawing() {
  clearDimPreview();
  dimPhase = 0;
  dimP1 = null;
  dimP2 = null;
  drawingMode = false;
  hideDrawDistance();
}

// 3-click flow: click 1 → start, click 2 → end, click 3 → place at current offset.
function dimHandleClick(pointer, e) {
  if (!canvas || isProcessingClick) return;
  isProcessingClick = true;

  if (dimPhase === 0) {
    dimP1 = { x: pointer.x, y: pointer.y };
    dimPhase = 1;
    drawingMode = true;                    // enable mouse:move preview
  } else if (dimPhase === 1) {
    const pt = e?.shiftKey ? snapToAngle(dimP1, pointer) : pointer;
    dimP2 = { x: pt.x, y: pt.y };
    dimPhase = 2;
  } else if (dimPhase === 2) {
    const offset = dimOffsetFromPointer(dimP1, dimP2, pointer);
    clearDimPreview();
    canvas.add(buildDimensionGroup({ p1: dimP1, p2: dimP2, offset, color: DIM_COLOR }));
    applyLayerOrdering();
    canvas.requestRenderAll();
    saveHistorySnapshot();
    resetDimDrawing();
  }

  setTimeout(() => { isProcessingClick = false; }, 50);
}

function dimHandleMove(pointer, e) {
  if (!canvas) return;
  clearDimPreview();

  if (dimPhase === 1) {
    const pt = e?.shiftKey ? snapToAngle(dimP1, pointer) : pointer;
    const k = getAutoFontScale();
    dimPreview = new Line([dimP1.x, dimP1.y, pt.x, pt.y], {
      stroke: DIM_COLOR, strokeWidth: DIM_STROKE * k, strokeDashArray: [4 * k, 4 * k],
      selectable: false, evented: false, objectType: 'dimensionPreview',
    });
    canvas.add(dimPreview);
  } else if (dimPhase === 2) {
    const offset = dimOffsetFromPointer(dimP1, dimP2, pointer);
    dimPreview = buildDimensionGroup({ p1: dimP1, p2: dimP2, offset, color: DIM_COLOR });
    dimPreview.set({ selectable: false, evented: false, objectType: 'dimensionPreview' });
    canvas.add(dimPreview);
  }
  canvas.requestRenderAll();
}

// ── Dimension edit mode ───────────────────────────────────────────────────────
// Double-click a placed dimension to show handles: the two endpoints (change the
// measured span) and one on the dimension line (drag the parallel offset). Mirrors
// the polygon vertex-edit UX but standalone, since a dimension is a Group.

function enterDimensionEditMode(group) {
  if (editingPolygon) exitPolygonEditMode();
  if (editingDimension) exitDimensionEditMode();
  editingDimension = group;

  group.lockMovementX = true;
  group.lockMovementY = true;
  group.hasControls = false;
  group.hasBorders = false;

  refreshDimHandles();
  canvas.discardActiveObject();
  canvas.renderAll();
}

function exitDimensionEditMode() {
  if (!editingDimension) return;

  dimHandles.forEach(h => canvas.remove(h));
  dimHandles = [];

  editingDimension.lockMovementX = false;
  editingDimension.lockMovementY = false;
  editingDimension.hasBorders = true;
  editingDimension.setCoords();
  editingDimension = null;

  applyLayerOrdering();       // restore z-order (rebuilt group sat on top during editing)
  saveHistorySnapshot();
  canvas.renderAll();
}

function makeDimHandle(pos, role) {
  const isOffset = role === 'offset';
  const h = new Circle({
    left: pos.x, top: pos.y,
    originX: 'center', originY: 'center',
    radius: isOffset ? 5 : 6,
    fill:   isOffset ? '#ffffff' : '#1976d2',
    stroke: isOffset ? '#1976d2' : '#ffffff',
    strokeWidth: 2,
    opacity: isOffset ? 0.85 : 0.55,   // slightly transparent so the line stays visible
    objectType: 'dimHandle', dimRole: role,
    hasBorders: false, hasControls: false,
    hoverCursor: 'crosshair', moveCursor: 'crosshair',
    selectable: true, evented: true,
  });
  dimHandles.push(h);
  canvas.add(h);
  return h;
}

function refreshDimHandles() {
  if (!editingDimension) return;
  dimHandles.forEach(h => canvas.remove(h));
  dimHandles = [];
  const d = editingDimension.dimData;
  makeDimHandle(d.p1, 'p1');
  makeDimHandle(d.p2, 'p2');
  makeDimHandle({ x: (d.d1.x + d.d2.x) / 2, y: (d.d1.y + d.d2.y) / 2 }, 'offset');
  canvas.renderAll();
}

// Live-update while dragging a handle: recompute dimData, rebuild the group and
// reposition the *other* handles (never the one Fabric is currently dragging).
function updateDimensionFromHandle(handle, shiftKey = false) {
  if (!editingDimension) return;
  const d = { ...editingDimension.dimData };

  if (handle.dimRole === 'p1' || handle.dimRole === 'p2') {
    // Shift → snap the dragged endpoint's angle (rel. to the fixed one) to 22.5°
    // steps, mirroring the drawing behaviour, and move the handle onto the snap.
    const anchor = handle.dimRole === 'p1' ? d.p2 : d.p1;
    const raw = { x: handle.left, y: handle.top };
    const p = shiftKey ? snapToAngle(anchor, raw) : raw;
    d[handle.dimRole] = p;
    if (shiftKey) { handle.set({ left: p.x, top: p.y }); handle.setCoords(); }
  } else if (handle.dimRole === 'offset') {
    d.offset = dimOffsetFromPointer(d.p1, d.p2, { x: handle.left, y: handle.top });
  }

  const newGroup = buildDimensionGroup(d);
  newGroup.lockMovementX = true;
  newGroup.lockMovementY = true;
  newGroup.hasControls = false;
  newGroup.hasBorders = false;

  canvas.remove(editingDimension);
  canvas.add(newGroup);
  editingDimension = newGroup;

  const nd = newGroup.dimData;
  dimHandles.forEach(h => {
    if (h === handle) return;             // leave the dragged handle to Fabric
    if (h.dimRole === 'p1')      h.set({ left: nd.p1.x, top: nd.p1.y });
    else if (h.dimRole === 'p2') h.set({ left: nd.p2.x, top: nd.p2.y });
    else if (h.dimRole === 'offset') h.set({ left: (nd.d1.x + nd.d2.x) / 2, top: (nd.d1.y + nd.d2.y) / 2 });
    h.setCoords();
  });
  dimHandles.forEach(h => canvas.bringObjectToFront(h)); // keep handles above the rebuilt group
}

// ── Text field ("Textfeld") ───────────────────────────────────────────────────
// Drag to define the box width, then type inside (Fabric Textbox, word-wrapped).
// Own objectType 'textNote' — a note, never a measured annotation.

// Base values for A4 — finishTextDrawing() scales them by getAutoFontScale().
const TEXTNOTE_FONT   = 18;
const TEXTNOTE_COLOR  = '#222222';
const TEXTNOTE_BG     = 'rgba(255,255,255,0.82)';   // legible over busy plans
const TEXTNOTE_MIN_W  = 60;
const TEXTNOTE_DEF_W  = 180;                         // fallback when the drag is tiny

function startTextDrawing(pointer) {
  if (!canvas) return;
  drawingMode = true;
  textStartPoint = { x: pointer.x, y: pointer.y };
  textPreviewRect = new Rect({
    left: pointer.x, top: pointer.y, width: 0, height: 0,
    fill: 'rgba(25,118,210,0.08)', stroke: '#1976d2', strokeWidth: 1,
    strokeDashArray: [4, 4], selectable: false, evented: false,
    objectType: 'textPreview',
  });
  canvas.add(textPreviewRect);
}

function updateTextDrawing(pointer) {
  if (!textPreviewRect || !textStartPoint) return;
  const w = pointer.x - textStartPoint.x;
  const h = pointer.y - textStartPoint.y;
  textPreviewRect.set({
    width: Math.abs(w), height: Math.abs(h),
    left: w < 0 ? pointer.x : textStartPoint.x,
    top:  h < 0 ? pointer.y : textStartPoint.y,
  });
  canvas.requestRenderAll();
}

function finishTextDrawing() {
  if (!textPreviewRect || !textStartPoint) return;

  const k     = getAutoFontScale();
  const left  = textPreviewRect.left;
  const top   = textPreviewRect.top;
  const width = Math.max(textPreviewRect.width, TEXTNOTE_MIN_W * k) || TEXTNOTE_DEF_W * k;

  canvas.remove(textPreviewRect);
  textPreviewRect = null;
  textStartPoint = null;
  drawingMode = false;

  const box = new Textbox('', {
    left, top, width,
    fontSize: TEXTNOTE_FONT * k, fontFamily: 'Arial', fill: TEXTNOTE_COLOR,
    backgroundColor: TEXTNOTE_BG,
    objectType: 'textNote', userCreated: true,
    editable: true, selectable: true, evented: true,
    lockScalingFlip: true,
  });
  canvas.add(box);

  // Switch to select so the note is immediately movable after typing, then start
  // editing on the next tick (after the current mouse:up settles).
  setTool('select');
  setTimeout(() => {
    canvas.setActiveObject(box);
    box.enterEditing();
    canvas.requestRenderAll();
  }, 10);
}

function resetTextDrawing() {
  if (textPreviewRect) { canvas?.remove(textPreviewRect); textPreviewRect = null; }
  textStartPoint = null;
  drawingMode = false;
}

/**
 * Create a text label for a single new annotation without affecting others
 */
function createSingleTextLabel(annotation, { batch = false } = {}) {
  if (!annotation || !canvas) return;
  
  // Generate unique ID for linking
  const linkId = `annotation_${Date.now()}_${Math.random()}`;
  
  // Set ID on annotation
  annotation.set('id', linkId);
  
  // Assign stable display index if not already set
  if (!annotation.displayIndex) {
    const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
    const existingIndices = annotations
      .filter(ann => ann.displayIndex)
      .map(ann => ann.displayIndex);
    
    // Find next available index
    let nextIndex = 1;
    while (existingIndices.includes(nextIndex)) {
      nextIndex++;
    }
    
    annotation.displayIndex = nextIndex;
  }
  
  // Get annotation color
  const labelColor = annotation.stroke || annotation.fill || '#000000';

  // Store label text (number + area/length) on annotation so PDF export can access it
  const labelText = buildLabelText(annotation);
  annotation.set('labelText', labelText);

  // Perf-Experiment: Labels aus → kein Text-Objekt erzeugen (labelText oben bleibt
  // gesetzt, daher funktionieren Tabelle und PDF-Export weiter). Tabellen-/Summary-
  // Updates im Nicht-Batch-Fall trotzdem ausführen.
  if (!SHOW_TEXT_LABELS) {
    if (!batch) {
      applyLayerOrdering();   // keep new annotations behind dimensions/text notes
      canvas.renderAll();
      updateResultsTable();
      updateSummary();
    }
    return null;
  }

  // Calculate position
  const labelPosition = calculateLabelPosition(annotation);

  // Create text label with number and area/length (no inverse scaling)
  const k = getAutoFontScale();
  const textLabel = new Text(labelText, {
    left: labelPosition.x,
    top: labelPosition.y,
    fontSize: 14 * k, // A4-Basis, skaliert mit Seitengrösse — Zoom macht der Canvas
    fontFamily: 'Arial', // sonst fällt Fabric auf Times New Roman (Serif) zurück
    fill: getContrastTextColor(labelColor),
    backgroundColor: labelColor,
    padding: 4 * k,
    textAlign: 'center',
    fontWeight: 'bold',
    originX: 'center',
    originY: 'center',
    selectable: false,
    evented: false,
    objectType: 'textLabel',
    linkedAnnotationId: linkId
  });

  canvas.add(textLabel);
  if (!batch) {
    applyLayerOrdering();
    canvas.renderAll();
    updateResultsTable();
    updateSummary();
  }

  return textLabel;
}

/**
 * Update position of linked text label - zoom-safe synchronization
 */
function updateLinkedTextLabelPosition(annotation) {
  if (!canvas || !annotation.id) return;
  
  // Find the linked text label
  const textLabel = canvas.getObjects().find(obj => 
    obj.objectType === 'textLabel' && obj.linkedAnnotationId === annotation.id
  );
  
  if (textLabel) {
    // Recalculate position and area/length after object modification
    const newPosition = calculateLabelPosition(annotation);
    const labelText = buildLabelText(annotation);

    // Sync text label color with annotation color
    const annotationColor = annotation.stroke || annotation.fill || '#000000';

    // Update position, text content, and color
    annotation.set('labelText', labelText);
    textLabel.set({
      left: newPosition.x,
      top: newPosition.y,
      text: labelText,
      backgroundColor: annotationColor,
      fill: getContrastTextColor(annotationColor)
    });
  }
}

/**
 * Refresh measurement text on all canvas labels after scale/format change.
 */
function refreshAllCanvasLabels() {
  if (!canvas) return;
  canvas.getObjects()
    .filter(obj => obj.objectType === 'annotation' && obj.id)
    .forEach(annotation => updateLinkedTextLabelPosition(annotation));
  canvas.renderAll();
}

/**
 * Recalculate all annotation indices in order of creation or position
 * @param {string} sortBy - 'creation' (default) or 'position' (left-to-right, top-to-bottom)
 */
function recalculateAllIndices(sortBy = 'creation') {
  if (!canvas) return;
  
  // Get all annotations
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  
  if (annotations.length === 0) return;
  
  // Sort annotations based on preference
  let sortedAnnotations;
  if (sortBy === 'position') {
    // Sort by position: first by top (y), then by left (x)
    sortedAnnotations = [...annotations].sort((a, b) => {
      const aTop = a.top || 0;
      const bTop = b.top || 0;
      const aLeft = a.left || 0;
      const bLeft = b.left || 0;
      
      // If same row (within 50px), sort by left position
      if (Math.abs(aTop - bTop) < 50) {
        return aLeft - bLeft;
      }
      return aTop - bTop;
    });
  } else {
    // Sort by creation order (keep existing order in canvas)
    sortedAnnotations = annotations;
  }
  
  // Reassign display indices
  sortedAnnotations.forEach((annotation, index) => {
    annotation.displayIndex = index + 1;
    
    // Update linked text label
    updateLinkedTextLabelPosition(annotation);
  });
  
  // Update UI
  canvas.renderAll();
  updateResultsTable();
  updateSummary();
  
  // Show confirmation
  const statusDiv = document.createElement('div');
  statusDiv.className = 'save-status';
  statusDiv.textContent = `${annotations.length} Annotationen neu nummeriert`;
  statusDiv.style.backgroundColor = '#4CAF50';
  document.body.appendChild(statusDiv);
  
  setTimeout(() => {
    statusDiv.style.opacity = '0';
    setTimeout(() => statusDiv.remove(), 500);
  }, 2000);
}

/**
 * Calculate total length of a polyline (multiple connected segments)
 * @param {Array} points - Array of {x,y} points
 * @returns {number} Total length in meters
 */
function calculatePolylineLength(points) {
  if (points.length < 2) return 0;
  
  const pixelToMeter = getPixelToMeterFactor();
  
  // Canvas coordinates are now 1:1 with natural coordinates (no conversion needed)
  const naturalPoints = points;
  
  // Calculate total length by summing all segments
  let totalLength = 0;
  
  for (let i = 0; i < naturalPoints.length - 1; i++) {
    const dx = naturalPoints[i+1].x - naturalPoints[i].x;
    const dy = naturalPoints[i+1].y - naturalPoints[i].y;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);
    totalLength += segmentLength;
  }
  
  // Convert to meters
  const lengthInMeters = totalLength * pixelToMeter;
  
  return lengthInMeters;
}

/**
 * Collect current canvas annotations in Fabric.js format for saving
 * Multi-Page version: collects data for the current page
 * @param {string} pageId - The current page's stable id (pdf-handler.js manifest)
 * @returns {Object} Canvas data with all annotations and metadata for this page
 */
function collectCurrentCanvasData(pageId = currentPageId) {
  if (!canvas) {
    console.warn('No canvas available for data collection');
    return {
      page_id: pageId,
      canvas_annotations: [],
      annotation_count: 0,
      canvas_available: false
    };
  }

  // Zoom-Debounce flushen: Labels könnten gerade ausgeblendet sein — visible:false
  // darf nicht in die serialisierten canvas_text_labels gelangen.
  restoreTextLabelsAfterZoom();

  // Eine aktive Mehrfachauswahl (ActiveSelection) auflösen, BEVOR serialisiert wird.
  // In einer ActiveSelection speichert Fabric left/top (und scale/angle) der Kinder
  // RELATIV zum Auswahl-Mittelpunkt. toObject() liefert dann diese relativen Werte
  // (~0), nicht die absoluten Canvas-Koordinaten – die Annotationen würden beim
  // Neuladen am Ursprung (oben links/rechts) kleben, während ihre Text-Labels (nie
  // Teil der Auswahl) korrekt am alten Ort bleiben. discardActiveObject() backt die
  // volle Gruppen-Transformation wieder absolut in jedes Objekt zurück. Deckt alle
  // Speicherpfade ab (Seitenwechsel, ZIP-Save, Analyse-Merge).
  if (canvas.getActiveObject()) {
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }

  // Get all annotations from canvas (exclude background image and text labels)
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');

  // Convert canvas objects to serializable format with all custom properties
  const canvasAnnotations = annotations.map(annotation => {
    const customProperties = [
      'id',               // Stable ID used to link text labels
      'displayIndex',     // Our stable index system
      'labelId',          // Label assignment
      'objectLabel',      // Alternative label field
      'userCreated',      // User vs AI created flag
      'linkedAnnotationId',
      'annotationType',   // Type: rectangle, polygon, line
      'score',            // AI confidence score (0–1)
      'labelText',        // Text label content (number + area) for PDF export
    ];

    const fabricObject = annotation.toObject(customProperties);
    fabricObject.objectType = 'annotation';
    fabricObject.saved_at = new Date().toISOString();

    return fabricObject;
  });

  // Serialize text labels with their current positions (supports user-moved labels later)
  const textLabelObjects = canvas.getObjects().filter(obj => obj.objectType === 'textLabel');
  const canvasTextLabels = textLabelObjects.map(tl =>
    tl.toObject(['objectType', 'linkedAnnotationId', 'text', 'backgroundColor', 'fill'])
  );

  // Dimension helpers: persist their canonical geometry (image px) — rebuilt via
  // buildDimensionGroup on load. Not annotations, so kept in a separate array.
  const canvasDimensions = serializeDimensions();

  // Text notes: full Fabric Textbox serialization (text, width, font, colours …).
  const canvasTextNotes = serializeTextNotes();

  // On-plan legend: persist position only — content is derived from annotations
  const legendObj = canvas.getObjects().find(obj => obj.objectType === 'legend');

  return {
    page_id: pageId,
    canvas_annotations: canvasAnnotations,
    canvas_text_labels: canvasTextLabels,
    canvas_dimensions: canvasDimensions,
    canvas_text_notes: canvasTextNotes,
    legend_position: legendObj ? { left: legendObj.left, top: legendObj.top } : null,
    annotation_count: annotations.length,
    canvas_available: true,
    canvas_zoom: canvas.getZoom(),
    canvas_viewport: canvas.viewportTransform,
    image_width: uploadedImage?.naturalWidth ?? null,
    image_height: uploadedImage?.naturalHeight ?? null,
    saved_at: new Date().toISOString()
  };
}

/**
 * Save current canvas state to page-specific storage
 * @param {string} pageId - Page id to save to
 */
function saveCurrentPageCanvasData(pageId = currentPageId) {
  if (canvas && pageId != null) {
    const canvasData = collectCurrentCanvasData(pageId);
    pageCanvasData[pageId] = canvasData;
    console.log(`Saved canvas data for page ${pageId}: ${canvasData.annotation_count} annotations`);
  }
}

/**
 * Load canvas data for a specific page
 * @param {string} pageId - Page id to load
 */
function loadPageCanvasData(pageId) {
  const canvasData = pageCanvasData[pageId];
  if (canvasData && canvasData.canvas_available) {
    console.log(`Loading canvas data for page ${pageId}: ${canvasData.annotation_count} annotations`);
    loadCanvasData(canvasData);
  } else {
    console.log(`No canvas data available for page ${pageId}`);
    // Clear canvas for empty page
    if (canvas) {
      canvas.clear();
      initCanvas();
    }
  }
}

/**
 * Set current page id and handle page switching
 * @param {string} pageId - New current page id
 */
function setCurrentPage(pageId) {
  if (pageId !== currentPageId) {
    // Save current page before switching
    saveCurrentPageCanvasData(currentPageId);

    // Switch to new page
    currentPageId = pageId;
    setCurrentPageId(pageId);
    console.log(`Switched to page ${currentPageId}`);
  }
}

/**
 * Initialize page canvas data from loaded project data
 * @param {Object} projectCanvasData - Canvas data from loaded project
 */
function initializePageCanvasData(projectCanvasData) {
  // Multi-page format: load all pages (keyed by pageId)
  pageCanvasData = { ...projectCanvasData.pages };
  currentPageId = getPageManifest()[0]?.id ?? null;
  setCurrentPageId(currentPageId);
  // Clear the previous project's canvas immediately (mirrors onUploadReady):
  // its annotations must never linger visibly or be collected into the new data.
  if (canvas) canvas.clear();
  console.log(`Initialized ${Object.keys(pageCanvasData).length} pages of canvas data`);
}

/**
 * Collect Canvas data for ALL pages in a multi-page project
 * @returns {Object} Canvas data organized by page id, plus the page manifest
 *   (order + source-PDF mapping) needed to reconstruct duplicate/delete/reorder.
 */
function collectAllPagesCanvasData() {
  // Save current page first
  saveCurrentPageCanvasData(currentPageId);

  const manifest = getPageManifest();

  return {
    format: 'multi_page_canvas_v2',
    total_pages: manifest.length,
    pages: { ...pageCanvasData }, // Include all pages with data
    page_manifest: manifest.map(({ id, sourcePdfIndex, sourcePageIndex, width_mm, height_mm }) => ({ id, sourcePdfIndex, sourcePageIndex, width_mm, height_mm })),
    current_page_id: currentPageId,
    saved_at: new Date().toISOString()
  };
}

/**
 * Analyze the currently displayed page with the AI model.
 * Reads session_id and settings from current state.
 * Does NOT auto-trigger – only runs when the user clicks the button.
 */
async function analyzeCurrentPage() {
  if (READ_ONLY) { alert(READ_ONLY_MSG); return; }
  const btn = document.getElementById('runDetectionBtn');
  const loader = document.getElementById('loader');
  const errorMessage = document.getElementById('errorMessage');
  const analyzePageId = currentPageId;
  // The server addresses pages by their position within the ORIGINAL PDF they
  // came from (uploads/page_<sourcePdfIndex>_<sourcePageIndex>.jpg) — that's
  // sourcePageIndex/sourcePdfIndex, not the display position, which can differ
  // after duplicate/delete/reorder or when pages were appended from another PDF.
  const analyzeEntry = getPageEntry(analyzePageId);
  const analyzePageNum = analyzeEntry?.sourcePageIndex;
  const analyzeSourceIndex = analyzeEntry?.sourcePdfIndex ?? 1;

  // UI: busy state FIRST – set the "Analysiert…" spinner immediately on click,
  // before any (possibly slow) work like re-uploading the PDF for project-loaded
  // plans, so the user gets instant feedback. The finally below restores the button.
  if (btn) { btn.disabled = true; btn.classList.add('analyzing'); btn.innerHTML = '<svg class="btn-spinner" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="4" stroke-dasharray="11 9"/></svg> Analysiert…'; }
  if (loader) loader.style.display = 'block';
  if (errorMessage) errorMessage.style.display = 'none';

  try {
    let sessionId;
    try {
      // Re-establishes a server session (re-uploading every source PDF, in
      // order) for projects loaded from ZIP that were never analyzed yet.
      sessionId = await ensureServerSession();
    } catch (e) {
      alert('Analyse nicht möglich: ' + e.message);
      return; // finally restores the button
    }

    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('page', analyzePageNum);
    formData.append('source_index', analyzeSourceIndex);
    formData.append('format_width',  document.getElementById('formatWidth')?.value  || 210);
    formData.append('format_height', document.getElementById('formatHeight')?.value || 297);
    formData.append('dpi',           document.getElementById('dpi')?.value           || 150);
    formData.append('plan_scale',    document.getElementById('planScale')?.value     || 100);
    formData.append('threshold',     document.getElementById('threshold')?.value     || 0.5);

    const response = await fetch('/analyze_page', { method: 'POST', body: formData, headers: { 'X-CSRFToken': getCsrfToken() } });
    if (!response.ok) {
      // 502/503/504 = gunicorn-Timeout (300s) bzw. Server ausgelastet -> keine JSON-Antwort,
      // daher eigene, verständliche Meldung statt generischem "Analyse fehlgeschlagen".
      if ([502, 503, 504].includes(response.status)) {
        throw new Error('Die Analyse hat zu lange gedauert oder der Server ist gerade ausgelastet. '
          + 'Bitte in einem Moment erneut versuchen, sehr grosse Pläne ggf. verkleinern oder einen Ausschnitt hochladen.');
      }
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Analyse fehlgeschlagen.');
    }

    const data = await response.json();
    window.plausible?.('Analyse durchgeführt');

    // Convert AI predictions → canvas annotations and MERGE them with what is
    // already on the page (instead of wiping everything):
    //   - keep every user-drawn annotation, plus AI annotations of OTHER labels
    //   - drop previous AI annotations of the SAME target label (re-run overwrites)
    //   - skip new AI boxes that sit on top of a user annotation (user wins)
    if (data.predictions && data.predictions.length > 0) {
      const aiSelect = document.getElementById('aiLabelSelect');
      const targetLabelId = aiSelect?.value ? parseInt(aiSelect.value) : null;

      const existing = collectCurrentCanvasData(analyzePageId);

      // Keep: all user annotations + AI annotations of a different label
      const kept = existing.canvas_annotations.filter(a =>
        a.userCreated === true || a.labelId !== targetLabelId
      );

      // Bounding boxes of user annotations of the SAME target label (from live
      // objects → robust for any type). Only same-label user annotations block a
      // new detection: a user-drawn "Wand" must not stop a "Fenster" from being
      // detected at the same spot.
      const userBoxes = canvas.getObjects()
        .filter(o => o.objectType === 'annotation' && o.userCreated === true && o.labelId === targetLabelId)
        .map(o => {
          const r = o.getBoundingRect();
          return { x1: r.left, y1: r.top, x2: r.left + r.width, y2: r.top + r.height };
        });

      // New AI annotations: first drop AI-vs-AI duplicates (keep highest score),
      // then drop those overlapping a same-label user annotation
      const aiData = convertPredictionsToCanvasData(data.predictions, analyzePageId);
      const dedupedAi = dedupeAnnotationsByScore(aiData.canvas_annotations);
      const filteredAi = dedupedAi.filter(a => {
        const box = specBBox(a);
        return !box || !userBoxes.some(u => boxesOverlap(box, u));
      });
      // Fresh index/id so AI numbering continues after the kept annotations
      filteredAi.forEach(a => { delete a.displayIndex; delete a.id; });

      const merged = {
        ...existing,
        canvas_annotations: [...kept, ...filteredAi],
        annotation_count: kept.length + filteredAi.length,
        // Restore saved labels only for kept annotations; AI boxes get fresh ones
        canvas_text_labels: (existing.canvas_text_labels || []).filter(tl =>
          kept.some(a => a.id === tl.linkedAnnotationId)
        )
      };

      loadCanvasData(merged);
      pageCanvasData[analyzePageId] = merged;
    }

    updateResultsTable();
    updateSummary();

    // Mark as done in sidebar

  } catch (err) {
    console.error('Analyse-Fehler:', err);
    if (errorMessage) {
      // fetch wirft TypeError, wenn die Verbindung abbricht (z.B. Timeout bei sehr
      // grossem Plan oder überlastetem Server) – dann verständliche statt kryptischer Meldung.
      const isNetwork = err instanceof TypeError;
      errorMessage.textContent = isNetwork
        ? 'Verbindung zum Server unterbrochen (evtl. Timeout bei sehr grossem Plan oder Auslastung). Bitte erneut versuchen.'
        : 'Fehler: ' + err.message;
      errorMessage.style.display = 'block';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('analyzing');
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><circle cx="5.5" cy="5.5" r="3.5"/><line x1="8.5" y1="8.5" x2="11.5" y2="11.5"/></svg> Erkennen';
    }
    if (loader) loader.style.display = 'none';
  }
}

/**
 * Initialize application
 */
async function initApp() {
  
  // Fabric.js is now available through ES6 imports
  
  // Get DOM elements
  imageContainer = document.getElementById('imageContainer');
  uploadedImage = document.getElementById('uploadedImage');

  // Label tooltip setup
  createLabelTooltip();
  document.addEventListener('mousemove', (e) => {
    lastMouseClientX = e.clientX;
    lastMouseClientY = e.clientY;
  });
  
   // ── New upload flow: called by upload-modal.js after successful /upload ──
  // The page manifest itself is already built by upload-modal.js (it owns the
  // /upload response) before this fires — see initPageManifestFromUpload().
  window.onUploadReady = function(uploadInfo) {
    console.log('Upload ready:', uploadInfo);

    setPdfSessionId(uploadInfo.session_id);

    // Full reset for new upload – clear all previous project state
    pageCanvasData   = {};
    setAllSourcePdfBlobs({});

    // Pre-initialise a settings block for EVERY page from the detected PDF sizes,
    // so settings.json is complete and the per-page format survives save/reload –
    // even for pages the user never opens (lazy init previously left them blank,
    // which dropped their real format on reload). DPI/scale/AI-label use the same
    // UI defaults that page 1 gets on first visit.
    const initialSettings = {};
    for (const entry of getPageManifest()) {
      initialSettings[entry.id] = {
        format_width:  entry.width_mm  ?? 210,
        format_height: entry.height_mm ?? 297,
        dpi:           parseFloat(document.getElementById('dpi')?.value)        || 150,
        plan_scale:    parseFloat(document.getElementById('planScale')?.value)  || 100,
        ai_label:      parseInt(document.getElementById('aiLabelSelect')?.value) || null,
      };
    }
    setPageSettings(initialSettings);

    // Track original PDF blob (source 1) so it can be included in ZIP saves and PDF export
    if (uploadInfo.is_pdf && uploadInfo.original_file) {
      setSourcePdfBlob(1, uploadInfo.original_file);
    }
    if (canvas) canvas.clear();

    // Show results section + enable toolbar
    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) resultsSection.style.display = 'block';

    // Enable "Analyze page" button
    const analyzeBtn = document.getElementById('analyzeCurrentPageBtn');
    if (analyzeBtn) analyzeBtn.disabled = false;

    // Navigate to the first page (just display image, no analysis)
    currentPageId = null; // force navigateToPageNoAnalysis to treat this as a real switch
    navigateToPageNoAnalysis(getPageManifest()[0]?.id);
  };

  /**
   * Editor komplett auf den Ausgangszustand ("Noch kein Plan geladen") zurücksetzen.
   * Aufgerufen von "+ Neu" in der Sidebar und "+ Neues Projekt" in der Projekt-
   * übersicht (upload-modal.js), BEVOR der PDF-Dialog aufgeht — bricht der Nutzer
   * ihn ab, bleibt so kein altes Projekt (Canvas/Ergebnis-Spalte) sichtbar zurück.
   */
  window.planliResetEditor = function() {
    if (editingPolygon)   exitPolygonEditMode();
    if (editingDimension) exitDimensionEditMode();
    if (canvas) { canvas.dispose(); canvas = null; }
    // dispose() setzt das nackte <canvas> zurück ins DOM (siehe initCanvas)
    document.getElementById('annotationCanvas')?.remove();
    document.getElementById('scrollSpacer')?.remove();
    if (uploadedImage) {
      uploadedImage.onload = null;
      uploadedImage.removeAttribute('src');
      uploadedImage.style.display = 'none';
    }
    const emptyState = document.getElementById('canvasEmptyState');
    if (emptyState) emptyState.style.display = '';

    pageCanvasData  = {};
    currentPageId   = null;
    selectedObjects = [];
    initHistory();
    resetPdfState();

    // Ergebnis-Spalte zurück auf die Platzhalter des App-Starts
    const summary = document.getElementById('summary');
    if (summary) summary.innerHTML = '<p><em>Keine Analyse durchgeführt.</em></p>';
    const resultsBody = document.getElementById('resultsBody');
    if (resultsBody) resultsBody.innerHTML = '<tr><td colspan="6" style="text-align:center; '
      + 'color:#999; font-style:italic; padding:20px;">'
      + 'Laden Sie eine Datei hoch und analysieren Sie eine Seite.</td></tr>';
    const analyzeBtn = document.getElementById('analyzeCurrentPageBtn');
    if (analyzeBtn) analyzeBtn.disabled = true;
  };

  /** Persist current UI field values into pageSettings for the given page. */
  function saveCurrentPageSettings(pageId) {
    if (pageId == null) return;
    const current = getPageSettings();
    current[pageId] = {
      format_width:  parseFloat(document.getElementById('formatWidth')?.value)  || 210,
      format_height: parseFloat(document.getElementById('formatHeight')?.value) || 297,
      dpi:           parseFloat(document.getElementById('dpi')?.value)           || 150,
      plan_scale:    parseFloat(document.getElementById('planScale')?.value)     || 100,
      ai_label:      parseInt(document.getElementById('aiLabelSelect')?.value)   || null
    };
    setPageSettings(current);
  }

  /** Restore saved pageSettings into UI fields for the given page. */
  function loadPageSettingsToUI(pageId) {
    const settings = getPageSettings();
    const s = settings[pageId];
    if (!s) return;
    const fw    = document.getElementById('formatWidth');
    const fh    = document.getElementById('formatHeight');
    const dpi   = document.getElementById('dpi');
    const scale = document.getElementById('planScale');
    if (fw    && s.format_width  != null) fw.value    = s.format_width;
    if (fh    && s.format_height != null) fh.value    = s.format_height;
    if (dpi   && s.dpi           != null) dpi.value   = s.dpi;
    if (scale && s.plan_scale    != null) scale.value = s.plan_scale;
    // Restore AI target label if it still exists in the label list
    const aiSel = document.getElementById('aiLabelSelect');
    if (aiSel && s.ai_label != null && aiSel.querySelector(`option[value="${s.ai_label}"]`)) {
      aiSel.value = s.ai_label;
    }
    // Keep sidebar dropdown in sync
    if (s.plan_scale != null) setPageScaleInSidebar(pageId, s.plan_scale);
  }

  /**
   * Navigate to a page without running the AI – just show the image.
   * Called from the left sidebar page list and from onUploadReady.
   */
  function navigateToPageNoAnalysis(pageId) {
    const entry = getPageEntry(pageId);
    if (!entry) return;
    const imageUrl = entry.imageUrl;
    if (!imageUrl) return;

    // Save current page settings before switching
    if (currentPageId != null && currentPageId !== pageId) {
      saveCurrentPageSettings(currentPageId);
    }

    // Update page state (saves the outgoing page's canvas data, sets currentPageId)
    setCurrentPage(pageId);

    // Sync sidebar highlight
    setActivePageInList(pageId);

    // Restore per-page settings (format, DPI, scale) – falls back to the manifest's
    // detected size for fresh/never-visited pages
    const savedSettings = getPageSettings();
    if (savedSettings[pageId]) {
      loadPageSettingsToUI(pageId);
    } else {
      // First visit: initialise from PDF-detected page size + current DPI/scale defaults
      if (entry.width_mm != null) {
        const fw = document.getElementById('formatWidth');
        const fh = document.getElementById('formatHeight');
        if (fw) fw.value = entry.width_mm;
        if (fh) fh.value = entry.height_mm;
      }
      // Persist these initial values so they're included in ZIP saves
      saveCurrentPageSettings(pageId);
    }

    // Load image into canvas. Das HTML-<img> bleibt versteckt – Fabric rendert es
    // als Canvas-Hintergrund. Würde man es hier auf 'block' schalten, blitzt beim
    // Seitenwechsel kurz das ALTE Bitmap in 1:1-Originalgrösse auf, bis die neue
    // src geladen ist und initCanvas es wieder ausblendet.
    uploadedImage.style.display = 'none';
    // Empty-State ausblenden, sobald ein Plan angezeigt wird
    const emptyState = document.getElementById('canvasEmptyState');
    if (emptyState) emptyState.style.display = 'none';
    uploadedImage.onload = function() {
      // Check if we already have canvas data for this page (e.g. after analysis)
      if (pageCanvasData[pageId]) {
        loadPageCanvasData(pageId);
      } else {
        // Empty canvas – just show the image
        if (canvas) {
          canvas.clear();
        }
        initCanvas();
        pageCanvasData[pageId] = {
          page_id: pageId,
          canvas_annotations: [],
          annotation_count: 0,
          canvas_available: true
        };
      }
      updateResultsTable();
      updateSummary();
      // Reset undo/redo history for each new page
      setTimeout(() => { initHistory(); saveHistorySnapshot(); }, 200);
    };
    // No cache-busting: a page's rendered JPG never changes within a session
    // (re-analysis only touches annotations, not the image) — letting the
    // browser cache it means revisiting a page is instant and works offline.
    uploadedImage.src = imageUrl;
  }
  // Expose for upload-modal page-click callback
  window.navigateToPageNoAnalysis = navigateToPageNoAnalysis;

  /**
   * Called by upload-modal.js after "Seiten anhängen" successfully rendered
   * an additional PDF (Seiten-Management "Anhängen"). The new manifest
   * entries exist already — this only needs pageSettings for them (same
   * defaults as a fresh upload) and to jump to the first appended page.
   */
  window.onPagesAppended = function(newEntries) {
    if (!newEntries || !newEntries.length) return;
    const settings = getPageSettings();
    for (const entry of newEntries) {
      settings[entry.id] = {
        format_width:  entry.width_mm  ?? 210,
        format_height: entry.height_mm ?? 297,
        dpi:           parseFloat(document.getElementById('dpi')?.value)        || 150,
        plan_scale:    parseFloat(document.getElementById('planScale')?.value)  || 100,
        ai_label:      parseInt(document.getElementById('aiLabelSelect')?.value) || null,
      };
    }
    setPageSettings(settings);
    navigateToPageNoAnalysis(newEntries[0].id);
  };

  /**
   * Handle a page action from the sidebar (Duplizieren/Löschen/Reihenfolge).
   * Always flushes the live canvas + UI settings into storage first, so an
   * operation on the currently active page picks up its latest state.
   */
  function handlePageAction(action, pageId) {
    saveCurrentPageCanvasData(currentPageId);
    saveCurrentPageSettings(currentPageId);

    if (action === 'duplicate') {
      const newEntry = duplicatePageInManifest(pageId);
      if (!newEntry) return;
      // Full duplicate — Massstab, Annotationen, Legende etc. — see CLAUDE.md
      // "Seiten-Management": each entry is independent after this.
      if (pageCanvasData[pageId]) {
        pageCanvasData[newEntry.id] = structuredClone(pageCanvasData[pageId]);
      }
      const settings = getPageSettings();
      if (settings[pageId]) {
        settings[newEntry.id] = structuredClone(settings[pageId]);
        setPageSettings(settings);
      }
      rebuildSidebarPageList();
      navigateToPageNoAnalysis(newEntry.id);
      return;
    }

    if (action === 'delete') {
      const position = getPageIndexById(pageId);
      if (!confirm(`Seite ${position} wirklich löschen?`)) return;

      const wasCurrent = pageId === currentPageId;
      let fallbackId = null;
      if (wasCurrent) {
        const manifest = getPageManifest();
        const idx = manifest.findIndex(e => e.id === pageId);
        fallbackId = manifest[idx + 1]?.id ?? manifest[idx - 1]?.id ?? null;
      }
      if (!deletePageFromManifest(pageId)) {
        alert('Die letzte Seite kann nicht gelöscht werden.');
        return;
      }
      delete pageCanvasData[pageId];
      rebuildSidebarPageList();
      if (wasCurrent && fallbackId) {
        currentPageId = null; // force a real switch even though the id looks "new" to us
        navigateToPageNoAnalysis(fallbackId);
      }
      return;
    }

    if (action === 'up' || action === 'down') {
      movePageInManifest(pageId, action === 'up' ? -1 : 1);
      rebuildSidebarPageList();
    }
  }
  
  // Editor is always active - setup canvas events when canvas is ready
  // Canvas events will be set up in initCanvas() when editor is active
  
  // Legende auf dem Plan ein-/ausblenden
  document.getElementById('legendBtn')?.addEventListener('click', toggleCanvasLegend);

  // Fenster-erkennen-Modal: Einstellungen ("Erkennen als" + Schwelle), Auslöser
  // und Erkennungsliste leben hier. Der Toolbar-Button öffnet das Modal.
  const windowDetectModal = document.getElementById('windowDetectModal');
  const openDetectModal = () => {
    if (READ_ONLY) { alert(READ_ONLY_MSG); return; }
    if (!windowDetectModal) return;
    updateDetectionTable();          // show the persisted list for this page
    windowDetectModal.style.display = 'block';
  };
  const closeDetectModal = () => {
    if (windowDetectModal) windowDetectModal.style.display = 'none';
  };
  document.getElementById('windowDetectClose')?.addEventListener('click', closeDetectModal);
  windowDetectModal?.addEventListener('click', (e) => {
    if (e.target === windowDetectModal) closeDetectModal();
  });
  document.getElementById('runDetectionBtn')?.addEventListener('click', analyzeCurrentPage);
  document.getElementById('removeAiAnnotationsBtn')?.addEventListener('click', removeAllAiAnnotations);
  // Toolbar button now opens the modal instead of analyzing directly
  document.getElementById('analyzeCurrentPageBtn')?.addEventListener('click', openDetectModal);

  // Setup tool buttons initially
  setupToolButtons();

  // Track held drawing-tool keys for scroll-to-cycle
  document.addEventListener('keydown', function(e) {
    if (READ_ONLY) return;
    const key = e.key.toLowerCase();
    if ((key === 'q' || key === 'w' || key === 'e') && !e.ctrlKey && !e.metaKey) {
      heldDrawingKey = key;
    }
  });
  document.addEventListener('keyup', function(e) {
    const key = e.key.toLowerCase();
    if (key === heldDrawingKey) heldDrawingKey = null;
  });

  // Warnung vor versehentlichem Schliessen/Neuladen, sobald Annotationen vorliegen.
  // Projekte werden nur clientseitig als ZIP gesichert – ohne diese Abfrage gingen
  // Markierungen beim Schliessen verlustlos verloren. Nur warnen, wenn es wirklich
  // etwas zu verlieren gibt (live auf der aktuellen Seite ODER auf anderen Seiten),
  // sonst nervt der Dialog bei jedem Schliessen. Den angezeigten Text gibt der
  // Browser vor – er ist nicht anpassbar.
  window.addEventListener('beforeunload', (e) => {
    const liveWork   = canvas && canvas.getObjects().some(o => o.objectType === 'annotation');
    const storedWork = Object.values(pageCanvasData).some(p => p && p.annotation_count > 0);
    if (liveWork || storedWork) {
      e.preventDefault();
      e.returnValue = ''; // für Chrome/Safari erforderlich, um den Dialog auszulösen
    }
  });

  // Show a "copy" cursor while Ctrl/Alt is held in select mode, to hint that
  // dragging a selection now duplicates it (the copy is dropped on first move).
  const updateDupCursor = (e) => {
    if (!canvas || currentTool !== 'select') return;
    const dup = e.ctrlKey || e.altKey;
    canvas.hoverCursor = dup ? 'copy' : 'move';
    canvas.moveCursor  = dup ? 'copy' : 'default';
  };
  document.addEventListener('keydown', updateDupCursor);
  document.addEventListener('keyup', updateDupCursor);

  // Keyboard shortcuts for tools
  document.addEventListener('keydown', function(e) {
    // Don't fire when typing in an input, textarea or select
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Projektübersicht (Cloud-Dashboard) offen: der Editor dahinter ist unsichtbar,
    // seine Shortcuts würden blind wirken (z.B. Ctrl+S den verdeckten Zustand
    // speichern). Alles sperren; bei Ctrl+S/O zusätzlich den Browser-Dialog verhindern.
    if (document.body.classList.contains('dashboard-open')) {
      if ((e.ctrlKey || e.metaKey) && ['s', 'S', 'o', 'O'].includes(e.key)) e.preventDefault();
      return;
    }

    // Read-Only: alle bearbeitenden Shortcuts sperren (Undo/Redo, Kopieren/
    // Einfügen, Löschen, Pfeil-Verschieben, Werkzeuge, Label-Manager).
    // Erlaubt bleiben nur Ansicht-Aktionen: Speichern/Öffnen, Escape, Hilfe.
    if (READ_ONLY) {
      const allowed = e.key === 'Escape' || e.key === '?'
        || ((e.ctrlKey || e.metaKey) && ['s', 'S', 'o', 'O'].includes(e.key));
      if (!allowed) return;
    }

    // Ctrl / Cmd shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' || e.key === 'Z') {
        if (e.shiftKey) { redoHistory(); } else { undoHistory(); }
        e.preventDefault(); return;
      }
      if (e.key === 'c' || e.key === 'C') { copySelectedAnnotations();  e.preventDefault(); return; }
      if (e.key === 'x' || e.key === 'X') { cutSelectedAnnotations();   e.preventDefault(); return; }
      if (e.key === 'v' || e.key === 'V') { pasteAnnotations();         e.preventDefault(); return; }
      if (e.key === 's' || e.key === 'S') { document.getElementById('saveProjectBtn')?.click(); e.preventDefault(); return; }
      if (e.key === 'o' || e.key === 'O') { document.getElementById('loadProjectBtn')?.click(); e.preventDefault(); return; }
      return; // don't let other Ctrl+key combos trigger tool shortcuts
    }

    // Arrow keys: move selected annotations, otherwise let browser scroll
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      if (currentTool === 'select' && selectedObjects.length > 0) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
        selectedObjects.forEach(obj => {
          if (obj.objectType !== 'annotation') return;
          obj.set({ left: (obj.left || 0) + dx, top: (obj.top || 0) + dy });
          obj.setCoords();
          updateLinkedTextLabelPosition(obj);
        });
        canvas.requestRenderAll();
        saveHistorySnapshot();
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 's': case 'S': setTool('select');    break;
      case 'q': case 'Q': setTool('rectangle'); break;
      case 'w': case 'W': setTool('polygon');   break;
      case 'e': case 'E': setTool('line');      break;
      case 'd': case 'D': setTool('dimension'); break;
      case 'f': case 'F': setTool('text');      break;
      case 'l': case 'L': {
        const modal = document.getElementById('labelManagerModal');
        if (modal && modal.style.display === 'block') { closeLabelManager(); }
        else { document.getElementById('manageLabelBtn')?.click(); }
        break;
      }
      case '?': toggleShortcutsModal(); break;
      case '1': case '2': case '3': case '4': case '5':
      case '6': case '7': case '8': case '9': {
        const idx = parseInt(e.key) - 1;
        const sel = document.getElementById('universalLabelSelect');
        if (sel && sel.options[idx]) {
          sel.value = sel.options[idx].value;
          sel.dispatchEvent(new Event('change'));
          updateLabelQuickList();
        }
        break;
      }
      case 't': case 'T':
      case 'Delete':
      case 'Backspace':
        if (editingPolygon) {
          const activeHandle = canvas.getActiveObject();
          if (activeHandle?.objectType === 'vertexHandle') {
            deleteVertex(activeHandle.pointIndex);
            e.preventDefault();
            break;
          }
        }
        // In dimension edit mode, Delete removes the whole dimension (never a handle).
        if (editingDimension) {
          const g = editingDimension;
          dimHandles.forEach(h => canvas.remove(h));
          dimHandles = [];
          editingDimension = null;
          canvas.remove(g);
          canvas.renderAll();
          saveHistorySnapshot();
          e.preventDefault();
          break;
        }
        deleteSelectedObjects();
        e.preventDefault();
        break;
      case 'Escape': {
        const shortcutsModal = document.getElementById('shortcutsModal');
        if (shortcutsModal && shortcutsModal.style.display === 'block') { toggleShortcutsModal(); break; }
        const detectModal = document.getElementById('windowDetectModal');
        if (detectModal && detectModal.style.display === 'block') { detectModal.style.display = 'none'; break; }
        const modal = document.getElementById('labelManagerModal');
        if (modal && modal.style.display === 'block') { closeLabelManager(); break; }
        if (editingPolygon) { exitPolygonEditMode(); break; }
        if (editingDimension) { exitDimensionEditMode(); break; }
        // First Escape cancels in-progress drawing; otherwise it clears the
        // current selection; failing that it falls back to the select tool.
        if ((currentTool === 'polygon' || currentTool === 'line' || currentTool === 'dimension' || currentTool === 'text') && drawingMode) {
          cleanupCurrentTool();
          resetAllDrawingStates();
          canvas?.renderAll();
        } else if (canvas?.getActiveObject()) {
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        } else {
          setTool('select');
        }
        break;
      }
    }
  });

  // Setup shortcuts modal
  function toggleShortcutsModal() {
    const modal = document.getElementById('shortcutsModal');
    if (!modal) return;
    modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
  }
  document.getElementById('shortcutsBtn')?.addEventListener('click', toggleShortcutsModal);
  document.getElementById('shortcutsModalClose')?.addEventListener('click', toggleShortcutsModal);
  document.getElementById('shortcutsModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('shortcutsModal')) toggleShortcutsModal();
  });

  // Setup recalculate indices button
  const recalculateBtn = document.getElementById('recalculateIndicesBtn');
  if (recalculateBtn) {
    recalculateBtn.addEventListener('click', function() {
      // Ask user for sorting preference
      const sortByPosition = confirm(
        'Möchten Sie die Nummern nach Position sortieren?\n\n' +
        'OK = Nach Position (links-rechts, oben-unten)\n' +
        'Abbrechen = Nach Erstellungsreihenfolge'
      );
      
      const sortBy = sortByPosition ? 'position' : 'creation';
      recalculateAllIndices(sortBy);
    });
  }
  
  // Setup universal label dropdown change listener
  const universalLabelSelect = document.getElementById('universalLabelSelect');
  if (universalLabelSelect) {
    universalLabelSelect.addEventListener('change', function() {
      // If there's a selected object, apply the label change immediately
      if (currentTool === 'select' && selectedObjects.length > 0) {
        applyLabelChangeToSelectedObject();
      }
      // Show label name near cursor
      const labelId = parseInt(universalLabelSelect.value);
      const label = getLabel(labelId);
      if (label) showLabelTooltip(label.name, label.color);
    });
  }
    
  // Initialize upload handler (left column drop zone)
  setupUploadModal();

  // Wire sidebar page-click → navigate without auto-analysis
  setOnPageClick((pageId) => {
    navigateToPageNoAnalysis(pageId);
  });

  // When user changes scale in sidebar → update hidden input + pageSettings + canvas labels
  setOnScaleChange((pageId, scale) => {
    const scaleInput = document.getElementById('planScale');
    if (scaleInput) scaleInput.value = scale;
    const current = getPageSettings();
    const existing = current[pageId] || {};
    current[pageId] = { ...existing, plan_scale: scale };
    setPageSettings(current);
    // Refresh canvas labels and results table with new scale
    refreshAllCanvasLabels();
    refreshAllDimensions();
    updateResultsTable();
    updateSummary();
  });

  // Wire sidebar page actions: Duplizieren/Löschen/Reihenfolge
  setOnPageAction(handlePageAction);

  // Wire "Fenster erkennen" button

  
  // Initialize labels module (async)
  await setupLabels({
    labelManagerModal: document.getElementById('labelManagerModal'),
    manageLabelBtn: document.getElementById('manageLabelBtn'),
    closeModalBtn: document.querySelector('#labelManagerModal .close'),
    labelTableBody: document.getElementById('labelTableBody'),
    addLabelBtn: document.getElementById('addLabelBtn'),
    importLabelsBtn: document.getElementById('importLabelsBtn'),
    exportLabelsBtn: document.getElementById('exportLabelsBtn')
  });
  
  // Initialize project management module
  setupProject({
    projectList: document.getElementById('projectList'),
    saveProjectBtn: document.getElementById('saveProjectBtn'),
    loadProjectBtn: document.getElementById('loadProjectBtn'),
    exportPdfBtn: document.getElementById('exportPdfBtn'),
    exportAnnotatedPdfBtn: document.getElementById('exportAnnotatedPdfBtn')
  }, {
    pdfModule: {
      getPdfSessionId,
      getPageSettings,
      getAllPdfPages,
      getPageManifest,
      setPdfSessionId,
      setPageSettings,
      setPageManifest,
      getAllSourcePdfBlobs,
      setAllSourcePdfBlobs
    }
  });

  // Einführungs-Modal (zeigt sich beim ersten Besuch automatisch)
  setupOnboarding();

  // Make essential functions globally available for inter-module communication
  window.collectAllPagesCanvasData = collectAllPagesCanvasData;
  window.initializePageCanvasData = initializePageCanvasData;
  // 1-based display position (not the internal pageId) — used e.g. for bug reports
  window.getCurrentPageNumber = () => getPageIndexById(currentPageId);
  // JPEG of the currently visible canvas viewport (used by bug reports)
  window.getCanvasScreenshotBlob = async () => {
    if (!canvas) return null;
    try {
      // Crop away the overscan margin so the screenshot shows just the viewport.
      const dataUrl = canvas.toDataURL({
        format: 'jpeg',
        quality: 0.8,
        left: OVERSCAN,
        top: OVERSCAN,
        width:  canvas.getWidth()  - 2 * OVERSCAN,
        height: canvas.getHeight() - 2 * OVERSCAN,
      });
      return await (await fetch(dataUrl)).blob();
    } catch (e) {
      console.warn('Canvas screenshot failed:', e);
      return null;
    }
  };
  window.getUploadModalSessionId = () => getUploadSessionId();

  // Used by pdf-export-client.js via project.js and labels.js.
  // Read-only: callers that need the live canvas included must call
  // window.saveCurrentPageCanvas() first (the exports in project.js do).
  // A save side effect here would leak the previous project's canvas into
  // freshly loaded page data when labels.js queries during a ZIP load.
  window.getPageCanvasData = () => ({ ...pageCanvasData });
  window.saveCurrentPageCanvas = () => saveCurrentPageCanvasData(currentPageId);

  // Resize canvas when container size changes (e.g. right panel collapse/expand)
  window.addEventListener('resize', function() {
    if (!canvas || !imageContainer) return;
    const w = imageContainer.clientWidth;
    const h = imageContainer.clientHeight;
    if (w > 0 && h > 0) {
      const bw = w + 2 * OVERSCAN;
      const bh = h + 2 * OVERSCAN;
      canvas.setWidth(bw);
      canvas.setHeight(bh);
      if (canvas.wrapperEl) {
        canvas.wrapperEl.style.width  = bw + 'px';
        canvas.wrapperEl.style.height = bh + 'px';
      }
      canvas.renderAll();
      if (crosshairCanvas) {
        crosshairCanvas.width  = bw;
        crosshairCanvas.height = bh;
        crosshairCanvas.style.width  = bw + 'px';
        crosshairCanvas.style.height = bh + 'px';
      }
    }
  });

  // Update all sidebar scale dropdowns at once (called after ZIP load)
  window.syncAllPageScalesInSidebar = function() {
    const settings = getPageSettings();
    for (const [pageId, s] of Object.entries(settings)) {
      if (s && s.plan_scale != null) setPageScaleInSidebar(pageId, s.plan_scale);
    }
  };

}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
