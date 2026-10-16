// Bits the second-wave events share: the paper-card HUD (who is up and the standings), the guide box
// at the bottom (a tip and a few bars), labels pinned over things in the scene, and the start of a race
// (take your marks, hold action, let go on the whistle).
import * as THREE from '../../vendor/three.bundle.js';
import { clamp } from '../util.js';

export const ORD = ['1st', '2nd', '3rd', '4th'];

const CSS = `.ev-card{position:absolute;left:12px;top:12px;width:min(260px,42vw);background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17;padding:8px 10px;font:700 12px/1.25 Rubik,sans-serif;color:#1f1a17}
  .ev-card .who{display:flex;align-items:center;gap:7px;font:400 18px/1.1 "Lilita One",Impact,sans-serif}.ev-card .who img{height:20px;width:30px;object-fit:cover;border:2px solid #1f1a17;border-radius:3px}
  .ev-card .rd{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#4a413a;font-weight:800;margin-top:2px}
  .ev-card ol{list-style:none;margin:6px 0 0;padding:6px 0 0;border-top:2px dashed rgba(31,26,23,.25);display:grid;gap:2px}
  .ev-card li{display:grid;grid-template-columns:28px 22px 1fr auto;gap:5px;align-items:center;font-variant-numeric:tabular-nums}.ev-card li img{height:13px;width:20px;object-fit:cover;border-radius:2px}
  .ev-card li.me{background:#ffc93c;border-radius:6px}.ev-card li.out{opacity:.55}
  .ev-g{position:absolute;left:50%;bottom:calc(18px + var(--tb,0px));transform:translateX(-50%);width:min(400px,84vw);background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17;padding:6px 12px 8px;font:800 12px/1.2 Rubik,sans-serif;color:#1f1a17;text-align:center}
  .ev-g .tip:empty{display:none}
  .ev-g .row{display:grid;grid-template-columns:62px 1fr;gap:8px;align-items:center;margin-top:5px;text-align:left;color:#4a413a}
  .ev-g .bar{position:relative;height:12px;border:2px solid #1f1a17;border-radius:99px;background:#fff;overflow:hidden}
  .ev-g .bar i{position:absolute;inset:0 auto 0 0;width:0;background:#ef7d2c}.ev-g .bar.go i{background:#2fae5a}.ev-g .bar.low i{background:#e23b2e}
  .ev-g .bar u{position:absolute;top:0;bottom:0;background:#bfe6c7}
  .ev-g .bar b{position:absolute;top:0;bottom:0;width:4px;background:#1f1a17;margin-left:-2px}
  .ev-tag{position:absolute;transform:translate(-50%,-100%);pointer-events:none;font:400 15px/1 "Lilita One",Impact,sans-serif;color:#fff;-webkit-text-stroke:1.6px #1f1a17;paint-order:stroke fill;white-space:nowrap;text-align:center}
  .ev-tag .pill{display:inline-block;background:var(--tc,#ffc93c);color:#1f1a17;-webkit-text-stroke:0;border:2px solid #1f1a17;border-radius:99px;padding:3px 8px;font:800 11px/1 Rubik,sans-serif;text-transform:uppercase;letter-spacing:.05em}
  .ev-hidden{display:none !important}`;

export function hudKit(ctx) {
  const el = ctx.hud.el;
  const style = document.createElement('style');
  style.textContent = CSS;
  el.appendChild(style);
  const mk = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; el.appendChild(d); return d; };
  const touch = ctx.competitors.some((c) => c.type === 'touch');
  return { el, mk, touch };
}

