// Halfpipe: a big sheet of cardboard bent into a U between two walls of books, dusted with icing sugar,
// ridden on a lolly-stick snowboard. Tap ACTION to drop in and to pump each time you cross the flat
// bottom (higher next air). In the air, hold LEFT or RIGHT to spin (letting go finishes the half turn)
// and hold ACTION to grab. Land with the spin finished and the grab let go. Two runs, the better counts.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, REST, blendPose } from '../figurine.js';
import { banner } from '../props.js';
import { Particles } from '../fx.js';
import { clamp, damp, rng, makeNoise2D, TAU } from '../util.js';
import { winFor, helped } from '../sizes.js';
import { hudKit, Card, Guide, Tags, Skipper } from './common.js';
import { robotCrowd, glowTexture } from '../venues.js';

const FB = 14, RP = 22, VW = 4;       // flat bottom width, transition radius, vertical wall above it
const H = RP + VW;                    // lip height
const QT = FB / 2 + (Math.PI / 2) * RP, QL = QT + VW;   // where the transition ends, and the lip (along the surface)
const ZL = FB / 2 + RP;               // how far the walls are from the middle
const LEN = 290, X0 = 14, XEND = LEN - 16, DRIFT = 11.5;
const G = 36, LOSS = 1.3, PUMP = 5.5, EMAX = H + 20;
const DROP = 7;                       // dropping in from the start box gives this much air straight away
const PUMP_W = FB / 2 + 4;            // the pump works on the flat and the foot of the walls
const SPIN = 1.6;                     // turns per second while spinning
const RUNS = 2;
const SPIN_PTS = { 0: 0, 1: 4, 2: 9, 3: 15, 4: 22, 5: 30, 6: 40 };   // by half turns
// computer riders: pump quality, share of the possible spin they go for, grab chance, mistake chance
const BOT = {
  easy: { pump: [0.35, 0.25], spin: 0.25, grab: 0.1, land: 0.25 },
  normal: { pump: [0.5, 0.2], spin: 0.4, grab: 0.25, land: 0.15 },
  hard: { pump: [0.78, 0.12], spin: 0.7, grab: 0.5, land: 0.08 },
};

// the U: position (z, y) and wall angle at a distance q along the surface from the middle (+q = right)
function surf(q) {
  const s = Math.sign(q) || 1, a = Math.abs(q);
  if (a <= FB / 2) return { z: q, y: 0, ang: 0 };
  if (a <= QT) { const t = (a - FB / 2) / RP; return { z: s * (FB / 2 + RP * Math.sin(t)), y: RP * (1 - Math.cos(t)), ang: s * t }; }
  return { z: s * (FB / 2 + RP), y: RP + (a - QT), ang: s * Math.PI / 2 };
}

class Halfpipe {
  constructor(ctx) {
    this.ctx = ctx;
    this.r = ctx.rand;
    this.phase = 'pre';
    this.t = 0;
    this.cam = { x: 60, y: 18, z: 0, yaw: Math.PI / 2, pitch: 0.3, width: 100 };
    this.riders = [];
    this.turn = -1; this.run = 1;
  }

