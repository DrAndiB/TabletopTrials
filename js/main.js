// Boot, menus, The Trials flow (intro → event → results → medal table → closing) and the main loop.
import { GameRenderer } from './render.js';
import { Perf } from './perf.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { EVENTS, SOON, eventById, eventIcon } from './events/index.js';
import { SIZES, SIZE_ORDER } from './sizes.js';
import { COUNTRIES, DEFAULTS, countryByCode } from './data/countries.js';
import { flagURL } from './flags.js';
import { paintedFlagCanvas } from './props.js';
import { recordFor, offerRecord } from './records.js';
import { rng } from './util.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const SETTINGS_KEY = 'tabletop-trials.settings.v1';
const TYPES = ['keys', 'touch', 'cpu', 'off'];
const TYPE_LABEL = { keys: 'Keyboard', touch: 'Touch', cpu: 'Computer kid', off: 'Not playing' };
const SEAT = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
const SEAT_COLORS = ['#e23b2e', '#2f6fe0', '#f2c230', '#2fae5a'];
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
const MEDAL = ['gold', 'silver', 'bronze'];

const touchFirst = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
const defaults = {
  mode: 'trials', event: EVENTS[0].id, trials: EVENTS.map((e) => e.id), skill: 'normal', quality: 'auto', fps: 60,
  teams: DEFAULTS.map((code, i) => ({ type: i === 0 ? (touchFirst ? 'touch' : 'keys') : 'cpu', code })),
};
let settings = loadSettings();
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (s && Array.isArray(s.teams) && s.teams.length === 4) {
      const out = { ...defaults, ...s };
      out.teams = s.teams.map((t, i) => ({ type: TYPES.includes(t.type) ? t.type : 'cpu', code: countryByCode(t.code).code || DEFAULTS[i], size: SIZE_ORDER.includes(t.size) ? t.size : 'big' }));
      if (!['trials', 'single'].includes(out.mode)) out.mode = 'trials';
      if (!EVENTS.some((e) => e.id === out.event)) out.event = EVENTS[0].id;
      out.trials = Array.isArray(s.trials) ? s.trials.filter((id) => EVENTS.some((e) => e.id === id)) : EVENTS.map((e) => e.id);
      if (!out.trials.length) out.trials = EVENTS.map((e) => e.id);
      return out;
    }
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(defaults));
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } }

// ---------- engine ----------
const canvas = $('#game');
let quality = params.get('quality') || settings.quality;
const R = new GameRenderer(canvas, quality === 'auto' ? 'medium' : quality);
if (quality === 'auto') R.setQuality(Perf.autoTier(R));
const input = new Input();
const sound = new Sound();
const hud = new Hud($('#hud'));
const game = new Game(R, input, sound, hud);
const perf = new Perf(R, { onTierChange: (q) => R.setQuality(q) });
perf.setAuto(quality === 'auto');
perf.cap = params.get('fps') ? params.get('fps') !== 'max' : settings.fps !== 'max';
if (params.get('debug')) perf.toggleOverlay(true);
window.__tt = { game, R, input, sound, perf, settings: () => settings };

let screen = 'title';
let lastT = performance.now();
let warming = false;
let run = null;   // { events: [ids], index, competitors, tally: {slot: [g, s, b]}, last }

function showScreen(name) {
  screen = name;
  if (name !== 'none' && perf.shouldHint()) $('#gpu-hint').hidden = false;
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('active', el.id === 'screen-' + name);
  document.body.dataset.screen = name;
  if (['title', 'setup', 'country', 'keys'].includes(name)) sound.startMusic(); else sound.stopMusic();
  $('#touch').classList.toggle('show', name === 'none' && game.competitors?.some((c) => c.type === 'touch'));
}

// ---------- teams ----------
function teamName(i) {
  const t = settings.teams[i];
  const name = countryByCode(t.code).name;
  const same = settings.teams.slice(0, i).filter((o) => o.type !== 'off' && o.code === t.code).length;
  return same ? `${name} ${same + 1}` : name;
}
function teamSeed(i) { const c = settings.teams[i].code; return (c.charCodeAt(0) * 31 + c.charCodeAt(1)) * 7 + i * 3 + 1; }
function competitorsFromTeams() {
  const list = [];
  settings.teams.forEach((t, i) => {
    if (t.type === 'off') return;
    const c = countryByCode(t.code);
    list.push({ slot: i, type: t.type, size: t.type === 'cpu' ? 'big' : (t.size || 'big'), code: c.code, name: teamName(i), short: teamName(i), paint: c.paint, seed: teamSeed(i), number: i + 1, color: SEAT_COLORS[i], flag: flagURL(c.code, 72) });
  });
  return list;
}

