// Biathlon: a mass start on one cotton-wool loop round the coffee table, up and over a sofa cushion,
// through a forest of felt fir trees. Three laps. In the stadium the track forks: after laps 1 and 2 you
// turn off to the shooting range, after lap 3 you go straight on to the finish.
// Flats: an easy skating rhythm. The climb: a faster, harder beat (and your heart rate goes up).
// The descent: hold ACTION to tuck (faster, and your heart calms down), but come out of the tuck before
// the curve at the bottom or you tumble into the cotton wool. At the range: LEFT/RIGHT bring the drifting
// sight onto each cap, ACTION shoots; the sight sways more the faster your heart beats. Every miss is a
// penalty loop.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, blendPose, REST } from '../figurine.js';
import { crowd, banner } from '../props.js';
import { Rhythm, BotTapper } from '../verbs.js';
import { Particles } from '../fx.js';
import { clamp, damp, rng, makeNoise2D } from '../util.js';

// ---------- the course ----------
// a rounded rectangle round the coffee table; +x along the front (the stadium), clockwise from above
const HX = 150, HZ = 82, CR = 36;
const FIN_X = 40;              // start and finish line, on the front straight
const PIECES = [
  ['flat', 'line', [FIN_X, HZ], [HX - CR, HZ]],
  ['flat', 'arc', [HX - CR, HZ - CR], 0.5 * Math.PI, 0],      // centre, from angle, to angle (x = cos, z = sin)
  ['flat', 'line', [HX, HZ - CR], [HX, -HZ + CR]],
  ['flat', 'arc', [HX - CR, -HZ + CR], 0, -0.5 * Math.PI],
  ['flat', 'line', [HX - CR, -HZ], [40, -HZ]],
  ['climb', 'line', [40, -HZ], [10, -HZ]],
  ['top', 'line', [10, -HZ], [-8, -HZ]],
  ['descent', 'line', [-8, -HZ], [-90, -HZ]],
  ['runout', 'line', [-90, -HZ], [-HX + CR, -HZ]],
  ['curve', 'arc', [-HX + CR, -HZ + CR], -0.5 * Math.PI, -Math.PI],
  ['flat', 'line', [-HX, -HZ + CR], [-HX, HZ - CR]],
  ['flat', 'arc', [-HX + CR, HZ - CR], -Math.PI, -1.5 * Math.PI],
  ['stadium', 'line', [-HX + CR, HZ], [FIN_X, HZ]],
];
const SEG = (() => {
  let s = 0;
  return PIECES.map(([kind, type, a, b, c]) => {
    const len = type === 'line' ? Math.hypot(b[0] - a[0], b[1] - a[1]) : Math.abs(c - b) * CR;
    const seg = { kind, type, a, b, c, s0: s, len };
    s += len;
    return seg;
  });
})();
const LAP = SEG[SEG.length - 1].s0 + SEG[SEG.length - 1].len;
const STADIUM = SEG[SEG.length - 1];
const PEAK = 16;               // the cushion's height
const LAPS = 3, RANGES = 2, SHOTS = 5;
const RANGE_OFF = 18;          // the range lane, this far into the infield
const TARGET_Z = HZ - 52;      // the shoebox of caps
const PEN = { x: 26, z: 46, r: 9 };          // the penalty loop, in the infield after the range
const PEN_LEN = 2 * Math.PI * PEN.r;
const T_FLAT = 5.5, T_CLIMB = 7.5;
const V_FLAT = 34, V_CLIMB = 18, V_TUCK = 48, V_UP = 32;
const ORD = ['1st', '2nd', '3rd', '4th'];
const BOT = {
  easy: { cad: 0.84, push: 0.25, tuck: 0.6, stand: 0.82, aimT: [1.5, 0.6], hit: 0.5 },
  normal: { cad: 0.95, push: 0.12, tuck: 0.85, stand: 0.93, aimT: [1.15, 0.4], hit: 0.7 },
  hard: { cad: 1.0, push: 0.05, tuck: 1, stand: 0.98, aimT: [0.9, 0.3], hit: 0.84 },
};

function segAt(s) {
  s = ((s % LAP) + LAP) % LAP;
  let k = 0;
  while (k < SEG.length - 1 && s >= SEG[k + 1].s0) k++;
  return { seg: SEG[k], u: (s - SEG[k].s0) / SEG[k].len, k };
}
// position, direction of travel and height on the loop at distance s; positive off moves into the infield
function trackAt(s, off = 0) {
  const { seg, u } = segAt(s);
  let x, z, dx, dz;
  if (seg.type === 'line') {
    x = seg.a[0] + (seg.b[0] - seg.a[0]) * u; z = seg.a[1] + (seg.b[1] - seg.a[1]) * u;
    dx = (seg.b[0] - seg.a[0]) / seg.len; dz = (seg.b[1] - seg.a[1]) / seg.len;
  } else {
    const ang = seg.b + (seg.c - seg.b) * u, dir = Math.sign(seg.c - seg.b);
    x = seg.a[0] + Math.cos(ang) * CR; z = seg.a[1] + Math.sin(ang) * CR;
    dx = -Math.sin(ang) * dir; dz = Math.cos(ang) * dir;
  }
  const nx = -dz, nz = dx;
  let y = 0, slope = 0;
  if (seg.kind === 'climb') { const k = u; y = PEAK * k * k * (3 - 2 * k); slope = PEAK * 6 * u * (1 - u) / seg.len; }
  else if (seg.kind === 'top') y = PEAK;
  else if (seg.kind === 'descent') { const k = 1 - u; y = PEAK * k * k * (3 - 2 * k); slope = -PEAK * 6 * u * (1 - u) / seg.len; }
  return { x: x - nx * off, z: z - nz * off, dx, dz, y, slope, kind: seg.kind };
}
// the range lane: off the stadium straight into the infield and back
const RANGE_IN = STADIUM.s0 + 20, RANGE_OUT = STADIUM.s0 + STADIUM.len - 24;
function rangeOffset(s) {
  if (s < RANGE_IN || s > RANGE_OUT) return 0;
  const a = clamp((s - RANGE_IN) / 16, 0, 1), b = clamp((RANGE_OUT - s) / 16, 0, 1);
  const k = Math.min(a, b);
  return RANGE_OFF * k * k * (3 - 2 * k);
}

