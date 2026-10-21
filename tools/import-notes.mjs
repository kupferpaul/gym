// Einmaliger Import der alten Notiz → Backup-Datei für "Import JSON" in der App.
// Aufruf: node tools/import-notes.mjs private/Workout.md private/mapping.json private/gym-import.json
// Ohne Mapping-Datei: nur Übersicht der Schreibweisen und unklaren Einträge (für die Zuordnungstabelle).
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { parseNotes, nameSummary, buildBackup } from './notes.mjs';
import { toJSON, fromJSON } from '../js/backup.js';
import { todayISO } from '../js/logic.js';

const [notesPath, mappingPath, outPath = 'private/gym-import.json'] = process.argv.slice(2);
if (!notesPath) {
  console.error('Aufruf: node tools/import-notes.mjs <notiz.md> [mapping.json] [ausgabe.json]');
  process.exit(1);
}

function uuid() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

const parsed = parseNotes(readFileSync(notesPath, 'utf8'), todayISO());
const unclear = parsed.unclear.map((u) => '  ' + u.date + ' (Zeile ' + u.line + '): ' + u.text).join('\n');

if (!mappingPath || !existsSync(mappingPath)) {
  console.log('Schreibweisen:');
  nameSummary(parsed).forEach((x) => console.log('  ' + x.count + '× ' + x.name + '  [' + [...x.weights].join(' ') + ']'));
  console.log('Unklar:\n' + (unclear || '  –'));
  process.exit(0);
}

const data = buildBackup(parsed, JSON.parse(readFileSync(mappingPath, 'utf8')), uuid);
const json = toJSON(data);
fromJSON(json); // gleiche Prüfung wie beim Import in der App
writeFileSync(outPath, json);

const dates = data.sessions.map((s) => s.date).sort();
console.log('Geschrieben: ' + outPath);
console.log('Trainings: ' + data.sessions.length + ' (' + dates[0] + ' bis ' + dates[dates.length - 1] + ')');
console.log('Übungen:   ' + data.exercises.length + ', Sätze: ' + data.sets.length);
data.gyms.forEach((g) => console.log('  ' + g.name + (g.isHome ? ' (Home)' : '') + ': ' +
  data.sessions.filter((s) => s.gymId === g.id).length + ' Trainings'));
data.exercises.forEach((e) => console.log('  ' + e.name + ': ' +
  data.sets.filter((s) => s.exerciseId === e.id).length + ' Sätze'));
console.log('Unklar:\n' + (unclear || '  –'));
