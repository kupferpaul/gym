// Aufruf: node tests/run.mjs  (Node 14+, keine Abhängigkeiten)
import assert from 'assert';
import { readFileSync } from 'fs';
import { parseNotes, buildBackup } from '../tools/notes.mjs';
import { QUOTES, AUTHORS, pickQuote, sourceLabel } from '../js/quotes.js';
import {
  RUN_DEFAULTS, MODE_TEXT, floorTo, roundTo, plan, assess, suggestType, paceSec, formatPace, formatDuration, formatKm,
  parseDuration, isDeloadWeek, weekKey, morningCheckDue,
} from '../js/run.js';
import {
  epley, median, regionOf, exerciseSeries, regionSeries, recentTrend, suggestStartWeight,
  bodyWeightAt, effectiveSets, isUniversal, secondaryOf, regionBalance,
} from '../js/stats.js';
import {
  sortExercises, suggestNext, exerciseSequence, lastSet, prefill, stepWeight, historyStep, resolveStep,
  unitForEquipment, formatWeight, formatDate, renumber, todayISO,
} from '../js/logic.js';
import { toJSON, fromJSON, toCSV, CSV_HEADER, runsToCSV, RUN_CSV_HEADER } from '../js/backup.js';
import { makeRun, findByExternalId } from '../js/sources.js';
import {
  compareSets, compareSet, previousSets, feedbackText, suggestIncrease, ghostText, remainingSeconds, formatClock,
  sessionSummary, workingSets,
} from '../js/progress.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error('✗ ' + name + '\n  ' + e.message); }
}

// Testdaten: zwei Gyms, drei Übungen, drei Sessions.
let t = 0;
const set = (sessionId, exerciseId, order, weight, unit, reps) =>
  ({ id: 'x' + ++t, sessionId, exerciseId, order, weight, unit, reps, createdAt: t });

const gyms = [{ id: 'home', name: 'Home-Gym', isHome: true }, { id: 'fit', name: 'Fit, "Mitte"', isHome: false }];
const exercises = [
  { id: 'chest', name: 'Chest press', aliases: [], defaultUnit: 'kg', muscleGroup: 'chest', dbId: null, createdAt: 1 },
  { id: 'row', name: 'Row', aliases: [], defaultUnit: 'kg', muscleGroup: 'middle back', dbId: null, createdAt: 2 },
  { id: 'curl', name: 'Curl', aliases: ['Bizeps'], defaultUnit: 'kg', muscleGroup: 'biceps', dbId: null, createdAt: 3 },
];
const sessions = [
  { id: 's1', date: '2026-08-12', gymId: 'home', startedAt: 10 },
  { id: 's2', date: '2026-08-19', gymId: 'home', startedAt: 20 },
  { id: 's3', date: '2026-08-15', gymId: 'fit', startedAt: 15 },
];
const sets = [
  set('s1', 'chest', 1, 120, 'kg', 10), set('s1', 'chest', 2, 120, 'kg', 9),
  set('s1', 'row', 1, 50, 'kg', 12),
  set('s3', 'chest', 1, 8, 'stufe', 9),
  set('s3', 'curl', 1, null, null, 12),
  set('s2', 'chest', 1, 130, 'kg', 8), set('s2', 'chest', 2, 130, 'kg', 10), set('s2', 'chest', 3, 130, 'kg', 9),
  set('s2', 'row', 1, 52.5, 'kg', 11),
];

test('Reihenfolge der Übungen in einer Session', () => {
  assert.deepStrictEqual(exerciseSequence(sets.filter((s) => s.sessionId === 's1')), ['chest', 'row']);
});

test('Sortierung: häufigste zuerst, dann übliche Position', () => {
  // chest 3×, row 2× (Position 1), curl 1× (Position 1)
  assert.deepStrictEqual(sortExercises(exercises, sets).map((e) => e.id), ['chest', 'row', 'curl']);
});

test('Sortierung: Gleichstand → übliche Position, dann Name', () => {
  const ex = [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }, { id: 'z', name: 'Z' }];
  const s = [set('q', 'b', 1, 1, 'kg', 1), set('q', 'a', 1, 1, 'kg', 1)];
  assert.deepStrictEqual(sortExercises(ex, s).map((e) => e.id), ['b', 'a', 'z']);
});

test('Vorschlag: typische nächste Übung', () => {
  assert.strictEqual(suggestNext(sets, 'chest', ['chest']), 'row');
});

test('Vorschlag: Start eines Trainings', () => {
  assert.strictEqual(suggestNext(sets, null, []), 'chest');
});

test('Vorschlag: überspringt Erledigtes', () => {
  assert.strictEqual(suggestNext(sets, 'chest', ['chest', 'row']), 'curl');
  assert.strictEqual(suggestNext(sets, 'chest', ['chest', 'row', 'curl']), null);
});

test('Letzter Satz: pro Gym getrennt', () => {
  assert.strictEqual(lastSet('chest', 'home', sessions, sets).weight, 130);
  assert.strictEqual(lastSet('chest', 'fit', sessions, sets).weight, 8);
  assert.strictEqual(lastSet('curl', 'home', sessions, sets), null);
});

test('Vorausfüllen: letzter Wert im Gym, Einheit übernommen', () => {
  assert.deepStrictEqual(prefill(exercises[0], 'home', sessions, sets), { unit: 'kg', weight: 130 });
  assert.deepStrictEqual(prefill(exercises[0], 'fit', sessions, sets), { unit: 'stufe', weight: 8 });
});

test('Vorausfüllen: gemerkte Einheit hat Vorrang, fremde Einheit → kein Gewicht', () => {
  assert.deepStrictEqual(prefill(exercises[0], 'fit', sessions, sets, 'kg'), { unit: 'kg', weight: null });
});

test('Vorausfüllen: neues Gym → Standardeinheit, kein Gewicht', () => {
  assert.deepStrictEqual(prefill(exercises[1], 'fit', sessions, sets), { unit: 'kg', weight: null });
});

test('Vorausfüllen: letztes Mal ohne Gewicht → letztes notiertes Gewicht', () => {
  const st = [...sets, set('s2', 'row', 2, null, null, 12)];
  assert.deepStrictEqual(prefill(exercises[1], 'home', sessions, st), { unit: 'kg', weight: 52.5 });
  const st2 = sets.filter((s) => !(s.sessionId === 's2' && s.exerciseId === 'row')).concat(set('s2', 'row', 1, null, null, 12));
  assert.deepStrictEqual(prefill(exercises[1], 'home', sessions, st2), { unit: 'kg', weight: 50 });
});

test('Vorausfüllen: Übung ohne Gewicht bleibt ohne', () => {
  assert.deepStrictEqual(prefill(exercises[2], 'fit', sessions, sets), { unit: 'kg', weight: null });
  assert.deepStrictEqual(prefill(exercises[2], 'fit', sessions, sets, null), { unit: null, weight: null });
});

test('Gewichtsschritte: nie unter 0, ohne Rundungsfehler', () => {
  assert.strictEqual(stepWeight(130, 'kg', 1, 2.5), 132.5);
  assert.strictEqual(stepWeight(8, 'stufe', -1, 1), 7);
  assert.strictEqual(stepWeight(1, 'kg', -1, 2.5), 0);
  assert.strictEqual(stepWeight(null, 'kg', 1, 2.5), 2.5);
  assert.strictEqual(stepWeight(0.1, 'kg', 1, 0.2), 0.3);
  assert.strictEqual(stepWeight(5, null, 1, 1), null);
});