// the top-left card: who is up, a line about the round, and the standings
export class Card {
  constructor(kit) {
    this.root = kit.mk('ev-card', '<div class="who"></div><div class="rd"></div><ol></ol>');
    this.who = this.root.querySelector('.who'); this.rd = this.root.querySelector('.rd'); this.ol = this.root.querySelector('ol');
  }
  // cur: competitor (or null), line: text, rows: [{ c, text, me, out }] already ranked
  set(cur, line, rows) {
    this.who.innerHTML = cur ? `<img src="${cur.flag}" alt=""><span>${cur.short}</span>` : '';
    this.who.style.display = cur ? '' : 'none';
    this.rd.textContent = line || '';
    this.ol.innerHTML = rows.map((x, k) => `<li class="${x.me ? 'me' : ''}${x.out ? ' out' : ''}"><span>${x.place ?? ORD[k]}</span><img src="${x.c.flag}" alt=""><span>${x.c.short}</span><b>${x.text}</b></li>`).join('');
    this.ol.style.display = rows.length ? '' : 'none';
  }
}

// the guide box at the bottom: a tip and named bars
export class Guide {
  constructor(kit, bars = []) {
    this.root = kit.mk('ev-g ev-hidden', `<div class="tip"></div>${bars.map((b) => `<div class="row" data-k="${b.key}"><span>${b.label}</span><div class="bar"><u></u><i></i><b></b></div></div>`).join('')}`);
    if (kit.touch) this.root.style.setProperty('--tb', '110px');
    this.tipEl = this.root.querySelector('.tip');
    this.bars = {};
    for (const b of bars) {
      const row = this.root.querySelector(`[data-k="${b.key}"]`);
      this.bars[b.key] = { row, bar: row.querySelector('.bar'), i: row.querySelector('i'), u: row.querySelector('u'), b: row.querySelector('b'), last: '' };
    }
    this.lastTip = null;
  }
  show(v) { this.root.classList.toggle('ev-hidden', !v); }
  tip(text) { if (text !== this.lastTip) { this.tipEl.textContent = text; this.lastTip = text; } }
  // value 0..1; opts: { go, low, mark (0..1 or null), zone [a, b] or null, hide }
  bar(key, value, opts = {}) {
    const B = this.bars[key];
    const s = `${value.toFixed(3)}|${opts.go}|${opts.low}|${opts.mark}|${opts.zone}|${opts.hide}`;
    if (s === B.last) return;
    B.last = s;
    B.row.style.display = opts.hide ? 'none' : '';
    B.i.style.width = `${(clamp(value, 0, 1) * 100).toFixed(1)}%`;
    B.bar.classList.toggle('go', !!opts.go);
    B.bar.classList.toggle('low', !!opts.low);
    B.b.style.display = opts.mark != null ? '' : 'none';
    if (opts.mark != null) B.b.style.left = `${(opts.mark * 100).toFixed(1)}%`;
    B.u.style.display = opts.zone ? '' : 'none';
    if (opts.zone) { B.u.style.left = `${(opts.zone[0] * 100).toFixed(1)}%`; B.u.style.width = `${((opts.zone[1] - opts.zone[0]) * 100).toFixed(1)}%`; }
  }
}

// labels pinned to points in the scene (badges over racers, points over a landing)
export class Tags {
  constructor(kit, R) { this.layer = kit.mk('ev-tags'); this.R = R; this.items = new Map(); this.v = new THREE.Vector3(); }
  set(key, html, color) {
    let it = this.items.get(key);
    if (!it) { const d = document.createElement('div'); d.className = 'ev-tag'; this.layer.appendChild(d); it = { d, html: null }; this.items.set(key, it); }
    if (it.html !== html) { it.d.innerHTML = html; it.html = html; }
    if (color) it.d.style.setProperty('--tc', color);
    return it;
  }
  hide(key) { const it = this.items.get(key); if (it) it.d.style.display = 'none'; }
  clear() { for (const it of this.items.values()) it.d.remove(); this.items.clear(); }
  place(key, x, y, z) {
    const it = this.items.get(key);
    if (!it) return;
    const cam = this.R.camera, el = this.R.renderer.domElement;
    this.v.set(x, y, z).project(cam);
    const off = this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1;
    it.d.style.display = off ? 'none' : '';
    it.d.style.left = `${((this.v.x * 0.5 + 0.5) * el.clientWidth).toFixed(1)}px`;
    it.d.style.top = `${((-this.v.y * 0.5 + 0.5) * el.clientHeight).toFixed(1)}px`;
  }
}

