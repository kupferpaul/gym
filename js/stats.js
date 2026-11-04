// Fortschritt über Zeit und Gyms hinweg (SPEC §4b, §5, Expert Review P1). Pure Funktionen – getestet in tests/run.mjs.
//
// Zusammenführung pro Übung:
// 1. Stärke pro Training = bester Satz nach Epley (Gewicht × (1 + Reps/30)). Mit "kg pro Stufe" (+ Grundgewicht)
//    wird eine Stufe vorher in kg umgerechnet (V12).
// 2. Jede Kombination Gym + Einheit ist ein "Gerät". Bezugsgerät = gespeicherte Wahl (V10), sonst Home-Gym
//    (meiste Trainings), sonst das Gerät mit den meisten Trainings.
// 3. Andere Geräte per Faktor in Bezugseinheiten: von Hand, über kg pro Stufe, oder geschätzt aus dem
//    Median von bis zu 3 Trainings je Seite (V2; "vorläufig" bis 3 Trainings am neuen Gerät).
// 4. Prozent ggü. einer Basis = Median der ersten 3 Trainings oder aller der ersten 21 Tage, was früher kommt (V3/F4).
import { sortSessions } from './logic.js';
import { workingSets } from './progress.js';

// S17: Nacken gehört zum Rücken (Trapez), Rumpf = Bauch.
export const REGIONS = {
  Brust: ['chest'],
  Rücken: ['lats', 'middle back', 'lower back', 'traps', 'neck'],
  Schultern: ['shoulders'],
  Arme: ['biceps', 'triceps', 'forearms'],
  Beine: ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'],
  Rumpf: ['abdominals'],
};

// Stufen bis hierhin sind eher Positionen (1, 2, 3 …) als beschriftete Gewichte → Prozentwerte nur geschätzt.
export const INDEX_STUFE_MAX = 25;
export const HIGH_REPS = 15;        // V4: darüber ist Epley unsicher → Punkt "geschätzt"
export const BASE_COUNT = 3;        // V3: Basis aus den ersten 3 Trainings …
export const BASE_DAYS = 21;        // … oder allen der ersten 21 Tage (F4)
export const REGION_DECAY_DAYS = 56; // V5/F5: länger nicht trainiert → raus aus dem Regionsmittel
export const ANCHOR_COUNT = 3;      // V2: bis zu 3 Trainings je Seite für den Faktor
export const TREND_FLAT = 3;        // V6: ±3 % gilt als gleich
export const SECONDARY_WEIGHT = 0.5; // V16: sekundäre Muskelgruppe zählt halb

// V16: Standard-Sekundärmuskel aus dem Namen; exercise.muscleGroup2 (auch null = keiner) hat Vorrang.
const SECONDARY_RULES = [
  [/chest press|bench|bankdr|dip|push.?up|liegest/i, 'triceps'],
  [/shoulder press|overhead press|military|schulterdr/i, 'triceps'],
  [/row|ruder|pull.?up|chin.?up|pull.?down|klimm|latzug/i, 'biceps'],
  [/squat|kniebeu|leg press|beinpresse/i, 'glutes'],
  [/deadlift|kreuzheb/i, 'hamstrings'],
];
export function secondaryOf(exercise) {
  if (exercise.muscleGroup2 !== undefined) return exercise.muscleGroup2;
  const hit = SECONDARY_RULES.find(([re]) => re.test(exercise.name || ''));
  return hit ? hit[1] : null;
}

// V13: Körpergewicht zum Datum = letzter Eintrag vor oder am Tag, sonst der erste Eintrag danach.
export function bodyWeightAt(entries, date) {
  if (!entries || !entries.length) return null;
  const sorted = entries.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const before = sorted.filter((e) => e.date <= date);
  return (before.length ? before[before.length - 1] : sorted[0]).kg;
}

// Kurzhantel, Körpergewicht: 1 kg ist in jedem Gym 1 kg, also Faktor 1 und Vergleich über Gyms hinweg.
export const isBodyweight = (exercise) => !!exercise && exercise.kind === 'bodyweight';
export const isUniversal = (exercise) => !!exercise && (exercise.sameEverywhere === true || isBodyweight(exercise));

