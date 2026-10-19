// Speed skating: two laps of an oval of ice frozen in a baking tray on the kitchen counter.
// Hold ACTION at the start and let go on the whistle, tap LEFT/RIGHT in turn to skate (long, steady
// strokes), tap ACTION as you reach the sweets at a bend to lean into it, and tap ACTION again as you
// come out of it to stand up. Not leaning in a bend sends you wide and slow; leaning on a straight
// slows you down.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, REST, blendPose } from '../figurine.js';
import { banner } from '../props.js';
import { paneWindow, nightSky, FairyLights, gingerCrowd, Cat } from '../venues.js';
import { Rhythm, BotTapper } from '../verbs.js';
import { fitRhythm, winFor, helped } from '../sizes.js';
import { Particles, SkidMarks } from '../fx.js';
import { clamp, damp, rng, makeNoise2D, TAU } from '../util.js';
import { hudKit, Guide, Tags, RaceStart, fmtTime, beatGauge, ORD } from './common.js';

const SX = 36;                 // half the length of a straight
const R0 = 20, LANE = 4.2;     // inner radius of the bends, lane width
const LAP = 300, LAPS = 2;     // progress units per lap (the same for every lane), laps
const START_P = 8;             // the start line, a little way down the front straight
const TARGET = 3.6, VMAX = 30, ACCEL = 1.25;
const Y = 2.2;                 // the ice surface
// computer skaters: cadence share, how late they lean in / stand up (s)
const BOT = {
  easy: { cad: 0.84, late: [0.35, 0.18] },
  normal: { cad: 0.94, late: [0.18, 0.1] },
  hard: { cad: 1.0, late: [0.07, 0.05] },
};

// a lane's oval: front straight (+x), right bend, back straight (-x), left bend. d = distance along it.
function laneLen(r) { return 4 * SX + TAU * r; }
function lanePoint(r, d) {
  const L = laneLen(r), c = Math.PI * r;
  d = ((d % L) + L) % L;
  if (d < 2 * SX) return { x: -SX + d, z: r, dir: 0, bend: 0 };
  d -= 2 * SX;
  if (d < c) { const a = d / r; return { x: SX + r * Math.sin(a), z: r * Math.cos(a), dir: a, bend: 1 }; }
  d -= c;
  if (d < 2 * SX) return { x: SX - d, z: -r, dir: Math.PI, bend: 0 };
  d -= 2 * SX;
  const a = d / r;
  return { x: -SX - r * Math.sin(a), z: -r * Math.cos(a), dir: Math.PI + a, bend: 2 };
}

// A fair oval: every lane spends the same share of a lap on the straights and in the bends, so skaters
// with the same progress are side by side (the outer lanes simply move faster round the bends, like
// they do on a real track when the lanes cross over). u = share of a lap from the start of the front straight.
const RM = R0 + LANE * 2;                                   // the middle of the four lanes
const F_S = (2 * SX) / (4 * SX + TAU * RM), F_B = 0.5 - F_S; // one straight, one bend
function ovalAt(r, u) {
  u = ((u % 1) + 1) % 1;
  if (u < F_S) return { x: -SX + (u / F_S) * 2 * SX, z: r, dir: 0, bend: 0 };
  u -= F_S;
  if (u < F_B) { const a = (u / F_B) * Math.PI; return { x: SX + r * Math.sin(a), z: r * Math.cos(a), dir: a, bend: 1 }; }
  u -= F_B;
  if (u < F_S) return { x: SX - (u / F_S) * 2 * SX, z: -r, dir: Math.PI, bend: 0 };
  u -= F_S;
  const a = (u / F_B) * Math.PI;
  return { x: -SX - r * Math.sin(a), z: -r * Math.cos(a), dir: Math.PI + a, bend: 2 };
}

class SpeedSkating {
  constructor(ctx) {
    this.ctx = ctx;
    this.r = ctx.rand;
    this.phase = 'pre';
    this.t = 0;
    this.cam = { x: 0, y: Y, z: 10, yaw: 0, pitch: 0.75, width: 150 };
    this.skaters = [];
    this.finishOrder = 0;
  }