function keyHint(i, t) {
  const b = input.bindings[i];
  const k = (c) => `<kbd>${input.keyLabel(c)}</kbd>`;
  if (t.type === 'keys') return `${k(b.left)} ${k(b.right)} ${k(b.action)}`;
  if (t.type === 'touch') return 'On-screen pads: ◀ ● ▶';
  if (t.type === 'cpu') return 'Plays by itself';
  return 'Sits this one out';
}

function renderSetup() {
  const list = $('#team-list');
  list.innerHTML = '';
  settings.teams.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'team' + (t.type === 'off' ? ' off' : '');
    card.style.borderLeft = `10px solid ${SEAT_COLORS[i]}`;
    card.innerHTML = `<span class="pnum">${SEAT[i]}</span>
      <button class="team-flag" style="background-image:url(${flagURL(t.code, 152)})" aria-label="Change country for ${SEAT[i]} (now ${teamName(i)})"></button>
      <span class="team-name">${teamName(i)}</span>
      <button class="team-type" aria-label="Change who plays for ${SEAT[i]}">${TYPE_LABEL[t.type]}<span class="cyc">⟳</span></button>
      <span class="team-hint">${keyHint(i, t)}</span>
      ${t.type === 'keys' || t.type === 'touch' ? `<div class="team-size seg" role="group" aria-label="Player size">${SIZE_ORDER.map((k) => `<button data-size="${k}" class="${(t.size || 'big') === k ? 'on' : ''}" title="${SIZES[k].ages}">${SIZES[k].label} <small>${SIZES[k].ages}</small></button>`).join('')}</div>` : ''}`;
    card.querySelector('.team-flag').onclick = () => { sound.click(); openCountry(i); };
    for (const b of card.querySelectorAll('.team-size button')) b.onclick = () => { sound.click(); t.size = b.dataset.size; saveSettings(); renderSetup(); };
    card.querySelector('.team-type').onclick = () => {
      sound.click();
      t.type = TYPES[(TYPES.indexOf(t.type) + 1) % TYPES.length];
      if (settings.teams.every((o) => o.type === 'off')) t.type = 'keys';
      saveSettings(); renderSetup();
    };
    list.appendChild(card);
  });
  $('#kbd-warn').hidden = settings.teams.filter((t) => t.type === 'keys').length < 3;
  // events
  const el = $('#event-list');
  el.innerHTML = '';
  const trials = settings.mode === 'trials';
  for (const ev of EVENTS) {
    const b = document.createElement('button');
    const rec = recordFor(ev.id);
    const inT = settings.trials.includes(ev.id);
    b.className = 'event-card' + (!trials && settings.event === ev.id ? ' selected' : '') + (trials ? (inT ? ' in-trials' : ' out') : '');
    b.innerHTML = `${eventIcon(ev.id)}<span class="ev-name">${ev.name}</span><span class="ev-tag">${ev.season}</span>${rec ? `<span class="rec" title="House record: ${rec.name}">${rec.text}</span>` : ''}`;
    b.title = `${ev.name}: ${ev.blurb}`;
    // in The Trials a tap adds or removes the event; in One event it picks it
    b.onclick = () => {
      sound.click();
      if (settings.mode === 'trials') {
        const on = settings.trials.includes(ev.id);
        if (on && settings.trials.length > 1) settings.trials = settings.trials.filter((id) => id !== ev.id);
        else if (!on) settings.trials = EVENTS.map((e) => e.id).filter((id) => id === ev.id || settings.trials.includes(id));
      } else settings.event = ev.id;
      saveSettings(); renderSetup();
    };
    el.appendChild(b);
  }
  for (const ev of SOON) {
    const b = document.createElement('div');
    b.className = 'event-card soon';
    b.innerHTML = `${eventIcon(ev.icon)}<span class="ev-name">${ev.name}</span><span class="ev-tag">Coming soon</span>`;
    el.appendChild(b);
  }
  const picked = trialsEvents();
  $('#mode-help').textContent = trials
    ? `The Trials: ${picked.length} event${picked.length > 1 ? 's' : ''}, about ${Math.max(2, Math.round(picked.length * 2.5))} minutes. Tap an event to add or take it out. Medals in every event, and the medal table crowns the champions.`
    : `One event: ${eventById(settings.event).name}. ${eventById(settings.event).blurb}`;
  $('#trials-pick').hidden = !trials;
  const preset = (ids) => ids.length === picked.length && ids.every((id) => picked.includes(id));
  for (const b of document.querySelectorAll('#trials-pick button')) b.classList.toggle('on', b.dataset.pick !== 'quick' && preset(presetIds(b.dataset.pick)));
  for (const b of document.querySelectorAll('[data-opt]')) b.classList.toggle('on', String(settings[b.dataset.opt]) === b.dataset.val);
}

