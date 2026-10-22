// Fortschritt über Zeit und Gyms hinweg (SPEC §4b, §5). Pure Funktionen – getestet in tests/run.mjs.
//
// Zusammenführung pro Übung:
// 1. Stärke pro Training = bester Satz nach Epley (Gewicht × (1 + Reps/30)).
// 2. Jede Kombination Gym + Einheit ist ein "Gerät". Bezugsgerät = Home-Gym (meiste Trainings),
//    sonst das Gerät mit den meisten Trainings.
// 3. Andere Geräte werden per Faktor in Bezugseinheiten umgerechnet: von Hand gesetzt, über kg pro Stufe,
//    oder geschätzt (beim ersten Training dort so stark wie zuletzt am Bezugsgerät).
// 4. Fortschritt in % ggü. dem ersten Training der Übung.
import { sortSessions } from './logic.js';

export const REGIONS = {
  Brust: ['chest'],
  Rücken: ['lats', 'middle back', 'lower back', 'traps'],
  Schultern: ['shoulders'],
  Arme: ['biceps', 'triceps', 'forearms'],
  Beine: ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'],
  Rumpf: ['abdominals', 'neck'],
};

// Stufen bis hierhin sind eher Positionen (1, 2, 3 …) als beschriftete Gewichte → Prozentwerte nur geschätzt.
export const INDEX_STUFE_MAX = 25;

export function regionOf(muscle) {
  return Object.keys(REGIONS).find((r) => REGIONS[r].includes(muscle)) || null;
}

export function epley(weight, reps) {
  return weight * (1 + reps / 30);
}

export const machineKey = (gymId, unit) => gymId + '|' + unit;
export const calibrationId = (exerciseId, gymId, unit) => exerciseId + '|' + gymId + '|' + unit;

const DAY = 24 * 60 * 60 * 1000;
const isoToTime = (iso) => Date.parse(iso + 'T00:00:00Z');

// Ein Punkt pro Training: bester Satz (Epley) in der Einheit mit den meisten gewogenen Sätzen.
function sessionPoint(session, list) {
  const weighted = list.filter((s) => s.weight != null && s.unit);
  if (!weighted.length) return null;
  const counts = {};
  weighted.forEach((s) => { counts[s.unit] = (counts[s.unit] || 0) + 1; });
  const unit = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  let best = null;
  weighted.filter((s) => s.unit === unit).forEach((s) => {
    const raw = epley(s.weight, s.reps);
    if (!best || raw > best.raw) best = { weight: s.weight, reps: s.reps, raw };
  });
  return {
    date: session.date, sessionId: session.id, gymId: session.gymId, unit,
    machine: machineKey(session.gymId, unit), ...best,
  };
}

// Faktor eines Geräts in Bezugseinheiten pro Einheit hier.
function manualFactor(cal, refCal, refUnit) {
  if (!cal) return null;
  if (cal.factorToHome) return cal.factorToHome;
  if (cal.kgPerUnit) {
    const refKg = refUnit === 'kg' ? 1 : refCal && refCal.kgPerUnit;
    if (refKg) return cal.kgPerUnit / refKg;
  }
  return null;
}