test('Review T6 (V7): Schrittweite = häufigster Sprung, Tippfehler stört nicht', () => {
  const days = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07'];
  const ss = days.map((d, i) => ({ id: 'd' + i, date: d, gymId: 'g', startedAt: i }));
  const st = [100, 100, 101, 102.5, 105, 105, 107.5].map((w, i) => set('d' + i, 'p', 1, w, 'kg', 8));
  assert.strictEqual(historyStep('p', 'g', 'kg', ss, st), 2.5); // alt: 1
  const stufe = [62.5, 75, 75, 87.5].map((w, i) => set('d' + i, 'q', 1, w, 'stufe', 8));
  assert.strictEqual(historyStep('q', 'g', 'stufe', ss, stufe), 12.5);
});

test('Schrittweite aus Verlauf: pro Gym und Einheit', () => {
  const st = [
    set('s1', 'chest', 1, 110, 'stufe', 10), set('s1', 'chest', 2, 130, 'stufe', 8),
    set('s2', 'chest', 1, 150, 'stufe', 8), set('s2', 'chest', 2, 130, 'stufe', 8),
    set('s2', 'chest', 3, 60, 'kg', 8), set('s3', 'chest', 1, 7, 'stufe', 8),
    set('s1', 'row', 1, 62.5, 'kg', 8), set('s2', 'row', 1, 75, 'kg', 8), set('s2', 'row', 2, null, null, 8),
  ];
  assert.strictEqual(historyStep('chest', 'home', 'stufe', sessions, st), 20);
  assert.strictEqual(historyStep('chest', 'home', 'kg', sessions, st), null);
  assert.strictEqual(historyStep('chest', 'fit', 'stufe', sessions, st), null);
  assert.strictEqual(historyStep('row', 'home', 'kg', sessions, st), 12.5);
  assert.strictEqual(historyStep('row', 'home', null, sessions, st), null);
});

test('Schrittweite: eigene Einstellung > Verlauf > Standard', () => {
  assert.strictEqual(resolveStep(5, 20, 'stufe'), 5);
  assert.strictEqual(resolveStep(null, 20, 'stufe'), 20);
  assert.strictEqual(resolveStep(null, null, 'stufe'), 1);
  assert.strictEqual(resolveStep(undefined, null, 'kg'), 2.5);
});

test('Einheit aus Equipment', () => {
  assert.strictEqual(unitForEquipment('machine'), 'stufe');
  assert.strictEqual(unitForEquipment('cable'), 'stufe');
  assert.strictEqual(unitForEquipment('barbell'), 'kg');
  assert.strictEqual(unitForEquipment('body only'), null);
});

test('Formatierung', () => {
  assert.strictEqual(formatWeight(52.5, 'kg'), '52,5 kg');
  assert.strictEqual(formatWeight(8, 'stufe'), 'Stufe 8');
  assert.strictEqual(formatWeight(null, 'kg'), 'ohne Gewicht');
  assert.strictEqual(formatDate('2026-08-19'), 'Mi, 19.8.26');
  assert.strictEqual(todayISO(new Date(2026, 0, 5)), '2026-01-05');
});

test('Neu nummerieren nach Löschen', () => {
  const rest = sets.filter((s) => s.sessionId === 's2' && s.order !== 2);
  assert.deepStrictEqual(renumber(rest, 'chest').map((s) => [s.order, s.reps]), [[1, 8], [2, 9]]);
});

const data = {
  gyms, exercises, sessions, sets,
  meta: [{ key: 'settings', value: { weightStepKg: 2.5, weightStepStufe: 1 } }, { key: 'lastGymId', value: 'home' }],
  calibrations: [{ id: 'chest|fit|stufe', exerciseId: 'chest', gymId: 'fit', unit: 'stufe', factorToHome: 15, source: 'manuell' }],
  runs: [{
    id: 'r1', date: '2026-10-20T18:30', distanceKm: 3.25, durationSec: 1100, kneeDuring: 2, kneeMorning: null,
    runType: 'lang', surface: 'draußen', avgHr: null, maxHr: null, cadenceSpm: null, note: 'Park, "windig"',
    source: 'manual', externalId: null,
  }],
};

test('Export → Import ergibt identische Daten', () => {
  assert.deepStrictEqual(fromJSON(toJSON(data)), data);
});

test('Import: Backup v1 ohne Kalibrierungen bleibt lesbar', () => {
  const v1 = JSON.parse(toJSON(data));
  v1.version = 1;
  delete v1.calibrations;
  assert.deepStrictEqual(fromJSON(JSON.stringify(v1)).calibrations, []);
});

test('Backup v3: Läufe drin, v2 ohne Läufe importierbar, kaputter Lauf abgelehnt', () => {
  assert.strictEqual(fromJSON(toJSON(data)).runs[0].distanceKm, 3.25);
  const v2 = JSON.parse(toJSON(data));
  v2.version = 2;
  delete v2.runs;
  assert.deepStrictEqual(fromJSON(JSON.stringify(v2)).runs, []);
  const bad = JSON.parse(toJSON(data));
  bad.runs[0].kneeDuring = 11;
  assert.throws(() => fromJSON(JSON.stringify(bad)), /Knie/);
});

test('CSV Läufe: eine Zeile pro Lauf mit Pace', () => {
  const lines = runsToCSV(data).trim().split('\n');
  assert.strictEqual(lines[0], RUN_CSV_HEADER.join(','));
  assert.strictEqual(lines[1], '2026-10-20T18:30,3.25,1100,338,2,,lang,draußen,,,,"Park, ""windig""",manual,');
});

test('Datenquelle: Lauf normalisieren, Duplikat per externalId', () => {
  const r = makeRun({ date: '2026-10-20T18:30', distanceKm: '3.256', durationSec: 1100.4, kneeDuring: '2', avgHr: '' }, 'manual', () => 'id1');
  assert.deepStrictEqual([r.id, r.distanceKm, r.durationSec, r.kneeDuring, r.avgHr, r.surface, r.source],
    ['id1', 3.26, 1100, 2, null, 'draußen', 'manual']);
  assert.strictEqual(findByExternalId([{ externalId: 'g1' }], 'g1').externalId, 'g1');
  assert.strictEqual(findByExternalId([{ externalId: 'g1' }], null), null);
});

test('Import lehnt kaputte Dateien ab', () => {
  assert.throws(() => fromJSON('kein json'), /keine JSON/);
  assert.throws(() => fromJSON('{"format":"anders"}'), /nicht aus dieser App/);
  const bad = JSON.parse(toJSON(data));
  bad.sets[0].sessionId = 'gibtsnicht';
  assert.throws(() => fromJSON(JSON.stringify(bad)), /Satz ohne/);
  const bad2 = JSON.parse(toJSON(data));
  delete bad2.sets;
  assert.throws(() => fromJSON(JSON.stringify(bad2)), /sets/);
});

test('CSV: eine Zeile pro Satz, chronologisch, mit Escaping', () => {
  const lines = toCSV(data).trim().split('\n');
  assert.strictEqual(lines[0], CSV_HEADER.join(','));
  assert.strictEqual(lines.length, 1 + sets.length);
  assert.strictEqual(lines[1], '2026-08-12,Home-Gym,Chest press,chest,1,120,kg,10');
  assert.strictEqual(lines[4], '2026-08-15,"Fit, ""Mitte""",Chest press,chest,1,8,stufe,9');
  assert.strictEqual(lines[5], '2026-08-15,"Fit, ""Mitte""",Curl,biceps,1,,,12');
  assert.strictEqual(lines[9], '2026-08-19,Home-Gym,Row,middle back,1,52.5,kg,11');
});

// ---------- Vergleichslogik (SPEC §4, höheres Gewicht immer besser) ----------
const S = (weight, unit, ...reps) => reps.map((r, i) => ({ weight, unit, reps: r, order: i + 1, createdAt: i }));