for (const el of document.querySelectorAll('[data-opt]')) {
  el.addEventListener('click', () => {
    sound.click();
    const k = el.dataset.opt, v = el.dataset.val;
    settings[k] = v;
    if (k === 'quality') applyQuality(v);
    saveSettings(); renderSetup();
  });
}
// The Trials: the picked events, in the order of the list (summer first, then winter)
function trialsEvents() { return EVENTS.map((e) => e.id).filter((id) => settings.trials.includes(id)); }
function presetIds(kind) {
  if (kind === 'summer' || kind === 'winter') return EVENTS.filter((e) => e.season.toLowerCase() === kind).map((e) => e.id);
  if (kind === 'quick') {
    // two summer and two winter events, picked at random
    const pick = (season) => EVENTS.filter((e) => e.season === season).map((e) => e.id).sort(() => Math.random() - 0.5).slice(0, 2);
    return [...pick('Summer'), ...pick('Winter')];
  }
  return EVENTS.map((e) => e.id);
}
for (const b of document.querySelectorAll('#trials-pick button')) {
  b.addEventListener('click', () => { sound.click(); settings.trials = presetIds(b.dataset.pick); saveSettings(); renderSetup(); });
}

function applyQuality(q) {
  quality = q;
  if (q === 'auto') Perf.forgetTier();
  R.setRenderScale(1);
  R.setQuality(q === 'auto' ? Perf.autoTier(R) : q);
  perf.setAuto(q === 'auto');
}

// ---------- country picker ----------
let picking = { slot: 0, code: 'LU' };
function openCountry(slot) {
  picking = { slot, code: settings.teams[slot].code };
  $('#country-title').textContent = `${SEAT[slot]}: pick a country`;
  const grid = $('#country-grid');
  grid.innerHTML = '';
  for (const c of COUNTRIES) {
    const b = document.createElement('button');
    b.className = 'country';
    b.dataset.code = c.code;
    b.setAttribute('role', 'option');
    b.innerHTML = `<img src="${flagURL(c.code, 96)}" alt=""><span>${c.name}</span>`;
    b.onclick = () => { selectCountry(c.code, true); };
    b.ondblclick = () => confirmCountry();
    grid.appendChild(b);
  }
  showScreen('country');
  selectCountry(picking.code, false);
}
function selectCountry(code, withSound) {
  picking.code = code;
  for (const b of document.querySelectorAll('.country')) {
    const on = b.dataset.code === code;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
    if (on) b.scrollIntoView({ block: 'nearest' });
  }
  const c = countryByCode(code);
  const card = $('#flag-card');
  const fc = paintedFlagCanvas(code, 520, { seed: 3 });
  fc.className = 'fc-flag';
  card.innerHTML = '';
  card.appendChild(fc);
  card.insertAdjacentHTML('beforeend', `<h4>${c.name}</h4><p class="fc-cap">Capital: <b>${c.capital}</b></p><p class="fc-fact">${c.fact}</p>
    <div class="fc-paint">Team colours <i style="background:${c.paint.shirt}"></i><i style="background:${c.paint.shorts}"></i><i style="background:${c.paint.trim}"></i></div>`);
  if (withSound) { sound.ensure(); sound.jingle(code.charCodeAt(0) * 13 + code.charCodeAt(1)); }
}
function confirmCountry() {
  sound.pick();
  settings.teams[picking.slot].code = picking.code;
  saveSettings();
  showScreen('setup'); renderSetup();
}
function moveCountry(dx, dy) {
  const btns = [...document.querySelectorAll('.country')];
  const i = btns.findIndex((b) => b.dataset.code === picking.code);
  const cols = Math.max(1, Math.round($('#country-grid').clientWidth / (btns[0].offsetWidth + 8)));
  const j = Math.max(0, Math.min(btns.length - 1, i + dx + dy * cols));
  selectCountry(btns[j].dataset.code, false);
}

