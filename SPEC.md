# SPEC: Gym Progress Tracker (PWA)

## 1. Ziel
Persönlicher Krafttraining-Tracker fürs iPhone. Ersetzt meine Apple-Notiz.
Kernfrage, die die App beantworten muss: **Mache ich bei jeder Übung wirklich Fortschritt?**
Nur für mich, kein Login, keine Nutzerverwaltung.

## 2. Kontext
* Ich trainiere auf Muskelaufbau: meist 3 Sätze mit 7 bis 15 Reps
* Methode: doppelte Progression. Erst Reps steigern, wenn es leicht geht, Gewicht erhöhen
* Ich trainiere in verschiedenen Gyms, meistens im Home-Gym
* Gewicht ist je nach Gym mal kg (Freihantel, beschriftete Geräte), mal nur eine Gerätestufe/Zahl. Werte aus verschiedenen Gyms sind **nicht vergleichbar**
* Nutzung im Gym mit einer Hand, zwischen den Sätzen, oft schlechtes Netz

## 3. Kernablauf (wichtigster Teil)
Ein Satz eintragen soll in **unter 5 Sekunden** gehen, ohne Tastatur.

1. App öffnen → Training startet mit heutigem Datum und zuletzt genutztem Gym (Standard: Home-Gym), Gym per Tap änderbar
2. Übung antippen: Liste sortiert nach Häufigkeit und meiner üblichen Reihenfolge. Nach einer Übung wird die typische nächste oben vorgeschlagen
3. Gewicht ist vorausgefüllt mit dem letzten Wert dieser Übung in diesem Gym. Ändern per +/- Buttons in sinnvollen Schritten, Einheit (kg oder Stufe) pro Übung und Gym gemerkt
4. Reps per großem Nummernpad antippen (Tasten 1 bis 20 bzw. Ziffernblock), ein Tap pro Satz
5. Nach jedem Satz: **Geisterwert** sichtbar (Reps desselben Satzes beim letzten Mal) plus Pfeil hoch/gleich/runter
6. Nach dem letzten Satz einer Übung: kurze Rückmeldung, z. B. "+3 Reps ggü. 19.8." oder "Gewicht erhöht, Reps gehalten"
7. **Steigerungs-Hinweis**: wenn alle Sätze >= 12 Reps (Schwelle in Einstellungen änderbar), zeigt die App beim nächsten Mal "Gewicht erhöhen?"
8. **Pausentimer** startet automatisch nach jedem Satz (Standard 60 s, änderbar). Zeitstempelbasiert, damit er auch nach App-Wechsel stimmt. Ton am Ende, wenn die App offen ist
9. Fehler korrigieren: letzten Satz per Tap rückgängig, jeden Eintrag nachträglich editierbar

## 4. Fortschritt definieren
Vergleich immer pro **Übung + Gym**, jeweils mit dem letzten Training dieser Kombination.
* Besser: höheres Gewicht bei mindestens gleicher Mindestanzahl Reps, oder gleiches Gewicht und mehr Gesamt-Reps
* Gleich: gleiches Gewicht, gleiche Gesamt-Reps
* Schlechter: sonst
* Fehlendes Gewicht: nur Reps vergleichen, deutlich markieren

## 4a. Übungen auswählen
* Startbildschirm zeigt nur **meine** Übungen (aus dem Import), sortiert nach Häufigkeit und Reihenfolge
* "Neue Übung" öffnet eine Suche in einer mitgelieferten Übungsdatenbank: free-exercise-db (github.com/yuhonas/free-exercise-db, Public Domain, JSON, rund 870 Übungen mit Muskelgruppen und Equipment). Als statische Datei einbinden, kein API-Aufruf
* Eigene Übung ohne Datenbank-Treffer jederzeit anlegbar
* Jede Übung hat Muskelgruppe (aus DB oder manuell), für spätere Auswertung pro Muskelgruppe

## 4b. Vergleichbarkeit zwischen Gyms (Phase 3)
Gerätezahlen und Gewichte sind zwischen Gyms nicht direkt vergleichbar. Lösung in zwei Stufen:
1. **Relativer Fortschritt (Standard)**: pro Übung und Gym Fortschritt in % ggü. dem ersten Training dort (geschätztes Maximum aus Gewicht und Reps, Epley-Formel). Alle Gyms in einer Trendlinie zusammenführbar
2. **Umrechnungsfaktor (optional)**: pro Gerät in einem fremden Gym kann ich kg pro Stufe eintragen oder die App schätzt einen Faktor aus Trainings mit ähnlicher Rep-Zahl (z. B. Stufe 8 x 9 Reps dort ≈ 130 x 9 zu Hause). Immer als "geschätzt" markieren
Zusätzlich: Startgewicht in einem neuen Gym aus dem Faktor vorschlagen, falls vorhanden

