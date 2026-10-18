// Swimming: two lengths of the bathtub. Hold ACTION on the soap-bar blocks and let go on the whistle,
// tap LEFT/RIGHT in turn for the arm strokes, tap ACTION to take a breath before the air runs out, and
// tap ACTION over the green tiles before the far end for a tumble turn.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, REST, blendPose } from '../figurine.js';
import { banner } from '../props.js';
import { Caustics, sunbeams, paneWindow, daySky, duckCrowd } from '../venues.js';
import { Rhythm, BotTapper } from '../verbs.js';
import { fitRhythm, winFor, helped } from '../sizes.js';
import { Particles } from '../fx.js';
import { clamp, damp, rng, makeNoise2D, TAU } from '../util.js';
import { hudKit, Guide, Tags, RaceStart, fmtTime, beatGauge, ORD } from './common.js';

const L = 150, W = 50, T = 5;          // the tub inside: length, width; wall thickness
const RIM = 40, WY = 33, FLOOR = 8;      // rim top, water surface, tub floor
const LANE_W = W / 4;
const TARGET = 5.0, VMAX = 12.6, ACCEL = 2.2;
const TURN_ZONE = [L - 17, L - 4];     // tap ACTION over the green tiles for a tumble turn
const BODY = 7.6;                      // head to toes, lying in the water
const DRAIN = [0.06, 0.1];             // air used per second: resting, plus at full effort (a breath every ~6 s)
const BREATH_T = 0.32;
const M_PER_UNIT = 25 / L;             // the tub is a 25 m pool: two lengths make 50 m
const SUN = [-0.42, 0.78, -0.62];      // towards the sun: high, behind the tub, through the window
const WIN = { x: 58, y: 116, w: 66, h: 52 };   // the window in the back wall
// computer swimmers: cadence share, breathe when air drops below, chance of a tumble turn
const BOT = {
  easy: { cad: 0.8, air: [0.12, 0.08], turn: 0.35 },
  normal: { cad: 0.92, air: [0.2, 0.06], turn: 0.7 },
  hard: { cad: 0.99, air: [0.26, 0.04], turn: 0.93 },
};

// front crawl, lying in the water: phase 0..1 = one stroke of each arm
function crawl(ph, effort, breath) {
  const a = ph * TAU, kick = Math.sin(a * 3);
  return {
    ...REST, pitch: Math.PI / 2 - 0.05, head: -0.25 + breath * 0.2, headTurn: breath * 1.25, roll: Math.sin(a) * 0.45 + breath * 0.4,
    shL: Math.PI - a, shR: -a, elL: 0.25 + 0.5 * Math.max(0, Math.sin(a)), elR: 0.25 + 0.5 * Math.max(0, -Math.sin(a)), abL: 0.12, abR: 0.12,
    hipL: 0.2 * kick * (0.5 + effort * 0.5), hipR: -0.2 * kick * (0.5 + effort * 0.5), kneeL: 0.2 + 0.25 * Math.max(0, kick), kneeR: 0.2 + 0.25 * Math.max(0, -kick), ankL: -0.9, ankR: -0.9,
  };
}
const STREAM = { ...REST, pitch: Math.PI / 2, head: -0.1, shL: Math.PI, shR: Math.PI, abL: -0.08, abR: -0.08, elL: 0, elR: 0, ankL: -0.9, ankR: -0.9 };
const SET = { ...REST, y: -0.5, lean: 1.25, head: -0.45, hipL: 1.15, hipR: 1.15, kneeL: 0.7, kneeR: 0.7, shL: 0.35, shR: 0.35, abL: 0.05, abR: 0.05, elL: 0.1, elR: 0.1 };

class Swimming {
  constructor(ctx) {
    this.ctx = ctx;
    this.r = ctx.rand;
    this.phase = 'pre';
    this.t = 0;
    this.cam = { x: 30, y: WY, z: 0, yaw: 0.05, pitch: 0.62, width: 110 };
    this.swimmers = [];
    this.finishOrder = 0;
  }

  async build() {
    const { kit: K, R, competitors } = this.ctx;
    // a summer morning: low sun through the window behind the tub, cool light bouncing off the tiles
    R.setLighting({
      sunDir: SUN, sunColor: 0xffe2b4, sunIntensity: 2.7,
      hemiSky: 0xe4f6ff, hemiGround: 0xc8b49a, hemiIntensity: 0.72,
      envIntensity: 0.75, exposure: 1.0, background: 0xcfeaf2, shadowRadius: 4,
    });
    this.noise = makeNoise2D(71);
    this.buildRoom(K);
    this.buildTub(K);
    this.buildCrowd(K, competitors);
    this.particles = new Particles(K.group, 900);
    this.particles.setScale(R.renderer.domElement.height * 0.9);
    const n = competitors.length;
    const lanes = n >= 4 ? [0, 1, 2, 3] : n === 3 ? [0, 1, 2] : n === 2 ? [1, 2] : [1];
    competitors.forEach((c, i) => {
      const fig = new Figurine({ paint: c.paint, seed: c.seed, number: c.number });
      fig.setGear('swim');
      K.group.add(fig.root);
      const lane = lanes[i];
      const z = -W / 2 + LANE_W * (lane + 0.5);
      this.swimmers.push({
        c, i, fig, z, lane, x: 0, dir: 1, lap: 0, v: 0, air: 1, breathT: -1, gaspT: 0, turn: null, armed: false,
        rhythm: fitRhythm(new Rhythm({ target: TARGET }), c), little: c.human && helped(c), autoTurn: c.human && helped(c, 1), effort: 0, anim: this.r(), finished: false, time: null, notes: [],
        bot: c.human ? null : { tap: new BotTapper(c.pad, rng(c.seed * 31 + 7)), next: 0 },
      });
    });
    this.place();
    const kit = hudKit(this.ctx);
    this.guide = new Guide(kit, []);
    this.tags = new Tags(kit, R);
    const st = document.createElement('style');
    st.textContent = '.sw-air{display:inline-block;width:clamp(56px,5.5vw,76px);height:12px;border:2.5px solid #1f1a17;border-radius:99px;background:#fff;overflow:hidden;vertical-align:middle;margin-left:6px;box-shadow:0 2px 0 #1f1a17}.sw-row{display:flex;align-items:center;justify-content:center;gap:6px;font:800 clamp(11px,1.1vw,14px)/1 Rubik,sans-serif;-webkit-text-stroke:0;text-shadow:0 1px 0 #1f1a17,0 -1px 0 #1f1a17,1px 0 0 #1f1a17,-1px 0 0 #1f1a17;text-transform:uppercase}.sw-air i{display:block;height:100%;background:#4fb3e8}.sw-air.low i{background:#e23b2e}';
    kit.el.appendChild(st);
    this.applyCamera(1);
  }