// V13: Sätze einer Körpergewichtsübung mit wirksamer Last = Anteil × Körpergewicht + Zusatz.
// Der eingetragene Zusatz bleibt in addKg (für die Anzeige). Andere Übungen bleiben unverändert.
export function effectiveSets(exercise, list, sessions, bodyWeights) {
  if (!isBodyweight(exercise)) return list;
  const share = exercise.bodyShare || 1;
  const dateOf = new Map(sessions.map((s) => [s.id, s.date]));
  return list.filter((s) => s.unit !== 'stufe').map((s) => {
    const bw = bodyWeightAt(bodyWeights, dateOf.get(s.sessionId) || '') || 0;
    return { ...s, weight: share * bw + (s.weight || 0), unit: 'kg', addKg: s.weight || 0 };
  });
}

export function regionOf(muscle) {
  return Object.keys(REGIONS).find((r) => REGIONS[r].includes(muscle)) || null;
}

export function epley(weight, reps) {
  return weight * (1 + reps / 30);
}

export function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length / 2;
  return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2;
}

export const machineKey = (gymId, unit) => gymId + '|' + unit;
export const calibrationId = (exerciseId, gymId, unit) => exerciseId + '|' + gymId + '|' + unit;

const DAY = 24 * 60 * 60 * 1000;
const dayNum = (iso) => Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / DAY;

// V12: Last in kg, wenn für eine Stufen-Einheit "kg pro Stufe" (optional + Grundgewicht) bekannt ist.
function load(weight, unit, cal) {
  if (unit === 'stufe' && cal && cal.kgPerUnit) return { w: (cal.baseKg || 0) + cal.kgPerUnit * weight, kg: true };
  return { w: weight, kg: unit === 'kg' };
}

// Ein Punkt pro Training: bester Satz (Epley) in der Einheit mit den meisten gewogenen Sätzen.
// Gleichstand (S11): Einheit des Bezugsgeräts, sonst die des Satzes mit dem höchsten e1RM.
function sessionPoint(session, list, calOf, preferUnit) {
  const weighted = list.filter((s) => s.weight != null && s.unit);
  if (!weighted.length) return null;
  const counts = {};
  weighted.forEach((s) => { counts[s.unit] = (counts[s.unit] || 0) + 1; });
  const top = Math.max(...Object.values(counts));
  const tied = Object.keys(counts).filter((u) => counts[u] === top);
  let unit = tied[0];
  if (tied.length > 1) {
    if (tied.includes(preferUnit)) unit = preferUnit;
    else unit = weighted.filter((s) => tied.includes(s.unit))
      .sort((a, b) => epley(b.weight, b.reps) - epley(a.weight, a.reps))[0].unit;
  }
  const machine = machineKey(session.gymId, unit);
  const cal = calOf(machine);
  let best = null;
  weighted.filter((s) => s.unit === unit).forEach((s) => {
    // V11: Reserve (RIR) zählt als mögliche Wiederholungen; ohne Angabe wie bisher.
    const raw = epley(load(s.weight, unit, cal).w, s.reps + (s.rir || 0));
    if (!best || raw > best.raw) best = { weight: s.weight, reps: s.reps, rir: s.rir == null ? null : s.rir, addKg: s.addKg, raw };
  });
  // V18: Volumen = Σ Last × Reps über die Arbeitssätze.
  const volume = workingSets(weighted.filter((s) => s.unit === unit))
    .reduce((n, s) => n + load(s.weight, unit, cal).w * s.reps, 0);
  return {
    date: session.date, sessionId: session.id, gymId: session.gymId, unit, machine,
    kgSpace: load(1, unit, cal).kg, volume, ...best,
  };
}

