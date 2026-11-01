// Lauf: Regel-Logik für die Steigerung Richtung 10 km ohne Knieprobleme.
// Pure Funktionen ohne UI – getestet in tests/run.mjs.
//
// Kernregel: kein langer Lauf mehr als 10 % länger als der längste Lauf der letzten 30 Tage (L30).
// Bei Kniesignal (Rot) wird nicht gesteigert. Rote Läufe zählen nicht für L30 (Entscheidung des Nutzers).
// Datum eines Laufs = lokale Zeit "YYYY-MM-DDTHH:MM" (ohne Zeitzone), Tag = die ersten 10 Zeichen.

export const RUN_DEFAULTS = {
  baseKm: 2.0,        // Basiswert, falls keine Läufe in den letzten 30 Tagen
  maxIncrease: 0.10,  // maximale Steigerung pro langem Lauf
  painLimit: 3,       // Knie während > Grenze = Rot
  paceHintSec: 390,   // Hinweis bei schneller als 6:30 min/km
  hrMax: null,        // Puls-Obergrenze für lockere Läufe (optional)
  goalKm: 10,         // Zieldistanz
};

export const RUN_TYPES = ['lang', 'kurz', 'aufwärmen'];
export const SURFACES = ['draußen', 'Laufband'];
export const MORNING = ['besser', 'gleich', 'schlechter'];

const WINDOW_DAYS = 30;
const EPS = 1e-9;

// Auf ein Raster abrunden bzw. runden, robust gegen Fließkommafehler (3,0 × 1,1 = 3,3, nicht 3,2).
export const floorTo = (x, step) => Math.round(Math.floor(x / step + EPS) * step * 100) / 100;
export const roundTo = (x, step) => Math.round(Math.round(x / step + EPS) * step * 100) / 100;

export const dayOf = (iso) => iso.slice(0, 10);
const dayNum = (day) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 864e5;
export const daysBetween = (a, b) => dayNum(dayOf(b)) - dayNum(dayOf(a));

export function paceSec(run) {
  return run.distanceKm > 0 ? run.durationSec / run.distanceKm : null;
}

export function formatDuration(sec) {
  if (sec == null || !isFinite(sec)) return '–';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + r : m + ':' + r;
}

export const formatPace = (sec) => formatDuration(sec) + ' min/km';
export const formatKm = (km) => String(Math.round(km * 100) / 100).replace('.', ',') + ' km';

// "18:20" oder "1:05:30" → Sekunden; ungültig → null
export function parseDuration(text) {
  const parts = String(text).trim().split(':').map((p) => p.trim());
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.map(Number).reduce((acc, n) => acc * 60 + n, 0);
}

// Ohne Kniewert (z. B. später aus Garmin importiert) ist ein Lauf unvollständig und zählt nicht.
export const isComplete = (run) => run.kneeDuring != null;

export function isRedSignal(run, settings = RUN_DEFAULTS) {
  return isComplete(run) && (run.kneeDuring > settings.painLimit || run.kneeMorning === 'schlechter');
}

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

// Kalenderwoche (Montag als Start) als Zahl, für die Entlastungswoche
function weekStart(day) {
  const n = dayNum(day);
  const weekday = (new Date(n * 864e5).getUTCDay() + 6) % 7; // 0 = Montag
  return n - weekday;
}
export const weekKey = (day) => String(weekStart(dayOf(day)));

// Jede 4. Kalenderwoche ab der Woche des ersten Laufs (Woche 1 = die des ersten Laufs).
export function isDeloadWeek(firstDay, day) {
  const idx = Math.floor((weekStart(dayOf(day)) - weekStart(dayOf(firstDay))) / 7);
  return idx >= 0 && idx % 4 === 3;
}

// Soll für den nächsten langen Lauf am Tag `day`, aus den vorherigen (vollständigen) Läufen.
// opts.skipDeloadWeek = weekKey einer übersprungenen Entlastungswoche
export function plan(prior, day, settings = RUN_DEFAULTS, opts = {}) {
  const runs = prior.filter(isComplete).slice().sort(byDate);
  const inWindow = (r) => { const d = daysBetween(r.date, day); return d >= 0 && d <= WINDOW_DAYS; };
  const ok = runs.filter((r) => !isRedSignal(r, settings));
  const okRecent = ok.filter(inWindow);
  const l30 = okRecent.length ? Math.max(...okRecent.map((r) => r.distanceKm)) : null;
  const base = l30 == null ? settings.baseKm : l30;

  let redStreak = 0;
  for (let i = runs.length - 1; i >= 0 && isRedSignal(runs[i], settings); i--) redStreak++;
  const lastGreen = ok.length ? ok[ok.length - 1] : null;
  const longs = runs.filter((r) => r.runType === 'lang');
  const lastLong = longs.length ? longs[longs.length - 1] : null;

  let mode = 'green';
  let sollLong;
  if (redStreak >= 2) {
    mode = 'red2';
    sollLong = floorTo((lastGreen ? lastGreen.distanceKm : settings.baseKm) * 0.8, 0.1);
  } else if (redStreak === 1) {
    mode = 'red';
    sollLong = floorTo(base, 0.1);
  } else if (runs.length && lastLong && isDeloadWeek(runs[0].date, day) && opts.skipDeloadWeek !== weekKey(day)) {
    mode = 'deload';
    sollLong = floorTo(lastLong.distanceKm * 0.85, 0.1);
  } else {
    sollLong = floorTo(base * (1 + settings.maxIncrease), 0.1);
  }

  const shortBase = lastLong ? lastLong.distanceKm : sollLong;
  const sollShort = Math.min(roundTo(shortBase * 0.75, 0.5), shortBase);
  return {
    mode, sollLong, sollShort, l30: l30 == null ? 0 : l30,
    progress: Math.min(1, (l30 || 0) / settings.goalKm),
    lastLong, lastGreen,
  };
}