  buildRoom(K) {
    const g = K.group;
    const ZW = -W / 2 - T - 2;   // the back wall
    // a black-and-white chequered floor
    const fc = K.TX.makeCanvas(256), f = fc.getContext('2d');
    f.fillStyle = '#b9b4aa'; f.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      f.fillStyle = (x + y) % 2 ? '#30353b' : '#f3efe6';
      f.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 500).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(fc, { repeat: [45, 25] }), roughness: 0.32 }));
    floor.position.set(L / 2, 0, 60); floor.receiveShadow = true; g.add(floor);
    // mint subway tiles, a band of deep teal ones, white above the band
    const subway = (base, grout, rows = 8) => {
      const c = K.TX.makeCanvas(256), t = c.getContext('2d');
      t.fillStyle = grout; t.fillRect(0, 0, 256, 256);
      const h = 256 / rows;
      for (let y = 0; y < rows; y++) for (let x = -1; x < 4; x++) {
        const v = 0.93 + 0.07 * this.noise.noise(x * 3.1 + y, y * 2.7);
        t.globalAlpha = v; t.fillStyle = base;
        t.fillRect(x * 64 + (y % 2) * 32 + 2, y * h + 2, 60, h - 4);
      }
      t.globalAlpha = 1;
      return c;
    };
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(900, 200), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(subway('#cdeee4', '#a6cfc3'), { repeat: [56, 6] }), roughness: 0.22 }));
    wall.position.set(L / 2, 100, ZW); wall.receiveShadow = true; g.add(wall);
    const band = new THREE.Mesh(new THREE.PlaneGeometry(900, 8), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(subway('#2f8f83', '#1f6a61', 2), { repeat: [56, 1] }), roughness: 0.2 }));
    band.position.set(L / 2, RIM + 46, ZW + 0.1); g.add(band);
    // the window, the sun streaming in, a fern and a toy sailing boat on the sill
    this.win = paneWindow(g, { x: WIN.x, y: WIN.y, z: ZW + 0.2, w: WIN.w, h: WIN.h, sky: daySky(5), depth: 3.2 });
    const pot = new THREE.Mesh(K.lathe([[0.01, 0], [3.2, 0], [4.2, 6], [4.6, 6.6], [0.01, 6.6]], 20), K.paint(0xd8724a));
    pot.position.set(WIN.x - WIN.w / 2 + 9, this.win.sillY, ZW + 4); pot.castShadow = true; g.add(pot);
    const leaves = [];
    for (let k = 0; k < 11; k++) { const a = (k / 11) * TAU; leaves.push({ x: WIN.x - WIN.w / 2 + 9 + Math.cos(a) * 2.5, y: this.win.sillY + 9, z: ZW + 4 + Math.sin(a) * 2.5, ry: -a, rz: 0.75 + (k % 3) * 0.2, s: 1, color: [0x4f9a4a, 0x6cb35a, 0x3d7f3f][k % 3] }); }
    K.instances(new THREE.SphereGeometry(1.4, 8, 6).scale(1, 5, 0.35).translate(0, 4, 0), K.std({ color: 0xffffff, roughness: 0.6 }), leaves, { colors: true });
    const boat = K.merge([
      { geo: new K.RoundedBoxGeometry(10, 2.6, 3.6, 2, 1), color: 0xe23b2e },
      { geo: new THREE.CylinderGeometry(0.25, 0.25, 9, 6), color: 0xd9b48a, pos: [0, 5.5, 0] },
      { geo: new THREE.ConeGeometry(3.4, 7, 3).scale(1, 1, 0.12), color: 0xf7f4ee, pos: [1.6, 6, 0] },
    ]);
    const b = new THREE.Mesh(boat, K.plastic(0xffffff, 0.35, { vertexColors: true }));
    b.position.set(WIN.x + WIN.w / 2 - 10, this.win.sillY + 1.3, ZW + 4); b.rotation.y = 0.3; b.castShadow = true; g.add(b);
    this.beams = sunbeams(g, { from: [WIN.x, WIN.y, ZW + 2], dir: SUN.map((v) => -v), length: 170, width: 15, n: 3, spread: 17, opacity: 0.16 });
    // a striped towel on a rail by the far end, a shelf over the tub with a mirror above
    const shelf = new THREE.Mesh(new K.RoundedBoxGeometry(L + 40, 2, 12, 2, 0.6), K.std({ color: 0xf7f4ee, roughness: 0.4 }));
    shelf.position.set(L / 2, RIM + 30, -W / 2 - T + 4); shelf.castShadow = true; shelf.receiveShadow = true; g.add(shelf);
    this.shelfY = RIM + 31;
    const tc = K.TX.makeCanvas(64, 128), t2 = tc.getContext('2d');
    for (let y = 0; y < 128; y += 16) { t2.fillStyle = (y / 16) % 2 ? '#fff6ea' : '#ef6f6c'; t2.fillRect(0, y, 64, 16); }
    t2.fillStyle = '#f7c948'; t2.fillRect(0, 60, 64, 6);
    const towel = new THREE.Mesh(new K.RoundedBoxGeometry(26, 48, 2.5, 2, 1), K.felt(0xffffff, { map: K.TX.toTexture(tc, { wrap: false }) }));
    towel.position.set(L + 46, 46, -W / 2 - T + 1); towel.castShadow = true; g.add(towel);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 34, 10).rotateZ(Math.PI / 2), K.metal(0xd4aa5a, 0.25));
    rail.position.set(L + 46, 70, -W / 2 - T + 2); g.add(rail);
    // a round mirror with a brass rim over the shelf
    const mc = K.TX.makeCanvas(128), m2 = mc.getContext('2d');
    const mg = m2.createLinearGradient(0, 0, 128, 128);
    mg.addColorStop(0, '#f4fbfd'); mg.addColorStop(0.5, '#bfdbe4'); mg.addColorStop(1, '#e6f2f4');
    m2.fillStyle = mg; m2.fillRect(0, 0, 128, 128);
    m2.strokeStyle = 'rgba(255,255,255,0.8)'; m2.lineWidth = 7; for (const o of [30, 52]) { m2.beginPath(); m2.moveTo(o, 128); m2.lineTo(o + 70, 0); m2.stroke(); }
    const mirror = new THREE.Mesh(new THREE.CircleGeometry(16, 40), K.phys({ map: K.TX.toTexture(mc, { wrap: false }), metalness: 0.2, roughness: 0.08, clearcoat: 1 }));
    mirror.position.set(118, RIM + 58, ZW + 0.4); g.add(mirror);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(16.4, 1, 10, 48), K.metal(0xd4aa5a, 0.25));
    rim.position.copy(mirror.position); rim.position.z += 0.6; rim.castShadow = true; g.add(rim);
  }

  buildTub(K) {
    const g = K.group;
    const enamel = K.phys({ color: 0xf8f6f1, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.22 });
    const box = (w, h, d, x, y, z, m = enamel, rad = 2) => { const o = new THREE.Mesh(new K.RoundedBoxGeometry(w, h, d, 3, rad), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
    const H = RIM - 4;
    box(L + 2 * T, H, T, L / 2, 4 + H / 2, -W / 2 - T / 2);
    box(L + 2 * T, H, T, L / 2, 4 + H / 2, W / 2 + T / 2);
    box(T, H, W + 0.2, -T / 2, 4 + H / 2, 0);
    box(T, H, W + 0.2, L + T / 2, 4 + H / 2, 0);
    box(L + 1, FLOOR - 4, W + 1, L / 2, (FLOOR + 4) / 2, 0, enamel, 1);
    // brass claw feet
    const brass = K.metal(0xd4aa5a, 0.28);
    for (const x of [-T + 7, L + T - 7]) for (const z of [-W / 2 - 1, W / 2 + 1]) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(3.6, 18, 12), brass); f.position.set(x, 3.4, z); f.scale.set(1, 1.1, 1); f.castShadow = true; g.add(f);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3, 4, 14), brass); leg.position.set(x, 6.5, z); g.add(leg);
    }
    // painted outside: retro coral pink with a gold pinstripe under the white rim
    const paint = K.paint(0xf29a92, { clearcoat: 0.8 }), gold = K.metal(0xd8b25e, 0.25);
    const panel = (w, h, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), paint); m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; g.add(m); return m; };
    const PH = H - 7, PY = 5 + PH / 2;
    panel(L + 2 * T - 4, PH, L / 2, PY, W / 2 + T + 0.06, 0);
    panel(L + 2 * T - 4, PH, L / 2, PY, -W / 2 - T - 0.06, Math.PI);
    panel(W + 2 * T - 4, PH, -T - 0.06, PY, 0, -Math.PI / 2);
    panel(W + 2 * T - 4, PH, L + T + 0.06, PY, 0, Math.PI / 2);
    for (const z of [W / 2 + T + 0.2, -W / 2 - T - 0.2]) { const st = new THREE.Mesh(new THREE.BoxGeometry(L + 2 * T - 4, 0.7, 0.3), gold); st.position.set(L / 2, PY + PH / 2 - 1.6, z); g.add(st); }
    K.contact(L / 2, 0, L / 2 + 14, W / 2 + 10, 0.4);
    // the tub floor under the water: lane lines in blue tape, T-ends at the walls, green tiles before the far end
    const Y = FLOOR + 0.05;
    const tapeM = new THREE.MeshStandardMaterial({ color: 0x2f4f7a, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let k = 0; k < 4; k++) {
      const z = -W / 2 + LANE_W * (k + 0.5);
      const ln = new THREE.Mesh(new THREE.PlaneGeometry(L - 16, 1.2).rotateX(-Math.PI / 2), tapeM); ln.position.set(L / 2, Y, z); g.add(ln);
      for (const x of [8, L - 8]) { const te = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 5).rotateX(-Math.PI / 2), tapeM); te.position.set(x, Y, z); g.add(te); }
    }
    const zc = K.TX.makeCanvas(128, 64), z2 = zc.getContext('2d');
    z2.fillStyle = '#7fd08f'; z2.fillRect(0, 0, 128, 64);
    z2.fillStyle = '#4fae66'; for (let x = 0; x < 128; x += 16) for (let y = 0; y < 64; y += 16) if (((x + y) / 16) % 2) z2.fillRect(x + 1, y + 1, 14, 14);
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(TURN_ZONE[1] - TURN_ZONE[0], W - 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(zc, { repeat: [2, 6] }), roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1 }));
    zone.position.set((TURN_ZONE[0] + TURN_ZONE[1]) / 2, Y, 0); g.add(zone);
    // the water: a glossy, rippling sheet
    const nf = K.TX.noiseField(256, { seed: 23, period: 32, oct: 3 });
    this.waterNormal = K.TX.toTexture(K.TX.normalFromHeight(nf, 256, 256, 1.6), { srgb: false, repeat: [5, 2] });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(L, W, 1, 1).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x56b4dc, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.42, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false }));
    this.water.position.set(L / 2, WY, 0); this.water.renderOrder = 2; g.add(this.water);
    const tint = new THREE.Mesh(new THREE.PlaneGeometry(L, W).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2f94c4, transparent: true, opacity: 0.3, depthWrite: false }));
    tint.position.set(L / 2, (WY + FLOOR) / 2, 0); g.add(tint);
    // sunlight rippling over the bottom of the tub
    this.caustics = new Caustics(g, { x: L / 2, z: 0, w: L - 1, d: W - 1, y: FLOOR + 0.12, opacity: 0.5, scale: 22 });
    // bubble-bath foam along the long sides, heaped up in the corners
    this.foam = [];
    const fr = rng(31);
    for (const side of [-1, 1]) {
      for (let x = 2; x < L - 2; x += 0.9 + fr() * 1.6) {
        const corner = x < 14 || x > L - 14;
        const n = corner ? 3 : fr() < 0.55 ? 1 : 2;
        for (let k = 0; k < n; k++) {
          const rr = (corner ? 0.9 : 0.45) + fr() * (corner ? 1.1 : 0.7);
          this.foam.push({ x: x + (fr() - 0.5) * 1.5, y: WY + rr * 0.25 + k * 0.5, z: side * (W / 2 - rr * 0.7 - fr() * (corner ? 3 : 1.2)), r: rr, ph: fr() * TAU });
        }
      }
    }
    this.foamMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.3, iridescence: 0.7, iridescenceIOR: 1.3, transparent: true, opacity: 0.82 }), this.foam.length);
    this.foamMesh.receiveShadow = true;
    g.add(this.foamMesh);
    this.m4 = new THREE.Matrix4(); this.fq = new THREE.Quaternion(); this.fv = new THREE.Vector3(); this.fs = new THREE.Vector3();
    this.updateFoam(0);
    // lane ropes: beads on a string, floating
    const beads = [], cols = [0xe23b2e, 0xf6f2ea, 0x2f6fe0];
    for (let k = 1; k < 4; k++) {
      const z = -W / 2 + LANE_W * k;
      for (let x = 1.5; x < L; x += 1.6) beads.push({ x, y: WY + 0.2, z, s: 1, color: x < 12 || x > L - 12 ? cols[0] : cols[1 + (Math.floor(x / 10) % 2)] });
    }
    K.instances(new THREE.SphereGeometry(0.72, 10, 8), K.plastic(0xffffff, 0.3), beads, { colors: true });
    // bunting across the tub before the turn, strung between two toothbrushes
    const flags = [];
    const fc = [0xe23b2e, 0xf2c230, 0x2f6fe0, 0x2fae5a];
    for (let z = -W / 2 - 2, k = 0; z <= W / 2 + 2; z += 3.2, k++) flags.push({ x: TURN_ZONE[0], y: RIM + 7 - 0.7 * Math.cos((z / (W / 2)) * 1.2), z, s: 1, color: fc[k % 4] });
    const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -1.2), new THREE.Vector3(0, 0, 1.2), new THREE.Vector3(0, -2.6, 0)]);
    tri.computeVertexNormals();
    K.instances(tri, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 }), flags, { colors: true });
    for (const z of [-W / 2 - T / 2, W / 2 + T / 2]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 9, 8), K.plastic(0x5bc0de)); p.position.set(TURN_ZONE[0], RIM + 4.5, z); p.castShadow = true; g.add(p); }
    // starting blocks: soap bars on the near rim
    const soapCols = [0xf2c4cf, 0xbfe6c7, 0xfff1a8, 0xc8d8f8];
    this.blockY = RIM + 2.2;
    for (let k = 0; k < 4; k++) {
      const z = -W / 2 + LANE_W * (k + 0.5);
      const s = new THREE.Mesh(new K.RoundedBoxGeometry(6.5, 2.2, 5, 3, 0.9), K.phys({ color: soapCols[k], roughness: 0.35, clearcoat: 0.6 }));
      s.position.set(-2.2, RIM + 1.1, z); s.castShadow = true; g.add(s);
    }
    // bottles, a cup of toothbrushes and rubber ducks along the back rim
    const bottle = (x, col, h) => { const m = new THREE.Mesh(K.lathe([[0.01, 0], [3, 0], [3.2, h * 0.75], [1.4, h], [1.2, h + 2], [0.01, h + 2]], 24), K.plastic(col, 0.25)); m.position.set(x, this.shelfY, -W / 2 - T + 4); m.castShadow = true; g.add(m); };
    bottle(10, 0x7bc6b0, 12); bottle(18, 0xf08aa3, 10); bottle(140, 0xffc93c, 13); bottle(148, 0x8a55c9, 9);
  }

  updateFoam(t) {
    const { m4, fq, fv, fs } = this;
    this.foam.forEach((b, i) => {
      const k = 1 + 0.06 * Math.sin(t * 1.7 + b.ph);
      fv.set(b.x, b.y + 0.15 * Math.sin(t * 1.1 + b.ph), b.z); fs.set(b.r * k, b.r * k * 0.92, b.r * k);
      m4.compose(fv, fq, fs); this.foamMesh.setMatrixAt(i, m4);
    });
    this.foamMesh.instanceMatrix.needsUpdate = true;
  }

  buildCrowd(K, competitors) {
    const spots = [];
    for (let k = 0; k < 6; k++) spots.push({ x: 30 + k * 16 + (k > 2 ? 10 : 0), y: this.shelfY, z: -W / 2 - T + 3, ry: 0.1, size: 9 + this.r() * 2 });
    for (let k = 0; k < 4; k++) spots.push({ x: L + T + 22 + (k % 2) * 10, y: 0, z: -20 + k * 14, ry: -1.4, size: 12 });
    for (let k = 0; k < 3; k++) spots.push({ x: -T - 20 - (k % 2) * 8, y: 0, z: -14 + k * 16, ry: 1.4, size: 11 });
    // the crowd: rubber ducks, mostly yellow, the odd pink, blue or green one
    this.crowd = duckCrowd(K.group, spots, 59);
    [[-T - 12, 34], [L + T + 14, 38]].forEach(([x, z], k) => {
      const b = banner(competitors[k % competitors.length].code, 16, { seed: 90 + k });
      b.position.set(x, 0, z); b.rotation.y = k ? -0.8 : 0.8;
      K.group.add(b);
    });
  }

  attract() {}

  start() {
    this.ctx.sound.setLoop('crowd', 0.25);
    this.startCtl = new RaceStart(this.ctx, this.swimmers);
    this.phase = 'marks'; this.t = 0;
    this.ctx.hud.message(this.startCtl.marksText(), 'small', '#fff');
    this.ctx.sound.block(false);
  }

  // ---------------------------------------------------------------- per step
  botUpdate(s, now) {
    const B = BOT[this.ctx.skillName] || BOT.normal, b = s.bot, pad = s.c.pad;
    if (!s.started || s.finished) return;
    if (!b.on) { b.on = true; b.tap.start(now); b.airAt = clamp(B.air[0] + this.r.gauss() * B.air[1], 0.05, 0.5); b.turn = this.r() < B.turn; }
    if (s.turn || s.dive) return;
    b.tap.update(now, TARGET * B.cad, 0.07, 0.004);
    if (s.air < b.airAt && s.breathT < 0 && !(s.dir > 0 && s.x > TURN_ZONE[0] - 4)) { pad.push('action', true, now); pad.push('action', false, now + 0.05); b.airAt = clamp(B.air[0] + this.r.gauss() * B.air[1], 0.05, 0.5); }
    if (b.turn && s.dir > 0 && s.lap === 0 && !s.armed && s.x > TURN_ZONE[0] + 3 + this.r() * 4) { pad.push('action', true, now); pad.push('action', false, now + 0.05); }
  }

  update(dt) {
    const ctx = this.ctx, now = ctx.time();
    this.t += dt;
    const q = this.swimmers.map((s) => ctx.presses(s.i));
    if (this.phase === 'pre') return;
    if (this.phase === 'done') { if (this.t > 1.2 && this.results) { const r = this.results; this.results = null; ctx.finish(r); } return; }
    for (const s of this.swimmers) if (s.bot) this.botUpdate(s, now); else if (s.c.human) this.assist(s, now);
    const left = this.startCtl.update(dt, now, q);
    if (this.phase === 'marks' && this.startCtl.phase === 'go') { this.phase = 'race'; this.t = 0; }
    for (const s of this.swimmers) {
      if (s.started && !s.dive && !s.swimming && !s.finished) this.dive(s, s.startT);
      this.step(s, left[s.i] || [], dt, now);
    }
    if (this.phase === 'race' && (this.swimmers.every((s) => s.finished) || now - this.startCtl.whistleAt > 120)) this.finishAll();
  }

  dive(s) {
    // off the soap bar in an arc, a good reaction gives a longer flight
    const k = this.startCtl.boost(s);
    s.dive = { u: 0, len: 9 + 5 * k, k };
    s.v = 0;
    this.ctx.sound.whoosh(0.4);
  }

  step(s, evs, dt, now) {
    const ctx = this.ctx;
    if (s.flashT > 0) s.flashT -= dt;
    if (s.finished) { s.v *= Math.exp(-2 * dt); return; }
    if (s.dive) {
      s.dive.u += dt / 0.55;
      if (s.dive.u >= 1) {
        s.swimming = true; s.v = VMAX * (0.6 + 0.35 * s.dive.k); s.x = s.dive.len; s.dive = null; s.glide = 0.5;
        this.splash(s.x + 2, s.z, 14); ctx.sound.puff(0.6);
      }
      return;
    }
    if (!s.swimming) return;
    // presses: strokes, breaths and the turn
    for (const e of evs) {
      if (!e.down) continue;
      if (e.b === 'action' && !s.little) {
        if (s.lap === 0 && s.dir > 0 && s.x >= TURN_ZONE[0] && s.x <= TURN_ZONE[1] && !s.turn) { s.armed = true; if (s.c.human) ctx.sound.pop(); } else this.breathe(s, e.t);
        continue;
      }
      if (s.turn || s.gaspT > 0) continue;
      const res = s.rhythm.press(e.b, e.t);
      if (res === 'stumble') { s.v *= 0.9; this.splash(s.x, s.z, 4); } else if (s.c.human) ctx.sound.step(0.25);
      s.stroked = 0.12;
    }
    if (s.turn) { this.stepTurn(s, dt); return; }
    // air runs out faster the harder you swim; with no air left you splutter and slow right down
    // thrashing well above the beat just splashes: no faster, a little slower
    const x = s.rhythm.ratio(now), th = 1 + winFor(s.c, 0.2);
    let eff = s.rhythm.effort(now) * (x > th ? Math.max(0.86, 1 - (x - th) * 0.3) : 1);
    if (s.paddle) eff = Math.max(eff, s.paddle);
    s.effort = eff;
    s.air = Math.max(0, s.air - (DRAIN[0] + DRAIN[1] * eff) * dt);
    if (s.air <= 0 && s.gaspT <= 0) { s.gaspT = 1.2; s.air = 0.55; s.notes.push('gasp'); ctx.hud.flash(`${s.c.short}: out of air!`, '#ff8a65'); this.splash(s.x, s.z, 10); }
    if (s.breathT >= 0) { s.breathT += dt; if (s.breathT > BREATH_T) s.breathT = -1; }
    let target = VMAX * Math.min(1.04, eff);
    if (s.breathT >= 0) target *= 0.84;
    if (s.gaspT > 0) { s.gaspT -= dt; target = VMAX * 0.3; }
    if (s.glide > 0) { s.glide -= dt; target = Math.max(target, s.v); }
    s.v += (target - s.v) * (1 - Math.exp(-(target > s.v ? ACCEL : 1.6) * dt));
    s.x += s.dir * s.v * dt;
    // the far end: a tumble turn if ACTION was tapped over the green tiles, otherwise touch and turn
    if (s.dir > 0 && s.x >= L - 2.5) {
      s.x = L - 2.5;
      s.turn = { u: 0, tumble: s.armed };
      s.armed = false;
      if (!s.turn.tumble) s.notes.push('touch turn');
      ctx.sound.puff(0.5);
    }
    if (s.dir < 0 && s.x <= 0) this.touchFinish(s, now - (-s.x) / Math.max(1, s.v));
  }

  stepTurn(s, dt) {
    const tr = s.turn;
    tr.u += dt / (tr.tumble ? 0.45 : 1.3);
    s.v = 0;
    if (tr.u > 0.5 && !tr.flipped) { tr.flipped = true; s.dir = -1; s.x = L - 3; this.splash(L - 4, s.z, tr.tumble ? 14 : 8); }
    if (tr.u >= 1) {
      s.turn = null; s.lap = 1; s.air = Math.max(s.air, tr.tumble ? 0.75 : 1);
      s.v = VMAX * (tr.tumble ? 1.12 : 0.45); s.glide = tr.tumble ? 0.45 : 0.15;
      if (s.c.human) this.tagFlash(s, tr.tumble ? 'tumble turn!' : 'slow touch turn', tr.tumble ? '#7be495' : '#ff8a65');
    }
  }

  breathe(s) {
    if (s.breathT >= 0 || s.gaspT > 0) return;
    s.breathT = 0;
    const was = s.air;
    s.air = Math.min(1, s.air + 0.65);
    if (s.c.human) { this.ctx.sound.puff(0.25); this.tagFlash(s, was < 0.35 ? 'good breath' : 'breath', was < 0.35 ? '#7be495' : '#fff1d6'); }
  }

  // helpers: Little swimmers breathe and turn by themselves, Kids turn by themselves; anyone still in
  // the water a while after the winner paddles home
  assist(s, now) {
    if (!s.swimming || s.finished || s.turn) return;
    const first = this.swimmers.find((o) => o.finished && o.place === 0);
    const late = first ? now - this.startCtl.whistleAt - first.time - 6 : now - this.startCtl.whistleAt - 45;
    s.paddle = late > 0 ? Math.min(0.8, 0.4 + late * 0.06) : 0;
    if (s.paddle) s.paddled = true;
    const auto = s.little || s.paddle;
    if (auto && s.air < 0.3 && s.breathT < 0 && !(s.dir > 0 && s.x > TURN_ZONE[0] - 4 && s.lap === 0)) this.breathe(s, now);
    if ((s.autoTurn || auto) && s.lap === 0 && s.dir > 0 && !s.armed && s.x > TURN_ZONE[0] + 3) { s.armed = true; this.ctx.sound.pop(); }
  }

  tagFlash(s, text, col) { s.flash = text; s.flashC = col; s.flashT = 0.8; }

  touchFinish(s, t) {
    s.x = 0; s.finished = true;
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
    for (const s of this.swimmers) s.bot?.tap.stop();
    this.guide.show(false);
    this.tags.clear();
    this.results = this.swimmers.map((s) => {
      const notes = [];
      if (s.early) notes.push('too early off the block');
      const g = s.notes.filter((n) => n === 'gasp').length;
      if (g) notes.push(g > 1 ? `ran out of air ${g} times` : 'ran out of air');
      if (s.notes.includes('touch turn')) notes.push('touch turn');
      if (s.paddled) notes.push('paddled home');
      return s.finished
        ? { value: s.time, text: fmtTime(s.time), short: fmtTime(s.time), sub: notes.join(' · ') }
        : { value: null, dnf: true, text: 'Did not finish', short: 'DNF', sub: '' };
    });
  }

  splash(x, z, n) {
    this.particles.emit(x, WY + 0.4, z, { vx: 0, spread: 5, up: 7, color: 0xffffff, size: 0.8, life: 0.55, alpha: 0.7, grav: 22, n });
  }

  place() {
    for (const s of this.swimmers) {
      s.fig.root.position.set(-2.2, this.blockY, s.z);
      s.fig.root.rotation.set(0, Math.PI / 2, 0);
    }
  }

  // ---------------------------------------------------------------- per frame
  frame(dt, paused) {
    const ctx = this.ctx, tt = ctx.time();
    if (!paused) {
      this.particles.update(dt);
      this.waterNormal.offset.x = (tt * 0.013) % 1; this.waterNormal.offset.y = (tt * 0.007) % 1;
    }
    let lead = null;
    for (const s of this.swimmers) {
      this.poseSwimmer(s, tt, dt, paused);
      if (!s.finished && (!lead || this.progress(s) > this.progress(lead))) lead = s;
    }
    this.lead = lead;
    if (!paused) {
      this.caustics.update(tt);
      this.beams.update(tt);
      this.updateFoam(tt);
    }
    const exc = this.phase === 'race' ? 0.45 + 0.3 * clamp(this.progress(lead || this.swimmers[0]) / (2 * L) * 1.4 - 0.4, 0, 1) : this.phase === 'done' ? 0.55 : 0.15;
    this.crowd.update(tt, exc);
    if (!paused) ctx.sound.setLoop('crowd', 0.2 + exc * 0.4);
    this.updateHud(tt);
    this.applyCamera(dt);
  }

  progress(s) { return s.finished ? 2 * L + 10 - s.place : s.lap === 0 && s.dir > 0 ? s.x : 2 * L - s.x; }

  poseSwimmer(s, tt, dt, paused) {
    const fig = s.fig, root = fig.root;
    if (!s.started || (!s.dive && !s.swimming)) {
      // on the block: standing, then crouched ready
      fig.ground = true;
      root.position.set(-2.2, this.blockY, s.z);
      root.rotation.set(0, Math.PI / 2, 0);
      const set = this.phase === 'marks' && this.t > 0.5 ? clamp((this.t - 0.5) * 3, 0, 1) : 0;
      fig.setPose(this.phase === 'pre' ? POSES.stand(tt + s.i) : blendPose(POSES.stand(tt + s.i), SET, set));
      return;
    }
    fig.ground = false;
    if (s.dive) {
      const u = s.dive.u;
      const x = -2.2 + s.dive.len * u, y = this.blockY + 5 * u * (1 - u) * 1.6 - (this.blockY - WY + 1.2) * u * u;
      root.position.set(x, y, s.z);
      root.rotation.set(0, Math.PI / 2, 0);
      fig.setPose({ ...STREAM, pitch: 0.9 + 1.0 * u });
      return;
    }
    const sp = s.v / VMAX;
    if (!paused && !s.turn) s.anim = (s.anim + Math.max(s.rhythm.cadence(tt) * 0.5, sp * 1.4) * dt) % 1;
    let y = WY - 0.25, pose;
    if (s.turn) {
      const u = s.turn.u;
      if (s.turn.tumble) { pose = { ...STREAM, pitch: Math.PI / 2 + (u < 0.5 ? u * 2 * Math.PI : 0), shL: 0.4, shR: 0.4, hipL: 1.6 * Math.sin(Math.min(u, 0.5) * 2 * Math.PI), hipR: 1.6 * Math.sin(Math.min(u, 0.5) * 2 * Math.PI), kneeL: 2.0 * Math.sin(Math.min(u, 0.5) * 2 * Math.PI), kneeR: 2.0 * Math.sin(Math.min(u, 0.5) * 2 * Math.PI) }; y = WY - 2.5 * Math.sin(u * Math.PI) - 0.9; }
      else { pose = u < 0.5 ? { ...crawl(0.25, 0.3, 1), pitch: 0.9, shR: 2.4, elR: 0.6 } : { ...STREAM, pitch: Math.PI / 2 }; y = u < 0.5 ? WY - 4 : WY - 1.6; }
    } else if (s.finished) {
      // standing up in the water at the wall, chest out, waving (the winner with both arms)
      pose = { ...REST, y: 0, shL: s.place === 0 ? 2.8 + 0.2 * Math.sin(tt * 7) : 0.5, shR: 2.6 + 0.25 * Math.sin(tt * 7 + 1), abL: 0.45, abR: 0.45, elL: 0.3, elR: 0.3, head: -0.15 };
      root.position.set(4.5, WY - 4.6 + 0.25 * Math.sin(tt * 2.2 + s.i), s.z);
      root.rotation.set(0, 0.35, 0);
      fig.setPose(pose);
      return;
    } else {
      const breath = s.breathT >= 0 ? Math.sin(clamp(s.breathT / BREATH_T, 0, 1) * Math.PI) : 0;
      pose = s.gaspT > 0 ? { ...crawl(s.anim, 0.2, 0.6), pitch: 1.0, head: -0.6 } : s.glide > 0 && s.lap === 1 && s.v > VMAX ? STREAM : crawl(s.anim, sp, breath);
      if (s.gaspT > 0) y = WY - 3.2 + Math.sin(tt * 12) * 0.4;
      if (!paused && s.stroked > 0) { s.stroked -= dt; if (Math.random() < 0.6) this.splash(s.x + s.dir * 1, s.z + (Math.random() - 0.5) * 3, 1); }
    }
    // the swimmer's x is the head: the root (feet) trails behind
    const along = s.finished ? 0 : BODY;
    root.position.set(s.x - s.dir * along, y, s.z);
    root.rotation.set(0, s.dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    fig.setPose(pose);
  }

  updateHud(tt) {
    const humans = this.swimmers.filter((s) => s.c.human);
    const ph = this.phase;
    const show = humans.length > 0 && (ph === 'marks' || (ph === 'race' && humans.some((s) => !s.finished)));
    this.guide.show(show);
    if (show) {
      const touch = humans.every((s) => s.c.type === 'touch');
      const a = touch ? '●' : 'action', lr = touch ? '◀ ▶' : 'left, right';
      const h = humans.find((s) => !s.finished) || humans[0];
      this.guide.tip(h.little ? (ph === 'marks' ? 'you dive by yourself on the whistle' : 'tap any button on a steady beat: you breathe and turn by yourself')
        : ph === 'marks' ? `hold ${a} on the soap, let go on the whistle`
          : h.lap === 0 && h.x > TURN_ZONE[0] - 30 ? (h.autoTurn ? 'you turn by yourself at the green tiles' : `tap ${a} over the green tiles: tumble turn!`)
          : `tap ${lr} in turn to swim · ${a} to breathe`);
    }
    // over each human swimmer: name, the stroke beat, the air left, and what to do next
    for (const s of this.swimmers) {
      const key = 's' + s.i;
      if (!s.c.human || ph === 'done' || ph === 'pre') { this.tags.hide(key); continue; }
      if (s.finished) { this.tags.set(key, `<span class="pill big" style="--tc:${s.place === 0 ? '#ffc93c' : '#fff1d6'}">${ORD[s.place]} · ${fmtTime(s.time)}</span>`); this.tags.place(key, 4.5, WY + 7, s.z); continue; }
      const low = s.air < 0.3;
      const blink = Math.sin(tt * 12) > 0;
      const ahead = s.lap === 0 && s.dir > 0 && !s.turn && s.x > TURN_ZONE[0] - 22 && s.x < TURN_ZONE[0];
      const zone = s.lap === 0 && s.dir > 0 && s.x >= TURN_ZONE[0] && s.x <= TURN_ZONE[1] && !s.armed && !s.turn;
      let pill = '';
      if (s.flashT > 0) pill = `<span class="pill" style="--tc:${s.flashC}">${s.flash}</span><br>`;
      else if (zone && !s.autoTurn) pill = `<span class="pill big" style="--tc:${blink ? '#7be495' : '#fff1d6'}">tap now: turn!</span><br>`;
      else if (s.armed) pill = '<span class="pill" style="--tc:#7be495">tumble turn ready</span><br>';
      else if (ahead && !s.autoTurn) pill = '<span class="pill" style="--tc:#fff1d6">green tiles ahead</span><br>';
      else if (s.gaspT > 0) pill = '<span class="pill" style="--tc:#ff8a65">out of air!</span><br>';
      else if (low && s.swimming) pill = `<span class="pill big" style="--tc:${blink ? '#ff8a65' : '#ffc93c'}">breathe!</span><br>`;
      const beat = s.swimming && !s.turn ? beatGauge(s.rhythm.ratio(this.ctx.time())) : '';
      this.tags.set(key, `${pill}${s.c.short}<div class="sw-row">air<span class="sw-air${low ? ' low' : ''}"><i style="width:${(s.air * 100).toFixed(0)}%"></i></span></div>${beat}`);
      const hx = s.swimming || s.dive ? s.x : -2.2;
      this.tags.place(key, hx, (s.swimming ? WY : this.blockY + 9) + 6, s.z);
    }
  }

  applyCamera(dt) {
    const R = this.ctx.R, c = this.cam, ph = this.phase;
    let want;
    if (ph === 'pre' || ph === 'marks') want = { x: 16, y: WY + 2, z: 2, yaw: 0.45, pitch: 0.36, width: 78 };
    else {
      // follow the human swimmers (or the leader), keeping everyone close by in view
      const humans = this.swimmers.filter((s) => s.c.human && !s.finished);
      const focus = humans.length ? humans : this.lead ? [this.lead] : this.swimmers;
      let lo = Infinity, hi = -Infinity;
      for (const s of focus) { const x = s.started ? s.x : 0; lo = Math.min(lo, x); hi = Math.max(hi, x); }
      if (this.lead && Math.abs(this.lead.x - (lo + hi) / 2) < 50) { lo = Math.min(lo, this.lead.x); hi = Math.max(hi, this.lead.x); }
      const mid = (lo + hi) / 2;
      let zc = 0;
      for (const s of focus) zc += s.z;
      zc /= focus.length;
      want = { x: clamp(mid + 4, 26, L - 26), y: WY, z: zc * 0.75 + 2, yaw: 0.08, pitch: 0.78, width: clamp(hi - lo + 46, 66, 160) };
      if (ph === 'done') Object.assign(want, { x: 22, z: 4, width: 82, yaw: 0.45, pitch: 0.42 });
    }
    for (const k of Object.keys(want)) c[k] = dt >= 1 ? want[k] : damp(c[k], want[k], 2.6, Math.min(dt, 0.1));
    R.orbit(c.x, c.y, c.z, { yaw: c.yaw, pitch: c.pitch, width: c.width, shadowSpan: Math.max(170, c.width * 1.6) });
    R.setFocus(0.5, 0.3, 0.8);
  }

  dispose() {
    for (const s of this.swimmers) s.fig.dispose();
    this.tags?.clear();
  }
}

export default {
  id: 'swimming', name: 'Swimming', season: 'Summer',
  blurb: 'Two lengths of the bathtub: smooth strokes, a breath when you need one, a tumble turn at the far end.',
  venue: 'The big bathtub with the brass feet, lane ropes of beads and soap bars for starting blocks.',
  loading: 'Running the bath…',
  how: [
    { verb: 'Timing', text: 'On the soap bar, <b>hold action</b>. Let go on the whistle. Too early and you wait.' },
    { verb: 'Rhythm', text: 'Tap <b>left</b> and <b>right</b> in turn for the arm strokes. Keep the beat needle over your swimmer in the green: steady beats fast.' },
    { verb: 'Timing', text: 'Tap <b>action</b> to breathe before your air runs out. Over the <b>green tiles</b> at the far end, tap <b>action</b> for a tumble turn.' },
  ],
  helpers: {
    little: 'You dive, <b>breathe</b> and <b>turn</b> by yourself. Just tap <b>any button</b> on a slow, steady beat to swim.',
    kid: 'You <b>turn</b> by yourself at the far end. Your beat is a bit slower.',
  },
  better: 'lower',
  resultsDelay: 1.6,
  create: (ctx) => new Swimming(ctx),
};
