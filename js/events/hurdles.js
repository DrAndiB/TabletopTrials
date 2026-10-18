// Hurdles: the sprint's chalk track with ten hurdles per lane, each a pencil balanced on two dominoes.
// Two buttons: tap LEFT or RIGHT on a steady beat to run, ACTION to jump. At the right beat there are
// four strides between hurdles, so a steady runner goes tap, tap, tap, tap, JUMP right at the chalk mark.
// A clipped pencil costs speed; running into a hurdle tips you over.
import * as THREE from '../../vendor/three.bundle.js';
import { Sprint } from './sprint.js';
import { REST, blendPose, POSES } from '../figurine.js';
import { clamp } from '../util.js';
import { Rhythm } from '../verbs.js';
import { winFor, helped } from '../sizes.js';

const HURDLES = Array.from({ length: 10 }, (_, k) => 39 + k * 25.5);
const DOM_H = 4.8;            // a domino standing on end
const PENCIL_R = 0.38;
const JUMP_T = 0.44;          // seconds in the air
const LIFT = 3.3;             // how high the hips rise at the top of the jump
const CLEAN = [0.24, 0.76], CLIP = [0.1, 0.9];   // where in the jump the hurdle may be crossed
const VMAX_H = 23.5, TARGET_H = 4.6;   // a steady 4.6 beats a second: four strides and a jump per hurdle
const MARK = (VMAX_H * JUMP_T) / 2;     // chalk take-off mark, this far before each hurdle
// computer hurdlers: timing spread of the take-off (s) and the odd forgotten hurdle
const BOT_JUMP = { easy: { err: 0.085, miss: 0.035 }, normal: { err: 0.055, miss: 0.012 }, hard: { err: 0.035, miss: 0.004 } };
// over the hurdle: lead leg straight out, trail leg tucked to the side, opposite arm forward
const HURDLE_POSE = { ...REST, lean: 0.6, head: 0.15, hipL: 1.5, kneeL: 0.12, ankL: 0.25, hipR: -0.3, kneeR: 1.7, spR: 0.6, ankR: 0.4, shR: 1.35, elR: 0.35, abR: 0.15, shL: -0.7, elL: 1.0, abL: 0.3 };

class Hurdles extends Sprint {
  constructor(ctx) { super(ctx, { vmax: VMAX_H, target: TARGET_H, zones: false }); }

  // any stride key counts (no need to alternate); the jump counts as a beat too
  makeRhythm() {
    const r = new Rhythm({ target: this.target });
    const press = r.press.bind(r);
    r.press = (side, t) => press(r.last === 'left' ? 'right' : 'left', t);
    return r;
  }

  async build() {
    await super.build();
    for (const ru of this.runners) Object.assign(ru, { y: 0, jumpU: 0, air: false, jumpT0: 0, next: 0, clips: 0, falls: 0, downT: 0, crossed: false });
    this.buildHurdles(this.ctx.kit);
    const cad = { easy: 0.86, normal: 0.95, hard: 1.0 }[this.ctx.skillName] ?? 0.95;
    for (const ru of this.runners) ru.botCad = this.target * cad * (0.98 + this.r() * 0.04);
    // in the players' boxes: the beat to the next hurdle, four strides and a jump, instead of the race-phase dots
    const st = document.createElement('style');
    st.textContent = '.rm .beat{display:flex;gap:4px;margin-top:4px;align-items:center}.rm .beat span{width:9px;height:9px;border-radius:50%;background:#e6dccb}.rm .beat span.on{background:#1f1a17}.rm .beat span.j{width:16px;height:16px;background:#f6d9b8}.rm .beat span.j.on{background:#ef7d2c}';
    this.ctx.hud.el.appendChild(st);
    for (const m of this.meters) {
      m.d.querySelector('.z').style.display = 'none';
      const b = document.createElement('div');
      b.className = 'beat';
      b.innerHTML = '<span></span><span></span><span></span><span></span><span class="j"></span>';
      m.d.querySelector('.b').after(b);
      m.beat = b.querySelectorAll('span');
    }
  }