test('Vergleich: höheres Gewicht ist besser, auch mit weniger Reps', () => {
  const c = compareSets(S(130, 'kg', 12, 12, 12), S(132.5, 'kg', 9, 8, 8));
  assert.deepStrictEqual([c.result, c.repsOnly, c.weightDiff], [1, false, 2.5]);
});

test('Vergleich: niedrigeres Gewicht ist schlechter, auch mit mehr Reps', () => {
  assert.strictEqual(compareSets(S(130, 'kg', 8, 8, 8), S(120, 'kg', 15, 15, 15)).result, -1);
});

test('Vergleich: gleiches Gewicht → Gesamt-Reps entscheiden', () => {
  assert.strictEqual(compareSets(S(130, 'kg', 8, 10, 9), S(130, 'kg', 9, 10, 10)).result, 1);
  assert.strictEqual(compareSets(S(130, 'kg', 8, 10, 9), S(130, 'kg', 9, 9, 9)).result, 0);
  assert.strictEqual(compareSets(S(130, 'kg', 8, 10, 9), S(130, 'kg', 8, 8, 9)).result, -1);
});

test('Vergleich: fehlendes Gewicht → nur Reps, markiert', () => {
  const c = compareSets(S(null, null, 12, 12), S(null, null, 13, 12));
  assert.deepStrictEqual([c.result, c.repsOnly, c.repsDiff], [1, true, 1]);
  assert.strictEqual(compareSets(S(130, 'kg', 10), S(null, null, 9)).repsOnly, true);
});

test('Vergleich: andere Einheit → nur Reps', () => {
  const c = compareSets(S(8, 'stufe', 10, 10), S(60, 'kg', 10, 10));
  assert.deepStrictEqual([c.result, c.repsOnly], [0, true]);
});

test('Vergleich: Gewicht wechselt innerhalb der Übung → höchstes zählt', () => {
  const prev = [...S(130, 'kg', 10), ...S(120, 'kg', 12)];
  assert.strictEqual(compareSets(prev, S(130, 'kg', 10, 13)).result, 1);
});

test('Vergleich: Herantast-Sätze zählen nicht (nur Sätze mit Höchstgewicht)', () => {
  const ramp = [...S(16, 'kg', 20), ...S(20, 'kg', 20), ...S(25, 'kg', 20)];
  assert.deepStrictEqual(workingSets(ramp).map((s) => s.weight), [25]);
  const c = compareSets(ramp, S(25, 'kg', 12, 12, 11));
  assert.deepStrictEqual([c.result, c.repsDiff], [1, 15]);
  assert.strictEqual(feedbackText(c, '2026-10-20'), '+15 Reps ggü. 20.10.');
  // Normalfall unverändert: alle Sätze gleiches Gewicht → alle zählen
  assert.strictEqual(workingSets(S(130, 'kg', 8, 10, 9)).length, 3);
  // ohne Gewicht: alle Sätze
  assert.strictEqual(workingSets(S(null, null, 12, 12)).length, 2);
  // Steigerungs-Hinweis schaut nur auf Arbeitssätze
  assert.strictEqual(suggestIncrease([...S(20, 'kg', 8), ...S(25, 'kg', 12, 12)], 25, 'kg'), true);
});

test('Review T1 (V1): mehr Gewicht nur ▲ mit genug Reps (60-%-Regel), nie ▼', () => {
  const row = (p, c) => compareSets(p, c);
  let c = row(S(100, 'kg', 12, 12, 12), S(102.5, 'kg', 6, 5, 5)); // 16 < max(21,6; 24)
  assert.deepStrictEqual([c.result, c.building], [0, true]);
  assert.strictEqual(feedbackText(c, '2026-10-20'), 'Gewicht erhöht (+2,5 kg), Reps im Aufbau ggü. 20.10.');
  c = row(S(110, 'kg', 10, 10, 9), S(120, 'kg', 9, 8)); // 17 < 17,4
  assert.strictEqual(c.result, 0);
  c = row(S(100, 'kg', 10, 10, 10), S(105, 'kg', 8, 8, 8)); // 24 ≥ max(18; 24)
  assert.strictEqual(c.result, 1);
  c = row(S(105, 'kg', 6), S(100, 'kg', 10, 10, 10)); // weniger Gewicht bleibt ▼ (F2)
  assert.strictEqual(c.result, -1);
});

test('Review T7 (V8): Arbeitssätze ab 90 % des Höchstgewichts', () => {
  const t = [...S(60, 'kg', 12), ...S(80, 'kg', 10), ...S(100, 'kg', 10, 10), ...S(90, 'kg', 14)];
  assert.deepStrictEqual(workingSets(t).map((s) => s.weight), [100, 100, 90]);
  assert.strictEqual(workingSets(t).reduce((n, s) => n + s.reps, 0), 34);
  // Goblet-Fall bleibt: 16 und 20 kg liegen unter 22,5 kg
  assert.deepStrictEqual(workingSets([...S(16, 'kg', 20), ...S(20, 'kg', 20), ...S(25, 'kg', 20)]).map((s) => s.weight), [25]);
});

test('Vergleich: einzelner Satz', () => {
  assert.strictEqual(compareSet(S(130, 'kg', 10)[0], S(130, 'kg', 11)[0]), 1);
  assert.strictEqual(compareSet(S(130, 'kg', 10)[0], S(130, 'kg', 10)[0]), 0);
  assert.strictEqual(compareSet(S(130, 'kg', 10)[0], S(127.5, 'kg', 12)[0]), -1);
});

test('Vorheriges Training: gleiches Gym, aktuelle Session ausgenommen', () => {
  const p = previousSets('chest', 'home', sessions, sets, 's2');
  assert.strictEqual(p.session.id, 's1');
  assert.deepStrictEqual(p.sets.map((s) => s.reps), [10, 9]);
  assert.strictEqual(previousSets('chest', 'fit', sessions, sets, 's3'), null);
  assert.strictEqual(previousSets('chest', 'home', sessions, sets, null).session.id, 's2');
});

test('Rückmeldungstexte', () => {
  assert.strictEqual(feedbackText(compareSets(S(130, 'kg', 8, 10, 9), S(130, 'kg', 9, 11, 10)), '2026-08-19'), '+3 Reps ggü. 19.8.');
  assert.strictEqual(feedbackText(compareSets(S(130, 'kg', 8, 8), S(132.5, 'kg', 8, 8)), '2026-08-19'), 'Gewicht erhöht (+2,5 kg), Reps gehalten ggü. 19.8.');
  assert.strictEqual(feedbackText(compareSets(S(8, 'stufe', 12), S(9, 'stufe', 9)), '2026-08-19'), 'Gewicht erhöht (+1 Stufe) ggü. 19.8.');
  assert.strictEqual(feedbackText(compareSets(S(130, 'kg', 8), S(130, 'kg', 8)), '2026-08-19'), 'Gleich wie 19.8.');
  assert.strictEqual(feedbackText(compareSets(S(130, 'kg', 8), S(130, 'kg', 6)), '2026-08-19'), '−2 Reps ggü. 19.8.');
  assert.strictEqual(feedbackText(compareSets(S(null, null, 8), S(null, null, 10)), '2026-08-19'), 'Nur Reps verglichen: +2 Reps ggü. 19.8.');
  assert.strictEqual(feedbackText(compareSets(S(130, 'kg', 8), S(120, 'kg', 8)), '2026-08-19'), 'Weniger Gewicht als 19.8.');
});

