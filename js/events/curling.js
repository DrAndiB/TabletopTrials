// Curling: bottle caps slid down the polished kitchen table at a paper target.
// Aim with LEFT/RIGHT: aimed straight, the cap slides straight; aimed to one side, it spins and curls
// back towards the middle (round a cap in the way). A dotted line shows the path. Hold ACTION
// for strength and let go, then tap LEFT/RIGHT in turn to sweep with a toothbrush: sweeping carries the
// cap further and straighter. Every cap in the target scores at the end of an end: 3 in the middle,
// 2 in the red ring, 1 in the blue ring. Knock the others out!
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, blendPose, REST } from '../figurine.js';
import { crowd, banner } from '../props.js';
import { flagCanvas } from '../flags.js';
import { Rhythm, BotTapper } from '../verbs.js';
import { Particles } from '../fx.js';
import { fitRhythm, winFor, helped } from '../sizes.js';
import { paneWindow, sunriseSky, eggCrowd } from '../venues.js';
import { hudKit, Skipper } from './common.js';
import { clamp, damp, rng, makeNoise2D } from '../util.js';

const R = 1.6;                 // a bottle cap
const HOG = 45, TEE = 140, BACK = 154, SIDE = 15;
const RINGS = [[2.6, 3], [6.6, 2], [11, 1]];
const REL_X = 8;               // where the cap leaves the hand
const DECEL = 6.2, SWEEP = 0.16, V_MIN = 21, V_MAX = 52, CURL = 2.15, AIM_MAX = 10, CURL_FULL = 2.1;
const SWEEP_TARGET = 6;        // taps per second for full sweeping
const ORD = ['1st', '2nd', '3rd', '4th'];
// computer curlers: how far off their aim and strength are, and how well they judge the sweep
const BOT = {
  easy: { aim: 1.6, power: 0.06, think: 1.6 },
  normal: { aim: 0.9, power: 0.035, think: 1.2 },
  hard: { aim: 0.45, power: 0.018, think: 0.9 },
};
const deg = (a) => (a * Math.PI) / 180;
// straight aim, straight slide; the further to one side, the more the cap spins and curls back
const curlFor = (aim) => -(aim / AIM_MAX) * CURL_FULL;

// one step of a sliding cap: friction, the curl (stronger as it slows) and the sweeping
function slide(s, dt, sweep) {
  const v = Math.hypot(s.vx, s.vz);
  if (v < 0.25) { s.vx = 0; s.vz = 0; return false; }
  const ux = s.vx / v, uz = s.vz / v;
  const a = DECEL * (1 - SWEEP * sweep);
  const nv = Math.max(0, v - a * dt);
  s.vx = ux * nv; s.vz = uz * nv;
  if (s.curl) {
    // sideways push, perpendicular to the path
    const al = s.curl * CURL * (1 - 0.5 * sweep) / (1 + nv / 10.3);
    s.vx -= uz * al * dt;
    s.vz += ux * al * dt;
  }
  s.x += s.vx * dt; s.z += s.vz * dt;
  return true;
}
// where a lone cap thrown with this aim (degrees) and strength (0..1) comes to rest, sweeping at e
export function restingPoint(aim, power, e = 0) {
  const a = deg(aim), v0 = V_MIN + power * (V_MAX - V_MIN);
  const s = { x: REL_X, z: 0, vx: v0 * Math.cos(a), vz: v0 * Math.sin(a), curl: curlFor(aim) };
  for (let k = 0; k < 3000 && slide(s, 1 / 60, e); k++);
  return s;
}
// the path of a lone cap, as points every `gap` units, ending where it stops
export function pathFor(aim, power, gap = 3) {
  const a = deg(aim), v0 = V_MIN + power * (V_MAX - V_MIN);
  const s = { x: REL_X, z: 0, vx: v0 * Math.cos(a), vz: v0 * Math.sin(a), curl: curlFor(aim) };
  const pts = [];
  let acc = 0, px = s.x, pz = s.z;
  for (let k = 0; k < 3000 && slide(s, 1 / 60, 0); k++) {
    acc += Math.hypot(s.x - px, s.z - pz); px = s.x; pz = s.z;
    if (acc >= gap) { acc = 0; if (s.x > REL_X + 4) pts.push([s.x, s.z]); }
  }
  return { pts, stop: s };
}

class Curling {
  constructor(ctx) {
    this.ctx = ctx;
    this.r = ctx.rand;
    this.phase = 'pre';
    this.t = 0;
    this.cam = { x: 60, y: 0, z: 0, yaw: -Math.PI / 2, pitch: 0.5, width: 90 };
    this.players = [];
    this.stones = [];
    this.end = 0;
  }

