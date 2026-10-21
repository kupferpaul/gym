# Gym Progress Tracker – Projektregeln

Spezifikation: SPEC.md (Quelle der Wahrheit). Aktuelle Phase: 1 (MVP).

## Stack
Reines HTML/CSS/Vanilla-JS (ES-Module), kein Build-Schritt, kein Framework, kein Backend.
IndexedDB über `js/db.js`, Offline über `sw.js`. Deploy: GitHub Pages (`kupferpaul/gym`, Branch `main`, Root).

- `js/app.js` – UI (Screens, Events, Rendering)
- `js/db.js` – IndexedDB, CRUD, `storage.persist()`
- `js/logic.js` – pure Funktionen (Sortierung, Vorschlag, Vorausfüllen, Schritte)
- `js/backup.js` – pure Funktionen (JSON-/CSV-Export, Import-Validierung)
- `data/exercises.json` – reduzierte free-exercise-db (Public Domain)

## Befehle
- Lokal starten: `python3 -m http.server 8000` → http://localhost:8000/
- Tests: `node tests/run.mjs`
- Übungs-DB neu bauen: `node tools/build-exercise-db.mjs`
- Deploy: `git push origin main` → https://kupferpaul.github.io/gym/ (1–2 Min.)

## Regeln
- Nur Features der aktuellen Phase bauen, nichts aus späteren Phasen vorziehen.
- Daten auf dem iPhone müssen jedes Update überleben: IndexedDB nur über `onupgradeneeded`
  mit `oldVersion`-Prüfung ändern, nie Stores löschen oder neu anlegen.
- Bei jeder Änderung an ausgelieferten Dateien `CACHE_VERSION` in `sw.js` erhöhen; neue Dateien in `FILES` eintragen.
- Logik (Vergleich, Sortierung, Backup) als pure Funktionen in `js/logic.js` bzw. `js/backup.js`, mit Tests.
- Satz eintragen ohne Tastatur in < 5 s; Touch-Ziele ≥ 56px, wichtige Tasten unten.
- Relative Pfade (App läuft unter /gym/). Oberfläche auf Deutsch, Dark Mode.
- Repo ist öffentlich: keine Schlüssel, keine persönlichen Daten (Seed erst nach Rückfrage committen).
- Test-Werkzeuge (Playwright o. Ä.) liegen nicht im Repo.
- Nach jeder Phase: Deploy + iPhone-Checkliste, erst nach Freigabe weiter.
