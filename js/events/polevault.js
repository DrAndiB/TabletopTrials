// Pole vault: a bendy drinking straw, a skewer for a bar on two rulers, a pillow to land on.
// Tap LEFT/RIGHT in turn to run up, press and hold ACTION on the green tape to plant the straw, and let
// go of ACTION as the straw stands up straight to push off over the bar. The bar goes up 20 cm at a time; two misses
// at a height and you're out. The best height cleared wins.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, REST, blendPose } from '../figurine.js';
import { crowd, banner, floorMaterial } from '../props.js';
import { Rhythm, BotTapper } from '../verbs.js';
import { Particles } from '../fx.js';
import { clamp, damp, rng, makeNoise2D } from '../util.js';
import { fitRhythm, winFor, helped, sizeOf } from '../sizes.js';
import { hudKit, Card, Guide, Tags, Skipper, beatGauge } from './common.js';

const U = 4.75;                 // units per metre (a figurine is a 1.75 m vaulter)
const BOX_X = -2;               // where the straw plants
const BAR_X = 5;                // the bar, between the two rulers
const RUN_X = -80;
const ZONE = [-24, -10], IDEAL = -17;    // the plant tape, and the best spot on it
const TARGET = 6.5, VMAX = 31, ACCEL = 1.9;
const PL = 23;                  // the straw
const SWING_T = 1.05;
const PUSH_U = 0.7;             // the moment in the swing to let go: the straw stands upright
const PUSH_W = 0.22;            // how far either side of it still gives some push
const G = 30;
const START_H = 4.8, STEP = 0.2, MISSES = 2, TOP_H = 6.79;
// everyone has their own bar: smaller players open lower and go up 40 cm at a time below the grown-up opening height
const OPEN = { little: 3.2, kid: 4.0, big: START_H };
const nextBar = (h) => Math.round((h + (h < START_H - 0.01 ? 0.4 : STEP)) * 100) / 100;
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
        bar: OPEN[sizeOf(c).id] ?? START_H, little: c.human && helped(c),
        home: { x: RUN_X - 12 - (i % 2) * 7, z: -14 - i * 5 },
        bot: c.human ? null : { tap: new BotTapper(c.pad, rng(c.seed * 19 + 1)) },
      });
    });
    this.placeWaiting();
    const kit = hudKit(this.ctx);
    this.card = new Card(kit);
    this.guide = new Guide(kit, [{ key: 'sp', label: 'Speed' }]);
    this.tags = new Tags(kit, R);
    this.skipper = new Skipper(this.ctx, kit);
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
    // a round: everyone still in jumps once, each at their own bar
    if (!this.queue.length) {
      const left = this.vaulters.filter((v) => !v.out);
      if (!left.length) { this.finishAll(); return; }
      this.queue = left.slice();
    }
    const v = this.cur = this.queue.shift();
    if (v.bar !== this.bar) { this.setBar(v.bar); ctx.sound.clack(0); }
    this.va = { x: RUN_X, v: 0, rhythm: fitRhythm(new Rhythm({ target: TARGET }), v.c), started: false, anim: 0, plantQ: null, pushQ: null, planted: false, u: 0, note: null };
    if (!v.bot) this.skipper.update(false, false);
    this.phase = 'ready'; this.t = 0;
    this.placeWaiting();
    v.fig.setExpression('focus');
    if (v.little) v.autoPlant = IDEAL + 1 + this.r.gauss() * 2.5;
    if (v.bot) { const B = BOT[this.ctx.skillName] || BOT.normal; v.bot.go = 0.4 + this.r() * 0.4; v.bot.started = false; v.bot.plantAt = IDEAL + this.r.gauss() * B.plant; v.bot.pushAt = PUSH_U + this.r.gauss() * B.push; }
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
      if (a.x >= b.plantAt && !a.planted) pad.push('action', true, now);
    }
    if (this.phase === 'swing') { b.tap.stop(); if (a.u >= b.pushAt) pad.push('action', false, now); }
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
    // watching a computer vaulter: action fast-forwards
    this.skipper.update(!!v.bot, skip);
    if (a.note) a.note.t += dt;
    if (this.phase === 'ready' || this.phase === 'run') {
      for (const e of q) {
        if (e.b === 'action' && !v.little) { if (e.down && a.started) { this.plant(); break; } continue; }
        if (!e.down) continue;
        const res = a.rhythm.press(e.b, e.t);
        if (!a.started) { a.started = true; this.phase = 'run'; this.t = 0; ctx.hud.message(''); }
        if (res === 'stumble') { a.v *= 0.85; ctx.sound.stumble(); } else ctx.sound.step(v.c.human ? 0.8 : 0.4);
      }
      if (this.phase === 'ready' && this.t > 12) { this.miss('Time up'); return; }
      if (a.started && this.phase === 'run') {
        const eff = a.rhythm.effort(now);
        a.v += (VMAX * eff - a.v) * (1 - Math.exp(-(VMAX * eff > a.v ? ACCEL : 1.2) * dt));
        a.x += a.v * dt;
        if (v.little && a.x >= v.autoPlant) { this.plant(); return; }
        if (a.x > BOX_X - 5) { this.miss('Ran through!'); return; }
      }
    } else if (this.phase === 'swing') {
      // holding on through the swing; letting go is the push off the top of the straw
      a.u += dt / SWING_T;
      // a Little vaulter taps any button to push off (taps from the run-up don't count)
      const let_go = v.little ? a.u > 0.35 && q.some((e) => e.down) : q.some((e) => e.b === 'action' && !e.down) || !ctx.held(v.i).action;
      if ((let_go && a.u > 0.06) || a.u >= 1.15) this.release();
    } else if (this.phase === 'air') {
      a.vy -= G * dt; a.cx += a.vx * dt; a.cy += a.vy * dt; a.airT += dt;
      // over the bar: does the body clear it?
      if (!a.barDone && a.cx >= BAR_X - 0.5) { a.barDone = true; if (!a.clear) this.knockBar(); }
      if (a.cy <= 10.2 && a.vy < 0 && a.cx > BAR_X + 3) this.land();
      if (a.cy <= 4) this.land();
    } else if (this.phase === 'landed' || this.phase === 'miss') {
      if (skip && this.t > 0.6) this.t = Math.max(this.t, 2.0);
      if (this.t > 2.6) this.next();
    }
  }

  plant() {
    const a = this.va, ctx = this.ctx, v = this.cur;
    if (a.planted) return;
    a.planted = true;
    // the best plant is in the middle of the tape; the straw can't reach from far back
    const off = a.x - IDEAL;
    a.plantQ = clamp(1 - Math.abs(off) / winFor(v.c, 9), 0.15, 1);
    if (a.x < ZONE[0] - 10) a.plantQ = 0.1;
    a.px = a.x; a.speed = a.v; a.relU = null;
    this.phase = 'swing'; this.t = 0; a.u = 0;
    ctx.sound.pop(); ctx.sound.whoosh(0.4);
    if (v.c.human) a.note = { text: a.plantQ > 0.75 ? 'great plant!' : off < 0 ? 'planted early' : 'planted late', col: a.plantQ > 0.75 ? '#7be495' : '#ff8a65', t: 0 };
  }

  release() {
    const a = this.va, v = this.cur, ctx = this.ctx;
    a.relU = Math.min(1, a.u);
    a.pushQ = clamp(1 - Math.abs(a.relU - PUSH_U) / winFor(v.c, PUSH_W), 0, 1);
    if (v.c.human) a.note = { text: a.pushQ > 0.75 ? 'great push!' : a.relU < PUSH_U ? 'let go early' : 'let go late', col: a.pushQ > 0.75 ? '#7be495' : a.pushQ > 0.35 ? '#ffc93c' : '#ff8a65', t: 0 };
    // how high the body goes: speed into the straw, the plant, the push
    const e = (a.speed / VMAX) ** 2;
    a.height = Math.round((1.9 + 3.95 * e * (0.55 + 0.45 * a.plantQ) + 0.45 * a.pushQ) * 100) / 100;
    a.clear = a.height >= this.bar + 0.02;
    const top = this.handsAt(a.relU);
    a.p0 = this.swingPitch(a.relU);
    a.cx = top.x - 5.5 * Math.sin(a.p0); a.cy = top.y - 5.5 * Math.cos(a.p0);
    // the body rises to its peak over the bar, then drops onto the pillow
    const peak = Math.max(a.cy + 0.5, a.height * U + 0.8);
    a.vy = Math.sqrt(2 * G * (peak - a.cy));
    a.tPeak = a.vy / G;
    a.vx = clamp((BAR_X + 0.5 - a.cx) / Math.max(0.15, a.tPeak), 2, 30);
    a.airT = 0; a.barDone = false;
    this.phase = 'air'; this.t = 0;
    ctx.sound.whoosh(0.5);
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
      v.bar = nextBar(v.bar);
      if (v.bar > TOP_H) v.out = true;   // the rulers don't go any higher
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
    if (v.missesHere >= MISSES) { v.out = true; ctx.hud.message(`${why} · ${v.best != null ? `best ${fmtH(v.best)}` : `out at ${fmtH(this.bar)}`}`, 'small', '#ff8a65'); } else ctx.hud.message(`${why} · one more go next round`, 'small', '#ff8a65');
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
    const line = v ? `Bar ${fmtH(this.bar)} · ${v.marks.slice(-6).join(' ') || 'first jump'}${v.bot && humans ? ' · action: fast-forward' : ''}` : 'Final heights';
    const ranked = [...this.vaulters].sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
    this.card.set(v ? v.c : null, line, ranked.map((x) => ({ c: x.c, text: x.best != null ? fmtH(x.best) : x.out ? 'NH' : '–', me: x === v, out: x.out })));
  }

  // ---------------------------------------------------------------- per frame
  // the straw during the swing: from the box towards the hands, bending and shortening
  // the straw during the swing: from the box towards the hands, standing up straight at PUSH_U
  handsAt(u) {
    const p0 = this.va.px ?? IDEAL;
    const a0 = Math.atan2(9.5, BOX_X - (p0 + 1.5));
    const k = Math.min(1, u / PUSH_U), sm = k * k * (3 - 2 * k);
    const ang = Math.PI - a0 + (Math.PI / 2 - (Math.PI - a0)) * sm - 0.4 * Math.max(0, u - PUSH_U);
    const bend = this.bendAt(u);
    const chord = PL * (bend > 0.01 ? Math.sin(bend / 2) / (bend / 2) : 1);
    return { x: BOX_X + Math.cos(ang) * chord, y: Math.sin(ang) * chord, ang, bend };
  }
  bendAt(u) { return 1.7 * Math.sin(Math.PI * Math.min(1, u / PUSH_U)) * (0.6 + 0.4 * (this.va.speed ?? VMAX) / VMAX); }
  // the body's tilt in the swing: hang, rock back, then upside down along the straw
  swingPitch(u) { const k = Math.min(1, u / PUSH_U), sm = k * k * (3 - 2 * k); return -2.95 * sm - 0.25 * Math.max(0, u - PUSH_U); }

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
    fig.body.rotation.y = 0;
    if (this.phase === 'ready' || this.phase === 'run' || (this.phase === 'miss' && a.cx == null)) {
      fig.ground = true;
      root.position.set(a.x, 0, 0);
      if (!paused && a.v > 1) a.anim = (a.anim + Math.max(a.rhythm.cadence(tt), a.v / 6) * 0.5 * dt) % 1;
      // both hands on the straw at hip height, the right one behind
      const carry = { shR: 0.75, elR: 1.0, abR: 0.25, shL: 0.9, elL: 0.9, abL: 0.2 };
      const pose = this.phase === 'run' ? { ...POSES.run(a.anim, clamp(a.v / VMAX, 0.25, 1)), ...carry } : { ...POSES.stand(tt), ...carry };
      if (this.phase === 'miss') Object.assign(pose, POSES.stand(tt), { head: 0.4, lean: 0.15 });
      fig.setPose(pose);
      // the straw carried tip-up at the start, lowered towards the box on the way in
      fig.root.updateMatrixWorld(true);
      const h = fig.arms[1].el.localToWorld(this.v3.set(0, -1.1, 0));
      const drop = this.phase === 'run' ? clamp((a.x - (RUN_X + 12)) / (ZONE[1] - (RUN_X + 12)), 0, 1) ** 1.6 : 0;
      const ang = 1.15 - 1.28 * drop;
      this.setStraw(v, h.x - Math.cos(ang) * 3, h.y - Math.sin(ang) * 3, ang, 0);
      return;
    }
    fig.ground = false;
    let cx, cy, pitch, twist = 0, pose;
    if (this.phase === 'swing') {
      const u = a.u, hd = this.handsAt(u);
      pitch = this.swingPitch(u);
      cx = hd.x - 5.5 * Math.sin(pitch); cy = hd.y - 5.5 * Math.cos(pitch);
      this.setStraw(v, BOX_X, 0.3, hd.ang - hd.bend / 2 + hd.bend / 2, hd.bend);
      // take-off with the knee up, rock back with the hips bent, then straighten up along the straw
      const k = Math.min(1, u / PUSH_U);
      const rock = Math.sin(Math.PI * clamp((k - 0.15) / 0.75, 0, 1));
      pose = { ...REST, shL: 3.0, shR: 3.0, elL: 0.1, elR: 0.15, abL: 0.05, abR: 0.05, head: 0.25 * rock,
        hipL: 0.25 + 1.5 * rock + (k < 0.2 ? 0.9 * (1 - k / 0.2) : 0), hipR: 0.1 + 1.4 * rock, kneeL: 0.3 + 1.2 * rock * (1 - k), kneeR: 0.2 + 0.4 * rock * (1 - k), ankL: -0.4, ankR: -0.4 };
    } else if (this.phase === 'air') {
      // the turn on the way up (to face the bar), over the bar arched face-down, then rolling onto the back
      cx = a.cx; cy = a.cy;
      const up = clamp(a.airT / Math.max(0.1, a.tPeak), 0, 1), down = clamp((a.airT - a.tPeak) / 0.65, 0, 1);
      pitch = a.airT < a.tPeak ? a.p0 + (-Math.PI - a.p0) * up : -Math.PI + (Math.PI / 2 + 0.2) * down;
      twist = Math.PI * (up * up * (3 - 2 * up)) + Math.PI * down;
      const arch = Math.sin(Math.PI * clamp((a.airT - a.tPeak * 0.6) / 0.6, 0, 1));
      pose = { ...REST, lean: -0.55 * arch, head: 0.5 * arch, shL: 2.9 - 1.6 * down, shR: 2.9 - 1.6 * down, abL: 0.3 + 0.5 * down, abR: 0.3 + 0.5 * down, elL: 0.2, elR: 0.2,
        hipL: -0.3 * arch + 0.7 * down, hipR: -0.3 * arch + 0.7 * down, kneeL: 0.6 * arch + 0.4 * down, kneeR: 0.6 * arch + 0.4 * down };
      // the straw springs back and falls away
      const fall = clamp(a.airT * 1.6, 0, 1);
      this.setStraw(v, BOX_X - 1 - fall * 3, 0.3, Math.PI / 2 + 0.2 + fall * 1.2, 0);
    } else {
      // on the pillow, on the back: arms up for a clearance, hands on the head for a miss
      cx = a.cx; cy = Math.max(a.cy, 10.2);
      pitch = -Math.PI / 2 - 0.15; twist = 0;
      const happy = this.phase === 'landed' && this.t > 0.5;
      pose = happy ? { ...REST, shL: 2.7 + 0.25 * Math.sin(tt * 7), shR: 2.7 - 0.25 * Math.sin(tt * 7), abL: 0.6, abR: 0.6, elL: 0.3, elR: 0.3, hipL: 0.5, hipR: 0.4, kneeL: 0.6, kneeR: 0.5 }
        : { ...REST, shL: 2.4, shR: 2.4, elL: 2.0, elR: 2.0, abL: 0.9, abR: 0.9, hipL: 0.8, hipR: 0.6, kneeL: 1.0, kneeR: 0.8, head: 0.3 };
      this.setStraw(v, BOX_X - 4, 0.3, Math.PI / 2 + 1.4, 0);
    }
    pose.pitch = pitch;
    fig.setPose(pose);
    fig.body.rotation.y = twist;
    const COM = 4.1;
    root.position.set(cx - COM * Math.sin(pitch), cy - COM * Math.cos(pitch), 0);
  }

  updateHud(tt) {
    const v = this.cur, a = this.va, ph = this.phase;
    const show = v && v.c.human && (ph === 'ready' || ph === 'run' || ph === 'swing');
    this.guide.show(!!show);
    if (show) {
      const touch = v.c.type === 'touch', act = touch ? '●' : 'action';
      this.guide.tip(v.little ? (ph === 'swing' ? 'tap any button when the needle is in the green' : 'tap any button on a steady beat: the straw goes in by itself')
        : ph === 'swing' ? `keep holding ${act}, let go when the needle is in the green` : a.x > ZONE[0] - 30 ? `on the green tape: press and hold ${act} to plant` : `tap ${touch ? '◀ ▶' : 'left, right'} in turn to run`);
      const e = clamp(a.v / VMAX, 0, 1);
      this.guide.bar('sp', e, { go: e > 0.9 });
    }
    if (!v || !v.c.human || !a) { this.tags.hide('pv'); this.tags.hide('pvr'); return; }
    if (ph !== 'run' && ph !== 'ready') this.tags.hide('pvr');
    const note = a.note && a.note.t < 0.9 ? `<span class="pill" style="--tc:${a.note.col}">${a.note.text}</span><br>` : '';
    if (ph === 'swing') {
      // the let-go gauge: a half dial, the needle sweeping round with the swing
      const pw = winFor(v.c, 0.09), u = clamp(a.u / 1.15, 0, 1), lo = (PUSH_U - pw) / 1.15, hi = Math.min(1, (PUSH_U + pw) / 1.15);
      const arcPt = (k) => `${(-Math.cos(Math.PI * k) * 40).toFixed(1)} ${(-Math.sin(Math.PI * k) * 40).toFixed(1)}`;
      const inZone = a.u >= PUSH_U - pw && a.u <= PUSH_U + pw;
      const nd = arcPt(u);
      const svg = `<svg width="104" height="60" viewBox="-52 -50 104 60"><path d="M-40 0 A40 40 0 0 1 40 0" fill="none" stroke="#fff1d6" stroke-width="12"/><path d="M${arcPt(lo)} A40 40 0 0 1 ${arcPt(hi)}" fill="none" stroke="#2fae5a" stroke-width="12"/><path d="M-40 0 A40 40 0 0 1 40 0" fill="none" stroke="#1f1a17" stroke-width="2.5" transform="scale(1.16)"/><line x1="0" y1="0" x2="${nd.split(' ')[0]}" y2="${nd.split(' ')[1]}" stroke="#1f1a17" stroke-width="5" stroke-linecap="round"/><circle r="5" fill="#1f1a17"/></svg>`;
      this.tags.set('pv', `${note}${svg}<br><span class="pill big" style="--tc:${inZone ? '#7be495' : '#fff1d6'}">${inZone ? (v.little ? 'tap now!' : 'let go!') : a.u < PUSH_U ? (v.little ? 'wait…' : 'hold…') : 'too late!'}</span>`);
      const hd = this.handsAt(a.u);
      this.tags.place('pv', hd.x - 14, hd.y + 2, 0, 'center');
    } else if (ph === 'run' || ph === 'ready') {
      // the plant ring: it closes on the runner's feet as they reach the best spot on the tape
      const d = IDEAL - a.x, near = d < 34 && d > -10 && !a.planted && !v.little;
      const good = Math.abs(d) < winFor(v.c, 3);
      const pill = near ? `<span class="pill${good ? ' big' : ''}" style="--tc:${good ? '#7be495' : '#fff1d6'}">${good ? 'plant now: hold!' : d > 0 ? 'plant when the ring closes' : 'plant!'}</span>` : '';
      // until the tape is close: how the run-up beat is going
      const beat = !near && a.started ? beatGauge(a.rhythm.ratio(this.ctx.time())) : '';
      this.tags.set('pv', `${note}${pill}${beat}`);
      this.tags.place('pv', a.x, 13, 0);
      if (near) {
        const rr = 14 + Math.min(40, Math.abs(d) * 1.4);
        this.tags.set('pvr', `<svg width="120" height="120" viewBox="-60 -60 120 120"><circle r="14" fill="rgba(123,228,149,.35)" stroke="#2fae5a" stroke-width="4"/><circle r="${rr.toFixed(1)}" fill="none" stroke="${good ? '#2fae5a' : '#1f1a17'}" stroke-width="4"/></svg>`);
        this.tags.place('pvr', a.x, 0.5, 0, 'center');
      } else this.tags.hide('pvr');
      return;
    } else if (note) { this.tags.set('pv', note); this.tags.place('pv', a.cx ?? a.x, (a.cy ?? 8) + 8, 0); } else this.tags.hide('pv');
  }

  applyCamera(dt) {
    const R = this.ctx.R, c = this.cam, ph = this.phase, a = this.va;
    let want;
    if (ph === 'swing' || ph === 'air' || ph === 'landed' || (ph === 'miss' && a && a.cx != null)) want = { x: BAR_X + 2, y: 18, z: 0, yaw: -0.78, pitch: 0.2, width: 94 };
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
    { verb: 'Timing', text: 'On the <b>green tape</b>, press and <b>hold action</b> to plant the straw. Keep holding, and <b>let go</b> when the needle beside you is in the green: that pushes you off the top.' },
    { verb: 'Timing', text: 'Everyone has their own bar: it goes up each time you clear it (20 cm from 4.80 m). Two misses at a height and you\'re out. The best height wins.' },
  ],
  helpers: {
    little: 'Tap <b>any button</b> on a steady beat to run: the straw goes in <b>by itself</b>. Then tap when the needle is in the green. Your bar starts at 3.20 m.',
    kid: 'Your bar starts at 4.00 m, and the green tape and the needle are wider.',
  },
  better: 'higher',
  resultsDelay: 0.6,
  create: (ctx) => new PoleVault(ctx),
};