  // ---------------------------------------------------------------- venue
  async build() {
    const { kit: K, R: RR, competitors } = this.ctx;
    // breakfast on a winter morning: the sun just up, low and golden through the kitchen window
    RR.setLighting({
      sunDir: [0.3, 0.62, -0.72], sunColor: 0xffd2a0, sunIntensity: 2.3,
      hemiSky: 0xe2e8f6, hemiGround: 0x6a4a33, hemiIntensity: 0.62,
      envIntensity: 0.55, exposure: 0.98, background: 0x2a2421, shadowRadius: 4,
    });
    this.noise = makeNoise2D(53);
    this.buildKitchen(K);
    this.buildSheet(K);
    this.buildCrowd(K, competitors);
    this.particles = new Particles(K.group, 400);
    this.particles.setScale(RR.renderer.domElement.height * 0.9);
    const n = competitors.length;
    this.ends = n <= 2 ? 4 : 2;
    this.stonesPer = 2;
    const capGeo = this.capGeometry(K);
    const toothbrush = this.toothbrushGeometry(K);
    competitors.forEach((c, i) => {
      const fig = new Figurine({ paint: c.paint, seed: c.seed, number: c.number });
      fig.setGear('none');
      fig.root.rotation.y = Math.PI / 2;
      K.group.add(fig.root);
      const brush = new THREE.Mesh(toothbrush, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.5 }));
      brush.castShadow = true;
      K.group.add(brush);
      // the team's caps: painted in the shirt colour, the flag on top
      const top = new THREE.MeshStandardMaterial({ map: K.TX.toTexture(flagCanvas(c.code, 128), { wrap: false }), roughness: 0.5 });
      const body = new THREE.MeshPhysicalMaterial({ color: c.paint.shirt, roughness: 0.3, metalness: 0.5, clearcoat: 0.6 });
      this.players.push({ c, fig, brush, i, mats: [body, top], total: 0, endPts: [], home: { x: -6 - i * 7, z: -26 - (i % 2) * 4 }, idle: this.r() * 10, bot: c.human ? null : { tap: new BotTapper(c.pad, rng(c.seed * 7 + 3)) } });
    });
    this.capGeo = capGeo;
    this.placeWaiting();
    this.buildHud();
    this.applyCamera(1);
  }

  capGeometry() {
    // a crown cap: a fluted skirt and a flat top (group 0 = body, group 1 = top disc)
    const side = new THREE.CylinderGeometry(R * 0.93, R, 0.62, 42, 2, true);
    const p = side.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
      const a = Math.atan2(z, x), k = 1 + 0.055 * Math.cos(a * 21) * (y < 0 ? 1 : 0.4);
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    side.translate(0, 0.31, 0);
    const disc = new THREE.CircleGeometry(R * 0.93, 32).rotateX(-Math.PI / 2).translate(0, 0.62, 0);
    // flag UVs: the disc shows the middle of the flag
    const uv = disc.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + (uv.getX(i) - 0.5) * 0.9, 0.5 + (uv.getY(i) - 0.5) * 0.9);
    const g = new THREE.BufferGeometry();
    const merged = [side.toNonIndexed(), disc.toNonIndexed()];
    const pos = [], nor = [], uvs = [];
    for (const m of merged) { pos.push(...m.attributes.position.array); nor.push(...m.attributes.normal.array); uvs.push(...m.attributes.uv.array); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const n0 = merged[0].attributes.position.count;
    g.addGroup(0, n0, 0); g.addGroup(n0, merged[1].attributes.position.count, 1);
    return g;
  }

  toothbrushGeometry(K) {
    // along +y: handle, neck, head with bristles at the end
    return K.merge([
      { geo: new K.RoundedBoxGeometry(0.42, 5.2, 0.32, 2, 0.12), color: 0x5bc0de, pos: [0, 2.6, 0] },
      { geo: new K.RoundedBoxGeometry(0.42, 1.1, 0.3, 2, 0.1), color: 0x5bc0de, pos: [0, 5.6, 0] },
      { geo: new THREE.BoxGeometry(0.5, 1.0, 0.45), color: 0xffffff, pos: [0, 5.9, 0.35] },
    ]);
  }

  buildKitchen(K) {
    const g = K.group;
    // the kitchen floor far below the table, a wall of cupboards behind
    const fc = K.TX.makeCanvas(256), f = fc.getContext('2d');
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { f.fillStyle = (x + y) % 2 ? '#e9e4da' : '#b8c7c2'; f.fillRect(x * 32, y * 32, 32, 32); }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(fc, { repeat: [14, 9] }), roughness: 0.6 }));
    floor.position.set(80, -76, 0); floor.receiveShadow = true; g.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(900, 300), K.std({ color: 0xf1e6cf, roughness: 0.95 }));
    wall.position.set(80, 40, -150); g.add(wall);
    const cup = K.std({ color: 0x9cc7a3, roughness: 0.5 });
    // the window over the sink, between the cupboards
    this.win = paneWindow(g, { x: 66, y: 76, z: -149.6, w: 112, h: 72, sky: sunriseSky(3), depth: 3 });
    for (let k = 0; k < 7; k++) {
      if (k >= 2 && k <= 4) continue;
      const m = new THREE.Mesh(new K.RoundedBoxGeometry(58, 70, 4, 2, 1), cup);
      m.position.set(-120 + k * 62, 70, -146); m.castShadow = true; g.add(m);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), K.metal(0xd9c08a, 0.3));
      knob.position.set(-120 + k * 62 + 22, 45, -143); g.add(knob);
    }
    const counter = new THREE.Mesh(new THREE.BoxGeometry(900, 4, 60), K.std({ color: 0xe8e2d6, roughness: 0.4 }));
    counter.position.set(80, 14, -120); counter.receiveShadow = true; g.add(counter);
    const base = new THREE.Mesh(new THREE.BoxGeometry(900, 88, 58), cup);
    base.position.set(80, -30, -120); g.add(base);
    // the table: polished wood, glossy, legs down to the floor
    const T = K.TX.woodTextures({ size: 1024, planks: 3, base: 0xb07a4f, dark: 0x6e4a2f, light: 0xd7a878, seed: 77, ringFreq: 10, roughBase: 0.32, lacquer: 0.85, grainContrast: 0.9 });
    const top = new THREE.Mesh(new K.RoundedBoxGeometry(270, 4, 112, 3, 1.5), new THREE.MeshPhysicalMaterial({ ...T, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.4 }));
    top.position.set(90, -2, 0); top.receiveShadow = true; top.castShadow = true; g.add(top);
    for (const x of [-38, 218]) for (const z of [-48, 48]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(6, 72, 6), K.std({ color: 0x8a5a36, roughness: 0.4 })); leg.position.set(x, -40, z); g.add(leg); }
    // things on the table: a fruit bowl, mugs, salt and pepper
    const bowl = new THREE.Mesh(K.lathe([[0.01, 0], [8, 0.4], [14, 6], [15, 9], [14.4, 9.2], [13, 6.4], [7.5, 1.2], [0.01, 1]], 32), K.std({ color: 0xf4efe6, roughness: 0.3 }));
    bowl.position.set(210, 0, -40); bowl.castShadow = true; g.add(bowl);
    const fruit = [[0xe23b2e, 4.2, -3, 0], [0xf2c230, 4, 3, 2], [0x7bbf3a, 3.8, 0, -4], [0xef7d2c, 4.1, 5, -3]];
    for (const [c, r, dx, dz] of fruit) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), K.std({ color: c, roughness: 0.45 })); m.position.set(210 + dx, 6.5, -40 + dz); m.castShadow = true; g.add(m); }
    const mug = (x, z, col) => { const m = new THREE.Mesh(K.lathe([[0.01, 0], [4, 0], [4.2, 9], [3.7, 9], [3.6, 0.6], [0.01, 0.6]], 24), K.std({ color: col, roughness: 0.35 })); m.position.set(x, 0, z); m.castShadow = true; g.add(m); const h = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.55, 8, 16, Math.PI), K.std({ color: col, roughness: 0.35 })); h.rotation.z = -Math.PI / 2; h.position.set(x + 4, 4.5, z); g.add(h); };
    mug(-20, 40, 0xe23b2e); mug(-8, 46, 0x2f6fe0);
    // breakfast: a teapot in a knitted cosy, a toast rack, jam, the cereal box and the milk
    const cc = K.TX.makeCanvas(64, 64), c2 = cc.getContext('2d');
    for (let y = 0; y < 64; y += 8) { c2.fillStyle = ['#d9472b', '#f7f2e8', '#2fae5a', '#f7f2e8'][(y / 8) % 4]; c2.fillRect(0, y, 64, 8); }
    const cosy = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.15, 1), K.felt(0xffffff, { map: K.TX.toTexture(cc, { repeat: [1, 1] }) }));
    cosy.position.set(238, 0, 34); cosy.castShadow = true; g.add(cosy);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 10), K.felt(0xf2c230)); pom.position.set(238, 12.3, 34); pom.castShadow = true; g.add(pom);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 9, 10), K.std({ color: 0xf4efe6, roughness: 0.3 })); spout.position.set(230, 5, 34); spout.rotation.z = 0.9; g.add(spout);
    const toast = [];
    for (let k = 0; k < 4; k++) toast.push({ x: 26 + k * 3.4, y: 6, z: 46, sx: 1, sy: 1, sz: 1, rz: (k % 2 ? 0.06 : -0.06) });
    K.instances(new K.RoundedBoxGeometry(1.4, 11, 10, 2, 0.6), K.std({ color: 0xd9a066, roughness: 0.9 }), toast);
    const rack = new THREE.Mesh(new THREE.TorusGeometry(7, 0.3, 4, 16, Math.PI), K.metal(0xd0d4da, 0.3)); rack.position.set(31, 0, 46); g.add(rack);
    const jam = new THREE.Mesh(K.lathe([[0.01, 0], [3.4, 0], [3.6, 6.5], [3, 7.4], [0.01, 7.4]], 20), K.glass(0xc0262b, 0.75)); jam.position.set(52, 0, 44); jam.castShadow = true; g.add(jam);
    const jl = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.4, 20), K.std({ color: 0xf7f2e8, roughness: 0.9 })); jl.position.set(52, 8, 44); g.add(jl);
    const bc = K.TX.makeCanvas(128, 192), b2 = bc.getContext('2d');
    b2.fillStyle = '#f2c230'; b2.fillRect(0, 0, 128, 192); b2.fillStyle = '#d9472b'; b2.fillRect(0, 0, 128, 44);
    b2.fillStyle = '#fff'; b2.font = '34px "Lilita One", Impact, sans-serif'; b2.textAlign = 'center'; b2.fillText('CRUNCH', 64, 34);
    b2.fillStyle = '#c98a4b'; for (let k = 0; k < 12; k++) { b2.beginPath(); b2.arc(30 + (k % 4) * 22, 90 + Math.floor(k / 4) * 26, 9, 0, Math.PI * 2); b2.fill(); }
    const box = new THREE.Mesh(new THREE.BoxGeometry(14, 22, 5), [0, 1, 2, 3, 4, 5].map((k) => k === 4 ? K.std({ map: K.TX.toTexture(bc, { wrap: false }), roughness: 0.7 }) : K.std({ color: 0xf2c230, roughness: 0.7 })));
    box.position.set(-24, 11, -44); box.rotation.y = 0.25; box.castShadow = true; g.add(box);
    const milk = new THREE.Mesh(K.lathe([[0.01, 0], [3.4, 0], [3.6, 10], [2, 13], [1.8, 15], [0.01, 15]], 20), K.std({ color: 0xf7f7f2, roughness: 0.3 })); milk.position.set(-6, 0, -42); milk.castShadow = true; g.add(milk);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 1, 14), K.std({ color: 0x2f6fe0 })); cap.position.set(-6, 15.4, -42); g.add(cap);
    for (const [x, col] of [[180, 0xffffff], [186, 0x3a3634]]) { const m = new THREE.Mesh(K.lathe([[0.01, 0], [1.8, 0], [2, 4], [1.4, 6.5], [0.01, 6.8]], 16), K.std({ color: col, roughness: 0.4 })); m.position.set(x, 0, 42); m.castShadow = true; g.add(m); }
  }

  buildSheet(K) {
    const g = K.group;
    const Y = 0.02;
    const tape = (w, d, x, z, col) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 })); m.position.set(x, Y, z); m.receiveShadow = true; g.add(m); };
    // sidelines, hog line, back line, centre line in washi tape
    tape(BACK + 6, 1.1, (BACK + 6) / 2 - 3, -SIDE, 0x8fc1e3); tape(BACK + 6, 1.1, (BACK + 6) / 2 - 3, SIDE, 0x8fc1e3);
    tape(1.2, SIDE * 2, HOG, 0, 0xe23b2e); tape(1.1, SIDE * 2, BACK, 0, 0x2f4f7a);
    tape(BACK - HOG, 0.5, (BACK + HOG) / 2, 0, 0xe8e2d6);
    // the target: rings painted on a sheet of paper, taped down
    const cc = K.TX.makeCanvas(512), c = cc.getContext('2d');
    c.fillStyle = '#fbf8f1'; c.fillRect(0, 0, 512, 512);
    const ring = (r, col) => { c.fillStyle = col; c.beginPath(); c.arc(256, 256, r, 0, Math.PI * 2); c.fill(); };
    const s = 256 / 12.5;
    ring(11 * s, '#3d7bd9'); ring(9 * s, '#fbf8f1'); ring(6.6 * s, '#e23b2e'); ring(4.4 * s, '#fbf8f1'); ring(2.6 * s, '#f2c230');
    c.strokeStyle = 'rgba(31,26,23,0.35)'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 256); c.lineTo(512, 256); c.moveTo(256, 0); c.lineTo(256, 512); c.stroke();
    c.fillStyle = '#1f1a17'; c.font = '28px "Lilita One", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('3', 256, 256); c.fillStyle = '#fbf8f1'; c.fillText('2', 256, 256 - 5.5 * s); c.fillText('1', 256, 256 - 10 * s);
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(25, 25).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(cc, { wrap: false }), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 }));
    paper.position.set(TEE, Y, 0); paper.receiveShadow = true; g.add(paper);
    // the hack: an eraser to push off from
    const hack = new THREE.Mesh(new K.RoundedBoxGeometry(2.4, 1.6, 5, 2, 0.4), K.paint(0xf08aa3, { roughness: 0.8 }));
    hack.position.set(1.5, 0.8, 0); hack.castShadow = true; g.add(hack);
    // the aim arrow, drawn on the table while aiming
    const ac = K.TX.makeCanvas(256, 64), a = ac.getContext('2d');
    a.fillStyle = 'rgba(255,255,255,0)'; a.fillRect(0, 0, 256, 64);
    a.fillStyle = 'rgba(255,201,60,0.9)';
    for (let k = 0; k < 7; k++) a.fillRect(k * 32, 26, 20, 12);
    a.beginPath(); a.moveTo(224, 8); a.lineTo(256, 32); a.lineTo(224, 56); a.fill();
    this.arrow = new THREE.Mesh(new THREE.PlaneGeometry(60, 5).rotateX(-Math.PI / 2).translate(30, 0, 0), new THREE.MeshBasicMaterial({ map: K.TX.toTexture(ac, { wrap: false }), transparent: true, depthWrite: false }));
    this.arrow.position.set(REL_X, 0.12, 0); g.add(this.arrow);
    this.arrow.visible = false;
    // the aim path: dots along where the cap will slide at the yellow strength, a ring where it stops
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x2b2420, transparent: true, opacity: 0.8, depthWrite: false });
    this.dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.62, 12).rotateX(-Math.PI / 2), dotMat, 70);
    this.dots.position.y = 0.1; this.dots.count = 0; this.dots.frustumCulled = false; g.add(this.dots);
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.4, 32).rotateX(-Math.PI / 2), dotMat);
    const inner = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    this.aimRing.add(inner);
    this.aimRing.position.y = 0.1; this.aimRing.visible = false; g.add(this.aimRing);
    this.pathKey = null;
    // where the sliding cap will stop: a ring that moves on while you sweep
    this.stopRing = new THREE.Mesh(new THREE.RingGeometry(1.3, 2.1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
    this.stopDot = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16).rotateX(-Math.PI / 2), this.stopRing.material);
    this.stopRing.add(this.stopDot);
    this.stopRing.visible = false;
    this.stopRing.position.y = 0.08;
    g.add(this.stopRing);
  }

  buildCrowd(K, competitors) {
    const spots = [];
    // facing the sheet, turned a little towards the target
    for (let k = 0; k < 5; k++) spots.push({ x: 166 + k * 9, y: 0, z: -34 + (k % 2) * 3, ry: -0.4, size: 9 + this.r() * 2 });
    for (let k = 0; k < 4; k++) spots.push({ x: 60 + k * 26, y: 0, z: -40 - (k % 2) * 4, ry: -0.15, size: 10 });
    for (let k = 0; k < 3; k++) spots.push({ x: 170 + k * 11, y: 0, z: 34 + (k % 2) * 3, ry: Math.PI + 0.4, size: 9 });
    // the crowd: boiled eggs in egg cups, some in knitted cosies
    this.crowd = eggCrowd(K.group, spots, 47);
    [[100, -48], [40, -50], [225, 10]].forEach(([x, z], k) => {
      const b = banner(competitors[k % competitors.length].code, 12, { seed: 70 + k });
      b.position.set(x, 0, z); b.rotation.y = k === 2 ? -Math.PI / 2 : 0;
      K.group.add(b);
    });
  }

  buildHud() {
    const el = this.ctx.hud.el;
    // watching a computer curler: action fast-forwards
    this.skipper = new Skipper(this.ctx, hudKit(this.ctx));
    const style = document.createElement('style');
    style.textContent = `.cu-card{position:absolute;left:12px;top:12px;width:min(260px,42vw);background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17;padding:8px 10px;font:700 12px/1.25 Rubik,sans-serif;color:#1f1a17}
      .cu-card .who{display:flex;align-items:center;gap:7px;font:400 18px/1.1 "Lilita One",Impact,sans-serif}.cu-card .who img{height:20px;width:30px;object-fit:cover;border:2px solid #1f1a17;border-radius:3px}
      .cu-card .rd{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#4a413a;font-weight:800;margin-top:2px}
      .cu-card ol{list-style:none;margin:6px 0 0;padding:6px 0 0;border-top:2px dashed rgba(31,26,23,.25);display:grid;gap:2px}
      .cu-card li{display:grid;grid-template-columns:28px 22px 1fr auto;gap:5px;align-items:center;font-variant-numeric:tabular-nums}.cu-card li img{height:13px;width:20px;object-fit:cover;border-radius:2px}
      .cu-card li.me{background:#ffc93c;border-radius:6px}
      .cu-g{position:absolute;left:50%;bottom:calc(18px + var(--tb,0px));transform:translateX(-50%);width:min(400px,84vw);background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17;padding:6px 12px 8px;font:800 12px/1.2 Rubik,sans-serif;color:#1f1a17;text-align:center}
      .cu-g .row{display:grid;grid-template-columns:62px 1fr;gap:8px;align-items:center;margin-top:5px;text-align:left;color:#4a413a}
      .cu-g .bar{position:relative;height:12px;border:2px solid #1f1a17;border-radius:99px;background:#fff;overflow:hidden}
      .cu-g .bar i{position:absolute;inset:0 auto 0 0;width:0;background:#ef7d2c}.cu-g .bar.go i{background:#2fae5a}.cu-g .bar b{position:absolute;top:-3px;bottom:-3px;width:5px;margin-left:-2.5px;background:#f2c230;border:1.5px solid #1f1a17;border-radius:2px}
      .cu-pts{position:absolute;transform:translate(-50%,-100%);font:400 22px "Lilita One",Impact,sans-serif;color:#fff;-webkit-text-stroke:2px #1f1a17;paint-order:stroke fill;pointer-events:none}
      .cu-hidden{display:none}`;
    el.appendChild(style);
    const mk = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; el.appendChild(d); return d; };
    this.hudCard = mk('cu-card', '<div class="who"></div><div class="rd"></div><ol></ol>');
    this.hudG = mk('cu-g cu-hidden', '<div class="tip"></div><div class="row pw"><span>Strength</span><div class="bar"><i></i><b title="reaches the middle"></b></div></div><div class="row sw"><span>Sweeping</span><div class="bar"><i></i></div></div>');
    this.ptsEl = mk('cu-layer', '');
    if (this.ctx.competitors.some((c) => c.type === 'touch')) this.hudG.style.setProperty('--tb', '110px');
  }

  // ---------------------------------------------------------------- flow
  attract() {}

  start() {
    this.ctx.sound.setLoop('crowd', 0.25);
    this.end = 0;
    this.startEnd();
  }

  startEnd() {
    this.end++;
    for (const s of this.stones) s.mesh.removeFromParent();
    this.stones = [];
    // throwing order: everyone in turn, twice; the first thrower moves on each end (the last cap is an advantage)
    const n = this.players.length, first = (this.end - 1) % n;
    this.queue = [];
    for (let k = 0; k < this.stonesPer; k++) for (let j = 0; j < n; j++) this.queue.push((first + j) % n);
    this.throwNo = -1;
    if (this.end > 1) this.ctx.hud.message(this.end === this.ends ? 'Last end!' : `End ${this.end}`, 'small', '#ffc93c', 1.4);
    this.nextThrow();
  }

  nextThrow() {
    this.throwNo++;
    if (this.throwNo >= this.queue.length) { this.scoreEnd(); return; }
    const p = this.cur = this.players[this.queue[this.throwNo]];
    this.aim = 0; this.power = 0; this.powerDir = 1; this.holding = false; this.pathKey = null;
    this.sweep = { rhythm: fitRhythm(new Rhythm({ target: SWEEP_TARGET }), p.c), effort: 0, anim: 0 };
    this.thrown = null;
    this.held = new THREE.Mesh(this.capGeo, p.mats);
    this.held.castShadow = true;
    this.ctx.kit.group.add(this.held);
    this.phase = 'aim'; this.t = 0;
    this.placeWaiting();
    p.fig.setExpression('focus');
    if (p.bot) this.planBot(p);
    this.ctx.competitors.forEach((c, i) => this.ctx.hud.chip(i, `${this.players[i].total} pts`, i === p.i ? 'active' : ''));
    if (p.c.human) this.ctx.hud.message(`${p.c.short}: your cap!`, 'small', '#fff', 1.5);
    else if (this.throwNo > 0) this.ctx.hud.message('');
    this.updateCard();
  }

  // the strength that brings a lone cap to rest at x (with the current aim, no sweeping)
  powerFor(x) {
    let lo = 0, hi = 1;
    for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (restingPoint(this.aim, m, 0).x < x) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  // the dotted aim path at the strength that reaches the middle (recomputed when the aim moves)
  updatePath() {
    const key = Math.round(this.aim * 10);
    if (key === this.pathKey) return;
    this.pathKey = key;
    this.midPower = this.powerFor(TEE);
    const { pts, stop } = pathFor(this.aim, this.midPower);
    const m = new THREE.Matrix4();
    const n = Math.min(pts.length, this.dots.instanceMatrix.count);
    for (let k = 0; k < n; k++) { m.makeTranslation(pts[k][0], 0, pts[k][1]); this.dots.setMatrixAt(k, m); }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    this.aimRing.position.x = stop.x; this.aimRing.position.z = stop.z;
  }

  // where the sliding cap will stop if the sweeping carries on like this (collisions aside)
  predictStop() {
    const s = this.thrown;
    if (!s || !s.live) return null;
    const q = { x: s.x, z: s.z, vx: s.vx, vz: s.vz, curl: s.curl };
    const e = this.sweep.effort;
    for (let k = 0; k < 600 && slide(q, 1 / 30, e); k++);
    return q;
  }

  // ---------------------------------------------------------------- computer curlers
  planBot(p) {
    const B = BOT[this.ctx.skillName] || BOT.normal;
    // pick a target: the middle, or knock out the best cap of a rival if there's one near the middle
    let tx = TEE, tz = 0;
    const rival = this.stones.filter((s) => s.owner !== p && Math.hypot(s.x - TEE, s.z) < 7).sort((a, b) => Math.hypot(a.x - TEE, a.z) - Math.hypot(b.x - TEE, b.z))[0];
    let hit = false;
    if (rival && this.r() < 0.6) { tx = rival.x + 6; tz = rival.z; hit = true; }
    // search aim and strength on the no-collision model; like real curlers they like a curling shot
    // (each bot has a favourite side), and a path blocked by a cap in front of the target is no good
    if (p.bot.side == null) p.bot.side = this.r() < 0.5 ? -1 : 1;
    const blockers = this.stones.filter((s) => s.live && s.x < tx - 3);
    let best = null;
    for (let aim = -AIM_MAX; aim <= AIM_MAX; aim += 0.5) {
      const straight = Math.abs(aim) < 2.5, wrongSide = Math.sign(aim) !== p.bot.side;
      for (let pw = 0.3; pw <= 1; pw += 0.02) {
        const s = restingPoint(aim, pw, 0);
        let d = Math.hypot(s.x - tx, s.z - tz) + (straight ? 2.2 : 0) + (wrongSide && !straight ? 0.8 : 0);
        if (d > (best ? best.d : 1e9)) continue;
        if (blockers.length && !hit) {
          const { pts } = pathFor(aim, pw, 4);
          if (pts.some(([px, pz]) => px < tx - 4 && blockers.some((b) => Math.hypot(b.x - px, b.z - pz) < 2 * R + 0.5))) d += 6;
        }
        if (!best || d < best.d) best = { aim, pw, d };
      }
    }
    p.bot.aim = clamp(best.aim + this.r.gauss() * B.aim, -AIM_MAX, AIM_MAX);
    p.bot.power = clamp(best.pw + (hit ? 0.06 : 0) + this.r.gauss() * B.power, 0.05, 1);
    p.bot.thinkT = B.think * (0.8 + this.r() * 0.4);
    p.bot.held = false; p.bot.sweeping = false;
  }

  botUpdate(p, now) {
    const b = p.bot, pad = p.c.pad;
    if (this.phase === 'aim') {
      const d = b.aim - this.aim;
      pad.push('left', d < -0.3, now); pad.push('right', d > 0.3, now);
      if (this.t > b.thinkT && Math.abs(d) <= 0.3) { pad.push('left', false, now); pad.push('right', false, now); pad.push('action', true, now); b.held = true; }
    } else if (this.phase === 'power') {
      if (this.power >= b.power - 0.005 && this.powerDir > 0) pad.push('action', false, now);
    } else if (this.phase === 'slide' && this.thrown) {
      // sweep if the cap looks like stopping short of where it was meant to go
      const s = this.thrown;
      const v = Math.hypot(s.vx, s.vz);
      const stop = s.x + (v * v) / (2 * DECEL);
      const want = stop < TEE - 2 && s.x < TEE;
      if (want && !b.sweeping) { b.sweeping = true; b.tap.start(now); }
      if (!want && b.sweeping) { b.sweeping = false; b.tap.stop(); }
      if (b.sweeping) b.tap.update(now, SWEEP_TARGET * 1.02, 0.08, 0);
    }
  }

  // ---------------------------------------------------------------- per step
  update(dt) {
    const ctx = this.ctx, now = ctx.time();
    this.t += dt;
    if (this.phase === 'pre') { for (let i = 0; i < this.players.length; i++) ctx.presses(i); return; }
    if (this.phase === 'done') {
      for (let i = 0; i < this.players.length; i++) ctx.presses(i);
      if (this.t > 1.6 && this.results) { const r = this.results; this.results = null; ctx.finish(r); }
      return;
    }
    const p = this.cur;
    if (p && p.bot) this.botUpdate(p, now);
    let q = [], skip = false;
    for (let i = 0; i < this.players.length; i++) {
      const e = ctx.presses(i);
      if (p && i === p.i) q = e;
      if (this.players[i].c.human && e.some((x) => x.b === 'action' && x.down)) skip = true;
    }
    this.skipper.update(!!(p && p.bot), skip);
    // Little curlers: the aim is straight at the middle, any button holds the strength, and the
    // sweeping happens by itself
    const little = !!p && p.c.human && helped(p.c);
    if (this.phase === 'aim') {
      const held = ctx.held(p.i);
      if (!little) this.aim = clamp(this.aim + ((held.right ? 1 : 0) - (held.left ? 1 : 0)) * 7 * dt, -AIM_MAX, AIM_MAX);
      if (q.some((e) => (e.b === 'action' || little) && e.down)) { this.phase = 'power'; this.t = 0; this.power = 0; this.powerDir = 1; ctx.sound.pop(); this.updatePath(); }
      if (this.t > 15) { this.phase = 'power'; this.t = 0; }
    } else if (this.phase === 'power') {
      // the strength meter swings up and down while ACTION is held
      // the meter swings more slowly for smaller players
      const slow = winFor(p.c, 1), held = ctx.held(p.i);
      this.power += this.powerDir * dt / (1.3 * slow);
      if (this.power >= 1) { this.power = 1; this.powerDir = -1; } else if (this.power <= 0) { this.power = 0; this.powerDir = 1; }
      const letGo = little ? !(held.action || held.left || held.right) : q.some((e) => e.b === 'action' && !e.down);
      if (letGo || this.t > 6 * slow) this.release();
    } else if (this.phase === 'slide') {
      if (little) {
        const s = this.thrown, v = s ? Math.hypot(s.vx, s.vz) : 0;
        this.sweep.effort = s && s.x < TEE && s.x + (v * v) / (2 * DECEL) < TEE - 2 ? 1 : 0;
        if (this.sweep.effort) this.sweep.beat = 0.1;
      } else {
        for (const e of q) if (e.down && e.b !== 'action') { this.sweep.rhythm.press(e.b, e.t); this.sweep.beat = 0.1; }
        this.sweep.effort = this.thrown && this.thrown.x < BACK ? clamp(this.sweep.rhythm.effort(now), 0, 1) : 0;
      }
      this.physics(dt);
      if (this.stones.every((s) => s.vx === 0 && s.vz === 0)) { this.phase = 'settle'; this.t = 0; p.bot?.tap.stop(); }
    } else if (this.phase === 'settle') {
      if (this.t > 0.9) this.nextThrow();
    } else if (this.phase === 'scored') {
      if (skip && this.t > 0.8) this.t = Math.max(this.t, 3.4);
      if (this.t > 3.8) { this.clearPoints(); if (this.end >= this.ends) this.finishAll(); else this.startEnd(); }
    }
  }

  release() {
    const p = this.cur, ctx = this.ctx;
    const a = deg(this.aim), v0 = V_MIN + this.power * (V_MAX - V_MIN);
    const mesh = this.held;
    this.held = null;
    const s = { x: REL_X, z: 0, vx: v0 * Math.cos(a), vz: v0 * Math.sin(a), curl: curlFor(this.aim), owner: p, mesh, spin: 0, live: true };
    this.stones.push(s);
    this.thrown = s;
    this.phase = 'slide'; this.t = 0;
    ctx.sound.whoosh(0.6);
    ctx.hud.message('');
    ctx.sound.setLoop('hiss', 0.4, 3000);
  }

  physics(dt) {
    const ctx = this.ctx;
    for (const s of this.stones) {
      if (!s.live) continue;
      const moving = slide(s, dt, s === this.thrown ? this.sweep.effort : 0);
      if (moving) s.spin += dt * 2.6 * s.curl;   // only a curling cap spins
    }
    // caps knock each other about (equal weights, a little bounce lost)
    const L = this.stones.filter((s) => s.live);
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d > 0 && d < 2 * R) {
        const nx = dx / d, nz = dz / d;
        const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        const push = (2 * R - d) / 2;
        a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
        if (rel > 0) {
          const imp = rel * (1 + 0.88) / 2;
          a.vx -= imp * nx; a.vz -= imp * nz; b.vx += imp * nx; b.vz += imp * nz;
          // a struck cap slides straight
          b.curl = 0; a.curl *= 0.5;
          ctx.sound.clack(0); this.particles.emit((a.x + b.x) / 2, 0.6, (a.z + b.z) / 2, { vx: 0, spread: 3, up: 2, color: 0xffffff, size: 0.5, life: 0.3, alpha: 0.6, grav: 4, n: 6 });
        }
      }
    }
    // off the sides or past the back line: out of play; a cap that stops short of the hog line too
    for (const s of L) {
      const out = Math.abs(s.z) > SIDE + R || s.x > BACK + R;
      const short = s.vx === 0 && s.vz === 0 && s.x < HOG;
      if (out || short) {
        s.live = false; s.vx = 0; s.vz = 0; s.gone = 0;
        if (s === this.thrown) ctx.hud.flash(short ? 'Short of the red line' : 'Out!', '#ff8a65');
      }
    }
    const v = this.thrown ? Math.hypot(this.thrown.vx, this.thrown.vz) : 0;
    ctx.sound.setLoop('hiss', clamp(v / 70, 0, 0.6), 2600 + v * 30);
  }

  scoreEnd() {
    const ctx = this.ctx;
    this.phase = 'scored'; this.t = 0;
    ctx.sound.setLoop('hiss', 0);
    const pts = new Map(this.players.map((p) => [p, 0]));
    this.labels = [];
    for (const s of this.stones) {
      if (!s.live) continue;
      const d = Math.hypot(s.x - TEE, s.z);
      const ring = RINGS.find(([r]) => d <= r + R * 0.5);
      if (ring) { pts.set(s.owner, pts.get(s.owner) + ring[1]); this.labels.push({ s, n: ring[1] }); }
    }
    for (const p of this.players) { const n = pts.get(p); p.endPts.push(n); p.total += n; }
    const best = [...pts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0) { ctx.hud.message(`${best[0].c.short} +${best[1]}`, 'small', '#ffc93c'); ctx.sound.cheer(0.8); ctx.sound.clap(8); } else { ctx.hud.message('Nobody scores', 'small', '#fff'); ctx.sound.aww(); }
    this.ptsEl.innerHTML = this.labels.map((l, k) => `<div class="cu-pts" data-k="${k}">+${l.n}</div>`).join('');
    this.ctx.competitors.forEach((c, i) => this.ctx.hud.chip(i, `${this.players[i].total} pts`, ''));
    this.cur = null;
    this.updateCard();
  }

  clearPoints() { this.ptsEl.innerHTML = ''; this.labels = []; }

  finishAll() {
    this.phase = 'done'; this.t = 0;
    this.cur = null;
    this.placeWaiting();
    const ranked = [...this.players].sort((a, b) => b.total - a.total);
    this.winner = ranked[0];
    this.ctx.hud.message(ranked[0].total > 0 ? `${ranked[0].c.short} wins!` : 'A draw at nil!', 'small', '#ffc93c');
    this.hudG.classList.add('cu-hidden');
    this.results = this.players.map((p) => ({ value: p.total, text: `${p.total} pts`, short: `${p.total} pts`, sub: `ends: ${p.endPts.join(' · ')}` }));
  }

  placeWaiting() {
    this.players.forEach((p) => {
      if (this.cur === p) return;
      p.fig.root.position.set(p.home.x, 0, p.home.z);
      p.fig.root.rotation.y = 0.3;
      p.fig.ground = true;
    });
  }

  updateCard() {
    const p = this.cur;
    const who = this.hudCard.querySelector('.who'), rd = this.hudCard.querySelector('.rd'), ol = this.hudCard.querySelector('ol');
    if (p) who.innerHTML = `<img src="${p.c.flag}" alt=""><span>${p.c.short}</span>`;
    rd.textContent = `End ${this.end} of ${this.ends}${p ? ` · cap ${Math.floor(this.throwNo / this.players.length) + 1} of ${this.stonesPer}` : ''}` + (p && p.bot && this.ctx.competitors.some((c) => c.human) ? ' · action: fast-forward' : '');
    const ranked = [...this.players].sort((a, b) => b.total - a.total);
    ol.innerHTML = ranked.map((x, k) => `<li class="${x === p ? 'me' : ''}"><span>${ORD[k]}</span><img src="${x.c.flag}" alt=""><span>${x.c.short}</span><b>${x.total}</b></li>`).join('');
  }

  // ---------------------------------------------------------------- per frame
  frame(dt, paused) {
    const ctx = this.ctx, tt = ctx.time();
    if (!paused) this.particles.update(dt);
    // the caps
    for (const s of this.stones) {
      if (!s.live && s.gone != null && !paused) s.gone = Math.min(1, s.gone + dt * 2);
      const drop = s.gone != null ? s.gone : 0;
      s.mesh.position.set(s.x, -drop * 2, s.z);
      s.mesh.rotation.set(drop * 1.2, s.spin, 0);
      s.mesh.visible = drop < 1;
    }
    // everyone waiting watches; the thrower crouches at the hack, then follows the cap with the toothbrush
    const p = this.cur;
    this.players.forEach((q) => {
      const w = tt + q.idle;
      if (q === p && (this.phase === 'aim' || this.phase === 'power' || this.phase === 'slide' || this.phase === 'settle')) return;
      q.fig.ground = true;
      q.fig.setPose(this.phase === 'done' && q === this.winner ? POSES.cheer(w) : this.phase === 'scored' && this.labels?.some((l) => l.s.owner === q) ? POSES.cheer(w) : (Math.floor(w / 3) % 3) === 1 ? POSES.wave(w) : POSES.stand(w));
      this.holdBrush(q, false);
    });
    if (p) this.poseCurler(p, tt, dt, paused);
    if (this.held) { const a = deg(this.aim); this.held.position.set(REL_X * Math.cos(a) - 2, 0, REL_X * Math.sin(a)); }
    // the aim path
    const aiming = !!p && (this.phase === 'aim' || this.phase === 'power');
    if (aiming) this.updatePath();
    this.dots.visible = this.aimRing.visible = aiming;
    if (aiming) { this.dots.material.opacity = 0.6 + 0.25 * Math.sin(tt * 5); this.aimRing.scale.setScalar(1 + 0.08 * Math.sin(tt * 6)); }
    // points over the scoring caps
    if (this.labels && this.labels.length) {
      const cam = ctx.R.camera, el = ctx.R.renderer.domElement, v = new THREE.Vector3();
      this.ptsEl.querySelectorAll('.cu-pts').forEach((d) => {
        const l = this.labels[+d.dataset.k];
        v.set(l.s.x, 3, l.s.z).project(cam);
        d.style.left = `${(v.x * 0.5 + 0.5) * el.clientWidth}px`; d.style.top = `${(-v.y * 0.5 + 0.5) * el.clientHeight}px`;
      });
    }
    const stop = this.phase === 'slide' ? this.predictStop() : null;
    this.stopRing.visible = !!stop;
    if (stop) {
      this.stopRing.position.x = stop.x; this.stopRing.position.z = stop.z;
      this.stopRing.material.color.set(this.thrown.owner.c.paint.shirt);
      this.stopRing.scale.setScalar(1 + 0.1 * Math.sin(tt * 8));
    }
    this.crowd.update(tt, this.phase === 'slide' ? 0.5 : this.phase === 'scored' ? 0.7 : 0.15);
    this.updateHud();
    this.applyCamera(dt);
  }

  holdBrush(q, sweeping, phase = 0) {
    q.fig.root.updateMatrixWorld(true);
    const h = q.fig.arms[1].el.localToWorld(new THREE.Vector3(0, -1.1, 0));
    q.brush.position.copy(h);
    if (sweeping) q.brush.rotation.set(0, Math.sin(phase * Math.PI * 2) * 0.5, -Math.PI / 2 - 0.9);
    else q.brush.rotation.set(0, 0, 0.15);
  }

  poseCurler(p, tt, dt, paused) {
    const fig = p.fig;
    fig.ground = true;
    if (this.phase === 'aim' || this.phase === 'power') {
      fig.root.position.set(1.5, 0, 0);
      fig.root.rotation.y = Math.PI / 2 - deg(this.aim);
      // the delivery crouch: one knee down, cap in hand
      const k = this.phase === 'power' ? 0.4 + this.power * 0.6 : 0.3;
      fig.setPose(blendPose(POSES.stand(tt), { ...REST, y: -1.6, lean: 0.75, hipL: 1.2, kneeL: 1.9, hipR: 0.1, kneeR: 1.6, spR: 0.1, shR: 0.6 + k * 0.5, elR: 0.3, shL: 0.2, abL: 0.5, head: -0.2 }, 1));
      this.holdBrush(p, false);
      return;
    }
    // sweeping: alongside the cap, facing its path, scrubbing the table just in front of it
    const s = this.thrown;
    const sx = s ? Math.min(s.x, BACK) : 10, sz = s ? s.z : 0;
    const tx = this.phase === 'slide' ? sx + 3 : sx - 4, tz = sz + 3.8;
    const cur = fig.root.position;
    const nx = damp(cur.x, tx, 6, dt), nz = damp(cur.z, tz, 6, dt);
    const sp = Math.hypot(nx - cur.x, nz - cur.z) / Math.max(dt, 1e-3);
    fig.root.position.set(nx, 0, nz);
    const sweeping = this.phase === 'slide' && this.sweep.effort > 0.15;
    fig.root.rotation.y = damp(fig.root.rotation.y, this.phase === 'slide' ? Math.PI : Math.PI / 2, 6, dt);
    if (!paused) this.sweep.anim = (this.sweep.anim + Math.max(sp / 10, 0.4) * dt) % 1;
    const ph = tt * SWEEP_TARGET * 0.5;
    const sw = Math.sin(ph * Math.PI * 2);
    // a sideways shuffle, bent over the brush, shoulders swinging with each stroke
    const shuffle = POSES.walk(this.sweep.anim);
    const pose = sweeping
      ? { ...shuffle, y: -0.5, lean: 0.75, twist: sw * 0.35, head: -0.2, hipL: shuffle.hipL * 0.5 + 0.35, hipR: shuffle.hipR * 0.5 + 0.35, kneeL: 0.6, kneeR: 0.6, shL: 1.1, shR: 1.0, elL: 0.5, elR: 0.3, abL: 0.15, abR: 0.1 }
      : blendPose(shuffle, POSES.stand(tt), clamp(1 - sp / 10, 0, 1));
    fig.setPose(pose);
    if (sweeping && s) {
      fig.root.updateMatrixWorld(true);
      const hand = fig.arms[1].el.localToWorld(new THREE.Vector3(0, -1.1, 0));
      const floor = new THREE.Vector3(sx + 2.6 + sw * 1.3, 0.3, sz);
      const dir = floor.clone().sub(hand).normalize();
      p.brush.position.copy(hand);
      p.brush.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      if (!paused && Math.random() < 0.5) this.particles.emit(floor.x, 0.3, floor.z, { vx: 0, spread: 2.5, up: 1, color: 0xffffff, size: 0.45, life: 0.3, alpha: 0.5, grav: 3, n: 1 });
    } else this.holdBrush(p, false);
  }

  updateHud() {
    const p = this.cur, ph = this.phase;
    const show = p && p.c.human && (ph === 'aim' || ph === 'power' || ph === 'slide');
    this.hudG.classList.toggle('cu-hidden', !show);
    if (!show) return;
    const touch = p.c.type === 'touch';
    const tip = helped(p.c) ? (ph === 'aim' ? 'hold any button for strength' : ph === 'power' ? 'let go at the yellow mark' : 'your toothbrush sweeps by itself: watch it go!')
      : ph === 'aim' ? `${touch ? '◀ ▶' : 'left/right'} aim: the dots show the path · hold ${touch ? '●' : 'action'} for strength`
      : ph === 'power' ? 'let go at the yellow mark to stop on the dots' : `sweep ${touch ? '◀ ▶' : 'left, right'}: the ring shows where it stops`;
    this.hudG.querySelector('.tip').textContent = tip;
    const pw = this.hudG.querySelector('.pw'), sw = this.hudG.querySelector('.sw');
    pw.style.display = ph === 'slide' ? 'none' : ''; sw.style.display = ph === 'slide' ? '' : 'none';
    pw.querySelector('i').style.width = `${(this.power * 100).toFixed(0)}%`;
    const mark = pw.querySelector('b');
    mark.style.display = this.midPower != null ? '' : 'none';
    if (this.midPower != null) mark.style.left = `${(this.midPower * 100).toFixed(1)}%`;
    sw.querySelector('i').style.width = `${(this.sweep.effort * 100).toFixed(0)}%`;
    sw.querySelector('.bar').classList.toggle('go', this.sweep.effort > 0.85);
  }

  applyCamera(dt) {
    const RR = this.ctx.R, c = this.cam, ph = this.phase;
    let want;
    if (ph === 'aim' || ph === 'power' || ph === 'pre') {
      // behind the thrower, looking down the whole table
      RR.look(-70, 44, 0, 62, -7, 0, 220);
      RR.setFocus(0.42, 0.4, 0.6);
      Object.assign(c, { x: 62, y: 0, z: 0, yaw: -Math.PI / 2 + 0.12, pitch: 0.5, width: 90 });
      return;
    }
    if (ph === 'slide' && this.thrown) {
      // follow just behind the cap, looking down the table towards where it will stop
      const s = this.thrown, ch = this.chase || (this.chase = { x: s.x, z: s.z });
      const k = Math.min(dt, 0.1);
      ch.x = damp(ch.x, Math.min(s.x, TEE + 4), 4, k); ch.z = damp(ch.z, s.z * 0.6, 3, k);
      RR.look(ch.x - 34, 25, ch.z, Math.min(ch.x + 24, TEE + 2), -5, ch.z, 170);
      RR.setFocus(0.5, 0.36, 0.7);
      Object.assign(c, { x: Math.min(ch.x + 10, TEE), y: 0, z: ch.z, yaw: -Math.PI / 2 + 0.1, pitch: 0.55, width: 70 });
      return;
    }
    this.chase = null;
    if (ph === 'settle' || ph === 'scored') want = { x: TEE - 6, y: 0, z: 0, yaw: -Math.PI / 2 + 0.2, pitch: 0.95, width: 52 };
    else want = { x: 20, y: 4, z: -18, yaw: 0.3, pitch: 0.35, width: 80 };
    const rate = ph === 'slide' ? 3 : 2.4;
    for (const k of Object.keys(want)) c[k] = dt >= 1 ? want[k] : damp(c[k], want[k], rate, Math.min(dt, 0.1));
    RR.orbit(c.x, c.y, c.z, { yaw: c.yaw, pitch: c.pitch, width: c.width, shadowSpan: Math.max(160, c.width * 1.8) });
    RR.setFocus(0.5, 0.3, 0.8);
  }

  // ---------------------------------------------------------------- cinematics
  get room() { return 'The kitchen table, at breakfast'; }
  flyIn() {
    return [
      { x: 66, y: 76, z: -100, yaw: 0, pitch: 0.04, width: 160 },
      { x: 170, y: 10, z: -10, yaw: 0.65, pitch: 0.2, width: 90 },
      { x: 40, y: 4, z: 0, yaw: -1.2, pitch: 0.4, width: 110 },
    ];
  }
  // on a saucer of sugar cubes, right on the target
  ceremonySpot() {
    for (const st of this.stones) if (st.mesh) st.mesh.visible = false;
    if (this.held) this.held.visible = false;
    return { x: TEE, y: 0, z: 0, style: 'sugar', gear: 'none', yaw: 0.35, pitch: 0.22, width: 44 };
  }

  dispose() {
    for (const p of this.players) p.fig.dispose();
    this.ctx.sound.setLoop('hiss', 0);
  }
}

