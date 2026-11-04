import * as db from './db.js';
import {
  MUSCLES, DEFAULT_SETTINGS, muscleLabel, unitForEquipment, todayISO, exerciseSequence,
  sortExercises, suggestNext, sortSessions, prefill, stepWeight, formatWeight, formatDate, renumber,
  historyStep, resolveStep, stepSize,
} from './logic.js';
import { toJSON, fromJSON, toCSV, runsToCSV } from './backup.js';
import {
  RUN_DEFAULTS, MODE_TEXT, plan as runPlan, assess as runAssess, history as runHistory, suggestType,
  paceSec, formatPace, formatDuration, formatKm, morningCheckDue, weekKey, dayOf, isComplete, parseDuration,
} from './run.js';
import { makeRun } from './sources.js';
import {
  previousSets, compareSets, compareSet, ARROWS, feedbackText, suggestIncrease, ghostText,
  remainingSeconds, formatClock, sessionSummary, workingSets,
} from './progress.js';
import { AUTHORS, pickQuote, sourceLabel } from './quotes.js';
import {
  REGIONS, regionOf, exerciseSeries, regionSeries, recentTrend, suggestStartWeight, calibrationId,
  isUniversal, isBodyweight, effectiveSets, bodyWeightAt, secondaryOf, regionBalance, defaultBodyShare,
} from './stats.js';
import { lineChart } from './chart.js';

// ---------- Zustand (alles im Speicher, jede Änderung sofort nach IndexedDB) ----------
const S = { gyms: [], exercises: [], sessions: [], sets: [], meta: new Map(), calibrations: [], runs: [] };
let view = { name: 'home' };
let log = null; // { exerciseId, weight, unit } während "Satz erfassen"
let rf = null; // Formular "Lauf erfassen/bearbeiten"
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