  async build() {
    const { kit: K, R, competitors } = this.ctx;
    // the garage on a winter evening: cool strip lights overhead, snow blowing past the door
    R.setLighting({
      sunDir: [0.15, 1, 0.25], sunColor: 0xf2f6ff, sunIntensity: 2.1,
      hemiSky: 0xd6e2f2, hemiGround: 0x4a4440, hemiIntensity: 0.62,
      envIntensity: 0.5, exposure: 0.98, background: 0x15181e, shadowRadius: 3,
    });
    this.noise = makeNoise2D(29);
    this.buildRoom(K);
    this.buildPipe(K);
    this.buildCrowd(K, competitors);
    this.particles = new Particles(K.group, 700);
    this.particles.setScale(R.renderer.domElement.height * 0.9);
    const boardGeo = K.merge([
      { geo: new K.RoundedBoxGeometry(9.5, 0.45, 2.3, 2, 0.2), color: 0xe9d3a0 },
      { geo: new THREE.BoxGeometry(0.6, 0.5, 1.6), color: 0x1f1a17, pos: [-2.2, 0.3, 0] },
      { geo: new THREE.BoxGeometry(0.6, 0.5, 1.6), color: 0x1f1a17, pos: [2.2, 0.3, 0] },
    ]);
    competitors.forEach((c, i) => {
      const fig = new Figurine({ paint: c.paint, seed: c.seed, number: c.number });
      fig.setGear('helmet');
      const rig = new THREE.Group(), spin = new THREE.Group();
      rig.add(spin); spin.add(fig.root);
      const board = new THREE.Mesh(boardGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, clearcoat: 0.5 }));
      board.castShadow = true;
      // a stripe in the team colour along the board
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(7, 0.05, 0.7), K.paint(c.paint.shirt));
      stripe.position.y = 0.25; board.add(stripe);
      spin.add(board);
      K.group.add(rig);
      this.riders.push({ c, i, fig, rig, spin, board, runs: [], best: 0, idle: this.r() * 10, home: { x: X0 - 6 - i * 7, z: -(ZL + 12), y: H + 0.6 }, bot: c.human ? null : { r: rng(c.seed * 43 + 1) } });
    });
    this.placeWaiting();
    const kit = hudKit(this.ctx);
    this.card = new Card(kit);
    this.guide = new Guide(kit, [{ key: 'en', label: 'Height' }]);
    this.tags = new Tags(kit, R);
    this.skipper = new Skipper(this.ctx, kit);
    this.applyCamera(1);
  }

  buildRoom(K) {
    const g = K.group;
    // a grey concrete floor with an oil stain, a painted parking line, pegboard on the back wall
    const fc = K.TX.makeCanvas(512), f = fc.getContext('2d');
    f.fillStyle = '#8f9196'; f.fillRect(0, 0, 512, 512);
    const img = f.getImageData(0, 0, 512, 512), d = img.data;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) { const k = (y * 512 + x) * 4, v = 0.88 + 0.12 * this.noise.noise(x * 0.04, y * 0.04) + (Math.random() - 0.5) * 0.06; d[k] *= v; d[k + 1] *= v; d[k + 2] *= v; }
    f.putImageData(img, 0, 0);
    f.strokeStyle = 'rgba(60,60,64,0.6)'; f.lineWidth = 2; f.beginPath(); f.moveTo(256, 0); f.lineTo(256, 512); f.moveTo(0, 256); f.lineTo(512, 256); f.stroke();
    const conc = new THREE.Mesh(new THREE.PlaneGeometry(800, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(fc, { repeat: [4, 3] }), roughness: 0.85 }));
    conc.position.set(LEN / 2, 0, 0); conc.receiveShadow = true; g.add(conc);
    const stain = new THREE.Mesh(new THREE.CircleGeometry(22, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.25, transparent: true, opacity: 0.45, polygonOffset: true, polygonOffsetFactor: -2 }));
    stain.position.set(LEN + 50, 0.1, 60); stain.scale.set(1.4, 1, 0.8); g.add(stain);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(600, 4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.position.set(LEN / 2, 0.1, 80); g.add(line);
    // the back wall: pegboard with tools hung on it
    const pc = K.TX.makeCanvas(256), p2 = pc.getContext('2d');
    p2.fillStyle = '#c49a6c'; p2.fillRect(0, 0, 256, 256); p2.fillStyle = '#5e4630';
    for (let y = 8; y < 256; y += 16) for (let x = 8; x < 256; x += 16) { p2.beginPath(); p2.arc(x, y, 2.4, 0, TAU); p2.fill(); }
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(800, 260), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(pc, { repeat: [24, 8] }), roughness: 0.9 }));
    wall.position.set(LEN / 2, 130, -160); wall.receiveShadow = true; g.add(wall);
    const wall2 = new THREE.Mesh(new THREE.PlaneGeometry(600, 260), K.std({ color: 0xb8bcc2, roughness: 0.95 }));
    wall2.position.set(-60, 130, 0); wall2.rotation.y = Math.PI / 2; g.add(wall2);
    const tool = (x, y, parts) => { const m = new THREE.Mesh(K.merge(parts), K.std({ vertexColors: true, roughness: 0.45, metalness: 0.4 })); m.position.set(x, y, -158); m.castShadow = true; g.add(m); };
    const steel = 0xc8ccd2;
    // hammer, spanners, saw, screwdrivers
    tool(30, 120, [{ geo: new THREE.BoxGeometry(3, 30, 2), color: 0xb5473a }, { geo: new THREE.BoxGeometry(14, 5, 3), color: steel, pos: [0, 16, 0] }]);
    for (let k = 0; k < 4; k++) tool(56 + k * 8, 112 + k * 2, [{ geo: new THREE.BoxGeometry(2.4, 22 + k * 4, 1), color: steel }, { geo: new THREE.TorusGeometry(2.4 + k * 0.3, 0.8, 6, 12), color: steel, pos: [0, 12 + k * 2, 0] }]);
    tool(130, 116, [{ geo: new THREE.BoxGeometry(40, 12, 0.6), color: steel }, { geo: new THREE.BoxGeometry(10, 10, 2.4), color: 0x2f6fe0, pos: [24, 1, 0] }]);
    for (let k = 0; k < 5; k++) tool(176 + k * 7, 118, [{ geo: new THREE.CylinderGeometry(1.4, 1.4, 9, 10), color: [0xd9472b, 0xf2c230, 0x2fae5a, 0x2f6fe0, 0x2b2622][k], pos: [0, 4, 0] }, { geo: new THREE.CylinderGeometry(0.4, 0.4, 12, 6), color: steel, pos: [0, -6, 0] }]);
    // a workbench along the back with paint tins and a vice
    const bench = new THREE.Mesh(new THREE.BoxGeometry(180, 4, 36), K.std({ color: 0xa47b5a, roughness: 0.7 })); bench.position.set(110, 50, -140); bench.castShadow = true; bench.receiveShadow = true; g.add(bench);
    for (const x of [26, 194]) for (const z of [-154, -126]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(4, 48, 4), K.std({ color: 0x7a5a3e })); leg.position.set(x, 24, z); g.add(leg); }
    [[0xd9472b, 60], [0x2f6fe0, 74], [0xf2c230, 88], [0xf7f2e8, 160]].forEach(([col, x], k) => {
      const tin = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 9, 20), K.metal(0xc8ccd2, 0.35)); tin.position.set(x, 56.5, -136 + (k % 2) * 6); tin.castShadow = true; g.add(tin);
      const lab = new THREE.Mesh(new THREE.CylinderGeometry(5.05, 5.05, 5, 20, 1, true), K.paint(col)); lab.position.copy(tin.position); g.add(lab);
      const drip = new THREE.Mesh(new THREE.SphereGeometry(5.05, 16, 6, 0, TAU, 0, 0.5), K.paint(col)); drip.position.set(x, 61, tin.position.z); g.add(drip);
    });
    // the garage door on the right, open a crack, snow blowing in under it and the evening outside
    const dc = K.TX.makeCanvas(256), d2 = dc.getContext('2d');
    d2.fillStyle = '#e9ebee'; d2.fillRect(0, 0, 256, 256); d2.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < 256; y += 32) d2.fillRect(0, y, 256, 4);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(300, 150), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(dc, { repeat: [1, 1] }), roughness: 0.6, metalness: 0.3 }));
    door.position.set(LEN + 120, 102, 0); door.rotation.y = -Math.PI / 2; g.add(door);
    const gap = new THREE.Mesh(new THREE.PlaneGeometry(300, 27), new THREE.MeshBasicMaterial({ color: 0x24305a }));
    gap.position.set(LEN + 120.2, 13.5, 0); gap.rotation.y = -Math.PI / 2; g.add(gap);
    this.doorX = LEN + 116;
    // two fluorescent strip lights hanging over the pipe
    this.strips = [];
    for (const x of [LEN * 0.3, LEN * 0.7]) {
      const housing = new THREE.Mesh(new K.RoundedBoxGeometry(80, 3, 8, 2, 1), K.paint(0xf7f2e8)); housing.position.set(x, 116, 0); g.add(housing);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 76, 12).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf4f8ff })); tube.position.set(x, 113.4, 0); g.add(tube);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xdfeaff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })); glow.position.set(x, 112, 0); glow.scale.set(110, 36, 1); g.add(glow);
      for (const sx of [-30, 30]) { const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 40, 4), K.metal(0x8a8e94, 0.4)); ch.position.set(x + sx, 136, 0); g.add(ch); }
      this.strips.push({ tube, glow });
    }
    // a bike leaning on the side wall
    const bike = new THREE.Group(); bike.position.set(-48, 0, -92); bike.rotation.y = Math.PI / 2 + 0.15; g.add(bike);
    const red = K.paint(0xd9472b), blk = K.std({ color: 0x1f1a17, roughness: 0.6 });
    for (const x of [-22, 22]) { const w = new THREE.Mesh(new THREE.TorusGeometry(14, 1.6, 8, 32), blk); w.position.set(x, 15.6, 0); w.castShadow = true; bike.add(w); const hub = new THREE.Mesh(new THREE.TorusGeometry(13, 0.25, 4, 24), K.metal(0xc8ccd2, 0.3)); hub.position.copy(w.position); bike.add(hub); }
    const bar = (len, x, y, rz) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, len, 8), red); m.position.set(x, y, 0); m.rotation.z = rz; m.castShadow = true; bike.add(m); };
    bar(30, 0, 28, Math.PI / 2); bar(24, -12, 22, -0.75); bar(26, 10, 22, 0.75); bar(18, -20, 22, 0.25);
    const saddle = new THREE.Mesh(new K.RoundedBoxGeometry(9, 2, 4, 2, 0.8), blk); saddle.position.set(-16, 32, 0); bike.add(saddle);
    const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 16, 8).rotateX(Math.PI / 2), blk); hb.position.set(18, 36, 0); bike.add(hb);
  }

  buildPipe(K) {
    const g = K.group;
    // the U profile, from the left lip to the right lip
    const prof = [];
    for (let q = -QL; q <= QL + 0.01; q += 1) prof.push(surf(q));
    const pos = [], uv = [], idx = [];
    const NX = 54;
    for (let i = 0; i <= NX; i++) {
      const x = (LEN * i) / NX;
      prof.forEach((p, j) => { pos.push(x, p.y + 0.6, p.z); uv.push(j / (prof.length - 1), x / 40); });
    }
    const M = prof.length;
    for (let i = 0; i < NX; i++) for (let j = 0; j < M - 1; j++) { const a = i * M + j, b = a + M; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    // icing sugar over cardboard: white, with brown showing through towards the lips
    const C = 256, cc = K.TX.makeCanvas(C), c = cc.getContext('2d');
    const img = c.createImageData(C, C);
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const k = (y * C + x) * 4, u = x / C, n = this.noise.noise(x * 0.06, y * 0.06);
      const edge = Math.abs(u - 0.5) * 2;
      const snow = clamp(1.25 - edge * 0.9 + (n - 0.5) * 0.6, 0, 1);
      img.data[k] = 190 + (246 - 190) * snow; img.data[k + 1] = 150 + (248 - 150) * snow; img.data[k + 2] = 108 + (252 - 108) * snow; img.data[k + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    const pipe = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: K.TX.toTexture(cc), roughness: 0.85, side: THREE.DoubleSide }));
    pipe.receiveShadow = true; pipe.castShadow = true; g.add(pipe);
    // the pump zone on the flat bottom: a strip of blue sugar
    const pz = new THREE.Mesh(new THREE.PlaneGeometry(LEN, FB - 3).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8fc1e3, roughness: 0.9, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }));
    pz.position.set(LEN / 2, 0.65, 0); g.add(pz);
    // pencils for coping along both lips, walls of books holding the cardboard up, decks on top
    for (const s of [-1, 1]) {
      const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, LEN, 8).rotateZ(Math.PI / 2), K.paint(s > 0 ? 0x3d7bd9 : 0xf2c230));
      pen.position.set(LEN / 2, H + 0.6, s * (FB / 2 + RP + 0.9)); pen.castShadow = true; g.add(pen);
      const deck = new THREE.Mesh(new K.RoundedBoxGeometry(LEN, 2, 22, 2, 0.8), K.std({ color: 0xc8a06a, roughness: 0.8 }));
      deck.position.set(LEN / 2, H - 0.4, s * (FB / 2 + RP + 12)); deck.castShadow = true; deck.receiveShadow = true; g.add(deck);
    }
    const books = [], cols = [0xb5473a, 0x2f4f7a, 0x2fae5a, 0xf2c230, 0x8a55c9, 0xef7d2c, 0x3d7bd9, 0x9c6b3f];
    for (const s of [-1, 1]) for (let x = 6; x < LEN; x += 24) {
      const n = Math.round((H - 1.4) / 2.6), th = (H - 1.4) / n;
      for (let k = 0; k < n; k++) books.push({ x: x + (this.r() - 0.5) * 1.5, y: th * k + th / 2, z: s * (FB / 2 + RP + 12), ry: (this.r() - 0.5) * 0.1, sx: 21, sy: th * 0.96, sz: 16, color: cols[(books.length * 3) % cols.length] });
    }
    K.instances(new K.RoundedBoxGeometry(1, 1, 1, 1, 0.06), K.std({ roughness: 0.65 }), books, { colors: true });
    K.contact(LEN / 2, 0, LEN / 2 + 10, QL + 20, 0.4);
    // the start: a little platform at the top of the right wall
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshStandardMaterial({ color: 0xe23b2e, side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(X0 - 4, H + 9, FB / 2 + RP + 6); g.add(flag);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 12, 6), K.std({ color: 0xe9d3a8 }));
    pole.position.set(X0 - 8, H + 6, FB / 2 + RP + 6); g.add(pole);
  }

  buildCrowd(K, competitors) {
    const spots = [];
    for (let k = 0; k < 6; k++) spots.push({ x: 40 + k * 38, y: H + 0.6, z: (k % 2 ? 1 : -1) * (FB / 2 + RP + 15), ry: k % 2 ? Math.PI : 0, size: 10 + this.r() * 2 });
    for (let k = 0; k < 4; k++) spots.push({ x: LEN + 22, y: 0, z: -30 + k * 20, ry: -Math.PI / 2, size: 13 });
    // the crowd: tin robots and action figures, lights blinking on their heads
    this.crowd = robotCrowd(K.group, spots, 37);
    [[LEN + 14, -50], [LEN + 14, 50]].forEach(([x, z], k) => {
      const b = banner(competitors[k % competitors.length].code, 16, { seed: 20 + k });
      b.position.set(x, 0, z); b.rotation.y = -Math.PI / 2;
      K.group.add(b);
    });
  }

  attract() {}

  start() {
    this.ctx.sound.setLoop('crowd', 0.25);
    this.turn = -1; this.run = 1;
    this.next();
  }

  next() {
    this.turn++;
    if (this.turn >= this.riders.length) {
      if (this.run < RUNS) { this.run++; this.turn = 0; this.ctx.hud.message('Second run', 'small', '#ffc93c', 1.4); } else { this.finishAll(); return; }
    }
    const rd = this.cur = this.riders[this.turn];
    this.rs = { x: X0, q: QL, dir: -1, E: H + DROP, air: null, score: 0, airs: [], pumped: false, lastCross: -1, wipe: 0, crashT: 0, history: [] };
    this.phase = 'ready'; this.t = 0;
    this.placeWaiting();
    rd.fig.setExpression('focus');
    if (rd.bot) rd.bot.go = 0.6 + rd.bot.r() * 0.6;
    else this.skipper.update(false, false);
    this.ctx.competitors.forEach((c, i) => this.ctx.hud.chip(i, this.riders[i].runs.length ? `${this.riders[i].best}` : '', i === rd.i ? 'active' : ''));
    if (rd.c.human) this.ctx.hud.message(`${rd.c.short}: tap ${rd.c.type === 'touch' ? '●' : 'action'} to drop in`, 'small', '#fff');
    else this.ctx.hud.message('');
    this.updateCard();
  }

  // ---------------------------------------------------------------- per step
  botUpdate(rd, now) {
    const b = rd.bot, s = this.rs, pad = rd.c.pad, B = BOT[this.ctx.skillName] || BOT.normal;
    const tap = (k) => { pad.push(k, true, now); pad.push(k, false, now + 0.03); };
    if (this.phase === 'ready' && this.t > b.go) tap('action');
    if (this.phase !== 'ride') return;
    if (!s.air) {
      if (b.plan) { pad.push('left', false, now); pad.push('right', false, now); }
      b.plan = null;
      // pump somewhere in the window, better riders nearer the middle
      if (Math.abs(s.q) < PUMP_W && !s.pumped && b.pumpAt == null && Math.sign(s.q) !== s.dir) b.pumpAt = clamp(1 - (B.pump[0] + b.r.gauss() * B.pump[1]), 0, 1) * PUMP_W;
      if (b.pumpAt != null && Math.abs(s.q) <= b.pumpAt + 0.4 && !s.pumped) { tap('action'); b.pumpAt = null; }
      if (Math.abs(s.q) > PUMP_W) b.pumpAt = null;
      if (b.holding) { pad.push('action', false, now); b.holding = false; }
      return;
    }
    const a = s.air;
    if (!b.plan) {
      // what fits in this air: half turns at the spin rate, maybe a grab; now and then a mistake
      const halves = clamp(Math.floor((a.T - 0.3) * SPIN * 2 * B.spin + b.r() * 0.7), 0, 6);
      const oops = b.r() < B.land;
      b.plan = { halves: halves + (oops && b.r() < 0.6 ? 1 : 0), dir: b.r() < 0.5 ? 'left' : 'right', grab: b.r() < B.grab && a.T > 0.7, grabEnd: a.T - 0.2 - b.r() * 0.2 + (oops ? 0.25 : 0) };
    }
    const p = b.plan;
    // hold the spin until the last half turn is under way, then let go (it finishes by itself)
    const want = p.halves > 0 && a.t > 0.06 && a.spun < (p.halves - 1) / 2 + 0.08;
    pad.push(p.dir, want, now);
    const wantGrab = p.grab && a.t > 0.15 && a.t < p.grabEnd;
    if (wantGrab !== !!b.holding) { pad.push('action', wantGrab, now); b.holding = wantGrab; }
  }

  update(dt) {
    const ctx = this.ctx, now = ctx.time();
    this.t += dt;
    if (this.phase === 'pre') { for (const r of this.riders) ctx.presses(r.i); return; }
    if (this.phase === 'done') {
      for (const r of this.riders) ctx.presses(r.i);
      if (this.t > 1.6 && this.results) { const r = this.results; this.results = null; ctx.finish(r); }
      return;
    }
    const rd = this.cur, s = this.rs;
    if (rd.bot) this.botUpdate(rd, now);
    let q = [], skip = false;
    for (const x of this.riders) {
      const e = ctx.presses(x.i);
      if (x === rd) q = e;
      if (x.c.human && e.some((y) => y.b === 'action' && y.down)) skip = true;
    }
    // watching a computer rider: action fast-forwards
    this.skipper.update(!!rd.bot, skip);
    // Little riders pump by themselves and spin with any button (no grabs to worry about)
    const little = rd.c.human && helped(rd.c);
    if (this.phase === 'ready') {
      if (q.some((e) => e.down && (e.b === 'action' || little)) || this.t > 8) { this.phase = 'ride'; this.t = 0; ctx.hud.message(''); ctx.sound.whoosh(0.4); }
      return;
    }
    if (this.phase === 'ended') {
      if (skip && this.t > 0.8) this.t = Math.max(this.t, 2.6);
      if (this.t > 3.2) this.next();
      return;
    }
    // ride
    s.x += DRIFT * dt;
    const held = ctx.held(rd.i);
    if (s.air) {
      const a = s.air;
      a.t += dt;
      // hold left or right to spin that way; let go and the half turn under way finishes by itself
      const dirHeld = little ? (held.left || held.right || held.action ? 1 : 0) : held.left && !held.right ? -1 : held.right && !held.left ? 1 : 0;
      if (dirHeld && !a.spinDir) a.spinDir = dirHeld;
      a.spinning = dirHeld !== 0 && dirHeld === a.spinDir && a.t > 0.04;
      if (a.spinning) { a.spun += SPIN * dt; a.goal = Math.ceil(a.spun * 2 - 1e-6) / 2; } else if (a.spun < a.goal) a.spun = Math.min(a.goal, a.spun + SPIN * dt);
      a.grabbing = !little && held.action && a.t > 0.08;
      if (a.grabbing) { a.grabT += dt; a.lastGrab = a.t; }
      if (a.t >= a.T) this.landAir();
    } else if (s.crashT > 0) {
      // a wipe-out: sliding down the wall on your bottom, the board skidding beside you, then back up
      s.crashT -= dt;
      s.q = damp(s.q, 0, 2.2, dt); s.v = 0;
      if (s.crashT <= 0) { s.E = H * 0.62; s.dir = s.q > 0 ? -1 : 1; s.pumped = false; }
    } else {
      const auto = little && !s.pumped && Math.abs(s.q) <= PUMP_W * 0.3 && Math.sign(s.q) !== s.dir;
      for (const e of auto ? [{ down: true, b: 'action' }] : q) if (e.down && e.b === 'action' && Math.abs(s.q) <= PUMP_W && !s.pumped && !(little && !auto)) {
        const qual = auto ? 0.75 : clamp(1 - (Math.abs(s.q) / PUMP_W) * 0.85 / winFor(rd.c, 1), 0, 1);
        s.pumped = true; s.pumpQ = qual;
        s.E = Math.min(EMAX, s.E + PUMP * (0.4 + 0.6 * qual));
        if (rd.c.human) s.note = { text: qual > 0.7 ? 'great pump!' : 'pump', col: qual > 0.7 ? '#7be495' : '#fff1d6', t: 0 };
        ctx.sound.thump(0.25);
      }
      this.slide(dt);
    }
    if (s.x >= XEND && !s.air) this.endRun();
  }

  // moving along the U with the energy we have: turn back where it runs out, fly off the lip if it doesn't
  slide(dt) {
    const s = this.rs;
    const p = surf(s.q);
    const v2 = 2 * G * (s.E - p.y);
    const v = Math.sqrt(Math.max(0.6, v2));
    const q0 = s.q;
    s.q += s.dir * v * dt;
    // crossing the middle costs a little, and resets the pump
    if ((q0 < 0) !== (s.q < 0) && q0 !== 0) { s.E = Math.max(H * 0.55, s.E - LOSS); s.pumped = false; }
    if (Math.abs(s.q) >= QL) {
      s.q = Math.sign(s.q) * QL;
      if (s.E > H + 0.3) this.takeOff(); else s.dir = -s.dir;
    } else if (v2 <= 0.6 && Math.sign(s.q) === s.dir) s.dir = -s.dir;
    s.v = v;
  }

  takeOff() {
    const s = this.rs;
    const h = s.E - H, vUp = Math.sqrt(2 * G * h);
    s.air = { t: 0, T: (2 * vUp) / G, vUp, side: Math.sign(s.q), goal: 0, spun: 0, spinDir: 0, grabT: 0, grabbing: false, lastGrab: -1, h };
    this.ctx.sound.whoosh(0.5);
  }

  landAir() {
    const s = this.rs, a = s.air, rd = this.cur, ctx = this.ctx;
    s.air = null; s.dir = -a.side; s.q = a.side * (QL - 0.01);
    const left = (a.goal - a.spun) * 360 + (a.spinning ? 45 : 0);  // degrees still to turn (still holding: more)
    const late = a.lastGrab >= 0 ? a.T - a.lastGrab : 9;           // time since the grab was let go
    let quality = 'clean';
    // smaller riders get away with more
    if (left > winFor(rd.c, 80)) quality = 'crash';
    else if (left > winFor(rd.c, 30) || late < 0.08 / winFor(rd.c, 1)) quality = 'sketchy';
    const { name, pts } = this.airPoints(a.h, Math.round(a.spun * 2), a.grabT, quality, s.airs);
    if (quality === 'crash') { s.crashT = 1.3; s.crashSpin = 0; ctx.sound.thump(0.6); ctx.sound.aww(); this.particles.emit(s.x, H * 0.8, a.side * (ZL - 2), { vx: 0, spread: 6, up: 4, color: 0xffffff, size: 0.9, life: 0.6, alpha: 0.7, grav: 14, n: 18 }); } else ctx.sound.thump(0.3);
    if (rd.c.human) s.note = { text: quality === 'crash' ? (left > 70 ? 'wipe-out: spin not finished' : 'wipe-out: still grabbing') : quality === 'sketchy' ? 'sketchy landing' : 'clean landing!', col: quality === 'clean' ? '#7be495' : quality === 'sketchy' ? '#ffc93c' : '#ff8a65', t: 0 };
    s.airs.push({ name, pts, quality });
    s.score += pts;
    const col = quality === 'clean' ? '#7be495' : quality === 'sketchy' ? '#ffc93c' : '#ff8a65';
    ctx.hud.flash(quality === 'crash' ? 'Wipe-out!' : `${name} +${pts}${quality === 'sketchy' ? ' (sketchy)' : ''}`, col);
    if (quality === 'clean' && pts >= 20) ctx.sound.cheer(0.5);
    this.updateCard();
  }

  airPoints(h, halves, grabT, quality, airs) {
    const name = `${halves ? `${halves * 180}` : ''}${grabT > 0.2 ? `${halves ? ' ' : ''}grab` : ''}` || 'air';
    let pts = Math.round(h * 0.9 + (SPIN_PTS[Math.min(6, halves)] ?? 40) + (grabT > 0.2 ? 4 + 8 * clamp(grabT / 0.6, 0, 1) : 0));
    if (airs.some((x) => x.name === name && x.quality !== 'crash')) pts = Math.round(pts * 0.7);   // the judges like variety
    if (quality === 'sketchy') pts = Math.round(pts * 0.5);
    if (quality === 'crash') pts = 0;
    return { name, pts };
  }


  endRun() {
    const s = this.rs, rd = this.cur, ctx = this.ctx;
    this.phase = 'ended'; this.t = 0;
    rd.runs.push(s.score);
    rd.best = Math.max(rd.best, s.score);
    ctx.hud.message(`${s.score} pts`, '', s.score >= rd.best && s.score > 0 ? '#ffc93c' : '#fff');
    ctx.sound.cheer(clamp(s.score / 120, 0.3, 1.1)); ctx.sound.clap(6);
    ctx.hud.chip(rd.i, `${rd.best}`, 'active');
    rd.fig.setExpression(s.score >= 90 ? 'wow' : 'happy');
    for (const b of ['left', 'right', 'action']) rd.c.pad.push(b, false, ctx.time());
    if (rd.bot) rd.bot.holding = false;
    this.updateCard();
  }

  finishAll() {
    this.phase = 'done'; this.t = 0;
    this.cur = null;
    this.placeWaiting();
    const ranked = [...this.riders].sort((a, b) => b.best - a.best);
    this.winner = ranked[0];
    this.ctx.hud.message(`${ranked[0].c.short} wins!`, 'small', '#ffc93c');
    this.guide.show(false);
    this.tags.clear();
    this.results = this.riders.map((r) => ({ value: r.best, text: `${r.best} pts`, short: `${r.best}`, sub: r.runs.join(' · ') }));
    this.updateCard();
  }

  placeWaiting() {
    this.riders.forEach((r) => {
      if (this.cur === r) return;
      r.rig.position.set(r.home.x, r.home.y, r.home.z);
      r.rig.rotation.set(0, 0, 0);
      r.spin.rotation.set(0, 0.4, 0);
      r.fig.root.rotation.set(0, Math.PI / 2, 0);
      r.fig.root.position.set(0, 0, 0);
      r.fig.ground = true;
      r.board.position.set(-3, 0.3, 4); r.board.rotation.set(0, 0, 1.3);
    });
  }

  updateCard() {
    const rd = this.cur, s = this.rs;
    const humans = this.riders.some((x) => x.c.human);
    const line = rd ? `Run ${this.run} of ${RUNS} · ${s ? s.score : 0} pts${rd.runs.length ? ` · best ${rd.best}` : ''}${rd.bot && humans ? ' · action: fast-forward' : ''}` : 'Best runs';
    const ranked = [...this.riders].filter((x) => x.runs.length).sort((a, b) => b.best - a.best);
    this.card.set(rd ? rd.c : null, line, ranked.map((x) => ({ c: x.c, text: `${x.best}`, me: x === rd })));
  }

  // ---------------------------------------------------------------- per frame
  frame(dt, paused) {
    const ctx = this.ctx, tt = ctx.time();
    if (!paused) this.particles.update(dt);
    const rd = this.cur;
    this.riders.forEach((r) => {
      if (r === rd && this.phase !== 'done') return;
      const w = tt + r.idle;
      r.fig.setPose(this.phase === 'done' && r === this.winner ? POSES.cheer(w) : (Math.floor(w / 3) % 3) === 1 ? POSES.wave(w) : POSES.stand(w));
    });
    if (rd && this.rs && this.phase !== 'done') this.poseRider(rd, tt, dt, paused);
    this.crowd.update(tt, this.phase === 'ride' ? 0.5 + (this.rs?.air ? 0.3 : 0) : this.phase === 'ended' ? 0.7 : 0.15);
    if (!paused) {
      // a strip light that flickers now and then; snow blowing in under the door
      const fl = Math.sin(tt * 0.7) > 0.96 && Math.sin(tt * 47) > 0 ? 0.35 : 1;
      this.strips[1].glow.material.opacity = 0.5 * fl; this.strips[1].tube.material.color.setScalar(fl > 0.5 ? 1 : 0.6);
      this.snowT = (this.snowT || 0) - dt;
      if (this.snowT <= 0 && this.ctx.kit.quality.grass > 0.5) { this.snowT = 0.08; this.particles.emit(this.doorX, 2 + Math.random() * 10, (Math.random() - 0.5) * 200, { vx: -14, spread: 3, up: 1.5, color: 0xffffff, size: 0.7, life: 3, alpha: 0.85, grav: 2, grow: 1 }); }
    }
    this.updateHud(tt);
    this.applyCamera(dt);
  }

  poseRider(rd, tt, dt, paused) {
    const s = this.rs, fig = rd.fig;
    fig.ground = true;
    fig.root.position.set(0, 0.45, 0);
    fig.root.rotation.set(0, Math.PI / 2, 0);
    rd.board.position.set(0, 0.22, 0); rd.board.rotation.set(0, Math.PI / 2, 0);
    if (this.phase === 'ready') {
      rd.rig.position.set(s.x, H + 1, ZL + 3);
      rd.rig.rotation.set(0, 0, 0); rd.spin.rotation.set(0, Math.PI / 2 + 0.3, 0);
      fig.setPose({ ...POSES.stand(tt), hipL: 0.2, hipR: 0.2, kneeL: 0.4, kneeR: 0.4, abL: 0.5, abR: 0.5 });
      return;
    }
    let y, z, tilt, spinA = 0, pose;
    const crouch = { ...REST, y: -0.4, lean: 0.25, hipL: 0.55, hipR: 0.55, kneeL: 0.9, kneeR: 0.9, abL: 0.6, abR: 0.6, shL: 0.3, shR: 0.3, elL: 0.3, elR: 0.3, head: -0.1, spL: 0.25, spR: 0.25 };
    if (s.air) {
      // straight up out of the pipe and back down the same wall: upright in the air for the tricks,
      // square to the wall at take-off and landing
      const a = s.air, u = a.t / a.T;
      y = H + a.vUp * a.t - 0.5 * G * a.t * a.t;
      z = a.side * (ZL - 1.5 - 6 * Math.sin(Math.PI * u));
      const k = Math.min(1, Math.min(u, 1 - u) / 0.1), up = k * k * (3 - 2 * k);
      tilt = -a.side * (Math.PI / 2) * (1 - up);
      spinA = (a.spinDir || 1) * a.spun * TAU;
      const grab = a.grabbing ? 1 : 0;
      s.grabK = damp(s.grabK ?? 0, grab, 16, dt);
      pose = blendPose(crouch, { ...REST, y: -1.4, lean: 0.6, hipL: 1.6, hipR: 1.6, kneeL: 2.1, kneeR: 2.1, shR: 1.4, elR: 0.2, abR: 0.1, shL: -0.3, abL: 0.9, elL: 0.2, head: 0.1, spL: 0.3, spR: 0.3 }, s.grabK);
    } else {
      const p = surf(s.q);
      y = p.y + 0.6; z = p.z; tilt = -p.ang;
      const pumpK = s.pumped && Math.abs(s.q) < FB ? 1 - Math.abs(s.q) / FB : 0;
      pose = blendPose(crouch, { ...crouch, y: -1.2, kneeL: 1.7, kneeR: 1.7, hipL: 1.1, hipR: 1.1 }, pumpK);
      if (this.phase === 'ended') pose = blendPose(crouch, POSES.cheer(tt), clamp(this.t * 2, 0, 1));
      // icing sugar spray when carving up and down the walls
      if (!paused && s.v > 12 && Math.random() < 0.4) this.particles.emit(s.x, y, z, { vx: 0, spread: 3, up: 2, color: 0xffffff, size: 0.55, life: 0.35, alpha: 0.6, grav: 10, n: 1 });
    }
    rd.rig.position.set(s.x, y, z);
    rd.rig.rotation.set(tilt, 0, 0);
    // face down the pipe, turned a little towards where you're riding
    const face = s.air ? 0 : -s.dir * 0.35;
    rd.spin.rotation.set(0, face + spinA, 0);
    if (s.crashT > 0 && !s.air) {
      // sitting in a heap on the wall, the board spinning away beside
      if (!paused) s.crashSpin = (s.crashSpin || 0) + dt * 9 * Math.max(0.2, s.crashT);
      fig.ground = false;
      fig.root.position.set(0, 2.4, 0);
      pose = { ...POSES.heap(), y: 0 };
      rd.board.position.set(-1.5, 0.5, 4.5);
      rd.board.rotation.set(s.crashSpin, Math.PI / 2 + s.crashSpin * 0.4, 0.3);
      if (!paused && Math.random() < 0.3) this.particles.emit(s.x, y + 1, z, { vx: 0, spread: 4, up: 3, color: 0xffffff, size: 0.7, life: 0.4, alpha: 0.6, grav: 12, n: 2 });
    }
    fig.setPose(pose);
  }

  updateHud(tt) {
    const rd = this.cur, s = this.rs, ph = this.phase;
    const show = rd && rd.c.human && (ph === 'ready' || ph === 'ride');
    this.guide.show(!!show);
    if (show) {
      const touch = rd.c.type === 'touch', act = touch ? '●' : 'action', lr = touch ? '◀ ▶' : 'left/right';
      const little = helped(rd.c);
      this.guide.tip(little ? (ph === 'ready' ? 'tap any button to drop in' : s.air ? 'hold any button to spin · let go before you land' : 'you pump by yourself: get ready to spin!')
        : ph === 'ready' ? `tap ${act} to drop in` : s.air ? `hold ${lr} to spin, let go to stop · hold ${act}: grab · let go of both before landing` : `tap ${act} as you cross the blue strip at the bottom to pump higher`);
      this.guide.bar('en', clamp((s.E - H * 0.7) / (EMAX - H * 0.7), 0, 1), { go: s.E > H + 6, mark: (H - H * 0.7) / (EMAX - H * 0.7), hide: ph === 'ready' });
    }
    if (!rd || !s || !rd.c.human || ph !== 'ride') { this.tags.hide('hp'); return; }
    if (s.note) s.note.t += 1 / 60;
    const note = s.note && s.note.t < 1.0 ? `<span class="pill" style="--tc:${s.note.col}">${s.note.text}</span><br>` : '';
    let html = note, y, z;
    if (s.air) {
      // what the trick is so far, and a warning when the landing is close
      const a = s.air, left = a.goal - a.spun, toLand = a.T - a.t;
      const k = Math.round(a.goal * 2) * 180;
      // how much more spin still fits before the landing
      const room = Math.max(0, Math.floor((toLand - 0.12) * SPIN * 2 - left * 2)) * 180;
      const warn = toLand < 0.4 && (left > 0.05 || a.spinning || a.grabbing) ? `<span class="pill big" style="--tc:${Math.sin(tt * 14) > 0 ? '#ff8a65' : '#ffc93c'}">${a.grabbing ? 'let go!' : 'stop spinning!'}</span><br>` : room ? `<span class="pill" style="--tc:#fff1d6">room for ${room}</span><br>` : '';
      html += `${warn}<span class="pill big" style="--tc:${left > 0.05 || a.spinning ? '#ffc93c' : '#7be495'}">${k ? k : 'air'}${a.grabbing || a.grabT > 0.2 ? ' grab' : ''}</span>`;
      y = H + a.vUp * a.t - 0.5 * G * a.t * a.t + 11; z = a.side * (ZL - 4);
    } else {
      const p = surf(s.q);
      const coming = !s.pumped && s.crashT <= 0 && Math.sign(s.q) === -s.dir && Math.abs(s.q) < QT * 0.75;
      const onStrip = Math.abs(s.q) <= PUMP_W && !s.pumped;
      if (s.crashT > 0) html += '<span class="pill" style="--tc:#ff8a65">ouch!</span>';
      else if (onStrip && !helped(rd.c)) html += `<span class="pill big" style="--tc:${Math.sin(tt * 14) > 0 ? '#7be495' : '#fff1d6'}">pump now!</span>`;
      else if (coming && !helped(rd.c)) html += '<span class="pill" style="--tc:#fff1d6">pump at the bottom</span>';
      y = p.y + 11; z = p.z;
    }
    if (html) { this.tags.set('hp', html); this.tags.place('hp', s.x, y, z); } else this.tags.hide('hp');
  }

  applyCamera(dt) {
    const R = this.ctx.R, c = this.cam, ph = this.phase, s = this.rs;
    let want;
    if ((ph === 'ride' || ph === 'ready' || ph === 'ended') && s) {
      // from down the pipe, looking back up at the rider
      const ry = s.air ? H + s.air.vUp * s.air.t - 0.5 * G * s.air.t * s.air.t : surf(s.q).y;
      want = { x: s.x, y: H * 0.42 + ry * 0.45, z: 0, yaw: Math.PI / 2 - 0.1, pitch: 0.22, width: ph === 'ready' ? 70 : 92 };
    } else want = { x: X0, y: H, z: -ZL - 8, yaw: Math.PI / 2 + 0.6, pitch: 0.3, width: 80 };
    for (const k of Object.keys(want)) c[k] = dt >= 1 ? want[k] : damp(c[k], want[k], 3, Math.min(dt, 0.1));
    R.orbit(c.x, c.y, c.z, { yaw: c.yaw, pitch: c.pitch, width: c.width, shadowSpan: Math.max(180, c.width * 1.6) });
    R.setFocus(0.5, 0.36, 0.7);
  }

  dispose() {
    for (const r of this.riders) r.fig.dispose();
    this.tags?.clear();
  }
}

