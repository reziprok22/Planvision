# loadtest
Das Skript wie folgt ausführen:
- Hetzner-VPN: python3 loadtest.py --url https://planli.net --pdf Pläne_Fenstererkennung_loadtest.pdf -n 12 -c 3
- Homerecher: python3 loadtest.py --url http://127.0.0.1:8000 --pdf Pläne_Fenstererkennung_loadtest.pdf -n 12 -c 3

-n 12: Anzahl Analysen
-c 3: Parallalität

Das Skript hält 3 Analyse-Anfragen gleichzeitig „in flight". -n 12 -c 3 heisst also: 12 Analysen insgesamt, aber nie mehr als 3 parallel — sobald eine fertig ist, startet die nächste. Das simuliert 3 Nutzer, die im selben Moment „Erkennen" drücken und alle gleichzeitig auf das Ergebnis warten.

# Ergebnis Loadtest vo 2026-06-28
Verdikt: Der CX22 reicht für die Beta — klar.

┌────────────────┬────────────────────┬────────────────────┐
│                │ CX22 (2 vCPU, CPU) │ Home-PC (RTX 2070) │
├────────────────┼────────────────────┼────────────────────┤
│ Median Latenz  │ 10.1 s             │ 1.1 s              │
├────────────────┼────────────────────┼────────────────────┤
│ p90 / max      │ 11.8 / 12.3 s      │ 1.1 / 1.5 s        │
├────────────────┼────────────────────┼────────────────────┤
│ Durchsatz      │ 0.29/s (~17/min)   │ 2.73/s             │
├────────────────┼────────────────────┼────────────────────┤
│ Fehler bei c=3 │ 0/12               │ 0/12               │
└────────────────┴────────────────────┴────────────────────┘

Die zwei entscheidenden Befunde

1. Riesiger Timeout-Puffer. Selbst unter 3-facher Parallelität liegt die langsamste Analyse bei 12.3 s — gegen das gunicorn-Limit von 300 s. Du hast also ~25× Luft. Ein Timeout-Riss ist für normale Pläne praktisch ausgeschlossen; selbst ein deutlich grösserer Plan oder mehr Parallelität würde die 300 s nicht reissen. Die Robustheit gegen Timeouts ist damit faktisch bestätigt.
2. Keine Fehler, kein OOM. 12/12 erfolgreich bei c=3 → die Worker haben die Last RAM-technisch überlebt. Gut.

Der reale Trade-off: Latenz, nicht Stabilität

~7–12 s pro Analyse auf CPU ist der Preis ohne GPU. Für eine Beta mit Spinner („Analysiert…") ist das akzeptabel. Der CX22 ist also nicht schnell, aber stabil und ausreichend.

Kapazität: ~0.29 Analysen/s ≈ 17/min bei Volllast — für die erwartete Beta-Nutzerzahl reichlich.

→ -c 3 ist also ein Spitzenlast-Szenario, nicht „nur 3 Nutzer". Dein Server hält diese Spitze aus, d. h. er trägt deutlich mehr als 3 gleichzeitig angemeldete/aktive Nutzer. Damit zufällig 3 Erkennungen im exakt selben 10-Sekunden-Fenster zusammenfallen, brauchst du in der Praxis eher 10–20 aktive Nutzer gleichzeitig online.


# Worker-Zahl + RAM prüfen
Zwei Terminals auf dem Hetzner-Server öffnen

Terminal 2 (Monitoring) — zuerst starten:
watch -n1 'echo "== gunicorn =="; ps -C gunicorn -o pid,ppid,rss,%cpu,cmd --sort=-rss; echo; echo "== RAM (MB) =="; free -m'
watch -n1 aktualisiert jede Sekunde. Läuft, bis du es mit Strg+C beendest.

Terminal 1 (Last) — dann starten:
länger laufen lassen, damit du in Ruhe ablesen kannst (z.B. -n 30):
python scripts/loadtest.py --url https://planli.net --pdf Pläne_Fenstererkennung_loadtest.pdf -n 30 -c 3

Während Terminal 1 läuft, schaust du Terminal 2 zu.

 == gunicorn ==
      PID    PPID   RSS %CPU CMD
     1096    1095 856544 4.0 /opt/Planvision/env/bin/python3 /opt/Planvision/env/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 3 --timeout 300
     1097    1095 764876 3.6 /opt/Planvision/env/bin/python3 /opt/Planvision/env/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 3 --timeout 300
     1098    1095 699940 3.7 /opt/Planvision/env/bin/python3 /opt/Planvision/env/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 3 --timeout 300
     1095       1 25912  0.0 /opt/Planvision/env/bin/python3 /opt/Planvision/env/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 3 --timeout 300

  == RAM (MB) ==
                 total        used        free      shared  buff/cache   available
  Mem:            3820        2294        1225           0         522        1526
  Swap:              0           0           0

Es zeigt:
- 3 Worker (PID 1096/1097/1098, Parent 1095 = Master) — die Config ist --workers 3, kein --preload.
- **2 Worker besser für 2 vCPU meines Hetzner-CPN. 2 Worker = genau ein Worker pro Kern. So sinkt RAM free kaum mehr unter 1000 MB**
- RAM pro Worker: ~836 / 747 / 684 MB (RSS / 1024). Jeder Worker hat das Modell separat geladen (genau das, was preload vermeiden würde).
- free -m: used 2294 MB, available 1526 MB, Swap 0. → Es passt, mit ~1.5 GB Luft. Die 3 Worker fügen sich in die 3.8 GB ein, ohne Swap. Deckt sich mit deinem Lasttest (0 Fehler).
- Solange Swap 0 bleibt ist es im grünen Bereich. Bei free 500 MB wird es aber eng. 

Sizing (CX22, final getestet):
- Config: --workers 2 --preload --timeout 300 + OMP_NUM_THREADS=1
- Lasttest: 12 Analysen @ c=3, 0 Fehler, ~10 s median (riesiger Abstand zu 300 s Timeout)
- RAM unter Last: meist ~1000 MB frei, min 800 MB, Swap 0 → komfortabel
- Verdikt: CX22 ist launch-tauglich. CX32 erst bei Wachstum/Latenzwunsch.


