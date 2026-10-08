// Eco-Line Coach - screens, routing and report rendering.
import { t, setLang, getLang, num } from './i18n.js';
import { analyzeSession, SECTORS, KART, TRACK_LENGTH, project } from './analysis.js';
import { TRACK } from './track.js';
import { Recorder } from './recorder.js';
import * as store from './storage.js';
import { SAMPLE_SESSION } from './sample.js';
import { trackMap, mapLegend, speedChart, trackOutline } from './charts.js';

const app = document.getElementById('app');
let recorder = null;
let liveTimer = null;
const analysisCache = new Map();
// Official track length published by Baku City Karting (shown to drivers). The analysis itself
// uses the measured centreline in track.js, which is shorter because it follows the traced layout.
const OFFICIAL_LENGTH_M = 802;
document.documentElement.lang = getLang();

// ---------- tiny DOM helper (text is always set via textContent) ----------
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;            // only used for our own static SVG icons
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const ICON = {
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15"/><path d="M5 19c3-4 6-6 9-7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 4 4-7 5 5"/><path d="M3 21h18"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  pouch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h16v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M4 8l2-4h12l2 4"/><path d="M9 12h6"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4"/></svg>',
  fuel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16"/><path d="M3 21h13M7 8h5"/><path d="M15 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3"/></svg>',
  wifi: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><path d="M12 19h.01"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  leafG: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15"/><path d="M5 19c3-4 6-6 9-7"/></svg>',
};
const icon = (name, cls) => h('span', { class: cls, html: ICON[name], 'aria-hidden': 'true' });

