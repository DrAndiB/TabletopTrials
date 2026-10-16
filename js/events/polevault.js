// Pole vault: a bendy drinking straw, a skewer for a bar on two rulers, a pillow to land on.
// Tap LEFT/RIGHT in turn to run up, tap ACTION on the green tape to plant the straw, and tap ACTION
// again as the straw straightens to push off over the bar. The bar goes up 20 cm at a time; two misses
// at a height and you're out. The best height cleared wins.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, REST, blendPose } from '../figurine.js';
import { crowd, banner, floorMaterial } from '../props.js';
import { Rhythm, BotTapper } from '../verbs.js';
import { Particles } from '../fx.js';
import { clamp, damp, rng, makeNoise2D } from '../util.js';
import { hudKit, Card, Guide, Tags } from './common.js';

const U = 4.75;                 // units per metre (a figurine is a 1.75 m vaulter)
const BOX_X = -2;               // where the straw plants
const BAR_X = 5;                // the bar, between the two rulers
const RUN_X = -80;
const ZONE = [-22, -12], IDEAL = -17;    // the plant tape, and the best spot on it
const TARGET = 6.5, VMAX = 31, ACCEL = 1.9;
const PL = 23;                  // the straw
const SWING_T = 0.95;
const PUSH_U = 0.66;            // the moment in the swing to push off
const G = 30;
const START_H = 4.8, STEP = 0.2, MISSES = 2;
const SEGS = 16;
const BOT = {
  easy: { cad: 0.86, plant: 3.2, push: 0.13 },
  normal: { cad: 0.95, plant: 2.0, push: 0.08 },
  hard: { cad: 1.0, plant: 1.3, push: 0.05 },
};
const fmtH = (m) => `${m.toFixed(2)} m`;

class PoleVault {
  constructor(ctx) {
    this.ctx = ctx;
    this.r = ctx.rand;
    this.phase = 'pre';
    this.t = 0;
    this.cam = { x: -60, y: 8, z: 0, yaw: 0.2, pitch: 0.2, width: 80 };
    this.vaulters = [];
    this.bar = START_H;
    this.v3 = new THREE.Vector3();
  }