// ---------- Lauf: Hilfen ----------
const runSettings = () => ({ ...RUN_DEFAULTS, ...(S.meta.get('runSettings') || {}) });
const runOpts = () => ({ skipDeloadWeek: S.meta.get('runDeloadSkip') });
const runExercise = () => S.exercises.find((e) => e.kind === 'run');
const runsOf = (sessionId) => S.runs.filter((r) => r.sessionId === sessionId);
const pad2 = (n) => String(n).padStart(2, '0');
const nowLocal = () => { const d = new Date(); return todayISO(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };

// Läufe als Pseudo-Sätze: so zählt "Lauf" in Sortierung, Vorschlag und "Heute" wie jede Übung.
function runPseudoSets() {
  const ex = runExercise();
  if (!ex) return [];
  return S.runs.filter((r) => r.sessionId).map((r) => ({
    id: 'run:' + r.id, sessionId: r.sessionId, exerciseId: ex.id, order: 1, createdAt: Date.parse(r.date),
  }));
}

// Lauf-Ampel in echten Ampelfarben (Ausnahme von BRAND, Farben aus der Diagramm-Palette),
// immer mit Symbol und Wort.
const RUN_STATUS = {
  green: ['amp-g', '▲', 'Grün'], yellow: ['amp-y', '▬', 'Gelb'], red: ['amp-r', '▼', 'Rot'],
  red2: ['amp-r', '▼', 'Rot'], incomplete: ['r0', '?', 'Knie fehlt'],
};
const RUN_MODE = { green: ['amp-g', '▲', 'Grün'], deload: ['amp-y', '▬', 'Entlastung'], red: ['amp-r', '▼', 'Rot'], red2: ['amp-r', '▼', 'Rot'] };
const chip = ([cls, sym, label]) => `<span class="${cls}">${sym} ${label}</span>`;
const runLine = (r) => formatKm(r.distanceKm) + ' · ' + formatDuration(r.durationSec) + ' · '
  + formatPace(paceSec(r)) + (isComplete(r) ? ' · Knie ' + r.kneeDuring : '');

function todaySession() {
  const today = todayISO();
  const gym = currentGym();
  // Abgeschlossene Trainings bleiben zu; danach am selben Tag beginnt ein neues.
  return sortSessions(S.sessions.filter((s) => s.date === today && s.gymId === gym.id && !s.finishedAt)).pop() || null;
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
  if (!timerVisible()) return big ? `<span class="timer idle">Pause ${formatClock(settings().restSeconds)}</span>` : '';
  const sec = remainingSeconds(timer.endAt, Date.now());
  const pct = sec ? (sec / timer.duration) * 100 : 0;
  return `<button class="timer ${sec ? '' : 'done'} ${big ? '' : 'mini'}" data-a="timer-stop" id="timer${big ? '' : 'Mini'}">
    <span class="bar" style="width:${pct}%"></span><span class="t">${sec ? formatClock(sec) : 'Los'}</span></button>`;
}

function tick() {
  if (!timer) return;
  const sec = remainingSeconds(timer.endAt, Date.now());
  document.querySelectorAll('.timer:not(.idle)').forEach((el) => {
    el.querySelector('.t').textContent = sec ? formatClock(sec) : 'Los';
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
  S.runs = data.runs;
  S.meta = new Map(data.meta.map((m) => [m.key, m.value]));
  if (!S.gyms.length) {
    const g = { id: uid(), name: 'Home-Gym', isHome: true };
    S.gyms.push(g);
    await db.put('gyms', g);
  }
  // "Lauf" steht wie jede Übung in der Liste (einmalig angelegt, auch nach einem Import).
  if (!runExercise()) {
    const ex = { id: uid(), name: 'Lauf', kind: 'run', aliases: [], defaultUnit: null, muscleGroup: null, dbId: null, createdAt: Date.now() };
    S.exercises.push(ex);
    await db.put('exercises', ex);
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
  // Platz unter dem Inhalt genau so hoch wie das Eingabe-Panel, damit nichts dahinter verschwindet.
  const panel = app.querySelector('.panel');
  app.style.paddingBottom = panel ? panel.offsetHeight + 16 + 'px' : '';
  updateWakeLock();
  if (view.name === 'new') {
    const inp = $('#q');
    inp.value = view.q || '';
    renderResults();
    if (!view.q) inp.focus();
  }
}

// Körpergewicht und Vergleich über Gyms
const bodyWeights = () => S.meta.get('bodyWeights') || [];
const effOf = (ex, list) => effectiveSets(ex, list, S.sessions, bodyWeights());
const gymScope = (ex) => (isUniversal(ex) ? null : currentGym().id);

// Anzeige eines Gewichts; bei Körpergewichtsübungen der Zusatz ("KG + 10 kg").
function weightLabel(ex, weight, unit) {
  if (!isBodyweight(ex)) return formatWeight(weight, unit);
  const add = weight || 0;
  if (!add) return 'Körpergewicht';
  return 'KG ' + (add > 0 ? '+ ' : '− ') + fmtNum(Math.abs(add)) + ' kg';
}
const setLabel = (ex, s) => weightLabel(ex, s.addKg !== undefined ? s.addKg : s.weight, s.unit);

function setSummary(list, ex) {
  const sorted = list.slice().sort(byOrder);
  const labels = sorted.map((s) => setLabel(ex, s));
  if (labels.every((l) => l === labels[0])) return labels[0] + ' · ' + sorted.map((s) => s.reps).join(' · ');
  return sorted.map((s, i) => labels[i] + ' × ' + s.reps).join(' · ');
}

// Logo-Kleinversion (brand/satz-symbol-small.svg, für unter 48 px), eingefärbt über CSS-Variablen.
const LOGO_SMALL = '<svg viewBox="0 0 256 256" role="img" aria-label="Satz">'
  + '<rect class="logo-plus" x="108" y="20" width="40" height="96" rx="20"/><rect class="logo-plus" x="80" y="48" width="96" height="40" rx="20"/>'
  + '<rect class="logo-plate" x="48" y="136" width="160" height="40" rx="20"/><rect class="logo-plate" x="48" y="196" width="160" height="40" rx="20"/></svg>';

function exerciseRow(ex, extra = '', cls = '') {
  return `<button class="row ${cls}" data-a="open-ex" data-id="${ex.id}">
    <div class="main"><div class="title">${h(ex.name)}</div><div class="sub">${h(ex.kind === 'run' ? 'Ausdauer' : muscleLabel(ex.muscleGroup))}</div></div>
    ${extra}</button>`;
}

const VIEWS = {
  home() {
    const gym = currentGym();
    const session = todaySession();
    const todaySets = session ? setsOf(session.id) : [];
    const todayRuns = session ? runsOf(session.id) : [];
    const pseudo = runPseudoSets();
    const allSets = S.sets.concat(pseudo);
    const doneIds = exerciseSequence(todaySets.concat(pseudo.filter((p) => session && p.sessionId === session.id)));
    const sorted = sortExercises(S.exercises, allSets);
    const suggestId = sorted.length ? suggestNext(allSets, doneIds[doneIds.length - 1] || null, doneIds) : null;
    const suggest = suggestId && exById(suggestId);

    let out = `<div class="brandbar">${LOGO_SMALL}<span class="word">Satz</span></div>
      <header class="bar">
      <h1>${h(formatDate(todayISO()))}</h1>
      ${timerHtml(false)}
      <button class="chip" data-a="pick-gym">${h(gym.name)} ▾</button></header>`;

    // Morgen-Check: ab 5 Uhr am Tag nach einem Lauf, 48 h lang, überspringbar.
    const mc = morningCheckDue(S.runs, nowLocal());
    if (mc) {
      out += `<div class="card"><div class="title">Wie ist dein Knie heute im Vergleich zu vor dem Lauf?</div>
        <div class="sub">Lauf vom ${h(formatDate(dayOf(mc.date)))} · ${h(formatKm(mc.distanceKm))}</div>
        <div class="seg">${['besser', 'gleich', 'schlechter'].map((v) =>
          `<button data-a="morning" data-id="${mc.id}" data-v="${v}">${v}</button>`).join('')}</div>
        <button class="ghost small" data-a="morning-skip" data-id="${mc.id}">Überspringen</button></div>`;
    }

    if (doneIds.length) {
      out += '<h2>Heute</h2><div class="list">' + doneIds.map((id) => {
        const ex = exById(id);
        if (ex && ex.kind === 'run') {
          return todayRuns.map((r) => {
            const a = runAssess(r, S.runs, runSettings(), runOpts());
            return `<button class="row" data-a="edit-run" data-id="${r.id}"><div class="main">
              <div class="title">Lauf</div><div class="sub">${h(runLine(r))}</div></div>
              <span class="badge">${chip(RUN_STATUS[a.status])}</span></button>`;
          }).join('');
        }
        const list = todaySets.filter((s) => s.exerciseId === id);
        const prev = previousSets(id, gymScope(ex), S.sessions, S.sets, session.id);
        const res = prev ? compareSets(effOf(ex, prev.sets), effOf(ex, list), settings().lowerReps).result : null;
        const arrow = prev ? `<span class="r${res}">${ARROWS[res]}</span> ` : '';
        return `<button class="row" data-a="open-ex" data-id="${id}"><div class="main">
          <div class="title">${h(ex ? ex.name : '?')}</div><div class="sub">${h(setSummary(list, ex))}</div></div>
          <span class="badge">${arrow}✓ ${list.length}</span></button>`;
      }).join('') + '</div>';
      out += '<button class="primary finish" data-a="finish">Training abschließen</button>';
    } else {
      const finished = sortSessions(S.sessions.filter((s) => s.date === todayISO() && s.finishedAt)).pop();
      if (finished) {
        out += `<div class="list" style="margin-top:8px"><button class="row" data-a="show-summary" data-id="${finished.id}">
          <div class="main"><div class="title">✓ Heute schon trainiert</div><div class="sub">Zusammenfassung ansehen</div></div>
          <span class="muted">›</span></button></div>`;
      }
    }

    if (!S.exercises.length) {
      return out + `<div class="empty"><img src="brand/satz-symbol-color.svg" alt="">Noch keine Übungen.<br>Lege deine erste an.</div>
        <button class="primary" style="width:100%" data-a="new-ex">+ Neue Übung</button>`;
    }

    // Erledigte Übungen verschwinden aus der Liste (abgehakt), sie stehen oben unter "Heute".
    const open = sorted.filter((e) => e.id !== suggestId && !doneIds.includes(e.id));
    out += `<h2>${doneIds.length ? 'Noch offen' : 'Übungen'}</h2><div class="list">`;
    if (suggest) out += exerciseRow(suggest, '<span class="badge">Vorschlag</span>', 'suggest');
    out += open.map((ex) => exerciseRow(ex)).join('');
    if (doneIds.length && !suggest && !open.length) out += '<div class="empty small">Alles erledigt</div>';
    out += '<button class="row add" data-a="new-ex">+ Neue Übung</button></div>';
    return out;
  },

  // Nach "Training abschließen": Spruch, Kennzahlen, Vergleich pro Übung.
  summary() {
    const session = S.sessions.find((s) => s.id === view.id);
    if (!session) { view = { name: 'home' }; return VIEWS.home(); }
    const sum = sessionSummary(session, S.sessions, S.sets, settings().lowerReps, {
      anyGym: (id) => isUniversal(exById(id)),
      effective: (id, list) => effOf(exById(id), list),
    });
    const quote = pickQuote(session.id);
    const g = gymById(session.gymId);
    const sRuns = runsOf(session.id);
    const headline = sum.compared
      ? `${sum.better} von ${sum.compared} Übungen besser als letztes Mal`
      : sum.exercises.length ? 'Erstes Training hier – ab jetzt wird verglichen' : 'Lauf erfasst';
    const runRows = sRuns.map((r) => {
      const a = runAssess(r, S.runs, runSettings(), runOpts());
      return `<div class="row"><div class="main"><div class="title">Lauf</div><div class="sub">${h(runLine(r))}</div></div>
        <span class="trend">${chip(RUN_STATUS[a.status])}</span></div>`;
    }).join('');
    return `<header class="bar"><h1>Training abgeschlossen</h1></header>
      <div class="quote"><div class="icon">${AUTHORS[quote.author].icon}</div>
        <div><div class="q">„${h(quote.text)}“</div>
        <div class="src"><b>${h(AUTHORS[quote.author].name)}</b> ${h(sourceLabel(quote))}</div></div></div>
      <div class="tiles">
        <div class="tile"><b>${sum.exercises.length + (sRuns.length ? 1 : 0)}</b><span>Übungen</span></div>
        <div class="tile"><b>${sum.setCount}</b><span>Sätze</span></div>
        <div class="tile"><b>${sum.reps}</b><span>Reps</span></div>
        <div class="tile"><b>${sum.minutes == null ? '–' : sum.minutes}</b><span>Minuten</span></div>
      </div>
      <h2>${h(headline)}</h2>
      <div class="list">${sum.exercises.map((e) => {
        const ex = exById(e.exerciseId);
        const fb = e.cmp ? `<span class="trend r${e.cmp.result}">${ARROWS[e.cmp.result]}</span>` : '<span class="trend none">neu</span>';
        return `<div class="row"><div class="main"><div class="title">${h(ex ? ex.name : '?')}</div>
          <div class="sub">${h(setSummary(e.sets, ex))}${e.cmp ? ' · ' + h(feedbackText(e.cmp, e.prev.session.date)) : ''}</div></div>${fb}</div>`;
      }).join('')}${runRows}</div>
      <p class="muted small">${h(formatDate(session.date))} · ${h(g ? g.name : '?')}</p>
      <button class="primary finish" data-a="tab" data-view="sessions">Fortschritt ansehen</button>
      <div class="btns"><button data-a="home">Fertig</button><button class="ghost" data-a="reopen" data-id="${session.id}">Doch weitermachen</button></div>`;
  },

  log() {
    const ex = exById(log.exerciseId);
    const session = todaySession();
    const list = session ? setsOf(session.id).filter((s) => s.exerciseId === ex.id).sort(byOrder) : [];
    const prev = previousSets(ex.id, gymScope(ex), S.sessions, S.sets, session && session.id);
    const st = settings();
    const isBw = isBodyweight(ex);
    const unit = log.unit;
    const keys = Array.from({ length: 20 }, (_, i) => `<button data-a="rep" data-n="${i + 1}">${i + 1}</button>`).join('');
    const segBtn = (u, label) => `<button data-a="unit" data-u="${u}" class="${unit === (u || null) ? 'on' : ''}">${label}</button>`;

    // Geisterwert (Review V8): Index zählt nur über Arbeitssätze (≥ 90 % des Höchstgewichts).
    // Arbeitssatz n wird mit dem n-ten Arbeitssatz vom letzten Mal verglichen; Herantast-Sätze bekommen keinen.
    // Bei Körpergewicht wird mit der wirksamen Last verglichen (Anteil × Körpergewicht + Zusatz).
    const prevEff = prev ? effOf(ex, prev.sets) : null;
    const curEff = effOf(ex, list);
    const prevWork = prev ? workingSets(prevEff) : null;
    const curWork = workingSets(curEff);
    const ghost = (s) => {
      const i = curWork.findIndex((x) => x.id === s.id);
      const p = prevWork && i >= 0 ? prevWork[i] : null;
      if (!p) return '';
      const r = compareSet(p, curWork[i], st.lowerReps);
      return `<span class="ghost r${r}">${ARROWS[r]} (${p.reps})</span>`;
    };
    const planned = isBw ? (ex.bodyShare || 1) * (bodyWeightAt(bodyWeights(), todayISO()) || 0) + (log.weight || 0) : log.weight;
    let info = '';
    if (prev && curWork.length >= prevWork.length) {
      const cmp = compareSets(prevEff, curEff, st.lowerReps);
      info = `<div class="feedback r${cmp.result}">${ARROWS[cmp.result]} ${h(feedbackText(cmp, prev.session.date))}</div>`;
    } else if (!list.length && prev && suggestIncrease(prevEff, planned, unit, st.increaseThreshold)) {
      info = `<div class="banner"><span>Letztes Mal alle Sätze ≥ ${st.increaseThreshold} Reps. Gewicht erhöhen?</span>
        <button class="primary" data-a="step" data-d="1">+${h(stepLabel(stepInfo().step, unit))}</button></div>`;
    } else if (!list.length && log.fromFactor) {
      info = `<div class="feedback">Erstes Mal hier: Vorschlag für ca. ${log.fromFactor} Reps aus deiner Umrechnung.</div>`;
    }
    const step = unit ? fmtNum(stepInfo().step) : '';
    const target = prev ? ghostText(prevWork, curWork.length + 1, (w, u, s) => setLabel(ex, s)) : null;
    const lastSetRow = list[list.length - 1];
    const rirRow = st.rirInput && lastSetRow ? `<div class="seg rir"><span class="small muted">Reserve</span>${[0, 1, 2, 3, 4].map((n) =>
      `<button data-a="quick-rir" data-id="${lastSetRow.id}" data-v="${n}" class="${lastSetRow.rir === n ? 'on' : ''}">${n}</button>`).join('')}</div>` : '';
    const needsBw = isBw && !bodyWeights().length
      ? '<div class="card"><div class="sub">Für die Kurve fehlt dein Körpergewicht.</div><button class="ghost small" data-a="add-bw">Körpergewicht eintragen</button></div>' : '';
    const targetText = target ? 'Ziel: ' + target : prev ? 'Extra-Satz' : 'Erstes Mal hier';

    return `<header class="bar">
        <button class="back ghost" data-a="home" aria-label="Zurück">‹</button>
        <div class="titles" data-a="edit-ex"><h1>${h(ex.name)}</h1><div class="date">${h(currentGym().name)} · Übung bearbeiten ›</div></div></header>
      <div class="list sets">${list.length ? list.map((s) => `
        <button class="row ${s.id === flashId ? 'flash' : ''}" data-a="edit-set" data-id="${s.id}">
          <span class="num">Satz ${s.order}</span><span class="main title">${h(setLabel(ex, s))}</span>
          <span class="title">× ${s.reps}</span>${ghost(s)}</button>`).join('')
        : `<div class="empty">${prev ? 'Letztes Mal (' + h(formatDate(prev.session.date)) + '): ' + h(setSummary(prev.sets, ex)) : 'Noch kein Satz. Tippe die Reps unten.'}</div>`}</div>
      ${rirRow}${needsBw}${info}
      <div class="panel">
        <div class="strip">${timerHtml(true)}<span class="target">${h(targetText)}</span></div>
        <div class="weight">
          <button data-a="step" data-d="-1" ${unit ? '' : 'disabled'}>−<small>${step}</small></button>
          <button class="val" data-a="type-weight" ${unit ? '' : 'disabled'}>${h(isBw ? weightLabel(ex, log.weight, unit) : !unit ? 'ohne Gewicht' : log.weight == null ? (unit === 'stufe' ? 'Stufe –' : '– kg') : formatWeight(log.weight, unit))}</button>
          <button data-a="step" data-d="1" ${unit ? '' : 'disabled'}>+<small>${step}</small></button>
        </div>
        ${isBw ? '' : `<div class="seg">${segBtn('kg', 'kg')}${segBtn('stufe', 'Stufe')}${segBtn('', 'ohne')}</div>`}
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

  // Verlauf: zusammengeführte Grafik, Übungen mit 4-Wochen-Trend, Link zu allen Trainings.
  sessions() {
    const segs = (a, cur, opts) => `<div class="seg">${opts.map(([v, l]) =>
      `<button data-a="${a}" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    let out = '<header class="bar"><h1>Verlauf</h1></header>';
    out += segs('area', chartState.area, [['kraft', 'Kraft'], ['lauf', 'Lauf']]) + '<div style="height:8px"></div>';
    if (chartState.area === 'lauf') return out + runOverview();
    if (!S.sessions.length) return out + '<div class="empty">Noch keine Trainings.</div>';
    const all = allSeries();
    const lines = chartLines(all);
    const visible = lines.filter((l) => !chartState.hidden.has(l.id));
    out += segs('chart-mode', chartState.mode, [['regions', 'Regionen'], ['exercises', 'Übungen'], ['balance', 'Balance']]);
    if (chartState.mode === 'balance') {
      out += '<div style="height:8px"></div>' + balanceBars();
    } else {
    out += `<div class="chartbox" style="margin-top:8px">${lineChart(visible, { height: 220 })}
      <div class="chart-info" id="chartInfo">Tippe auf einen Punkt für Details.</div></div>`;
    // Bei 3/6 Monaten zusätzlich die Veränderung seit Fensterbeginn (Linie bleibt auf der Gesamtbasis).
    const sinceStart = (l) => {
      if (chartState.range === 'all' || l.points.length < 2) return '';
      const a = l.points[0].y;
      const b = l.points[l.points.length - 1].y;
      return ' ' + fmtPct(((100 + b) / (100 + a) - 1) * 100);
    };
    out += `<div class="legend">${lines.map((l) => `<button data-a="chart-toggle" data-id="${h(l.id)}"
      class="${chartState.hidden.has(l.id) ? 'off' : ''}" style="--c:var(--s${l.color})"><span class="sw"></span>${h(l.label)}${h(sinceStart(l))}</button>`).join('')}</div>`;
    out += `<div style="margin-top:8px">${segs('chart-range', chartState.range, [['3', '3 Monate'], ['6', '6 Monate'], ['all', 'Alle']])}</div>`;
    const noBase = all.filter((x) => x.points.length && !x.baseReady).map((x) => (exById(x.exerciseId) || {}).name);
    out += `<p class="muted small">0 % = Median der ersten 3 Trainings einer Übung. Hohle Punkte sind geschätzt
      (anderes Gym, Index-Stufe oder über 15 Reps), gestrichelte vorläufig.${chartState.range === 'all' ? '' : ' Zahl an der Legende: Veränderung seit Beginn des Zeitraums.'}
      ${noBase.length ? ' Prozent ab dem 3. Training: ' + h(noBase.join(', ')) + '.' : ''}</p>`;
    }

    const today = todayISO();
    out += '<h2>Übungen · letzte 4 Wochen (* geschätzt)</h2><div class="list">' + sortExercises(S.exercises, S.sets).filter((ex) => ex.kind !== 'run').map((ex) => {
      const s = all.find((x) => x.exerciseId === ex.id);
      const t = s && recentTrend(s, today);
      const trend = t ? `<span class="trend r${t.result}">${ARROWS[t.result]} ${fmtPct(t.change)}${t.estimated ? '*' : ''}${t.twoOnly ? ' (2 Tr.)' : ''}</span>`
        : '<span class="trend none">zu wenig Daten</span>';
      const total = !s || !s.points.length ? '' : s.baseReady ? ' · gesamt ' + fmtPct(s.points[s.points.length - 1].pct) : ' · Prozent ab 3. Training';
      return `<button class="row" data-a="open-stats" data-id="${ex.id}"><div class="main"><div class="title">${h(ex.name)}</div>
        <div class="sub">${h(regionOf(ex.muscleGroup) || muscleLabel(ex.muscleGroup))}${total}</div></div>
        ${sparkline(s)}${trend}</button>`;
    }).join('') + '</div>';
    out += `<div class="list" style="margin-top:16px"><button class="row" data-a="tab" data-view="trainings"><div class="main">
      <div class="title">Alle Trainings</div><div class="sub">${S.sessions.length} Trainings, zum Ansehen und Bearbeiten</div></div>
      <span class="muted">›</span></button></div>`;
    return out;
  },

  // Kompakte Liste aller Trainings (wie die alte Notiz, nur kürzer).
  trainings() {
    const list = sortSessions(S.sessions).reverse();
    let out = `<header class="bar"><button class="back ghost" data-a="tab" data-view="sessions" aria-label="Zurück">‹</button>
      <h1>Alle Trainings</h1></header>`;
    if (!list.length) return out + '<div class="empty">Noch keine Trainings.</div>';
    return out + '<div class="list">' + list.map((s) => {
      const sets = setsOf(s.id);
      const g = gymById(s.gymId);
      const lines = exerciseSequence(sets).map((id) => {
        const ex = exById(id);
        return `<div class="sub"><b>${h(ex ? ex.name : '?')}</b>  ${h(setSummary(sets.filter((x) => x.exerciseId === id), ex))}</div>`;
      }).join('') + runsOf(s.id).map((r) => `<div class="sub"><b>Lauf</b>  ${h(runLine(r))}</div>`).join('');
      return `<button class="row" data-a="open-session" data-id="${s.id}"><div class="main">
        <div class="title">${h(formatDate(s.date))} · ${h(g ? g.name : '?')}</div>${lines}</div><span class="muted">›</span></button>`;
    }).join('') + '</div>';
  },

  // Übungsseite: %-Linie über alle Gyms, Gewicht und Gesamt-Reps pro Gerät, Umrechnung.
  exstats() {
    const ex = exById(view.id);
    if (!ex) { view = { name: 'sessions' }; return VIEWS.sessions(); }
    const s = seriesOf(ex);
    const color = colorIndex().get(ex.id) || 1;
    const nudged = (S.meta.get('nudgeHighReps') || []).includes(ex.id);
    let out = `<header class="bar"><button class="back ghost" data-a="tab" data-view="sessions" aria-label="Zurück">‹</button>
      <div class="titles"><h1>${h(ex.name)}</h1><div class="date">${h(muscleLabel(ex.muscleGroup))}</div></div></header>`;
    if (!s.points.length) {
      return out + (s.needsBodyWeight
        ? '<div class="empty">Für die Kurve fehlt dein Körpergewicht.</div><button class="primary finish" data-a="add-bw">Körpergewicht eintragen</button>'
        : '<div class="empty">Noch keine Trainings mit Gewicht.</div>');
    }
    // Ohne Basis (Review V3): absolute Werte in Bezugseinheiten statt Prozent.
    const absFmt = (v) => fmtNum(Math.round(v));
    const volume = chartState.exMetric === 'volume';
    const usePct = s.baseReady && !volume;
    const line = {
      id: ex.id, label: ex.name, color,
      points: s.points.map((p) => (volume ? chartPoint(p, p.volumeValue, absFmt) : usePct ? chartPoint(p, p.pct) : chartPoint(p, p.value, absFmt))),
    };
    out += `<div class="seg">${[['strength', 'Stärke'], ['volume', 'Volumen']].map(([v, l]) =>
      `<button data-a="ex-metric" data-v="${v}" class="${chartState.exMetric === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    out += `<h2>${volume ? 'Volumen pro Training (Last × Reps der Arbeitssätze)' : s.baseReady ? 'Fortschritt über alle Gyms' : 'Geschätztes Maximum (Prozent ab dem 3. Training)'}</h2>
      <div class="chartbox">${lineChart([line], usePct ? { height: 180 } : { height: 180, unit: '', zero: false, fmt: absFmt })}
      <div class="chart-info" id="chartInfo">Tippe auf einen Punkt für Details.</div></div>`;
    if (!nudged && s.points.some((p) => p.highReps)) {
      out += `<div class="card"><div class="sub">Ein Arbeitssatz unter 12 Reps macht die Kurve genauer (über 15 Reps ist die Schätzung unsicher).</div>
        <button class="ghost small" data-a="nudge-off" data-id="${ex.id}">Ausblenden</button></div>`;
    }

    const [refGym, refUnit] = s.ref.split('|');
    const unitName = (u) => (u === 'stufe' ? 'Stufe' : 'kg');
    // Geräte mit Trainings, dazu Umrechnungen für Gyms ohne Trainings (nur fürs Startgewicht).
    const machines = [...s.factors.keys()];
    S.calibrations.filter((c) => c.exerciseId === ex.id).forEach((c) => {
      const m = c.gymId + '|' + c.unit;
      if (!machines.includes(m)) machines.push(m);
    });
    machines.forEach((machine) => {
      const [gymId, unit] = machine.split('|');
      const g = gymById(gymId);
      const cal0 = S.calibrations.find((c) => c.id === calibrationId(ex.id, gymId, unit)) || {};
      const f = s.factors.get(machine) || {
        factor: cal0.factorToHome || (cal0.kgPerUnit && refUnit === 'kg' ? cal0.kgPerUnit : 0), source: 'manuell',
      };
      const pts = machineHistory(ex.id, gymId, unit);
      const cal = S.calibrations.find((c) => c.id === calibrationId(ex.id, gymId, unit));
      out += `<h2>${h(g ? g.name : '?')} · ${unitName(unit)}</h2>`;
      if (pts.length >= 2) {
        const mk = (key, label) => ({ id: machine + key, label, color, points: pts.map((p) => ({ t: tOf(p.date), y: p[key], info: formatDate(p.date) + ' · ' + label + ' ' + fmtNum(p[key]) })) });
        const small = (key, label) => `<div class="chartbox" style="margin-bottom:6px"><div class="small muted" style="padding-left:8px">${label}</div>
          ${lineChart([mk(key, label)], { height: 130, unit: '', zero: false, directLabels: false })}<div class="chart-info"></div></div>`;
        out += small('weight', 'Gewicht') + small('reps', 'Gesamt-Reps');
      } else {
        out += `<p class="muted small">${pts.length} Training${pts.length === 1 ? '' : 's'} hier – Graph ab 2 Trainings.</p>`;
      }
      const kgText = cal && cal.kgPerUnit ? ` · 1 Stufe = ${fmtNum(cal.kgPerUnit)} kg${cal.baseKg != null ? ' + ' + fmtNum(cal.baseKg) + ' kg Grundgewicht' : ''}` : '';
      const SRC = {
        geschätzt: () => ` (geschätzt aus 3 Trainings, Anker ${h(formatDate(f.anchorDate))})`,
        vorläufig: () => ` (vorläufig, ${f.newCount} von 3 Trainings)`,
        kg: () => ' (über kg pro Stufe)',
        gleich: () => ' (Gewicht überall gleich)',
        manuell: () => ' (von dir)',
      };
      const calText = f.source === 'bezug'
        ? 'Bezugsgerät' + kgText
        : `1 ${unitName(unit)} hier ≈ ${fmtNum(Math.round(f.factor * 100) / 100)} ${unitName(refUnit)} in ${h((gymById(refGym) || {}).name || '?')}`
          + SRC[f.source]() + kgText;
      out += `<div class="list"><button class="row" data-a="edit-cal" data-gym="${gymId}" data-unit="${unit}"><div class="main cal">${calText}</div>
        <span class="muted">Ändern</span></button>
        ${f.source !== 'bezug' && pts.length ? `<button class="row" data-a="set-ref" data-m="${machine}"><div class="main cal">Als Bezugsgerät festlegen</div></button>` : ''}</div>`;
    });
    out += `<div class="list" style="margin-top:8px"><button class="row add" data-a="add-cal">+ Umrechnung für anderes Gym (Startgewicht)</button></div>`;
    return out;
  },

  session() {
    const s = S.sessions.find((x) => x.id === view.id);
    if (!s) { view = { name: 'trainings' }; return VIEWS.trainings(); }
    const sets = setsOf(s.id);
    const gymOpts = sortedGyms().map((g) => `<option value="${g.id}" ${g.id === s.gymId ? 'selected' : ''}>${h(g.name)}</option>`).join('');
    return `<header class="bar"><button class="back ghost" data-a="tab" data-view="trainings" aria-label="Zurück">‹</button>
        <h1>${h(formatDate(s.date))}</h1></header>
      <div class="grid2">
        <label class="field"><span>Datum</span><input type="date" id="sessionDate" value="${s.date}"></label>
        <label class="field"><span>Gym</span><select id="sessionGym">${gymOpts}</select></label>
      </div>
      ${exerciseSequence(sets).map((id) => {
        const ex = exById(id);
        return `<h2>${h(ex ? ex.name : '?')}</h2><div class="list sets">` + sets.filter((x) => x.exerciseId === id).sort(byOrder).map((x) => `
          <button class="row" data-a="edit-set" data-id="${x.id}"><span class="num">Satz ${x.order}</span>
          <span class="main title">${h(setLabel(ex, x))}</span><span class="title">× ${x.reps}</span></button>`).join('') + '</div>';
      }).join('')}
      ${runsOf(s.id).length ? '<h2>Lauf</h2><div class="list">' + runsOf(s.id).map((r) => `<button class="row" data-a="edit-run" data-id="${r.id}">
        <div class="main title">${h(runLine(r))}</div><span class="muted">›</span></button>`).join('') + '</div>' : ''}
      <div class="btns"><button class="danger" data-a="delete-session">Training löschen</button></div>`;
  },

  // Lauf erfassen oder bearbeiten (Ziel: unter 30 Sekunden).
  run() {
    const st = runSettings();
    const others = S.runs.filter((r) => r.id !== rf.id);
    const p = runPlan(others, rf.date || nowLocal(), st, runOpts());
    const last = others.filter(isComplete).sort((a, b) => (a.date < b.date ? -1 : 1)).pop();
    if (!rf.typeTouched) rf.runType = suggestType(rf.distanceKm, p.sollLong);
    const seg = (a, cur, opts) => `<div class="seg">${opts.map(([v, l]) =>
      `<button data-a="${a}" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const knee = Array.from({ length: 11 }, (_, i) =>
      `<button data-a="run-knee" data-v="${i}" class="${rf.knee === i ? 'on' : ''}">${i}</button>`).join('');
    return `<header class="bar"><button class="back ghost" data-a="run-back" aria-label="Zurück">‹</button>
        <h1>${rf.id ? 'Lauf bearbeiten' : 'Lauf'}</h1></header>
      <div class="card">
        <div class="sub">${last ? 'Letzter Lauf: ' + h(runLine(last)) : 'Erster Lauf'}</div>
        <div class="title">Soll: lang ${h(formatKm(p.sollLong))} · kurz ${h(formatKm(p.sollShort))}</div>
        ${p.mode !== 'green' ? `<div class="sub">${chip(RUN_MODE[p.mode])} ${h(MODE_TEXT[p.mode])}</div>` : ''}
      </div>
      <h2>Distanz</h2>
      <div class="weight">
        <button data-a="run-km" data-d="-1">−<small>0,1</small></button>
        <button class="val" data-a="run-km-type">${h(formatKm(rf.distanceKm))}</button>
        <button data-a="run-km" data-d="1">+<small>0,1</small></button>
      </div>
      <h2>Dauer</h2>
      <div class="dur"><input id="rfMin" inputmode="numeric" placeholder="min" value="${h(rf.min)}">
        <span>:</span><input id="rfSec" inputmode="numeric" placeholder="s" value="${h(rf.sec)}">
        <span class="sub" id="rfPace">${h(rfPaceText())}</span></div>
      <h2>Knie während oder direkt danach (0 = nichts, 10 = stark)</h2>
      <div class="knee">${knee}</div>
      <h2>Lauftyp${rf.typeTouched ? '' : ' (Vorschlag)'}</h2>
      ${seg('run-type', rf.runType, [['lang', 'lang'], ['kurz', 'kurz'], ['aufwärmen', 'aufwärmen']])}
      <h2>Untergrund</h2>
      ${seg('run-surface', rf.surface, [['draußen', 'draußen'], ['Laufband', 'Laufband']])}
      ${rf.id ? `<h2>Morgen-Check</h2>${seg('run-morning', rf.kneeMorning || '', [['', 'leer'], ['besser', 'besser'], ['gleich', 'gleich'], ['schlechter', 'schlechter']])}
        <label class="field" style="margin-top:16px"><span>Datum und Uhrzeit</span><input type="datetime-local" id="rfDate" value="${h(rf.date)}"></label>` : ''}
      <button class="ghost more" data-a="run-more">${rf.more ? 'Weniger ▴' : 'Mehr: Puls, Kadenz, Notiz ▾'}</button>
      ${rf.more ? `<div class="grid2">
        <label class="field"><span>Puls Ø (bpm)</span><input id="rfAvgHr" inputmode="numeric" value="${h(rf.avgHr)}"></label>
        <label class="field"><span>Puls max (bpm)</span><input id="rfMaxHr" inputmode="numeric" value="${h(rf.maxHr)}"></label>
        <label class="field"><span>Kadenz (spm)</span><input id="rfCadence" inputmode="numeric" value="${h(rf.cadence)}"></label>
      </div><label class="field"><span>Notiz</span><input id="rfNote" value="${h(rf.note)}"></label>` : ''}
      <button class="primary finish" id="rfSave" data-a="run-save" ${rfValid() ? '' : 'disabled'}>Lauf speichern</button>
      ${rf.id ? '<div class="btns"><button class="danger" data-a="run-delete">Lauf löschen</button></div>' : ''}`;
  },

  // Nach dem Speichern: Ampel mit Begründung und neuem Soll.
  runresult() {
    const r = S.runs.find((x) => x.id === view.id);
    if (!r) { view = { name: 'home' }; return VIEWS.home(); }
    const st = runSettings();
    const a = runAssess(r, S.runs, st, runOpts());
    const p = runPlan(S.runs, nowLocal(), st, runOpts());
    const reasons = a.reasons.length ? a.reasons : a.status === 'green' ? ['Alles im Rahmen.'] : [];
    return `<header class="bar"><h1>Lauf gespeichert</h1></header>
      <div class="card ampel">
        <div class="big">${chip(RUN_STATUS[a.status])}</div>
        ${reasons.map((t) => `<div>${h(t)}</div>`).join('')}
        ${a.hints.map((t) => `<div class="sub">Hinweis: ${h(t)}</div>`).join('')}
      </div>
      <div class="card">
        <div class="sub">Nächster langer Lauf</div>
        <div class="title">${h(formatKm(p.sollLong))} · kurz ${h(formatKm(p.sollShort))}</div>
        <div class="sub">${chip(RUN_MODE[p.mode])} ${h(MODE_TEXT[p.mode])}</div>
      </div>
      <p class="muted small">${h(runLine(r))} · ${h(r.runType)} · ${h(r.surface)}</p>
      <button class="primary finish" data-a="home">Fertig</button>
      <div class="btns"><button data-a="edit-run" data-id="${r.id}">Bearbeiten</button></div>`;
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
      <h2>Untere Rep-Grenze (mehr Gewicht zählt als besser, wenn die Reps reichen)</h2><div class="seg">${opt('lowerReps', [5, 6, 8, 10], String)}</div>
      <h2>Reserve (RIR) direkt beim Satz abfragen</h2><div class="seg">${opt('rirInput', [true, false], (v) => (v ? 'An' : 'Aus'))}</div>
      <h2>Körpergewicht</h2><div class="list">${bodyWeights().slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5).map((e) => `
        <button class="row" data-a="del-bw" data-date="${e.date}"><div class="main title">${h(fmtNum(e.kg))} kg</div><span class="badge">${h(formatDate(e.date))}</span></button>`).join('')}
        <button class="row add" data-a="add-bw">+ Körpergewicht eintragen</button></div>
      <h2>Bildschirm während Training anlassen</h2><div class="seg">${opt('wakeLock', [true, false], (v) => (v ? 'An' : 'Aus'))}</div>
      <div class="list" style="margin-top:8px"><button class="row" data-a="test-beep"><div class="main"><div class="title">Ton testen</div>
        <div class="sub">So klingt das Pausenende (Lautstärke, Lautlos-Schalter)</div></div></button></div>
      <h2>Laufen</h2><div class="list">${runSettingRows()}</div>
      <h2>Gyms</h2><div class="list">${sortedGyms().map((g) => `
        <button class="row" data-a="edit-gym" data-id="${g.id}"><div class="main title">${h(g.name)}</div>
        ${g.isHome ? '<span class="badge">Home</span>' : ''}</button>`).join('')}
        <button class="row add" data-a="add-gym">+ Gym hinzufügen</button></div>
      <h2>Backup</h2><div class="list">
        <button class="row" data-a="export-json"><div class="main"><div class="title">Export JSON</div><div class="sub">Komplettes Backup, wieder importierbar</div></div></button>
        <button class="row" data-a="export-csv"><div class="main"><div class="title">Export CSV</div><div class="sub">Eine Zeile pro Satz, für Tabellen</div></div></button>
        <button class="row" data-a="export-runs-csv"><div class="main"><div class="title">Läufe als CSV</div><div class="sub">Eine Zeile pro Lauf, für Tabellen</div></div></button>
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
  const history = historyStep(log.exerciseId, gymScope(exById(log.exerciseId)), log.unit, S.sessions, S.sets);
  return { override, history, step: resolveStep(override, history, log.unit, settings()) };
}

function stepLabel(step, unit) {
  return unit === 'stufe' ? fmtNum(step) + ' Stufe' : fmtNum(step) + ' kg';
}

// ---------- Verlauf / Statistik ----------
const chartState = { area: 'kraft', mode: 'regions', range: 'all', hidden: new Set(), exMetric: 'strength' };

// V17: Balken "Arbeitssätze pro Region in 28 Tagen", hinterlegt mit dem Richtwert 10–20 Sätze pro Woche.
function balanceBars() {
  const data = regionBalance(S.sessions, S.sets, S.exercises, todayISO(), 28, bodyWeights());
  const LOW = 40;
  const HIGH = 80;
  const max = Math.max(HIGH, ...Object.values(data));
  const pct = (v) => (v / max) * 100;
  return '<div class="card balance">' + Object.keys(REGIONS).map((r, i) => `<div class="bal">
      <div class="bal-top"><span>${h(r)}</span><b>${fmtNum(data[r])}</b></div>
      <div class="bal-track"><span class="bal-band" style="left:${pct(LOW)}%;width:${pct(HIGH - LOW)}%"></span>
        <span class="bal-bar" style="width:${pct(data[r])}%;background:var(--s${i + 1})"></span></div></div>`).join('')
    + '<p class="muted small">Arbeitssätze der letzten 28 Tage, zweite Muskelgruppe zählt halb. Helles Band: Richtwert 10–20 Sätze pro Woche. Keine Schätzung, reine Zählung.</p></div>';
}
const tOf = (iso) => Date.parse(iso + 'T00:00:00Z');
const fmtPct = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmtNum(Math.abs(Math.round(v))) + ' %';

// Bezugsgerät pro Übung wird beim ersten Mal festgehalten (Review V10/F6): ein neues Home-Gym
// verschiebt so keine Kurven. Umsetzen nur bewusst auf der Übungsseite.
const refMachines = () => S.meta.get('refMachines') || {};
function seriesOf(ex) {
  return exerciseSeries(ex, homeGym().id, S.sessions, S.sets, S.calibrations, { refMachine: refMachines()[ex.id], today: todayISO(), bodyWeights: bodyWeights() });
}
function allSeries() {
  const all = S.exercises.map(seriesOf);
  const stored = refMachines();
  const missing = all.filter((s) => s.ref && !stored[s.exerciseId]);
  if (missing.length) {
    const next = { ...stored };
    missing.forEach((s) => { next[s.exerciseId] = s.ref; });
    setMeta('refMachines', next).catch(() => {});
  }
  return all;
}

// Farbe folgt der Übung (feste Reihenfolge nach Anlage), nie dem Rang; mehr als 8 → nicht im Gesamtbild.
function colorIndex() {
  const withData = new Set(S.sets.filter((s) => s.weight != null || isBodyweight(exById(s.exerciseId))).map((s) => s.exerciseId));
  const map = new Map();
  S.exercises.filter((e) => withData.has(e.id)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .slice(0, 8).forEach((e, i) => map.set(e.id, i + 1));
  return map;
}

// Geschätzte und vorläufige Punkte mit "ca." (Review V10/S14); Prozent ohne Nachkommastelle.
function pointNote(p) {
  if (p.provisional) return ' (vorläufig)';
  if (p.highReps) return ' (über 15 Reps)';
  return p.estimated ? ' (geschätzt)' : '';
}
function chartPoint(p, y, fmt = fmtPct) {
  const g = gymById(p.gymId);
  return {
    t: tOf(p.date), y, estimated: p.estimated, provisional: p.provisional,
    info: formatDate(p.date) + ' · ' + (g ? g.name : '?') + ' · ' + formatWeight(p.weight, p.unit) + ' × ' + p.reps
      + ' → ' + (p.estimated ? 'ca. ' : '') + fmt(y) + pointNote(p),
  };
}

const EXCLUDE_TEXT = { pause: (e) => `${Math.round(e.days / 7)} Wochen Pause`, neu: () => 'Basis erst ab 3. Training', index: () => 'Index-Stufe' };

function chartLines(all) {
  const from = chartState.range === 'all' ? 0 : tOf(todayISO()) - Number(chartState.range) * 30.5 * 864e5;
  const inRange = (pts) => pts.filter((p) => p.t >= from);
  if (chartState.mode === 'exercises') {
    const colors = colorIndex();
    return S.exercises.filter((e) => colors.has(e.id)).sort((a, b) => colors.get(a.id) - colors.get(b.id)).map((ex) => {
      const s = all.find((x) => x.exerciseId === ex.id);
      // Ohne Basis (weniger als 3 Trainings) noch keine Prozentlinie (Review V3).
      const pts = s.baseReady ? s.points.map((p) => chartPoint(p, p.pct)) : [];
      return { id: ex.id, label: ex.name, color: colors.get(ex.id), points: inRange(pts) };
    }).filter((l) => l.points.length);
  }
  const regions = regionSeries(all, S.exercises);
  return Object.keys(REGIONS).map((r, i) => regions[r] && {
    id: r, label: r, color: i + 1,
    points: inRange(regions[r].map((p) => ({
      t: tOf(p.date), y: p.pct, estimated: p.estimated,
      info: formatDate(p.date) + ' · ' + p.exercises.map((id) => (exById(id) || {}).name).join(', ')
        + ' → ' + (p.estimated ? 'ca. ' : '') + fmtPct(p.pct) + (p.estimated ? ' (geschätzt)' : '')
        + (p.excluded.length ? ' · nicht im Mittel: ' + p.excluded.map((e) => (exById(e.exerciseId) || {}).name
          + ' (' + EXCLUDE_TEXT[e.why](e) + ')').join(', ') : ''),
    }))),
  }).filter((l) => l && l.points.length);
}

function sparkline(s) {
  if (!s || s.points.length < 2) return '<svg class="spark"></svg>';
  const pts = s.points.slice(-10);
  const ys = pts.map((p) => p.value);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + ((i / (pts.length - 1)) * 62 + 1).toFixed(1) + ' '
    + (hi === lo ? 12 : 22 - ((p.value - lo) / (hi - lo)) * 20).toFixed(1)).join(' ');
  return `<svg class="spark" viewBox="0 0 64 24"><path d="${d}"/></svg>`;
}

// Pro Training an einem Gerät: höchstes Gewicht und Gesamt-Reps der Übung.
function machineHistory(exerciseId, gymId, unit) {
  return sortSessions(S.sessions.filter((s) => s.gymId === gymId)).map((session) => {
    const list = setsOf(session.id).filter((x) => x.exerciseId === exerciseId);
    const w = list.filter((x) => x.unit === unit && x.weight != null);
    if (!w.length) return null;
    return { date: session.date, weight: Math.max(...w.map((x) => x.weight)), reps: list.reduce((n, x) => n + x.reps, 0) };
  }).filter(Boolean);
}

function calSheet(gymId, unit) {
  const ex = exById(view.id);
  const s = seriesOf(ex);
  const [refGym, refUnit] = s.ref ? s.ref.split('|') : [homeGym().id, ex.defaultUnit || 'kg'];
  const cal = S.calibrations.find((c) => c.id === calibrationId(ex.id, gymId, unit)) || {};
  const isRef = s.ref === gymId + '|' + unit;
  const unitName = (u) => (u === 'stufe' ? 'Stufe' : 'kg');
  sheet.dataset.gym = gymId;
  sheet.dataset.unit = unit;
  openSheet(`<h3>Umrechnung · ${h((gymById(gymId) || {}).name)} (${unitName(unit)})</h3>
    ${isRef ? '' : `<label class="field"><span>1 ${unitName(unit)} hier entspricht … ${unitName(refUnit)} in ${h((gymById(refGym) || {}).name)} (leer = automatisch schätzen)</span>
      <input id="fFactor" inputmode="decimal" value="${cal.factorToHome ? fmtNum(cal.factorToHome) : ''}"></label>`}
    ${unit === 'stufe' ? `<label class="field"><span>kg pro Stufe, falls bekannt (z. B. Plattengewicht)</span>
      <input id="fKg" inputmode="decimal" value="${cal.kgPerUnit ? fmtNum(cal.kgPerUnit) : ''}"></label>
      <label class="field"><span>Grundgewicht in kg (Schlitten, Stange). Steht meist klein auf dem Stack oder im Handbuch. Wenn unbekannt, leer lassen.</span>
      <input id="fBaseKg" inputmode="decimal" value="${cal.baseKg != null ? fmtNum(cal.baseKg) : ''}"></label>` : ''}
    ${!isRef || unit === 'stufe' ? '' : '<p class="muted">Das ist das Bezugsgerät, hier gibt es nichts umzurechnen.</p>'}
    <div class="btns"><button data-a="close">Abbrechen</button><button class="primary" data-a="save-cal">Speichern</button></div>`);
}

// ---------- Lauf: Formular, Übersicht, Einstellungen ----------
const rfDuration = () => (parseInt(rf.min, 10) || 0) * 60 + (parseInt(rf.sec, 10) || 0);
const rfValid = () => rf.distanceKm > 0 && rfDuration() > 0 && rf.knee != null;
function rfPaceText() {
  const sec = rfDuration();
  return sec && rf.distanceKm > 0 ? 'Pace ' + formatPace(sec / rf.distanceKm) : '';
}

function openRunForm(run, back = 'home') {
  const st = runSettings();
  const p = runPlan(S.runs.filter((r) => !run || r.id !== run.id), nowLocal(), st, runOpts());
  rf = run ? {
    id: run.id, date: run.date, distanceKm: run.distanceKm,
    min: String(Math.floor(run.durationSec / 60)), sec: String(run.durationSec % 60),
    knee: run.kneeDuring, runType: run.runType, typeTouched: true, surface: run.surface,
    avgHr: run.avgHr == null ? '' : run.avgHr, maxHr: run.maxHr == null ? '' : run.maxHr,
    cadence: run.cadenceSpm == null ? '' : run.cadenceSpm, note: run.note || '', kneeMorning: run.kneeMorning,
    more: !!(run.avgHr || run.maxHr || run.cadenceSpm || run.note), back,
  } : {
    id: null, date: null, distanceKm: p.sollLong, min: '', sec: '', knee: null, runType: 'lang', typeTouched: false,
    surface: 'draußen', avgHr: '', maxHr: '', cadence: '', note: '', kneeMorning: null, more: false, back,
  };
  view = { name: 'run' };
  render();
  window.scrollTo(0, 0);
}

function runOverview() {
  const st = runSettings();
  const p = runPlan(S.runs, nowLocal(), st, runOpts());
  const hist = runHistory(S.runs, st, runOpts());
  let out = `<div class="card runhero">
      <div class="sub">Nächster langer Lauf</div>
      <div class="big">${h(formatKm(p.sollLong))}</div>
      <div>${chip(RUN_MODE[p.mode])} ${h(MODE_TEXT[p.mode])}</div>
      <div class="sub">Kurzer Lauf: ${h(formatKm(p.sollShort))}</div>
      <div class="prog"><span style="width:${Math.round(p.progress * 100)}%"></span></div>
      <div class="sub">Längster Lauf (30 Tage): ${h(formatKm(p.l30))} von ${h(formatKm(st.goalKm))} · ${Math.round(p.progress * 100)} %</div>
      ${p.mode === 'deload' ? '<button class="ghost small" data-a="skip-deload">Entlastung diese Woche überspringen</button>' : ''}
    </div>`;
  if (!S.runs.length) {
    return out + '<div class="empty">Noch keine Läufe.</div><button class="primary finish" data-a="new-run">Lauf erfassen</button>';
  }
  const chrono = hist.slice().reverse();
  const longs = chrono.filter((x) => x.run.runType === 'lang' && x.status !== 'incomplete');
  const pt = (x, y, info) => ({ t: tOf(dayOf(x.run.date)), y, estimated: x.status === 'red' || x.status === 'red2', info });
  out += `<h2>Lange Läufe</h2><div class="chartbox">${lineChart([{
    id: 'long', label: 'Lange Läufe', color: 1,
    points: longs.map((x) => pt(x, x.run.distanceKm, formatDate(dayOf(x.run.date)) + ' · ' + runLine(x.run) + ' · ' + RUN_STATUS[x.status][2])),
  }], { height: 180, unit: '', goal: { y: st.goalKm, label: 'Ziel ' + formatKm(st.goalKm) }, fmt: (v) => fmtNum(v) + ' km', directLabels: false })}
    <div class="chart-info">Hohle Punkte = rote Läufe (Knie).</div></div>`;
  const withHr = chrono.filter((x) => x.run.avgHr);
  if (withHr.length) {
    const small = (label, key, fmt) => `<div class="chartbox" style="margin-top:8px"><div class="small muted" style="padding-left:8px">${label}</div>
      ${lineChart([{ id: key, label, color: key === 'pace' ? 3 : 7, points: withHr.map((x) => {
        const y = key === 'pace' ? paceSec(x.run) : x.run.avgHr;
        return pt(x, y, formatDate(dayOf(x.run.date)) + ' · ' + label + ' ' + fmt(y));
      }) }], { height: 130, unit: '', zero: false, fmt, directLabels: false })}<div class="chart-info"></div></div>`;
    out += '<h2>Pace und Puls (gleiche Pace bei sinkendem Puls = mehr Ausdauer)</h2>'
      + small('Pace (min/km)', 'pace', (v) => formatDuration(v)) + small('Puls Ø (bpm)', 'hr', (v) => String(Math.round(v)));
  }
  out += '<h2>Alle Läufe</h2><div class="list">' + hist.map((x) => `<button class="row" data-a="edit-run" data-id="${x.run.id}">
      <div class="main"><div class="title">${h(formatDate(dayOf(x.run.date)))} · ${h(x.run.runType)}</div>
      <div class="sub">${h(runLine(x.run))}</div></div><span class="trend">${chip(RUN_STATUS[x.status])}</span></button>`).join('') + '</div>';
  out += '<button class="primary finish" data-a="new-run">Lauf erfassen</button>';
  return out;
}

const RUN_SETTING_DEFS = {
  baseKm: ['Basiswert ohne Läufe in 30 Tagen', (v) => formatKm(v)],
  maxIncrease: ['Maximale Steigerung pro langem Lauf', (v) => fmtNum(Math.round(v * 1000) / 10) + ' %'],
  painLimit: ['Schmerzgrenze Knie (darüber = Rot)', (v) => v + ' von 10'],
  paceHintSec: ['Pace-Hinweis bei schneller als', (v) => formatDuration(v) + ' min/km'],
  hrMax: ['Puls-Obergrenze für lockere Läufe', (v) => (v ? v + ' bpm' : 'aus')],
  goalKm: ['Zieldistanz', (v) => formatKm(v)],
};

function runSettingRows() {
  const st = runSettings();
  return Object.entries(RUN_SETTING_DEFS).map(([k, [label, fmt]]) => `<button class="row" data-a="run-setting" data-k="${k}">
    <div class="main"><div class="title">${h(label)}</div></div><span class="badge">${h(fmt(st[k]))}</span></button>`).join('');
}

// ---------- Satz erfassen ----------
function openExercise(id) {
  const ex = exById(id);
  const gym = currentGym();
  const pref = S.meta.get('unitPref:' + id + '|' + gym.id);
  log = { exerciseId: id, ...prefill(isBodyweight(ex) ? { ...ex, defaultUnit: 'kg' } : ex, gymScope(ex), S.sessions, S.sets, isBodyweight(ex) ? 'kg' : pref) };
  // Neues Gym ohne Historie: Startgewicht aus der Umrechnung vorschlagen, falls eine eingetragen ist.
  const cal = S.calibrations.find((c) => c.exerciseId === id && c.gymId === gym.id);
  if (cal && pref === undefined && log.weight == null) log.unit = cal.unit;
  if (log.unit && log.weight == null) {
    const series = seriesOf(ex);
    const override = S.meta.get('step:' + id + '|' + gym.id + '|' + log.unit) || null;
    const step = resolveStep(override, null, log.unit, settings());
    const sug = suggestStartWeight(series, gym.id, log.unit, S.calibrations, id, { reps: settings().lowerReps, step });
    if (sug) { log.weight = sug.weight; log.fromFactor = sug.reps; }
  }
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
  // Ganz nach unten: letzter Satz und Rückmeldung stehen dann direkt über dem (hohen) Panel.
  window.scrollTo(0, document.documentElement.scrollHeight);
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
  // Leeres Training nicht stehen lassen (ein Lauf darin zählt als Inhalt).
  if (!setsOf(set.sessionId).length && !runsOf(set.sessionId).length) {
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
  const bw = isBodyweight(exById(set.exerciseId));
  openSheet(`<h3>Satz ${set.order} bearbeiten</h3>
    <label class="field"><span>${bw ? 'Zusatz in kg (leer = nur Körpergewicht, negativ = Unterstützung)' : 'Gewicht'}</span><input id="fWeight" inputmode="${bw ? 'text' : 'decimal'}" value="${set.weight == null ? '' : String(set.weight).replace('.', ',')}"></label>
    ${bw ? '' : `<div class="field"><span>Einheit</span>${unitButtons(set.unit)}</div>`}
    <label class="field"><span>Reps</span><input id="fReps" inputmode="numeric" value="${set.reps}"></label>
    <div class="field"><span>Reserve (RIR): Wiederholungen, die noch gegangen wären. Optional.</span>
      <div class="seg" id="rirSeg">${[['', '–'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']].map(([v, l]) =>
    `<button type="button" data-a="sheet-rir" data-v="${v}" class="${String(set.rir == null ? '' : set.rir) === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="btns"><button class="danger" data-a="del-set" data-id="${set.id}">Löschen</button>
      <button data-a="close">Abbrechen</button><button class="primary" data-a="save-set" data-id="${set.id}">Speichern</button></div>`);
  sheet.dataset.unit = bw ? 'kg' : set.unit || '';
  sheet.dataset.rir = set.rir == null ? '' : String(set.rir);
}

// Mit Vorzeichen, für Zusatzlast bei Körpergewicht (negativ = Unterstützung).
const parseSigned = (v) => {
  const n = parseFloat(String(v).replace(',', '.').replace('−', '-'));
  return Number.isFinite(n) ? n : null;
};

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
  return {
    gyms: S.gyms, exercises: S.exercises, sessions: S.sessions, sets: S.sets, meta: metaArray(),
    calibrations: S.calibrations, runs: S.runs,
  };
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
  'open-ex': (d) => ((exById(d.id) || {}).kind === 'run' ? openRunForm(null, 'home') : openExercise(d.id)),
  'pick-db': async (d) => {
    const mine = S.exercises.find((x) => x.dbId === d.id);
    if (mine) return openExercise(mine.id);
    const e = (await loadExerciseDb()).find((x) => x.id === d.id);
    const body = e.equipment === 'body only';
    createExercise({
      name: e.name, dbId: e.id, muscleGroup: e.muscle, defaultUnit: body ? 'kg' : unitForEquipment(e.equipment),
      ...(body ? { kind: 'bodyweight', bodyShare: defaultBodyShare(e.name) } : {}),
    });
  },
  'own-ex': () => {
    sheet.dataset.muscle = '';
    sheet.dataset.unit = 'kg';
    openSheet(`<h3>Eigene Übung</h3>
      <label class="field"><span>Name</span><input id="fText" value="${h(view.q)}" autocomplete="off"></label>
      <div class="field"><span>Einheit</span>${unitButtons('kg')}</div>
      <label class="check"><input type="checkbox" id="fBody"><span>Körpergewichtsübung (Klimmzug, Dip, Liegestütz)</span></label>
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
    const body = $('#fBody').checked;
    closeSheet();
    createExercise({
      name, muscleGroup: sheet.dataset.muscle, defaultUnit: body ? 'kg' : sheet.dataset.unit || null,
      ...(body ? { kind: 'bodyweight', bodyShare: defaultBodyShare(name) } : {}),
    });
  },
  'edit-ex': () => {
    const ex = exById(log.exerciseId);
    const used = S.sets.some((s) => s.exerciseId === ex.id);
    sheet.dataset.muscle = ex.muscleGroup || '';
    openSheet(`<h3>Übung bearbeiten</h3>
      <label class="field"><span>Name</span><input id="fText" value="${h(ex.name)}" autocomplete="off"></label>
      <label class="check"><input type="checkbox" id="fBody" ${isBodyweight(ex) ? 'checked' : ''}><span>Körpergewichtsübung (Gewicht = Körpergewicht + Zusatz)</span></label>
      <label class="field"><span>Anteil des Körpergewichts (Klimmzug 1, Dip 0,95, Liegestütz 0,65)</span>
        <input id="fShare" inputmode="decimal" value="${fmtNum(ex.bodyShare || defaultBodyShare(ex.name))}"></label>
      <div class="field"><span>Muskelgruppe</span>${muscleButtons(ex.muscleGroup)}</div>
      <label class="field"><span>Zweite Muskelgruppe (zählt halb in Region und Balance)</span>
        <select id="fSecond"><option value="">keine</option>${Object.entries(MUSCLES).map(([k, l]) =>
    `<option value="${k}" ${secondaryOf(ex) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="btns">${used ? '' : '<button class="danger" data-a="del-ex">Löschen</button>'}
        <button data-a="close">Abbrechen</button><button class="primary" data-a="save-ex">Speichern</button></div>`);
  },
  'save-ex': async () => {
    const ex = exById(log.exerciseId);
    const name = $('#fText').value.trim();
    if (!name) return;
    ex.name = name;
    ex.muscleGroup = sheet.dataset.muscle || ex.muscleGroup;
    ex.muscleGroup2 = $('#fSecond').value || null;
    const wasBody = isBodyweight(ex);
    if ($('#fBody').checked) {
      ex.kind = 'bodyweight';
      ex.bodyShare = parseNum($('#fShare').value) || 1;
      ex.defaultUnit = 'kg';
    } else if (wasBody) {
      delete ex.kind;
    }
    await db.put('exercises', ex);
    closeSheet();
    if (wasBody !== isBodyweight(ex)) openExercise(ex.id); else render();
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
  step: (d) => {
    const min = isBodyweight(exById(log.exerciseId)) ? -Infinity : 0;
    log.weight = stepWeight(log.weight, log.unit, Number(d.d), stepInfo().step, min);
    render();
  },
  'type-weight': () => {
    const info = stepInfo();
    const auto = info.history ? 'aus Verlauf: ' + fmtNum(info.history) : 'Standard: ' + fmtNum(stepSize(log.unit, settings()));
    const ex = exById(log.exerciseId);
    const bw = isBodyweight(ex);
    // Erweiterte Einstellung: 1 kg ist überall 1 kg (Kurzhantel, Langhantel). Gilt für die ganze Übung.
    const same = !bw && log.unit === 'kg' ? `<label class="check"><input type="checkbox" id="fSame" ${ex.sameEverywhere ? 'checked' : ''}>
        <span>Gewicht überall gleich (z. B. Kurzhantel): 1 kg zählt in jedem Gym gleich, Vergleich über alle Gyms</span></label>` : '';
    openSheet(`<h3>${bw ? 'Zusatz in kg (negativ = Unterstützung)' : 'Gewicht (' + (log.unit === 'stufe' ? 'Stufe' : 'kg') + ')'}</h3>
      <label class="field"><input id="fWeight" inputmode="${bw ? 'text' : 'decimal'}" value="${log.weight == null ? '' : fmtNum(log.weight)}"></label>
      <label class="field"><span>Schritt für +/- bei dieser Übung in diesem Gym (leer = automatisch, ${h(auto)})</span>
        <input id="fStep" inputmode="decimal" value="${info.override ? fmtNum(info.override) : ''}" placeholder="${h(fmtNum(info.history || stepSize(log.unit, settings())))}"></label>
      ${same}
      <div class="btns"><button data-a="close">Abbrechen</button><button class="primary" data-a="save-weight">Übernehmen</button></div>`);
    setTimeout(() => $('#fWeight').select(), 50);
  },
  'save-weight': async () => {
    const ex = exById(log.exerciseId);
    log.weight = (isBodyweight(ex) ? parseSigned : parseNum)($('#fWeight').value);
    const step = parseNum($('#fStep').value);
    await setMeta(stepKey(), step || null);
    if ($('#fSame') && $('#fSame').checked !== !!ex.sameEverywhere) {
      ex.sameEverywhere = $('#fSame').checked;
      await db.put('exercises', ex);
    }
    closeSheet();
    render();
  },
  unit: async (d) => {
    const unit = d.u || null;
    const gym = currentGym();
    await setMeta('unitPref:' + log.exerciseId + '|' + gym.id, unit);
    const ex = exById(log.exerciseId);
    log = { exerciseId: log.exerciseId, ...prefill(ex, gymScope(ex), S.sessions, S.sets, unit) };
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
  'sheet-rir': (d, el) => {
    sheet.dataset.rir = d.v;
    document.querySelectorAll('#rirSeg button').forEach((b) => b.classList.toggle('on', b === el));
  },
  'quick-rir': async (d) => {
    const set = S.sets.find((s) => s.id === d.id);
    set.rir = set.rir === Number(d.v) ? null : Number(d.v);
    await db.put('sets', set);
    render();
  },
  'add-bw': () => {
    const cur = bodyWeightAt(bodyWeights(), todayISO());
    openSheet(`<h3>Körpergewicht heute (kg)</h3>
      <label class="field"><input id="fBw" inputmode="decimal" value="${cur ? fmtNum(cur) : ''}"></label>
      <div class="btns"><button data-a="close">Abbrechen</button><button class="primary" data-a="save-bw">Speichern</button></div>`);
    setTimeout(() => $('#fBw').select(), 50);
  },
  'save-bw': async () => {
    const kg = parseNum($('#fBw').value);
    if (!kg) { toast('Ungültiger Wert'); return; }
    const today = todayISO();
    await setMeta('bodyWeights', bodyWeights().filter((e) => e.date !== today).concat({ date: today, kg }));
    closeSheet();
    render();
  },
  'del-bw': async (d) => {
    if (!confirm('Eintrag löschen?')) return;
    await setMeta('bodyWeights', bodyWeights().filter((e) => e.date !== d.date));
    render();
  },
  'ex-metric': (d) => { chartState.exMetric = d.v; render(); },
  'save-set': async (d) => {
    const set = S.sets.find((s) => s.id === d.id);
    const reps = parseNum($('#fReps').value);
    if (reps == null) { toast('Reps fehlen'); return; }
    const unit = sheet.dataset.unit || null;
    const parse = isBodyweight(exById(set.exerciseId)) ? parseSigned : parseNum;
    const weight = unit ? parse($('#fWeight').value) : null;
    const rir = sheet.dataset.rir === '' || sheet.dataset.rir === undefined ? null : Number(sheet.dataset.rir);
    Object.assign(set, { reps: Math.round(reps), weight, unit: weight == null ? null : unit, rir });
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
  finish: async () => {
    const session = todaySession();
    if (!session) return;
    session.finishedAt = Date.now();
    await db.put('sessions', session);
    stopTimer();
    view = { name: 'summary', id: session.id };
    render();
    window.scrollTo(0, 0);
  },
  'show-summary': (d) => { view = { name: 'summary', id: d.id }; render(); window.scrollTo(0, 0); },
  reopen: async (d) => {
    const session = S.sessions.find((s) => s.id === d.id);
    if (!session) return;
    // Ein inzwischen neu begonnenes Training am selben Tag/Gym hat Vorrang; dann nicht wieder öffnen.
    const other = todaySession();
    if (other && other.id !== session.id) { toast('Es läuft schon ein neues Training'); return; }
    delete session.finishedAt;
    await db.put('sessions', session);
    if (session.gymId !== currentGym().id) await setMeta('lastGymId', session.gymId);
    A.home();
  },
  'open-stats': (d) => { view = { name: 'exstats', id: d.id }; render(); window.scrollTo(0, 0); },
  'chart-mode': (d) => { chartState.mode = d.v; render(); },
  'chart-range': (d) => { chartState.range = d.v; render(); },
  'chart-toggle': (d) => {
    if (chartState.hidden.has(d.id)) chartState.hidden.delete(d.id); else chartState.hidden.add(d.id);
    render();
  },
  'chart-pt': (d, el) => {
    const info = el.closest('.chartbox').querySelector('.chart-info');
    if (info) info.textContent = d.info;
  },
  'edit-cal': (d) => calSheet(d.gym, d.unit),
  'set-ref': async (d) => {
    if (!confirm('Bezugsgerät wechseln? Die Kurve dieser Übung wird neu berechnet.')) return;
    await setMeta('refMachines', { ...refMachines(), [view.id]: d.m });
    render();
  },
  'nudge-off': async (d) => {
    await setMeta('nudgeHighReps', [...(S.meta.get('nudgeHighReps') || []), d.id]);
    render();
  },
  'add-cal': () => {
    openSheet(`<h3>Umrechnung für Gym</h3>
      <label class="field"><span>Gym</span><select id="fGym">${sortedGyms().map((g) => `<option value="${g.id}">${h(g.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Einheit dort</span><select id="fUnit"><option value="stufe">Stufe</option><option value="kg">kg</option></select></label>
      <div class="btns"><button data-a="close">Abbrechen</button><button class="primary" data-a="add-cal-next">Weiter</button></div>`);
  },
  'add-cal-next': () => calSheet($('#fGym').value, $('#fUnit').value),
  'save-cal': async () => {
    const exId = view.id;
    const { gym, unit } = sheet.dataset;
    const id = calibrationId(exId, gym, unit);
    const factor = $('#fFactor') ? parseNum($('#fFactor').value) : null;
    const kg = $('#fKg') ? parseNum($('#fKg').value) : null;
    const baseKg = $('#fBaseKg') && $('#fBaseKg').value.trim() !== '' ? parseNum($('#fBaseKg').value) : null;
    S.calibrations = S.calibrations.filter((c) => c.id !== id);
    if (factor || kg) {
      const cal = {
        id, exerciseId: exId, gymId: gym, unit, factorToHome: factor || null, kgPerUnit: kg || null,
        baseKg: kg ? baseKg : null, source: 'manuell',
      };
      S.calibrations.push(cal);
      await db.put('calibrations', cal);
    } else {
      await db.write([{ store: 'calibrations', del: id }]);
    }
    closeSheet();
    render();
  },
  'delete-session': async () => {
    if (!confirm('Ganzes Training löschen?')) return;
    const id = view.id;
    const ops = setsOf(id).map((s) => ({ store: 'sets', del: s.id }));
    ops.push({ store: 'sessions', del: id });
    // Läufe bleiben erhalten (eigene Lauf-Historie), sie verlieren nur die Zuordnung zum Training.
    runsOf(id).forEach((r) => { r.sessionId = null; ops.push({ store: 'runs', put: r }); });
    S.sets = S.sets.filter((s) => s.sessionId !== id);
    S.sessions = S.sessions.filter((s) => s.id !== id);
    await db.write(ops);
    A.tab({ view: 'sessions' });
  },

  // ----- Lauf -----
  area: (d) => { chartState.area = d.v; render(); },
  'new-run': () => openRunForm(null, view.name === 'sessions' ? 'sessions' : 'home'),
  'edit-run': (d) => {
    const back = ['sessions', 'session'].includes(view.name) ? view.name : 'home';
    const backSession = view.name === 'session' ? view.id : null;
    openRunForm(S.runs.find((r) => r.id === d.id), back);
    rf.backSession = backSession;
  },
  'run-back': () => {
    if (rf.back === 'sessions') { view = { name: 'sessions' }; chartState.area = 'lauf'; render(); return; }
    if (rf.back === 'session' && rf.backSession) { view = { name: 'session', id: rf.backSession }; render(); return; }
    A.home();
  },
  'run-km': (d) => { rf.distanceKm = Math.max(0.1, Math.round((rf.distanceKm + Number(d.d) * 0.1) * 10) / 10); render(); },
  'run-km-type': () => {
    openSheet(`<h3>Distanz (km)</h3>
      <label class="field"><input id="fKm" inputmode="decimal" value="${fmtNum(rf.distanceKm)}"></label>
      <div class="btns"><button data-a="close">Abbrechen</button><button class="primary" data-a="save-km">Übernehmen</button></div>`);
    setTimeout(() => $('#fKm').select(), 50);
  },
  'save-km': () => {
    const km = parseNum($('#fKm').value);
    if (km) rf.distanceKm = Math.round(km * 100) / 100;
    closeSheet();
    render();
  },
  'run-knee': (d) => { rf.knee = Number(d.v); render(); },
  'run-type': (d) => { rf.runType = d.v; rf.typeTouched = true; render(); },
  'run-surface': (d) => { rf.surface = d.v; render(); },
  'run-morning': (d) => { rf.kneeMorning = d.v || null; render(); },
  'run-more': () => { rf.more = !rf.more; render(); },
  'run-save': async () => {
    if (!rfValid()) return;
    const existing = rf.id ? S.runs.find((r) => r.id === rf.id) : null;
    const date = rf.date || nowLocal();
    let sessionId = existing ? existing.sessionId : null;
    // Ein neuer Lauf von heute gehört zum Training des Tages (erscheint unter "Heute" und in der Zusammenfassung).
    if (!existing && dayOf(date) === todayISO()) sessionId = (await ensureSession()).id;
    const run = makeRun({
      id: rf.id, date, distanceKm: rf.distanceKm, durationSec: rfDuration(), kneeDuring: rf.knee,
      kneeMorning: rf.kneeMorning, runType: rf.runType, surface: rf.surface, avgHr: rf.avgHr, maxHr: rf.maxHr,
      cadenceSpm: rf.cadence, note: rf.note, sessionId,
      externalId: existing ? existing.externalId : null, morningSkipped: existing ? existing.morningSkipped : false,
    }, existing ? existing.source : 'manual', uid);
    S.runs = S.runs.filter((r) => r.id !== run.id).concat(run);
    await db.put('runs', run);
    view = { name: 'runresult', id: run.id };
    render();
    window.scrollTo(0, 0);
  },
  'run-delete': async () => {
    if (!confirm('Lauf löschen?')) return;
    const run = S.runs.find((r) => r.id === rf.id);
    S.runs = S.runs.filter((r) => r.id !== rf.id);
    const ops = [{ store: 'runs', del: rf.id }];
    // Ein Training, das nur aus diesem Lauf bestand, nicht leer stehen lassen.
    if (run && run.sessionId && !setsOf(run.sessionId).length && !runsOf(run.sessionId).length) {
      S.sessions = S.sessions.filter((s) => s.id !== run.sessionId);
      ops.push({ store: 'sessions', del: run.sessionId });
    }
    await db.write(ops);
    A['run-back']();
  },
  morning: async (d) => {
    const run = S.runs.find((r) => r.id === d.id);
    if (!run) return;
    run.kneeMorning = d.v;
    await db.put('runs', run);
    if (d.v === 'schlechter') toast('Lauf nachträglich rot. Neues Soll: ' + formatKm(runPlan(S.runs, nowLocal(), runSettings(), runOpts()).sollLong));
    render();
  },
  'morning-skip': async (d) => {
    const run = S.runs.find((r) => r.id === d.id);
    if (!run) return;
    run.morningSkipped = true;
    await db.put('runs', run);
    render();
  },
  'skip-deload': async () => { await setMeta('runDeloadSkip', weekKey(todayISO())); render(); },
  'run-setting': (d) => {
    const st = runSettings();
    const [label] = RUN_SETTING_DEFS[d.k];
    const value = d.k === 'maxIncrease' ? fmtNum(Math.round(st[d.k] * 1000) / 10)
      : d.k === 'paceHintSec' ? formatDuration(st[d.k]) : st[d.k] == null ? '' : fmtNum(st[d.k]);
    const hint = { maxIncrease: 'in %', paceHintSec: 'min:s, z. B. 6:30', hrMax: 'bpm, leer = aus', painLimit: '0 bis 10' }[d.k] || 'km';
    sheet.dataset.k = d.k;
    openSheet(`<h3>${h(label)}</h3>
      <label class="field"><span>${h(hint)}</span><input id="fRunSetting" inputmode="${d.k === 'paceHintSec' ? 'text' : 'decimal'}" value="${h(value)}"></label>
      <div class="btns"><button data-a="close">Abbrechen</button><button class="primary" data-a="save-run-setting">Speichern</button></div>`);
    setTimeout(() => $('#fRunSetting').select(), 50);
  },
  'save-run-setting': async () => {
    const k = sheet.dataset.k;
    const raw = $('#fRunSetting').value.trim();
    let v;
    if (k === 'paceHintSec') v = parseDuration(raw);
    else if (k === 'hrMax') v = raw ? parseNum(raw) : null;
    else if (k === 'maxIncrease') v = parseNum(raw) == null ? null : parseNum(raw) / 100;
    else if (k === 'painLimit') v = parseNum(raw) == null ? null : Math.min(10, Math.round(parseNum(raw)));
    else v = parseNum(raw);
    if (v == null && k !== 'hrMax') { toast('Ungültiger Wert'); return; }
    await setMeta('runSettings', { ...(S.meta.get('runSettings') || {}), [k]: v });
    closeSheet();
    render();
  },
  'export-runs-csv': () => shareFile('satz-laeufe-' + todayISO() + '.csv', runsToCSV(exportData()), 'text/csv'),

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

// Lauf-Formular: Felder ohne Neuaufbau mitschreiben (sonst springt die Tastatur weg).
const RF_FIELDS = { rfMin: 'min', rfSec: 'sec', rfAvgHr: 'avgHr', rfMaxHr: 'maxHr', rfCadence: 'cadence', rfNote: 'note' };

app.addEventListener('input', (e) => {
  if (e.target.id === 'q') renderResults();
  const field = RF_FIELDS[e.target.id];
  if (!field || !rf) return;
  rf[field] = e.target.value;
  const pace = $('#rfPace');
  if (pace) pace.textContent = rfPaceText();
  const save = $('#rfSave');
  if (save) save.disabled = !rfValid();
});

app.addEventListener('change', async (e) => {
  if (e.target.id === 'rfDate' && rf) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.target.value)) rf.date = e.target.value.slice(0, 16);
    return;
  }
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