test('Steigerungs-Hinweis', () => {
  assert.strictEqual(suggestIncrease(S(130, 'kg', 12, 12, 13), 130, 'kg'), true);
  assert.strictEqual(suggestIncrease(S(130, 'kg', 12, 11, 13), 130, 'kg'), false);
  assert.strictEqual(suggestIncrease(S(130, 'kg', 12, 12, 12), 132.5, 'kg'), false);
  assert.strictEqual(suggestIncrease(S(130, 'kg', 10, 10), 130, 'kg', 10), true);
  assert.strictEqual(suggestIncrease(S(null, null, 15, 15), null, null), false);
  assert.strictEqual(suggestIncrease(S(8, 'stufe', 12, 12), 60, 'kg'), false);
  assert.strictEqual(suggestIncrease(null, 130, 'kg'), false);
});

test('Geisterwert und Timer', () => {
  assert.strictEqual(ghostText(S(130, 'kg', 8, 10), 2), 'S2 · 130 kg × 10');
  assert.strictEqual(ghostText(S(null, null, 12), 1), 'S1 · 12');
  assert.strictEqual(ghostText(S(130, 'kg', 8), 2), null);
  assert.strictEqual(remainingSeconds(10000, 9001), 1);
  assert.strictEqual(remainingSeconds(10000, 12000), 0);
  assert.strictEqual(remainingSeconds(null, 0), null);
  assert.strictEqual(formatClock(65), '1:05');
});

// ---------- Training abschließen ----------
test('Zusammenfassung: Vergleich pro Übung, Zählung, Dauer', () => {
  const sum = sessionSummary(sessions[1], sessions, sets); // s2 (19.8.) ggü. s1 (12.8.) im Home-Gym
  assert.deepStrictEqual(sum.exercises.map((e) => e.exerciseId), ['chest', 'row']);
  assert.deepStrictEqual(sum.exercises.map((e) => e.cmp.result), [1, 1]); // 130 > 120, 52,5 > 50
  assert.deepStrictEqual([sum.setCount, sum.reps, sum.better, sum.compared], [4, 38, 2, 2]);
  assert.strictEqual(sum.minutes, 1); // createdAt im Test nur ms auseinander → mindestens 1 Min.
  const first = sessionSummary(sessions[0], sessions, sets);
  assert.deepStrictEqual([first.compared, first.better], [0, 0]);
  assert.strictEqual(sessionSummary({ id: 'leer', date: '2026-09-01', gymId: 'home' }, sessions, sets).minutes, null);
});

test('Sprüche: fest pro Training, aus der Liste', () => {
  assert.strictEqual(pickQuote('abc'), pickQuote('abc'));
  assert.ok(QUOTES.includes(pickQuote('xyz-123')));
  assert.ok(QUOTES.every((q) => q.text && q.source && AUTHORS[q.author]));
  ['arnold', 'ali', 'lee'].forEach((a) => assert.ok(QUOTES.filter((q) => q.author === a).length >= 10));
  assert.strictEqual(sourceLabel({ source: 'zugeschrieben' }), '(vielleicht)');
  assert.strictEqual(sourceLabel({ source: 'zugeschrieben, gekürzt' }), '(vielleicht, gekürzt)');
  assert.strictEqual(sourceLabel({ source: 'Longstreet (1971)' }), 'Longstreet (1971)');
});