export default {
  id: 'halfpipe', name: 'Halfpipe', season: 'Winter',
  blurb: 'A cardboard U dusted with icing sugar and a lolly-stick snowboard: pump, fly, spin and grab.',
  venue: 'The garage on a winter evening: a big sheet of cardboard bent into a U between two walls of books, dusted with icing sugar.',
  loading: 'Dusting the halfpipe with icing sugar…',
  how: [
    { verb: 'Timing', text: 'Tap <b>action</b> to drop in, then tap it each time you cross the <b>blue strip</b> at the bottom to pump: higher every time.' },
    { verb: 'Steer', text: 'In the air, <b>hold left</b> or <b>right</b> to spin; let go and the half turn finishes by itself. Hold <b>action</b> to grab. The label over you says how much more spin still fits.' },
    { verb: 'Timing', text: 'Land with the spin finished and the grab let go, or it\'s a wipe-out. Mix your tricks: the judges like variety. Two runs.' },
  ],
  helpers: {
    little: 'You <b>pump by yourself</b>. In the air, hold <b>any button</b> to spin, and let go before you land.',
    kid: 'Pumps count a bit early or late, and the landings forgive an unfinished spin.',
  },
  better: 'higher',
  resultsDelay: 0.6,
  create: (ctx) => new Halfpipe(ctx),
};
