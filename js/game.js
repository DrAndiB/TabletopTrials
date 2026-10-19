// Runs one event at a time: builds its venue, feeds it each competitor's presses on a fixed 120 Hz
// step, and hands the results back to main.js. See _dev/EVENT_GUIDE.md for the event contract.
import * as THREE from '../vendor/three.bundle.js';
import { makeKit } from './kit.js';
import { Pad } from './input.js';
import { CPU_SKILL } from './verbs.js';
import { rng } from './util.js';
import { flagURL } from './flags.js';
import { FlyIn, Ceremony } from './director.js';

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
    this.cinematics = true;  // fly-ins and medal ceremonies (tests turn them off)
  }

  // competitors: [{ slot, type: 'keys'|'touch'|'cpu', code, name, paint, seed, number }]
  async load(def, competitors, { skill = 'normal', round = 1, seed = 1, attract = false } = {}) {
    this.unload();
    this.def = def;
    this.time = 0; this.acc = 0; this.paused = false; this.speed = 1;
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
      // fast-forward (watching a computer player's turn): 1 = normal speed
      setSpeed(k) { game.speed = Math.max(1, k); },
      get speed() { return game.speed; },
      hud: {
        el: this.hud.eventEl,
        message: (text, kind, color, dur) => this.hud.message(text, kind, color, dur),
        flash: (text, color) => this.hud.flash(text, color),
        chip: (i, info, cls) => this.hud.chip(i, info, cls),
      },
      // the event is over: results[i] = { value, text, sub?, dnf? } for competitor i
      finish(results) {
        if (game.state === 'done') return;
        game.state = 'done';
        game.speed = 1;
        game.onEventEnd?.({ def: game.def, results, competitors: game.competitors });
      },
    };
  }

  // the fly-in through the room first (skippable), then the event itself
  start({ flyIn = this.cinematics } = {}) {
    const keys = flyIn && this.ev.flyIn ? this.ev.flyIn() : null;
    if (keys && keys.length > 1) {
      this.state = 'flyin';
      this.director = new FlyIn(keys, { dur: this.ev.flyInTime ?? 6.5 });
      this.hud.visible(false);
      this.caption(this.def.name, this.ev.room || this.def.venue);
      this.skipWatch();
      return;
    }
    this.begin();
  }

  begin() {
    this.director = null;
    this.caption(null);
    for (const c of this.competitors) c.pad.clear();
    this.hud.setup(this.competitors);
    this.state = 'running';
    this.ev.start();
  }

  // a human tapping action skips the fly-in or the ceremony (read from the held state, so the event
  // can keep draining presses as it likes)
  skipWatch() { this.skipPrev = this.competitors.map((c) => !!c.pad.held.action); }
  skipPressed() {
    let hit = false;
    this.competitors.forEach((c, i) => { const h = !!c.pad.held.action; if (c.human && h && !this.skipPrev[i]) hit = true; this.skipPrev[i] = h; });
    return hit;
  }

  // the big title over the fly-in and the ceremony; null removes it
  caption(title, sub = '', hint = true, small = false) {
    let el = document.getElementById('cine-cap');
    if (!title) { if (el) el.classList.remove('show'); return; }
    if (!el) { el = document.createElement('div'); el.id = 'cine-cap'; document.body.appendChild(el); }
    const human = this.competitors.some((c) => c.human), touch = this.competitors.some((c) => c.type === 'touch');
    el.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}${hint && human ? `<i>${touch ? 'tap ●' : 'action'} to skip</i>` : ''}`;
    el.classList.toggle('small', small);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  // the medal ceremony at the event's best spot; resolves when it's over (or skipped)
  ceremony(medallists) {
    const spot = this.cinematics && this.ev && this.ev.ceremonySpot ? this.ev.ceremonySpot() : null;
    if (!spot || !medallists.length) return Promise.resolve();
    this.hud.visible(false);
    const cer = new Ceremony(this.kit, this.R, spot, medallists);
    this.director = cer;
    const names = medallists.slice().sort((a, b) => a.place - b.place).map((m) => `${['🥇', '🥈', '🥉'][m.place]} ${m.c.name}`).join('   ');
    this.caption(`${this.def.name}: the medals`, names, true, true);
    this.skipWatch();
    this.sound.cheer?.(1); this.sound.clap?.(10);
    return new Promise((resolve) => { this.ceremonyEnd = () => { this.ceremonyEnd = null; this.caption(null); resolve(); }; this.ceremonyT = 0; });
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
    if (this.state === 'flyin') {
      // the room animates (on its own clock), nothing is played yet
      this.time += dt;
      if (this.skipPressed() || this.director.done) this.begin();
      this.frame(dt);
      return;
    }
    if (this.ceremonyEnd) {
      this.ceremonyT += dt;
      if ((this.ceremonyT > 1 && this.skipPressed()) || this.ceremonyT > 7.5) this.ceremonyEnd();
    }
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      this.acc += dt * ((this.speed || 1) - 1);
      const max = 24 * (this.speed || 1);
      while (this.acc >= STEP && n < max) { this.time += STEP; this.ev.update(STEP); this.acc -= STEP; n++; }
      if (n >= max) this.acc = 0;
    }
    this.frame(this.paused ? 0 : dt);
  }

  frame(dt) {
    if (!this.ev) return;
    this.ev.frame(dt, this.paused);
    if (this.director) this.director.apply(this.R, this.paused ? 0 : dt);
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
    this.speed = 1;
    this.director = null;
    this.caption(null);
    if (this.ceremonyEnd) this.ceremonyEnd();
    if (this.ev) { this.ev.dispose?.(); this.ev = null; }
    if (this.kit) { this.kit.dispose(); this.kit = null; }
    this.hud.eventEl.innerHTML = '';
    this.sound.silenceLoops();
    this.state = 'idle';
  }
}
