// Parser für die alte Apple-Notiz (SPEC §8). Pure Funktionen – getestet in tests/run.mjs.
//
// Format: Datumszeile (T.M., T.M oder T.M.JJ) startet ein Training, dann je Übung
// ein Name, optional "@Gewicht" (gilt bis zum nächsten @), dann eine Zahl pro Satz.

const DATE = /^(\d{1,2})\.(\d{1,2})\.?(?:(\d{2}|\d{4})\.?)?$/;
const WEIGHT = /^@?\s*(\d+(?:[.,]\d+)?)\s*(kg)?$/i;
const INLINE = /^(.*?[a-zäöüß].*?)\s*@\s*(\d+(?:[.,]\d+)?)\s*(kg)?$/i;
const REPS = /^(\d{1,3})(\?)?$/;

const num = (s) => parseFloat(s.replace(',', '.'));
const pad = (n) => String(n).padStart(2, '0');

// Markdown-Reste entfernen: Überschriften, Aufzählungszeichen, Fett, Leerzeichen.
export function cleanLine(line) {
  return line.replace(/^\s*(#+|[-*+]\s)\s*/, '').replace(/\*\*|__/g, '').trim();
}

// Normalisierter Schlüssel für Namen: "Arm curl " / "arm  Curl" → "arm curl"
export function nameKey(name) {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Jahr ergänzen: Notiz ist neueste zuerst. Ohne Jahr gilt das Jahr, in dem das Datum
// nicht nach dem vorherigen (neueren) Eintrag bzw. nicht nach "today" liegt.
function resolveDate(d, m, y, newer) {
  if (y) return (y.length === 2 ? 2000 + Number(y) : Number(y)) + '-' + pad(m) + '-' + pad(d);
  let year = Number(newer.slice(0, 4));
  let iso = year + '-' + pad(m) + '-' + pad(d);
  if (iso > newer) iso = (year - 1) + '-' + pad(m) + '-' + pad(d);
  return iso;
}

export function parseNotes(text, today) {
  const sessions = [];
  const unclear = [];
  let session = null;
  let entry = null;
  let newer = today;

  const finishEntry = () => {
    if (entry && !entry.sets.length) unclear.push({ line: entry.line, date: session.date, text: entry.name + ' – keine Sätze, übersprungen' });
    entry = null;
  };

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = cleanLine(raw);
    const lineNo = i + 1;
    if (!line) return;
    let m;
    if ((m = line.match(DATE))) {
      finishEntry();
      const date = resolveDate(Number(m[1]), Number(m[2]), m[3], newer);
      newer = date;
      session = { date, line: lineNo, entries: [] };
      sessions.push(session);
      return;
    }
    if (!session) return; // Überschrift o. Ä. vor dem ersten Datum
    if (entry && (m = line.match(REPS))) {
      entry.sets.push({ weight: entry.weight, kg: entry.kg, reps: Number(m[1]) });
      if (m[2]) unclear.push({ line: lineNo, date: session.date, text: entry.name + ': „' + line + '“ als ' + m[1] + ' gelesen' });
      return;
    }
    if (entry && (m = line.match(WEIGHT)) && (line.startsWith('@') || m[2])) {
      entry.weight = num(m[1]);
      entry.kg = !!m[2];
      return;
    }
    let name = line;
    let weight = null;
    let kg = false;
    if ((m = line.match(INLINE))) {
      name = m[1].trim();
      weight = num(m[2]);
      kg = !!m[3];
    }
    if (!/[a-zäöüß]/i.test(name)) {
      unclear.push({ line: lineNo, date: session.date, text: '„' + line + '“ nicht erkannt' + (entry ? ' (bei ' + entry.name + ')' : '') });
      return;
    }
    finishEntry();
    entry = { name, line: lineNo, weight, kg, sets: [] };
    session.entries.push(entry);
  });
  finishEntry();
  return { sessions: sessions.filter((s) => s.entries.length), unclear };
}

// Alle Schreibweisen mit Häufigkeit und Gewichtsbeispielen – Grundlage für die Zuordnungstabelle.
export function nameSummary(parsed) {
  const map = new Map();
  parsed.sessions.forEach((s) => s.entries.forEach((e) => {
    const k = nameKey(e.name);
    const x = map.get(k) || { key: k, name: e.name.trim(), count: 0, weights: new Set(), dates: [] };
    x.count += 1;
    x.dates.push(s.date);
    e.sets.forEach((set) => { if (set.weight != null) x.weights.add(set.weight + (set.kg ? 'kg' : '')); });
    map.set(k, x);
  }));
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// Geparste Notiz + bestätigte Zuordnung → Daten im Backup-Format (js/backup.js).
// mapping = {
//   exercises: { "Chest press": { aliases: ["chestpress", ...], unit: "kg"|"stufe"|null, muscleGroup, dbId } },
//   gyms: [{ name, isHome }],              // erstes mit isHome = Home-Gym
//   sessionGyms: { "2026-10-19": "Name" }, // Ausnahmen, sonst Home-Gym
// }
export function buildBackup(parsed, mapping, makeId) {
  const gyms = mapping.gyms.map((g) => ({ id: makeId(), name: g.name, isHome: !!g.isHome }));
  const gymByName = new Map(gyms.map((g) => [g.name, g]));
  const home = gyms.find((g) => g.isHome) || gyms[0];

  const exercises = [];
  const exByKey = new Map();
  Object.entries(mapping.exercises).forEach(([name, def], i) => {
    const ex = {
      id: makeId(), name, aliases: def.aliases || [], defaultUnit: def.unit === undefined ? 'kg' : def.unit,
      muscleGroup: def.muscleGroup || null, dbId: def.dbId || null, createdAt: i,
    };
    exercises.push(ex);
    [name, ...ex.aliases].forEach((a) => exByKey.set(nameKey(a), ex));
  });

  const missing = new Set();
  const sessions = [];
  const sets = [];
  // Chronologisch anlegen, damit createdAt der Trainingsreihenfolge entspricht.
  parsed.sessions.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach((ps, si) => {
    const gymName = mapping.sessionGyms && mapping.sessionGyms[ps.date];
    const gym = gymName ? gymByName.get(gymName) : home;
    if (!gym) throw new Error('Unbekanntes Gym „' + gymName + '“ für ' + ps.date);
    const session = { id: makeId(), date: ps.date, gymId: gym.id, startedAt: Date.parse(ps.date + 'T12:00:00Z') };
    sessions.push(session);
    const orderByEx = new Map();
    ps.entries.forEach((e, ei) => {
      if (!e.sets.length) return; // schon als unklar gemeldet
      const ex = exByKey.get(nameKey(e.name));
      if (!ex) { missing.add(e.name.trim()); return; }
      e.sets.forEach((s, k) => {
        const order = (orderByEx.get(ex.id) || 0) + 1;
        orderByEx.set(ex.id, order);
        const unit = s.weight == null ? null : s.kg ? 'kg' : ex.defaultUnit || 'kg';
        sets.push({
          id: makeId(), sessionId: session.id, exerciseId: ex.id, order,
          weight: s.weight, unit, reps: s.reps, createdAt: session.startedAt + ei * 1000 + k,
        });
      });
    });
  });
  if (missing.size) throw new Error('Ohne Zuordnung: ' + [...missing].join(', '));
  const meta = [{ key: 'lastGymId', value: home.id }];
  return { gyms, exercises, sessions, sets, meta, calibrations: [] };
}