## 5. Verlauf und Graphen (Phase 3)
* Pro Übung: Gewicht und Gesamt-Reps über die Zeit, getrennt nach Gym
* Übersicht: alle Übungen mit Trend der letzten 4 Wochen (hoch/gleich/runter)
* Verlaufsliste aller Trainings, so lesbar wie meine alte Notiz

## 6. Datenmodell (Vorschlag, darf verbessert werden)
* Gym: id, name, isHome
* Exercise: id, name, aliases[] (Kürzel aus Notizen), defaultUnit, muscleGroup, dbId (optional)
* MachineCalibration: exerciseId, gymId, kgPerUnit oder factorToHome, source ("manuell" | "geschätzt")
* Session: id, date, gymId
* Set: id, sessionId, exerciseId, order, weight (Zahl oder null), unit ("kg" | "stufe" | null), reps
* Settings: Steigerungsschwelle, Pausendauer, Gewichtsschritte

## 7. Speicher
* Phase 1: lokal im Browser (IndexedDB), `navigator.storage.persist()` anfragen
* Backup: Export als JSON und CSV über das iOS-Teilen-Menü, Import aus JSON
* Später (Phase 4): Sync mit Google Sheet. Jetzt schon das Datenmodell so halten, dass eine Zeile pro Satz als Tabelle exportierbar ist

## 8. Einmaliger Import der alten Notizen
Ich füge den Notiztext in Claude Code ein. Claude Code baut daraus eine Seed-Datei (JSON) im obigen Modell, die die App beim ersten Start lädt.
Format der Notiz:
```
19.8.26          ← Datum (T.M.JJ), startet ein Training

Chest press      ← Übungsname, oft abgekürzt oder uneinheitlich
@130             ← Gewicht: kg oder Gerätestufe, kann fehlen
8                ← Reps Satz 1
10               ← Reps Satz 2
9                ← Reps Satz 3
```
Regeln:
* Gleiche Übungen mit unterschiedlicher Schreibweise zusammenführen. Bei Unsicherheit: **mir eine Liste der Zuordnungen zur Bestätigung zeigen**, nicht raten
* Fehlendes @ → weight null
* Gym unbekannt → Home-Gym, außer ich sage es anders
* Nach dem Import: Zusammenfassung (Anzahl Trainings, Übungen, Zeitraum, unklare Einträge)

## 9. Technik und Rahmen
* PWA, offline-fähig, auf GitHub Pages (wie meine Vokabel-App), installierbar auf dem iPhone-Homescreen
* Mobile first, große Touch-Ziele, Daumenbedienung, Dark Mode
* So einfach wie möglich: kein Backend, kein Login. Stack schlägst du im Plan vor und begründest kurz
* Oberfläche auf Deutsch

## 10. Nicht im Scope
* Apple Health Anbindung (mit PWA nicht möglich)
* Mehrere Nutzer, Social Features, Trainingspläne, Ernährung
* Push-Benachrichtigungen

## 11. Phasen
1. **MVP**: Datenmodell, Speicher, Backup, Kernablauf 1 bis 4 und 9, PWA offline, Deploy
2. **Import + Feedback**: Seed aus meinen Notizen, Geisterwerte, Rückmeldung, Steigerungs-Hinweis, Pausentimer
3. **Graphen + Gym-Vergleich**: Verlauf und Übersicht, relativer Fortschritt über Gyms, optionaler Umrechnungsfaktor (Abschnitt 4b)
4. **Google Sheet Sync** (später, separat planen)

## 12. Akzeptanzkriterien
* Satz eintragen ohne Tastatur in unter 5 Sekunden
* App funktioniert im Flugmodus nach erstem Laden
* Beispielnotiz oben wird korrekt importiert: 6 Übungen, 18 Sätze, Curl ohne Gewicht
* Vergleichslogik aus Abschnitt 4 hat automatische Tests
* Export und anschließender Import ergibt identische Daten
* Nach jeder Phase: ich teste auf dem iPhone, erst dann nächste Phase