function topbar({ back } = {}) {
  const langs = h('div', { class: 'lang', role: 'group', 'aria-label': 'Language' },
    ...['az', 'en', 'ru'].map(l => h('button', { 'aria-pressed': String(getLang() === l), onclick: () => { setLang(l); render(); } }, l.toUpperCase())));
  const brand = h('a', { class: 'brand', href: '#home' }, h('span', { class: 'brand-mark', html: ICON.leaf }), t('appName'));
  return h('div', { class: 'topbar' }, brand, langs);
}
const fmtS = (s) => `${num(s, 1)} ${t('unitS')}`;
const AZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
const fmtDate = (ms) => {
  const d = new Date(ms);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (getLang() === 'az') return `${d.getDate()} ${AZ_MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hm}`;   // browsers often lack AZ month names
  return d.toLocaleString(getLang() === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// ---------- routing ----------
function parseHash() {
  const [name, arg] = location.hash.replace(/^#/, '').split('/');
  return { name: name || 'home', arg: arg ? decodeURIComponent(arg) : null };
}
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
window.addEventListener('hashchange', render);

function render() {
  const r = parseHash();
  if (r.name !== 'rec' && r.name !== 'setup' && recorder && recorder.state !== 'finished') { recorder.cancel(); recorder = null; }
  document.body.classList.toggle('recording', r.name === 'rec');
  window.scrollTo(0, 0);
  if (r.name === 'setup') return renderSetup();
  if (r.name === 'rec') return recorder ? renderRec() : go('#home');
  if (r.name === 'report') return renderReport(r.arg);
  if (r.name === 'history') return renderHistory();
  return renderHome();
}

// ---------- home ----------
async function renderHome() {
  const unfinishedBox = h('div');
  const hero = trackOutline('hero');
  app.replaceChildren(
    h('section', { class: 'hero' },
      topbar(),
      h('div', { class: 'chips' },
        h('span', { class: 'chip' }, h('span', { class: 'live' }), TRACK.name),
        h('span', { class: 'chip' }, t('trackFacts', { len: OFFICIAL_LENGTH_M, turns: TRACK.corners.length }))),
      h('h1', {}, t('tagline')),
      h('p', { class: 'lead' }, t('heroLead')),
      h('div', { class: 'hero-track' }, hero.svg),
      h('button', { class: 'btn hero-cta', onclick: startFlow }, h('span', { class: 'play', html: ICON.play }), t('startSession'))),
    unfinishedBox,
    h('div', { class: 'tiles' },
      h('button', { class: 'tile', onclick: () => go('#report/demo') },
        h('span', { class: 'ic', html: ICON.chart }), h('b', {}, t('demoTile')), h('span', { class: 's' }, t('demoTileSub'))),
      h('button', { class: 'tile', onclick: () => go('#history') },
        h('span', { class: 'ic', html: ICON.history }), h('b', {}, t('historyTile')), h('span', { class: 's' }, t('historyTileSub')))),
    h('div', { class: 'card' },
      cardHead('bulb', t('howTitle')),
      h('div', { class: 'how' },
        howStep('phone', t('how1')), howStep('pouch', t('how2')), howStep('flag', t('how3')))),
    h('div', { class: 'card stack' },
      h('div', { class: 'note' }, icon('shield'), h('span', {}, t('safety'))),
      h('div', { class: 'note' }, icon('lock'), h('span', {}, t('privacy'))),
      h('div', { class: 'note' }, icon('wifi'), h('span', {}, t('installHint')))));
  try {
    const list = await store.listSessions();
    const open = list.find(s => s.status === 'recording' && s.nPoints > 20);
    if (open) unfinishedBox.replaceChildren(h('div', { class: 'card stack' },
      h('strong', {}, t('unfinished')), h('div', { class: 'muted small' }, fmtDate(open.startedAt)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: async () => { const s = await store.getSession(open.id); s.status = 'finished'; await store.saveSession(s); go('#report/' + open.id); } }, t('analyzeIt')),
        h('button', { class: 'btn danger', onclick: async () => { await store.deleteSession(open.id); render(); } }, t('discard')))));
  } catch (e) { /* storage unavailable: ignore */ }
}
const cardHead = (ic, title, sub) => h('div', { class: 'card-head' }, h('span', { class: 'ic', html: ICON[ic] }), h('h2', {}, title), sub ? h('span', { class: 'sub' }, sub) : null);
const howStep = (ic, text) => h('div', { class: 'how-step' }, h('span', { class: 'n', html: ICON[ic] }), h('p', {}, text));
const stepper = (active) => h('div', { class: 'stepper', 'aria-hidden': 'true' },
  ...[t('stepReady'), t('stepDrive'), t('stepReport')].map((s, i) => h('div', { class: i <= active ? 'on' : '' }, h('i'), h('span', {}, s))));

async function startFlow() {
  // Must run inside the tap: iOS only shows the motion prompt from a user gesture.
  const motionAllowed = await Recorder.requestMotionPermission();
  recorder = new Recorder();
  recorder.motionAllowed = motionAllowed;
  recorder.requestWakeLock();
  go('#setup');
}

// ---------- setup / pre-flight checks ----------
function renderSetup() {
  if (!recorder) recorder = new Recorder();
  const gps = checkRow(t('checkGps'), t('gpsWaiting'), 'pending');
  const motion = checkRow(t('checkMotion'), '…', 'pending');
  const screen = checkRow(t('checkScreen'), '…', 'pending');
  const place = checkRow(t('checkPlace'), t('placeText'), 'ok');
  const kart = h('input', { class: 'text', id: 'kart', inputmode: 'numeric', maxlength: 4, autocomplete: 'off', placeholder: '#' });
  const ready = h('button', { class: 'btn primary', disabled: true, onclick: beginRecording }, h('span', { html: ICON.play, style: 'display:grid' }), t('readyBtn'));
  const anyway = h('button', { class: 'btn ghost', style: 'display:none', onclick: beginRecording }, t('startAnyway'));
  function beginRecording() {
    recorder.requestWakeLock();
    recorder.arm({ kart: kart.value.trim() });
    go('#rec');
  }
  app.replaceChildren(topbar(), stepper(0), h('h1', {}, t('setupTitle')),
    h('div', { class: 'card' }, gps.row, motion.row, screen.row, place.row),
    h('div', { class: 'card' }, h('label', { class: 'field', for: 'kart' }, t('kartNumber')), kart),
    h('div', { class: 'stack' }, ready, anyway,
      h('button', { class: 'btn ghost', onclick: () => { recorder.cancel(); recorder = null; go('#home'); } }, t('back'))));

  recorder.onFix = (f, err) => {
    if (err) {
      gps.set(err.code === 1 ? 'bad' : 'warn', err.code === 1 ? t('gpsDenied') : t('gpsWaiting'));
      return;
    }
    const acc = f.accuracy;
    if (acc != null && acc <= 20) { gps.set('ok', t('gpsGood', { m: Math.round(acc) })); ready.disabled = false; }
    else { gps.set('warn', t('gpsWeak', { m: acc == null ? '?' : Math.round(acc) })); }
  };
  recorder.onWakeLock = (ok) => screen.set(ok ? 'ok' : 'warn', ok ? t('screenOk') : t('screenNo'));
  recorder.onMotion = () => motion.set('ok', t('motionOk'));
  if (!recorder.startGps()) gps.set('bad', t('gpsUnsupported'));
  if (recorder.motionAllowed !== false) recorder.startMotion();
  setTimeout(() => { if (motion.state === 'pending') motion.set('warn', t('motionOff')); }, 2500);
  if (recorder.wakeLock) screen.set('ok', t('screenOk'));
  else recorder.requestWakeLock();
  setTimeout(() => { anyway.style.display = ready.disabled ? '' : 'none'; }, 45000);
}

function checkRow(label, detail, state) {
  const dot = h('span', { class: 'dot' });
  const det = h('div', { class: 'detail' }, detail);
  const row = h('div', { class: 'check' }, dot, h('div', {}, h('div', { class: 'label' }, label), det));
  const obj = {
    row, state,
    set(s, d) {
      obj.state = s; row.className = 'check ' + s;
      dot.innerHTML = s === 'ok' ? ICON.check : s === 'warn' ? ICON.warn : s === 'bad' ? ICON.cross : ICON.dots;
      det.textContent = d;
    },
  };
  obj.set(state, detail);
  return obj;
}

// ---------- recording ----------
function renderRec() {
  const statusTxt = h('span', {}, t('recWaiting'));
  const pulse = h('span', { class: 'pulse waiting' });
  const speed = h('div', { class: 'big' }, '0');
  const lapsB = h('b', {}, '0'), timeB = h('b', {}, '0:00'), accB = h('b', {}, '–');
  const alert = h('div', { class: 'alert', role: 'status' });
  const mini = trackOutline('mini');
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ring.setAttribute('viewBox', '0 0 128 128');
  ring.innerHTML = '<circle cx="64" cy="64" r="62"></circle>';
  const hold = h('button', { class: 'hold', 'aria-label': t('holdToStop') }, ring, t('holdToStop'));
  const ui = h('div', { class: 'rec' },
    h('div', { style: 'width:100%' }, h('div', { class: 'status' }, pulse, statusTxt), h('div', { class: 'mini' }, mini.svg)),
    h('div', {}, speed, h('div', { class: 'unit' }, t('speedUnit')),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, lapsB, h('span', {}, t('laps'))),
        h('div', { class: 'stat' }, timeB, h('span', {}, t('time'))),
        h('div', { class: 'stat' }, accB, h('span', {}, 'GPS ±m'))),
      alert),
    h('div', {}, hold, h('p', { class: 'foot' }, t('locked') + '. ' + t('autoStopNote'))));
  app.replaceChildren(ui);
  ui.addEventListener('click', (e) => { if (!hold.contains(e.target)) e.preventDefault(); }, true);
  ui.addEventListener('contextmenu', (e) => e.preventDefault());

  let lastFixT = Date.now();
  recorder.onFix = (f) => {
    if (!f) return;
    lastFixT = Date.now();
    speed.textContent = f.speed != null ? Math.round(f.speed * 3.6) : '–';
    accB.textContent = f.accuracy != null ? Math.round(f.accuracy) : '–';
    const [x, y] = project(f.lat, f.lon); mini.setPos(x, y);
  };
  recorder.onState = (s) => {
    if (s === 'recording') { statusTxt.textContent = t('recOn'); pulse.className = 'pulse'; }
    if (s === 'finished') finishUi();
  };
  clearInterval(liveTimer);
  let tick = 0;
  liveTimer = setInterval(() => {
    const s = recorder && recorder.session;
    if (!s) return;
    // use GPS timestamps on both sides: some phones report GPS time that differs from the system clock
    if (s.recordingFrom && recorder.lastFix) timeB.textContent = fmtDur(Math.max(0, recorder.lastFix[0] - s.recordingFrom) / 1000);
    alert.textContent = Date.now() - lastFixT > 5000 ? t('gpsLost') : '';
    if (++tick % 10 === 0 && s.recordingFrom && s.points.length > 30) {
      try { lapsB.textContent = String(analyzeSession(s).laps.length); } catch (e) { /* ignore */ }
    }
  }, 1000);

  let holdStart = null, raf = null;
  const circle = ring.querySelector('circle');
  const step = () => {
    const p = Math.min(1, (Date.now() - holdStart) / 2000);
    circle.style.strokeDashoffset = String(390 * (1 - p));
    if (p >= 1) { holdStart = null; recorder.finish('manual'); return; }
    raf = requestAnimationFrame(step);
  };
  circle.style.strokeDasharray = '390'; circle.style.strokeDashoffset = '390';
  const down = (e) => { e.preventDefault(); holdStart = Date.now(); raf = requestAnimationFrame(step); };
  const up = () => { holdStart = null; cancelAnimationFrame(raf); circle.style.strokeDashoffset = '390'; };
  hold.addEventListener('pointerdown', down);
  hold.addEventListener('pointerup', up);
  hold.addEventListener('pointerleave', up);
  hold.addEventListener('pointercancel', up);

  async function finishUi() {
    clearInterval(liveTimer);
    const s = recorder.session;
    app.replaceChildren(h('div', { class: 'done' }, h('div', {}, t('collectPhone'), h('div', { class: 'spinner', style: 'border-color:rgba(255,255,255,.2);border-top-color:#fff' }), h('div', { style: 'font-size:16px;font-weight:500;font-family:var(--font)' }, t('analyzing')))));
    await new Promise(r => setTimeout(r, 1800));
    recorder = null;
    go('#report/' + s.id);
  }
}

