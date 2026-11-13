// Phone controls: the whole screen is the controller. One touch player plays with gestures instead of
// the three pads; each event picks a scheme per phase, and the scheme turns touches into the same pad
// presses a keyboard makes (so the events' rules stay the same) plus a few analog values:
//   tap     every touch is ACTION (held while the finger is down)
//   halves  touches on the left half are LEFT, on the right half RIGHT (two thumbs)
//   stroke  every swipe is a LEFT or RIGHT press (by the half it starts in), stronger the longer it is
//   rub     rubbing back and forth: every change of direction is the next LEFT/RIGHT press
//   stick   drag from where the finger went down: left/right are LEFT/RIGHT held, down is ACTION held
//   none    nothing is pressed; the event reads the finger itself (dx, dy, the last release)
// With `steer: { axis, range }` the drag also steers (pad.ax, -1..1), whatever the scheme.
// Distances are in units of 1/360 of the screen's short side, so a phone and a tablet feel the same.
import { clamp } from './util.js';
import { buzz } from './haptics.js';

const clock = () => performance.now() / 1000;
const FULL = 96;      // a swipe this long is a full-strength stroke
const HYST = 9;       // rubbing: this far back from the turning point counts as a change of direction

export class Gestures {
  constructor(root) {
    this.root = root;
    this.pad = null;
    this.mode = 'none'; this.opt = {};
    this.ptrs = new Map();
    this.main = null;                 // the finger that steers and aims (the first one down)
    this.down = false; this.dx = 0; this.dy = 0; this.x = 0; this.y = 0; this.travel = 0; this.t0 = 0;
    this.rel = null;                  // the last lift of the main finger: { dx, dy, dur, travel, vx, vy, t }
    this.rubSide = 'left'; this.rubT = -1;
    this.scale = 1;
    const ev = (fn) => (e) => {
      if (!this.pad) return;
      e.preventDefault();
      const t = (e.timeStamp > 1e3 ? e.timeStamp : performance.now()) / 1000;
      fn(e, t);
    };
    root.addEventListener('pointerdown', ev((e, t) => { try { root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } this.onDown(e.pointerId, e.clientX, e.clientY, t); }));
    root.addEventListener('pointermove', ev((e, t) => this.onMove(e.pointerId, e.clientX, e.clientY, t)));
    for (const k of ['pointerup', 'pointercancel']) root.addEventListener(k, ev((e, t) => this.onUp(e.pointerId, t)));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // the phone player's pad, or null to switch gestures off
  attach(pad) {
    this.releaseAll();
    this.pad = pad || null;
    this.ptrs.clear(); this.main = null; this.down = false; this.rel = null;
    this.mode = 'tap'; this.opt = {};
    this.root.classList.toggle('show', !!pad);
  }

  scheme(mode, opt = {}) {
    if (!this.pad) return;
    const same = mode === this.mode && JSON.stringify(opt) === JSON.stringify(this.opt);
    if (same) return;
    this.releaseAll();
    this.mode = mode; this.opt = opt;
    this.pad.ax = opt.steer ? 0 : null;
    // a finger still down from the phase before starts the new gesture from where it is now
    for (const p of this.ptrs.values()) this.anchor(p, p.x, p.y, clock());
    this.sync();
  }

  releaseAll(t = clock()) {
    if (!this.pad) return;
    for (const b of ['left', 'right', 'action']) this.pad.push(b, false, t);
    this.pad.ax = this.opt.steer ? 0 : null;
  }

  anchor(p, x, y, t) {
    p.x0 = x; p.y0 = y; p.t0 = t; p.travel = 0; p.fired = false;
    p.side = x < window.innerWidth / 2 ? 'left' : 'right';
    p.rub = { x: { dir: 0, ext: x }, y: { dir: 0, ext: y } };
  }

  // take the last lift of the main finger (once)
  take() { const r = this.rel; this.rel = null; return r; }

  press(b, t, p) { this.pad.push(b, false, t); this.pad.push(b, true, t, p); if (this.opt.buzz !== false) buzz('tick'); }

  onDown(id, x, y, t = clock()) {
    if (!this.pad) return;
    this.scale = 360 / Math.max(1, Math.min(window.innerWidth, window.innerHeight));
    const p = { id, x, y, lx: x, ly: y, vx: 0, vy: 0, lt: t };
    this.anchor(p, x, y, t);
    this.ptrs.set(id, p);
    if (this.main == null) { this.main = id; this.rel = null; }
    if (this.mode === 'tap') this.press('action', t);
    else if (this.mode === 'halves') this.press(p.side, t);
    this.sync();
  }

  onMove(id, x, y, t = clock()) {
    const p = this.ptrs.get(id);
    if (!p || !this.pad) return;
    const s = this.scale, mx = (x - p.lx) * s, my = (y - p.ly) * s, dt = Math.max(1e-3, t - p.lt);
    p.travel += Math.hypot(mx, my);
    p.vx += (mx / dt - p.vx) * 0.5; p.vy += (my / dt - p.vy) * 0.5;
    p.x = x; p.y = y; p.lx = x; p.ly = y; p.lt = t;
    if (this.mode === 'stroke' && !p.fired) {
      if (Math.hypot(x - p.x0, y - p.y0) * s >= FULL) { p.fired = true; this.press(p.side, t, 1); this.pad.push(p.side, false, t + 0.01); }
    } else if (this.mode === 'rub') {
      for (const [k, pos] of [['x', x * s], ['y', y * s]]) {
        const r = p.rub[k];
        if (r.dir === 0) { const d = pos - (k === 'x' ? p.x0 : p.y0) * s; if (Math.abs(d) >= HYST) { r.dir = Math.sign(d); r.ext = pos; this.rubbed(t); } continue; }
        if ((pos - r.ext) * r.dir > 0) r.ext = pos;
        else if ((r.ext - pos) * r.dir >= HYST) { r.dir = -r.dir; r.ext = pos; this.rubbed(t); }
      }
    } else if (this.mode === 'stick' && id === this.main) {
      const T = this.opt.dead ?? 22, dx = (x - p.x0) * s, dy = (y - p.y0) * s;
      this.pad.push('left', dx < -T, t); this.pad.push('right', dx > T, t);
      if (this.opt.action !== false) this.pad.push('action', dy > T, t);
    }
    this.sync();
  }

  rubbed(t) {
    if (t - this.rubT < 0.045) return;     // a diagonal rub turns on both axes at once: one stroke
    this.rubT = t;
    this.rubSide = this.rubSide === 'left' ? 'right' : 'left';
    this.press(this.rubSide, t); this.pad.push(this.rubSide, false, t + 0.01);
  }

  onUp(id, t = clock()) {
    const p = this.ptrs.get(id);
    if (!p || !this.pad) return;
    this.ptrs.delete(id);
    const s = this.scale, dx = (p.x - p.x0) * s, dy = (p.y - p.y0) * s;
    if (this.mode === 'stroke' && !p.fired) {
      // (with `hold`, a finger that rested in place was a hold, not a stroke)
      const rest = this.opt.hold && p.travel < 16 && t - p.t0 > 0.2;
      if (!rest) { this.press(p.side, t, clamp(Math.hypot(dx, dy) / FULL, 0.25, 1)); this.pad.push(p.side, false, t + 0.01); }
    }
    else if (this.mode === 'tap') { if (!this.ptrs.size) this.pad.push('action', false, t); }
    else if (this.mode === 'halves') { if (![...this.ptrs.values()].some((o) => o.side === p.side)) this.pad.push(p.side, false, t); }
    else if (this.mode === 'stick' && id === this.main) this.releaseAll(t);
    if (id === this.main) {
      // a lift after a pause is a let-go, not a flick: only the last moment's speed counts
      const still = t - p.lt > 0.08;
      this.rel = { dx, dy, dur: t - p.t0, travel: p.travel, vx: still ? 0 : p.vx, vy: still ? 0 : p.vy, t };
      const next = this.ptrs.values().next().value;
      this.main = next ? next.id : null;
      if (next) this.anchor(next, next.x, next.y, t);
    }
    this.sync();
  }

  // the main finger as the events read it
  sync() {
    const p = this.main != null ? this.ptrs.get(this.main) : null, s = this.scale;
    this.down = !!p;
    this.count = this.ptrs.size;
    if (p) { this.dx = (p.x - p.x0) * s; this.dy = (p.y - p.y0) * s; this.x = p.x; this.y = p.y; this.travel = p.travel; this.t0 = p.t0; }
    else { this.dx = 0; this.dy = 0; this.travel = 0; }
    const st = this.opt.steer;
    if (st && this.pad) this.pad.ax = p ? clamp((st.axis === 'y' ? -this.dy : this.dx) / (st.range || 70), -1, 1) : 0;
  }
}
