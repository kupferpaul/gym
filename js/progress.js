// Fortschritt pro Übung + Gym (SPEC §4, mit Anpassung: höheres Gewicht ist immer besser).
// Pure Funktionen – getestet in tests/run.mjs.
import { sortSessions, formatWeight } from './logic.js';

export const DEFAULT_THRESHOLD = 12;

const bySeq = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.order - b.order;
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

// Sätze der Übung im letzten Training dieser Übung in diesem Gym vor excludeSessionId.
export function previousSets(exerciseId, gymId, sessions, sets, excludeSessionId) {
  const ordered = sortSessions(sessions.filter((s) => s.gymId === gymId && s.id !== excludeSessionId));
  for (let i = ordered.length - 1; i >= 0; i--) {
    const list = sets.filter((s) => s.sessionId === ordered[i].id && s.exerciseId === exerciseId);
    if (list.length) return { session: ordered[i], sets: list.sort(bySeq) };
  }
  return null;
}

// Gewicht eines Trainings = höchstes Gewicht; nur vergleichbar, wenn überall Gewicht und gleiche Einheit.
function topWeight(list) {
  if (!list.length || list.some((s) => s.weight == null || !s.unit)) return null;
  if (list.some((s) => s.unit !== list[0].unit)) return null;
  return { weight: Math.max(...list.map((s) => s.weight)), unit: list[0].unit };
}

const totalReps = (list) => list.reduce((n, s) => n + s.reps, 0);

// Ergebnis: { result: 1 | 0 | -1, repsOnly, weightDiff, repsDiff, unit }
export function compareSets(prev, cur) {
  const pw = topWeight(prev);
  const cw = topWeight(cur);
  const repsDiff = totalReps(cur) - totalReps(prev);
  if (pw && cw && pw.unit === cw.unit) {
    const weightDiff = Math.round((cw.weight - pw.weight) * 100) / 100;
    const result = weightDiff !== 0 ? sign(weightDiff) : sign(repsDiff);
    return { result, repsOnly: false, weightDiff, repsDiff, unit: cw.unit };
  }
  return { result: sign(repsDiff), repsOnly: true, weightDiff: 0, repsDiff, unit: null };
}

// Einzelner Satz gegen den Satz gleicher Nummer vom letzten Mal → 1 | 0 | -1
export function compareSet(prev, cur) {
  return compareSets([prev], [cur]).result;
}

export const ARROWS = { 1: '↑', 0: '=', '-1': '↓' };

function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return d + '.' + m + '.';
}

function repsText(n) {
  return (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n) + ' Reps';
}

// Rückmeldung nach der Übung, z. B. "+3 Reps ggü. 19.8."
export function feedbackText(cmp, prevDate) {
  const since = ' ggü. ' + shortDate(prevDate);
  if (cmp.repsOnly) return 'Nur Reps verglichen: ' + repsText(cmp.repsDiff) + since;
  if (cmp.weightDiff > 0) {
    const step = cmp.unit === 'stufe' ? '+' + String(cmp.weightDiff).replace('.', ',') + ' Stufe'
      : '+' + String(cmp.weightDiff).replace('.', ',') + ' kg';
    return 'Gewicht erhöht (' + step + ')' + (cmp.repsDiff >= 0 ? ', Reps gehalten' : '') + since;
  }
  if (cmp.weightDiff < 0) return 'Weniger Gewicht als' + since.replace(' ggü.', '');
  if (cmp.repsDiff === 0) return 'Gleich wie ' + shortDate(prevDate);
  return repsText(cmp.repsDiff) + since;
}

// Steigerungs-Hinweis: letztes Mal alle Sätze ≥ Schwelle und das aktuelle Gewicht ist noch nicht höher.
export function suggestIncrease(prev, currentWeight, currentUnit, threshold = DEFAULT_THRESHOLD) {
  if (!prev || !prev.length || !currentUnit) return false;
  if (!prev.every((s) => s.reps >= threshold)) return false;
  const pw = topWeight(prev);
  if (!pw || pw.unit !== currentUnit) return false;
  return currentWeight == null || currentWeight <= pw.weight;
}

// Geisterwert-Text für Satz n (1-basiert), z. B. "S2 · 130 kg × 10"
export function ghostText(prev, n) {
  const s = prev && prev[n - 1];
  if (!s) return null;
  return 'S' + n + ' · ' + (s.weight == null ? '' : formatWeight(s.weight, s.unit) + ' × ') + s.reps;
}

// Pausentimer: Restsekunden aus Endzeitpunkt (zeitstempelbasiert).
export function remainingSeconds(endAt, now) {
  if (!endAt) return null;
  return Math.max(0, Math.ceil((endAt - now) / 1000));
}

export function formatClock(sec) {
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