export default {
  id: 'curling', name: 'Curling', season: 'Winter',
  blurb: 'Bottle caps down the polished kitchen table at a paper target. Knock the others out!',
  venue: 'The kitchen table at breakfast on a winter morning, polished till it shines, with a paper target taped at the far end.',
  loading: 'Polishing the kitchen table…',
  how: [
    { verb: 'Steer', text: 'Aim with <b>left</b> and <b>right</b>. Aimed straight, the cap slides straight. Aimed to one side, it spins and curls back towards the middle, round a cap in the way. The dotted line shows the path.' },
    { verb: 'Power', text: 'Hold <b>action</b>: the strength meter swings up and down. Let go at the yellow mark to stop at the end of the dots.' },
    { verb: 'Rhythm', text: 'While it slides, tap <b>left</b> and <b>right</b> in turn to sweep with your toothbrush: it goes further and straighter. In the target, the middle is worth 3, the red ring 2, the blue ring 1.' },
  ],
  helpers: {
    little: 'Your cap is <b>aimed for you</b> and you <b>sweep by yourself</b>. Hold <b>any button</b> and let go at the yellow mark.',
    kid: 'The strength meter swings more slowly, and your sweeping beat is slower.',
  },
  better: 'higher',
  resultsDelay: 0.6,
  create: (ctx) => new Curling(ctx),
};
