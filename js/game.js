// Runs one event at a time: builds its venue, feeds it each competitor's presses on a fixed 120 Hz
// step, and hands the results back to main.js. See _dev/EVENT_GUIDE.md for the event contract.
import * as THREE from '../vendor/three.bundle.js';
import { makeKit } from './kit.js';
import { Pad } from './input.js';
import { CPU_SKILL } from './verbs.js';
import { rng } from './util.js';
import { flagURL } from './flags.js';

const STEP = 1 / 120;

export class Game {
  constructor(R, input, sound, hud) {
    this.R = R; this.input = input; this.sound = sound; this.hud = hud;
    this.ev = null; this.def = null; this.kit = null;
    this.state = 'idle';     // idle | ready | running | done | attract
    this.time = 0;
    this.acc = 0;
    this.paused = false;
    this.clockOffset = 0;    // real seconds minus game seconds, for human press timestamps
    this.onEventEnd = null;  // fn({def, results, competitors})
  }

  // competitors: [{ slot, type: 'keys'|'touch'|'cpu', code, name, paint, seed, number }]
  async load(def, competitors, { skill = 'normal', round = 1, seed = 1, attract = false } = {}) {
    this.unload();
    this.def = def;
    this.time = 0; this.acc = 0; this.paused = false;
    this.competitors = competitors.map((c, i) => ({
      ...c, index: i,
      human: c.type !== 'cpu',
      pad: c.type === 'cpu' ? new Pad() : this.input.pads[c.slot],
      flag: flagURL(c.code, 72),
    }));
    this.kit = makeKit({ scene: this.R.scene, quality: this.R.quality, seed });
    const ctx = this.makeContext({ skill, round, seed, attract });
    this.ev = def.create(ctx);
    await this.ev.build();
    this.state = attract ? 'attract' : 'ready';
    if (attract && this.ev.attract) this.ev.attract();
    this.frame(0);
  }

  makeContext({ skill, round, seed, attract }) {
    const game = this, R = this.R;
    return {
      THREE, R, scene: R.scene, kit: this.kit, sound: this.sound,
      competitors: this.competitors,
      skill: CPU_SKILL[skill] || CPU_SKILL.normal, skillName: skill,
      round, attract, rand: rng(seed * 977 + 5),
      quality: R.quality,
      time: () => game.time,
      // queued presses of competitor i, oldest first, timed on the game clock: [{b, down, t}]
      presses(i) {
        const c = game.competitors[i];
        const q = c.pad.drain();
        if (c.human) for (const e of q) e.t -= game.clockOffset;
        return q;
      },
      held(i) { return game.competitors[i].pad.held; },
      hud: {
        el: this.hud.eventEl,
        message: (text, kind, color) => this.hud.message(text, kind, color),
        flash: (text, color) => this.hud.flash(text, color),
        chip: (i, info, cls) => this.hud.chip(i, info, cls),
      },
      // the event is over: results[i] = { value, text, sub?, dnf? } for competitor i
      finish(results) {
        if (game.state === 'done') return;
        game.state = 'done';
        game.onEventEnd?.({ def: game.def, results, competitors: game.competitors });
      },
    };
  }

  start() {
    for (const c of this.competitors) c.pad.clear();
    this.hud.setup(this.competitors);
    this.state = 'running';
    this.ev.start();
  }

  pause(on) {
    if (this.state !== 'running') return false;
    this.paused = on;
    if (!on) for (const c of this.competitors) if (c.human) c.pad.clear();
    return true;
  }

  // dt: real seconds since the last rendered frame
  update(dt) {
    if (!this.ev) return;
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 24) { this.time += STEP; this.ev.update(STEP); this.acc -= STEP; n++; }
      if (n >= 24) this.acc = 0;
    }
    this.frame(this.paused ? 0 : dt);
  }

  frame(dt) {
    if (!this.ev) return;
    this.ev.frame(dt, this.paused);
    this.R.render();
  }

  // tests: advance the simulation by `sec` seconds without rendering in between
  simulate(sec) {
    const n = Math.round(sec / STEP);
    for (let i = 0; i < n; i++) { this.time += STEP; this.ev.update(STEP); }
    // a long step lets cameras and animations settle as they would have during real frames
    this.ev.frame(Math.max(sec, 1 / 60), false);
  }

  unload() {
    if (this.ev) { this.ev.dispose?.(); this.ev = null; }
    if (this.kit) { this.kit.dispose(); this.kit = null; }
    this.hud.eventEl.innerHTML = '';
    this.sound.silenceLoops();
    this.state = 'idle';
  }
}
