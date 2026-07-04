# Onboarding-Medien

Hier liegen die Bilder/Videos für das Einführungs-Modal (die "Tour"), das beim
ersten App-Besuch erscheint. Die Pfade werden im Template
`templates/app.html` im `<script id="onboardingData">`-Block per `{% static %}`
eingetragen.

## Erwartete Dateien

| Schritt | Dateiname            | Inhalt                          |
|---------|----------------------|---------------------------------|
| 1       | `01-upload.mp4`      | Plan hochladen & Massstab setzen |
| 2       | `02-labels.mp4`      | Labels definieren / importieren |
| 3       | `03-draw.mp4`        | Zeichnen & messen               |
| 4       | `04-export.mp4`      | Speichern & exportieren         |

## Bild oder Video?

Der Medientyp wird automatisch an der **Dateiendung** erkannt:

- `.mp4` / `.webm` / `.ogg` → wird als stummes, automatisch loopendes `<video>` eingebunden
- alles andere (`.gif`, `.png`, `.jpg`, …) → wird als `<img>` eingebunden

Willst du statt eines Videos ein GIF/Bild zeigen, leg die Datei mit passender
Endung ab und ändere den Pfad im `onboardingData`-Block entsprechend.

**Empfehlung:** Kurze, stumme `.mp4`/`.webm`-Loops sind 5–10× kleiner als GIFs
bei besserer Qualität. Seitenverhältnis ~16:9 (die Box ist 16:9 mit
`object-fit: cover`).

## Fehlt eine Datei?

Kein Problem – lädt ein Medium nicht (404 / Ladefehler), blendet
`static/js/onboarding.js` die Medienbox für diesen Schritt einfach aus. Die
Tour funktioniert also auch text-only, bis die Aufnahmen fertig sind.

## Nach dem Einlegen / nach Pfadänderungen

Nur bei Änderung an `static/js/*.js` ist ein `npm run build` nötig – die
Medien selbst werden direkt über `{% static %}` geladen. Auf dem Server nach
`git pull` wie üblich `collectstatic` ausführen.