// ---------- keys ----------
const BLABEL = { left: 'Left', right: 'Right', action: 'Action' };
function renderKeys() {
  const box = $('#keys-grid');
  box.innerHTML = '';
  SEAT.forEach((name, i) => {
    const b = input.bindings[i];
    const col = document.createElement('div');
    col.className = 'key-col';
    col.style.borderTop = `10px solid ${SEAT_COLORS[i]}`;
    col.innerHTML = `<h3>${name}</h3>`;
    for (const act of ['left', 'right', 'action']) {
      const row = document.createElement('button');
      row.className = 'key-row';
      row.innerHTML = `<span>${BLABEL[act]}</span><kbd>${input.keyLabel(b[act])}</kbd>`;
      row.onclick = () => {
        row.classList.add('listening');
        row.querySelector('kbd').textContent = 'press a key…';
        input.capture = (code) => {
          if (code !== 'Escape') {
            for (const bb of input.bindings) for (const kk of Object.keys(bb)) if (bb[kk] === code) bb[kk] = b[act];
            b[act] = code;
            input.saveBindings();
          }
          renderKeys();
        };
      };
      col.appendChild(row);
    }
    box.appendChild(col);
  });
}
let keysBack = 'title';

// ---------- loading card with a flag fact ----------
let quizI = Math.floor(Math.random() * COUNTRIES.length);
function showLoading(text) {
  $('#loading-text').textContent = text;
  const c = COUNTRIES[quizI++ % COUNTRIES.length];
  $('#loading-quiz').innerHTML = `<img src="${flagURL(c.code, 60)}" alt="">This is the flag of <b>${c.name}</b>. Its capital is ${c.capital}.`;
  $('#loading').classList.add('show');
}
async function warmUp() {
  warming = true;
  try { await R.warmUp(); } catch (e) { console.warn('warm-up skipped', e); }
  $('#loading').classList.remove('show');
  warming = false;
  lastT = performance.now();
  perf.resetWindow();
}

// ---------- the run: The Trials or one event ----------
function startRun() {
  sound.ensure();
  const competitors = competitorsFromTeams();
  if (!competitors.length) return;
  const events = settings.mode === 'trials' ? trialsEvents() : [settings.event];
  run = { events, index: 0, competitors, tally: Object.fromEntries(competitors.map((c) => [c.slot, [0, 0, 0]])), seed: (Math.random() * 1e6) | 0 };
  loadEvent();
}

async function loadEvent() {
  const def = eventById(run.events[run.index]);
  hud.visible(false);
  showScreen('loading');
  showLoading(def.loading || `Setting up the ${def.name.toLowerCase()}…`);
  await new Promise((r) => setTimeout(r, 40));
  await game.load(def, run.competitors, { skill: settings.skill, seed: run.seed + run.index * 101 });
  await warmUp();
  showIntro(def);
}

function showIntro(def) {
  const n = run.events.length;
  $('#intro-kicker').textContent = n > 1 ? `The Trials · event ${run.index + 1} of ${n} · ${def.season}` : `${def.season} event`;
  $('#intro-title').textContent = def.name;
  $('#intro-venue').textContent = def.venue;
  // the helpers for Little and Kid players, when someone plays at that size
  const sizes = new Set(game.competitors.filter((c) => c.human).map((c) => c.size));
  const helps = ['little', 'kid'].filter((z) => sizes.has(z) && def.helpers?.[z]).map((z) => `<div class="how help"><span class="verb">${SIZES[z].label}</span><span>${def.helpers[z]}</span></div>`).join('');
  $('#intro-how').innerHTML = def.how.map((h) => `<div class="how"><span class="verb">${h.verb}</span><span>${h.text}</span></div>`).join('') + helps;
  const k = (c) => `<kbd>${input.keyLabel(c)}</kbd>`;
  $('#intro-players').innerHTML = game.competitors.filter((c) => c.human).map((c) => {
    const b = input.bindings[c.slot];
    const keys = c.type === 'touch' ? 'touch pads' : `${k(b.left)}${k(b.right)} ${k(b.action)}`;
    return `<span class="ip" style="border-color:${c.color}"><img src="${c.flag}" alt="">${c.name}: ${keys}</span>`;
  }).join('') || '<span class="small">Only computer kids this time: sit back and watch.</span>';
  showScreen('intro');
}