export const MODE_TEXT = {
  green: 'Steigern erlaubt.',
  red: 'Distanz halten, nicht steigern.',
  red2: 'Einen Schritt zurück und Knie abklären lassen.',
  deload: 'Entlastungswoche: langer Lauf 85–90 % des letzten.',
};

// Lauftyp-Vorschlag: ab 90 % des Solls "lang", sonst "kurz" ("aufwärmen" nur manuell).
export const suggestType = (distanceKm, sollLong) => (distanceKm >= sollLong * 0.9 - EPS ? 'lang' : 'kurz');

// Ampel eines einzelnen Laufs im Zusammenhang der Läufe davor.
// Ergebnis: { status: 'incomplete'|'red'|'red2'|'yellow'|'green', reasons: [Text], hints: [Text], sollBefore }
export function assess(run, prior, settings = RUN_DEFAULTS, opts = {}) {
  const before = prior.filter((r) => r.id !== run.id && isComplete(r) && r.date < run.date).sort(byDate);
  const p = plan(before, run.date, settings, opts);
  const out = { status: 'green', reasons: [], hints: [], sollBefore: p.sollLong };
  if (!isComplete(run)) return { ...out, status: 'incomplete', reasons: ['Knie fehlt – Lauf zählt noch nicht.'] };

  if (isRedSignal(run, settings)) {
    const prev = before[before.length - 1];
    out.status = prev && isRedSignal(prev, settings) ? 'red2' : 'red';
    if (run.kneeDuring > settings.painLimit) out.reasons.push(`Knie ${run.kneeDuring} über Grenze ${settings.painLimit}.`);
    if (run.kneeMorning === 'schlechter') out.reasons.push('Morgen-Check: Knie schlechter.');
  }

  const yellow = [];
  if (run.distanceKm > p.sollLong + EPS) {
    yellow.push(`${Math.round((run.distanceKm / p.sollLong - 1) * 100)} % über Soll (${formatKm(p.sollLong)}).`);
  }
  if (run.runType !== 'aufwärmen') {
    const prevRun = before.filter((r) => r.runType !== 'aufwärmen').pop();
    if (prevRun && daysBetween(prevRun.date, run.date) === 1) yellow.push('Lauftag direkt nach Lauftag.');
  }
  const pace = paceSec(run);
  if (pace != null && pace < settings.paceHintSec) {
    yellow.push(`Pace ${formatPace(pace)} schneller als ${formatDuration(settings.paceHintSec)}.`);
  }
  if (settings.hrMax && run.avgHr && run.avgHr > settings.hrMax) {
    yellow.push(`Puls ${run.avgHr} über ${settings.hrMax} bpm.`);
  }
  if (out.status === 'green' && yellow.length) out.status = 'yellow';
  out.reasons.push(...(out.status === 'yellow' ? yellow : []));
  if (out.status !== 'yellow') out.hints.push(...yellow);

  if (run.cadenceSpm && run.kneeDuring >= 1 && run.kneeDuring <= 3) {
    const lo = Math.round(run.cadenceSpm * 1.05);
    const hi = Math.round(run.cadenceSpm * 1.10);
    out.hints.push(`Schrittfrequenz um 5–10 % erhöhen: Ziel ${lo}–${hi} spm.`);
  }
  return out;
}

// Morgen-Check: ab 5 Uhr am Tag nach einem Lauf, 48 Stunden lang, solange noch nicht beantwortet/übersprungen.
export function morningCheckDue(runs, nowIso) {
  const nowMin = dayNum(dayOf(nowIso)) * 1440 + (+nowIso.slice(11, 13)) * 60 + (+nowIso.slice(14, 16));
  const open = runs.filter((r) => isComplete(r) && !r.kneeMorning && !r.morningSkipped).filter((r) => {
    const start = (dayNum(dayOf(r.date)) + 1) * 1440 + 5 * 60;
    return nowMin >= start && nowMin < start + 48 * 60;
  });
  return open.sort(byDate).pop() || null;
}

// Neueste zuerst, jeweils mit Ampel (für Liste und Diagramme).
export function history(runs, settings = RUN_DEFAULTS, opts = {}) {
  return runs.slice().sort(byDate).map((r) => ({ run: r, ...assess(r, runs, settings, opts) })).reverse();
}