// ---------- Statistik / Gym-Vergleich (SPEC §4b, §5, Expert Review P1) ----------
{
  const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, a + ' ≠ ' + b);
  const sess = (id, date, gymId) => ({ id, date, gymId, startedAt: Date.parse(date) });
  const X = { id: 'x', muscleGroup: 'chest' };

  test('Epley, Median und Regionen (Nacken → Rücken)', () => {
    close(epley(100, 30), 200);
    assert.strictEqual(median([3, 1, 2]), 2);
    assert.strictEqual(median([4, 1, 2, 3]), 2.5);
    assert.strictEqual(regionOf('lats'), 'Rücken');
    assert.strictEqual(regionOf('neck'), 'Rücken');
    assert.strictEqual(regionOf('abdominals'), 'Rumpf');
    assert.strictEqual(regionOf('xyz'), null);
  });

  // T2: Home 100×10, 110×10, 110×11 · Reise 7×15, 8×12, 8×13
  const home = [sess('h1', '2026-09-01', 'home'), sess('h2', '2026-09-15', 'home'), sess('h3', '2026-09-25', 'home')];
  const trip = [sess('t1', '2026-10-01', 'trip'), sess('t2', '2026-10-05', 'trip'), sess('t3', '2026-10-08', 'trip')];
  const T2sets = [
    set('h1', 'x', 1, 100, 'stufe', 10), set('h2', 'x', 1, 110, 'stufe', 10), set('h3', 'x', 1, 110, 'stufe', 11),
    set('t1', 'x', 1, 7, 'stufe', 15), set('t2', 'x', 1, 8, 'stufe', 12), set('t3', 'x', 1, 8, 'stufe', 13),
  ];

  test('Review T2 (V2): Faktor aus Median, vorläufig bis 3 Trainings, dann eingefroren', () => {
    const f = (n) => exerciseSeries(X, 'home', home.concat(trip.slice(0, n)), T2sets).factors.get('trip|stufe');
    close(f(1).factor, 146.6667 / 10.5, 1e-3);
    assert.strictEqual(f(1).source, 'vorläufig');
    close(f(2).factor, 146.6667 / 10.85, 1e-3); // 13,52
    close(f(3).factor, 146.6667 / 11.2, 1e-3); // 13,10
    assert.strictEqual(f(3).source, 'geschätzt');
    const s = exerciseSeries(X, 'home', home.concat(trip), T2sets);
    assert.deepStrictEqual(s.points.filter((p) => p.gymId === 'trip').map((p) => p.provisional), [false, false, false]);
    assert.strictEqual(exerciseSeries(X, 'home', home.concat(trip.slice(0, 2)), T2sets).points.slice(-1)[0].provisional, true);
  });

  test('Review T3 (V3): Basis = Median der ersten 3 Trainings (innerhalb 21 Tagen)', () => {
    const ss = [sess('a1', '2026-09-01', 'home'), sess('a2', '2026-09-08', 'home'), sess('a3', '2026-09-15', 'home'), sess('a4', '2026-09-22', 'home')];
    const st = [set('a1', 'x', 1, 100, 'kg', 10), set('a2', 'x', 1, 110, 'kg', 10), set('a3', 'x', 1, 110, 'kg', 11), set('a4', 'x', 1, 120, 'kg', 9)];
    const s = exerciseSeries(X, 'home', ss, st);
    assert.deepStrictEqual(s.points.map((p) => Math.round(p.pct * 10) / 10), [-9.1, 0, 2.5, 6.4]);
    assert.strictEqual(s.establishedDate, '2026-09-15');
    // F4: nur 2 Trainings → Basis erst nach 21 Tagen (Median der beiden), vorher keine Prozentkurve
    const two = exerciseSeries(X, 'home', ss.slice(0, 2), st, [], { today: '2026-09-10' });
    assert.deepStrictEqual([two.baseReady, two.points[0].pct], [false, null]);
    const later = exerciseSeries(X, 'home', ss.slice(0, 2), st, [], { today: '2026-09-25' });
    assert.strictEqual(later.baseReady, true);
    close(later.base, (133.3333 + 146.6667) / 2, 1e-3);
    assert.strictEqual(later.establishedDate, '2026-09-22');
  });

  test('Review T4 (V4): über 15 Reps → Punkt geschätzt, kein Cap', () => {
    const ss = [sess('a1', '2026-09-01', 'home'), sess('a2', '2026-09-03', 'home'), sess('a3', '2026-09-05', 'home')];
    const st = [set('a1', 'x', 1, 50, 'kg', 20), set('a2', 'x', 1, 55, 'kg', 15), set('a3', 'x', 1, 60, 'kg', 12)];
    const s = exerciseSeries(X, 'home', ss, st);
    assert.deepStrictEqual(s.points.map((p) => Math.round(p.raw * 10) / 10), [83.3, 82.5, 84]);
    assert.deepStrictEqual(s.points.map((p) => p.estimated), [true, false, false]);
  });

  test('Review T5 (V6): Trend als Theil-Sen-Steigung, ±3 %', () => {
    const mk = (vals) => ({ points: vals.map(([d, v]) => ({ date: d, value: v })) });
    const pts = [['2026-10-01', 140], ['2026-10-08', 142], ['2026-10-15', 160], ['2026-10-22', 145], ['2026-10-29', 147]];
    const t = recentTrend(mk(pts), '2026-10-29');
    close(t.change, 0.244048 * 28 / 145 * 100, 1e-2); // +4,7 % (Review-Text: 4,8 % – dort Rechenfehler)
    assert.strictEqual(t.result, 1);
    const outlier = recentTrend(mk(pts.map(([d, v], i) => [d, i === 2 ? 200 : v])), '2026-10-29');
    assert.strictEqual(outlier.result, 1);
    assert.ok(outlier.change < 10);
    const two = recentTrend(mk([['2026-10-20', 100], ['2026-10-27', 102]]), '2026-10-29');
    assert.deepStrictEqual([two.result, two.twoOnly], [0, true]); // +2 % < 3 %
  });

  test('Serie: Faktor von Hand; kg pro Stufe rechnet in kg', () => {
    const manual = exerciseSeries(X, 'home', home.concat(trip), T2sets, [{ id: 'x|trip|stufe', factorToHome: 15 }]);
    assert.deepStrictEqual(manual.factors.get('trip|stufe'), { factor: 15, source: 'manuell' });
    const kg = exerciseSeries(X, 'home', home.concat(trip), T2sets, [
      { id: 'x|trip|stufe', kgPerUnit: 10 }, { id: 'x|home|stufe', kgPerUnit: 0.5 }]);
    assert.deepStrictEqual(kg.factors.get('trip|stufe'), { factor: 1, source: 'kg' });
    close(kg.points[3].value, 70 * 1.5); // 7 Stufen × 10 kg, 15 Reps
  });

  test('Review T10 (V12): Grundgewicht macht Index-Stufen exakt', () => {
    const ss = [sess('a1', '2026-09-01', 'home'), sess('a2', '2026-09-08', 'home')];
    const st = [set('a1', 'row', 1, 9, 'stufe', 12), set('a2', 'row', 1, 11, 'stufe', 12)];
    const ratio = (cals) => {
      const s = exerciseSeries({ id: 'row' }, 'home', ss, st, cals);
      return [Math.round((s.points[1].raw / s.points[0].raw - 1) * 1000) / 10, s.points[1].index];
    };
    assert.deepStrictEqual(ratio([]), [22.2, true]);
    assert.deepStrictEqual(ratio([{ id: 'row|home|stufe', kgPerUnit: 5, baseKg: 10 }]), [18.2, false]);
    assert.deepStrictEqual(ratio([{ id: 'row|home|stufe', kgPerUnit: 5 }]), [22.2, true]); // ohne Grundgewicht bleibt markiert (F7)
  });

  test('Review T12 (S11) und S12: Einheiten-Gleichstand, gespeichertes Bezugsgerät', () => {
    const ss = [sess('a1', '2026-09-01', 'home')];
    const st = [set('a1', 'x', 1, 50, 'kg', 10), set('a1', 'x', 2, 50, 'kg', 10), set('a1', 'x', 3, 9, 'stufe', 10), set('a1', 'x', 4, 9, 'stufe', 10)];
    assert.strictEqual(exerciseSeries(X, 'home', ss, st, [], { refMachine: 'home|stufe' }).points[0].unit, 'stufe');
    assert.strictEqual(exerciseSeries(X, 'home', ss, st).points[0].unit, 'kg'); // höchstes e1RM
    assert.strictEqual(exerciseSeries(X, 'home', home.concat(trip), T2sets).ref, 'home|stufe');
    assert.strictEqual(exerciseSeries(X, 'home', home.concat(trip), T2sets, [], { refMachine: 'trip|stufe' }).ref, 'trip|stufe');
  });

  test('Serie: ohne Gewicht keine Punkte', () => {
    assert.strictEqual(exerciseSeries({ id: 'leer' }, 'home', home, [set('h1', 'leer', 1, null, null, 12)]).points.length, 0);
  });

  test('Review T11 (V5): Region ohne verfallene und noch nicht eingetretene Übungen', () => {
    const pt = (date, pct) => ({ date, pct, value: 100 + (pct || 0), sessionId: date });
    const press = { exerciseId: 'press', baseReady: true, establishedDate: '2026-08-01', points: [pt('2026-07-20', 0), pt('2026-08-01', 5), pt('2026-10-30', 17)] };
    const fly = { exerciseId: 'fly', baseReady: true, establishedDate: '2026-08-10', points: [pt('2026-07-25', 0), pt('2026-08-10', 3), pt('2026-08-31', 7)] };
    const cable = { exerciseId: 'cable', baseReady: false, establishedDate: null, points: [pt('2026-10-20', null), pt('2026-10-30', null)] };
    const r = regionSeries([press, fly, cable], [{ id: 'press', muscleGroup: 'chest' }, { id: 'fly', muscleGroup: 'chest' }, { id: 'cable', muscleGroup: 'chest' }]);
    const last = r.Brust.slice(-1)[0];
    assert.strictEqual(last.date, '2026-10-30');
    assert.strictEqual(last.pct, 17);
    assert.deepStrictEqual(last.excluded.map((e) => e.exerciseId + ':' + e.why).sort(), ['cable:neu', 'fly:pause']);
    assert.strictEqual(r.Brust.find((p) => p.date === '2026-08-31').pct, 6.2); // V14: (5 × 2 + 7 × 3) / 5 Trainings in 56 Tagen
  });

  test('Region: Index-Punkt im Reise-Gym wirft die Übung nicht raus', () => {
    const pt = (date, pct, index = false) => ({ date, pct, value: 100, sessionId: date, index });
    const press = { exerciseId: 'press', baseReady: true, establishedDate: '2026-09-01', points: [pt('2026-09-01', 0), pt('2026-09-10', 10), pt('2026-09-20', 12, true)] };
    const r = regionSeries([press], [{ id: 'press', muscleGroup: 'chest' }]);
    assert.deepStrictEqual(r.Brust.map((p) => [p.date, p.pct]), [['2026-09-01', 0], ['2026-09-10', 10]]);
  });

  test('Region: Index-Stufen-Übung zählt nicht', () => {
    const pt = (date, pct) => ({ date, pct, value: 100, sessionId: date, index: true });
    const row = { exerciseId: 'row', baseReady: true, establishedDate: '2026-09-01', points: [pt('2026-09-01', 0), pt('2026-09-10', 22)] };
    assert.deepStrictEqual(regionSeries([row], [{ id: 'row', muscleGroup: 'middle back' }]), {});
  });

  test('Review T9 (V11): RIR zählt als mögliche Wiederholungen', () => {
    const one = (extra) => exerciseSeries(X, 'home', [sess('a1', '2026-09-01', 'home')], [{ ...set('a1', 'x', 1, 100, 'kg', 10), ...extra }]).points[0].raw;
    close(one({}), 133.3333, 1e-3);
    close(one({ rir: 2 }), 140);
    close(one({ rir: 0 }), 133.3333, 1e-3);
  });

  test('V11: Weg 1 nutzt RIR nur, wenn sie bei allen Arbeitssätzen beider Trainings vorliegt', () => {
    const w = (reps, rir) => ({ weight: 100, unit: 'kg', reps, rir });
    assert.strictEqual(compareSets([w(10, 2), w(10, 2)], [w(10, 0), w(10, 1)]).repsDiff, -3);
    assert.strictEqual(compareSets([w(10, 2), w(10, undefined)], [w(10, 0), w(10, 1)]).repsDiff, 0);
  });

  test('Schalter "Gewicht überall gleich": Faktor 1 statt Schätzung, nur zwischen kg-Geräten', () => {
    const ss = [sess('a1', '2026-09-01', 'home'), sess('a2', '2026-09-08', 'home'), sess('b1', '2026-09-15', 'trip')];
    const st = [set('a1', 'x', 1, 20, 'kg', 10), set('a2', 'x', 1, 22.5, 'kg', 10), set('b1', 'x', 1, 25, 'kg', 10)];
    const off = exerciseSeries(X, 'home', ss, st);
    assert.strictEqual(off.factors.get('trip|kg').source, 'vorläufig');
    const on = exerciseSeries({ ...X, sameEverywhere: true }, 'home', ss, st);
    assert.deepStrictEqual(on.factors.get('trip|kg'), { factor: 1, source: 'gleich' });
    assert.strictEqual(on.points[2].estimated, false);
    close(on.points[2].value, epley(25, 10));
    // Maschine in Stufen bleibt eigenes Gerät mit Schätzung
    const mixed = exerciseSeries({ ...X, sameEverywhere: true }, 'home', ss, [set('a1', 'x', 1, 20, 'kg', 10), set('b1', 'x', 1, 7, 'stufe', 10)]);
    assert.notStrictEqual(mixed.factors.get('trip|stufe').source, 'gleich');
    assert.strictEqual(isUniversal({ kind: 'bodyweight' }), true);
    assert.strictEqual(isUniversal({ kind: 'run' }), false);
  });

  test('Vergleich über alle Gyms: gymId null', () => {
    const ss = [sess('a1', '2026-09-01', 'home'), sess('b1', '2026-09-08', 'trip'), sess('a2', '2026-09-15', 'home')];
    const st = [set('a1', 'x', 1, 20, 'kg', 10), set('b1', 'x', 1, 25, 'kg', 8)];
    assert.strictEqual(previousSets('x', 'home', ss, st, 'a2').session.id, 'a1');
    assert.strictEqual(previousSets('x', null, ss, st, 'a2').session.id, 'b1');
    assert.strictEqual(prefill({ id: 'x', defaultUnit: 'kg' }, null, ss, st).weight, 25);
  });

  test('Review V13: Körpergewicht mit Datum, Anteil und Zusatz', () => {
    const bw = [{ date: '2026-09-01', kg: 80 }, { date: '2026-10-01', kg: 82 }];
    assert.strictEqual(bodyWeightAt(bw, '2026-09-15'), 80);
    assert.strictEqual(bodyWeightAt(bw, '2026-10-01'), 82);
    assert.strictEqual(bodyWeightAt(bw, '2026-08-01'), 80); // vor dem ersten Eintrag: erster Eintrag
    assert.strictEqual(bodyWeightAt([], '2026-09-15'), null);
    const dip = { id: 'd', kind: 'bodyweight', bodyShare: 0.95 };
    const ss = [sess('a1', '2026-09-01', 'home'), sess('b1', '2026-09-08', 'trip')];
    const st = [set('a1', 'd', 1, null, null, 10), set('b1', 'd', 1, 10, 'kg', 8), set('b1', 'd', 2, -20, 'kg', 12)];
    const eff = effectiveSets(dip, st, ss, bw);
    assert.deepStrictEqual(eff.map((x) => [x.weight, x.addKg]), [[76, 0], [86, 10], [56, -20]]);
    const s = exerciseSeries(dip, 'home', ss, st, [], { bodyWeights: bw });
    close(s.points[0].raw, 76 * (1 + 10 / 30));
    close(s.points[1].raw, 86 * (1 + 8 / 30));
    assert.deepStrictEqual(s.factors.get('trip|kg'), { factor: 1, source: 'gleich' }); // überall gleich
    const none = exerciseSeries(dip, 'home', ss, st);
    assert.deepStrictEqual([none.points.length, none.needsBodyWeight], [0, true]);
    // Weg 1: mehr Zusatz ist mehr Last
    const c = compareSets(effectiveSets(dip, [st[0]], ss, bw), effectiveSets(dip, [{ ...st[1], reps: 10 }], ss, bw));
    assert.strictEqual(c.result, 1);
  });

  test('Review V14–V16: Region gewichtet, Hohlpunkt-Regel, sekundäre Muskelgruppe', () => {
    const pt = (date, pct, estimated = false) => ({ date, pct, value: 100, sessionId: date, estimated });
    const a = { exerciseId: 'a', baseReady: true, establishedDate: '2026-09-01', points: [pt('2026-09-01', 0), pt('2026-09-05', 10), pt('2026-09-09', 20)] };
    const b = { exerciseId: 'b', baseReady: true, establishedDate: '2026-09-09', points: [pt('2026-09-09', 40, true)] };
    const r = regionSeries([a, b], [{ id: 'a', muscleGroup: 'chest', name: 'A' }, { id: 'b', muscleGroup: 'chest', name: 'B' }]);
    const last = r.Brust.slice(-1)[0];
    close(last.pct, (20 * 3 + 40 * 1) / 4); // V14: a hat 3, b hat 1 Training
    assert.strictEqual(last.estimated, false); // V15: 1/4 geschätzt ist nicht > 1/3
    const b2 = { ...b, points: [pt('2026-09-01', 0, true), pt('2026-09-09', 40, true)] };
    assert.strictEqual(regionSeries([a, b2], [{ id: 'a', muscleGroup: 'chest', name: 'A' }, { id: 'b', muscleGroup: 'chest', name: 'B' }]).Brust.slice(-1)[0].estimated, true);
    // V16: Chest press zählt in Arme mit halbem Gewicht
    const c = { exerciseId: 'c', baseReady: true, establishedDate: '2026-09-09', points: [pt('2026-09-09', 10)] };
    const sec = regionSeries([a, c], [{ id: 'a', muscleGroup: 'chest', name: 'Chest press' }, { id: 'c', muscleGroup: 'biceps', name: 'Curl', muscleGroup2: null }]);
    close(sec.Arme.slice(-1)[0].pct, (10 * 1 + 20 * 1.5) / 2.5);
    assert.strictEqual(secondaryOf({ name: 'Chest press' }), 'triceps');
    assert.strictEqual(secondaryOf({ name: 'Klimmzug' }), 'biceps');
    assert.strictEqual(secondaryOf({ name: 'Chest press', muscleGroup2: null }), null);
    assert.strictEqual(secondaryOf({ name: 'Fly' }), null);
  });

  test('Review V17: Balance zählt Arbeitssätze pro Region, sekundär halb', () => {
    const ss = [sess('a1', '2026-10-10', 'home'), sess('a2', '2026-09-01', 'home')];
    const st = [set('a1', 'p', 1, 50, 'kg', 10), set('a1', 'p', 2, 100, 'kg', 10), set('a1', 'p', 3, 100, 'kg', 10), set('a2', 'p', 1, 100, 'kg', 10)];
    const b = regionBalance(ss, st, [{ id: 'p', name: 'Chest press', muscleGroup: 'chest' }], '2026-10-20');
    assert.strictEqual(b.Brust, 2); // Herantast-Satz und alter Termin zählen nicht
    assert.strictEqual(b.Arme, 1);
    assert.strictEqual(b.Beine, 0);
    // Körpergewicht: 90-%-Regel auf der wirksamen Last, nicht auf dem Zusatz
    const bwSets = [set('a1', 'k', 1, 0, 'kg', 8), set('a1', 'k', 2, 2.5, 'kg', 6), set('a1', 'k', 3, -5, 'kg', 10)];
    const k = regionBalance(ss, bwSets, [{ id: 'k', name: 'Klimmzug', muscleGroup: 'lats', kind: 'bodyweight' }], '2026-10-20', 28, [{ date: '2026-10-01', kg: 80 }]);
    assert.strictEqual(k['Rücken'], 3);
  });

  test('Review V18: Volumen über Arbeitssätze, umgerechnet', () => {
    const ss = [sess('a1', '2026-09-01', 'home')];
    const st = [set('a1', 'x', 1, 50, 'kg', 10), set('a1', 'x', 2, 100, 'kg', 10), set('a1', 'x', 3, 100, 'kg', 8)];
    const s = exerciseSeries(X, 'home', ss, st);
    assert.strictEqual(s.points[0].volumeValue, 1800);
  });

  test('Review T8 (V9): Startgewicht über Ziel-Reps, auf Schrittweite gerundet', () => {
    const ss = [sess('a1', '2026-09-01', 'home')];
    const st = [set('a1', 'x', 1, 70, 'kg', 12)];
    const cals = [{ id: 'x|neu|kg', factorToHome: 2 }];
    const s = exerciseSeries(X, 'home', ss, st, cals);
    assert.deepStrictEqual(suggestStartWeight(s, 'neu', 'kg', cals, 'x', { reps: 8, step: 2.5 }), { weight: 37.5, reps: 8 });
    assert.strictEqual(suggestStartWeight(s, 'neu', 'stufe', cals, 'x'), null); // kein Faktor für Stufe
    assert.strictEqual(suggestStartWeight(s, 'home', 'kg', [{ id: 'x|home|kg', factorToHome: 2 }], 'x'), null); // hat schon Historie
  });
}

