# Gym Progress Tracker – Projektregeln

Spezifikation: SPEC.md (Quelle der Wahrheit). Aktuelle Phase: Lauf-Funktion Phase 1 (Brief in private/; Garmin = Phase 2, Coach = Phase 3, nicht bauen).

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
- `js/run.js` – pure Funktionen Lauf (L30, Soll, Ampel, Entlastung, Morgen-Check); rote Läufe zählen nicht für L30
- `js/sources.js` – Datenquellen für Läufe (aktuell nur manuell; Garmin später daneben, Abgleich über externalId)
- `tools/notes.mjs` – Parser für die alte Notiz (§8), `tools/import-notes.mjs` – CLI dazu
- `private/` – gitignored: Notiz, Zuordnung, erzeugte Import-Datei (persönliche Daten)
- `data/exercises.json` – reduzierte free-exercise-db (Public Domain)

## Design
- Verbindlich für alles Visuelle: **BRAND.md** (App „Satz“). Logos in `brand/`, Icons in `icons/`.
- Nur Dark Mode. Farben nur als Variablen auf `:root` in style.css, keine Hex-Werte im restlichen Code:
  `--bg` #1E1F22 Graphit · `--surface` #2A2B2F Graphit hell · `--text` #EDEAE3 Kreide ·
  `--accent` #F2B33D Messing (Fortschritt + eine Hauptaktion pro Screen) · `--muted` #8E8B85 Stein · `--down` #E5675A Rost
- Status immer mit Pfeil: besser ▲ Messing, gleich ▬ Stein, schlechter ▼ Rost.
- Ausnahme: Diagramm-Linien nutzen die geprüfte Palette `--s1..--s8` (Dark-Variante), nur im Diagramm.
- Ausnahme: Lauf-Ampel in echten Ampelfarben aus dieser Palette: Grün `--s3`, Gelb `--s4`, Rot `--s8` (Klassen `amp-*`).
- Schrift: `ui-rounded, -apple-system, system-ui, sans-serif`; Zahlen `tabular-nums`.
- Touch-Ziele ≥ 56 px, Nummernpad-Tasten ≥ 64 px; Radien Buttons 14 px, Karten 20 px.
- Keine Emojis in der UI. Bewusste Ausnahme: Zitate in der Zusammenfassung (vom Nutzer gewünscht).

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
- DB-Version 3 (Stores `calibrations`, `runs`), Backup-Format v3 (v1/v2 bleiben importierbar).
- Keine Garmin-, Worker- oder Claude-API-Keys im Repo oder in der App (nur später im Worker).
- Daten auf dem iPhone müssen jedes Update überleben: IndexedDB nur über `onupgradeneeded`
  mit `oldVersion`-Prüfung ändern, nie Stores löschen oder neu anlegen.
- Bei jeder Änderung an ausgelieferten Dateien `CACHE_VERSION` in `sw.js` erhöhen; neue Dateien in `FILES` eintragen.
- Logik (Vergleich, Sortierung, Backup) als pure Funktionen in `js/logic.js`, `js/progress.js` bzw. `js/backup.js`, mit Tests.
- Vergleich Weg 1 (§4, angepasst nach Expert Review V1/V8): Arbeitssätze = ≥ 90 % des Höchstgewichts.
  Mehr Gewicht: ▲ wenn Gesamt-Reps ≥ max(60 % vom letzten Mal, Arbeitssätze × untere Rep-Grenze 8), sonst ▬
  „Reps im Aufbau“, nie ▼. Weniger Gewicht: ▼. Gleiches Gewicht: Gesamt-Reps entscheiden. Ohne Gewicht: nur Reps.
- Kurve Weg 2 (Expert Review P1, Datei private/expert-review-fortschrittsberechnung.md): Basis = Median der ersten
  3 Trainings (oder der ersten 21 Tage), Faktor = Median-Verhältnis aus bis zu 3 Trainings je Seite (vorläufig bis 3),
  Bezugsgerät pro Übung in meta `refMachines` gespeichert, Region mit Eintritt/56-Tage-Verfall, Trend Theil-Sen ±3 %.
- Review P2: `exercise.sameEverywhere` (Schalter im Gewicht-Fenster) und `kind: 'bodyweight'` vergleichen über alle Gyms
  (Faktor 1, `gymId null`); Körpergewicht in meta `bodyWeights`, wirksame Last über `effectiveSets`; RIR optional pro Satz
  (`set.rir`); Region gewichtet mit Sekundärmuskel (`muscleGroup2`, ×0,5); Balance und Volumen nur aus Arbeitssätzen.
  Etappe 3 (P3) des Reviews erst nach iPhone-Test.
- Satz eintragen ohne Tastatur in < 5 s; Touch-Ziele ≥ 56px, wichtige Tasten unten.
- Relative Pfade (App läuft unter /gym/). Oberfläche auf Deutsch, Dark Mode.
- Repo ist öffentlich: keine Schlüssel, keine persönlichen Daten (Seed erst nach Rückfrage committen).
- Test-Werkzeuge (Playwright o. Ä.) liegen nicht im Repo.
- Nach jeder Phase: Deploy + iPhone-Checkliste, erst nach Freigabe weiter.