  async build() {
    const { kit: K, R, competitors } = this.ctx;
    // a winter night in the kitchen: moonlight through the window, warm lamps over the counter
    R.setLighting({
      sunDir: [-0.25, 0.9, -0.75], sunColor: 0x9db2ff, sunIntensity: 0.55,
      hemiSky: 0x4a5a8a, hemiGround: 0x3a2618, hemiIntensity: 0.3,
      envIntensity: 0.3, exposure: 1.04, background: 0x0c1020, shadowRadius: 5,
    });
    this.noise = makeNoise2D(83);
    this.buildKitchen(K);
    this.buildTray(K);
    this.buildCrowd(K, competitors);
    this.particles = new Particles(K.group, 600);
    this.particles.setScale(R.renderer.domElement.height * 0.9);
    this.marks = new SkidMarks(K.group, 1600);
    const n = competitors.length;
    const lanes = n >= 4 ? [0, 1, 2, 3] : n === 3 ? [0, 1, 2] : n === 2 ? [1, 2] : [1];
    competitors.forEach((c, i) => {
      const fig = new Figurine({ paint: c.paint, seed: c.seed, number: c.number });
      fig.setGear('skate');
      K.group.add(fig.root);
      const lane = lanes[i], r = R0 + LANE * (lane + 0.5);
      this.skaters.push({
        c, i, fig, lane, r, p: 0, v: 0, lean: false, wide: 0, anim: this.r(), finished: false, time: null, notes: { wide: 0, straight: 0 },
        rhythm: fitRhythm(new Rhythm({ target: TARGET }), c), little: c.human && helped(c), effort: 0, laps: 0,
        bot: c.human ? null : { tap: new BotTapper(c.pad, rng(c.seed * 29 + 11)) },
      });
    });
    const kit = hudKit(this.ctx);
    this.guide = new Guide(kit, [{ key: 'sp', label: 'Speed' }]);
    this.tags = new Tags(kit, R);
    for (const s of this.skaters) this.place(s);
    this.applyCamera(1);
  }

