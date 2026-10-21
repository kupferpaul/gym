// Pure Funktionen ohne DOM/IndexedDB – getestet in tests/run.mjs.

export const MUSCLES = {
  abdominals: 'Bauch',
  abductors: 'Abduktoren',
  adductors: 'Adduktoren',
  biceps: 'Bizeps',
  calves: 'Waden',
  chest: 'Brust',
  forearms: 'Unterarme',
  glutes: 'Gesäß',
  hamstrings: 'Beinbeuger',
  lats: 'Latissimus',
  'lower back': 'Unterer Rücken',
  'middle back': 'Oberer Rücken',
  neck: 'Nacken',
  quadriceps: 'Beinstrecker',
  shoulders: 'Schultern',
  traps: 'Trapez',
  triceps: 'Trizeps',
};

export const UNITS = ['kg', 'stufe', null];

export const DEFAULT_SETTINGS = {
  weightStepKg: 2.5, weightStepStufe: 1, restSeconds: 60, increaseThreshold: 12, wakeLock: true,
};

export function muscleLabel(key) {
  return MUSCLES[key] || key || '–';
}

// Geräte/Kabelzug zeigen meist nur Stufen, Körpergewicht hat kein Gewicht.
export function unitForEquipment(equipment) {
  if (equipment === 'machine' || equipment === 'cable') return 'stufe';
  if (equipment === 'body only') return null;
  return 'kg';
}

export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Sätze einer Session in Trainingsreihenfolge.
function bySequence(a, b) {
  return (a.createdAt || 0) - (b.createdAt || 0) || a.order - b.order;
}

// Übungs-IDs einer Session in der Reihenfolge, in der sie trainiert wurden.
export function exerciseSequence(sessionSets) {
  const seen = [];
  sessionSets.slice().sort(bySequence).forEach((s) => {
    if (!seen.includes(s.exerciseId)) seen.push(s.exerciseId);
  });
  return seen;
}

function setsBySession(sets) {
  const map = new Map();
  sets.forEach((s) => {
    if (!map.has(s.sessionId)) map.set(s.sessionId, []);
    map.get(s.sessionId).push(s);
  });
  return map;
}

// Sessions chronologisch (Datum, dann Startzeit).
export function sortSessions(sessions) {
  return sessions.slice().sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : (a.startedAt || 0) - (b.startedAt || 0));
}

// Pro Übung: in wie vielen Sessions trainiert und durchschnittliche Position (0 = erste).
export function exerciseStats(sets) {
  const stats = new Map();
  setsBySession(sets).forEach((list) => {
    exerciseSequence(list).forEach((id, pos) => {
      const st = stats.get(id) || { count: 0, posSum: 0 };
      st.count += 1;
      st.posSum += pos;
      stats.set(id, st);
    });
  });
  stats.forEach((st) => { st.avgPos = st.posSum / st.count; });
  return stats;
}

// Häufigste zuerst, bei Gleichstand übliche Reihenfolge, dann Name.
export function sortExercises(exercises, sets) {
  const stats = exerciseStats(sets);
  const none = { count: 0, avgPos: Infinity };
  return exercises.slice().sort((a, b) => {
    const sa = stats.get(a.id) || none;
    const sb = stats.get(b.id) || none;
    return sb.count - sa.count || sa.avgPos - sb.avgPos || a.name.localeCompare(b.name);
  });
}

// Typische nächste Übung: häufigster Nachfolger von lastId in früheren Sessions.
// Ohne lastId: die Übung, mit der Trainings am häufigsten beginnen. Bereits erledigte werden übersprungen.
export function suggestNext(sets, lastId, doneIds = []) {
  const counts = new Map();
  setsBySession(sets).forEach((list) => {
    const seq = exerciseSequence(list);
    if (lastId == null) {
      if (seq.length) counts.set(seq[0], (counts.get(seq[0]) || 0) + 1);
      return;
    }
    const i = seq.indexOf(lastId);
    if (i < 0) return;
    const next = seq.slice(i + 1).find((id) => !doneIds.includes(id));
    if (next) counts.set(next, (counts.get(next) || 0) + 1);
  });
  let best = null;
  let bestCount = 0;
  counts.forEach((c, id) => {
    if (!doneIds.includes(id) && c > bestCount) { best = id; bestCount = c; }
  });
  return best;
}

// Letzter Satz dieser Übung in diesem Gym (über alle Sessions).
export function lastSet(exerciseId, gymId, sessions, sets) {
  const ordered = sortSessions(sessions.filter((s) => s.gymId === gymId));
  const bySession = setsBySession(sets.filter((s) => s.exerciseId === exerciseId));
  for (let i = ordered.length - 1; i >= 0; i--) {
    const list = bySession.get(ordered[i].id);
    if (list && list.length) return list.slice().sort(bySequence).pop();
  }
  return null;
}

// Vorausgefülltes Gewicht und Einheit. unitPref = gemerkte Einheit für Übung+Gym (oder undefined).
export function prefill(exercise, gymId, sessions, sets, unitPref) {
  const last = lastSet(exercise.id, gymId, sessions, sets);
  const unit = unitPref !== undefined ? unitPref : last && last.unit ? last.unit : exercise.defaultUnit;
  // Gewicht nur übernehmen, wenn es in derselben Einheit war.
  const weight = unit && last && last.weight != null && last.unit === unit ? last.weight : null;
  return { unit: unit || null, weight };
}

export function stepSize(unit, settings = DEFAULT_SETTINGS) {
  return unit === 'stufe' ? settings.weightStepStufe : settings.weightStepKg;
}

// +/- Schritt, nie unter 0, ohne Rundungsfehler (2,5 + 2,5 + 2,5 = 7,5).
export function stepWeight(weight, unit, dir, settings = DEFAULT_SETTINGS) {
  if (!unit) return null;
  const next = (weight || 0) + dir * stepSize(unit, settings);
  return Math.max(0, Math.round(next * 100) / 100);
}

export function formatWeight(weight, unit) {
  if (weight == null || !unit) return 'ohne Gewicht';
  const n = String(weight).replace('.', ',');
  return unit === 'stufe' ? 'Stufe ' + n : n + ' kg';
}

const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

// "2026-08-19" → "Mi, 19.8.26"
export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const day = DAYS[new Date(y, m - 1, d).getDay()];
  return day + ', ' + d + '.' + m + '.' + String(y).slice(2);
}

// Nach Löschen eines Satzes: Satznummern pro Übung wieder 1..n.
export function renumber(sessionSets, exerciseId) {
  return sessionSets
    .filter((s) => s.exerciseId === exerciseId)
    .sort(bySequence)
    .map((s, i) => ({ ...s, order: i + 1 }));
}
