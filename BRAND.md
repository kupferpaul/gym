# BRAND: Satz (CI für die Gym-Tracker-App)

Diese Datei ist verbindlich für alle UI-Arbeiten. Bei Widerspruch zu Default-Styles gilt BRAND.md.

## 1. Idee
* Arbeitsname: **Satz**
* Zeichen "Stapel": Gewichtsstapel vom Gerät mit einem Plus obendrauf. Bedeutung: eine Platte mehr
* Haltung: schnell, ehrlich, ruhig, stetig. Keine Motivationssprüche, keine Fitness-Klischees (Hanteln, Blitze, Neon)

## 2. Farben (Dark Mode ist Standard und einziger Modus)
| Token | HEX | Verwendung |
|---|---|---|
| `--bg` Graphit | #1E1F22 | App-Hintergrund, Icon-Kachel |
| `--surface` Graphit hell | #2A2B2F | Karten, Buttons, Nummernpad-Tasten |
| `--text` Kreide | #EDEAE3 | Text, Zahlen, Platten im Logo |
| `--accent` Messing | #F2B33D | Plus im Logo, Hauptaktion, Status "besser", Steigerungs-Hinweis |
| `--muted` Stein | #8E8B85 | Sekundärtext, Geisterwerte, Status "gleich" |
| `--down` Rost | #E5675A | Status "schlechter", Löschen |

Regeln:
* Messing sparsam: nur für Fortschritt und die eine Hauptaktion pro Screen. Wenn alles Messing ist, bedeutet nichts mehr etwas
* Status nie nur über Farbe: immer mit Pfeil ▲ ▬ ▼ oder Text
* Text auf Messing ist Graphit (#1E1F22)
* Kontraste geprüft: Kreide 13,7:1, Messing 8,9:1, Stein und Rost ca. 5:1 auf Graphit. Stein und Rost nur ab 16 px

## 3. Schrift
* Systemschrift, keine Webfonts (offline, schnell): `font-family: ui-rounded, -apple-system, system-ui, sans-serif`
  (auf dem iPhone ergibt `ui-rounded` SF Pro Rounded, passt zu den runden Formen des Logos)
* Zahlen (Gewicht, Reps, Timer): `font-variant-numeric: tabular-nums`, groß und fett
* Größen: Zahlen im Nummernpad und aktueller Satz 32 bis 48 px, Fließtext 17 px, Sekundärtext 15 px
* Schriftzug "Satz" im Header: ui-rounded, 700, Buchstabenabstand -0,02em, als normaler Text (kein Bild)

## 4. Formen und Layout
* Ecken rund wie die Platten: Buttons und Tasten Radius 14 px, Karten 20 px
* Touch-Ziele mindestens 56 px hoch, Nummernpad-Tasten mindestens 64 px
* Hauptaktionen im unteren Drittel (Daumenzone)
* Abstände in 8er-Schritten
* Bewegung: kurz und funktional (150 bis 200 ms). Einzige "Feier": wenn ein Satz besser ist, wird das Plus kurz Messing und hüpft einmal

## 5. Logo-Dateien (Ordner `brand/`)
| Datei | Wofür |
|---|---|
| `satz-symbol-color.svg` | Logo farbig auf dunklem Grund (Splash, Header, Leerzustände) |
| `satz-symbol.svg` / `-black.svg` | Einfarbig schwarz, heller Grund (Exporte, Druck) |
| `satz-symbol-white.svg` | Einfarbig weiß |
| `satz-symbol-mono-f2b33d.svg` | Einfarbig Messing |
| `satz-symbol-small.svg` | Vereinfachte Form (2 Platten) für unter 48 px |
| `app-icon.svg`, `maskable-icon.svg`, `favicon.svg` | Quellen der Icons |

Logo-Regeln:
* Schutzraum rundherum: mindestens eine Plattenhöhe
* Unter 48 px immer die Kleinversion
* Nicht verändern: keine Schatten, Verläufe, Drehung, andere Farben, Umrisse, zusätzliche Platten

## 6. Icons (Ordner `icons/`)
* `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `maskable-512.png`, `favicon.svg`, `favicon.ico`, `favicon-16/32/48.png`
* Manifest: `"background_color": "#1E1F22"`, `"theme_color": "#1E1F22"`, `"display": "standalone"`
* iOS: `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`, `<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">`

## 7. Sprache in der App
* Deutsch, kurz, sachlich, du-Form
* Rückmeldungen als Fakten: "+3 Reps ggü. 19.8.", "Gewicht erhöht, Reps gehalten", "Gleich wie letztes Mal"
* Keine Ausrufezeichen-Flut, keine Emojis in der UI
