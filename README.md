# Musikquiz-Trainer

Installierbare Web-App (PWA), mit der du für Musikquiz-Abende trainierst – auf Handy und Computer, ohne Server und ohne Anmeldung.

## Funktionen

- **🎧 Song erkennen** – 30-Sekunden-Hörprobe, dann Titel/Interpret per Multiple Choice oder Freitext (tolerant gegenüber Tippfehlern; Interpret gibt Bonuspunkte).
- **💡 Wissensfragen** – automatisch aus deinen Songs erzeugt: Interpret, Album, Erscheinungsjahr, Genre, „Welcher Song ist von …?“, „Welcher Song ist der älteste?“.
- **📅 Jahr schätzen** – Hörprobe hören, Jahr per Schieberegler tippen; Punkte nach Abstand.
- **🔁 Schwächen trainieren** – Lernkarten-Prinzip (Leitner-Boxen): falsch beantwortete Songs kommen öfter dran, bis sie sitzen.
- **⏱ Countdown** – frei einstellbar; schnelle Antworten bringen mehr Punkte.
- **📊 Statistik** – Trefferquote, Verlauf, Bestwerte pro Modus, Problem-Songs zum Nachhören.
- **Themenpaket „Hits der 90er“** – 234 kuratierte Hits (deutsch & international) mit verlässlichem Erscheinungsjahr; die App holt Hörproben und Cover einzeln über iTunes.
- **Jahrzehnte** – beim Hinzufügen nur Songs aus z. B. den 90ern übernehmen und im Training auf ein Jahrzehnt einschränken (60er bis 2020er).
- **Frei wählbarer Song-Pool** – über die iTunes-Suche nach Interpreten, Titeln oder Stichworten (z. B. „Queen“, „Schlager“, „80s Hits“).
- Sicherung exportieren/importieren, Hell-/Dunkelmodus, Tastatursteuerung (1–4, Enter, Leertaste).

Alle Daten bleiben lokal im Browser (localStorage).

## Hosting (empfohlen: Vercel)

Manche iPhones erreichen die iTunes-Suche aus Safari nicht direkt. Deshalb bringt die App einen
kleinen Vermittler mit (`api/itunes.js` für die Suche, `api/preview.js` für Hörproben), der als
Vercel-Funktion läuft. Die App nutzt ihn automatisch und fällt sonst auf die direkte Abfrage zurück.

Einmalig einrichten:
1. Auf [vercel.com](https://vercel.com) mit dem GitHub-Konto anmelden (Hobby-Tarif, kostenlos).
2. **Add New → Project** und dieses Repository importieren. Framework: „Other“, keine weiteren Einstellungen.
3. **Deploy** – danach wird jede Änderung auf `main` automatisch veröffentlicht.

Die App ist dann unter `https://<projektname>.vercel.app` erreichbar. Auf dem Handy öffnen und
„Zum Home-Bildschirm“ wählen (iPhone: Safari → Teilen → Zum Home-Bildschirm).

GitHub Pages (`.github/workflows/pages.yml`) funktioniert weiterhin, aber ohne Vermittler.

Lokal reicht für die Oberfläche ein einfacher Webserver (`python3 -m http.server 8000`); der
Vermittler läuft lokal mit `npx vercel dev`.

## Hinweise

- Songsuche und Hörproben brauchen eine Internetverbindung; die App selbst funktioniert auch offline.
- Das Erscheinungsjahr stammt aus dem iTunes-Katalog. Bei Neuauflagen kann es abweichen – die App nimmt jeweils das früheste gefundene Jahr.