function goEvent() {
  if (screen !== 'intro') return;
  sound.click();
  showScreen('none');
  input.buildTouch($('#touch'), game.competitors.filter((c) => c.type === 'touch').map((c) => c.slot), SEAT_COLORS);
  $('#touch').classList.toggle('show', game.competitors.some((c) => c.type === 'touch'));
  game.start();
  lastT = performance.now();
}

// rank by value; equal values share a place
function rank(def, results) {
  const rows = results.map((r, i) => ({ ...r, i }));
  const key = (r) => (r.dnf || r.value == null ? Infinity : def.better === 'lower' ? r.value : -r.value);
  rows.sort((a, b) => key(a) - key(b));
  let place = 0, prev = null;
  rows.forEach((r, k) => { if (key(r) !== prev) place = k; r.place = r.dnf ? null : place; prev = key(r); });
  return rows;
}

game.onEventEnd = ({ def, results }) => {
  const rows = rank(def, results);
  // chocolate-coin medals for the top three places (shared places share the medal)
  for (const r of rows) {
    r.medal = r.place != null && r.place < 3 ? MEDAL[r.place] : null;
    if (r.medal) run.tally[run.competitors[r.i].slot][r.place]++;
  }
  // house record: the best human result, or any result if only computers played
  const best = rows.find((r) => r.place != null && (run.competitors[r.i].type !== 'cpu' || run.competitors.every((c) => c.type === 'cpu')));
  if (best) {
    const c = run.competitors[best.i];
    const res = offerRecord(def.id, { value: best.value, text: best.short || best.text, name: c.name, code: c.code }, def.better);
    // the very first result on this device only counts as a record worth a badge when it made the podium
    best.record = res === 'beat' || (res === 'first' && best.place < 3);
  }
  run.last = { def, rows };
  // the medal ceremony in the room, then the results
  const medallists = rows.filter((r) => r.medal).slice(0, 3).map((r, k) => ({ c: run.competitors[r.i], place: r.place, medal: r.medal, slot: k }));
  setTimeout(() => game.ceremony(medallists).then(showResults), (def.resultsDelay ?? 1.6) * 1000);
};

function coin(medal, cls = '') {
  const label = medal === 'gold' ? '1' : medal === 'silver' ? '2' : '3';
  return `<span class="coin ${cls} m-${medal}">${label}</span>`;
}