// opts.refMachine = gespeichertes Bezugsgerät (V10), opts.today = Stichtag für die 21-Tage-Basis
export function exerciseSeries(exercise, homeGymId, sessions, sets, calibrations = [], opts = {}) {
  const calOf = (m) => calibrations.find((c) => c.id === exercise.id + '|' + m);
  const ordered = sortSessions(sessions);
  const exSets = effectiveSets(exercise, sets.filter((s) => s.exerciseId === exercise.id), sessions, opts.bodyWeights);
  const [refGymHint, refUnitHint] = opts.refMachine ? opts.refMachine.split('|') : [];
  const points = [];
  ordered.forEach((session) => {
    const prefer = session.gymId === refGymHint ? refUnitHint : undefined;
    const p = sessionPoint(session, exSets.filter((s) => s.sessionId === session.id), calOf, prefer);
    if (p) points.push(p);
  });
  const empty = { exerciseId: exercise.id, ref: null, factors: new Map(), points: [], baseReady: false, base: null, establishedDate: null };
  // V13: Ohne Körpergewicht gibt es keinen sinnvollen Wert für die Kurve.
  if (!points.length || (isBodyweight(exercise) && !(opts.bodyWeights || []).length)) {
    return { ...empty, needsBodyWeight: isBodyweight(exercise) && !!exSets.length };
  }

  const count = new Map();
  points.forEach((p) => count.set(p.machine, (count.get(p.machine) || 0) + 1));
  const byCount = [...count.keys()].sort((a, b) => count.get(b) - count.get(a));
  const ref = count.has(opts.refMachine) ? opts.refMachine
    : byCount.find((m) => m.startsWith(homeGymId + '|')) || byCount[0];
  const refPoints = points.filter((p) => p.machine === ref);
  const refKg = refPoints[0].kgSpace;

  const factors = new Map([[ref, { factor: 1, source: 'bezug' }]]);
  byCount.filter((m) => m !== ref).forEach((m) => {
    const cal = calOf(m);
    const mine = points.filter((p) => p.machine === m);
    if (cal && cal.factorToHome) { factors.set(m, { factor: cal.factorToHome, source: 'manuell' }); return; }
    if (mine[0].kgSpace && refKg && (cal && cal.kgPerUnit)) { factors.set(m, { factor: 1, source: 'kg' }); return; }
    // Schalter "Gewicht überall gleich" (auch Körpergewicht): kg ist kg, keine Schätzung.
    if (isUniversal(exercise) && mine[0].unit === 'kg' && refPoints[0].unit === 'kg') { factors.set(m, { factor: 1, source: 'gleich' }); return; }
    // V2: Median der ersten bis zu 3 Trainings am neuen Gerät gegen den Median der letzten bis zu 3
    // Bezugs-Trainings davor (sonst die ersten bis zu 3 danach). Ab 3 Trainings eingefroren.
    const firstNew = mine.slice(0, ANCHOR_COUNT);
    const before = refPoints.filter((p) => p.date <= firstNew[0].date);
    const anchors = before.length ? before.slice(-ANCHOR_COUNT) : refPoints.slice(0, ANCHOR_COUNT);
    factors.set(m, {
      factor: median(anchors.map((p) => p.raw)) / median(firstNew.map((p) => p.raw)),
      source: firstNew.length < ANCHOR_COUNT ? 'vorläufig' : 'geschätzt',
      anchorDate: anchors[anchors.length - 1].date, newCount: firstNew.length,
    });
  });

  // Index-Stufen ohne kg pro Stufe UND Grundgewicht: Trend stimmt, Prozente sind grob (V12/F7).
  const isIndex = (p) => {
    const cal = calOf(p.machine);
    return p.unit === 'stufe' && p.weight <= INDEX_STUFE_MAX && !(cal && cal.kgPerUnit && cal.baseKg != null);
  };
  points.forEach((p) => {
    const f = factors.get(p.machine);
    p.value = p.raw * f.factor;
    p.volumeValue = p.volume * f.factor;
    p.index = isIndex(p);
    p.provisional = f.source === 'vorläufig';
    p.highReps = p.reps > HIGH_REPS;
    p.estimated = f.source === 'geschätzt' || p.provisional || p.index || p.highReps;
  });

  // V3/F4: Basis aus den ersten 3 Trainings, oder aus allen der ersten 21 Tage – was früher feststeht.
  const t0 = dayNum(points[0].date);
  const today = dayNum(opts.today || points[points.length - 1].date);
  let baseSet = null;
  let establishedDate = null;
  const third = points[BASE_COUNT - 1];
  if (third && dayNum(third.date) - t0 <= BASE_DAYS) {
    baseSet = points.slice(0, BASE_COUNT);
    establishedDate = third.date;
  } else if (today - t0 >= BASE_DAYS) {
    baseSet = points.filter((p) => dayNum(p.date) - t0 <= BASE_DAYS);
    establishedDate = new Date((t0 + BASE_DAYS) * DAY).toISOString().slice(0, 10);
  }
  const base = baseSet ? median(baseSet.map((p) => p.value)) : null;
  points.forEach((p) => { p.pct = base ? (p.value / base - 1) * 100 : null; });
  return { exerciseId: exercise.id, ref, factors, points, baseReady: !!base, base, establishedDate };
}

