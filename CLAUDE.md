# Gym Progress Tracker – Projektregeln

Spezifikation: SPEC.md (Quelle der Wahrheit). Aktuelle Phase: 3 (Graphen + Gym-Vergleich).

## Stack
Reines HTML/CSS/Vanilla-JS (ES-Module), kein Build-Schritt, kein Framework, kein Backend.
IndexedDB über `js/db.js`, Offline über `sw.js`. Deploy: GitHub Pages (`kupferpaul/gym`, Branch `main`, Root).

- `js/app.js` – UI (Screens, Events, Rendering)
- `js/db.js` – IndexedDB, CRUD, `storage.persist()`
- `js/logic.js` – pure Funktionen (Sortierung, Vorschlag, Vorausfüllen, Schritte)
- `js/backup.js` – pure Funktionen (JSON-/CSV-Export, Import-Validierung)
- `js/progress.js` – pure Funktionen (Vergleich §4, Rückmeldung, Steigerungs-Hinweis, Timer)
- `js/stats.js` – pure Funktionen (Epley, Zusammenführung über Gyms, Faktoren, Regionen, 4-Wochen-Trend)
- `js/chart.js` – SVG-Liniendiagramm ohne Bibliothek; Farben `--s1..--s8` in style.css (feste Reihenfolge, geprüft)
- `tools/notes.mjs` – Parser für die alte Notiz (§8), `tools/import-notes.mjs` – CLI dazu
- `private/` – gitignored: Notiz, Zuordnung, erzeugte Import-Datei (persönliche Daten)
- `data/exercises.json` – reduzierte free-exercise-db (Public Domain)

## Befehle
- Lokal starten: `python3 -m http.server 8000` → http://localhost:8000/
- Tests: `node tests/run.mjs`
- Übungs-DB neu bauen: `node tools/build-exercise-db.mjs`
- Notiz importieren: `node tools/import-notes.mjs private/Workout.md private/mapping.json private/gym-import.json`
  (ohne Mapping: nur Übersicht der Schreibweisen) → Datei in der App über „Import JSON“ laden
- Lokal testen mit Service Worker: vorher in DevTools SW abmelden + Caches leeren (cache-first)
- Deploy: `git push origin main` → https://kupferpaul.github.io/gym/ (1–2 Min.)

## Regeln
- Nur Features der aktuellen Phase bauen, nichts aus späteren Phasen vorziehen.
- DB-Version 2 (Store `calibrations`), Backup-Format v2 (v1 bleibt importierbar).
- Daten auf dem iPhone müssen jedes Update überleben: IndexedDB nur über `onupgradeneeded`
  mit `oldVersion`-Prüfung ändern, nie Stores löschen oder neu anlegen.
- Bei jeder Änderung an ausgelieferten Dateien `CACHE_VERSION` in `sw.js` erhöhen; neue Dateien in `FILES` eintragen.
- Logik (Vergleich, Sortierung, Backup) als pure Funktionen in `js/logic.js`, `js/progress.js` bzw. `js/backup.js`, mit Tests.
- Vergleich (§4, vom Nutzer angepasst): höheres Gewicht ist immer besser, niedrigeres immer schlechter;
  bei gleichem Gewicht entscheiden die Gesamt-Reps der Arbeitssätze (Sätze mit Höchstgewicht; leichtere
  Herantast-Sätze zählen nicht); ohne Gewicht/andere Einheit nur Reps, markiert.
- Satz eintragen ohne Tastatur in < 5 s; Touch-Ziele ≥ 56px, wichtige Tasten unten.
- Relative Pfade (App läuft unter /gym/). Oberfläche auf Deutsch, Dark Mode.
- Repo ist öffentlich: keine Schlüssel, keine persönlichen Daten (Seed erst nach Rückfrage committen).
- Test-Werkzeuge (Playwright o. Ä.) liegen nicht im Repo.
- Nach jeder Phase: Deploy + iPhone-Checkliste, erst nach Freigabe weiter.