  buildHurdles(K) {
    const g = K.group;
    // dominoes: black, glossy, white pips on both faces
    const dc = K.TX.makeCanvas(64, 128), d = dc.getContext('2d');
    d.fillStyle = '#18181a'; d.fillRect(0, 0, 64, 128);
    d.fillStyle = '#f4f1ea'; d.fillRect(8, 62, 48, 4);
    const pip = (x, y) => { d.beginPath(); d.arc(x, y, 6, 0, Math.PI * 2); d.fill(); };
    pip(32, 32); pip(18, 18); pip(46, 46);                                   // three
    pip(18, 82); pip(46, 82); pip(18, 110); pip(46, 110); pip(32, 96);       // five
    const faceM = new THREE.MeshPhysicalMaterial({ map: K.TX.toTexture(dc, { wrap: false }), roughness: 0.25, clearcoat: 0.7 });
    const domGeo = new K.RoundedBoxGeometry(0.9, DOM_H, 2.4, 2, 0.2);
    const dominoes = [], marks = [];
    this.pencils = [];
    for (const ru of this.runners) {
      for (const hx of HURDLES) {
        for (const s of [-1, 1]) dominoes.push({ x: hx, y: DOM_H / 2, z: ru.z + s * 3.9, ry: (this.r() - 0.5) * 0.12 });
        this.pencils.push({ x: hx, z: ru.z, ru, hx, t: -1, spin: 0, dx: 0 });
        marks.push({ x: hx - MARK, y: 0.05, z: ru.z });
      }
    }
    K.instances(domGeo, faceM, dominoes);
    // the pencils: yellow body, metal ferrule, pink eraser, sharpened tip
    const L = 7.2;
    const cyl = (len, r, seg = 6) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
    const pg = K.merge([
      { geo: cyl(L, PENCIL_R), color: 0xf2c230 },
      { geo: cyl(0.5, PENCIL_R * 1.02, 10), color: 0xc8ccd2, pos: [0, 0, L / 2 + 0.25] },
      { geo: cyl(0.6, PENCIL_R * 0.98, 10), color: 0xf08aa3, pos: [0, 0, L / 2 + 0.8] },
      { geo: new THREE.ConeGeometry(PENCIL_R, 1.1, 6).rotateX(-Math.PI / 2), color: 0xe9c89a, pos: [0, 0, -L / 2 - 0.55] },
      { geo: new THREE.ConeGeometry(PENCIL_R * 0.36, 0.4, 6).rotateX(-Math.PI / 2), color: 0x3a3634, pos: [0, 0, -L / 2 - 0.92] },
    ]);
    this.pencilMesh = new THREE.InstancedMesh(pg, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, clearcoat: 0.4 }), this.pencils.length);
    this.pencilMesh.castShadow = true; this.pencilMesh.receiveShadow = true;
    g.add(this.pencilMesh);
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v3 = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1);
    this.pencils.forEach((p, i) => this.placePencil(p, i));
    this.pencilMesh.instanceMatrix.needsUpdate = true;
    this.pencilMesh.computeBoundingSphere();
    // chalk take-off marks
    const mg = new THREE.PlaneGeometry(0.5, 6).rotateX(-Math.PI / 2);
    K.instances(mg, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }), marks, { cast: false });
  }

  placePencil(p, i) {
    const t = clamp(p.t, 0, 1);
    // standing: across the two dominoes; knocked: tumbles forward onto the floor
    const y = p.t < 0 ? DOM_H + PENCIL_R : (DOM_H + PENCIL_R) * (1 - t * t) + PENCIL_R * t * t;
    this.e.set(p.spin * t, p.dx * 0.25 * t, 0);
    this.q.setFromEuler(this.e);
    this.v3.set(p.x + p.dx * t, y, p.z);
    this.m4.compose(this.v3, this.q, this.one);
    this.pencilMesh.setMatrixAt(i, this.m4);
  }

  knock(ru, hx, hard) {
    const k = this.pencils.findIndex((p) => p.ru === ru && p.hx === hx);
    if (k < 0) return;
    const p = this.pencils[k];
    if (p.t >= 0) return;
    p.t = 0; p.spin = (hard ? 4 : 2.5) * (this.r() < 0.5 ? -1 : 1); p.dx = hard ? 4 : 3;
    this.ctx.sound.clack?.(this.pan(ru.x));
  }

  // a steady beat is the fastest: chopping your steps faster than it trips you up
  tuneEffort(ru, x, eff) { return x > 1.15 ? eff * Math.max(0.8, 1 - (x - 1.15) * 0.5) : eff; }

  // ACTION during the race: jump
  onAction(ru, t, auto = false) {
    if (ru.air || ru.downT > 0) return;
    ru.air = true; ru.jumpT0 = t; ru.crossed = false;
    if (!auto) ru.rhythm.press('action', t);
    if (ru.c.human) this.ctx.sound.whoosh(0.35);
  }

  afterMove(ru, x0, now, dt) {
    if (ru.air) {
      const u = (now - ru.jumpT0) / JUMP_T;
      if (u >= 1) {
        ru.air = false; ru.jumpU = 0; ru.y = 0;
        // every landing costs a little speed, and a jump over nothing breaks the stride
        ru.v *= ru.crossed ? 0.985 : 0.93;
      } else { ru.jumpU = Math.max(0.001, u); ru.y = 4 * LIFT * u * (1 - u) * 0.55; }
    }
    const hx = HURDLES[ru.next];
    if (hx == null || !(x0 < hx && ru.x >= hx)) return;
    ru.next++;
    const tc = now - dt + ((hx - x0) / Math.max(1e-6, ru.x - x0)) * dt;
    const u = ru.air ? (tc - ru.jumpT0) / JUMP_T : -1;
    const ctx = this.ctx;
    if (ru.air) ru.crossed = true;
    // smaller players have a wider window over the pencil
    const cw = Math.min(0.49, winFor(ru.c, (CLEAN[1] - CLEAN[0]) / 2)), kw = Math.max(cw, winFor(ru.c, (CLIP[1] - CLIP[0]) / 2));
    if (u >= 0.5 - cw && u <= 0.5 + cw) return;
    if (u >= 0.5 - kw && u <= 0.5 + kw) {
      // clipped the pencil: it falls, you lose a little speed
      ru.v *= 0.84; ru.stumbleT = 0.3; ru.clips++;
      this.knock(ru, hx, false);
      if (ru.c.human) ctx.hud.flash(`${ru.c.short}: clip!`, '#ffc93c');
      return;
    }
    // straight into it: down you go
    this.knock(ru, hx, true);
    ru.falls++;
    ru.v = 0; ru.downT = 1.0; ru.air = false; ru.y = 0; ru.jumpU = 0; ru.x = hx + 1;
    ctx.sound.thump?.(0.7); ctx.sound.stumble(this.pan(ru.x));
    if (ru.c.human) ctx.hud.flash(`${ru.c.short}: oops!`, '#ff8a65');
  }

  // Little players (and anyone jogging home) jump by themselves, right at the chalk mark
  assist(ru, now) {
    super.assist(ru, now);
    if (!(helped(ru.c) || ru.walkHome) || !ru.started || ru.finished || ru.air || ru.downT > 0) return;
    const hx = HURDLES[ru.next];
    if (hx == null) return;
    if ((hx - ru.x - ru.v * JUMP_T * 0.5) / Math.max(5, ru.v) <= 0) { this.onAction(ru, now, true); ru.autoJumps = (ru.autoJumps || 0) + 1; }
  }

  // computer hurdlers take off around the chalk mark, a little early or late
  botExtra(ru, now) {
    if (!ru.started || ru.finished || ru.air || ru.downT > 0) return;
    const hx = HURDLES[ru.next];
    if (hx == null) return;
    if (ru.botFor !== ru.next) {
      const B = BOT_JUMP[this.ctx.skillName] || BOT_JUMP.normal;
      ru.botFor = ru.next;
      ru.botMiss = this.r() < B.miss;
      ru.botErr = (this.r() + this.r() + this.r() - 1.5) * 2 * B.err;
    }
    if (ru.botMiss) return;
    const ideal = ru.v * JUMP_T * 0.5;
    const tTo = (hx - ru.x - ideal) / Math.max(5, ru.v);
    if (tTo <= ru.botErr) {
      ru.c.pad.push('action', true, now); ru.c.pad.push('action', false, now + 0.05);
      // the jump takes the place of a stride
      if (ru.bot.next != null) ru.bot.next += 1 / Math.max(1, ru.botCad);
    }
  }

  runnerPose(ru, pose, jumpU, down) {
    if (down > 0) {
      // on the floor, then back up
      const up = clamp((0.35 - down) / 0.35, 0, 1);
      return blendPose(POSES.heap(), POSES.crouch(1), up);
    }
    if (jumpU > 0) return blendPose(pose, HURDLE_POSE, clamp(Math.sin(Math.PI * jumpU) * 1.7, 0, 1));
    return pose;
  }

  resultNote(ru) {
    const n = ru.clips + ru.falls;
    return n ? `${n} hurdle${n > 1 ? 's' : ''} knocked` : 'clean round';
  }

  frame(dt, paused) {
    super.frame(dt, paused);
    // the beat guide: which of the five beats before the next hurdle the runner is on
    for (const m of this.meters) {
      const ru = m.ru, hx = HURDLES[ru.next];
      const prev = ru.next > 0 ? HURDLES[ru.next - 1] : hx - 25.5;
      const k = hx == null || !ru.started ? -1 : Math.floor(clamp((ru.x - (prev - MARK) ) / ((hx - prev) / 5), 0, 4.999));
      m.beat.forEach((d, i) => d.classList.toggle('on', i === k));
    }
    if (!this.pencilMesh || paused) return;
    let any = false;
    this.pencils.forEach((p, i) => { if (p.t >= 0 && p.t < 1) { p.t = Math.min(1, p.t + dt / 0.38); this.placePencil(p, i); any = true; } });
    if (any) this.pencilMesh.instanceMatrix.needsUpdate = true;
  }
}

export default {
  id: 'hurdles', name: 'Hurdles', season: 'Summer',
  blurb: 'The chalk track with ten pencil-and-domino hurdles per lane: tap, tap, tap, tap, jump!',
  venue: 'The playroom floor: in every lane, ten pencils balanced on dominoes, with a chalk mark to jump from.',
  loading: 'Balancing pencils on dominoes…',
  how: [
    { verb: 'Timing', text: 'In the blocks, hold <b>action</b> and let go on the <b>whistle</b>.' },
    { verb: 'Rhythm', text: 'Tap <b>left</b> or <b>right</b> on a steady beat to run: no need to swap, no need to rush.' },
    { verb: 'Timing', text: 'Tap <b>action</b> to jump at the <b>chalk mark</b>. Keep the beat and it goes tap, tap, tap, tap, <b>jump</b> for every hurdle. Clip a pencil and you slow down; run into one and down you go.' },
  ],
  helpers: {
    little: 'You start and <b>jump by yourself</b>. Just tap <b>any button</b> on a slow, steady beat.',
    kid: 'A slower beat, and more room to get over each pencil.',
  },
  better: 'lower',
  resultsDelay: 0.9,
  create: (ctx) => new Hurdles(ctx),
};