// Linie pro Körperregion (V5, V14–V16): an jedem Trainingstag der Region der gewichtete Mittelwert der Übungen
// mit ihrem letzten Stand. Gewicht = Trainings der letzten 56 Tage (mindestens 1), sekundäre Muskelgruppe × 0,5.
// Eine Übung zählt erst, wenn ihre Basis steht, fällt nach 56 Tagen ohne Training heraus, Index-Stufen zählen nicht.
// Punkt hohl, wenn mehr als 1/3 des Gewichts aus geschätzten Punkten stammt (auch mitgezogene, V15).
export function regionSeries(seriesList, exercises) {
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const out = {};
  Object.keys(REGIONS).forEach((region) => {
    const primary = (s) => regionOf((exById.get(s.exerciseId) || {}).muscleGroup) === region;
    const secondary = (s) => !primary(s) && regionOf(secondaryOf(exById.get(s.exerciseId) || {})) === region;
    const members = seriesList.filter((s) => s.points.length && (primary(s) || secondary(s)));
    if (!members.length) return;
    // Index-Stufen-Punkte zählen nicht (z. B. Reise-Gym mit Pin 7); eine Übung fällt nur ganz raus,
    // wenn sie ausschließlich Index-Stufen hat.
    const usable = (s) => s.points.filter((p) => !p.index);
    const eligible = members.filter((s) => s.baseReady && usable(s).length);
    const all = eligible.flatMap((s) => usable(s)
      .filter((p) => p.date >= s.establishedDate)
      .map((p) => ({ ...p, exerciseId: s.exerciseId })))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const days = [...new Set(all.map((p) => p.date))];
    const points = [];
    days.forEach((day) => {
      const today = all.filter((x) => x.date === day);
      const current = [];
      const excluded = [];
      members.forEach((s) => {
        const ok = eligible.includes(s) && s.establishedDate <= day;
        const last = usable(s).filter((p) => p.date <= day).pop();
        if (!ok || !last) { excluded.push({ exerciseId: s.exerciseId, why: s.baseReady && !usable(s).length ? 'index' : 'neu' }); return; }
        if (dayNum(day) - dayNum(last.date) > REGION_DECAY_DAYS) { excluded.push({ exerciseId: s.exerciseId, why: 'pause', days: dayNum(day) - dayNum(last.date) }); return; }
        const recent = s.points.filter((p) => p.date <= day && dayNum(day) - dayNum(p.date) <= REGION_DECAY_DAYS).length;
        current.push({ pct: last.pct, estimated: last.estimated, weight: Math.max(1, recent) * (secondary(s) ? SECONDARY_WEIGHT : 1) });
      });
      if (!current.length) return;
      const total = current.reduce((n, x) => n + x.weight, 0);
      const unsure = current.filter((x) => x.estimated).reduce((n, x) => n + x.weight, 0);
      points.push({
        date: day,
        pct: current.reduce((n, x) => n + x.pct * x.weight, 0) / total,
        estimated: unsure / total > 1 / 3,
        sessionIds: [...new Set(today.map((x) => x.sessionId))],
        exercises: today.map((x) => x.exerciseId),
        excluded,
      });
    });
    if (points.length) out[region] = points;
  });
  return out;
}