// ---------- Lauf (Brief Lauf-Funktion, Phase 1) ----------
{
  let n = 0;
  // Lauf an Tag `day` (YYYY-MM-DD); Standard: 7:00 min/km (kein Pace-Hinweis), Knie 0, lang.
  const R = (day, km, extra = {}) => ({
    id: 'run' + ++n, date: day + 'T18:00', distanceKm: km, durationSec: Math.round(km * 420),
    kneeDuring: 0, kneeMorning: null, runType: 'lang', surface: 'draußen', source: 'manual', ...extra,
  });
  const NOW = '2026-10-20';

  test('Lauf: Rundung robust (3,0 × 1,1 = 3,3)', () => {
    assert.strictEqual(floorTo(3.0 * 1.1, 0.1), 3.3);
    assert.strictEqual(floorTo(2.5 * 1.1, 0.1), 2.7);
    assert.strictEqual(roundTo(3.3 * 0.75, 0.5), 2.5);
  });

  test('Lauf: keine Läufe, Basiswert 2,0 → Soll lang 2,2', () => {
    assert.strictEqual(plan([], NOW).sollLong, 2.2);
  });

  test('Lauf: 2,0 vor 10 Tagen, 2,5 vor 3 Tagen → L30 2,5, Soll 2,7', () => {
    const p = plan([R('2026-10-10', 2.0), R('2026-10-17', 2.5)], NOW);
    assert.deepStrictEqual([p.l30, p.sollLong, p.mode], [2.5, 2.7, 'green']);
  });

  test('Lauf: Lauf vor 31 Tagen zählt nicht → Soll 3,3', () => {
    const p = plan([R('2026-09-19', 5.0), R('2026-10-15', 3.0)], NOW);
    assert.deepStrictEqual([p.l30, p.sollLong], [3.0, 3.3]);
  });

  test('Lauf: 3,0 grün, dann 3,3 mit Knie 4 → Rot, Soll 3,0', () => {
    const runs = [R('2026-10-12', 3.0), R('2026-10-15', 3.3, { kneeDuring: 4 })];
    assert.strictEqual(assess(runs[1], runs).status, 'red');
    const p = plan(runs, NOW);
    assert.deepStrictEqual([p.mode, p.sollLong], ['red', 3.0]);
    assert.strictEqual(MODE_TEXT[p.mode], 'Distanz halten, nicht steigern.');
  });

  test('Lauf: 3,0 grün, dann zwei rote → Rot zweimal, Soll 2,4, Hinweis abklären', () => {
    const runs = [R('2026-10-10', 3.0), R('2026-10-13', 3.3, { kneeDuring: 5 }), R('2026-10-16', 3.0, { kneeDuring: 4 })];
    assert.strictEqual(assess(runs[2], runs).status, 'red2');
    const p = plan(runs, NOW);
    assert.deepStrictEqual([p.mode, p.sollLong], ['red2', 2.4]);
    assert.match(MODE_TEXT[p.mode], /abklären/);
  });

  test('Lauf: Morgen-Check "schlechter" macht 3,3 nachträglich rot → Soll 3,0', () => {
    const runs = [R('2026-10-12', 3.0), R('2026-10-15', 3.3, { kneeDuring: 2 })];
    assert.strictEqual(plan(runs, NOW).sollLong, 3.6);
    runs[1].kneeMorning = 'schlechter';
    assert.strictEqual(assess(runs[1], runs).status, 'red');
    assert.strictEqual(plan(runs, NOW).sollLong, 3.0);
  });

  test('Lauf: rote Läufe zählen nicht für L30 (nach Erholung vom schmerzfreien Lauf aus)', () => {
    const runs = [R('2026-10-08', 3.0), R('2026-10-11', 3.3, { kneeDuring: 5 }), R('2026-10-14', 3.0)];
    const p = plan(runs, NOW);
    assert.deepStrictEqual([p.mode, p.l30, p.sollLong], ['green', 3.0, 3.3]);
  });

  test('Lauf: Montag lang, Dienstag kurz → Gelb Lauftag nach Lauftag', () => {
    const runs = [R('2026-10-12', 3.0), R('2026-10-13', 2.0, { runType: 'kurz' })];
    const a = assess(runs[1], runs);
    assert.strictEqual(a.status, 'yellow');
    assert.ok(a.reasons.includes('Lauftag direkt nach Lauftag.'));
  });

  test('Lauf: Montag lang, Dienstag aufwärmen → keine Warnung', () => {
    const runs = [R('2026-10-12', 3.0), R('2026-10-13', 1.5, { runType: 'aufwärmen' })];
    const a = assess(runs[1], runs);
    assert.deepStrictEqual([a.status, a.reasons, a.hints], ['green', [], []]);
    // zählt aber für L30
    assert.strictEqual(plan([R('2026-10-12', 1.0), R('2026-10-13', 1.5, { runType: 'aufwärmen' })], NOW).l30, 1.5);
  });

  test('Lauf: 3,5 km in 20:04 → Pace 5:44, Gelb schneller als 6:30', () => {
    const r = R('2026-10-15', 3.5, { durationSec: parseDuration('20:04') });
    assert.strictEqual(formatPace(paceSec(r)), '5:44 min/km');
    const a = assess(r, [r]);
    assert.strictEqual(a.status, 'yellow');
    assert.ok(a.reasons.includes('Pace 5:44 min/km schneller als 6:30.'));
  });

  test('Lauf: letzter langer 3,3 → Soll kurz 2,5', () => {
    assert.strictEqual(plan([R('2026-10-15', 3.3)], NOW).sollShort, 2.5);
  });

  test('Lauf: 4,0 km bei Soll 3,3 → Gelb 21 % über Soll', () => {
    const runs = [R('2026-10-10', 3.0), R('2026-10-15', 4.0)];
    const a = assess(runs[1], runs);
    assert.strictEqual(a.sollBefore, 3.3);
    assert.strictEqual(a.status, 'yellow');
    assert.ok(a.reasons[0].startsWith('21 % über Soll'));
  });

  test('Lauf: Lauftyp-Vorschlag, Fortschritt, Puls, Kadenz', () => {
    assert.strictEqual(suggestType(3.0, 3.3), 'lang'); // 3,0 ≥ 2,97
    assert.strictEqual(suggestType(2.9, 3.3), 'kurz');
    assert.strictEqual(plan([R('2026-10-15', 3.0)], NOW).progress, 0.3);
    const hr = R('2026-10-15', 2.0, { avgHr: 160 });
    assert.ok(assess(hr, [hr], { ...RUN_DEFAULTS, hrMax: 150 }).reasons.includes('Puls 160 über 150 bpm.'));
    const cad = R('2026-10-15', 2.0, { kneeDuring: 2, cadenceSpm: 160 });
    assert.deepStrictEqual(assess(cad, [cad]).hints, ['Schrittfrequenz um 5–10 % erhöhen: Ziel 168–176 spm.']);
  });

  test('Lauf: unvollständig (ohne Knie) zählt nicht', () => {
    const runs = [R('2026-10-10', 3.0), R('2026-10-15', 5.0, { kneeDuring: null, source: 'garmin' })];
    assert.strictEqual(assess(runs[1], runs).status, 'incomplete');
    assert.strictEqual(plan(runs, NOW).l30, 3.0);
  });

  test('Lauf: Entlastungswoche jede 4. Kalenderwoche, überspringbar', () => {
    // erster Lauf Mo 5.10. → Woche 4 beginnt Mo 26.10.
    const runs = [R('2026-10-05', 2.0), R('2026-10-20', 3.0)];
    assert.strictEqual(isDeloadWeek('2026-10-05', '2026-10-26'), true);
    assert.strictEqual(isDeloadWeek('2026-10-05', '2026-10-25'), false);
    const p = plan(runs, '2026-10-27');
    assert.deepStrictEqual([p.mode, p.sollLong], ['deload', 2.5]); // 85 % von 3,0 = 2,55 → 2,5
    assert.strictEqual(plan(runs, '2026-10-27', RUN_DEFAULTS, { skipDeloadWeek: weekKey('2026-10-27') }).sollLong, 3.3);
  });

  test('Lauf: Morgen-Check ab 5 Uhr am Folgetag, 48 h offen', () => {
    const r = R('2026-10-20', 3.0);
    assert.strictEqual(morningCheckDue([r], '2026-10-21T04:59'), null);
    assert.strictEqual(morningCheckDue([r], '2026-10-21T05:00'), r);
    assert.strictEqual(morningCheckDue([r], '2026-10-23T04:59'), r);
    assert.strictEqual(morningCheckDue([r], '2026-10-23T05:00'), null);
    assert.strictEqual(morningCheckDue([{ ...r, kneeMorning: 'gleich' }], '2026-10-21T08:00'), null);
    assert.strictEqual(morningCheckDue([{ ...r, morningSkipped: true }], '2026-10-21T08:00'), null);
  });

  test('Lauf: Dauer parsen und formatieren', () => {
    assert.strictEqual(parseDuration('18:20'), 1100);
    assert.strictEqual(parseDuration('1:05:30'), 3930);
    assert.strictEqual(parseDuration('abc'), null);
    assert.strictEqual(formatDuration(3930), '1:05:30');
    assert.strictEqual(formatKm(3.25), '3,25 km');
  });
}

