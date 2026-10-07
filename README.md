# Musikquiz-Trainer

Installierbare Web-App (PWA), mit der du für Musikquiz-Abende trainierst – auf Handy und Computer, ohne Server und ohne Anmeldung.

## Funktionen

- **🎧 Song erkennen** – 30-Sekunden-Hörprobe, dann Titel/Interpret per Multiple Choice oder Freitext (tolerant gegenüber Tippfehlern; Interpret gibt Bonuspunkte).
- **💡 Wissensfragen** – automatisch aus deinen Songs erzeugt: Interpret, Album, Erscheinungsjahr, Genre, „Welcher Song ist von …?“, „Welcher Song ist der älteste?“.
- **📅 Jahr schätzen** – Hörprobe hören, Jahr per Schieberegler tippen; Punkte nach Abstand.
- **🔁 Schwächen trainieren** – Lernkarten-Prinzip (Leitner-Boxen): falsch beantwortete Songs kommen öfter dran, bis sie sitzen.
- **⏱ Countdown** – frei einstellbar; schnelle Antworten bringen mehr Punkte.
- **📊 Statistik** – Trefferquote, Verlauf, Bestwerte pro Modus, Problem-Songs zum Nachhören.
- **Frei wählbarer Song-Pool** – über die iTunes-Suche nach Interpreten, Titeln oder Stichworten (z. B. „Queen“, „Schlager“, „80s Hits“).
- Sicherung exportieren/importieren, Hell-/Dunkelmodus, Tastatursteuerung (1–4, Enter, Leertaste).

Alle Daten bleiben lokal im Browser (localStorage).

## Starten

Die App besteht nur aus statischen Dateien. Lokal reicht ein einfacher Webserver:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

### Veröffentlichen & installieren

Der Workflow `.github/workflows/pages.yml` veröffentlicht die App bei jedem Push auf `main` über GitHub Pages.
Einmalig unter **Settings → Pages → Build and deployment → Source** „GitHub Actions“ auswählen.

Danach die Pages-Adresse auf dem Handy öffnen und „Zum Startbildschirm hinzufügen“ bzw. „App installieren“ wählen
(iPhone: Safari → Teilen → Zum Home-Bildschirm).

## Hinweise

- Songsuche und Hörproben brauchen eine Internetverbindung; die App selbst funktioniert auch offline.
- Das Erscheinungsjahr stammt aus dem iTunes-Katalog. Bei Neuauflagen kann es abweichen – die App nimmt jeweils das früheste gefundene Jahr.