// V17: Balance = Arbeitssätze pro Region in den letzten 28 Tagen, sekundäre Muskelgruppe zählt 0,5 Satz.
// Keine Schätzung, kein Faktor: beantwortet "trainiere ich ausgewogen?".
export function regionBalance(sessions, sets, exercises, todayIso, days = 28) {
  const out = {};
  Object.keys(REGIONS).forEach((r) => { out[r] = 0; });
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const from = dayNum(todayIso) - days;
  sessions.filter((s) => dayNum(s.date) > from && dayNum(s.date) <= dayNum(todayIso)).forEach((session) => {
    const own = sets.filter((x) => x.sessionId === session.id);
    [...new Set(own.map((x) => x.exerciseId))].forEach((id) => {
      const ex = exById.get(id);
      if (!ex) return;
      const n = workingSets(own.filter((x) => x.exerciseId === id)).length;
      const first = regionOf(ex.muscleGroup);
      const second = regionOf(secondaryOf(ex));
      if (first) out[first] += n;
      if (second && second !== first) out[second] += n * SECONDARY_WEIGHT;
    });
  });
  return out;
}

// V6: Trend der letzten 4 Wochen als robuste Steigung (Theil-Sen: Median aller paarweisen Steigungen),
// in Prozent pro 28 Tage bezogen auf den Median der Werte. Bei genau 2 Punkten: erster gegen letzten.
export function recentTrend(series, todayIso, days = 28, flat = TREND_FLAT) {
  const from = dayNum(todayIso) - days;
  const pts = series.points.filter((p) => dayNum(p.date) >= from);
  if (pts.length < 2) return null;
  let change;
  if (pts.length === 2) {
    change = (pts[1].value / pts[0].value - 1) * 100;
  } else {
    const slopes = [];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dt = dayNum(pts[j].date) - dayNum(pts[i].date);
        if (dt > 0) slopes.push((pts[j].value - pts[i].value) / dt);
      }
    }
    if (!slopes.length) return null;
    change = (median(slopes) * days) / median(pts.map((p) => p.value)) * 100;
  }
  const result = change > flat ? 1 : change < -flat ? -1 : 0;
  return { change, result, count: pts.length, twoOnly: pts.length === 2, estimated: pts.some((p) => p.estimated) };
}

// V9: Startgewicht in einem Gym ohne eigene Historie, wenn ein Faktor (von Hand / kg pro Stufe) bekannt ist.
// Ziel: ca. `reps` Wiederholungen. Ergebnis auf die Schrittweite des neuen Geräts gerundet.
export function suggestStartWeight(series, gymId, unit, calibrations, exerciseId, { reps = 8, step = 2.5 } = {}) {
  if (!series.ref || series.points.some((p) => p.machine === machineKey(gymId, unit))) return null;
  const cal = calibrations.find((c) => c.id === calibrationId(exerciseId, gymId, unit));
  const refPoints = series.points.filter((p) => p.machine === series.ref);
  const refKg = refPoints[0].kgSpace;
  // Nur mit bekanntem Faktor (von Hand oder kg pro Stufe); sonst wird nicht geraten.
  const factor = cal && cal.factorToHome ? cal.factorToHome : cal && cal.kgPerUnit && refKg ? 1 : null;
  if (!factor) return null;
  const e1rmHere = refPoints[refPoints.length - 1].raw / factor;
  let w = e1rmHere / (1 + reps / 30);
  if (unit === 'stufe' && cal && cal.kgPerUnit) w = (w - (cal.baseKg || 0)) / cal.kgPerUnit;
  return { weight: Math.max(0, Math.round(Math.round(w / step) * step * 100) / 100), reps };
}