function showResults() {
  if (!run || !run.last) return;
  const { def, rows } = run.last;
  const C = run.competitors;
  hud.visible(false);
  $('#results-kicker').textContent = `${def.name} · results`;
  const winner = rows[0] && rows[0].place === 0 ? C[rows[0].i] : null;
  $('#results-title').textContent = winner ? `${winner.name} wins!` : 'Well tried!';
  const pod = $('#podium');
  pod.innerHTML = '';
  for (const k of [1, 0, 2]) {
    const r = rows.find((x) => x.place === k && x.medal) || (k === 0 ? rows[0] : null);
    if (!r || r.place == null || !r.medal) continue;
    const c = C[r.i];
    const el = document.createElement('div');
    el.className = `pod pod-${k + 1}`;
    el.innerHTML = `${coin(r.medal)}<img src="${c.flag}" alt=""><span class="pod-name">${c.name}</span><span class="pod-val">${r.text}</span><span class="pod-block">${k + 1}</span>`;
    el.querySelector('.coin').style.setProperty('--rib', c.paint.shirt);
    pod.appendChild(el);
  }
  const list = $('#results-list');
  list.innerHTML = '';
  rows.forEach((r) => {
    const c = C[r.i];
    const li = document.createElement('li');
    li.innerHTML = `<span class="pos">${r.place != null ? ORD[r.place] : '–'}</span><img src="${c.flag}" alt="">
      <span class="who">${c.name}${r.record ? '<span class="rec">House record!</span>' : ''}${r.sub ? `<small>${r.sub}</small>` : ''}</span>
      <span class="val">${r.dnf ? (r.text || 'out') : r.text}</span>`;
    list.appendChild(li);
  });
  if (rows.some((r) => r.record)) sound.newRecord();
  const trials = run.events.length > 1;
  const mt = $('#medal-table');
  mt.hidden = !trials;
  $('#screen-results .results-panel').classList.toggle('with-table', trials);
  if (trials) mt.innerHTML = medalTableHtml();
  const last = run.index >= run.events.length - 1;
  $('#btn-next').innerHTML = trials ? (last ? 'Medal ceremony <kbd>Enter</kbd>' : 'Next event <kbd>Enter</kbd>') : 'Again <kbd>Enter</kbd>';
  showScreen('results');
  if (winner) sound.jingle(winner.seed, true); else sound.clap();
}

function tallyRows() {
  return run.competitors.map((c) => ({ c, m: run.tally[c.slot] }))
    .sort((a, b) => b.m[0] - a.m[0] || b.m[1] - a.m[1] || b.m[2] - a.m[2] || a.c.slot - b.c.slot);
}
function medalTableHtml() {
  const rows = tallyRows();
  let place = 0;
  return `<div class="mt-row"><span></span><span></span><span>Team</span><span class="n">${coin('gold', 'small')}</span><span class="n">${coin('silver', 'small')}</span><span class="n">${coin('bronze', 'small')}</span></div>`
    + rows.map((r, k) => {
      if (k > 0 && (r.m[0] !== rows[k - 1].m[0] || r.m[1] !== rows[k - 1].m[1] || r.m[2] !== rows[k - 1].m[2])) place = k;
      return `<div class="mt-row${place === 0 && (r.m[0] + r.m[1] + r.m[2]) > 0 ? ' lead' : ''}"><span class="pos">${ORD[place]}</span><img src="${r.c.flag}" alt=""><span class="who">${r.c.name}</span><span class="n">${r.m[0]}</span><span class="n">${r.m[1]}</span><span class="n">${r.m[2]}</span></div>`;
    }).join('');
}

function nextFromResults() {
  if (screen !== 'results' || !run) return;
  sound.click();
  if (run.events.length === 1) { loadEvent(); return; }
  if (run.index < run.events.length - 1) { run.index++; loadEvent(); return; }
  showClosing();
}

const CUP_SVG = `<svg viewBox="0 0 110 120" width="110" height="120"><g stroke="#1f1a17" stroke-width="4" stroke-linejoin="round">
  <path d="M30 18h50c0 24-8 40-25 40S30 42 30 18z" fill="#ffc93c"/><path d="M38 24c0 14 5 24 13 28" fill="none" stroke="#fff3c4" stroke-width="5"/>
  <path d="M46 58h18l4 18H42z" fill="#e0a21a"/><path d="M28 76h54v12H28z" fill="#c49e6c"/><path d="M22 88h66v14H22z" fill="#a47a4a"/>
  <path d="M30 22c-14 0-16 18-2 22M80 22c14 0 16 18 2 22" fill="none"/></g>
  <text x="55" y="99" text-anchor="middle" font-family="Lilita One, Impact" font-size="11" fill="#fff4dc">CHAMPIONS</text></svg>`;