class Biathlon {
  constructor(ctx) {
    this.ctx = ctx;
    this.r = ctx.rand;
    this.phase = 'pre';
    this.t = 0;
    this.cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0.9, width: 300 };
    this.skiers = [];
  }

  // ---------------------------------------------------------------- venue
  async build() {
    const { kit: K, R, competitors } = this.ctx;
    R.setLighting({
      sunDir: [-0.4, 1, 0.5], sunColor: 0xfff1e0, sunIntensity: 2.0,
      hemiSky: 0xe6eefc, hemiGround: 0x5c4f45, hemiIntensity: 0.62,
      envIntensity: 0.45, exposure: 0.92, background: 0x1c2130, shadowRadius: 4,
    });
    this.noise = makeNoise2D(91);
    this.buildRoom(K);
    this.buildTrack(K);
    this.buildTrees(K);
    this.buildRange(K, competitors.length);
    this.buildCrowd(K, competitors);
    this.buildBadges(K);
    this.particles = new Particles(K.group, 700);
    this.particles.setScale(R.renderer.domElement.height * 0.9);
    const offs = [-6, -2, 2, 6];
    competitors.forEach((c, i) => {
      const fig = new Figurine({ paint: c.paint, seed: c.seed, number: c.number });
      fig.setGear('ski');
      const holder = new THREE.Group();
      holder.rotation.order = 'YXZ';
      holder.add(fig.root);
      fig.root.rotation.y = Math.PI / 2;
      K.group.add(holder);
      const s0 = -6 - (i % 2) * 5;
      this.skiers.push({
        c, fig, holder, i, s: s0, dist: s0, lap: 0, v: 0, off: offs[i], pref: offs[i], hr: 0.35, effort: 0,
        rhythm: new Rhythm({ target: T_FLAT }), anim: this.r(), state: 'race', crashT: 0, tuck: false,
        visit: 0, shots: [], visitShots: [], aim: { x: 0, y: 0, t: 0 }, pen: 0, penS: 0, finished: false, time: null, mat: i,
        bot: c.human ? null : { tap: new BotTapper(c.pad, rng(c.seed * 11 + 1)), next: 0 },
        botTuck: this.r(), botStand: this.r(), idle: this.r() * 10, crashes: 0,
      });
    });
    this.buildHud();
    this.placeAll(true);
    this.applyCamera(1);
  }

  buildRoom(K) {
    const g = K.group;
    const T = K.TX.woodTextures({ size: 1024, planks: 4, base: 0x9a7356, dark: 0x5f4532, light: 0xbf9a78, seed: 35, ringFreq: 12, roughBase: 0.55, lacquer: 0.35, grainContrast: 0.8 });
    const geo = new THREE.PlaneGeometry(1000, 700).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getZ(i) / 58, pos.getX(i) / 150);
    const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ ...T, roughness: 0.66, envMapIntensity: 0.35 }));
    floor.receiveShadow = true; g.add(floor);
    // a pale blue rug under the whole course
    const rc = K.TX.makeCanvas(256), rg = rc.getContext('2d');
    rg.fillStyle = '#b9cfe0'; rg.fillRect(0, 0, 256, 256);
    const img = rg.getImageData(0, 0, 256, 256), d = img.data;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const k = (y * 256 + x) * 4, v = 0.86 + 0.14 * this.noise.noise(x * 0.5, y * 0.5); d[k] *= v; d[k + 1] *= v; d[k + 2] *= v; }
    rg.putImageData(img, 0, 0);
    const rug = new THREE.Mesh(new K.RoundedBoxGeometry(400, 1, 250, 2, 0.4), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(rc, { repeat: [6, 4] }), roughness: 1 }));
    rug.position.set(0, 0.5, 0); rug.receiveShadow = true; g.add(rug);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1000, 300), K.std({ color: 0xbcc9d8, roughness: 0.95 }));
    wall.position.set(0, 150, -200); g.add(wall);
    // the coffee table in the middle, plush fans on top
    const wood = new THREE.MeshPhysicalMaterial({ color: 0x8a5a36, roughness: 0.35, clearcoat: 0.6 });
    const top = new THREE.Mesh(new K.RoundedBoxGeometry(112, 4, 40, 3, 1.4), wood);
    top.position.set(-20, 20, -18); top.castShadow = true; top.receiveShadow = true; g.add(top);
    for (const x of [-69, 29]) for (const z of [-33, -3]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.6, 18, 10), wood); leg.position.set(x, 9, z); leg.castShadow = true; g.add(leg); }
    K.contact(-20, -18, 60, 24, 0.4);
    this.tableTop = { x: -20, y: 22, z: -18 };
  }

  ribbon(K, mat, from, to, offAt, W, Y) {
    const N = Math.max(8, Math.ceil((to - from) / 3)), verts = [], uvs = [], idx = [];
    for (let k = 0; k <= N; k++) {
      const s = from + (k / N) * (to - from);
      const o = offAt(s);
      for (const side of [-1, 1]) { const p = trackAt(s, o + side * W / 2); verts.push(p.x, Y + p.y + 0.2, p.z); uvs.push(s / 20, side > 0 ? 1 : 0); }
      if (k < N) idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); rg.setIndex(idx); rg.computeVertexNormals();
    const m = new THREE.Mesh(rg, mat);
    m.receiveShadow = true;
    K.group.add(m);
  }

  buildTrack(K) {
    const g = K.group;
    const W = 20, Y = 1.05;
    const fluff = K.TX.noiseField(256, { seed: 12, period: 10, oct: 4 });
    const snowM = new THREE.MeshStandardMaterial({ color: 0xfbfbfd, roughness: 1, normalMap: K.TX.toTexture(K.TX.normalFromHeight(fluff, 256, 256, 3), { srgb: false, repeat: [1, 1] }), side: THREE.DoubleSide });
    this.snowM = snowM;
    // the main loop, and the range lane forking off the stadium straight
    this.ribbon(K, snowM, 0, LAP, () => 0, W, Y);
    this.ribbon(K, snowM, RANGE_IN - 2, RANGE_OUT + 2, (s) => rangeOffset(s), 14, Y + 0.05);
    // the snow ramp over the cushion (climb, top, descent)
    const sh = new THREE.Shape();
    const xs = [];
    const r0 = SEG[5].s0, r1 = SEG[7].s0 + SEG[7].len;
    for (let k = 0; k <= 50; k++) xs.push(r0 + (k / 50) * (r1 - r0));
    sh.moveTo(-trackAt(xs[0]).x, 0);
    xs.forEach((s) => { const p = trackAt(s); sh.lineTo(-p.x, p.y + Y); });
    sh.lineTo(-trackAt(xs[xs.length - 1]).x, 0);
    sh.closePath();
    const ramp = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1, bevelSegments: 3 }), snowM);
    ramp.rotation.y = Math.PI; ramp.position.set(0, 0, -HZ + W / 2);
    ramp.castShadow = true; ramp.receiveShadow = true; g.add(ramp);
    const cushion = new THREE.Mesh(new K.RoundedBoxGeometry(26, PEAK - 1, 32, 4, 4), new THREE.MeshPhysicalMaterial({ color: 0xc4655a, roughness: 0.85, sheen: 0.7, sheenColor: 0xffd6c8 }));
    cushion.position.set(1, (PEAK - 1) / 2, -HZ); cushion.castShadow = true; g.add(cushion);
    // cotton-wool balls along the edges, round the penalty loop, and a soft drift at the bottom curve
    const balls = [];
    for (let s = 0; s < LAP; s += 4.2) for (const side of [-1, 1]) {
      if (side > 0 && s > RANGE_IN && s < RANGE_OUT) continue;
      const p = trackAt(s + this.r(), side * (W / 2 + 0.8));
      balls.push({ x: p.x, y: Y + p.y + 0.6, z: p.z, s: 1.2 + this.r() * 1.3, sy: 0.75 });
    }
    for (let s = RANGE_IN; s < RANGE_OUT; s += 4.2) { const p = trackAt(s, rangeOffset(s) + 8); if (rangeOffset(s) > 12) balls.push({ x: p.x, y: Y + 0.6, z: p.z, s: 1.1 + this.r(), sy: 0.75 }); }
    for (let k = 0; k < 30; k++) { const a = (k / 30) * Math.PI * 2; for (const rr of [PEN.r - 4, PEN.r + 4]) balls.push({ x: PEN.x + Math.cos(a) * rr, y: 1.6, z: PEN.z + Math.sin(a) * rr, s: 1.1 + this.r(), sy: 0.75 }); }
    for (let k = 0; k < 16; k++) balls.push({ x: -HX - 14 + this.r() * 10, y: 2, z: -HZ - 14 + this.r() * 12, s: 3 + this.r() * 3, sy: 0.8 });
    K.instances(new THREE.IcosahedronGeometry(1, 2), K.felt(0xfbfbfd, { sheenColor: 0xffffff }), balls);
    const pen = new THREE.Mesh(new THREE.RingGeometry(PEN.r - 4, PEN.r + 4, 40).rotateX(-Math.PI / 2), snowM);
    pen.position.set(PEN.x, 1.2, PEN.z); pen.receiveShadow = true; g.add(pen);
    // start and finish line in red tape, with a finish arch of drinking straws and a paper banner
    const p0 = trackAt(0);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1.6, W).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe23b2e, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.position.set(p0.x, Y + 0.3, p0.z); g.add(line);
    const straw = new THREE.CylinderGeometry(0.5, 0.5, 22, 8), strawM = K.std({ color: 0xf08aa3, roughness: 0.5 });
    for (const dz of [-W / 2 - 2, W / 2 + 2]) { const m = new THREE.Mesh(straw, strawM); m.position.set(FIN_X, 11, HZ + dz); m.castShadow = true; g.add(m); }
    const bc = K.TX.makeCanvas(512, 96), b = bc.getContext('2d');
    b.fillStyle = '#fffdf6'; b.fillRect(0, 0, 512, 96);
    for (let k = 0; k < 16; k++) { b.fillStyle = k % 2 ? '#1f1a17' : '#fffdf6'; b.fillRect(k * 32, 0, 32, 14); b.fillStyle = k % 2 ? '#fffdf6' : '#1f1a17'; b.fillRect(k * 32, 82, 32, 14); }
    b.fillStyle = '#e23b2e'; b.font = '54px "Lilita One", Impact, sans-serif'; b.textAlign = 'center'; b.textBaseline = 'middle'; b.fillText('FINISH', 256, 50);
    const banner2 = new THREE.Mesh(new THREE.PlaneGeometry(W + 4, 4.2), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(bc, { wrap: false }), roughness: 0.9, side: THREE.DoubleSide }));
    banner2.position.set(FIN_X, 20, HZ); banner2.rotation.y = Math.PI / 2; banner2.castShadow = true; g.add(banner2);
    // signs: an arrow to the range at the fork, and a 'stand up!' sign before the bottom curve
    const sign = (draw, x, z, ry) => {
      const sc = K.TX.makeCanvas(128, 96), c = sc.getContext('2d');
      c.fillStyle = '#c69a62'; c.fillRect(0, 0, 128, 96); draw(c);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 9), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(sc, { wrap: false }), roughness: 0.9, side: THREE.DoubleSide }));
      m.position.set(x, 12, z); m.rotation.y = ry; m.castShadow = true; g.add(m);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 8, 6), K.std({ color: 0xe9d3a8 })); st.position.set(x, 4, z); g.add(st);
    };
    sign((c) => { c.fillStyle = '#1f1a17'; c.font = '30px "Lilita One", Impact, sans-serif'; c.textAlign = 'center'; c.fillText('RANGE', 64, 40); c.fillText('↘', 64, 80); }, -HX + CR + 6, HZ + 16, 0.2);
    sign((c) => { c.fillStyle = '#e23b2e'; c.font = '28px "Lilita One", Impact, sans-serif'; c.textAlign = 'center'; c.fillText('STAND', 64, 42); c.fillText('UP!', 64, 78); }, -94, -HZ - 16, 0.1);
  }

  buildTrees(K) {
    // felt fir trees on little wooden stands, round the outside of the loop and in the corners
    const felt = K.felt(0x3f8a4f, { sheenColor: 0xb8f0c4 });
    const trunk = K.std({ color: 0x7a5236, roughness: 0.8 });
    const spots = [[-185, -60], [-178, 20], [-190, 70], [-120, -118], [-40, -122], [70, -120], [140, -118], [188, -40], [190, 40], [175, 110], [100, 118], [-90, 118], [-160, 112], [80, -44], [120, -20], [-110, 10]];
    const cones = [], trunks = [];
    for (const [x, z] of spots) {
      const s = 0.8 + this.r() * 0.5;
      trunks.push({ x, y: 3 * s, z, s, sy: s });
      for (let k = 0; k < 3; k++) cones.push({ x, y: (6 + k * 6.5) * s, z, s: s * (1 - k * 0.22), ry: this.r() * 3 });
    }
    K.instances(new THREE.ConeGeometry(9, 12, 10), felt, cones);
    K.instances(new THREE.CylinderGeometry(1.6, 1.8, 6, 8), trunk, trunks);
  }

  buildRange(K, n) {
    const g = K.group;
    // shooting mats on the range lane, and a shoebox with five caps per lane facing them
    this.mats = [];
    const matM = new THREE.MeshStandardMaterial({ color: 0x2fae5a, roughness: 0.9 });
    const card = K.std({ color: 0xc69a62, roughness: 0.9 });
    const x0 = trackAt(RANGE_IN + 26).x, x1 = trackAt(RANGE_OUT - 26).x;
    const box = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) + 30, 10, 16), [card, card, K.std({ color: 0xd8b07c, roughness: 0.9 }), card, card, card]);
    box.position.set((x0 + x1) / 2, 5, TARGET_Z); box.castShadow = true; box.receiveShadow = true; g.add(box);
    const capGeo = new THREE.CylinderGeometry(1.5, 1.6, 0.55, 24);
    const capM = [new THREE.MeshPhysicalMaterial({ color: 0xb9bcc2, roughness: 0.3, metalness: 0.6 }), new THREE.MeshPhysicalMaterial({ color: 0x1f1a17, roughness: 0.35, clearcoat: 0.5 }), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })];
    this.targets = [];
    for (let i = 0; i < n; i++) {
      const s = RANGE_IN + 26 + i * ((RANGE_OUT - 26) - (RANGE_IN + 26)) / Math.max(1, n - 1);
      const p = trackAt(s, RANGE_OFF);
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(8, 9).rotateX(-Math.PI / 2), matM);
      mat.position.set(p.x, 1.25, p.z); mat.receiveShadow = true; g.add(mat);
      this.mats.push({ s, x: p.x, z: p.z });
      const row = [];
      for (let k = 0; k < SHOTS; k++) {
        const cap = new THREE.Mesh(capGeo, capM);
        cap.position.set(p.x + (k - 2) * 3.4, 10.3, TARGET_Z);
        cap.castShadow = true; g.add(cap);
        row.push({ cap, flip: -1 });
      }
      this.targets.push(row);
    }
  }

  buildCrowd(K, competitors) {
    const spots = [];
    const T = this.tableTop;
    for (let k = 0; k < 6; k++) spots.push({ x: T.x - 44 + k * 17, y: T.y, z: T.z - 6 + (k % 2) * 12, ry: (k % 2) ? 0.3 : -0.3, size: 10 });
    for (let k = 0; k < 5; k++) spots.push({ x: -100 + k * 40, y: 1, z: -HZ - 34 - (k % 2) * 6, ry: 0.2 * (k % 2 ? 1 : -1), size: 12 });
    for (let k = 0; k < 3; k++) spots.push({ x: 196, y: 1, z: -30 + k * 28, ry: -1.3, size: 12 });
    this.crowd = crowd(K.group, spots, 33);
    [[110, -112], [-150, 100], [-200, -10], [10, -HZ - 44]].forEach(([x, z], k) => {
      const b = banner(competitors[k % competitors.length].code, 15, { seed: 80 + k });
      b.position.set(x, 0, z); b.rotation.y = (this.r() - 0.5) * 0.4;
      K.group.add(b);
    });
  }

  // little picture badges that float over a human skier: tuck now, stand up, push uphill
  buildBadges(K) {
    const draw = (bg, fn) => {
      const c = K.TX.makeCanvas(128), g = c.getContext('2d');
      g.fillStyle = bg; g.strokeStyle = '#1f1a17'; g.lineWidth = 7;
      g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill(); g.stroke();
      g.strokeStyle = '#1f1a17'; g.fillStyle = '#1f1a17'; g.lineWidth = 8; g.lineCap = 'round'; g.lineJoin = 'round';
      fn(g);
      return K.TX.toTexture(c, { wrap: false });
    };
    const stick = (g, pts, head) => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke(); g.beginPath(); g.arc(...head, 9, 0, Math.PI * 2); g.fill(); };
    this.badgeTex = {
      tuck: draw('#7be495', (g) => { stick(g, [[34, 92], [58, 78], [46, 66], [72, 58], [84, 64]], [88, 52]); g.beginPath(); g.moveTo(24, 98); g.lineTo(104, 98); g.stroke(); }),
      stand: draw('#ff8a65', (g) => { stick(g, [[50, 100], [62, 76], [74, 100]], [64, 34]); g.beginPath(); g.moveTo(64, 46); g.lineTo(64, 78); g.moveTo(44, 56); g.lineTo(84, 56); g.stroke(); }),
      climb: draw('#ffc93c', (g) => { g.beginPath(); g.moveTo(22, 100); g.lineTo(100, 40); g.stroke(); g.font = '46px "Lilita One", Impact, sans-serif'; g.textAlign = 'center'; g.fillText('+', 46, 60); g.fillText('+', 82, 96); }),
    };
    this.badges = new Map();
    const mat = () => new THREE.SpriteMaterial({ map: this.badgeTex.tuck, transparent: true, depthWrite: false, depthTest: false });
    for (const c of this.ctx.competitors) if (c.human) {
      const sp = new THREE.Sprite(mat());
      sp.scale.set(7, 7, 1); sp.visible = false; sp.renderOrder = 6;
      K.group.add(sp);
      this.badges.set(c.index ?? this.ctx.competitors.indexOf(c), sp);
    }
  }

  buildHud() {
    const el = this.ctx.hud.el;
    const style = document.createElement('style');
    style.textContent = `.bi-m{position:absolute;left:12px;width:min(290px,44vw);background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17;padding:5px 10px 7px;font:800 12px/1.2 Rubik,sans-serif;color:#1f1a17}
      .bi-m .h{display:flex;align-items:center;gap:6px}.bi-m img{height:18px;width:27px;object-fit:cover;border-radius:3px;border:2px solid #1f1a17}
      .bi-m .k{margin-left:auto;font-weight:800;color:#4a413a;text-align:right}
      .bi-m .row{display:grid;grid-template-columns:40px 1fr;gap:6px;align-items:center;margin-top:4px;color:#4a413a;font-weight:700}
      .bi-m .bar{position:relative;height:10px;border:2px solid #1f1a17;border-radius:99px;background:#fff;overflow:hidden}
      .bi-m .bar i{position:absolute;inset:0 auto 0 0;width:0;background:#2fae5a}.bi-m .hr i{background:linear-gradient(90deg,#7be495,#f2c230 60%,#e23b2e)}
      .bi-m .shoot{display:none;position:relative;height:56px;margin-top:5px;border:2px solid #1f1a17;border-radius:10px;background:#c69a62;overflow:hidden}
      .bi-m.range .shoot{display:block}.bi-m.range .row{display:none}
      .bi-m .shoot b{position:absolute;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#1f1a17;border:2px solid #3a3634}
      .bi-m .shoot b.hit{background:#fff}.bi-m .shoot b.miss{background:#1f1a17;outline:3px solid #e23b2e}
      .bi-m .shoot u{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border:3px solid #e23b2e;border-radius:50%;box-shadow:0 0 0 1px #fff}
      .bi-m .shoot u:before,.bi-m .shoot u:after{content:"";position:absolute;background:#e23b2e;left:50%;top:-8px;bottom:-8px;width:2px;margin-left:-1px}.bi-m .shoot u:after{top:50%;bottom:auto;left:-8px;right:-8px;width:auto;height:2px;margin:-1px 0 0}
      .bi-card{position:absolute;right:12px;top:64px;width:min(210px,36vw);background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17;padding:6px 10px;font:700 12px/1.3 Rubik,sans-serif;color:#1f1a17}
      .bi-card li{display:grid;grid-template-columns:26px 20px 1fr auto;gap:4px;align-items:center;list-style:none}.bi-card ol{margin:0;padding:0}.bi-card img{height:12px;width:18px;object-fit:cover;border-radius:2px}`;
    el.appendChild(style);
    this.meters = [];
    const humans = this.skiers.filter((s) => s.c.human);
    humans.forEach((sk, k) => {
      const d = document.createElement('div');
      d.className = 'bi-m';
      d.style.bottom = `${(sk.c.type === 'touch' ? 120 : 12) + k * 92}px`;
      d.innerHTML = `<div class="h"><img src="${sk.c.flag}" alt=""><span>${sk.c.short}</span><span class="k"></span></div>
        <div class="row"><span>Push</span><div class="bar ef"><i></i></div></div><div class="row"><span>Heart</span><div class="bar hr"><i></i></div></div>
        <div class="shoot">${Array.from({ length: SHOTS }, (_, i) => `<b style="left:${10 + i * 20}%"></b>`).join('')}<u></u></div>`;
      el.appendChild(d);
      this.meters.push({ sk, d, lap: d.querySelector('.k'), ef: d.querySelector('.ef i'), hr: d.querySelector('.hr i'), caps: d.querySelectorAll('.shoot b'), sight: d.querySelector('.shoot u'), lapText: '', cls: '' });
    });
    this.card = document.createElement('div');
    this.card.className = 'bi-card';
    this.card.innerHTML = '<ol></ol>';
    el.appendChild(this.card);
  }

  // ---------------------------------------------------------------- flow
  attract() { this.phase = 'attract'; }

  start() {
    this.phase = 'countdown'; this.t = 0;
    this.ctx.sound.setLoop('crowd', 0.35);
    this.ctx.hud.message('Ready…', 'small', '#fff');
    for (const sk of this.skiers) sk.c.pad.clear?.();
  }

  // which part of the loop is at s (for tests)
  kindAt(s) { return trackAt(s).kind; }

  update(dt) {
    const ctx = this.ctx, now = ctx.time();
    this.t += dt;
    if (this.phase === 'pre' || this.phase === 'attract') { for (let i = 0; i < this.skiers.length; i++) ctx.presses(i); return; }
    if (this.phase === 'countdown') {
      for (let i = 0; i < this.skiers.length; i++) ctx.presses(i);
      if (this.t > 1.5 && !this.goSaid) { this.goSaid = true; this.go(now); }
      return;
    }
    if (this.phase === 'done') {
      for (let i = 0; i < this.skiers.length; i++) ctx.presses(i);
      if (this.t > 2 && this.results) { const r = this.results; this.results = null; ctx.finish(r); }
      return;
    }
    for (const sk of this.skiers) this.stepSkier(sk, dt, now);
    this.overtake(dt);
    const done = this.skiers.filter((s) => s.finished).length;
    if (done && (this.skiers.every((s) => s.finished) || now - this.firstFinish > 30)) this.finishAll();
  }

  go(now) {
    this.phase = 'race'; this.t = 0;
    this.goT = now;
    this.ctx.hud.message('GO!', 'big', '#ffc93c', 0.9);
    this.ctx.sound.whistle(0.5);
    for (const sk of this.skiers) if (sk.bot) sk.bot.tap.start(now + 0.2 + this.r() * 0.25);
  }

  stepSkier(sk, dt, now) {
    const ctx = this.ctx;
    const q = ctx.presses(sk.i);
    const held = ctx.held(sk.i);
    const B = BOT[ctx.skillName] || BOT.normal;
    if (sk.finished) { sk.v = Math.max(0, sk.v - 18 * dt); sk.s += sk.v * dt; return; }
    const kind = sk.state === 'pen' ? 'flat' : trackAt(sk.s).kind;
    const uphill = kind === 'climb' || kind === 'top';
    const glide = kind === 'descent';
    // computer skiers: their own rhythm, tuck and getting up in time
    if (sk.bot && (sk.state === 'race' || sk.state === 'pen')) {
      const target = uphill ? T_CLIMB * (B.cad + (this.r() < B.push ? 0.35 : 0)) : T_FLAT * B.cad;
      if (glide && sk.bot.tap.on) sk.bot.tap.stop();
      else if (!glide && !sk.bot.tap.on) sk.bot.tap.start(now);
      if (!glide) sk.bot.tap.update(now, target, 0.08, 0.004);
    }
    if (sk.state === 'race' || sk.state === 'pen') {
      for (const e of q) if (e.down && e.b !== 'action') { const res = sk.rhythm.press(e.b, e.t); if (res === 'stumble') sk.v *= 0.9; }
      sk.rhythm.target = uphill ? T_CLIMB : T_FLAT;
      let eff = sk.rhythm.effort(now);
      const x = sk.rhythm.cadence(now) / sk.rhythm.target;
      // tuck: only does anything on the way down (and on the flat run-out after it, where it's a mistake)
      const wasTucked = sk.tuck;
      const want = sk.bot ? (glide && sk.botTuck < B.tuck) || (kind === 'runout' && sk.botTuck < B.tuck && sk.botStand >= B.stand) : held.action;
      sk.tuck = want && (glide || kind === 'runout');
      // heart rate: up with effort, a lot uphill; down in a tuck
      let hrT, rate;
      if (uphill) { hrT = 0.62 + 0.33 * eff + 0.9 * Math.max(0, x - 1.2); rate = 0.7; }
      else if (glide) { hrT = sk.tuck ? 0.28 : 0.45; rate = sk.tuck ? 0.9 : 0.5; }
      else { hrT = 0.4 + 0.3 * eff + 0.55 * Math.max(0, x - 1.12); rate = sk.hr > hrT ? 0.35 : 0.5; }
      sk.hr = clamp(sk.hr + (hrT - sk.hr) * rate * dt, 0.2, 1);
      if (uphill && x > 1.25) eff *= Math.max(0.45, 1 - (x - 1.25) * 0.8);
      if (sk.hr > 0.94) eff *= 0.8;
      sk.effort = eff;
      let vT, k;
      if (uphill) { vT = V_CLIMB * eff + (kind === 'top' ? 8 : 0); k = 2.2; }
      else if (glide) { vT = sk.tuck ? V_TUCK : V_UP; k = 1.4; }
      else if (sk.tuck) { vT = sk.v; k = 0; }
      else { vT = Math.max(V_FLAT * eff, kind === 'runout' || kind === 'curve' ? sk.v * 0.97 : 0); k = 1.6; }
      sk.v += (vT - sk.v) * (1 - Math.exp(-k * dt));
      // still tucked in the bottom curve: into the cotton wool
      if (kind === 'curve' && sk.state === 'race' && !sk.curveChecked) {
        sk.curveChecked = true;
        if (wasTucked) this.crash(sk);
      }
      if (kind !== 'curve' && kind !== 'runout') { sk.curveChecked = false; if (sk.bot && !glide) { sk.botTuck = this.r(); sk.botStand = this.r(); } }
      const ds = sk.v * dt;
      if (sk.state === 'pen') {
        sk.penS += ds;
        if (sk.penS >= sk.pen * PEN_LEN) { sk.state = 'race'; sk.s = Math.max(sk.s, RANGE_OUT + 2); sk.pen = 0; sk.blend = 0.6; }
      } else {
        sk.s += ds;
        // the fork: after laps 1 and 2 into the range lane, after lap 3 on to the finish
        if (sk.visit === sk.lap && sk.visit < RANGES && sk.s >= RANGE_IN && sk.s < RANGE_OUT) { sk.state = 'toRange'; sk.visitShots = []; this.resetCaps(sk); }
        if (sk.s >= LAP) { sk.s -= LAP; sk.lap++; if (sk.lap >= LAPS) this.finishSkier(sk, now); else if (sk.c.human && sk.lap === LAPS - 1) ctx.hud.flash(`${sk.c.short}: last lap!`, '#ffc93c'); }
      }
    } else if (sk.state === 'crash') {
      sk.v = Math.max(0, sk.v - 40 * dt); sk.s += sk.v * dt;
      sk.crashT -= dt;
      sk.hr = clamp(sk.hr + (0.4 - sk.hr) * 0.5 * dt, 0.2, 1);
      if (sk.crashT <= 0) { sk.state = 'race'; sk.v = 4; sk.tuck = false; }
    } else if (sk.state === 'toRange') {
      // along the range lane to the mat, and stop
      const m = this.mats[sk.mat];
      sk.v = Math.max(8, sk.v - 14 * dt);
      sk.s = Math.min(m.s, sk.s + sk.v * dt);
      sk.off = damp(sk.off, rangeOffset(sk.s), 8, dt);
      if (sk.s >= m.s - 0.05) {
        sk.state = 'shoot'; sk.v = 0; sk.shootT = 0;
        // the sight comes up somewhere off the caps and keeps drifting
        sk.aim = { x: 0, y: 0, t: this.r() * 10, nudge: (this.r() < 0.5 ? -1 : 1) * (1.1 + this.r() * 0.9), drift: 0 };
        sk.aim.t0 = sk.aim.t;
        sk.bot?.tap.stop();
        if (sk.bot) sk.bot.next = now + B.aimT[0] + this.r.gauss() * B.aimT[1] * 0.5;
      }
    } else if (sk.state === 'shoot') {
      sk.shootT += dt;
      sk.hr = clamp(sk.hr + (0.28 - sk.hr) * 0.22 * dt, 0.2, 1);
      const A = 0.2 + 1.05 * sk.hr * sk.hr;
      const a = sk.aim;
      a.t += dt;
      const steer = sk.bot ? 0 : (held.right ? 1 : 0) - (held.left ? 1 : 0);
      a.drift = clamp(a.drift + this.r.gauss() * 0.9 * Math.sqrt(dt) - a.drift * 0.6 * dt, -0.8, 0.8);
      a.nudge = clamp(a.nudge + (steer * 2.4 + a.drift) * dt, -2.6, 2.6);
      a.x = A * (0.8 * Math.sin(1.3 * a.t) + 0.35 * Math.sin(3.1 * a.t + 1)) + a.nudge;
      a.y = A * 0.75 * Math.sin(1.9 * a.t + 0.5);
      // nobody waits for ever: after six seconds the shot goes off by itself
      let fire = q.some((e) => e.b === 'action' && e.down) || a.t - a.t0 > 6;
      let forced = null;
      if (sk.bot && now >= sk.bot.next) {
        fire = true;
        forced = this.r() < B.hit - Math.max(0, sk.hr - 0.5) * 0.4;
        sk.bot.next = now + Math.max(0.5, B.aimT[0] + this.r.gauss() * B.aimT[1]);
      }
      if (fire) this.shoot(sk, forced);
    } else if (sk.state === 'leaveRange') {
      sk.v = Math.min(V_FLAT * 0.7, sk.v + 20 * dt);
      sk.s += sk.v * dt;
      sk.off = damp(sk.off, rangeOffset(sk.s), 6, dt);
      if (sk.s >= RANGE_OUT - (sk.pen > 0 ? 18 : 0)) {
        if (sk.pen > 0) { sk.state = 'pen'; sk.penS = 0; sk.blend = 0.6; if (sk.c.human) ctx.hud.flash(`${sk.c.short}: ${sk.pen} penalty loop${sk.pen > 1 ? 's' : ''}`, '#ff8a65'); }
        else { sk.state = 'race'; }
        if (sk.bot) sk.bot.tap.start(now);
      }
    }
    if (sk.blend > 0) sk.blend = Math.max(0, sk.blend - dt);
  }

  resetCaps(sk) {
    for (const t of this.targets[sk.mat]) { t.flip = -1; t.cap.rotation.x = 0; t.cap.position.y = 10.3; }
  }

  shoot(sk, forced) {
    const ctx = this.ctx;
    const k = sk.visitShots.length;
    const a = sk.aim;
    const hit = forced != null ? forced : Math.hypot(a.x, a.y) < 0.62;
    sk.visitShots.push(hit); sk.shots.push(hit);
    ctx.sound.pop();
    const t = this.targets[sk.mat][k];
    if (hit) { t.flip = 0; ctx.sound.clack(0); this.particles.emit(t.cap.position.x, t.cap.position.y + 1, t.cap.position.z, { vx: 0, spread: 2, up: 2, color: 0xffffff, size: 0.5, life: 0.35, alpha: 0.7, grav: 6, n: 6 }); }
    // the next cap: the sight wanders off again
    a.nudge = (this.r() < 0.5 ? -1 : 1) * (0.7 + this.r() * 0.7);
    a.t0 = a.t;
    if (sk.visitShots.length >= SHOTS) {
      sk.pen = sk.visitShots.filter((h) => !h).length;
      sk.visit++;
      sk.state = 'leaveRange'; sk.v = 4;
      if (sk.c.human) ctx.hud.flash(sk.pen ? `${sk.c.short}: ${SHOTS - sk.pen}/${SHOTS}` : `${sk.c.short}: clean shooting!`, sk.pen ? '#ffffff' : '#7be495');
    }
  }

  crash(sk) {
    sk.state = 'crash'; sk.crashT = 1.6; sk.crashes++;
    this.ctx.sound.puff(); this.ctx.sound.aww();
    const p = trackAt(sk.s, sk.off);
    this.particles.emit(p.x, 2, p.z, { vx: 0, spread: 8, up: 6, color: 0xffffff, size: 2.4, life: 1.0, alpha: 0.7, grav: 6, grow: 1.6, n: 30 });
    if (sk.c.human) this.ctx.hud.flash(`${sk.c.short}: into the cotton wool!`, '#ff8a65');
  }

  // faster skiers swing out to pass; everyone drifts back to their own line afterwards
  overtake(dt) {
    const L = this.skiers.filter((s) => s.state === 'race');
    for (const a of L) {
      let want = a.pref;
      for (const b of L) {
        if (a === b) continue;
        const ahead = b.dist - a.dist;
        if (ahead > 0 && ahead < 9 && Math.abs(b.off - a.off) < 4 && a.v > b.v - 1) want = b.off + (b.off > 3 ? -7 : 7);
      }
      a.off = damp(a.off, clamp(want, -8, 8), 3, dt);
    }
    for (const s of this.skiers) s.dist = s.lap * LAP + s.s + (s.finished ? LAPS * LAP : 0);
  }

  finishSkier(sk, now) {
    sk.finished = true;
    sk.time = now - this.goT;
    sk.place = this.skiers.filter((s) => s.finished).length - 1;
    sk.bot?.tap.stop();
    if (sk.place === 0) { this.firstFinish = now; this.ctx.sound.cheer(1); }
    if (sk.c.human || sk.place === 0) this.ctx.hud.flash(`${sk.c.short} ${sk.time.toFixed(1)} s`, sk.place === 0 ? '#ffc93c' : '#ffffff');
    sk.fig.setExpression(sk.place === 0 ? 'wow' : 'happy');
  }

  finishAll() {
    this.phase = 'done'; this.t = 0;
    const ranked = [...this.skiers].filter((s) => s.finished).sort((a, b) => a.time - b.time);
    this.winner = ranked[0];
    this.ctx.hud.message(ranked[0] ? `${ranked[0].c.short} wins!` : '', 'small', '#ffc93c');
    for (const sp of this.badges.values()) sp.visible = false;
    this.results = this.skiers.map((s) => {
      const hits = s.shots.filter((h) => h).length;
      const sub = `shooting ${hits}/${s.shots.length || SHOTS * RANGES}${s.crashes ? ` · ${s.crashes} tumble${s.crashes > 1 ? 's' : ''}` : ''}`;
      return s.finished ? { value: s.time, text: `${s.time.toFixed(1)} s`, short: `${s.time.toFixed(1)} s`, sub } : { value: null, dnf: true, text: 'Didn\'t finish', sub };
    });
  }

  // ---------------------------------------------------------------- per frame
  placeAll(snap) {
    for (const sk of this.skiers) this.placeSkier(sk, snap ? 1 : 0);
  }

  placeSkier(sk, dt) {
    let p, head;
    if (sk.state === 'pen') {
      const a = sk.penS / PEN.r;
      p = { x: PEN.x + Math.cos(a) * PEN.r, z: PEN.z + Math.sin(a) * PEN.r, y: 0, slope: 0 };
      head = Math.atan2(-Math.cos(a), -Math.sin(a));
    } else {
      p = trackAt(sk.s, sk.off);
      head = Math.atan2(-p.dz, p.dx);
    }
    const H = sk.holder;
    const ty = 1.3 + p.y;
    if (sk.blend > 0 && dt < 1) {
      H.position.x = damp(H.position.x, p.x, 8, dt); H.position.z = damp(H.position.z, p.z, 8, dt); H.position.y = damp(H.position.y, ty, 8, dt);
    } else H.position.set(p.x, ty, p.z);
    if (sk.state === 'shoot') head = Math.atan2(1, 0);   // facing the shoebox (-z)
    let dh = head - H.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    H.rotation.y = dt >= 1 ? head : H.rotation.y + dh * (1 - Math.exp(-10 * dt));
    H.rotation.z = Math.atan(p.slope || 0);
  }

  frame(dt, paused) {
    const ctx = this.ctx, tt = ctx.time();
    if (!paused) this.particles.update(dt);
    for (const sk of this.skiers) {
      if (!paused) this.placeSkier(sk, dt);
      const fig = sk.fig;
      fig.ground = true;
      let pose;
      const kind = sk.state === 'pen' ? 'flat' : trackAt(sk.s).kind;
      if (this.phase === 'pre' || this.phase === 'attract' || this.phase === 'countdown') pose = this.phase === 'countdown' ? { ...POSES.tuck(0), lean: 0.6, y: -0.6 } : POSES.stand(tt + sk.idle);
      else if (sk.finished && sk.v < 3) pose = sk.place === 0 ? POSES.cheer(tt) : POSES.wave(tt + sk.idle);
      else if (sk.state === 'crash') pose = POSES.heap();
      else if (sk.state === 'shoot') pose = { ...REST, lean: 0.15, head: 0.1, shL: 1.45, shR: 1.35, abL: 0.05, elL: 0.25, elR: 0.7, hipL: 0.15, kneeL: 0.2, hipR: -0.1 };
      else if (sk.tuck || (kind === 'descent' && !sk.c.human)) pose = POSES.tuck(0);
      else if (kind === 'descent') pose = blendPose(POSES.tuck(0), POSES.stand(tt), 0.6);
      else {
        if (!paused) sk.anim = (sk.anim + Math.max(sk.rhythm.cadence(tt), sk.v / 8) * 0.5 * dt) % 1;
        const run = POSES.run(sk.anim, clamp(sk.v / V_FLAT, 0.3, 1));
        const sw = Math.sin(sk.anim * Math.PI * 2);
        // skating: legs push out to the sides; uphill bent over and working hard
        pose = { ...run, lean: kind === 'climb' ? 0.8 : 0.45, spL: 0.25 + 0.2 * Math.max(0, sw), spR: 0.25 + 0.2 * Math.max(0, -sw), hipL: run.hipL * 0.6, hipR: run.hipR * 0.6, vee: 0.25 };
        if (kind === 'curve') pose = blendPose(pose, { ...pose, roll: -0.5 }, 0.8);
      }
      fig.setPose(pose);
      if (!paused && sk.v > 20 && Math.random() < 0.3) { const hp = sk.holder.position; this.particles.emit(hp.x, hp.y - 0.8, hp.z, { vx: 0, spread: 2, up: 1.5, color: 0xffffff, size: 0.8, life: 0.45, alpha: 0.45, grav: 4, n: 1 }); }
      // the picture badge over a human skier
      const badge = this.badges.get(sk.i);
      if (badge) {
        let tex = null;
        if (this.phase === 'race' && (sk.state === 'race' || sk.state === 'pen')) {
          if (kind === 'descent') tex = this.badgeTex.tuck;
          else if (kind === 'runout' && sk.tuck) tex = this.badgeTex.stand;
          else if (kind === 'climb' || (kind === 'flat' && this.distTo(sk, 'climb') < 30)) tex = this.badgeTex.climb;
        }
        badge.visible = !!tex;
        if (tex) {
          if (badge.material.map !== tex) { badge.material.map = tex; badge.material.needsUpdate = true; }
          const hp = sk.holder.position;
          badge.position.set(hp.x, hp.y + 13, hp.z);
          const pulse = tex === this.badgeTex.stand ? 1 + 0.18 * Math.sin(tt * 18) : 1;
          badge.scale.set(7 * pulse, 7 * pulse, 1);
        }
      }
    }
    // hit caps flip over with a little hop
    if (!paused) for (const row of this.targets) for (const t of row) if (t.flip >= 0 && t.flip < 1) { t.flip = Math.min(1, t.flip + dt / 0.3); t.cap.rotation.x = Math.PI * t.flip; t.cap.position.y = 10.3 + Math.sin(Math.PI * t.flip) * 2.5; }
    this.crowd.update(tt, this.phase === 'race' ? 0.5 : this.phase === 'done' ? 0.6 : 0.15);
    this.updateHud();
    this.applyCamera(dt);
  }

  distTo(sk, kind) {
    const seg = SEG.find((g) => g.kind === kind);
    return ((seg.s0 - sk.s) % LAP + LAP) % LAP;
  }

  updateHud() {
    const ctx = this.ctx;
    const order = [...this.skiers].sort((a, b) => (b.finished - a.finished) || (a.finished && b.finished ? a.time - b.time : b.dist - a.dist));
    this.skiers.forEach((s, i) => ctx.hud.chip(i, this.phase === 'race' || this.phase === 'done' ? (s.finished ? `${ORD[s.place]} · ${s.time.toFixed(1)}` : `${ORD[order.indexOf(s)]}${s.state === 'pen' ? ' · loop' : s.state === 'shoot' || s.state === 'toRange' ? ' · range' : ''}`) : '', s.finished && s.place === 0 ? 'active' : ''));
    this.card.style.display = this.phase === 'race' ? '' : 'none';
    this.card.querySelector('ol').innerHTML = order.map((s, k) => `<li><span>${ORD[k]}</span><img src="${s.c.flag}" alt=""><span>${s.c.short}</span><b>${s.finished ? s.time.toFixed(1) : `lap ${Math.min(LAPS, s.lap + 1)}`}</b></li>`).join('');
    for (const m of this.meters) {
      const sk = m.sk;
      const range = sk.state === 'shoot';
      const cls = range ? 'bi-m range' : 'bi-m';
      if (cls !== m.cls) { m.d.className = cls; m.cls = cls; }
      const lap = sk.finished ? 'finished!' : `lap ${Math.min(LAPS, sk.lap + 1)}/${LAPS}`;
      if (lap !== m.lapText) { m.lap.textContent = lap; m.lapText = lap; }
      m.ef.style.width = `${clamp(sk.effort / 1.04, 0, 1) * 100}%`;
      m.hr.style.width = `${clamp((sk.hr - 0.2) / 0.8, 0, 1) * 100}%`;
      if (range) {
        const k = Math.min(sk.visitShots.length, SHOTS - 1);
        m.caps.forEach((b, i) => { b.className = i < sk.visitShots.length ? (sk.visitShots[i] ? 'hit' : 'miss') : ''; });
        m.sight.style.left = `${10 + k * 20 + sk.aim.x * 7}%`;
        m.sight.style.top = `${50 + sk.aim.y * 36}%`;
      }
    }
  }

  applyCamera(dt) {
    const R = this.ctx.R, c = this.cam;
    // follow the human skiers (all of them if several), or the leader when only computers race
    const humans = this.skiers.filter((s) => s.c.human && !(s.finished && s.v < 1 && this.phase !== 'done'));
    let focus = humans.length ? humans : [];
    if (!focus.length) { const lead = [...this.skiers].sort((a, b) => b.dist - a.dist)[0]; focus = lead ? [lead] : []; }
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const s of focus) { const p = s.holder.position; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    if (!isFinite(x0)) { x0 = -60; x1 = 60; z0 = -40; z1 = 40; }
    // keep the caps in view for anyone shooting
    if (focus.some((s) => s.state === 'shoot')) z0 = Math.min(z0, TARGET_Z);
    const span = Math.max(x1 - x0, (z1 - z0) * 1.9);
    const want = { x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2 + 4, yaw: 0, pitch: 0.82, width: clamp(span + 100, 110, 360) };
    if (this.phase === 'pre' || this.phase === 'attract') Object.assign(want, { x: 0, z: 0, width: 360, pitch: 0.95 });
    const rate = 2.5;
    for (const k of Object.keys(want)) c[k] = dt >= 1 ? want[k] : damp(c[k], want[k], rate, Math.min(dt, 0.1));
    R.orbit(c.x, c.y, c.z, { yaw: c.yaw, pitch: c.pitch, width: c.width, shadowSpan: Math.max(220, c.width * 1.6) });
    R.setFocus(0.5, 0.42, 0.6);
  }

  dispose() {
    for (const s of this.skiers) s.fig.dispose();
  }
}

export default {
  id: 'biathlon', name: 'Biathlon', season: 'Winter',
  blurb: 'Three laps round the coffee table, over a sofa cushion and through a felt forest, with two shootings.',
  venue: 'A cotton-wool loop round the coffee table, up and over a sofa cushion, felt fir trees and a shoebox shooting range.',
  loading: 'Laying out the cotton wool…',
  how: [
    { verb: 'Rhythm', text: 'Skate with <b>left</b>, <b>right</b> in turn: an easy beat on the flat, a faster, harder one up the cushion (your heart rate climbs too).' },
    { verb: 'Power', text: 'Downhill, <b>hold action</b> to tuck: faster, and your heart calms down. Let go before the curve at the bottom, or into the cotton wool you go.' },
    { verb: 'Timing', text: 'After laps 1 and 2 you turn off to the range: <b>left/right</b> bring the drifting sight onto each cap, <b>action</b> shoots. It sways more when your heart is racing. Each miss is a penalty loop. After lap 3, straight on to the finish.' },
  ],
  better: 'lower',
  resultsDelay: 0.9,
  create: (ctx) => new Biathlon(ctx),
};