// ---------- Notiz-Import (SPEC §8) ----------
const fixture = readFileSync(new URL('./fixtures/notiz-beispiel.md', import.meta.url), 'utf8');

test('Notiz: Beispiel ergibt 6 Übungen, 18 Sätze, Curl ohne Gewicht', () => {
  const p = parseNotes(fixture, '2026-10-21');
  assert.strictEqual(p.sessions.length, 1);
  assert.strictEqual(p.sessions[0].date, '2026-08-19');
  const e = p.sessions[0].entries;
  assert.strictEqual(e.length, 6);
  assert.strictEqual(e.reduce((n, x) => n + x.sets.length, 0), 18);
  const curl = e.find((x) => x.name === 'Curl');
  assert.ok(curl.sets.every((s) => s.weight === null));
  assert.deepStrictEqual(e[0].sets.map((s) => [s.weight, s.reps]), [[130, 8], [130, 10], [130, 9]]);
  assert.deepStrictEqual(p.unclear, []);
});

test('Notiz: Datum ohne Jahr, neueste zuerst, Jahreswechsel', () => {
  const p = parseNotes('3.1.\nA\n5\n\n28.12\nA\n5\n\n1.5.25\nA\n5', '2026-01-10');
  assert.deepStrictEqual(p.sessions.map((s) => s.date), ['2026-01-03', '2025-12-28', '2025-05-01']);
});

