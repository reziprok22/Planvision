# Aufnahmen

## 1. Aufnahme machen
- SimpleScreenrecorder verwenden
- Standardsettings verwerden und als .mkv Datei speichern.
- Audio nicht aufnehmen
- Cursor grösser machen.

## 2. in MP4 umwandeln
- Ist effizienter als GIF
- ffmpeg -i aufnahme.mkv -c copy aufnahme.mp4

## 3. Anfang und Ende Wegschneiden
- ffmpeg -ss 00:00:10 -to 00:05:30 -i input.mp4 -c:v libx264 -c:a copy output.mp4 


## 4. Aufnahme zuschneiden
- Entweder direkt in SimpleScreenrecorder oder
- ffmpeg -i input.mp4 -vf "crop=in_w:in_h-140:0:80" -c:a copy output.mp4

Angenommen:
oben 100 Pixel entfernen
unten 80 Pixel entfernen
Breite soll gleich bleiben

in_w = Originalbreite
in_h-140 = Wie viel insgesamt in der Höhe weggeschnnitten wird (Pixel oben + Pixel unten = 140)
0 = x-Offset
80 = y-Offset → Startpunkt des wegschneiden von oben (80 Pixel tiefer)

Schema
crop=BREITE:HÖHE:X:Y

crop=in_w:in_h-(PO+PU):0:PO

PO = Pixel oben
PU = Pixel unten


Anzahl Pixel herausfinden:
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 aufnahme_hero-section.mp4 


# Bilder zuschneiden

1. Screenshot-Tool von Linux Mint auswählen
2. Windows Selection
3. Fenster wo hin schieben, damit man den Mauszeiger nicht sieht (z.B. ganz oben)
4. Save
5. Mit convert im Terminal bearbeiten

convert bevor.png -gravity North -chop 0x88 -gravity South -chop 0x40 bevor_chopped.png

- gravity: von welcher Seite wird abgeschnitten
- chop: WIDTH x HEIGHT
