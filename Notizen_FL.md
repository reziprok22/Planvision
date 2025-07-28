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