test('Notiz: Gewichtsformate, Gewichtswechsel, Markdown, unklare Einträge', () => {
  const text = '- 2.10.\n**Arm curl@75**\n10\n11\n@62,5 kg\n12\n\nFly\n45kg\n\nRow\n10?\nXXX\n';
  const p = parseNotes(text, '2026-10-21');
  const [curl, fly, row] = p.sessions[0].entries;
  assert.strictEqual(curl.name, 'Arm curl');
  assert.deepStrictEqual(curl.sets.map((s) => [s.weight, s.kg, s.reps]), [[75, false, 10], [75, false, 11], [62.5, true, 12]]);
  assert.strictEqual(fly.sets.length, 0);
  assert.deepStrictEqual(row.sets.map((s) => s.reps), [10]);
  assert.deepStrictEqual(p.unclear.map((u) => u.text), [
    'Fly – keine Sätze, übersprungen', 'Row: „10?“ als 10 gelesen', 'XXX – keine Sätze, übersprungen']);
});

test('Notiz → Backup: Zuordnung, Gyms, Einheiten, gültig für Import', () => {
  const p = parseNotes(fixture + '\n18.8.26\nchest  Press\n@7\n12\nCurls\n@12,5 kg\n10\n', '2026-10-21');
  let n = 0;
  const data = buildBackup(p, {
    gyms: [{ name: 'Home', isHome: true }, { name: 'Reise' }],
    sessionGyms: { '2026-08-18': 'Reise' },
    exercises: {
      'Chest press': { unit: 'stufe', muscleGroup: 'chest' },
      Fly: { unit: 'stufe' }, Curl: { aliases: ['Curls'], unit: 'stufe' }, 'Extension triceps': {},
      'Lateral raise': {}, 'Low row': { unit: 'stufe' },
    },
  }, () => 'id' + ++n);
  assert.strictEqual(data.exercises.length, 6);
  assert.strictEqual(data.sets.length, 20);
  const reise = data.sessions.find((s) => s.date === '2026-08-18');
  assert.strictEqual(data.gyms.find((g) => g.id === reise.gymId).name, 'Reise');
  const travel = data.sets.filter((s) => s.sessionId === reise.id).map((s) => [s.weight, s.unit]);
  assert.deepStrictEqual(travel, [[7, 'stufe'], [12.5, 'kg']]);
  assert.ok(data.sets.filter((s) => s.weight === null).every((s) => s.unit === null));
  assert.deepStrictEqual(fromJSON(toJSON(data)), data);
  assert.throws(() => buildBackup(p, { gyms: [{ name: 'H', isHome: true }], exercises: {} }, () => 'x'), /Ohne Zuordnung/);
});

console.log(passed + ' bestanden, ' + failed + ' fehlgeschlagen');
process.exit(failed ? 1 : 0);
