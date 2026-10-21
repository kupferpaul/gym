// Aufruf: node tests/run.mjs  (Node 14+, keine Abhängigkeiten)
import assert from 'assert';
import { readFileSync } from 'fs';
import { parseNotes, buildBackup } from '../tools/notes.mjs';
import {
  sortExercises, suggestNext, exerciseSequence, lastSet, prefill, stepWeight,
  unitForEquipment, formatWeight, formatDate, renumber, todayISO,
} from '../js/logic.js';
import { toJSON, fromJSON, toCSV, CSV_HEADER } from '../js/backup.js';
import {
  compareSets, compareSet, previousSets, feedbackText, suggestIncrease, ghostText, remainingSeconds, formatClock,
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