  async build() {
    const { kit: K, R, competitors } = this.ctx;
    R.setLighting({
      sunDir: [-0.4, 1, 0.55], sunColor: 0xffe6c8, sunIntensity: 2.15,
      hemiSky: 0xfff3e2, hemiGround: 0x6a4a33, hemiIntensity: 0.62,
      envIntensity: 0.55, exposure: 0.98, background: 0x2a2019, shadowRadius: 4,
    });
    this.noise = makeNoise2D(41);
    this.buildRoom(K);
    this.buildPit(K);
    this.particles = new Particles(K.group, 400);
    this.particles.setScale(R.renderer.domElement.height * 0.9);
    const strawM = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.6 });
    const segGeo = new THREE.CylinderGeometry(0.42, 0.42, PL / SEGS + 0.02, 10).translate(0, PL / SEGS / 2, 0);
    competitors.forEach((c, i) => {
      const fig = new Figurine({ paint: c.paint, seed: c.seed, number: c.number });
      fig.setGear('sprint');
      K.group.add(fig.root);
      // the straw: a chain of segments in stripes of white and the team colour
      const straw = new THREE.Group();
      let parent = straw;
      const segs = [];
      for (let k = 0; k < SEGS; k++) {
        const col = new THREE.Color(k % 2 ? 0xffffff : c.paint.shirt);
        const g = segGeo.clone();
        const n = g.attributes.position.count, cols = new Float32Array(n * 3);
        for (let j = 0; j < n; j++) { cols[j * 3] = col.r; cols[j * 3 + 1] = col.g; cols[j * 3 + 2] = col.b; }
        g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        const m = new THREE.Mesh(g, strawM);
        m.castShadow = true;
        if (k > 0) m.position.y = PL / SEGS;
        parent.add(m); segs.push(m); parent = m;
      }
      K.group.add(straw);
      this.vaulters.push({
        c, i, fig, straw, segs, best: null, marks: [], missesHere: 0, out: false, idle: this.r() * 10,
        home: { x: RUN_X - 12 - (i % 2) * 7, z: -14 - i * 5 },
        bot: c.human ? null : { tap: new BotTapper(c.pad, rng(c.seed * 19 + 1)) },
      });
    });
    this.placeWaiting();
    const kit = hudKit(this.ctx);
    this.card = new Card(kit);
    this.guide = new Guide(kit, [{ key: 'sp', label: 'Speed' }]);
    this.tags = new Tags(kit, R);
    this.applyCamera(1);
  }

  buildRoom(K) {
    const g = K.group;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(800, 400).rotateX(-Math.PI / 2), floorMaterial({ seed: 21, repeat: 7, base: 0xc39066 }));
    floor.position.set(-20, 0, -40); floor.receiveShadow = true; g.add(floor);
    const wc = K.TX.makeCanvas(256), w = wc.getContext('2d');
    w.fillStyle = '#f3e3c3'; w.fillRect(0, 0, 256, 256);
    w.strokeStyle = '#e2c99c'; w.lineWidth = 6;
    for (let x = 0; x < 256; x += 32) { w.beginPath(); w.moveTo(x, 0); w.lineTo(x, 256); w.stroke(); }
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(800, 260), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(wc, { repeat: [26, 7] }), roughness: 0.95 }));
    wall.position.set(-20, 130, -110); wall.receiveShadow = true; g.add(wall);
    // the runway in masking tape, the plant tape, metre marks
    const Y = 0.05;
    const tapeM = new THREE.MeshStandardMaterial({ color: 0xe8d9a8, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const z of [-5, 5]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(BOX_X - RUN_X + 10, 1.3).rotateX(-Math.PI / 2), tapeM); m.position.set((RUN_X + BOX_X) / 2 - 5, Y, z); m.receiveShadow = true; g.add(m); }
    const zc = K.TX.makeCanvas(256, 128), z2 = zc.getContext('2d');
    z2.fillStyle = 'rgba(47,174,90,0.88)'; z2.fillRect(0, 0, 256, 128);
    z2.fillStyle = '#ffffff'; z2.font = '58px "Lilita One", Impact, sans-serif'; z2.textAlign = 'center'; z2.textBaseline = 'middle'; z2.fillText('PLANT', 128, 68);
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(ZONE[1] - ZONE[0], 9).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(zc, { wrap: false }), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3 }));
    zone.position.set((ZONE[0] + ZONE[1]) / 2, Y + 0.01, 0); g.add(zone);
    // a bookshelf, a toy box and a plant pot for the room
    const box = new THREE.Mesh(new K.RoundedBoxGeometry(44, 30, 26, 2, 1.5), K.paint(0x3d7bd9));
    box.position.set(-140, 15, -70); box.castShadow = true; box.receiveShadow = true; g.add(box);
    const lid = new THREE.Mesh(new K.RoundedBoxGeometry(46, 3, 28, 2, 1), K.paint(0xf2c230));
    lid.position.set(-140, 31.5, -70); lid.castShadow = true; g.add(lid);
    const pot = new THREE.Mesh(K.lathe([[0.01, 0], [9, 0], [12, 20], [12.6, 21], [0.01, 21]], 24), K.std({ color: 0xc8643c, roughness: 0.8 }));
    pot.position.set(90, 0, -80); pot.castShadow = true; g.add(pot);
    for (let k = 0; k < 7; k++) { const leaf = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 8), K.std({ color: 0x4f8f3a, roughness: 0.7 })); leaf.position.set(90 + Math.cos(k) * 8, 28 + (k % 3) * 6, -80 + Math.sin(k) * 8); leaf.scale.set(1, 1.6, 0.5); leaf.rotation.y = k; leaf.castShadow = true; g.add(leaf); }
  }

  buildPit(K) {
    const g = K.group;
    // the planting box: a matchbox sunk into the floor
    const mb = new THREE.Mesh(new K.RoundedBoxGeometry(4, 1.2, 3, 2, 0.3), K.std({ color: 0x3a6fb0, roughness: 0.7 }));
    mb.position.set(BOX_X - 1, 0.6, 0); mb.castShadow = true; g.add(mb);
    // the landing pillow
    const pc = K.TX.makeCanvas(256), p2 = pc.getContext('2d');
    p2.fillStyle = '#f7f1e6'; p2.fillRect(0, 0, 256, 256);
    p2.fillStyle = '#9fd1c4'; for (let y = 0; y < 256; y += 32) p2.fillRect(0, y, 256, 12);
    const pillow = new THREE.Mesh(new K.RoundedBoxGeometry(36, 8, 32, 4, 3.5), new THREE.MeshPhysicalMaterial({ map: K.TX.toTexture(pc, { repeat: [1, 1] }), roughness: 0.9, sheen: 0.8, sheenColor: 0xffffff }));
    pillow.position.set(BAR_X + 16, 4, 0); pillow.castShadow = true; pillow.receiveShadow = true; g.add(pillow);
    this.pillow = pillow;
    K.contact(BAR_X + 16, 0, 20, 22, 0.4);
    // two rulers stood up in lumps of modelling clay, clothes pegs holding the skewer bar
    const rc = K.TX.makeCanvas(64, 1024), r2 = rc.getContext('2d');
    r2.fillStyle = '#e9d3a0'; r2.fillRect(0, 0, 64, 1024);
    r2.fillStyle = '#3a3634';
    for (let k = 0; k <= 40; k++) { const y = 1024 - k * 25.6; r2.fillRect(0, y - 1, k % 5 === 0 ? 30 : 16, 2); if (k % 10 === 0 && k) { r2.font = '18px Rubik, sans-serif'; r2.fillText(String(k / 10 * 2), 34, y + 6); } }
    const rulerM = new THREE.MeshStandardMaterial({ map: K.TX.toTexture(rc, { wrap: false }), roughness: 0.55 });
    this.pegs = [];
    for (const z of [-12, 12]) {
      const ru = new THREE.Mesh(new K.RoundedBoxGeometry(3, 40, 0.5, 1, 0.12), rulerM);
      ru.position.set(BAR_X, 20, z); ru.castShadow = true; g.add(ru);
      const clay = new THREE.Mesh(new THREE.SphereGeometry(3.4, 16, 10), K.std({ color: 0xe23b2e, roughness: 0.85 }));
      clay.position.set(BAR_X, 1.2, z); clay.scale.set(1.2, 0.55, 1.2); clay.castShadow = true; g.add(clay);
      const peg = new THREE.Mesh(K.merge([
        { geo: new K.RoundedBoxGeometry(0.9, 6, 1.1, 1, 0.2), color: 0xd9b48a, pos: [-0.6, -1.5, 0] },
        { geo: new K.RoundedBoxGeometry(0.9, 6, 1.1, 1, 0.2), color: 0xd9b48a, pos: [0.6, -1.5, 0] },
        { geo: new THREE.TorusGeometry(0.6, 0.15, 6, 12), color: 0xc8ccd2, pos: [0, -2.5, 0] },
      ]), K.std({ vertexColors: true, roughness: 0.6 }));
      peg.castShadow = true; g.add(peg);
      this.pegs.push({ peg, z });
    }
    this.barMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 28, 8).rotateX(Math.PI / 2), K.std({ color: 0xe6c99a, roughness: 0.6 }));
    this.barMesh.castShadow = true; g.add(this.barMesh);
    // a big card showing the height, propped against the pillow
    this.hc = K.TX.makeCanvas(256, 128);
    this.hTex = K.TX.toTexture(this.hc, { wrap: false });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshStandardMaterial({ map: this.hTex, roughness: 0.9 }));
    card.position.set(BAR_X + 24, 11.5, 16.4); card.rotation.x = -0.2; g.add(card);
    this.setBar(START_H);
    // the crowd on cushions along the far side
    const spots = [];
    for (let k = 0; k < 6; k++) spots.push({ x: -40 + k * 14, y: 0, z: -34 - (k % 2) * 6, ry: 0.15, size: 11 + this.r() * 2 });
    for (let k = 0; k < 4; k++) spots.push({ x: BAR_X + 40 + (k % 2) * 10, y: 0, z: -14 + k * 12, ry: -1.3, size: 11 });
    this.crowd = crowd(g, spots, 61);
    const comps = this.ctx.competitors;
    [[-70, -40], [20, -46], [60, 30]].forEach(([x, z], k) => {
      const b = banner(comps[k % comps.length].code, 14, { seed: 50 + k });
      b.position.set(x, 0, z); b.rotation.y = k === 2 ? -2.6 : 0.2;
      g.add(b);
    });
  }

  setBar(h) {
    this.bar = h;
    const y = h * U;
    this.barY = y;
    this.barMesh.position.set(BAR_X, y + 0.35, 0); this.barMesh.rotation.set(0, 0, 0);
    this.barFall = null;
    for (const p of this.pegs) p.peg.position.set(BAR_X, y + 0.2, p.z);
    const c = this.hc.getContext('2d');
    c.fillStyle = '#fffdf6'; c.fillRect(0, 0, 256, 128);
    c.strokeStyle = '#2f4f7a'; c.lineWidth = 8; c.strokeRect(6, 6, 244, 116);
    c.fillStyle = '#2f4f7a'; c.font = '74px "Lilita One", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(h.toFixed(2), 128, 68);
    this.hTex.needsUpdate = true;
  }

  attract() {}

  start() {
    this.ctx.sound.setLoop('crowd', 0.3);
    this.queue = this.vaulters.map((v) => v);
    this.next();
  }

  // the order at a height: everyone still in who hasn't cleared it; a first miss goes to the back
  next() {
    const ctx = this.ctx;
    if (!this.queue.length) {
      const left = this.vaulters.filter((v) => !v.out);
      if (!left.length || this.bar >= 6.79) { this.finishAll(); return; }
      this.setBar(Math.round((this.bar + STEP) * 100) / 100);
      for (const v of left) v.missesHere = 0;
      this.queue = left.slice();
      ctx.hud.message(`Bar up: ${fmtH(this.bar)}`, 'small', '#ffc93c', 1.6);
      ctx.sound.clack(0);
    }
    const v = this.cur = this.queue.shift();
    this.va = { x: RUN_X, v: 0, rhythm: new Rhythm({ target: TARGET }), started: false, anim: 0, plantQ: null, pushQ: null, planted: false, u: 0 };
    this.phase = 'ready'; this.t = 0;
    this.placeWaiting();
    v.fig.setExpression('focus');
    if (v.bot) { const B = BOT[this.ctx.skillName] || BOT.normal; v.bot.go = 0.4 + this.r() * 0.4; v.bot.started = false; v.bot.plantAt = IDEAL + this.r.gauss() * B.plant; v.bot.pushAt = PUSH_U + this.r.gauss() * B.push; v.bot.pushed = false; }
    ctx.competitors.forEach((c, i) => ctx.hud.chip(i, this.vaulters[i].best != null ? fmtH(this.vaulters[i].best) : this.vaulters[i].out ? 'out' : '', i === v.i ? 'active' : ''));
    if (v.c.human) ctx.hud.message(`${v.c.short}: ${fmtH(this.bar)} · ${v.c.type === 'touch' ? 'tap ◀ ▶' : 'tap left, right'} to run`, 'small', '#fff');
    else ctx.hud.message('');
    this.updateCard();
  }

  botUpdate(v, now) {
    const b = v.bot, a = this.va, pad = v.c.pad, B = BOT[this.ctx.skillName] || BOT.normal;
    if (this.phase === 'ready' && !b.started && this.t > b.go) { b.started = true; b.tap.start(now); }
    if ((this.phase === 'run' || this.phase === 'ready') && b.started) {
      b.tap.update(now, TARGET * B.cad, 0.08, 0.004);
      if (a.x >= b.plantAt && !a.planted) { pad.push('action', true, now); pad.push('action', false, now + 0.04); }
    }
    if (this.phase === 'swing') { b.tap.stop(); if (!b.pushed && a.u >= b.pushAt) { b.pushed = true; pad.push('action', true, now); pad.push('action', false, now + 0.04); } }
  }

  update(dt) {
    const ctx = this.ctx, now = ctx.time();
    this.t += dt;
    if (this.phase === 'pre') { for (const v of this.vaulters) ctx.presses(v.i); return; }
    if (this.phase === 'done') {
      for (const v of this.vaulters) ctx.presses(v.i);
      if (this.t > 1.6 && this.results) { const r = this.results; this.results = null; ctx.finish(r); }
      return;
    }
    const v = this.cur, a = this.va;
    if (v.bot) this.botUpdate(v, now);
    let q = [], skip = false;
    for (const x of this.vaulters) {
      const e = ctx.presses(x.i);
      if (x === v) q = e;
      if (x.c.human && e.some((y) => y.b === 'action' && y.down)) skip = true;
    }
    // watching a computer vaulter? ACTION skips straight to how it went
    if (v.bot && skip && (this.phase === 'ready' || this.phase === 'run')) { this.skipBot(); return; }
    if (this.phase === 'ready' || this.phase === 'run') {
      for (const e of q) {
        if (!e.down) continue;
        if (e.b === 'action') { if (a.started) this.plant(); continue; }
        const res = a.rhythm.press(e.b, e.t);
        if (!a.started) { a.started = true; this.phase = 'run'; this.t = 0; ctx.hud.message(''); }
        if (res === 'stumble') { a.v *= 0.85; ctx.sound.stumble(); } else ctx.sound.step(v.c.human ? 0.8 : 0.4);
      }
      if (this.phase === 'ready' && this.t > 12) { this.miss('Time up'); return; }
      if (a.started && this.phase === 'run') {
        const eff = a.rhythm.effort(now);
        a.v += (VMAX * eff - a.v) * (1 - Math.exp(-(VMAX * eff > a.v ? ACCEL : 1.2) * dt));
        a.x += a.v * dt;
        if (a.x > BOX_X - 5) { this.miss('Ran through!'); return; }
      }
    } else if (this.phase === 'swing') {
      for (const e of q) if (e.down && e.b === 'action' && a.pushQ == null) { a.pushQ = clamp(1 - Math.abs(a.u - PUSH_U) / 0.2, 0, 1); if (v.c.human) ctx.hud.flash(a.pushQ > 0.75 ? 'Great push!' : a.pushQ > 0.35 ? 'Push' : 'Off time', a.pushQ > 0.75 ? '#7be495' : '#fff'); }
      a.u += dt / SWING_T;
      if (a.u >= 1) this.release();
    } else if (this.phase === 'air') {
      a.vy -= G * dt; a.cx += a.vx * dt; a.cy += a.vy * dt; a.airT += dt;
      // over the bar: does the body clear it?
      if (!a.barDone && a.cx >= BAR_X - 1) { a.barDone = true; if (!a.clear) this.knockBar(); }
      if (a.cy <= 10 && a.vy < 0 && a.cx > BAR_X + 3) this.land();
      if (a.cy <= 4) this.land();
    } else if (this.phase === 'landed' || this.phase === 'miss') {
      if (skip && this.t > 0.6) this.t = Math.max(this.t, 2.0);
      if (this.t > 2.3) this.next();
    }
  }

  plant() {
    const a = this.va, ctx = this.ctx, v = this.cur;
    if (a.planted) return;
    a.planted = true;
    // the best plant is on the middle of the tape; the straw can't reach from far back
    const off = a.x - IDEAL;
    a.plantQ = clamp(1 - Math.abs(off) / 7, 0.15, 1);
    if (a.x < ZONE[0] - 10) a.plantQ = 0.1;
    a.px = a.x; a.speed = a.v;
    this.phase = 'swing'; this.t = 0; a.u = 0;
    ctx.sound.pop(); ctx.sound.whoosh(0.4);
    if (v.c.human) ctx.hud.flash(a.plantQ > 0.75 ? 'Great plant!' : off < 0 ? 'Planted early' : 'Planted late', a.plantQ > 0.75 ? '#7be495' : '#ff8a65');
  }

  release() {
    const a = this.va;
    const pushQ = a.pushQ ?? 0;
    // how high the body goes: speed into the straw, the plant, the push
    const e = (a.speed / VMAX) ** 2;
    a.height = Math.round((1.9 + 3.95 * e * (0.55 + 0.45 * a.plantQ) + 0.45 * pushQ) * 100) / 100;
    a.clear = a.height >= this.bar + 0.02;
    const top = this.handsAt(1);
    a.cx = top.x + 1; a.cy = top.y + 2.5;
    const peak = Math.max(a.cy + 0.5, a.height * U + 1.2);
    a.vy = Math.sqrt(2 * G * (peak - a.cy));
    const tPeak = a.vy / G;
    a.vx = clamp((BAR_X + 0.5 - a.cx) / Math.max(0.15, tPeak), 3, 30);
    a.airT = 0; a.barDone = false;
    this.phase = 'air'; this.t = 0;
  }

  skipBot() {
    const v = this.cur, a = this.va, B = BOT[this.ctx.skillName] || BOT.normal;
    v.bot.tap.stop();
    a.speed = VMAX * Math.min(1, B.cad) * (0.97 + 0.03 * this.r());
    a.plantQ = clamp(1 - Math.abs(this.r.gauss() * B.plant) / 7, 0.15, 1);
    a.pushQ = clamp(1 - Math.abs(this.r.gauss() * B.push) / 0.2, 0, 1);
    a.px = IDEAL; a.planted = true;
    const e = (a.speed / VMAX) ** 2;
    a.height = Math.round((1.9 + 3.95 * e * (0.55 + 0.45 * a.plantQ) + 0.45 * a.pushQ) * 100) / 100;
    a.clear = a.height >= this.bar + 0.02;
    if (!a.clear && a.height > this.bar - 0.6) this.knockBar();
    a.cx = BAR_X + 14; a.cy = 10; a.airT = 1;
    this.land();
  }

  knockBar() {
    this.barFall = { t: 0, vy: 0, y: this.barY + 0.35, rz: 0, dir: this.r() < 0.5 ? -1 : 1 };
    this.ctx.sound.clack(0); this.ctx.sound.aww();
  }

  land() {
    const a = this.va, v = this.cur, ctx = this.ctx;
    this.phase = a.clear ? 'landed' : 'miss'; this.t = 0;
    a.cy = Math.max(a.cy, 9);
    ctx.sound.thump(0.5);
    this.particles.emit(a.cx, 9, 0, { vx: 0, spread: 6, up: 3, color: 0xffffff, size: 0.8, life: 0.5, alpha: 0.5, grav: 8, n: 10 });
    if (a.clear) {
      v.best = this.bar; v.marks.push('O'); v.missesHere = 0;
      ctx.hud.message(`${fmtH(this.bar)} cleared!`, '', '#7be495');
      ctx.sound.cheer(1); ctx.sound.clap(8);
      v.fig.setExpression('wow');
    } else this.missMark(a.height < this.bar - 0.6 ? 'Under the bar' : 'Knocked it!');
    ctx.hud.chip(v.i, v.best != null ? fmtH(v.best) : '', 'active');
    this.updateCard();
  }

  miss(why) {
    const a = this.va;
    a.planted = true;
    this.cur.bot?.tap.stop();
    this.phase = 'miss'; this.t = 0;
    a.cx = null;
    this.missMark(why);
  }

  missMark(why) {
    const v = this.cur, ctx = this.ctx;
    v.marks.push('X'); v.missesHere++;
    if (v.missesHere >= MISSES) { v.out = true; ctx.hud.message(`${why} · out at ${fmtH(this.bar)}`, 'small', '#ff8a65'); } else { this.queue.push(v); ctx.hud.message(`${why} · one more go`, 'small', '#ff8a65'); }
    ctx.sound.aww();
    v.fig.setExpression('sad');
    this.updateCard();
  }

  finishAll() {
    this.phase = 'done'; this.t = 0;
    this.cur = null;
    this.placeWaiting();
    const ranked = [...this.vaulters].sort((a, b) => (b.best ?? -1) - (a.best ?? -1) || a.marks.filter((m) => m === 'X').length - b.marks.filter((m) => m === 'X').length);
    this.winner = ranked[0];
    this.ctx.hud.message(ranked[0].best != null ? `${ranked[0].c.short} wins with ${fmtH(ranked[0].best)}!` : 'No heights today!', 'small', '#ffc93c');
    this.guide.show(false);
    this.results = this.vaulters.map((v) => {
      const x = v.marks.filter((m) => m === 'X').length;
      return { value: v.best != null ? v.best * 1000 - x : null, dnf: v.best == null, text: v.best != null ? fmtH(v.best) : 'No height', short: v.best != null ? fmtH(v.best) : 'NH', sub: x ? `${x} miss${x > 1 ? 'es' : ''}` : 'no misses' };
    });
    this.updateCard();
  }

  placeWaiting() {
    this.vaulters.forEach((v) => {
      if (this.cur === v && this.phase !== 'done') return;
      v.fig.root.position.set(v.home.x, 0, v.home.z);
      v.fig.root.rotation.set(0, Math.PI / 2 - 0.8, 0);
      v.fig.ground = true;
    });
  }

  updateCard() {
    const v = this.cur;
    const humans = this.vaulters.some((x) => x.c.human);
    const line = v ? `Bar ${fmtH(this.bar)} · ${v.marks.slice(-6).join(' ') || 'first jump'}${v.bot && humans ? ' · action skips' : ''}` : 'Final heights';
    const ranked = [...this.vaulters].sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
    this.card.set(v ? v.c : null, line, ranked.map((x) => ({ c: x.c, text: x.best != null ? fmtH(x.best) : x.out ? 'NH' : '–', me: x === v, out: x.out })));
  }

  // ---------------------------------------------------------------- per frame
  // the straw during the swing: from the box towards the hands, bending and shortening
  handsAt(u) {
    const p0 = this.va.px ?? IDEAL;
    const a0 = Math.atan2(9.5, BOX_X - (p0 + 1.5));
    const ang = Math.PI - a0 + (Math.PI / 2 - 0.12 - (Math.PI - a0)) * (u * u * (3 - 2 * u));
    const bend = this.bendAt(u);
    const chord = PL * (bend > 0.01 ? Math.sin(bend / 2) / (bend / 2) : 1);
    return { x: BOX_X + Math.cos(ang) * chord, y: Math.sin(ang) * chord, ang, bend };
  }
  bendAt(u) { return 1.7 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (0.6 + 0.4 * (this.va.speed ?? VMAX) / VMAX); }

  setStraw(v, bx, by, dirAng, bend) {
    // the chain starts at the bottom end and curls by `bend` in total
    v.straw.position.set(bx, by, 0);
    v.straw.rotation.set(0, 0, dirAng - Math.PI / 2 - bend / 2);
    for (let k = 1; k < SEGS; k++) v.segs[k].rotation.z = bend / (SEGS - 1);
    v.segs[0].rotation.z = 0;
  }

  frame(dt, paused) {
    const ctx = this.ctx, tt = ctx.time();
    if (!paused) this.particles.update(dt);
    const cur = this.cur;
    this.vaulters.forEach((v) => {
      if (v === cur && this.phase !== 'done') return;
      const w = tt + v.idle;
      v.fig.setPose(this.phase === 'done' && v === this.winner ? POSES.cheer(w) : (Math.floor(w / 3) % 3) === 1 ? POSES.wave(w) : POSES.stand(w));
      // waiting vaulters hold their straw upright
      v.fig.root.updateMatrixWorld(true);
      const h = v.fig.arms[1].el.localToWorld(this.v3.set(0, -1.1, 0));
      this.setStraw(v, h.x, h.y - 6, Math.PI / 2, 0);
      v.straw.position.z = h.z;
    });
    if (cur && this.phase !== 'done') this.poseVaulter(cur, tt, dt, paused);
    // the bar falling off the pegs
    if (this.barFall && !paused) {
      const f = this.barFall;
      f.t += dt; f.vy -= G * dt; f.y = Math.max(0.4, f.y + f.vy * dt); f.rz += dt * 2 * f.dir;
      this.barMesh.position.set(BAR_X + f.t * 4, f.y, 0);
      this.barMesh.rotation.set(0, f.rz * 0.3, 0);
    }
    if (this.barFall && this.phase === 'ready') this.setBar(this.bar);
    this.crowd.update(tt, this.phase === 'air' ? 0.8 : this.phase === 'landed' ? 0.7 : 0.15);
    if (!paused) ctx.sound.setLoop('crowd', this.phase === 'air' ? 0.5 : 0.25);
    this.updateHud(tt);
    this.applyCamera(dt);
  }

  poseVaulter(v, tt, dt, paused) {
    const a = this.va, fig = v.fig, root = fig.root;
    root.rotation.set(0, Math.PI / 2, 0);
    if (this.phase === 'ready' || this.phase === 'run' || (this.phase === 'miss' && a.cx == null)) {
      fig.ground = true;
      root.position.set(a.x, 0, 0);
      if (!paused && a.v > 1) a.anim = (a.anim + Math.max(a.rhythm.cadence(tt), a.v / 6) * 0.5 * dt) % 1;
      const carry = { shR: 0.9, elR: 1.2, abR: 0.2, shL: 0.6, elL: 1.4, abL: 0.25 };
      const pose = this.phase === 'run' ? { ...POSES.run(a.anim, clamp(a.v / VMAX, 0.25, 1)), ...carry } : { ...POSES.stand(tt), ...carry };
      if (this.phase === 'miss') Object.assign(pose, POSES.stand(tt), { head: 0.4, lean: 0.15 });
      fig.setPose(pose);
      // the straw carried low in front, tip dropping as the box gets close
      fig.root.updateMatrixWorld(true);
      const h = fig.arms[1].el.localToWorld(this.v3.set(0, -1.1, 0));
      const drop = clamp((a.x - (ZONE[0] - 50)) / 50, 0, 1);
      const ang = 0.55 - 0.4 * drop;   // angle above the floor at the tip end
      const len = PL - 3;
      this.setStraw(v, h.x + Math.cos(ang) * len, Math.max(0.6, h.y - Math.sin(ang) * len), Math.PI - ang, 0);
      return;
    }
    fig.ground = false;
    let cx, cy, pitch, pose;
    if (this.phase === 'swing') {
      const u = a.u, hd = this.handsAt(u);
      // hanging below the hands, swinging the feet up and over
      pitch = -2.7 * (u * u * (3 - 2 * u));
      const hx = Math.sin(pitch), hy = Math.cos(pitch);
      cx = hd.x - 5.5 * hx; cy = hd.y - 5.5 * hy;
      this.setStraw(v, BOX_X, 0.3, hd.ang, hd.bend);
      const tuck = Math.sin(Math.PI * u);
      pose = { ...REST, shL: 3.0, shR: 3.0, elL: 0.1, elR: 0.1, abL: 0.05, abR: 0.05, hipL: 0.4 + 1.3 * tuck, hipR: 0.2 + 1.2 * tuck, kneeL: 0.6 + 0.9 * tuck, kneeR: 0.3 + 0.9 * tuck, head: 0.2 };
    } else {
      // over the bar and down onto the pillow
      if (this.phase === 'air') { cx = a.cx; cy = a.cy; } else { cx = a.cx; cy = a.cy; }
      const k = this.phase === 'air' ? clamp(a.airT / 0.9, 0, 1) : 1;
      pitch = -2.7 - 0.9 * k + (this.phase !== 'air' ? 0 : 0) + (k > 0.6 ? (k - 0.6) * 4.5 : 0);
      if (this.phase !== 'air') pitch = -1.7;
      const arch = this.phase === 'air' ? Math.sin(Math.PI * Math.min(1, k * 1.3)) : 0;
      pose = this.phase === 'air'
        ? { ...REST, lean: -0.4 * arch, shL: 2.4 - 1.4 * k, shR: 2.4 - 1.4 * k, abL: 0.6, abR: 0.6, hipL: -0.3 * arch + 0.9 * k, hipR: -0.3 * arch + 0.9 * k, kneeL: 0.8 * arch, kneeR: 0.8 * arch, head: 0.5 }
        : this.phase === 'landed' && this.t > 0.7 ? blendPose({ ...REST, shL: 2.8, shR: 2.8, abL: 0.5, abR: 0.5, hipL: 1.4, hipR: 1.4, kneeL: 0.3, kneeR: 0.3 }, POSES.cheer(tt), 0.5) : { ...REST, shL: 1.5, shR: 1.5, abL: 0.8, abR: 0.8, hipL: 1.2, hipR: 1.0, kneeL: 0.5, kneeR: 0.6 };
      // the straw springs back and falls away
      const fall = clamp((this.phase === 'air' ? a.airT : 1) * 1.6, 0, 1);
      this.setStraw(v, BOX_X - 1 - fall * 3, 0.3, Math.PI / 2 + 0.2 + fall * 1.2, 0);
    }
    pose.pitch = pitch;
    fig.setPose(pose);
    const COM = 4.1;
    root.position.set(cx - COM * Math.sin(pitch), cy - COM * Math.cos(pitch), 0);
  }

  updateHud(tt) {
    const v = this.cur, a = this.va, ph = this.phase;
    const show = v && v.c.human && (ph === 'ready' || ph === 'run' || ph === 'swing');
    this.guide.show(!!show);
    if (show) {
      const touch = v.c.type === 'touch', act = touch ? '●' : 'action';
      this.guide.tip(ph === 'swing' ? `tap ${act} as the straw straightens: push off!` : a.x > ZONE[0] - 30 ? `tap ${act} on the green tape to plant` : `tap ${touch ? '◀ ▶' : 'left, right'} in turn to run`);
      const e = clamp(a.v / VMAX, 0, 1);
      this.guide.bar('sp', e, { go: e > 0.9 });
    }
    if (v && v.c.human && ph === 'swing' && a.pushQ == null) {
      const near = Math.abs(a.u - PUSH_U) < 0.12;
      this.tags.set('push', `<span class="pill" style="--tc:${near ? '#7be495' : '#fff1d6'}">push!</span>`);
      const hd = this.handsAt(a.u);
      this.tags.place('push', hd.x - 6, hd.y + 4, 0);
    } else this.tags.hide('push');
  }

  applyCamera(dt) {
    const R = this.ctx.R, c = this.cam, ph = this.phase, a = this.va;
    let want;
    if (ph === 'swing' || ph === 'air' || ph === 'landed' || (ph === 'miss' && a && a.cx != null)) want = { x: BAR_X + 2, y: 15, z: 0, yaw: -0.78, pitch: 0.2, width: 100 };
    else if (ph === 'done') want = { x: RUN_X - 4, y: 6, z: -18, yaw: 0.25, pitch: 0.3, width: 70 };
    else { const ax = a ? a.x : RUN_X; want = { x: Math.min(ax + 24, BAR_X - 14), y: 7, z: 0, yaw: 0.2, pitch: 0.18, width: 78 }; }
    const rate = 3;
    for (const k of Object.keys(want)) c[k] = dt >= 1 ? want[k] : damp(c[k], want[k], rate, Math.min(dt, 0.1));
    R.orbit(c.x, c.y, c.z, { yaw: c.yaw, pitch: c.pitch, width: c.width, shadowSpan: Math.max(150, c.width * 1.8) });
    R.setFocus(0.5, 0.28, 0.85);
  }

  dispose() {
    for (const v of this.vaulters) v.fig.dispose();
    this.tags?.clear();
  }
}

export default {
  id: 'polevault', name: 'Pole vault', season: 'Summer',
  blurb: 'A bendy straw, a skewer bar on two rulers and a pillow to land on. The bar keeps going up.',
  venue: 'The playroom floor: a masking-tape runway, a matchbox to plant in, rulers and clothes pegs holding the bar.',
  loading: 'Bending the straws…',
  how: [
    { verb: 'Rhythm', text: 'Tap <b>left</b> and <b>right</b> in turn to run up: faster run, higher jump.' },
    { verb: 'Timing', text: 'Tap <b>action</b> on the <b>green tape</b> to plant the straw, then tap <b>action</b> again as it straightens to push off.' },
    { verb: 'Timing', text: 'The bar goes up 20 cm each round. Two misses at a height and you\'re out. The best height wins.' },
  ],
  better: 'higher',
  resultsDelay: 0.6,
  create: (ctx) => new PoleVault(ctx),
};
