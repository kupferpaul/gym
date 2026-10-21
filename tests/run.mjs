// Aufruf: node tests/run.mjs  (Node 14+, keine Abhängigkeiten)
import assert from 'assert';
import {
  sortExercises, suggestNext, exerciseSequence, lastSet, prefill, stepWeight,
  unitForEquipment, formatWeight, formatDate, renumber, todayISO,
} from '../js/logic.js';
import { toJSON, fromJSON, toCSV, CSV_HEADER } from '../js/backup.js';

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

test('Vorausfüllen: Übung ohne Gewicht bleibt ohne', () => {
  assert.deepStrictEqual(prefill(exercises[2], 'fit', sessions, sets), { unit: 'kg', weight: null });
  assert.deepStrictEqual(prefill(exercises[2], 'fit', sessions, sets, null), { unit: null, weight: null });
});

test('Gewichtsschritte je Einheit, nie unter 0, ohne Rundungsfehler', () => {
  assert.strictEqual(stepWeight(130, 'kg', 1), 132.5);
  assert.strictEqual(stepWeight(8, 'stufe', -1), 7);
  assert.strictEqual(stepWeight(1, 'kg', -1), 0);
  assert.strictEqual(stepWeight(null, 'kg', 1), 2.5);
  assert.strictEqual(stepWeight(0.1, 'kg', 1, { weightStepKg: 0.2, weightStepStufe: 1 }), 0.3);
  assert.strictEqual(stepWeight(5, null, 1), null);
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
};

test('Export → Import ergibt identische Daten', () => {
  assert.deepStrictEqual(fromJSON(toJSON(data)), data);
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

console.log(passed + ' bestanden, ' + failed + ' fehlgeschlagen');
process.exit(failed ? 1 : 0);