// ---------- report ----------
async function loadSession(id) {
  if (id === 'demo') return { ...SAMPLE_SESSION, demo: true };
  return store.getSession(id);
}
function getAnalysis(session) {
  if (!analysisCache.has(session.id)) analysisCache.set(session.id, analyzeSession(session));
  return analysisCache.get(session.id);
}
function gauge(value, label, color) {
  const r = 34, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  const svg = `<svg viewBox="0 0 84 84" role="img" aria-label="${label}: ${Math.round(v)}/100">
    <circle class="track" cx="42" cy="42" r="${r}" fill="none" stroke-width="7"/>
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 42 42)"/>
    <text class="val" x="42" y="49" text-anchor="middle">${Math.round(v)}</text></svg>`;
  return h('div', { class: 'gauge' }, h('div', { html: svg }), h('div', { class: 'lab' }, label));
}

async function renderReport(id) {
  app.replaceChildren(topbar(), h('div', { class: 'spinner' }), h('p', { class: 'center muted' }, t('analyzing')));
  const session = await loadSession(id);
  if (!session) return go('#home');
  await new Promise(r => setTimeout(r, 30));
  const a = getAnalysis(session);
  if (!session.demo && a.ok && !session.summary) {
    session.summary = { laps: a.validLaps, best: a.best ? a.best.time : null };
    store.saveSession(session).catch(() => {});
  }
  const valid = a.ok ? a.laps.filter(l => l.valid) : [];
  const metaLine = `${fmtDate(session.startedAt)}` + (session.kart ? ` · ${t('kart')} #${session.kart}` : '');
  const parts = [];

  if (!valid.length) {
    parts.push(h('section', { class: 'hero report-hero' }, topbar(),
      h('h1', {}, t('reportTitle'), session.demo ? h('span', { class: 'badge' }, t('demoBadge')) : null),
      h('p', { class: 'meta-line' }, metaLine)),
    h('div', { class: 'card' }, h('p', { style: 'margin:0' }, t('noLaps'))));
  } else {
    const best = a.best;
    const avg = (f) => valid.reduce((s, l) => s + f(l), 0) / valid.length;
    const fuelMl = avg(l => l.fuelMl), co2 = avg(l => l.co2G), eco = avg(l => l.ecoScore);
    parts.push(h('section', { class: 'hero report-hero' }, topbar(),
      h('h1', {}, t('reportTitle'), session.demo ? h('span', { class: 'badge' }, t('demoBadge')) : null),
      h('p', { class: 'meta-line' }, `${TRACK.name} · ${metaLine}`),
      h('div', { class: 'best' },
        h('div', {}, h('div', { class: 'k' }, t('bestLap')),
          h('div', { class: 'v' }, num(best.time, 1), h('small', {}, t('unitS'))),
          h('div', { class: 'd' }, t('offFastest', { d: num(best.time - a.ref.idealTime, 1) }))),
        h('div', { class: 'gauges' }, gauge(eco, t('ecoScore'), '#4fd395'), gauge(best.paceScore, t('paceScore'), '#8fc1ff')))));
    parts.push(h('div', { class: 'kpis' },
      kpi(t('lapsDone'), String(valid.length), a.laps.length > valid.length ? `/ ${a.laps.length}` : ''),
      kpi(t('fuelPerLap'), num(fuelMl, 1), t('unitMl')),
      kpi(t('co2PerLap'), num(co2, 0), t('unitG'))),
      h('p', { class: 'score-help' }, t('scoresHelp', { t: num(a.ref.idealTime, 1) })));

    // tips
    const tipsList = h('ol', { class: 'tips' });
    if (!a.tips.length) tipsList.append(h('li', { class: 'tip' }, t('noTips')));
    for (const tip of a.tips) {
      const isTime = tip.key === 'tipUseWidth';
      tipsList.append(h('li', { class: 'tip' },
        h('div', { class: 'tip-top' }, h('span', { class: 'sector-chip' }, 'S' + tip.sector),
          h('span', { class: 'tip-kind' }, isTime ? t('kindTime') : t('kindFuel')),
          h('span', { class: 'tip-delta' }, isTime ? `+${num(tip.dt, 1)} ${t('unitS')}` : `+${num(tip.g, 1)} ${t('unitG')}`)),
        h('div', {}, t(tip.key, { sector: tip.sector, from: tip.from, to: tip.to,
          v: tip.v != null ? Math.round(tip.v) : '', ve: tip.ve != null ? Math.round(tip.ve) : '',
          g: tip.g != null ? num(tip.g, 1) : '', dt: tip.dt != null ? num(tip.dt, 1) : '' }))));
    }
    const ecoMl = a.ref.ecoFuelMl;
    const savingPct = (fuelMl - ecoMl) / fuelMl * 100;
    const co2Saved = (fuelMl - ecoMl) * KART.density * KART.co2PerKg * (600 / a.meanLap);
    parts.push(h('div', { class: 'card' }, cardHead('bulb', t('tipsTitle')), tipsList,
      savingPct > 1 ? h('div', { class: 'saving' }, h('span', { html: ICON.leafG, style: 'display:grid' }), h('span', {}, t('ecoSaving', { pct: num(savingPct, 0), co2: num(co2Saved, 0) }))) : null));

    const map = trackMap(best);
    parts.push(h('div', { class: 'card' }, cardHead('map', t('mapTitle'), fmtS(best.time)), h('div', { class: 'chart' }, map), mapLegend(map)));
    parts.push(h('div', { class: 'card' }, cardHead('chart', t('chartTitle')), speedChart(best)));

    const secRows = SECTORS.map((z, j) => {
      const tl = avg(l => l.sectors[j].time) - valid[0].sectors[j].idealTime;
      const fx = avg(l => l.sectors[j].fuelG) - valid[0].sectors[j].ecoFuelG;
      return h('tr', {}, h('td', {}, h('span', { class: 'pill' }, 'S' + z.id)), h('td', {}, z.corners.length > 1 ? `${z.corners[0]}–${z.corners[z.corners.length - 1]}` : String(z.corners[0])),
        h('td', { class: tl > 0.05 ? 'delta-pos' : 'delta-neg' }, (tl >= 0 ? '+' : '') + num(tl, 1) + ' ' + t('unitS')),
        h('td', { class: fx > 0.02 ? 'delta-pos' : 'delta-neg' }, (fx >= 0 ? '+' : '') + num(fx, 2) + ' ' + t('unitG')));
    });
    parts.push(h('div', { class: 'card' }, cardHead('flag', t('sectorTable')),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, t('colSector')), h('th', {}, t('colTurns')), h('th', {}, t('colTimeLoss')), h('th', {}, t('colFuelExtra')))),
        h('tbody', {}, ...secRows)))));
  }

  if (a.ok && a.laps.length) {
    parts.push(h('div', { class: 'card' }, cardHead('clock', t('lapTable')),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, t('colLap')), h('th', {}, t('colTime')), h('th', {}, t('colFuel')), h('th', {}, t('colEco')))),
        h('tbody', {}, ...a.laps.map(l => h('tr', { class: (a.best && l === a.best ? 'best' : '') + (l.valid ? '' : ' invalid') },
          h('td', {}, String(l.n) + (a.best && l === a.best ? ' ★' : '')),
          h('td', {}, fmtS(l.time) + (l.valid ? '' : ` (${t('invalidLap')})`)),
          h('td', {}, num(l.fuelMl, 1)), h('td', {}, h('span', { class: 'pill' }, num(l.ecoScore, 0))))))))));
  }

  if (a.ok) parts.push(h('div', { class: 'card' }, cardHead('fuel', t('sessionTotals')),
    h('table', {}, h('tbody', {},
      h('tr', {}, h('td', {}, t('duration')), h('td', {}, `${fmtDur(a.session.durationS)} ${t('unitMin')}`)),
      h('tr', {}, h('td', {}, t('fuelTotal')), h('td', {}, `${num(a.session.fuelL * 1000, 0)} ${t('unitMl')}`)),
      h('tr', {}, h('td', {}, t('co2Total')), h('td', {}, `${num(a.session.co2G, 0)} ${t('unitG')}`))))));

  const delBtn = h('button', { class: 'btn danger' }, t('deleteSession'));
  let armed = false;
  delBtn.addEventListener('click', async () => {
    if (!armed) { armed = true; delBtn.textContent = t('confirmDelete'); setTimeout(() => { armed = false; delBtn.textContent = t('deleteSession'); }, 3000); return; }
    await store.deleteSession(session.id); analysisCache.delete(session.id); go('#history');
  });
  parts.push(h('div', { class: 'btn-row', style: 'margin-top:14px' },
    h('button', { class: 'btn', onclick: () => downloadCsv(session) }, h('span', { html: ICON.download, style: 'display:grid' }), t('exportCsv')),
    h('button', { class: 'btn', onclick: () => downloadGpx(session) }, h('span', { html: ICON.download, style: 'display:grid' }), t('exportGpx'))),
  h('div', { class: 'btn-row', style: 'margin-top:10px' },
    session.demo ? null : delBtn,
    h('button', { class: 'btn primary', onclick: () => go('#home') }, t('home'))),
  h('p', { class: 'footer-note' }, t('disclaimer')));
  app.replaceChildren(...parts);
}

