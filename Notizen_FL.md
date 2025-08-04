Fehler:
- Wenn Seite neu geladen wird ctrl+r und dann direkt ein Projekt geladen wird, wird nur die Seite 1 angezeigt und ich kann nicht hin und her wechseln.
- Polygon wird beendet, indem man in die Nähe des Startpunkts klickt. Evtl Hinweis geben.

train model
- Zu grosse Images können nicht trainiert werden, reduzieren, wenn möglich.
- Im train_model windowdataset, use_preprocessing auf True stellen, um mit vorverarbeiteten Bilder zu trainieren (ist unklar, ob es besser wird, aus meiner Sicht)


# pythonanyhwere sync mit github (lokal).
- Die Pfade sind anders. im app.pyy werden sie über base-dir und projects-dir definiert. da braucht es keine Änderung. 
- im Model_handler.py wurde es auch so gelöst
- Fasterrcnn_modelle müssen vor dem Upload auf pythonanyhwere gesplittet werden (100 MB Grenze):  split -b 50M fasterrcnn_model_2025-04-22-20-04-25.pth model_part_ -> Hochalden auf pythonanyhwere und wieder zusammensetzen ->   cat model_part_* > fasterrcnn_model_2025-04-22-20-04-25.pth


Webapp:
- Fenster Überlappungen entfernen funktioniert noch nicht vollständig. Ist implementiert, funktioniert aber immer noch nicht. 
- In der Tabelle Höhe und Breite von Fenster und Türen ausgeben.
- Bei zu grossen Plänen erkennt es kaum Fenster in der App (hinweis geben, dass kleine Pläne besser funktionieren)
- Evtl am preprocessing mit openCV rumschrauben, um Ergebnisse zu verbessern.
- Evtl. Eingaben in Spalte links (darunter die Tabelle der Ergebniise) machen und Pläne in Spalte rechts (bessere Ansicht auf den Plan).
- Link erstellen lassen für Ansichtsversion, um mit Kollegen oder für Präsi zu teilen.
- Grosses Drag- n Drop in der Mitte des Fenster einbauen
- Oben im Banner eine Action-Button mit Dropdown-Menu einbauen. Darin enthalten, Projekt speichern, Projekt öffnen (Projektlsite wird wieder gross in Mitte dargestellt), hotkeys usw. Ähnlich wie makesense.ai