function showClosing() {
  const rows = tallyRows();
  const top = rows[0];
  $('#closing-cup').innerHTML = CUP_SVG;
  $('#closing-title').textContent = top && top.m[0] + top.m[1] + top.m[2] > 0 ? `${top.c.name} are champions!` : 'What a games!';
  $('#closing-table').innerHTML = medalTableHtml();
  showScreen('closing');
  confetti(top ? top.c.paint : null);
  sound.fanfare();
  if (top) setTimeout(() => sound.jingle(top.c.seed, true), 1500);
  setTimeout(() => sound.cheer(1.2), 300);
}
function confetti(paint) {
  const box = $('#confetti');
  box.innerHTML = '';
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cols = paint ? [paint.shirt, paint.shorts, paint.trim, '#ffc93c'] : ['#e23b2e', '#2f6fe0', '#ffc93c', '#2fae5a'];
  const r = rng(7);
  for (let i = 0; i < 90; i++) {
    const el = document.createElement('i');
    el.style.left = `${r() * 100}%`;
    el.style.background = cols[i % cols.length];
    el.style.animationDuration = `${2.5 + r() * 2.5}s`;
    el.style.animationDelay = `${r() * 1.5}s`;
    el.style.transform = `rotate(${r() * 360}deg)`;
    box.appendChild(el);
  }
}

async function toMenu() {
  run = null;
  hud.visible(false);
  $('#touch').classList.remove('show');
  showScreen('loading');
  showLoading('Back to the playroom…');
  await attract();
  showScreen('setup'); renderSetup();
}

async function attract() {
  const def = EVENTS[0];
  const comp = competitorsFromTeams();
  await game.load(def, comp.length ? comp : competitorsFromTeamsAll(), { skill: 'normal', attract: true, seed: 3 });
  await warmUp();
}
function competitorsFromTeamsAll() {
  return settings.teams.map((t, i) => { const c = countryByCode(t.code); return { slot: i, type: 'cpu', code: c.code, name: c.name, short: c.name, paint: c.paint, seed: teamSeed(i), number: i + 1, color: SEAT_COLORS[i], flag: flagURL(c.code, 72) }; });
}

function togglePause() {
  if (screen === 'pause') { game.pause(false); showScreen('none'); return; }
  if (screen === 'none' && game.pause(true)) showScreen('pause');
}

// ---------- buttons and keys ----------
$('#btn-play').onclick = () => { sound.ensure(); sound.click(); showScreen('setup'); renderSetup(); };
$('#btn-controls').onclick = () => { sound.click(); keysBack = 'title'; showScreen('keys'); renderKeys(); };
$('#btn-setup-keys').onclick = () => { sound.click(); keysBack = 'setup'; showScreen('keys'); renderKeys(); };
$('#btn-keys-back').onclick = () => { sound.click(); showScreen(keysBack); if (keysBack === 'setup') renderSetup(); };
$('#btn-keys-reset').onclick = () => { input.resetBindings(); renderKeys(); };
$('#btn-setup-back').onclick = () => { sound.click(); showScreen('title'); };
$('#btn-start').onclick = () => startRun();
$('#btn-country-back').onclick = () => { sound.click(); showScreen('setup'); renderSetup(); };
$('#btn-country-ok').onclick = () => confirmCountry();
$('#btn-intro-go').onclick = () => goEvent();
$('#btn-intro-quit').onclick = () => { sound.click(); toMenu(); };
$('#btn-resume').onclick = () => togglePause();
$('#btn-restart').onclick = () => { game.pause(false); loadEvent(); };
$('#btn-quit').onclick = () => { game.pause(false); toMenu(); };
$('#btn-next').onclick = () => nextFromResults();
$('#btn-results-menu').onclick = () => { sound.click(); toMenu(); };
$('#btn-closing-again').onclick = () => { sound.click(); startRun(); };
$('#btn-closing-menu').onclick = () => { sound.click(); toMenu(); };
$('#btn-sound').onclick = () => { sound.ensure(); sound.setMuted(!sound.muted); updateSoundBtn(); };
$('#btn-fs').onclick = () => toggleFullscreen();
$('#btn-pause').onclick = () => { sound.click(); togglePause(); };
$('#btn-gpu-hint').onclick = () => { sound.click(); perf.dismissHint(); $('#gpu-hint').hidden = true; };
function updateSoundBtn() { $('#btn-sound').textContent = sound.muted ? '🔇' : '🔊'; $('#btn-sound').setAttribute('aria-label', sound.muted ? 'Sound off' : 'Sound on'); }
updateSoundBtn();
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

