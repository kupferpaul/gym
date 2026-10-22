// IndexedDB-Zugriff. Schema nur über onupgradeneeded mit oldVersion-Prüfung erweitern,
// nie Stores löschen – sonst sind die Daten auf dem iPhone weg.
import { STORES } from './backup.js';

const NAME = 'gym';
const VERSION = 2;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore('gyms', { keyPath: 'id' });
        db.createObjectStore('exercises', { keyPath: 'id' });
        db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('date', 'date');
        const sets = db.createObjectStore('sets', { keyPath: 'id' });
        sets.createIndex('sessionId', 'sessionId');
        sets.createIndex('exerciseId', 'exerciseId');
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (e.oldVersion < 2) {
        // Phase 3: Umrechnung pro Übung + Gym + Einheit (id = "exerciseId|gymId|unit").
        db.createObjectStore('calibrations', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadAll() {
  const db = await open();
  const tx = db.transaction(STORES, 'readonly');
  const out = {};
  await Promise.all(STORES.map(async (s) => { out[s] = await result(tx.objectStore(s).getAll()); }));
  return out;
}

// Mehrere Änderungen atomar: ops = [{store, put: obj} | {store, del: id}]
export async function write(ops) {
  const db = await open();
  const tx = db.transaction([...new Set(ops.map((o) => o.store))], 'readwrite');
  ops.forEach((o) => {
    const st = tx.objectStore(o.store);
    if (o.del !== undefined) st.delete(o.del); else st.put(o.put);
  });
  return done(tx);
}

export function put(store, obj) {
  return write([{ store, put: obj }]);
}

export function setMeta(key, value) {
  return put('meta', { key, value });
}

// Import: alle Daten ersetzen, in einer Transaktion.
export async function replaceAll(data) {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  STORES.forEach((s) => {
    const st = tx.objectStore(s);
    st.clear();
    data[s].forEach((x) => st.put(x));
  });
  return done(tx);
}

// Safari löscht Website-Daten sonst ggf. nach längerer Nichtnutzung.
export async function requestPersist() {
  if (!navigator.storage || !navigator.storage.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
