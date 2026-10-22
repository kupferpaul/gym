import * as db from './db.js';
import {
  MUSCLES, DEFAULT_SETTINGS, muscleLabel, unitForEquipment, todayISO, exerciseSequence,
  sortExercises, suggestNext, sortSessions, prefill, stepWeight, formatWeight, formatDate, renumber,
  historyStep, resolveStep, stepSize,
} from './logic.js';
import { toJSON, fromJSON, toCSV } from './backup.js';
import {
  previousSets, compareSets, compareSet, ARROWS, feedbackText, suggestIncrease, ghostText,
  remainingSeconds, formatClock,
} from './progress.js';

// ---------- Zustand (alles im Speicher, jede Änderung sofort nach IndexedDB) ----------
const S = { gyms: [], exercises: [], sessions: [], sets: [], meta: new Map(), calibrations: [] };
let view = { name: 'home' };
let log = null; // { exerciseId, weight, unit } während "Satz erfassen"
let persisted = null;
let exerciseDb = null;
let lastSetAt = 0;
let flashId = null;
let timer = loadTimer(); // { endAt, duration, beeped } – zeitstempelbasiert, überlebt Neuladen
let audioCtx = null;
let wakeLock = null;

const $ = (sel) => document.querySelector(sel);
const app = $('#app');
const sheet = $('#sheet');

const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2));
const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const settings = () => ({ ...DEFAULT_SETTINGS, ...(S.meta.get('settings') || {}) });
const gymById = (id) => S.gyms.find((g) => g.id === id);
const exById = (id) => S.exercises.find((e) => e.id === id);
const sortedGyms = () => S.gyms.slice().sort((a, b) => b.isHome - a.isHome || a.name.localeCompare(b.name));
const homeGym = () => S.gyms.find((g) => g.isHome) || S.gyms[0];
const currentGym = () => gymById(S.meta.get('lastGymId')) || homeGym();
const setsOf = (sessionId) => S.sets.filter((s) => s.sessionId === sessionId);
const byOrder = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.order - b.order;

function todaySession() {
  const today = todayISO();
  const gym = currentGym();
  return sortSessions(S.sessions.filter((s) => s.date === today && s.gymId === gym.id)).pop() || null;
}

function metaArray() {
  return [...S.meta].map(([key, value]) => ({ key, value }));
}

async function setMeta(key, value) {
  S.meta.set(key, value);
  await db.setMeta(key, value);
}

// ---------- Pausentimer, Ton, Wake Lock ----------
function loadTimer() {
  try { return JSON.parse(localStorage.getItem('timer')) || null; } catch (e) { return null; }
}
function saveTimer() {
  try { localStorage.setItem('timer', JSON.stringify(timer)); } catch (e) { /* privat: egal */ }
}

function startTimer() {
  const duration = settings().restSeconds;
  timer = { endAt: Date.now() + duration * 1000, duration, beeped: false };
  saveTimer();
}

function stopTimer() {
  timer = null;
  saveTimer();
}

// Nach 10 Min. ohne neuen Satz ist die Pause kein Thema mehr.
const timerVisible = () => timer && Date.now() - timer.endAt < 10 * 60 * 1000;

function timerHtml(big) {
  if (!timerVisible()) return big ? `<span class="timer idle">⏱ ${formatClock(settings().restSeconds)}</span>` : '';
  const sec = remainingSeconds(timer.endAt, Date.now());
  const pct = sec ? (sec / timer.duration) * 100 : 0;
  return `<button class="timer ${sec ? '' : 'done'} ${big ? '' : 'mini'}" data-a="timer-stop" id="timer${big ? '' : 'Mini'}">
    <span class="bar" style="width:${pct}%"></span><span class="t">${sec ? '⏱ ' + formatClock(sec) : 'Los!'}</span></button>`;
}

function tick() {
  if (!timer) return;
  const sec = remainingSeconds(timer.endAt, Date.now());
  document.querySelectorAll('.timer:not(.idle)').forEach((el) => {
    el.querySelector('.t').textContent = sec ? '⏱ ' + formatClock(sec) : 'Los!';
    el.querySelector('.bar').style.width = (sec ? (sec / timer.duration) * 100 : 0) + '%';
    el.classList.toggle('done', !sec);
  });
  // Ton nur, wenn die App offen ist und das Ende gerade erst erreicht wurde.
  if (!sec && !timer.beeped) {
    timer.beeped = true;
    saveTimer();
    if (!document.hidden && Date.now() - timer.endAt < 3000) beep();
  }
  if (!timerVisible()) { stopTimer(); if (S.gyms.length) render(); }
}
setInterval(tick, 250);

