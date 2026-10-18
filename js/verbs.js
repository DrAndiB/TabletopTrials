// The four input verbs every event is built from: rhythm, timing, power and steer.
// Events read verbs, not keys, so keyboard, touch and computer players all play the same game.
import { clamp } from './util.js';

// RHYTHM: alternate left and right. Each alternating press is a stride; pressing the same side twice is a
// stumble. What counts is a steady cadence near the event's target: above it the gain is small (+4 % at
// most), so raw tapping speed stops paying off before a touch screen or a tired wrist runs out.
export class Rhythm {
  constructor({ target = 6.5, keep = 8 } = {}) {
    this.target = target;     // strides per second that give full effort
    this.keep = keep;         // intervals averaged
    this.k = 1;               // the player's size scales the beat (a Little player's target is slower)
    this.top = 1;             // and the share of full effort a perfect beat is worth
    this.hold = 1.5;          // a gap this many beats long before the beat starts to fade (longer for little hands)
    this.slack = 0.32;        // how uneven the taps may get before it costs anything
    this.any = false;         // Little players: any button is the next step, no need to alternate
    this.reset();
  }
  reset() {
    this.last = null;         // side of the last press
    this.lastT = -1e9;        // time of the last stride
    this.intervals = [];
    this.strides = 0;
    this.stumbles = 0;
  }
  // -> 'first' | 'stride' | 'stumble'
  press(side, t) {
    if (this.any && this.last === side) side = side === 'left' ? 'right' : 'left';
    if (this.last === side) { this.stumbles++; this.lastStumble = t; return 'stumble'; }
    const first = this.last === null || t - this.lastT > 1.2;
    this.last = side;
    if (!first) {
      const iv = t - this.lastT;
      if (iv > 0.03) { this.intervals.push(iv); if (this.intervals.length > this.keep) this.intervals.shift(); }
    } else this.intervals = [];
    this.lastT = t;
    this.strides++;
    return first ? 'first' : 'stride';
  }
  mean() {
    if (!this.intervals.length) return Infinity;
    let s = 0;
    for (const v of this.intervals) s += v;
    return s / this.intervals.length;
  }
  // strides per second as of time t; falls away once the presses stop
  cadence(t) {
    const m = this.mean();
    if (!isFinite(m)) return t - this.lastT < 0.5 ? 1.5 : 0;
    // the beat only fades once the current gap is clearly longer than usual (a real pause)
    const since = t - this.lastT;
    return since > m * this.hold ? 1 / (since / this.hold) : 1 / m;
  }
  // coefficient of variation of the recent intervals (0 = metronome)
  unsteadiness() {
    const n = this.intervals.length;
    if (n < 3) return 0;
    const m = this.mean();
    let v = 0;
    for (const x of this.intervals) v += (x - m) * (x - m);
    return Math.sqrt(v / n) / m;
  }
  // the beat that gives full effort for this player, and how close to it they are (1 = right on it)
  get goal() { return this.target * this.k; }
  ratio(t) { return this.cadence(t) / this.goal; }
  // 0..1.04: share of full running effort
  effort(t) {
    const x = this.ratio(t);
    let e = x <= 1 ? x : 1 + 0.04 * (1 - Math.exp(-(x - 1) * 5));
    // only really erratic tapping costs anything; normal keyboard and touch jitter does not
    e *= 1 - clamp((this.unsteadiness() - this.slack) * 0.8, 0, 0.25);
    return e * this.top;
  }
}

// TIMING: how close a press came to the ideal moment. -> 1 at the ideal, falling to 0 at ±window.
export function timingScore(t, ideal, window) {
  return clamp(1 - Math.abs(t - ideal) / window, 0, 1);
}

// POWER: hold, then release. A meter that rises while held; `wrap` makes it fall again after the top.
export class Power {
  constructor({ rise = 1.1, wrap = true } = {}) { this.rise = rise; this.wrap = wrap; this.t0 = null; }
  start(t) { this.t0 = t; }
  get holding() { return this.t0 != null; }
  value(t) {
    if (this.t0 == null) return 0;
    const x = (t - this.t0) / this.rise;
    if (!this.wrap) return clamp(x, 0, 1);
    const k = x % 2;
    return k <= 1 ? k : 2 - k;
  }
  release(t) { const v = this.value(t); this.t0 = null; return v; }
}

// STEER: held left/right as -1..1, eased so a tap is a nudge and a hold a full push.
export class Steer {
  constructor(rate = 9) { this.v = 0; this.rate = rate; }
  update(pad, dt) {
    const want = pad.steer;
    this.v += (want - this.v) * (1 - Math.exp(-this.rate * dt));
    return this.v;
  }
}

// ---------- computer players ----------
export const CPU_SKILL = {
  easy: { cadence: 0.8, jitter: 0.16, react: [0.32, 0.5], aim: 0.55, stumble: 0.03 },
  normal: { cadence: 0.92, jitter: 0.11, react: [0.22, 0.36], aim: 0.75, stumble: 0.015 },
  hard: { cadence: 0.96, jitter: 0.07, react: [0.15, 0.24], aim: 0.9, stumble: 0.005 },
};

// Drives a Pad with alternating presses at a cadence (strides/s), with human-like jitter.
export class BotTapper {
  constructor(pad, rand) { this.pad = pad; this.r = rand; this.next = null; this.side = 'left'; this.on = false; }
  start(t) { this.on = true; this.next = t; }
  stop() { this.on = false; this.pad.push('left', false); this.pad.push('right', false); }
  update(t, cadence, jitter = 0.1, stumble = 0) {
    if (!this.on || cadence <= 0) return;
    while (this.next <= t) {
      const tt = this.next;
      // press and release the next side; an occasional stumble presses the same side again
      const side = this.r() < stumble ? (this.side === 'left' ? 'right' : 'left') : this.side;
      this.pad.push(side, true, tt);
      this.pad.push(side, false, tt + 0.03);
      this.side = side === 'left' ? 'right' : 'left';
      const g = this.r.gauss ? this.r.gauss() : (this.r() - 0.5) * 3.4;
      this.next = tt + Math.max(0.05, (1 / cadence) * (1 + g * jitter));
    }
  }
}