// The start of a race: "take your marks" (hold action), "set", then the whistle at a moment nobody can
// guess. Letting go of action before the whistle is a false start: that racer stays put until a beat
// after everyone else goes. After the whistle a racer goes on letting go of action, or on any tap.
// racers: [{ c (competitor), i }]; each gets .started, .startT, .reaction, .early.
const REACT = { easy: [0.32, 0.12], normal: [0.22, 0.07], hard: [0.16, 0.04] };
export class RaceStart {
  constructor(ctx, racers) {
    this.ctx = ctx; this.racers = racers;
    this.phase = 'marks'; this.t = 0; this.whistleAt = null;
    this.whistleIn = 2.2 + ctx.rand() * 2.3;
    for (const ru of racers) { ru.started = false; ru.startT = null; ru.reaction = null; ru.early = false; ru.holding = false; ru.botGo = null; }
  }
  // the text for the centre message
  marksText() {
    const humans = this.racers.filter((ru) => ru.c.human);
    if (!humans.length) return 'Take your marks';
    return `Take your marks · hold ${humans.every((ru) => ru.c.type === 'touch') ? '●' : 'action'}`;
  }
  // per step, before the event handles strokes; q[i] = presses of racer i. Returns the presses left over
  // for racers already racing (their first press after the whistle starts them).
  update(dt, now, q) {
    this.t += dt;
    const ctx = this.ctx;
    if (this.phase === 'marks' && this.t >= this.whistleIn) {
      this.phase = 'go'; this.whistleAt = now;
      ctx.sound.whistle(0.5);
      ctx.hud.message('GO!', 'big', '#7be495', 0.8);
      const R = REACT[ctx.skillName] || REACT.normal;
      for (const ru of this.racers) if (!ru.c.human) ru.botGo = now + Math.max(0.1, R[0] + ctx.rand.gauss() * R[1]);
    }
    const left = q.map(() => []);
    for (const ru of this.racers) {
      const evs = q[ru.i] || [];
      if (ru.started) { left[ru.i] = evs; continue; }
      if (!ru.c.human) {
        if (this.phase === 'marks') ru.holding = this.t > 0.4;
        if (ru.botGo != null && now >= ru.botGo) this.go(ru, ru.botGo);
        continue;
      }
      for (let k = 0; k < evs.length; k++) {
        const e = evs[k];
        if (this.phase === 'marks') {
          if (e.b === 'action' && e.down) ru.holding = true;
          else if (e.b === 'action' && !e.down && ru.holding && !ru.early) { ru.early = true; ru.holding = false; ctx.hud.flash(`${ru.c.short}: too early!`, '#ff8a65'); ctx.sound.whistle(0.2); }
          continue;
        }
        const ok = !ru.early || e.t >= this.whistleAt + 0.7;
        if (!ok) continue;
        if ((e.b === 'action' && !e.down && ru.holding) || (e.down && e.b !== 'action') || (e.down && e.b === 'action' && !ru.holding)) {
          this.go(ru, e.t);
          left[ru.i] = e.b === 'action' ? evs.slice(k + 1) : evs.slice(k);
          break;
        }
      }
      // a false starter who is still holding goes as soon as their wait is over
      if (!ru.started && this.phase === 'go' && ru.early && ru.holding && now >= this.whistleAt + 0.7) this.go(ru, now);
    }
    return left;
  }
  go(ru, t) {
    ru.started = true; ru.startT = t; ru.holding = false;
    ru.reaction = t - this.whistleAt;
  }
  // a good reaction gets a burst off the start (0..1)
  boost(ru) { return ru.early ? 0 : clamp(1 - (ru.reaction - 0.12) / 0.38, 0, 1); }
}

// seconds as 12.34 s
export const fmtTime = (s) => `${s.toFixed(2)} s`;
