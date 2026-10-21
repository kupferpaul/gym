// Backup: JSON-Export/-Import und CSV (eine Zeile pro Satz). Pure Funktionen.

export const STORES = ['gyms', 'exercises', 'sessions', 'sets', 'meta'];
const FORMAT = 'gym-tracker';
const VERSION = 1;

// data = { gyms, exercises, sessions, sets, meta } (meta als Array von {key, value})
export function toJSON(data, now = new Date()) {
  const out = { format: FORMAT, version: VERSION, exportedAt: now.toISOString() };
  STORES.forEach((s) => { out[s] = data[s] || []; });
  return JSON.stringify(out, null, 1);
}

function fail(msg) {
  throw new Error('Ungültiges Backup: ' + msg);
}

export function fromJSON(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { fail('keine JSON-Datei'); }
  if (!obj || obj.format !== FORMAT) fail('nicht aus dieser App');
  if (obj.version > VERSION) fail('neuere App-Version nötig');
  STORES.forEach((s) => { if (!Array.isArray(obj[s])) fail('„' + s + '“ fehlt'); });

  const ids = (list) => new Set(list.map((x) => x.id));
  const gymIds = ids(obj.gyms);
  const exIds = ids(obj.exercises);
  const sessionIds = ids(obj.sessions);
  STORES.filter((s) => s !== 'meta').forEach((s) =>
    obj[s].forEach((x) => { if (typeof x.id !== 'string') fail('Eintrag ohne id in ' + s); }));
  obj.exercises.forEach((e) => { if (typeof e.name !== 'string') fail('Übung ohne Namen'); });
  obj.sessions.forEach((s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) fail('Datum ' + s.date);
    if (!gymIds.has(s.gymId)) fail('Training mit unbekanntem Gym');
  });
  obj.sets.forEach((s) => {
    if (!sessionIds.has(s.sessionId) || !exIds.has(s.exerciseId)) fail('Satz ohne Training/Übung');
    if (typeof s.reps !== 'number' || s.reps < 0) fail('Reps ' + s.reps);
    if (s.weight !== null && typeof s.weight !== 'number') fail('Gewicht ' + s.weight);
  });
  obj.meta.forEach((m) => { if (typeof m.key !== 'string') fail('Einstellung ohne Schlüssel'); });

  const data = {};
  STORES.forEach((s) => { data[s] = obj[s]; });
  return data;
}

export const CSV_HEADER = ['date', 'gym', 'exercise', 'muscleGroup', 'set', 'weight', 'unit', 'reps'];

function cell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(data) {
  const gyms = new Map(data.gyms.map((g) => [g.id, g]));
  const exercises = new Map(data.exercises.map((e) => [e.id, e]));
  const sessions = new Map(data.sessions.map((s) => [s.id, s]));
  const rows = data.sets
    .filter((s) => sessions.has(s.sessionId))
    .map((s) => ({ set: s, session: sessions.get(s.sessionId) }))
    .sort((a, b) =>
      a.session.date.localeCompare(b.session.date) ||
      (a.session.startedAt || 0) - (b.session.startedAt || 0) ||
      (a.set.createdAt || 0) - (b.set.createdAt || 0) ||
      a.set.order - b.set.order)
    .map(({ set, session }) => {
      const ex = exercises.get(set.exerciseId) || {};
      const gym = gyms.get(session.gymId) || {};
      return [session.date, gym.name, ex.name, ex.muscleGroup, set.order, set.weight, set.unit, set.reps];
    });
  return [CSV_HEADER, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