input.on((type, e) => {
  if (type === 'layout') { if (screen === 'setup') renderSetup(); if (screen === 'keys') renderKeys(); return; }
  if (type !== 'keydown' || input.capture) return;
  const code = e.code;
  if (code === 'Escape' || code === 'KeyP') {
    if (screen === 'none' || screen === 'pause') togglePause();
    else if (code === 'Escape') {
      if (screen === 'setup') showScreen('title');
      else if (screen === 'country') $('#btn-country-back').click();
      else if (screen === 'keys') $('#btn-keys-back').click();
      else if (screen === 'intro' || screen === 'results' || screen === 'closing') toMenu();
    }
  }
  if (code === 'KeyF' && (screen === 'none' || screen === 'pause')) toggleFullscreen();
  if (code === 'F3') { e.preventDefault?.(); perf.toggleOverlay(); }
  if (screen === 'country') {
    if (code === 'ArrowLeft') moveCountry(-1, 0);
    if (code === 'ArrowRight') moveCountry(1, 0);
    if (code === 'ArrowUp') moveCountry(0, -1);
    if (code === 'ArrowDown') moveCountry(0, 1);
  }
  if (code === 'Enter' || code === 'NumpadEnter') {
    if (screen === 'title') $('#btn-play').click();
    else if (screen === 'setup') startRun();
    else if (screen === 'country') confirmCountry();
    else if (screen === 'intro') goEvent();
    else if (screen === 'results') nextFromResults();
    else if (screen === 'closing') startRun();
  }
});

window.addEventListener('resize', () => R.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden && screen === 'none') togglePause(); });

// ---------- main loop ----------
function frame(now) {
  requestAnimationFrame(frame);
  if (!perf.frameStart(now) || warming) return;
  const dtMs = now - lastT;
  const dt = Math.min(0.1, dtMs / 1000);
  lastT = now;
  // human presses carry real timestamps: map them onto the game clock
  game.clockOffset = now / 1000 - game.time - dt;
  game.update(dt);
  perf.frameDone(dtMs, screen === 'none' && game.state === 'running');
}

// ---------- boot ----------
(async function boot() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('16px Rubik')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch (e) { /* fonts optional */ }
  if (params.get('test') && !params.get('cine')) game.cinematics = false;
  if (params.get('autostart')) {
    // tests and quick checks: ?autostart=1&event=sprint&p=keys,cpu,cpu,cpu&mode=single
    if (params.get('p')) params.get('p').split(',').forEach((t, i) => { settings.teams[i].type = TYPES.includes(t) ? t : 'cpu'; });
    if (params.get('size')) params.get('size').split(',').forEach((z, i) => { if (settings.teams[i]) settings.teams[i].size = SIZE_ORDER.includes(z) ? z : 'big'; });
    if (params.get('event')) { settings.event = params.get('event'); settings.mode = 'single'; }
    if (params.get('mode')) settings.mode = params.get('mode');
    if (params.get('skill')) settings.skill = params.get('skill');
    const competitors = competitorsFromTeams();
    if (params.get('trials')) settings.trials = params.get('trials').split(',');
    run = { events: settings.mode === 'trials' ? trialsEvents() : [settings.event], index: 0, competitors, tally: Object.fromEntries(competitors.map((c) => [c.slot, [0, 0, 0]])), seed: +(params.get('seed') || 11) };
    const def = eventById(run.events[0]);
    await game.load(def, competitors, { skill: settings.skill, seed: run.seed });
    if (!params.get('test')) await warmUp();
    showScreen('none');
    game.start();
  } else {
    await attract();
    showScreen('title');
  }
  $('#boot').classList.add('done');
  if (params.get('test')) {
    // automated tests drive the clock themselves
    window.__tt.step = (sec = 0) => { const info = R.renderer.info; info.reset(); game.simulate(sec); R.render(); return { ...info.render, geometries: info.memory.geometries, textures: info.memory.textures }; };
    window.__tt.screen = () => screen;
    window.__tt.run = () => run;
    window.__tt.startRun = startRun;
    window.__tt.show = (name) => { if (name === 'setup') renderSetup(); if (name === 'country') { openCountry(0); return; } if (name === 'results' && run && run.last) { showResults(); return; } if (name === 'closing' && run) { showClosing(); return; } showScreen(name); };
    window.__tt.ready = true;
  } else requestAnimationFrame(frame);
})().catch((err) => {
  console.error(err);
  $('#boot').innerHTML = `<p>Sorry, the game could not start.<br><small>${String(err && err.message || err)}</small></p>`;
});
