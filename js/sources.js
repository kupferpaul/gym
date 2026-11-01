// Datenquellen für Läufe. Aktuell nur "manuell". Später kommt "garmin" (Phase 2: Import über einen
// Cloudflare Worker) daneben: gleiche Form, Abgleich über externalId, ohne Kniewert = unvollständig.
// Bewusst kein Garmin-Code und keine Worker-Einstellungen, solange Phase 2 nicht beauftragt ist.

export const SOURCES = {
  manual: { id: 'manual', label: 'Manuell' },
};

const num = (v) => (v === '' || v == null || !isFinite(Number(v)) ? null : Number(v));

// Normalisiert einen Lauf aus beliebiger Quelle ins App-Format (eine Zeile pro Lauf, Sheet-tauglich).
export function makeRun(fields, source = 'manual', makeId) {
  return {
    id: fields.id || makeId(),
    date: fields.date,
    distanceKm: Math.round(Number(fields.distanceKm) * 100) / 100,
    durationSec: Math.round(Number(fields.durationSec)),
    kneeDuring: num(fields.kneeDuring),
    kneeMorning: fields.kneeMorning || null,
    runType: fields.runType || 'kurz',
    surface: fields.surface || 'draußen',
    avgHr: num(fields.avgHr),
    maxHr: num(fields.maxHr),
    cadenceSpm: num(fields.cadenceSpm),
    note: fields.note ? String(fields.note) : '',
    source,
    externalId: fields.externalId || null,
    sessionId: fields.sessionId || null,
    morningSkipped: !!fields.morningSkipped,
  };
}

// Für den späteren Import: schon vorhandene Aktivität erkennen.
export function findByExternalId(runs, externalId) {
  return externalId ? runs.find((r) => r.externalId === externalId) || null : null;
}