  buildKitchen(K) {
    const g = K.group;
    const ZW = -128;   // the back wall
    // a butcher-block worktop, oiled and warm
    const T = K.TX.woodTextures({ size: 1024, planks: 12, base: 0xb98552, dark: 0x7a4e2a, light: 0xdcae78, seed: 41, ringFreq: 9, roughBase: 0.5, lacquer: 0.3, grainContrast: 0.7 });
    for (const k of ['map', 'normalMap', 'roughnessMap']) if (T[k]) T[k].repeat.set(2.4, 1.2);
    const top = new THREE.Mesh(new THREE.BoxGeometry(520, 6, 220), new THREE.MeshStandardMaterial({ ...T }));
    top.position.set(0, -3, -20); top.receiveShadow = true; g.add(top);
    // a wall of bottle-green tiles with the window in the middle
    const tc = K.TX.makeCanvas(256), t2 = tc.getContext('2d');
    t2.fillStyle = '#16302a'; t2.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 8; y++) for (let x = -1; x < 4; x++) {
      t2.globalAlpha = 0.9 + 0.1 * this.noise.noise(x * 2.3 + y, y * 3.1);
      t2.fillStyle = '#2e5e50'; t2.fillRect(x * 64 + (y % 2) * 32 + 2, y * 32 + 2, 60, 28);
    }
    t2.globalAlpha = 1;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(520, 200), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(tc, { repeat: [26, 5] }), roughness: 0.18 }));
    wall.position.set(0, 100, ZW); wall.receiveShadow = true; g.add(wall);
    this.win = paneWindow(g, { x: 0, y: 82, z: ZW + 0.2, w: 124, h: 76, sky: nightSky(9), frame: 0xf2efe8, snow: K.quality.grass > 0.5 ? 70 : 0, depth: 3.4 });
    // fairy lights along the top of the window
    this.windowLights = new FairyLights(g, [[-70, 124, ZW + 4], [-24, 126, ZW + 4], [24, 126, ZW + 4], [70, 124, ZW + 4]], { sag: 5, per: 6, halo: 6, seed: 12 });
    // a candle in a jar on the sill, flickering
    const sill = this.win.sillY;
    const jar = new THREE.Mesh(K.lathe([[0.01, 0], [3.4, 0], [3.6, 7], [3.2, 8], [0.01, 8]], 20), K.glass(0xfff0d0, 0.3));
    jar.position.set(-44, sill, ZW + 4); g.add(jar);
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.2, 16), K.std({ color: 0xf6ead2, roughness: 0.7 }));
    wax.position.set(-44, sill + 1.7, ZW + 4); g.add(wax);
    this.flame = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8).scale(1, 2, 1), new THREE.MeshBasicMaterial({ color: 0xffc46a }));
    this.flame.position.set(-44, sill + 4.6, ZW + 4); g.add(this.flame);
    this.candle = new THREE.PointLight(0xff9a3c, 900, 0, 2);
    this.candle.position.set(-44, sill + 6, ZW + 8); g.add(this.candle);
    // the lamps over the counter (out of shot): two warm pools of light on the ice
    this.lamps = [-48, 48].map((x) => { const l = new THREE.PointLight(0xffb866, 9000, 0, 2); l.position.set(x, 90, 14); g.add(l); return l; });
    // a mug of cocoa with marshmallows, a jar of biscuits, the rolling pin and the flour
    const mug = new THREE.Mesh(K.lathe([[0.01, 0], [5.4, 0], [5.8, 11], [5.2, 11], [5, 1], [0.01, 1]], 28), K.paint(0xe23b2e));
    mug.position.set(-122, 0, -76); mug.castShadow = true; g.add(mug);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(3, 0.9, 8, 16, Math.PI), K.paint(0xe23b2e));
    handle.position.set(-127.4, 6, -76); handle.rotation.z = Math.PI / 2; handle.castShadow = true; g.add(handle);
    const cocoa = new THREE.Mesh(new THREE.CircleGeometry(5.2, 24).rotateX(-Math.PI / 2), K.std({ color: 0x5a3220, roughness: 0.35 }));
    cocoa.position.set(-122, 9.6, -76); g.add(cocoa);
    const mallows = [];
    for (let k = 0; k < 5; k++) mallows.push({ x: -122 + Math.cos(k * 1.3) * 2.6, y: 10.3, z: -76 + Math.sin(k * 1.3) * 2.6, ry: k, s: 1, color: k % 2 ? 0xffffff : 0xffd7e2 });
    K.instances(new K.RoundedBoxGeometry(1.8, 1.4, 1.8, 2, 0.4), K.std({ color: 0xffffff, roughness: 0.9 }), mallows, { colors: true });
    const bj = new THREE.Mesh(K.lathe([[0.01, 0], [8, 0], [8.6, 3], [8.6, 20], [6, 22], [6, 24], [0.01, 24]], 32), K.glass(0xeaf4ff, 0.22));
    bj.position.set(-150, 0, -98); g.add(bj);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 2.4, 24), K.std({ color: 0xc89a62, roughness: 0.6 }));
    lid.position.set(-150, 25, -98); lid.castShadow = true; g.add(lid);
    const biscuits = [];
    for (let k = 0; k < 7; k++) biscuits.push({ x: -150 + (k % 2 ? 2.5 : -2.5), y: 2 + k * 2.5, z: -98 + ((k * 7) % 3 - 1) * 2, rx: 1.3 + (k % 3) * 0.2, ry: k, s: 1, color: k % 3 ? 0xc98a4b : 0x7a4a2a });
    K.instances(new THREE.CylinderGeometry(4.2, 4.2, 1.2, 18), K.std({ color: 0xffffff, roughness: 0.85 }), biscuits, { colors: true });
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 40, 18).rotateZ(Math.PI / 2), K.std({ color: 0xd9b48a, roughness: 0.5 }));
    pin.position.set(-112, 3, 70); pin.rotation.y = 0.3; pin.castShadow = true; g.add(pin);
    for (const s2 of [-1, 1]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 9, 12).rotateZ(Math.PI / 2), K.std({ color: 0xc89a62, roughness: 0.5 })); h.position.set(-112 + s2 * 23.5 * Math.cos(0.3), 3, 70 - s2 * 23.5 * Math.sin(0.3)); h.rotation.y = 0.3; g.add(h); }
    const flour = new THREE.Mesh(new K.RoundedBoxGeometry(18, 26, 12, 3, 2.5), K.std({ color: 0xf2ead8, roughness: 0.9 }));
    flour.position.set(150, 13, -96); flour.rotation.y = -0.3; flour.castShadow = true; g.add(flour);
    const band = new THREE.Mesh(new THREE.BoxGeometry(18.4, 7, 12.4), K.std({ color: 0x3d7bd9, roughness: 0.8 }));
    band.position.set(150, 11, -96); band.rotation.y = -0.3; g.add(band);
    // the cat, sitting on the worktop at the back, watching the leader go round
    this.cat = new Cat(g, { x: 128, z: -96, ry: -2.45, size: 52, fur: 0xe8954a, belly: 0xfbe6c8 });
  }

  buildTray(K) {
    const g = K.group;
    const W = 2 * (R0 + 4 * LANE + 6), Lx = 2 * SX + W;
    // the baking tray: brushed aluminium with rolled edges
    const M = K.TX.brushedMetalTextures({ size: 256, seed: 4 });
    const alu = new THREE.MeshStandardMaterial({ ...M, color: 0xd6d9de, metalness: 0.85, roughness: 0.38 });
    const base = new THREE.Mesh(new K.RoundedBoxGeometry(Lx + 6, 1.2, W + 6, 4, 0.5), alu);
    base.position.set(0, 0.6, 0); base.castShadow = true; base.receiveShadow = true; g.add(base);
    for (const [w, d, x, z] of [[Lx + 6, 1.4, 0, W / 2 + 2.3], [Lx + 6, 1.4, 0, -W / 2 - 2.3], [1.4, W + 6, Lx / 2 + 2.3, 0], [1.4, W + 6, -Lx / 2 - 2.3, 0]]) {
      const e = new THREE.Mesh(new K.RoundedBoxGeometry(w, 4.2, d, 3, 0.6), alu); e.position.set(x, 2.1, z); e.castShadow = true; g.add(e);
    }
    K.contact(0, 0, Lx / 2 + 8, W / 2 + 8, 0.4);
    // the ice: frosty white-blue with scratches, the lanes piped in icing, coloured sugar on the bends
    const C = 1024, ic = K.TX.makeCanvas(C, C / 2), c = ic.getContext('2d');
    c.fillStyle = '#a2c9de'; c.fillRect(0, 0, C, C / 2);
    for (let k = 0; k < 900; k++) { c.strokeStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.3})`; c.lineWidth = 0.6 + Math.random(); const x = Math.random() * C, y = Math.random() * C / 2, a = Math.random() * TAU, l = 6 + Math.random() * 30; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
    const px = (x) => ((x + Lx / 2) / Lx) * C, pz = (z) => ((z + W / 2) / W) * (C / 2);
    // the bends tinted with pink sugar so you can see where to lean
    c.fillStyle = 'rgba(240,120,160,0.42)';
    for (const sgn of [-1, 1]) { c.beginPath(); c.moveTo(px(sgn * SX), pz(-R0 - 4 * LANE)); c.arc(px(sgn * SX), pz(0), (R0 + 4 * LANE) / Lx * C, sgn > 0 ? -Math.PI / 2 : Math.PI / 2, sgn > 0 ? Math.PI / 2 : 3 * Math.PI / 2); c.lineTo(px(sgn * SX), pz(0)); c.fill(); }
    c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 3;
    for (let k = 0; k <= 4; k++) {
      const r = R0 + k * LANE;
      c.beginPath();
      for (let d = 0; d <= laneLen(r) + 0.5; d += 1) { const p = lanePoint(r, d); if (d === 0) c.moveTo(px(p.x), pz(p.z)); else c.lineTo(px(p.x), pz(p.z)); }
      c.stroke();
    }
    // start / finish line in red icing
    const sp = ovalAt(R0, START_P / LAP);
    c.strokeStyle = '#e23b2e'; c.lineWidth = 6; c.beginPath(); c.moveTo(px(sp.x), pz(R0)); c.lineTo(px(sp.x), pz(R0 + 4 * LANE)); c.stroke();
    const ice = new THREE.Mesh(new THREE.PlaneGeometry(Lx, W).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ map: K.TX.toTexture(ic, { wrap: false }), roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.3, envMapIntensity: 0.35 }));
    ice.position.set(0, Y, 0); ice.receiveShadow = true; g.add(ice);
    // the skaters, the sweets and the fairy lights reflected in the ice
    this.ctx.R.addMirror(ice, { y: Y, strength: 0.42, blur: 2 });
    // sweets round the inside of the bends: lean in here
    const sweets = [], cols = [0xe23b2e, 0xf2c230, 0x2fae5a, 0x2f6fe0, 0xf08aa3, 0x8a55c9];
    for (const bend of [1, 2]) for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI, r = R0 - 1.6;
      const x = bend === 1 ? SX + r * Math.sin(a) : -SX - r * Math.sin(a), z = bend === 1 ? r * Math.cos(a) : -r * Math.cos(a);
      sweets.push({ x, y: Y + 0.9, z, s: 1, ry: a * 3, color: cols[(k + bend) % cols.length] });
    }
    K.instances(new K.RoundedBoxGeometry(1.8, 1.8, 1.8, 2, 0.5), K.plastic(0xffffff, 0.2, { clearcoat: 0.9 }), sweets, { colors: true });
    // an icing-sugar island in the middle with the lap board
    const isl = new THREE.Mesh(new K.RoundedBoxGeometry(2 * SX + 18, 1, 2 * R0 - 10, 4, 0.5), K.std({ color: 0xffffff, roughness: 0.95 }));
    isl.position.set(0, Y + 0.5, 0); isl.receiveShadow = true; g.add(isl);
    this.lc = K.TX.makeCanvas(256, 128);
    this.lapTex = K.TX.toTexture(this.lc, { wrap: false });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), new THREE.MeshStandardMaterial({ map: this.lapTex, roughness: 0.8 }));
    this.board = new THREE.Group(); g.add(this.board);
    board.position.set(0, Y + 6, -2); board.rotation.x = -0.35; board.castShadow = true; this.board.add(board);
    for (const x of [-8, 8]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 6, 6), K.std({ color: 0xe9d3a8 })); st.position.set(x, Y + 3, -3.6); this.board.add(st); }
    this.setLapBoard('2 laps');
  }

  setLapBoard(text) {
    if (text === this.lapText) return;
    this.lapText = text;
    const c = this.lc.getContext('2d');
    c.fillStyle = '#fffdf6'; c.fillRect(0, 0, 256, 128);
    c.strokeStyle = '#e23b2e'; c.lineWidth = 8; c.strokeRect(5, 5, 246, 118);
    c.fillStyle = '#1f1a17'; c.font = '62px "Lilita One", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 128, 68);
    this.lapTex.needsUpdate = true;
  }

  buildCrowd(K, competitors) {
    const spots = [];
    const W = 2 * (R0 + 4 * LANE + 6), Lx = 2 * SX + W;
    for (let k = 0; k < 7; k++) spots.push({ x: -Lx / 2 + 14 + k * (Lx - 28) / 6, y: 0, z: -W / 2 - 16, ry: 0, size: 11 + this.r() * 2 });
    for (let k = 0; k < 3; k++) spots.push({ x: Lx / 2 + 16, y: 0, z: -24 + k * 22, ry: -Math.PI / 2, size: 11 });
    for (let k = 0; k < 3; k++) spots.push({ x: -Lx / 2 - 16, y: 0, z: -24 + k * 22, ry: Math.PI / 2, size: 11 });
    // the crowd: gingerbread people, iced and cheering
    this.crowd = gingerCrowd(K.group, spots, 67);
    // fairy lights on cocktail sticks round the back and the ends of the tray (the front stays clear)
    const px = Lx / 2 + 9, pz = W / 2 + 9, PH = 9;
    const posts = [[-px, pz], [-px, 0], [-px, -pz], [-px / 2, -pz], [0, -pz], [px / 2, -pz], [px, -pz], [px, 0], [px, pz]];
    K.instances(new THREE.CylinderGeometry(0.35, 0.35, PH, 6).translate(0, PH / 2, 0), K.std({ color: 0xe9d3a8, roughness: 0.7 }), posts.map(([x, z]) => ({ x, y: 0, z })));
    this.rinkLights = new FairyLights(K.group, posts.map(([x, z]) => [x, PH, z]), { sag: 2.2, per: 5, bulb: 0.45, halo: 4.5, seed: 21 });
    [[-40, -W / 2 - 26], [40, -W / 2 - 26]].forEach(([x, z], k) => {
      const b = banner(competitors[k % competitors.length].code, 16, { seed: 80 + k });
      b.position.set(x, 0, z);
      K.group.add(b);
    });
  }

  attract() {}

  start() {
    this.ctx.sound.setLoop('crowd', 0.25);
    this.startCtl = new RaceStart(this.ctx, this.skaters);
    this.phase = 'marks'; this.t = 0;
    this.ctx.hud.message(this.startCtl.marksText(), 'small', '#fff');
  }

  // where along the lane a skater is, and whether it's a bend there
  at(s) { return ovalAt(s.r + s.wide * 3, (START_P + s.p) / LAP); }
  bendAhead(s, dp) { return ovalAt(s.r, (START_P + s.p + dp) / LAP).bend; }

  botUpdate(s, now) {
    const B = BOT[this.ctx.skillName] || BOT.normal, b = s.bot, pad = s.c.pad;
    if (!s.started || s.finished) return;
    if (!b.on) { b.on = true; b.tap.start(now); b.wantAt = null; }
    b.tap.update(now, TARGET * B.cad, 0.07, 0.003);
    const inBend = this.at(s).bend > 0;
    const want = inBend;
    if (want !== s.lean) {
      if (b.wantAt == null) b.wantAt = now + Math.max(0.02, B.late[0] + this.r.gauss() * B.late[1]);
      if (now >= b.wantAt) { pad.push('action', true, now); pad.push('action', false, now + 0.04); b.wantAt = null; }
    } else b.wantAt = null;
  }

  update(dt) {
    const ctx = this.ctx, now = ctx.time();
    this.t += dt;
    const q = this.skaters.map((s) => ctx.presses(s.i));
    if (this.phase === 'pre') return;
    if (this.phase === 'done') { if (this.t > 1.2 && this.results) { const r = this.results; this.results = null; ctx.finish(r); } return; }
    for (const s of this.skaters) if (s.bot) this.botUpdate(s, now);
    const left = this.startCtl.update(dt, now, q);
    if (this.phase === 'marks' && this.startCtl.phase === 'go') { this.phase = 'race'; this.t = 0; }
    for (const s of this.skaters) this.step(s, left[s.i] || [], dt, now);
    if (this.phase === 'race' && (this.skaters.every((s) => s.finished) || now - this.startCtl.whistleAt > 90)) this.finishAll();
  }

  step(s, evs, dt, now) {
    const ctx = this.ctx;
    if (s.finished) { s.v *= Math.exp(-1.2 * dt); s.p += s.v * dt; s.lean = false; s.wide = damp(s.wide, 0, 2, dt); return; }
    if (!s.started) return;
    if (!s.go) { s.go = true; s.v = VMAX * 0.25 * this.startCtl.boost(s); }
    for (const e of evs) {
      if (!e.down) continue;
      if (e.b === 'action' && !s.little) { s.lean = !s.lean; if (s.c.human) ctx.sound.pop(); continue; }
      const res = s.rhythm.press(e.b, e.t);
      if (res === 'stumble') { s.v *= 0.88; ctx.sound.stumble(); } else if (s.c.human) ctx.sound.step(0.3);
      s.push = 0.2; s.pushSide = e.b;
    }
    const pt = this.at(s), bend = pt.bend > 0;
    // Little skaters lean into the bends by themselves
    if (s.little && s.lean !== bend) { s.lean = bend; ctx.sound.pop(); }
    // a steady, long stroke is fastest; thrashing just spins the blades
    const x = s.rhythm.ratio(now), th = 1 + winFor(s.c, 0.25);
    let eff = s.rhythm.effort(now) * (x > th ? Math.max(0.85, 1 - (x - th) * 0.35) : 1);
    // still out there a while after the winner: glide home
    const first = this.skaters.find((o) => o.finished && o.place === 0);
    const late = s.c.human ? (first ? now - this.startCtl.whistleAt - first.time - 6 : now - this.startCtl.whistleAt - 45) : 0;
    if (late > 0) { eff = Math.max(eff, Math.min(0.8, 0.4 + late * 0.06)); s.glided = true; if (s.lean !== bend) s.lean = bend; }
    s.effort = eff;
    if (bend && !s.lean) { s.wide = Math.min(1, s.wide + dt * 1.6 / winFor(s.c, 1)); s.notes.wide += dt; } else s.wide = Math.max(0, s.wide - dt * 1.2);
    if (!bend && s.lean) s.notes.straight += dt;
    let target = VMAX * Math.min(1.04, eff) * (1 - 0.32 * s.wide) * (!bend && s.lean ? 0.88 : 1);
    s.v += (target - s.v) * (1 - Math.exp(-(target > s.v ? ACCEL : 0.9) * dt));
    s.p += s.v * dt;
    if (s.push > 0) s.push -= dt;
    const lap = Math.floor(s.p / LAP);
    if (lap > s.laps) { s.laps = lap; if (lap < LAPS && s.c.human) ctx.hud.flash(`${s.c.short}: last lap!`, '#ffc93c'); }
    if (s.p >= LAP * LAPS) this.cross(s, now - (s.p - LAP * LAPS) / Math.max(1, s.v));
  }

  cross(s, t) {
    s.finished = true;
    s.time = t - this.startCtl.whistleAt;
    s.place = this.finishOrder++;
    const ctx = this.ctx;
    ctx.sound.clap(4);
    if (s.place === 0) { ctx.hud.message(`${s.c.short} ${fmtTime(s.time)}`, 'small', '#ffc93c', 2); ctx.sound.cheer(1); }
    ctx.hud.chip(s.i, fmtTime(s.time), s.place === 0 ? 'active' : '');
    s.fig.setExpression(s.place === 0 ? 'wow' : 'happy');
  }

  finishAll() {
    this.phase = 'done'; this.t = 0;
    for (const s of this.skaters) s.bot?.tap.stop();
    this.guide.show(false);
    this.tags.clear();
    this.results = this.skaters.map((s) => {
      const notes = [];
      if (s.early) notes.push('too early off the line');
      if (s.notes.wide > 0.6) notes.push('went wide on the bends');
      if (s.notes.straight > 1) notes.push('leaned on the straights');
      if (s.glided) notes.push('glided home');
      return s.finished ? { value: s.time, text: fmtTime(s.time), short: fmtTime(s.time), sub: notes.join(' · ') } : { value: null, dnf: true, text: 'Did not finish', short: 'DNF', sub: '' };
    });
  }

  place(s) {
    const pt = this.at(s);
    s.fig.root.position.set(pt.x, Y, pt.z);
    s.fig.root.rotation.set(0, Math.PI / 2 + pt.dir, 0);
  }

  // ---------------------------------------------------------------- per frame
  frame(dt, paused) {
    const ctx = this.ctx, tt = ctx.time();
    if (!paused) this.particles.update(dt);
    let lead = null;
    for (const s of this.skaters) {
      this.poseSkater(s, tt, dt, paused);
      if (!lead || s.p > lead.p) lead = s;
    }
    this.lead = lead;
    if (lead && this.phase === 'race') this.setLapBoard(lead.finished ? 'Finish!' : lead.p >= LAP ? 'Last lap' : 'Lap 1');
    const exc = this.phase === 'race' ? 0.45 + 0.35 * clamp(lead.p / (LAP * LAPS), 0, 1) : this.phase === 'done' ? 0.55 : 0.15;
    this.crowd.update(tt, exc);
    if (!paused) {
      ctx.sound.setLoop('crowd', 0.2 + exc * 0.4);
      this.rinkLights.update(tt); this.windowLights.update(tt);
      this.win.update(dt, tt);
      const fl = 0.8 + 0.12 * Math.sin(tt * 17) + 0.08 * Math.sin(tt * 31 + 1);
      this.candle.intensity = 900 * fl; this.flame.scale.set(1, fl, 1);
      this.cat.update(tt, dt, lead ? this.at(lead) : null, exc);
      // a few flakes of icing-sugar snow drifting down onto the ice
      this.snowT = (this.snowT || 0) - dt;
      if (this.snowT <= 0 && ctx.kit.quality.grass > 0.5) {
        this.snowT = 0.09;
        const Wd = 2 * (R0 + 4 * LANE + 6), Lx = 2 * SX + Wd;
        this.particles.emit((Math.random() - 0.5) * (Lx + 30), 46, (Math.random() - 0.5) * (Wd + 20), { vy: -4.5, spread: 0.8, up: 0, color: 0xffffff, size: 1.3, life: 10, alpha: 0.8, grav: 0, grow: 1 });
      }
    }
    this.updateHud(tt);
    this.applyCamera(dt);
  }

  poseSkater(s, tt, dt, paused) {
    const fig = s.fig;
    fig.ground = true;
    const pt = this.at(s);
    s.fig.root.position.set(pt.x, Y, pt.z);
    const yaw = Math.PI / 2 + pt.dir;
    s.fig.root.rotation.set(0, yaw, 0);
    if (!s.started) {
      const set = this.phase === 'marks' && this.t > 0.5 ? clamp((this.t - 0.5) * 3, 0, 1) : 0;
      fig.setPose(blendPose(POSES.stand(tt + s.i), { ...REST, y: -0.9, lean: 0.85, hipL: 1.0, hipR: 0.4, kneeL: 1.2, kneeR: 0.7, shL: -0.5, shR: 0.9, abL: 0.1, abR: 0.1, elL: 0.3, elR: 0.6, head: -0.3 }, set));
      return;
    }
    if (s.finished && s.v < 6) { fig.setPose(s.place === 0 ? POSES.cheer(tt) : POSES.wave(tt)); return; }
    // the skating crouch: one hand on the back, legs pushing out sideways in turn
    if (!paused) s.anim = (s.anim + Math.max(s.rhythm.cadence(tt) * 0.5, s.v / VMAX * 1.6) * dt) % 1;
    const a = s.anim * TAU, sn = Math.sin(a);
    const pushL = Math.max(0, sn), pushR = Math.max(0, -sn);
    const lean = s.lean ? 1 : 0;
    s.leanK = damp(s.leanK ?? 0, lean, 8, dt);
    const pose = {
      ...REST, y: -1.0, lean: 0.95, head: -0.55, twist: 0.12 * sn,
      hipL: 0.85 + 0.25 * pushR, hipR: 0.85 + 0.25 * pushL, kneeL: 1.25 - 0.55 * pushL, kneeR: 1.25 - 0.55 * pushR,
      spL: 0.05 + 0.45 * pushL, spR: 0.05 + 0.45 * pushR, ankL: 0.2, ankR: 0.2,
      shL: -0.35, shR: -0.35 + 1.4 * Math.max(0, -sn) * (s.leanK > 0.5 ? 1 : 0.6), elL: 1.4, elR: 0.25, abL: 0.25, abR: 0.15,
      roll: -0.55 * s.leanK - (pt.bend && !s.lean ? -0.2 : 0),
    };
    fig.setPose(pose);
    // blade scratches and a little ice spray on each push
    if (!paused && s.v > 4) {
      const back = 2.2, bx = pt.x - Math.sin(yaw) * back, bz = pt.z - Math.cos(yaw) * back;
      this.marks.add('s' + s.i, bx, Y + 0.03, bz, 0.35, 0.25);
      if (s.push > 0.1 && Math.random() < 0.5) this.particles.emit(bx, Y + 0.3, bz, { vx: 0, spread: 2.5, up: 2.5, color: 0xffffff, size: 0.5, life: 0.35, alpha: 0.6, grav: 10, n: 2 });
    }
  }

  updateHud(tt) {
    const humans = this.skaters.filter((s) => s.c.human);
    const ph = this.phase;
    const live = humans.find((s) => !s.finished);
    const show = humans.length > 0 && (ph === 'marks' || (ph === 'race' && live));
    this.guide.show(show);
    if (show) {
      const touch = humans.every((s) => s.c.type === 'touch');
      const act = touch ? '●' : 'action', lr = touch ? '◀ ▶' : 'left, right';
      const h = live || humans[0];
      this.guide.tip(h.little ? (ph === 'marks' ? 'you push off by yourself on the whistle' : 'tap any button on a slow, steady beat: you lean into the bends by yourself') : ph === 'marks' ? `hold ${act}, let go on the whistle` : `${lr}: keep the beat needle in the green · ${act} at the sweets to lean in, again after the bend`);
      const e = clamp(h.v / VMAX, 0, 1);
      this.guide.bar('sp', e, { go: e > 0.9, hide: ph === 'marks' });
    }
    for (const s of this.skaters) {
      const key = 'k' + s.i;
      if (!s.c.human || ph === 'done' || ph === 'pre' || !s.started) { this.tags.hide(key); continue; }
      if (s.finished) { this.tags.set(key, `<span class="pill big" style="--tc:${s.place === 0 ? '#ffc93c' : '#fff1d6'}">${ORD[s.place]} · ${fmtTime(s.time)}</span>`); } else {
        const bendNow = this.at(s).bend > 0, soon = this.bendAhead(s, 16) > 0;
        const blink = Math.sin(tt * 12) > 0;
        const pill = s.little ? (s.lean ? '<span class="pill" style="--tc:#7be495">leaning in</span><br>' : '') : bendNow && !s.lean ? `<span class="pill big" style="--tc:${blink ? '#ff8a65' : '#ffc93c'}">lean in! (${this.ctx.competitors[s.i].type === 'touch' ? '●' : 'action'})</span><br>`
          : !bendNow && s.lean && !soon ? `<span class="pill big" style="--tc:${blink ? '#ff8a65' : '#ffc93c'}">stand up! (${this.ctx.competitors[s.i].type === 'touch' ? '●' : 'action'})</span><br>`
            : soon && !s.lean ? '<span class="pill" style="--tc:#fff1d6">bend ahead</span><br>'
              : s.lean ? '<span class="pill" style="--tc:#7be495">leaning in</span><br>' : '';
        const lap = s.p >= LAP ? 'last lap' : 'lap 1';
        this.tags.set(key, `${pill}${s.c.short} <span style="font-size:.7em">${lap}</span><br>${beatGauge(s.rhythm.ratio(this.ctx.time()), { lo: 0.9, hi: 1.2 })}`);
      }
      const pt = this.at(s);
      this.tags.place(key, pt.x, Y + 11, pt.z);
    }
  }

  applyCamera(dt) {
    const R = this.ctx.R, c = this.cam, ph = this.phase;
    let want;
    const humans = this.skaters.filter((s) => s.c.human && !s.finished && s.started);
    if (ph === 'race' && humans.length) {
      // from just outside the track, beside the human skaters, turning with them round the bends
      let x = 0, z = 0, lo = Infinity, hi = -Infinity;
      for (const s of humans) { const p = this.at(s); x += p.x; z += p.z; lo = Math.min(lo, s.p); hi = Math.max(hi, s.p); }
      x /= humans.length; z /= humans.length;
      if (hi - lo > 90) want = { x: 0, y: Y, z: 8, yaw: 0, pitch: 0.82, width: 170 };
      else {
        const cx = clamp(x, -SX, SX);
        let yaw = Math.atan2(x - cx, z);
        while (yaw - c.yaw > Math.PI) yaw -= 2 * Math.PI;
        while (yaw - c.yaw < -Math.PI) yaw += 2 * Math.PI;
        want = { x, y: Y + 2, z, yaw, pitch: 0.62, width: 82 + (hi - lo) * 0.8 };
      }
    } else if (ph === 'pre' || ph === 'marks') want = { x: -SX + 6, y: Y + 2, z: R0 + 8, yaw: -0.25, pitch: 0.4, width: 80 };
    else want = { x: 0, y: Y, z: 8, yaw: 0, pitch: 0.82, width: 170 };
    for (const k of Object.keys(want)) c[k] = dt >= 1 ? want[k] : damp(c[k], want[k], 2.2, Math.min(dt, 0.1));
    R.orbit(c.x, c.y, c.z, { yaw: c.yaw, pitch: c.pitch, width: c.width, shadowSpan: Math.max(200, c.width * 1.5) });
    R.setFocus(0.5, 0.36, 0.7);
  }

  // ---------------------------------------------------------------- cinematics
  get room() { return 'The kitchen, on a winter night'; }
  flyIn() {
    return [
      { x: -30, y: 84, z: -70, yaw: 0.05, pitch: 0.04, width: 150 },
      { x: 120, y: 30, z: -70, yaw: -0.6, pitch: 0.1, width: 100 },
      { x: 0, y: 5, z: 0, yaw: 0, pitch: 0.62, width: 240 },
    ];
  }
  // on the icing-sugar island in the middle of the rink (in place of the lap board), the gingerbread crowd behind
  ceremonySpot() {
    this.board.visible = false;
    return { x: 0, y: Y + 1, z: 0, style: 'biscuits', gear: 'skate', yaw: 0.25, pitch: 0.16, width: 46 };
  }

  dispose() {
    for (const s of this.skaters) s.fig.dispose();
    this.tags?.clear();
  }
}

export default {
  id: 'speedskating', name: 'Speed skating', season: 'Winter',
  blurb: 'Two laps of an ice oval frozen in a baking tray: long strokes, and lean into the bends.',
  venue: 'A baking tray of ice on the kitchen counter, lanes piped in icing and sweets round the bends.',
  loading: 'Freezing the baking tray…',
  how: [
    { verb: 'Timing', text: 'On the line, <b>hold action</b> and let go on the whistle.' },
    { verb: 'Rhythm', text: 'Tap <b>left</b> and <b>right</b> in turn: long, steady strokes beat fast ones.' },
    { verb: 'Timing', text: 'Tap <b>action</b> at the sweets to lean into a bend, and <b>action</b> again after it to stand up. Not leaning sends you wide and slow.' },
  ],
  helpers: {
    little: 'You push off and <b>lean into the bends by yourself</b>. Just tap <b>any button</b> on a slow, steady beat.',
    kid: 'A slower beat, and a late lean doesn\'t send you as wide.',
  },
  better: 'lower',
  resultsDelay: 1.6,
  create: (ctx) => new SpeedSkating(ctx),
};
