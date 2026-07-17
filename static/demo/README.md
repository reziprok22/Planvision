# Demo-Projekt

Hier gehört die Datei `demo.planli` hin — das fertig analysierte Demo-Projekt,
das der „Demo ansehen"-Button auf der Landingpage lädt (`/app?demo=1`).

Erstellen: Demo-Plan in der App hochladen, analysieren, ggf. nachbearbeiten,
dann als `.planli` exportieren und hier als `demo.planli` ablegen.
Die Datei wird ins Git eingecheckt und via collectstatic ausgeliefert
(`/static/demo/demo.planli`).

Fehlt die Datei, zeigt die App beim Demo-Aufruf eine Fehlermeldung und
landet im normalen leeren Editor — die Landingpage funktioniert weiter.