function kpi(label, value, unit) {
  return h('div', { class: 'kpi' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value, unit ? h('small', {}, unit) : null));
}

// ---------- history ----------
async function renderHistory() {
  const list = await store.listSessions().catch(() => []);
  const items = list.filter(s => s.status === 'finished').map(s =>
    h('a', { class: 'list-item', href: '#report/' + encodeURIComponent(s.id) },
      h('div', {}, h('div', { class: 'when' }, fmtDate(s.startedAt)),
        h('div', { class: 'meta' }, (s.kart ? `${t('kart')} #${s.kart} · ` : '') + (s.summary ? `${t('lapsDone')}: ${s.summary.laps}` : `${s.nPoints} GPS`))),
      s.summary && s.summary.best ? h('span', { class: 'lapbig' }, fmtS(s.summary.best)) : null,
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  app.replaceChildren(topbar(), h('h1', {}, t('mySessions')),
    h('div', { class: 'card' }, ...(items.length ? items : [h('div', { class: 'empty' }, h('div', { html: ICON.history }), h('p', {}, t('emptyHistory')))])),
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary', onclick: startFlow }, h('span', { html: ICON.play, style: 'display:grid' }), t('startSession')),
      h('button', { class: 'btn ghost', onclick: () => go('#home') }, t('home'))));
}

// ---------- export ----------
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function stamp(s) { return new Date(s.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-'); }
function downloadCsv(s) {
  const rows = ['time_iso,lat,lon,accuracy_m,speed_mps'];
  for (const p of s.points) rows.push([new Date(p[0]).toISOString(), p[1], p[2], p[3] ?? '', p[4] ?? ''].join(','));
  download(`ecoline-${stamp(s)}.csv`, rows.join('\n'), 'text/csv');
}
function downloadGpx(s) {
  const pts = s.points.map(p => `<trkpt lat="${p[1]}" lon="${p[2]}"><time>${new Date(p[0]).toISOString()}</time></trkpt>`).join('\n');
  download(`ecoline-${stamp(s)}.gpx`, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Eco-Line Coach" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${TRACK.name}</name><trkseg>\n${pts}\n</trkseg></trk></gpx>`, 'application/gpx+xml');
}

// ---------- offline support ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