// calibrations: Array {id, exerciseId, gymId, unit, factorToHome, kgPerUnit, source}
export function exerciseSeries(exercise, homeGymId, sessions, sets, calibrations = []) {
  const ordered = sortSessions(sessions);
  const exSets = sets.filter((s) => s.exerciseId === exercise.id);
  const points = [];
  ordered.forEach((session) => {
    const p = sessionPoint(session, exSets.filter((s) => s.sessionId === session.id));
    if (p) points.push(p);
  });
  if (!points.length) return { exerciseId: exercise.id, ref: null, factors: new Map(), points: [] };

  const count = new Map();
  points.forEach((p) => count.set(p.machine, (count.get(p.machine) || 0) + 1));
  const byCount = [...count.keys()].sort((a, b) => count.get(b) - count.get(a));
  const ref = byCount.find((m) => m.startsWith(homeGymId + '|')) || byCount[0];
  const refUnit = ref.split('|')[1];
  const calOf = (m) => calibrations.find((c) => c.id === exercise.id + '|' + m);
  const refCal = calOf(ref);

  const factors = new Map([[ref, { factor: 1, source: 'bezug' }]]);
  const refPoints = points.filter((p) => p.machine === ref);
  byCount.filter((m) => m !== ref).forEach((m) => {
    const manual = manualFactor(calOf(m), refCal, refUnit);
    if (manual) { factors.set(m, { factor: manual, source: 'manuell' }); return; }
    const first = points.find((p) => p.machine === m);
    const before = refPoints.filter((p) => p.date <= first.date);
    const anchor = before.length ? before[before.length - 1] : refPoints[0];
    factors.set(m, { factor: anchor.raw / first.raw, source: 'geschätzt', anchorDate: anchor.date });
  });

  // Index-Stufen am Bezugsgerät ohne kg-Angabe: Trend stimmt, Prozente sind grob.
  const indexLike = (p) => p.unit === 'stufe' && p.weight <= INDEX_STUFE_MAX && !(calOf(p.machine) || {}).kgPerUnit;
  const base = points[0].raw * factors.get(points[0].machine).factor;
  points.forEach((p) => {
    const f = factors.get(p.machine);
    p.value = p.raw * f.factor;
    p.pct = (p.value / base - 1) * 100;
    p.estimated = f.source === 'geschätzt' || indexLike(p);
  });
  return { exerciseId: exercise.id, ref, factors, points };
}

// Linie pro Körperregion: an jedem Trainingstag der Region der Mittelwert der Übungen,
// je mit ihrem letzten bekannten Stand (nur Übungen, die bis dahin schon begonnen haben).
export function regionSeries(seriesList, exercises) {
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const out = {};
  Object.keys(REGIONS).forEach((region) => {
    const members = seriesList.filter((s) => s.points.length && regionOf((exById.get(s.exerciseId) || {}).muscleGroup) === region);
    if (!members.length) return;
    const all = members.flatMap((s) => s.points.map((p) => ({ ...p, exerciseId: s.exerciseId })))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const last = new Map();
    const points = [];
    all.forEach((p, i) => {
      last.set(p.exerciseId, p);
      const next = all[i + 1];
      if (next && next.date === p.date) return; // alle Punkte des Tages zuerst einsammeln
      const today = all.filter((x) => x.date === p.date);
      const values = [...last.values()];
      points.push({
        date: p.date,
        pct: values.reduce((n, x) => n + x.pct, 0) / values.length,
        estimated: today.some((x) => x.estimated),
        sessionIds: [...new Set(today.map((x) => x.sessionId))],
        exercises: today.map((x) => x.exerciseId),
      });
    });
    out[region] = points;
  });
  return out;
}

// Trend der letzten 4 Wochen: erster vs. letzter Punkt im Zeitfenster (in Bezugswerten).
export function recentTrend(series, todayIso, days = 28, flat = 1) {
  const from = isoToTime(todayIso) - days * DAY;
  const pts = series.points.filter((p) => isoToTime(p.date) >= from);
  if (pts.length < 2) return null;
  const change = (pts[pts.length - 1].value / pts[0].value - 1) * 100;
  const result = change > flat ? 1 : change < -flat ? -1 : 0;
  return { change, result, count: pts.length, estimated: pts.some((p) => p.estimated) };
}

// Startgewicht in einem Gym ohne eigene Historie, wenn ein Faktor (von Hand / kg pro Stufe) bekannt ist.
export function suggestStartWeight(series, gymId, unit, calibrations, exerciseId) {
  if (!series.ref || series.points.some((p) => p.machine === machineKey(gymId, unit))) return null;
  const refUnit = series.ref.split('|')[1];
  const cal = calibrations.find((c) => c.id === calibrationId(exerciseId, gymId, unit));
  const refCal = calibrations.find((c) => c.id === exerciseId + '|' + series.ref);
  const factor = manualFactor(cal, refCal, refUnit);
  if (!factor) return null;
  const lastRef = series.points.filter((p) => p.machine === series.ref).pop();
  return Math.round((lastRef.weight / factor) * 10) / 10;
}