// iOS gibt Audio erst nach einer Berührung frei; "transient" duckt Musik/Podcasts kurz statt sie zu stoppen.
function unlockAudio() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'transient';
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* kein Ton möglich */ }
}
document.addEventListener('pointerdown', unlockAudio, { passive: true });

function beep() {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  [0, 0.25, 0.5].forEach((dt) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t0 + dt);
    gain.gain.exponentialRampToValueAtTime(0.5, t0 + dt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0 + dt);
    osc.stop(t0 + dt + 0.2);
  });
}

// Bildschirm anlassen, solange heute trainiert wird bzw. "Satz erfassen" offen ist.
async function updateWakeLock() {
  const want = settings().wakeLock && !document.hidden && (view.name === 'log' || !!todaySession());
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { wakeLock = null; }
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ---------- Start ----------
async function init() {
  const data = await db.loadAll();
  S.gyms = data.gyms;
  S.exercises = data.exercises;
  S.sessions = data.sessions;
  S.sets = data.sets;
  S.calibrations = data.calibrations;
  S.meta = new Map(data.meta.map((m) => [m.key, m.value]));
  if (!S.gyms.length) {
    const g = { id: uid(), name: 'Home-Gym', isHome: true };
    S.gyms.push(g);
    await db.put('gyms', g);
  }
  render();
  db.requestPersist().then((p) => { persisted = p; }).catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- Rendering ----------
function render() {
  const tabbed = ['home', 'sessions', 'settings'].includes(view.name);
  document.body.classList.toggle('no-tabs', !tabbed);
  document.body.classList.toggle('has-panel', view.name === 'log');
  document.querySelectorAll('#tabs button').forEach((b) =>
    b.classList.toggle('on', b.dataset.view === view.name));
  app.innerHTML = VIEWS[view.name]();
  updateWakeLock();
  if (view.name === 'new') {
    const inp = $('#q');
    inp.value = view.q || '';
    renderResults();
    if (!view.q) inp.focus();
  }
}

function setSummary(list) {
  const sorted = list.slice().sort(byOrder);
  const sameWeight = sorted.every((s) => s.weight === sorted[0].weight && s.unit === sorted[0].unit);
  if (sameWeight) return formatWeight(sorted[0].weight, sorted[0].unit) + ' · ' + sorted.map((s) => s.reps).join(' · ');
  return sorted.map((s) => formatWeight(s.weight, s.unit) + ' × ' + s.reps).join(' · ');
}

function exerciseRow(ex, extra = '', cls = '') {
  return `<button class="row ${cls}" data-a="open-ex" data-id="${ex.id}">
    <div class="main"><div class="title">${h(ex.name)}</div><div class="sub">${h(muscleLabel(ex.muscleGroup))}</div></div>
    ${extra}</button>`;
}

const VIEWS = {
  home() {
    const gym = currentGym();
    const session = todaySession();
    const todaySets = session ? setsOf(session.id) : [];
    const doneIds = exerciseSequence(todaySets);
    const sorted = sortExercises(S.exercises, S.sets);
    const suggestId = sorted.length ? suggestNext(S.sets, doneIds[doneIds.length - 1] || null, doneIds) : null;
    const suggest = suggestId && exById(suggestId);

    let out = `<header class="bar">
      <h1>${h(formatDate(todayISO()))}</h1>
      ${timerHtml(false)}
      <button class="chip" data-a="pick-gym">${h(gym.name)} ▾</button></header>`;

    if (doneIds.length) {
      out += '<h2>Heute</h2><div class="list">' + doneIds.map((id) => {
        const ex = exById(id);
        const list = todaySets.filter((s) => s.exerciseId === id);
        const prev = previousSets(id, gym.id, S.sessions, S.sets, session.id);
        const arrow = prev ? ARROWS[compareSets(prev.sets, list).result] + ' ' : '';
        return `<button class="row" data-a="open-ex" data-id="${id}"><div class="main">
          <div class="title">${h(ex ? ex.name : '?')}</div><div class="sub">${h(setSummary(list))}</div></div>
          <span class="badge">${arrow}✓ ${list.length}</span></button>`;
      }).join('') + '</div>';
    }

    if (!S.exercises.length) {
      return out + `<div class="empty">Noch keine Übungen.<br>Lege deine erste an.</div>
        <button class="primary" style="width:100%" data-a="new-ex">+ Neue Übung</button>`;
    }

    out += '<h2>Übungen</h2><div class="list">';
    if (suggest) out += exerciseRow(suggest, '<span class="badge">Vorschlag</span>', 'suggest');
    out += sorted.filter((e) => e.id !== suggestId).map((ex) =>
      exerciseRow(ex, doneIds.includes(ex.id) ? '<span class="badge">✓</span>' : '')).join('');
    out += '<button class="row add" data-a="new-ex">+ Neue Übung</button></div>';
    return out;
  },

  log() {
    const ex = exById(log.exerciseId);
    const session = todaySession();
    const list = session ? setsOf(session.id).filter((s) => s.exerciseId === ex.id).sort(byOrder) : [];
    const prev = previousSets(ex.id, currentGym().id, S.sessions, S.sets, session && session.id);
    const st = settings();
    const unit = log.unit;
    const keys = Array.from({ length: 20 }, (_, i) => `<button data-a="rep" data-n="${i + 1}">${i + 1}</button>`).join('');
    const segBtn = (u, label) => `<button data-a="unit" data-u="${u}" class="${unit === (u || null) ? 'on' : ''}">${label}</button>`;

    // Geisterwert pro Satz: Reps desselben Satzes beim letzten Mal + Pfeil.
    const ghost = (s) => {
      const p = prev && prev.sets[s.order - 1];
      return p ? `<span class="ghost r${compareSet(p, s)}">${ARROWS[compareSet(p, s)]} (${p.reps})</span>` : '';
    };
    let info = '';
    if (prev && list.length >= prev.sets.length) {
      const cmp = compareSets(prev.sets, list);
      info = `<div class="feedback r${cmp.result}">${ARROWS[cmp.result]} ${h(feedbackText(cmp, prev.session.date))}</div>`;
    } else if (!list.length && prev && suggestIncrease(prev.sets, log.weight, unit, st.increaseThreshold)) {
      info = `<div class="banner"><span>Letztes Mal alle Sätze ≥ ${st.increaseThreshold} Reps. Gewicht erhöhen?</span>
        <button class="primary" data-a="step" data-d="1">+${h(stepLabel(stepInfo().step, unit))}</button></div>`;
    }
    const step = unit ? fmtNum(stepInfo().step) : '';
    const target = prev ? ghostText(prev.sets, list.length + 1) : null;
    const targetText = target ? 'Ziel: ' + target : prev ? 'Extra-Satz' : 'Erstes Mal hier';

    return `<header class="bar">
        <button class="back ghost" data-a="home" aria-label="Zurück">‹</button>
        <div class="titles" data-a="edit-ex"><h1>${h(ex.name)}</h1><div class="date">${h(currentGym().name)}</div></div></header>
      <div class="list sets">${list.length ? list.map((s) => `
        <button class="row ${s.id === flashId ? 'flash' : ''}" data-a="edit-set" data-id="${s.id}">
          <span class="num">Satz ${s.order}</span><span class="main title">${h(formatWeight(s.weight, s.unit))}</span>
          <span class="title">× ${s.reps}</span>${ghost(s)}</button>`).join('')
        : `<div class="empty">${prev ? 'Letztes Mal (' + h(formatDate(prev.session.date)) + '): ' + h(setSummary(prev.sets)) : 'Noch kein Satz. Tippe die Reps unten.'}</div>`}</div>
      ${info}
      <div class="panel">
        <div class="strip">${timerHtml(true)}<span class="target">${h(targetText)}</span></div>
        <div class="weight">
          <button data-a="step" data-d="-1" ${unit ? '' : 'disabled'}>−<small>${step}</small></button>
          <button class="val" data-a="type-weight" ${unit ? '' : 'disabled'}>${h(!unit ? 'ohne Gewicht' : log.weight == null ? (unit === 'stufe' ? 'Stufe –' : '– kg') : formatWeight(log.weight, unit))}</button>
          <button data-a="step" data-d="1" ${unit ? '' : 'disabled'}>+<small>${step}</small></button>
        </div>
        <div class="seg">${segBtn('kg', 'kg')}${segBtn('stufe', 'Stufe')}${segBtn('', 'ohne')}</div>
        <div class="reps">${keys}</div>
        <div class="actions">
          <button data-a="undo" ${list.length ? '' : 'disabled'}>↶ Rückgängig</button>
          <button data-a="more-reps">Mehr…</button>
          <button class="primary" data-a="home">Fertig ✓</button>
        </div>
      </div>`;
  },

  new() {
    return `<header class="bar"><button class="back ghost" data-a="home" aria-label="Zurück">‹</button><h1>Neue Übung</h1></header>
      <input id="q" class="search" type="search" placeholder="Suchen (englisch), z. B. chest press" autocomplete="off" autocorrect="off" autocapitalize="off">
      <div id="results" class="list"></div>`;
  },

  sessions() {
    const list = sortSessions(S.sessions).reverse();
    let out = '<header class="bar"><h1>Verlauf</h1></header>';
    if (!list.length) return out + '<div class="empty">Noch keine Trainings.</div>';
    return out + '<div class="list">' + list.map((s) => {
      const sets = setsOf(s.id);
      const g = gymById(s.gymId);
      return `<button class="row" data-a="open-session" data-id="${s.id}"><div class="main">
        <div class="title">${h(formatDate(s.date))} · ${h(g ? g.name : '?')}</div>
        <div class="sub">${exerciseSequence(sets).length} Übungen · ${sets.length} Sätze</div></div><span class="muted">›</span></button>`;
    }).join('') + '</div>';
  },

  session() {
    const s = S.sessions.find((x) => x.id === view.id);
    if (!s) { view = { name: 'sessions' }; return VIEWS.sessions(); }
    const sets = setsOf(s.id);
    const gymOpts = sortedGyms().map((g) => `<option value="${g.id}" ${g.id === s.gymId ? 'selected' : ''}>${h(g.name)}</option>`).join('');
    return `<header class="bar"><button class="back ghost" data-a="tab" data-view="sessions" aria-label="Zurück">‹</button>
        <h1>${h(formatDate(s.date))}</h1></header>
      <div class="grid2">
        <label class="field"><span>Datum</span><input type="date" id="sessionDate" value="${s.date}"></label>
        <label class="field"><span>Gym</span><select id="sessionGym">${gymOpts}</select></label>
      </div>
      ${exerciseSequence(sets).map((id) => {
        const ex = exById(id);
        return `<h2>${h(ex ? ex.name : '?')}</h2><div class="list sets">` + sets.filter((x) => x.exerciseId === id).sort(byOrder).map((x) => `
          <button class="row" data-a="edit-set" data-id="${x.id}"><span class="num">Satz ${x.order}</span>
          <span class="main title">${h(formatWeight(x.weight, x.unit))}</span><span class="title">× ${x.reps}</span></button>`).join('') + '</div>';
      }).join('')}
      <div class="btns"><button class="danger" data-a="delete-session">Training löschen</button></div>`;
  },

  settings() {
    const st = settings();
    const opt = (key, values, fmt) => values.map((v) =>
      `<button data-a="set-step" data-k="${key}" data-v="${v}" class="${st[key] === v ? 'on' : ''}">${fmt(v)}</button>`).join('');
    const persistText = persisted === true ? 'Dauerhafter Speicher ist aktiv.'
      : persisted === false ? 'Safari hat dauerhaften Speicher nicht bestätigt. Regelmäßig exportieren!'
        : 'Speicherstatus unbekannt.';
    return `<header class="bar"><h1>Einstellungen</h1></header>
      <div class="settings">
      <p class="muted small">+/- nimmt pro Übung und Gym den kleinsten Abstand aus deinem Verlauf oder einen selbst gesetzten Schritt
        (Tipp aufs Gewicht). Nur ohne beides gilt der Standard:</p>
      <h2>Standard-Schritt kg</h2><div class="seg">${opt('weightStepKg', [1, 1.25, 2, 2.5, 5], fmtNum)}</div>
      <h2>Standard-Schritt Stufe</h2><div class="seg">${opt('weightStepStufe', [0.5, 1, 2, 5], fmtNum)}</div>
      <h2>Pause</h2><div class="seg">${opt('restSeconds', [30, 45, 60, 90, 120, 180], formatClock)}</div>
      <h2>„Gewicht erhöhen?“ ab Reps in allen Sätzen</h2><div class="seg">${opt('increaseThreshold', [8, 10, 11, 12, 13, 15], String)}</div>
      <h2>Bildschirm während Training anlassen</h2><div class="seg">${opt('wakeLock', [true, false], (v) => (v ? 'An' : 'Aus'))}</div>
      <div class="list" style="margin-top:8px"><button class="row" data-a="test-beep"><div class="main"><div class="title">Ton testen</div>
        <div class="sub">So klingt das Pausenende (Lautstärke, Lautlos-Schalter)</div></div></button></div>
      <h2>Gyms</h2><div class="list">${sortedGyms().map((g) => `
        <button class="row" data-a="edit-gym" data-id="${g.id}"><div class="main title">${h(g.name)}</div>
        ${g.isHome ? '<span class="badge">Home</span>' : ''}</button>`).join('')}
        <button class="row add" data-a="add-gym">+ Gym hinzufügen</button></div>
      <h2>Backup</h2><div class="list">
        <button class="row" data-a="export-json"><div class="main"><div class="title">Export JSON</div><div class="sub">Komplettes Backup, wieder importierbar</div></div></button>
        <button class="row" data-a="export-csv"><div class="main"><div class="title">Export CSV</div><div class="sub">Eine Zeile pro Satz, für Tabellen</div></div></button>
        <button class="row" data-a="import-json"><div class="main"><div class="title">Import JSON</div><div class="sub">Ersetzt alle Daten</div></div></button>
      </div>
      <p class="muted small">${h(persistText)} ${S.sessions.length} Trainings, ${S.sets.length} Sätze, ${S.exercises.length} Übungen.</p>
      </div>`;
  },
};

// ---------- Übungssuche ----------
async function loadExerciseDb() {
  if (!exerciseDb) exerciseDb = await fetch('data/exercises.json').then((r) => r.json());
  return exerciseDb;
}

async function renderResults() {
  const q = ($('#q').value || '').trim();
  view.q = q;
  const box = $('#results');
  if (!box) return;
  const all = await loadExerciseDb();
  if ($('#q').value.trim() !== q) return; // inzwischen weitergetippt
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? all.filter((e) => words.every((w) => e.name.toLowerCase().includes(w))) : [];
  hits.sort((a, b) => (b.name.toLowerCase().startsWith(words[0]) - a.name.toLowerCase().startsWith(words[0])) || a.name.length - b.name.length);
  let out = q ? `<button class="row add" data-a="own-ex">+ Eigene Übung „${h(q)}“</button>` : '<div class="empty">Tippe einen Namen, z. B. „curl“ oder „leg press“.</div>';
  out += hits.slice(0, 60).map((e) => {
    const mine = S.exercises.some((x) => x.dbId === e.id);
    return `<button class="row" data-a="pick-db" data-id="${h(e.id)}"><div class="main">
      <div class="title">${h(e.name)}</div><div class="sub">${h(muscleLabel(e.muscle))}${e.equipment ? ' · ' + h(e.equipment) : ''}</div></div>
      ${mine ? '<span class="badge">schon dabei</span>' : ''}</button>`;
  }).join('');
  box.innerHTML = out;
}

async function createExercise(ex) {
  const full = { id: uid(), aliases: [], dbId: null, createdAt: Date.now(), ...ex };
  S.exercises.push(full);
  await db.put('exercises', full);
  openExercise(full.id);
}

// ---------- Schrittweite +/- (pro Übung, Gym und Einheit) ----------
const fmtNum = (n) => String(n).replace('.', ',');
const stepKey = () => 'step:' + log.exerciseId + '|' + currentGym().id + '|' + log.unit;

function stepInfo() {
  const override = S.meta.get(stepKey()) || null;
  const history = historyStep(log.exerciseId, currentGym().id, log.unit, S.sessions, S.sets);
  return { override, history, step: resolveStep(override, history, log.unit, settings()) };
}

function stepLabel(step, unit) {
  return unit === 'stufe' ? fmtNum(step) + ' Stufe' : fmtNum(step) + ' kg';
}

// ---------- Satz erfassen ----------
function openExercise(id) {
  const ex = exById(id);
  const gym = currentGym();
  const pref = S.meta.get('unitPref:' + id + '|' + gym.id);
  log = { exerciseId: id, ...prefill(ex, gym.id, S.sessions, S.sets, pref) };
  view = { name: 'log' };
  flashId = null;
  render();
  window.scrollTo(0, 0);
}

async function ensureSession() {
  let s = todaySession();
  if (s) return s;
  s = { id: uid(), date: todayISO(), gymId: currentGym().id, startedAt: Date.now() };
  S.sessions.push(s);
  await db.put('sessions', s);
  return s;
}

async function addSet(reps) {
  const now = Date.now();
  if (now - lastSetAt < 500) return; // versehentlicher Doppeltipp
  lastSetAt = now;
  const session = await ensureSession();
  const existing = setsOf(session.id).filter((s) => s.exerciseId === log.exerciseId);
  const set = {
    id: uid(), sessionId: session.id, exerciseId: log.exerciseId, order: existing.length + 1,
    weight: log.unit ? (log.weight == null ? 0 : log.weight) : null, unit: log.unit, reps, createdAt: now,
  };
  if (set.weight === null) set.unit = null;
  S.sets.push(set);
  await db.put('sets', set);
  startTimer();
  flashId = set.id;
  render();
  const rows = document.querySelectorAll('.sets .row');
  if (rows.length) rows[rows.length - 1].scrollIntoView({ block: 'nearest' });
}

async function deleteSet(id) {
  const set = S.sets.find((s) => s.id === id);
  if (!set) return;
  S.sets = S.sets.filter((s) => s.id !== id);
  const ops = [{ store: 'sets', del: id }];
  renumber(setsOf(set.sessionId), set.exerciseId).forEach((s) => {
    const i = S.sets.findIndex((x) => x.id === s.id);
    S.sets[i] = s;
    ops.push({ store: 'sets', put: s });
  });
  // Leeres Training nicht stehen lassen.
  if (!setsOf(set.sessionId).length) {
    S.sessions = S.sessions.filter((s) => s.id !== set.sessionId);
    ops.push({ store: 'sessions', del: set.sessionId });
  }
  await db.write(ops);
}

// ---------- Sheets (Dialoge) ----------
function openSheet(html) {
  sheet.innerHTML = html;
  if (!sheet.open) sheet.showModal();
}
function closeSheet() {
  if (sheet.open) sheet.close();
}
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

function unitButtons(current) {
  return `<div class="seg" id="unitSeg">${[['kg', 'kg'], ['stufe', 'Stufe'], ['', 'ohne']].map(([u, l]) =>
    `<button type="button" data-a="sheet-unit" data-u="${u}" class="${(current || '') === u ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

function editSetSheet(set) {
  openSheet(`<h3>Satz ${set.order} bearbeiten</h3>
    <label class="field"><span>Gewicht</span><input id="fWeight" inputmode="decimal" value="${set.weight == null ? '' : String(set.weight).replace('.', ',')}"></label>
    <div class="field"><span>Einheit</span>${unitButtons(set.unit)}</div>
    <label class="field"><span>Reps</span><input id="fReps" inputmode="numeric" value="${set.reps}"></label>
    <div class="btns"><button class="danger" data-a="del-set" data-id="${set.id}">Löschen</button>
      <button data-a="close">Abbrechen</button><button class="primary" data-a="save-set" data-id="${set.id}">Speichern</button></div>`);
  sheet.dataset.unit = set.unit || '';
}

const parseNum = (v) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function textSheet(title, value, action, extra = '') {
  openSheet(`<h3>${h(title)}</h3>
    <label class="field"><input id="fText" value="${h(value)}" autocomplete="off"></label>${extra}
    <div class="btns"><button data-a="close">Abbrechen</button><button class="primary" data-a="${action}">Speichern</button></div>`);
  setTimeout(() => $('#fText').focus(), 50);
}

function muscleButtons(current) {
  return `<div class="grid2" id="muscleGrid">${Object.entries(MUSCLES).map(([k, l]) =>
    `<button type="button" data-a="pick-muscle" data-m="${k}" class="${k === current ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

// ---------- Teilen / Export ----------
async function shareFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function exportData() {
  return { gyms: S.gyms, exercises: S.exercises, sessions: S.sessions, sets: S.sets, meta: metaArray(), calibrations: S.calibrations };
}

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = fromJSON(await file.text());
    if (!confirm(`Backup mit ${data.sessions.length} Trainings und ${data.sets.length} Sätzen laden? Alle aktuellen Daten werden ersetzt.`)) return;
    await db.replaceAll(data);
    await init();
    toast('Import fertig');
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Aktionen ----------
const A = {
  tab: (d) => { view = { name: d.view }; render(); window.scrollTo(0, 0); },
  home: () => { view = { name: 'home' }; log = null; render(); window.scrollTo(0, 0); },
  close: closeSheet,

  'pick-gym': () => {
    const cur = currentGym();
    openSheet(`<h3>Gym wählen</h3><div class="list">${sortedGyms().map((g) => `
      <button class="row ${g.id === cur.id ? 'suggest' : ''}" data-a="choose-gym" data-id="${g.id}">
      <div class="main title">${h(g.name)}</div>${g.isHome ? '<span class="badge">Home</span>' : ''}</button>`).join('')}
      <button class="row add" data-a="add-gym">+ Neues Gym</button></div>`);
  },
  'choose-gym': async (d) => { await setMeta('lastGymId', d.id); closeSheet(); render(); },
  'add-gym': () => textSheet('Neues Gym', '', 'save-new-gym'),
  'save-new-gym': async () => {
    const name = $('#fText').value.trim();
    if (!name) return;
    const g = { id: uid(), name, isHome: false };
    S.gyms.push(g);
    await db.put('gyms', g);
    if (view.name === 'home') await setMeta('lastGymId', g.id);
    closeSheet();
    render();
  },
  'edit-gym': (d) => {
    const g = gymById(d.id);
    const used = S.sessions.some((s) => s.gymId === g.id);
    textSheet('Gym bearbeiten', g.name, 'save-gym', `
      ${g.isHome ? '' : '<button style="width:100%" data-a="make-home">Als Home-Gym festlegen</button>'}
      ${used || g.isHome ? '' : '<button class="danger" style="width:100%;margin-top:8px" data-a="del-gym">Gym löschen</button>'}`);
    sheet.dataset.id = g.id;
  },
  'save-gym': async () => {
    const g = gymById(sheet.dataset.id);
    const name = $('#fText').value.trim();
    if (!name) return;
    g.name = name;
    await db.put('gyms', g);
    closeSheet();
    render();
  },
  'make-home': async () => {
    const ops = S.gyms.map((g) => { g.isHome = g.id === sheet.dataset.id; return { store: 'gyms', put: g }; });
    await db.write(ops);
    closeSheet();
    render();
  },
  'del-gym': async () => {
    const id = sheet.dataset.id;
    if (!confirm('Gym löschen?')) return;
    S.gyms = S.gyms.filter((g) => g.id !== id);
    await db.write([{ store: 'gyms', del: id }]);
    closeSheet();
    render();
  },

  'new-ex': () => { view = { name: 'new', q: '' }; render(); },
  'open-ex': (d) => openExercise(d.id),
  'pick-db': async (d) => {
    const mine = S.exercises.find((x) => x.dbId === d.id);
    if (mine) return openExercise(mine.id);
    const e = (await loadExerciseDb()).find((x) => x.id === d.id);
    createExercise({ name: e.name, dbId: e.id, muscleGroup: e.muscle, defaultUnit: unitForEquipment(e.equipment) });
  },
  'own-ex': () => {
    sheet.dataset.muscle = '';
    sheet.dataset.unit = 'kg';
    openSheet(`<h3>Eigene Übung</h3>
      <label class="field"><span>Name</span><input id="fText" value="${h(view.q)}" autocomplete="off"></label>
      <div class="field"><span>Einheit</span>${unitButtons('kg')}</div>
      <div class="field"><span>Muskelgruppe</span>${muscleButtons('')}</div>
      <div class="btns"><button data-a="close">Abbrechen</button><button class="primary" data-a="save-own-ex">Anlegen</button></div>`);
  },
  'pick-muscle': (d, el) => {
    sheet.dataset.muscle = d.m;
    document.querySelectorAll('#muscleGrid button').forEach((b) => b.classList.toggle('on', b === el));
  },
  'sheet-unit': (d, el) => {
    sheet.dataset.unit = d.u;
    document.querySelectorAll('#unitSeg button').forEach((b) => b.classList.toggle('on', b === el));
  },
  'save-own-ex': () => {
    const name = $('#fText').value.trim();
    if (!name) return;
    if (!sheet.dataset.muscle) { toast('Bitte Muskelgruppe wählen'); return; }
    closeSheet();
    createExercise({ name, muscleGroup: sheet.dataset.muscle, defaultUnit: sheet.dataset.unit || null });
  },
  'edit-ex': () => {
    const ex = exById(log.exerciseId);
    const used = S.sets.some((s) => s.exerciseId === ex.id);
    sheet.dataset.muscle = ex.muscleGroup || '';
    openSheet(`<h3>Übung bearbeiten</h3>
      <label class="field"><span>Name</span><input id="fText" value="${h(ex.name)}" autocomplete="off"></label>
      <div class="field"><span>Muskelgruppe</span>${muscleButtons(ex.muscleGroup)}</div>
      <div class="btns">${used ? '' : '<button class="danger" data-a="del-ex">Löschen</button>'}
        <button data-a="close">Abbrechen</button><button class="primary" data-a="save-ex">Speichern</button></div>`);
  },
  'save-ex': async () => {
    const ex = exById(log.exerciseId);
    const name = $('#fText').value.trim();
    if (!name) return;
    ex.name = name;
    ex.muscleGroup = sheet.dataset.muscle || ex.muscleGroup;
    await db.put('exercises', ex);
    closeSheet();
    render();
  },
  'del-ex': async () => {
    if (!confirm('Übung löschen?')) return;
    const id = log.exerciseId;
    S.exercises = S.exercises.filter((e) => e.id !== id);
    await db.write([{ store: 'exercises', del: id }]);
    closeSheet();
    A.home();
  },

  rep: (d) => addSet(Number(d.n)),
  'more-reps': () => {
    openSheet(`<h3>Reps eingeben</h3>
      <label class="field"><input id="fReps" inputmode="numeric" value="21"></label>
      <div class="btns"><button data-a="close">Abbrechen</button><button class="primary" data-a="save-more">Satz speichern</button></div>`);
    setTimeout(() => $('#fReps').select(), 50);
  },
  'save-more': () => {
    const n = parseNum($('#fReps').value);
    if (n == null) return;
    closeSheet();
    addSet(Math.round(n));
  },
  step: (d) => { log.weight = stepWeight(log.weight, log.unit, Number(d.d), stepInfo().step); render(); },
  'type-weight': () => {
    const info = stepInfo();
    const auto = info.history ? 'aus Verlauf: ' + fmtNum(info.history) : 'Standard: ' + fmtNum(stepSize(log.unit, settings()));
    openSheet(`<h3>Gewicht (${log.unit === 'stufe' ? 'Stufe' : 'kg'})</h3>
      <label class="field"><input id="fWeight" inputmode="decimal" value="${log.weight == null ? '' : fmtNum(log.weight)}"></label>
      <label class="field"><span>Schritt für +/- bei dieser Übung in diesem Gym (leer = automatisch, ${h(auto)})</span>
        <input id="fStep" inputmode="decimal" value="${info.override ? fmtNum(info.override) : ''}" placeholder="${h(fmtNum(info.history || stepSize(log.unit, settings())))}"></label>
      <div class="btns"><button data-a="close">Abbrechen</button><button class="primary" data-a="save-weight">Übernehmen</button></div>`);
    setTimeout(() => $('#fWeight').select(), 50);
  },
  'save-weight': async () => {
    log.weight = parseNum($('#fWeight').value);
    const step = parseNum($('#fStep').value);
    await setMeta(stepKey(), step || null);
    closeSheet();
    render();
  },
  unit: async (d) => {
    const unit = d.u || null;
    const gym = currentGym();
    await setMeta('unitPref:' + log.exerciseId + '|' + gym.id, unit);
    log = { exerciseId: log.exerciseId, ...prefill(exById(log.exerciseId), gym.id, S.sessions, S.sets, unit) };
    render();
  },
  undo: async () => {
    const session = todaySession();
    if (!session) return;
    const last = setsOf(session.id).filter((s) => s.exerciseId === log.exerciseId).sort(byOrder).pop();
    if (!last) return;
    await deleteSet(last.id);
    stopTimer();
    flashId = null;
    render();
    toast('Satz ' + last.order + ' entfernt');
  },

  'edit-set': (d) => editSetSheet(S.sets.find((s) => s.id === d.id)),
  'save-set': async (d) => {
    const set = S.sets.find((s) => s.id === d.id);
    const reps = parseNum($('#fReps').value);
    if (reps == null) { toast('Reps fehlen'); return; }
    const unit = sheet.dataset.unit || null;
    const weight = unit ? parseNum($('#fWeight').value) : null;
    Object.assign(set, { reps: Math.round(reps), weight, unit: weight == null ? null : unit });
    await db.put('sets', set);
    closeSheet();
    render();
  },
  'del-set': async (d) => {
    if (!confirm('Satz löschen?')) return;
    await deleteSet(d.id);
    closeSheet();
    render();
  },

  'open-session': (d) => { view = { name: 'session', id: d.id }; render(); window.scrollTo(0, 0); },
  'delete-session': async () => {
    if (!confirm('Ganzes Training löschen?')) return;
    const id = view.id;
    const ops = setsOf(id).map((s) => ({ store: 'sets', del: s.id }));
    ops.push({ store: 'sessions', del: id });
    S.sets = S.sets.filter((s) => s.sessionId !== id);
    S.sessions = S.sessions.filter((s) => s.id !== id);
    await db.write(ops);
    A.tab({ view: 'sessions' });
  },

  'set-step': async (d) => {
    const v = d.v === 'true' ? true : d.v === 'false' ? false : Number(d.v);
    await setMeta('settings', { ...settings(), [d.k]: v });
    render();
  },
  'timer-stop': () => {
    if (suppressClick) { suppressClick = false; return; }
    stopTimer();
    render();
  },
  'test-beep': () => { unlockAudio(); setTimeout(beep, 50); },
  'export-json': () => shareFile('gym-backup-' + todayISO() + '.json', toJSON(exportData()), 'application/json'),
  'export-csv': () => shareFile('gym-saetze-' + todayISO() + '.csv', toCSV(exportData()), 'text/csv'),
  'import-json': () => $('#importFile').click(),
};

// Langer Druck auf den Timer: +15 s.
let pressTimer = null;
let suppressClick = false;
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('[data-a="timer-stop"]')) return;
  pressTimer = setTimeout(() => {
    if (!timer) return;
    timer.endAt = Math.max(timer.endAt, Date.now()) + 15000;
    timer.duration = Math.max(timer.duration, Math.ceil((timer.endAt - Date.now()) / 1000));
    timer.beeped = false;
    saveTimer();
    suppressClick = true;
    tick();
    toast('+15 s');
  }, 500);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((t) =>
  document.addEventListener(t, () => clearTimeout(pressTimer)));

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.a];
  if (fn) Promise.resolve(fn(el.dataset, el)).catch((err) => alert('Fehler: ' + err.message));
});

app.addEventListener('input', (e) => { if (e.target.id === 'q') renderResults(); });

app.addEventListener('change', async (e) => {
  const s = S.sessions.find((x) => x.id === view.id);
  if (!s) return;
  if (e.target.id === 'sessionDate' && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) s.date = e.target.value;
  else if (e.target.id === 'sessionGym') s.gymId = e.target.value;
  else return;
  await db.put('sessions', s);
  render();
});

// Datum kann über Mitternacht wechseln, wenn die App im Hintergrund war.
// Wake Lock fällt beim App-Wechsel weg und wird beim Zurückkommen neu angefordert.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (view.name === 'home') render(); else updateWakeLock();
  tick();
});

init().catch((err) => { app.innerHTML = '<div class="empty">Speicher nicht verfügbar: ' + h(err.message) + '</div>'; });