Hinweise Datenumgang
- Option 1:Aller Erkennungsergebnisse werden im Frontend (JS-mässig) gespeichert. Wenn eine Seite das erste Mal aufgerufen wird, wird sie von fastRccnn analysiert und danach die Ergebnisse um Browser gespeichert (Lazy-Leading). Beim erneuten Besuch der Seite werden die gespeicherten Daten verwendet. Dies erlaubt die Änderungen zu behalten und jede einzelne Seite zu analysieren. 
- Option 2: Beim ersten Öffnen des gesamten PDF-Dateien wird die Analyse durchgeführt und ins Frontend gespeichert (bräuchte am Anfang lang, dafür nachher sehr schnell). Ist vielleicht sinnvoll, wenn oft mit sehr grossen PDF(viele Seiten) gearbeitet wird.
- Option 3: Bearbeitungen im backend zu speichern, verknüpft mit der PDF-Session-ID (gemäss Claude die robusteste Lösung) -> Vermutlich weil Daten im backend gespeichert (Server) bleiben, auch wenn der Browser absützt oder die Sitzung verloren geht. Weitere Vorteile sind geräteübergreifender Zugriff durch die Session-ID. Änderungen bleiben sehr lange erhalten. Zentrale Versionierung (Es können einfacher rühere Bearbeitungszustände wiederhergestellt werden, wichtig bei Versionsänderungen.

- Neu anstatt Lazy-Loading, wird die 1. Seite beim hochladen analysiert und angezeigt. Im Hintergrund werden die restlichen Seiten analyisert, inkl. Status-Nachricht unten links.

Claude schlägt mir folgende Dateistruktur auf dem server vor:

projects/
  └── [project_id]/
      ├── original.pdf                 # Original PDF-Datei
      ├── metadata.json                # Projekt-Metadaten (Name, Datum, Nutzer)
      ├── pages/
      │   ├── page_1.jpg               # Extrahierte Bildseiten
      │   ├── page_2.jpg
      │   └── ...
      └── analysis/
          ├── analysis_settings.json   # Globale Einstellungen
          ├── page_1_results.json      # Analyseergebnisse pro Seite
          ├── page_2_results.json
          └── ...


Projektname: bison (buildingvision), sparrow (weil er immer gegen scheiben fliegt), onlyPlans


# analysis_settings.py
- Dieses File speichert für jede Seite die Breite, Höhe, DPI, Massstab und der Erkennungsschwellenwert.
- Stand 27. April 2025 wird mit dem "Plan analysieren" alle Eigenschaften korrekt gespeichert. Auch wenn ich auf eine andere Seite navigiere und "Aktuelle Seite analysiere" betätige mit anderen Paramter, werden diese korrekt ins JSON eingetragen. 
- Es funktioniert:
    - PDF-Dokument mit unterschiedlichen Formaten hochladen.
    - benutzerdefiniertes Format eingeben und auf einzelner Seite analysieren
    - vordefiniteres Format (A4 und A3) für eine Seite berechnen und abspeichern
    - Veränderungen DPI wird gepseichert
    - Veränderngen beim Massstab werden gepeichert.
    - Veränderungen Treshold werden gespeichert.
- Das Formatauswahlform in der webapp ist nur für den Export der Annotationen auf das Original-PDF. Ansonsten hat es keine Funktion.



# Hinweise Koordinaten
- Es gibt die Natural-Koordinaten (Originalgrösse des Bildes) und die Canvas-Koordinaten (Angezeigte Grösse).
- Natural-Koordinaten: API Kommunikation mit dem Backend, Speichern von Annotations in der Datenbank
- Canvas Koordinanten: fabric.js Drawing und Events, User-Interaktionen (Mausklick, Zeichnen), Canvas-Rendering
- const sind canvasX und canvasY (Umrechnen Natural zu Canvas) und const naturalx und naturaly (Canvas -> Natural). 
- Speichern von User-zeichnungen über const naturalCoord. 
- Die Api/Datenbank arbeitet immer mit der Original-Auflösung (unabhägig vom Browser wird das Bild immer richtig angezeigt). 


# Smoke-Tests
Wie du es benutzt:

  1. Lade deine App und führe eine normale Analyse durch (PDF hochladen, etc.)
  2. Öffne Browser Console (F12 → Console Tab)
  3. Tippe: runSmokeTests()
  4. Schau dir die Ergebnisse an ✅❌

  Was getestet wird:

  🏗️ Grundstruktur:

  - Existieren alle wichtigen DOM-Elemente?
  - Ist die Results-Section sichtbar?
  - Funktioniert das Upload-Form?

  🎨 Canvas & Annotations:

  - Ist Canvas initialisiert und hat die richtige Größe?
  - Sind Annotationen als Groups implementiert?
  - Stimmen die Annotation-Indices überein?

  📊 Daten & Tabelle:

  - Existiert window.data mit Predictions?
  - Hat die Tabelle die richtige Anzahl Zeilen?
  - Sind Hover-Events verbunden?

  🔧 Tools & Editor:

  - Sind alle Tool-Buttons sichtbar?
  - Funktioniert das Label-Dropdown?
  - Ist der Editor immer aktiv?

Wann verwenden:

  - Nach Änderungen am Code
  - Vor wichtigen Demos
  - Wenn etwas "komisch" funktioniert
  - Beim Testen neuer Browser


# Zeichen Elemente Rechteck, Linien und Polygon
Das Planvision-System verwendet tatsächlich zwei verschiedene Koordinatensysteme für Linien und Polygone:

  - **Während der Erstellung:** Absolute Koordinaten (direkte Mauszeiger-Koordinaten)
  - **Nach Abschluss:** Relative Koordinaten (bezogen auf das Objektzentrum)

  Diese Diskrepanz verursacht den "Sprung-Effekt", der im letzten Commit als ungelöstes Problem dokumentiert ist: "Beim Abschluss einer
   Linie oder Polygon, macht die Annotation einen Sprung gegenüber der Zeichenposition."

  Rechtecke haben dieses Problem nicht, da sie durchgehend dasselbe absolute Koordinatensystem verwenden.

Die Eckpunkt einer Linie oder eines Polygon sind relativ zum Zentrum des Objekts. Das Objekt selber ist aber mit dem absoluten Koordinatensystem positioniert

  Objektpositionierung: Absolutes Koordinatensystem
  - left: centerX, top: centerY - das Objekt wird absolut auf dem Canvas positioniert

  Eckpunkte: Relatives Koordinatensystem
  - x: point.x - centerX, y: point.y - centerY - alle Punkte sind relativ zum Objektzentrum

Die Eckpunkte müssen sich auf das Objektzentrum beziehen - das ist eine Anforderung von Fabric.js.

  Warum Zentrum und nicht erster Punkt:

  1. Transformationen: Fabric.js führt Rotationen, Skalierungen und andere Transformationen vom Objektzentrum aus durch
  2. Konsistenz: Alle Fabric.js-Objekte verwenden das Zentrum als Referenzpunkt
  3. Performance: Transformationsmatrizen sind effizienter wenn das Zentrum der Ursprung ist

  Was passiert wenn man den ersten Punkt als Referenz nimmt:
  - Rotationen würden um den ersten Punkt statt um die Objektmitte erfolgen
  - Skalierungen würden das Objekt "wegziehen" statt gleichmäßig vergrößern
  - Transformations-Handles wären falsch positioniert

  Im Code siehst du deshalb auch die explizite Zentrums-Berechnung:
  - Polygone: Bounding-Box-Zentrum (minX + maxX) / 2
  - Linien: Schwerpunkt aller Punkte sum(points) / count

  Das ist eine Design-Entscheidung von Fabric.js die nicht umgangen werden kann.

  Wir verwenden nun _applyPointOffset, was ein internes Fabric.JS Attribut ist (finde es in der Dok allerdings nicht)

  Was ist _applyPointOffset?

  // In Fabric.js Polygon/Polyline Quellcode:
  _applyPointOffset: function() {
      this.points.forEach(function(p) {
          p.x -= this.minX + this.width / 2;  // Punkt um Mittelpunkt zentrieren
          p.y -= this.minY + this.height / 2;
      }, this);
  }

  Warum existiert das?

  Fabric.js Design-Prinzip: Alle Objekte sollen um ihren Mittelpunkt positioniert werden, nicht um ihre Ecken.

  Problem bei Polygonen:
  - Sie geben absolute Koordinaten ein: [{x: 100, y: 50}, {x: 200, y: 150}]
  - Fabric.js will aber: "Mittelpunkt bei (150, 100), Punkte relativ dazu"

  Der Fabric.js Algorithmus:

  // 1. Bei new fabric.Polygon(points):
  initialize: function(points) {
      this.points = points;                    // Absolute Koordinaten speichern
      this._calcDimensions();                  // minX, minY, width, height berechnen
      this.left = this.minX;                   // Position = linke obere Ecke
      this.top = this.minY;
      // _applyPointOffset wird NICHT sofort aufgerufen!
  }

  // 2. Beim ersten Rendering:
  commonRender: function(ctx) {
      if (this._applyPointOffset) {            // Nur beim ersten Mal
          this._applyPointOffset();            // Punkte zu relativen Koordinaten
          this._applyPointOffset = null;       // Nie wieder ausführen
      }
      // Polygon zeichnen...
  }

  Unser Hack:

  finalPolygon._applyPointOffset = null;  // "Ich habe das schon gemacht"

  Fabric.js denkt: "Ah, die Punkte sind schon relativ, ich muss nichts machen."

  In Wahrheit: Unsere Punkte sind immer noch absolut, aber das Polygon wird trotzdem korrekt gezeichnet, weil die absolute Position mit
   den absoluten Punkten zusammenpasst.

  Es ist ein cleverer Trick, aber eben auch ein "Hack" des internen Fabric.js Systems!


Potentielle Nachteile:

  1. Objektmanipulation funktioniert anders

  // Nach dem Verschieben/Skalieren werden die Punkte NICHT automatisch angepasst
  // Bei normalen Fabric.js Polygonen: Punkte bleiben relativ zum Mittelpunkt
  // Bei unserer Lösung: Punkte sind absolut → können "wegdriften"

  2. Serialisierung/Export-Probleme

  - SVG Export: Könnte falsche Koordinaten liefern
  - JSON toObject(): Speichert absolute statt relative Koordinaten
  - Projekt speichern/laden: Könnte Inkonsistenzen verursachen

  3. Fabric.js Transformationen

  // Rotation um den Mittelpunkt funktioniert möglicherweise nicht korrekt
  // Skalierung könnte unerwartete Ergebnisse liefern
  // Gruppierung mit anderen Objekten könnte problematisch werden

  4. Canvas-Zoom/Pan Verhalten

  - Bei starkem Zoom könnten Rendering-Probleme auftreten
  - Bounding-Box-Berechnungen könnten ungenau werden

  5. Performance

  - Fabric.js erwartet das Standard-Koordinatensystem
  - Einige Optimierungen funktionieren möglicherweise nicht

  Praktische Auswirkungen für Ihr System:

  ✅ Sollte funktionieren:
  - Grundlegendes Zeichnen und Anzeigen
  - Einfache Bearbeitung (Verschieben)
  - Ihre Text-Labels und Berechnungen

  ⚠ Könnte Probleme machen:
  - PDF-Export mit Koordinaten
  - Projekt speichern/laden
  - Komplexe Transformationen

  Empfehlung: Testen Sie die wichtigsten Workflows (speichern, laden, exportieren) - falls Probleme auftreten, können wir zur
  robusteren Kompensations-Lösung zurück.



# Text-Labels seperat
Text-Labels als Gruppe bedeutet, dass es mitskaliert wird. Auch Groups sind komplziert und Annotationen zeichnen ist schwierig.
Text-Labels müssen 
- bei neuen Annotationen entstehen
- die Labelfarbe übernehmen
- sich mitbwegen bei verschieben, skalieren und verändern.
- beim löschen verschwinden. 

Lösungsansatz: 
1. Textlabel-Kopplung via ID-System: Jedes Textlabel bekommt eine linkedAnnotationId Eigenschaft
2. Event-Handler für Synchronisation: Events für object:moving, object:scaling, object:rotating
3. Position-Berechnung: Textlabel-Position wird basierend auf Annotation-Bounds dynamisch berechnet
4. Lifecycle-Management: Bei Annotation-Erstellung/Löschung wird gekoppeltes Textlabel automatisch erstellt/entfernt

Hier im Detail:
  1. Architektur: ID-basierte Kopplung

  // Jede Annotation bekommt eine einzigartige ID
  const linkId = `annotation_${Date.now()}_${Math.random()}`;

  // Annotation speichert die ID
  annotation.set('id', linkId);

  // Text-Label verweist auf diese ID
  textLabel.linkedAnnotationId = linkId;

  2. Objekt-Typen auf dem Canvas

  // Annotationen
  obj.objectType === 'annotation'  // Rechtecke, Polygone, Linien

  // Text-Labels 
  obj.objectType === 'textLabel'   // Nummerierte Labels mit Flächenangabe

  3. Text-Label Erstellung - Zwei Wege

  A) Bestehende Annotationen (API/window.data.prediction)

  displayAnnotations() → initializeCanvasTextLabels()
  // Erstellt Text-Labels für alle Annotationen zentral

  B) Neue Annotationen (User gezeichnet)

  finishDrawingRectangle() → setTimeout(() => createSingleTextLabel())
  // Verzögerte Erstellung für stabilere Position

  4. Text-Label Inhalt

  // Format: "Nummer\nFläche/Länge"
  "1\n2.45 m²"  // Rechteck/Polygon
  "2\n5.20 m"   // Linie

  5. Positionierung
  Claude hat immer die Text-Label falsch positioniert. Neu verwenden wir die echten absoluten fabric.js Koordinaten, früher hat es die bounding-Koordinaten verwendet, die nie funktionieren.
  
  const actualLeft = annotation.left;   // ✅ Echte Fabric.js Position
  const actualTop = annotation.top;     // ✅ Echte Fabric.js Position


  // Rechtecke & Linien: Oben links (+ kleine Offsets)
  x: bounds.left + 10, y: bounds.top - 5

  // Polygone: Zentrum
  x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2

  6. Synchronisation beim Verschieben

  canvas.on('object:modified', function(e) {
    setTimeout(() => {
      updateLinkedTextLabelPosition(e.target); // Findet über linkedAnnotationId
    }, 5);
  });

  7. Index-Nummerierung

  // Canvas als Single Source of Truth
  const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
  const displayNumber = annotations.length; // Array-Position = Index


# Ergebnistabelle
- Canvas-Annotationen sind single source of truth (früher hat es noch window.data.prediction gelesen).
- In der Tabelle erscheint nur, was auch auf dem canvas gezeichnet ist.
- Der Index wir ebenfalls über das Canvas bestimmt (früher über predictions und user). Die Nummerierun erfolgt über die Array-Position im Canvas. 

Neue saubere Architektur:

  1. API-Phase (window.data.prediction):

  - Erstellt nur pure Annotationen (ohne Text-Labels)
  - Fügt sie zu Canvas hinzu
  - KEINE Text-Label-Erstellung hier

  2. Canvas-Phase (nach API):

  - Canvas ist "Single Source of Truth"
  - Verwaltet automatisch nummerierte Text-Labels für ALLE Annotationen
  - Index basiert auf Array-Position im Canvas
  - Text-Labels werden automatisch erstellt/aktualisiert

  3. Ergebnistabelle:

  - Liest ausschließlich Canvas-Objekte
  - Keine eigenen Datenstrukturen




