// Sprint: four lanes chalked on the playroom floor. React to the whistle, then alternate left and right
// to run. A steady rhythm near the target cadence beats frantic mashing.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, blendPose } from '../figurine.js';
import { crowd, banner, letterBlock, crayon } from '../props.js';
import { Rhythm, BotTapper } from '../verbs.js';
import { fitRhythm, winFor, helped } from '../sizes.js';
import { Particles } from '../fx.js';
import { sunbeams, bakeStatic } from '../venues.js';
import * as TX from '../textures.js';
import { clamp, lerp, damp, rng, makeNoise2D } from '../util.js';

const FINISH = 300;          // track length (cm of floor)
const LANE = 11;             // lane width
const TARGET = 7.0;          // strides per second for full effort
const VMAX = 34.5;           // top speed at full effort (cm/s)
const ACCEL = 1.75, DECEL = 1.1;
const TRACK_X0 = -40, TRACK_X1 = 360, TRACK_Z = 28;
const ORD = ['1st', '2nd', '3rd', '4th'];
const FS_CHANCE = { easy: 0.03, normal: 0.01, hard: 0.005 };
// the race has three parts: the drive out of the blocks (a calmer rhythm: spinning your legs too fast
// gets you nowhere), top speed, and the last stretch where tired legs need a steady, slightly faster beat
const DRIVE_X = 90, FATIGUE_X = 240;
const DRIVE_TARGET = 0.8, FATIGUE_TARGET = 1.06;
// computer kids: how well they pace the drive (1 = perfectly) and the finish
const BOT_PACE = { easy: { cad: 0.8, drive: 0.25, fatigue: 0.2 }, normal: { cad: 0.93, drive: 0.6, fatigue: 0.6 }, hard: { cad: 0.975, drive: 0.9, fatigue: 0.9 } };
// a good push out of the blocks: speed given for a reaction time
const blockBoost = (reaction) => VMAX * 0.34 * clamp(1 - (reaction - 0.12) / 0.38, 0, 1);

const laneZ = (lane) => (1.5 - lane) * LANE;
const SUN = [0.5, 0.9, -0.5];          // towards the sun: up over the front door, behind the finish
const DOOR = { x: FINISH + 56, w: 58, h: 122 };   // the front door in the hallway wall

// Hurdles extends this class: the hooks it uses are onAction, afterMove, runnerPose, tipFor and botExtra.
export class Sprint {
  constructor(ctx, opt = {}) {
    this.vmax = opt.vmax ?? VMAX;
    this.target = opt.target ?? TARGET;
    this.zones = opt.zones ?? true;     // drive / top speed / last stretch
    this.ctx = ctx;
    this.r = ctx.rand;
    this.phase = 'pre';
    this.t = 0;
    this.camX = 0;
    this.cam = { x: 4, y: 4, z: 0, yaw: 0.3, pitch: 0.4, width: 66 };
    this.excite = 0.1;
    this.runners = [];
    this.history = [];
    this.replay = null;
  }

  // ---------------------------------------------------------------- venue
  async build() {
    const { kit: K, R, competitors } = this.ctx;
    const g = K.group;
    // the hallway on a bright morning: the sun comes in through the glass over the front door
    R.setLighting({
      sunDir: SUN, sunColor: 0xffe1bc, sunIntensity: 2.25,
      hemiSky: 0xfff1de, hemiGround: 0x6a4a33, hemiIntensity: 0.62,
      envIntensity: 0.5, exposure: 1.02, background: 0x2a2019, shadowRadius: 4,
    });
    this.buildFloor(K);
    this.buildTrack(K);
    this.buildStands(K, competitors);
    this.buildWall(K);
    this.buildForeground(K);
    this.buildFinish(K);
    this.particles = new Particles(g, 700);
    this.particles.setScale(R.renderer.domElement.height * 0.9);

    // runners
    const n = competitors.length;
    const first = n >= 4 ? 0 : Math.floor((4 - n) / 2);
    const blocks = [];
    competitors.forEach((c, i) => {
      const fig = new Figurine({ paint: c.paint, seed: c.seed, number: c.number });
      fig.setGear('sprint');
      const lane = first + i;
      const z = laneZ(lane);
      fig.root.position.set(-6, 0, z);
      fig.root.rotation.y = Math.PI / 2;
      g.add(fig.root);
      const run = {
        c, fig, lane, z, x: -6, v: 0, rhythm: fitRhythm(this.makeRhythm(), c), little: c.human && helped(c),
        started: false, tGo: null, reaction: null, finished: false, tFinish: null, time: null,
        anim: 0, effort: 0, effortAnim: 0, runW: 0, stumbleT: 0, cards: 0, heldBack: false, block: false, slipT: 0, zone: 'drive',
        bot: c.human ? null : new BotTapper(c.pad, rng(c.seed * 31 + 7)),
        botCad: this.target * (BOT_PACE[this.ctx.skillName] || BOT_PACE.normal).cad * (0.97 + this.r() * 0.06),
        pose: POSES.stand(0), idle: this.r() * 10, place: null, beat: 0,
      };
      this.runners.push(run);
      // starting blocks: two little toy bricks per lane
      blocks.push({ x: -4.2, y: 0.6, z: z + 0.65, color: c.paint.shirt }, { x: -6.0, y: 0.6, z: z - 0.65, color: c.paint.shirt });
    });
    const brick = new K.RoundedBoxGeometry(1.4, 1.2, 1.1, 2, 0.18);
    K.instances(brick, K.plastic(0xffffff, 0.3), blocks, { colors: true });
    this.buildHud();
    this.applyCamera(1);
  }

  buildFloor(K) {
    const T = K.TX.woodTextures({ size: 1024, planks: 4, base: 0xa87650, dark: 0x6f4a2d, light: 0xc99c6c, seed: 21, ringFreq: 12, roughBase: 0.55, lacquer: 0.3, grainContrast: 0.8 });
    const geo = new THREE.PlaneGeometry(900, 420, 1, 1);
    geo.rotateX(-Math.PI / 2);
    // planks run along the track (x): u across the boards (z), v along them (x)
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getZ(i) / 58, pos.getX(i) / 150);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ ...T, roughness: 0.66, envMapIntensity: 0.35 }));
    m.position.set(160, 0, -40);
    m.receiveShadow = true;
    K.group.add(m);
  }

  // the chalk track: lane lines, start and finish, numbers and doodles drawn into one long texture
  buildTrack(K) {
    const W = 4096, H = 576;
    const sx = W / (TRACK_X1 - TRACK_X0), sz = H / (TRACK_Z * 2);
    const c = K.TX.makeCanvas(W, H), g = c.getContext('2d');
    const r = rng(404);
    const X = (x) => (x - TRACK_X0) * sx, Z = (z) => (z + TRACK_Z) * sz;
    // dusty smears first
    for (let i = 0; i < 260; i++) {
      const x = r() * W, y = r() * H, rad = 20 + r() * 70;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(255,255,255,${0.03 + r() * 0.05})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const chalk = (pts, width = 6, alpha = 0.85) => {
      // several wobbly passes with a grainy edge, like a kid drawing with a stick of chalk
      for (let pass = 0; pass < 3; pass++) {
        g.strokeStyle = `rgba(255,255,255,${alpha * (pass === 0 ? 0.55 : 0.3)})`;
        g.lineWidth = width * (pass === 0 ? 1 : 0.6 + r() * 0.5);
        g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath();
        pts.forEach(([x, y], k) => { const jx = (r() - 0.5) * 2.2, jy = (r() - 0.5) * 2.2; if (k) g.lineTo(x + jx, y + jy); else g.moveTo(x + jx, y + jy); });
        g.stroke();
      }
      // grain: speckles along the stroke
      for (let k = 1; k < pts.length; k++) {
        const [x1, y1] = pts[k - 1], [x2, y2] = pts[k];
        const len = Math.hypot(x2 - x1, y2 - y1);
        for (let d = 0; d < len; d += 3) {
          const t = d / len;
          g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.35})`;
          g.fillRect(x1 + (x2 - x1) * t + (r() - 0.5) * width * 1.8, y1 + (y2 - y1) * t + (r() - 0.5) * width * 1.8, 1.5, 1.5);
        }
      }
    };
    const line = (x1, z1, x2, z2, w, a) => {
      const pts = [], n = Math.max(2, Math.ceil(Math.hypot((x2 - x1) * sx, (z2 - z1) * sz) / 60));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push([X(x1 + (x2 - x1) * t), Z(z1 + (z2 - z1) * t) + Math.sin(i * 1.3 + x1) * 2.5]);
      }
      chalk(pts, w, a);
    };
    // lane lines
    for (let k = 0; k <= 4; k++) line(-14, (k - 2) * LANE, FINISH + 30, (k - 2) * LANE, 7, 0.9);
    // start line and finish line (a chalk chequer at the finish)
    line(0, -2 * LANE, 0, 2 * LANE, 9, 1);
    line(FINISH, -2 * LANE, FINISH, 2 * LANE, 9, 1);
    for (let row = 0; row < 2; row++) {
      for (let k = 0; k < 11; k++) {
        if ((k + row) % 2) continue;
        const z0 = -2 * LANE + (k * 4 * LANE) / 11, z1 = z0 + (4 * LANE) / 11;
        const x0 = FINISH + 1 + row * 2.2;
        for (let h = 0; h < 6; h++) line(x0, z0 + (h + 0.5) * ((z1 - z0) / 6), x0 + 2.2, z0 + (h + 0.5) * ((z1 - z0) / 6), 3, 0.7);
      }
    }
    // words, numbers and doodles
    const text = (s, x, z, size, rot = 0, alpha = 0.85) => {
      g.save(); g.translate(X(x), Z(z)); g.rotate(rot);
      g.font = `${size}px "Lilita One", Impact, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = `rgba(255,255,255,${alpha})`;
      g.fillText(s, 0, 0);
      // chalky: knock little holes out of the letters
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < size * 1.6; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.5})`; g.fillRect((r() - 0.5) * size * s.length * 0.6, (r() - 0.5) * size * 0.8, 2 + r() * 2, 2 + r() * 2); }
      g.restore();
    };
    for (let lane = 0; lane < 4; lane++) text(String(lane + 1), -9, laneZ(lane), 70, -0.05 + r() * 0.1);
    text('START', -14, -2 * LANE - 3.5, 46, 0, 0.8);
    text('FINISH', FINISH + 18, -2 * LANE - 3.6, 54, -0.03, 0.9);
    for (const d of [50, 100, 150, 200, 250]) text(String(d), d, -2 * LANE - 3.4, 34, 0, 0.6);
    for (let lane = 0; lane < 4; lane++) for (const ax of [70, 170, 250]) text('>>', ax + lane * 6, laneZ(lane), 40, 0, 0.35);
    // the sprint's three parts in coloured chalk: smooth out of the blocks, a steady beat, dig in at the end
    if (this.zones) {
      const band = (x0, x1, col, label, sub) => {
        g.save();
        g.fillStyle = col.replace('A', '0.26'); g.fillRect(X(x0), Z(-2 * LANE), X(x1) - X(x0), Z(2 * LANE) - Z(-2 * LANE));
        // hatched chalk across the band, and a bold line at its start
        g.strokeStyle = col.replace('A', '0.45'); g.lineWidth = 5; g.lineCap = 'round';
        for (let z = -2 * LANE; z < 2 * LANE; z += 2.2) { g.beginPath(); g.moveTo(X(x0) + (r() - 0.5) * 3, Z(z)); g.lineTo(X(x0) + 14 + (r() - 0.5) * 3, Z(z + 1.6)); g.stroke(); }
        g.strokeStyle = col.replace('A', '0.9'); g.lineWidth = 12;
        g.beginPath(); for (let k = 0; k <= 12; k++) { const z = -2 * LANE + (k / 12) * 4 * LANE; const xx = X(x0) + Math.sin(k * 1.7) * 2.5; if (k) g.lineTo(xx, Z(z)); else g.moveTo(xx, Z(z)); } g.stroke();
        g.restore();
        g.save(); g.translate(X(x0) + 14, Z(-2 * LANE - 3.6)); g.font = '40px "Lilita One", Impact, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillStyle = col.replace('A', '0.95'); g.fillText(label, 0, 0);
        g.font = '26px Rubik, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillText(sub, 0, 34); g.restore();
      };
      band(4, DRIVE_X, 'rgba(123,228,149,A)', 'SMOOTH', 'out of the blocks: easy steps');
      band(DRIVE_X, FATIGUE_X, 'rgba(255,201,60,A)', 'STEADY', 'top speed: keep the beat');
      band(FATIGUE_X, FINISH, 'rgba(255,138,101,A)', 'DIG IN!', 'a little faster now');
    }
    // doodles: a star, a smiling sun, a heart
    const star = (x, z, R0) => { const pts = []; for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? R0 * 0.45 : R0; pts.push([X(x) + Math.cos(a) * rr, Z(z) + Math.sin(a) * rr]); } chalk(pts, 5, 0.75); };
    star(-28, -12, 26); star(FINISH + 40, 14, 30); star(140, 25, 16);
    const sun = (x, z) => { const cx = X(x), cy = Z(z), pts = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push([cx + Math.cos(a) * 30, cy + Math.sin(a) * 30]); } chalk(pts, 5, 0.7); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; chalk([[cx + Math.cos(a) * 40, cy + Math.sin(a) * 40], [cx + Math.cos(a) * 58, cy + Math.sin(a) * 58]], 5, 0.7); } chalk([[cx - 14, cy + 6], [cx - 6, cy + 14], [cx + 6, cy + 14], [cx + 14, cy + 6]], 4, 0.7); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(cx - 11, cy - 10, 5, 6); g.fillRect(cx + 7, cy - 10, 5, 6); };
    sun(-30, 16); sun(FINISH + 46, -14);
    const heart = (x, z) => { const cx = X(x), cy = Z(z), pts = []; for (let i = 0; i <= 30; i++) { const t = (i / 30) * Math.PI * 2; pts.push([cx + 16 * Math.sin(t) ** 3 * 1.4, cy - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 1.4]); } chalk(pts, 4, 0.7); };
    heart(210, 25.5);
    const tex = K.TX.toTexture(c, { wrap: false });
    tex.anisotropy = 8;
    const geo = new THREE.PlaneGeometry(TRACK_X1 - TRACK_X0, TRACK_Z * 2);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
    m.position.set((TRACK_X0 + TRACK_X1) / 2, 0.03, 0);
    m.receiveShadow = true;
    m.renderOrder = 1;
    K.group.add(m);
    // a few sticks of chalk and the chalk box by the start
    const sticks = [];
    for (let i = 0; i < 7; i++) sticks.push({ x: -24 + i * 1.6 + this.r() * 0.5, y: 0.45, z: 30 + this.r() * 3, ry: this.r() * 3, rz: Math.PI / 2, color: ['#ffffff', '#ffd1dc', '#c9e7ff', '#fff3b0', '#ffffff'][i % 5] });
    K.instances(new THREE.CylinderGeometry(0.45, 0.45, 4.2, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), sticks, { colors: true });
    const box = new THREE.Mesh(new K.RoundedBoxGeometry(11, 2.6, 6, 2, 0.3), K.paint(0x2f6fe0));
    box.position.set(-16, 1.3, 36); box.rotation.y = 0.2; box.castShadow = true; box.receiveShadow = true;
    K.group.add(box);
    K.contact(-16, 36, 7, 4.5, 0.35, 0.2);
  }

  // a shoebox front: its colour, a lid band, the brand and a little shoe
  shoeboxTexture(K, seed, label, body, lid) {
    const c = K.TX.makeCanvas(512, 256), g = c.getContext('2d');
    const r = rng(seed);
    g.fillStyle = body; g.fillRect(0, 0, 512, 256);
    g.fillStyle = lid; g.fillRect(0, 0, 512, 46);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 46, 512, 6);
    const ink = ['#2b2b30', '#a5683a'].includes(body) ? '#f7f2e8' : '#2b2622';
    g.fillStyle = ink; g.font = '58px "Lilita One", Impact, sans-serif'; g.textAlign = 'center';
    g.fillText(label, 300, 172);
    // a trainer in profile
    g.save(); g.translate(92 + r() * 10, 150); g.scale(1.25, 1.25);
    g.fillStyle = lid; g.strokeStyle = ink; g.lineWidth = 4;
    g.beginPath(); g.moveTo(-40, 20); g.lineTo(-40, -6); g.quadraticCurveTo(-36, -24, -18, -24); g.lineTo(-6, -8); g.quadraticCurveTo(24, -6, 40, 8); g.lineTo(40, 20); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = ink; g.fillRect(-42, 16, 84, 6);
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(-22 + k * 7, -18 + k * 3); g.lineTo(-12 + k * 7, -16 + k * 3); g.stroke(); }
    g.restore();
    return K.TX.toTexture(c, { wrap: false });
  }

  buildStands(K, competitors) {
    const g = K.group;
    // the stands: shoeboxes from the hall cupboard, each with its lid on
    const BOXES = [['RUN', '#e9e4da', '#d9472b'], ['KICKS', '#2f6fe0', '#f2c230'], ['SIZE 34', '#f6a33a', '#2b2622'], ['SLIPPERS', '#f2a7c0', '#ffffff'], ['WELLIES', '#2fae5a', '#f7f2e8'], ['ZOOM', '#2b2b30', '#7be495'], ['SANDALS', '#7fd0e6', '#ef7d2c'], ['BOOTS', '#a5683a', '#f2e3c4']];
    const boxMats = BOXES.map(([l, body, lid], i) => {
      const side = new THREE.MeshStandardMaterial({ color: body, roughness: 0.75 });
      return { side, top: new THREE.MeshStandardMaterial({ color: lid, roughness: 0.7 }), front: new THREE.MeshStandardMaterial({ map: this.shoeboxTexture(K, 50 + i, l, body, lid), roughness: 0.75 }) };
    });
    const spots = [];
    const addBox = (x0, x1, z, d, h, mi) => {
      const w = x1 - x0;
      const geo = new THREE.BoxGeometry(w, h, d);
      const bm = boxMats[mi % boxMats.length];
      const m = new THREE.Mesh(geo, [bm.side, bm.side, bm.top, bm.side, bm.front, bm.side]);
      m.position.set((x0 + x1) / 2, h / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      K.contact((x0 + x1) / 2, z, w * 0.56, d * 0.75, 0.35);
      return { x0, x1, h, z };
    };
    const front = [], back = [];
    let x = -90, i = 0;
    while (x < 420) { const w = 46 + this.r() * 22; front.push(addBox(x, x + w, -34, 10, 4.5 + this.r() * 2, i++)); x += w + 3 + this.r() * 4; }
    x = -110;
    while (x < 440) { const w = 52 + this.r() * 26; back.push(addBox(x, x + w, -48, 12, 11 + this.r() * 3.5, i++)); x += w + 2 + this.r() * 4; }
    for (const b of front) {
      for (let k = 0; k < 2; k++) {
        if (this.r() < 0.25) continue;
        spots.push({ x: lerp(b.x0 + 7, b.x1 - 7, k ? 0.8 : 0.2) + (this.r() - 0.5) * 4, y: b.h, z: -34, ry: (this.r() - 0.5) * 0.4, size: 9.5 + this.r() * 2.5 });
      }
    }
    const bannerSpots = [];
    for (const b of back) {
      const nb = 1 + (this.r() < 0.5 ? 1 : 0);
      for (let k = 0; k < nb; k++) {
        const xx = lerp(b.x0 + 10, b.x1 - 10, nb === 1 ? 0.5 : k ? 0.78 : 0.22);
        spots.push({ x: xx, y: b.h, z: -48, ry: (this.r() - 0.5) * 0.4, size: 10 + this.r() * 3 });
      }
      bannerSpots.push({ x: b.x1 - 4, y: b.h });
    }
    this.crowd = crowd(g, spots, 7);
    // the competitors' banners, near the start and the finish
    const codes = competitors.map((c) => c.code);
    const near = bannerSpots.filter((s) => s.x > -60 && s.x < 60).concat(bannerSpots.filter((s) => s.x > FINISH - 70 && s.x < FINISH + 70));
    near.forEach((s, k) => {
      const b = banner(codes[k % codes.length], 13, { seed: k + 1 });
      b.position.set(s.x, s.y, -45);
      b.rotation.y = (this.r() - 0.5) * 0.25;
      g.add(b);
    });
  }

  // the hallway wall behind the stands: striped wallpaper over white panelling, coats on hooks, wellies
  // and trainers along the skirting, a radiator, the kids' drawings, and the front door by the finish
  buildWall(K) {
    const g = new THREE.Group(), ZW = -86;
    K.group.add(g);
    const wc = K.TX.makeCanvas(256, 256), w = wc.getContext('2d');
    w.fillStyle = '#e8eedf'; w.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) { w.fillStyle = '#c9d8bf'; w.fillRect(i * 64 + 8, 0, 22, 256); w.fillStyle = 'rgba(255,255,255,0.5)'; w.fillRect(i * 64 + 40, 0, 4, 256); }
    for (let y = 16; y < 256; y += 48) for (let x = 0; x < 4; x++) { w.fillStyle = 'rgba(178,140,96,0.5)'; w.beginPath(); w.arc(x * 64 + 49, y + (x % 2) * 24, 3.5, 0, Math.PI * 2); w.fill(); }
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1000, 170), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(wc, { repeat: [16, 2.6] }), roughness: 0.95 }));
    wall.position.set(160, 85, ZW); wall.receiveShadow = true; g.add(wall);
    // white panelling up to a dado rail, with raised panels
    const white = K.paint(0xf7f2e8, { roughness: 0.45 });
    const dado = new THREE.Mesh(new THREE.BoxGeometry(1000, 52, 1.2), white); dado.position.set(160, 26, ZW + 0.6); dado.receiveShadow = true; g.add(dado);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1000, 2.6, 2.6), white); rail.position.set(160, 53, ZW + 1.3); rail.castShadow = true; g.add(rail);
    const panels = [];
    for (let x = -330; x < 650; x += 44) { if (Math.abs(x - DOOR.x) < DOOR.w / 2 + 22) continue; panels.push({ x, y: 30, z: ZW + 1.5, sx: 34, sy: 32, sz: 1 }); }
    K.instances(new K.RoundedBoxGeometry(1, 1, 1, 2, 0.15), white, panels, { cast: false });
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(1000, 9, 2.4), white);
    skirt.position.set(160, 4.5, ZW + 2.2); skirt.castShadow = true; skirt.receiveShadow = true; g.add(skirt);
    // the front door: green, four panels, a brass knob, letterbox and number, a glowing fanlight above
    const door = new THREE.Group(); door.position.set(DOOR.x, 0, ZW + 1.4); g.add(door);
    const frame = (bw, bh, bx, by) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 4), white); m.position.set(bx, by, 1); m.castShadow = true; door.add(m); };
    frame(DOOR.w + 12, 6, 0, DOOR.h + 3 + 26); frame(6, DOOR.h + 32, -DOOR.w / 2 - 3, (DOOR.h + 32) / 2); frame(6, DOOR.h + 32, DOOR.w / 2 + 3, (DOOR.h + 32) / 2); frame(DOOR.w, 3, 0, DOOR.h + 1.5);
    const green = K.paint(0x2f6b55, { clearcoat: 0.7 });
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR.w, DOOR.h, 2.4), green); leaf.position.set(0, DOOR.h / 2, 0.4); leaf.castShadow = true; leaf.receiveShadow = true; door.add(leaf);
    for (const [px, py, ph] of [[-13, 92, 40], [13, 92, 40], [-13, 34, 46], [13, 34, 46]]) { const p = new THREE.Mesh(new K.RoundedBoxGeometry(22, ph, 1.6, 2, 0.5), green); p.position.set(px, py, 1.8); door.add(p); }
    const brass = K.metal(0xd8b25e, 0.25);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), brass); knob.position.set(DOOR.w / 2 - 7, 60, 3.4); door.add(knob);
    const slot = new THREE.Mesh(new K.RoundedBoxGeometry(16, 3.6, 1.2, 2, 0.5), brass); slot.position.set(0, 66, 2.8); door.add(slot);
    const nc = K.TX.makeCanvas(64), n2 = nc.getContext('2d'); n2.fillStyle = '#d8b25e'; n2.font = '56px "Lilita One", Impact, sans-serif'; n2.textAlign = 'center'; n2.fillText('7', 32, 54);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(nc, { wrap: false }), transparent: true, metalness: 0.6, roughness: 0.3 })); num.position.set(0, 108, 2.3); door.add(num);
    const fc = K.TX.makeCanvas(256, 128), f2 = fc.getContext('2d');
    const sky = f2.createLinearGradient(0, 0, 0, 128); sky.addColorStop(0, '#9fd6f5'); sky.addColorStop(1, '#fff2d0');
    f2.fillStyle = sky; f2.fillRect(0, 0, 256, 128);
    f2.strokeStyle = '#f7f2e8'; f2.lineWidth = 7; for (let k = 1; k < 5; k++) { const a = Math.PI * (1 - k / 5); f2.beginPath(); f2.moveTo(128, 128); f2.lineTo(128 + Math.cos(a) * 140, 128 - Math.sin(a) * 140); f2.stroke(); }
    const fan = new THREE.Mesh(new THREE.CircleGeometry(DOOR.w / 2, 32, 0, Math.PI), new THREE.MeshBasicMaterial({ map: K.TX.toTexture(fc, { wrap: false }) }));
    fan.position.set(0, DOOR.h + 3, 0.6); door.add(fan);
    const fanRim = new THREE.Mesh(new THREE.TorusGeometry(DOOR.w / 2 + 1.5, 1.6, 8, 32, Math.PI), white); fanRim.position.set(0, DOOR.h + 3, 1); door.add(fanRim);
    this.beams = sunbeams(g, { from: [DOOR.x, DOOR.h + 14, ZW + 3], dir: SUN.map((v) => -v), length: 190, width: 16, n: 3, spread: 15, opacity: 0.11 });
    // a doormat and a welly boot or two by the door
    const mc = K.TX.makeCanvas(256, 128), m2 = mc.getContext('2d');
    m2.fillStyle = '#b5874f'; m2.fillRect(0, 0, 256, 128); m2.strokeStyle = '#6e4a2a'; m2.lineWidth = 10; m2.strokeRect(10, 10, 236, 108);
    m2.fillStyle = '#4a2f1a'; m2.font = '40px "Lilita One", Impact, sans-serif'; m2.textAlign = 'center'; m2.fillText('HELLO', 128, 80);
    const mat = new THREE.Mesh(new K.RoundedBoxGeometry(50, 1.2, 26, 2, 0.5), [0, 1, 2, 3, 4, 5].map((k) => k === 2 ? K.std({ map: K.TX.toTexture(mc, { wrap: false }), roughness: 1 }) : K.std({ color: 0x8a6238, roughness: 1 })));
    mat.position.set(DOOR.x, 0.6, ZW + 18); mat.receiveShadow = true; g.add(mat);
    // coats and a scarf on a row of hooks
    const hookRail = new THREE.Mesh(new K.RoundedBoxGeometry(120, 5, 2.4, 2, 0.8), K.std({ color: 0x9a6a42, roughness: 0.6 })); hookRail.position.set(90, 118, ZW + 1.4); hookRail.castShadow = true; g.add(hookRail);
    const coatM = K.felt(0xffffff, { vertexColors: true });
    const coat = (x, col, len, tilt) => {
      const geo = K.merge([
        { geo: new K.RoundedBoxGeometry(24, len, 7, 3, 3), color: col, pos: [0, -len / 2 - 2, 0] },
        { geo: new K.RoundedBoxGeometry(7, len * 0.75, 6, 3, 2.6), color: col, pos: [-13, -len * 0.42 - 2, 0.6], rot: [0, 0, 0.12] },
        { geo: new K.RoundedBoxGeometry(7, len * 0.75, 6, 3, 2.6), color: col, pos: [13, -len * 0.42 - 2, 0.6], rot: [0, 0, -0.12] },
        { geo: new THREE.SphereGeometry(7, 14, 10).scale(1.1, 0.8, 0.7), color: col, pos: [0, 0, 1.5] },
        { geo: new THREE.CylinderGeometry(0.7, 0.7, 4, 6), color: 0xf2e3c4, pos: [0, -len * 0.3, 3.8], rot: [Math.PI / 2, 0, 0] },
        { geo: new THREE.CylinderGeometry(0.7, 0.7, 4, 6), color: 0xf2e3c4, pos: [0, -len * 0.55, 3.8], rot: [Math.PI / 2, 0, 0] },
      ]);
      const m = new THREE.Mesh(geo, coatM);
      m.position.set(x, 116, ZW + 5); m.rotation.z = tilt; m.castShadow = true; m.receiveShadow = true; g.add(m);
    };
    coat(52, 0xf2c230, 50, 0.04); coat(92, 0x2f4f7a, 58, -0.03); coat(130, 0xd9472b, 46, 0.06);
    const sc = K.TX.makeCanvas(32, 128), s2 = sc.getContext('2d');
    for (let y = 0; y < 128; y += 16) { s2.fillStyle = (y / 16) % 2 ? '#f7f2e8' : '#7a3fb0'; s2.fillRect(0, y, 32, 16); }
    const scarf = new THREE.Mesh(new K.RoundedBoxGeometry(6, 60, 1.6, 2, 0.6), K.felt(0xffffff, { map: K.TX.toTexture(sc, { wrap: false }) }));
    scarf.position.set(72, 88, ZW + 4); scarf.rotation.z = 0.05; scarf.castShadow = true; g.add(scarf);
    // wellies and trainers along the skirting
    const wellyM = K.plastic(0xffffff, 0.35, { vertexColors: true });
    const welly = (x, col, ry) => {
      const geo = K.merge([
        { geo: new THREE.CylinderGeometry(5.6, 5, 24, 20), color: col, pos: [0, 15, 0] },
        { geo: new K.RoundedBoxGeometry(18, 7, 11, 3, 3), color: col, pos: [4, 3.5, 0] },
        { geo: new THREE.CylinderGeometry(5.9, 5.9, 2, 20), color: 0x2b2622, pos: [0, 26.5, 0] },
      ]);
      const m = new THREE.Mesh(geo, wellyM); m.position.set(x, 0, ZW + 12); m.rotation.y = ry; m.castShadow = true; g.add(m);
    };
    welly(40, 0x2fae5a, 0.3); welly(54, 0x2fae5a, 0.1); welly(118, 0xd9472b, -0.2); welly(131, 0xd9472b, 0.05);
    // a radiator under the window-less wall, ribbed and white
    const ribs = [];
    for (let k = 0; k < 16; k++) ribs.push({ x: 196 + k * 3.4, y: 26, z: ZW + 5, sx: 2.6, sy: 34, sz: 5 });
    K.instances(new K.RoundedBoxGeometry(1, 1, 1, 2, 0.3), white, ribs);
    // the kids' drawings, framed now, along the wall
    const kinds = ['sun', 'house', 'runner', 'rainbow', 'cat', 'flower'];
    const r = rng(9), frameMats = [0x2b2622, 0xd8b25e, 0xf7f2e8].map((c) => K.paint(c));
    [-150, -70, 10, 190, 250, 450].forEach((x, i) => {
      const pc = K.TX.makeCanvas(256, 200), p = pc.getContext('2d');
      p.fillStyle = '#fbf8f1'; p.fillRect(0, 0, 256, 200);
      drawCrayon(p, kinds[i % kinds.length], rng(70 + i));
      const y = 86 + r() * 12;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(24, 18.5), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(pc, { wrap: false }), roughness: 0.9 }));
      m.position.set(x, y, ZW + 1.75); m.receiveShadow = true; g.add(m);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(28, 22.5, 1.2), frameMats[i % 3]);
      fr.position.set(x, y, ZW + 1.0); fr.castShadow = true; g.add(fr);
    });
    bakeStatic(g);
  }

  // big toys passing in front (they sit low on screen, blurred by the tilt-shift)
  buildForeground(K) {
    const g = K.group, r = this.r;
    // striped rubber ball
    const bc = K.TX.makeCanvas(256, 128), b = bc.getContext('2d');
    const cols = ['#e23b2e', '#ffffff', '#2f6fe0', '#ffffff', '#f2c230', '#ffffff', '#2fae5a', '#ffffff'];
    cols.forEach((col, i) => { b.fillStyle = col; b.fillRect(i * 32, 0, 32, 128); });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(11, 40, 28), K.plastic(0xffffff, 0.25, { map: K.TX.toTexture(bc, { wrap: true }) }));
    ball.position.set(75, 11, 52); ball.rotation.set(0.3, 0.5, 0.2);
    ball.castShadow = true; ball.receiveShadow = true;
    g.add(ball); K.contact(75, 52, 10, 10, 0.45);
    // a stack of picture books
    const bookCols = [0x3d7bd9, 0xe8c04a, 0xd2553f];
    bookCols.forEach((col, i) => {
      const bk = new THREE.Mesh(new K.RoundedBoxGeometry(26, 2.6, 19, 2, 0.4), K.paint(col, { roughness: 0.6, clearcoat: 0.2 }));
      bk.position.set(170 + i * 1.5, 1.3 + i * 2.6, 44 + (i % 2) * 1.2); bk.rotation.y = 0.15 * (i - 1);
      bk.castShadow = true; bk.receiveShadow = true;
      g.add(bk);
      const pages = new THREE.Mesh(new THREE.BoxGeometry(25, 2.0, 18.2), new THREE.MeshStandardMaterial({ color: 0xf7f2e4, roughness: 0.9 }));
      pages.position.copy(bk.position); pages.position.x += 0.6; pages.rotation.y = bk.rotation.y;
      g.add(pages);
    });
    K.contact(171, 45, 16, 12, 0.4);
    // a xylophone
    const bars = [];
    const xc = ['#e23b2e', '#ef7d2c', '#f2c230', '#2fae5a', '#2f6fe0', '#6b4fc7', '#d84f9a'];
    xc.forEach((col, i) => bars.push({ x: 248 + i * 3.2, y: 3.4, z: 48, sx: 2.6, sy: 0.7, sz: 12 - i * 0.9, color: col }));
    K.instances(new K.RoundedBoxGeometry(1, 1, 1, 2, 0.2), K.paint(0xffffff, { roughness: 0.3, metalness: 0.2 }), bars, { colors: true });
    for (const zz of [43.5, 52.5]) { const rail = new THREE.Mesh(new K.RoundedBoxGeometry(26, 3, 2, 2, 0.5), K.paint(0xd8a25e)); rail.position.set(258, 1.5, zz); rail.castShadow = true; g.add(rail); }
    K.contact(258, 48, 15, 8, 0.4);
    // a little pyramid of letter blocks by the finish
    const lb = [['A', 'B', 'C', 'D', 'E', 'F'], ['G', 'O', 'L', 'D', 'W', 'I'], ['N', 'R', 'U', 'S', 'H', 'Y'], ['F', 'U', 'N', 'J', 'O', 'Y']];
    [[338, 2.8, 42, 0.2], [344.5, 2.8, 43, -0.15], [341, 8.4, 42.6, 0.4], [-48, 2.8, 40, 0.3]].forEach(([x, y, z, ry], i) => {
      const m = letterBlock(lb[i], 5.6, i + 3); m.position.set(x, y, z); m.rotation.y = ry; g.add(m);
    });
    K.contact(341, 42.5, 9, 6, 0.4);
    // a robot vacuum on its rounds, along the front of the hall
    const vac = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 3.4, 32), K.plastic(0x3a3d44, 0.4));
    body.position.y = 1.9; body.castShadow = true; vac.add(body);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 0.5, 32), K.plastic(0x6b7280, 0.25)); top.position.y = 3.7; vac.add(top);
    const bump = new THREE.Mesh(new THREE.TorusGeometry(9, 0.6, 6, 24, Math.PI), K.plastic(0x1f2126, 0.5)); bump.rotation.set(Math.PI / 2, 0, -Math.PI / 2); bump.position.y = 1.8; vac.add(bump);
    this.vacLed = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7be495 })); this.vacLed.position.set(5, 4, 0); vac.add(this.vacLed);
    g.add(vac);
    this.vac = { g: vac, x: -40, dir: 1, turn: 0 };
    // crayons lying about and a sock
    [[120, -30, 0.4], [124, -28, 1.2], [205, 31, 2.4], [-35, -30, 2.0]].forEach(([x, z, ry], i) => { const c = crayon(i * 2 + 1); c.position.set(x, 0.45, z); c.rotation.y = ry; g.add(c); });
    void r;
  }

  // block towers and the red wool finish tape
  buildFinish(K) {
    const g = K.group;
    const zA = 2 * LANE + 4.5;
    const towers = [[['F', 'I', 'N', 'I', 'S', 'H'], ['W', 'O', 'O', 'L', 'Y', 'A'], ['R', 'E', 'D', 'T', 'A', 'P']], [['G', 'O', 'A', 'L', 'Y', 'E'], ['S', 'T', 'O', 'P', 'H', 'I'], ['W', 'I', 'N', 'N', 'E', 'R']]];
    [-1, 1].forEach((side, ti) => {
      for (let k = 0; k < 3; k++) {
        const m = letterBlock(towers[ti][k], 4.4, 11 + ti * 3 + k);
        m.position.set(FINISH + 0.5, 2.2 + k * 4.4, side * zA);
        m.rotation.y = (k - 1) * 0.12 * side;
        g.add(m);
      }
      K.contact(FINISH + 0.5, side * zA, 4, 4, 0.35);
    });
    this.tapeY = 6.2; this.tapeZ = zA - 1.6;
    this.tapeMat = new THREE.MeshStandardMaterial({ color: 0xd9262b, roughness: 0.85 });
    this.tape = new THREE.Mesh(this.tapeGeometry(-this.tapeZ, this.tapeZ, 0, 0), this.tapeMat);
    this.tape.castShadow = true;
    g.add(this.tape);
    this.tapeHalves = null;
  }

  tapeGeometry(z0, z1, push = 0, fall = 0) {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const sag = Math.sin(t * Math.PI) * (0.5 + fall * 0.3);
      const z = lerp(z0, z1, t);
      pts.push(new THREE.Vector3(FINISH + 0.3 + push * t * t, Math.max(0.25, this.tapeY - sag - fall * this.tapeY * t * t), z));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.16, 6, false);
  }

  buildHud() {
    const el = this.ctx.hud.el;
    const style = document.createElement('style');
    style.textContent = `.rm{position:absolute;left:12px;width:min(270px,42vw);background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17;padding:5px 10px 7px;font:800 12px/1.2 Rubik,sans-serif;color:#1f1a17}
      .rm .h{display:flex;align-items:center;gap:6px}.rm img{height:18px;width:27px;object-fit:cover;border-radius:3px;border:2px solid #1f1a17}
      .rm .k{margin-left:auto;font-weight:700;color:#4a413a}.rm .b{position:relative;height:13px;border:2px solid #1f1a17;border-radius:99px;background:#fff;margin-top:4px;overflow:hidden}
      .rm .b i{position:absolute;inset:0 auto 0 0;width:0;background:#ef7d2c;border-radius:99px;transition:background .2s}
      .rm .b u{position:absolute;top:-2px;bottom:-2px;width:3px;background:#1f1a17;left:96.2%}
      .rm .n{position:absolute;right:8px;top:4px;font-size:15px;opacity:0;transition:opacity .05s}.rm .n.on{opacity:1}
      .rm.go .b i{background:#2fae5a}.rm.ok .b i{background:#f2c230}.rm.fast .b i{background:#e23b2e}
      .rm .z{display:flex;gap:3px;margin-top:4px}.rm .z span{flex:1;height:4px;border-radius:2px;background:#e6dccb}.rm .z span.on{background:#1f1a17}`;
    el.appendChild(style);
    this.meters = [];
    const humans = this.runners.filter((ru) => ru.c.human);
    humans.forEach((ru, k) => {
      const d = document.createElement('div');
      d.className = 'rm';
      d.style.bottom = `${(ru.c.type === 'touch' ? 120 : 12) + k * 58}px`;
      const keys = '';
      d.innerHTML = `<div class="h"><img src="${ru.c.flag}" alt=""><span>${ru.c.short}</span><span class="k">${keys}</span></div><div class="b"><i></i><u></u></div><div class="z"><span></span><span></span><span></span></div><span class="n">♪</span>`;
      el.appendChild(d);
      this.meters.push({ ru, d, bar: d.querySelector('.b i'), note: d.querySelector('.n'), tip: d.querySelector('.k'), zones: d.querySelectorAll('.z span'), k: '', tipText: '' });
    });
  }

  // ---------------------------------------------------------------- flow
  attract() { this.phase = 'attract'; }

  start() {
    this.phase = 'walk';
    this.t = 0;
    this.whistleAt = null;
    this.falseStarts = 0;
    this.ctx.sound.setLoop('crowd', 0.35);
    for (const ru of this.runners) ru.c.pad.clear?.();
  }

  makeRhythm() { return new Rhythm({ target: this.target }); }

  // the start call tells humans to hold their action key in the blocks
  marksText() {
    const humans = this.runners.filter((ru) => ru.c.human && !helped(ru.c));
    if (!humans.length) return 'On your marks';
    return `On your marks · hold ${humans.every((ru) => ru.c.type === 'touch') ? '●' : 'action'}`;
  }

  setMessage(text, kind = '', color = '#fff', dur = 0) { this.ctx.hud.message(text, kind, color, dur); }

  // fixed step
  update(dt) {
    const ctx = this.ctx, now = ctx.time();
    this.t += dt;
    const P = this.phase;
    if (P === 'attract' || P === 'pre') { for (let i = 0; i < this.runners.length; i++) ctx.presses(i); return; }

    if (P === 'walk') {
      for (let i = 0; i < this.runners.length; i++) ctx.presses(i);
      if (this.t > 0.6 && !this.marksCalled) { this.marksCalled = true; this.setMessage(this.marksText(), 'small'); ctx.sound.block(false); }
      if (this.t > 1.9) { this.phase = 'marks'; this.t = 0; }
    } else if (P === 'marks') {
      for (let i = 0; i < this.runners.length; i++) ctx.presses(i);
      if (this.t > 1.3) {
        this.phase = 'set'; this.t = 0;
        this.runners.forEach((ru, i) => { ru.block = ru.c.human && ctx.held(i).action; });
        this.setMessage('Set', 'small', '#ffc93c'); ctx.sound.block(true);
        // the whistle never comes at the same moment twice
        this.whistleIn = 1.0 + this.r() * 2.3;
        // computer kids very rarely jump the gun
        for (const ru of this.runners) {
          ru.cpuJump = !ru.c.human && !ru.heldBack && this.r() < (FS_CHANCE[ctx.skillName] ?? 0.01) ? 0.35 + this.r() * (this.whistleIn - 0.45) : null;
        }
      }
    } else if (P === 'set') {
      for (let i = 0; i < this.runners.length; i++) {
        const ru = this.runners[i];
        if (ru.cpuJump != null && this.t >= ru.cpuJump) { ru.cpuJump = null; ru.c.pad.push('left', true, now); ru.c.pad.push('left', false, now + 0.03); }
        const q = ctx.presses(i);
        if (ru.c.human && helped(ru.c)) continue;   // Little players start by themselves
        // holding ACTION in the blocks is fine; letting go of it, or a step, before the whistle is not
        for (const e of q) if (e.b === 'action' && e.down) ru.block = true;
        const jumped = q.some((e) => (e.down && e.b !== 'action') || (!e.down && e.b === 'action' && ru.block));
        if (jumped && !ru.heldBack) { this.falseStart(ru); if (this.phase !== 'set') return; }
      }
      if (this.t >= this.whistleIn) this.go(now);
    } else if (P === 'false') {
      for (let i = 0; i < this.runners.length; i++) ctx.presses(i);
      if (this.t > 2.4) { this.phase = 'marks'; this.t = 0; this.setMessage(this.marksText(), 'small'); ctx.sound.block(false); }
    } else if (P === 'race' || P === 'finishing') {
      this.race(dt, now);
    } else if (P === 'replay') {
      for (let i = 0; i < this.runners.length; i++) ctx.presses(i);
      this.replay.t += dt * this.replay.speed;
      if (this.replay.t >= this.replay.t1) this.endRace();
    } else if (P === 'done') {
      for (let i = 0; i < this.runners.length; i++) ctx.presses(i);
    }
  }

  falseStart(ru) {
    const ctx = this.ctx;
    if (ru.cards >= 1) {
      // second false start for this runner: no restart, they start late
      ru.heldBack = true;
      ctx.hud.flash(`${ru.c.short}: held back!`, '#ffc93c');
      ctx.sound.stumble();
      return;
    }
    ru.cards++;
    this.falseStarts++;
    this.phase = 'false'; this.t = 0;
    this.setMessage(`False start: ${ru.c.short}`, 'small', '#ff8a65');
    ctx.sound.whistle(0.18); setTimeout(() => ctx.sound.whistle(0.18), 220);
    ctx.sound.aww();
    for (const r2 of this.runners) { r2.c.pad.clear?.(); r2.cpuJump = null; r2.block = false; }
  }

  go(now) {
    const ctx = this.ctx;
    this.phase = 'race'; this.t = 0;
    this.whistleAt = now;
    this.setMessage('GO!', 'big', '#ffc93c', 0.9);
    ctx.sound.whistle(0.5);
    for (const ru of this.runners) {
      ru.tGo = now + (ru.heldBack ? 0.5 : 0);
      ru.autoGo = ru.c.human && helped(ru.c) ? ru.tGo + 0.3 : null;
      if (ru.bot) {
        const [a, b] = ctx.skill.react;
        ru.botGo = ru.tGo + a + this.r() * (b - a);
        ru.bot.start(ru.botGo);
      }
    }
    this.history = [];
  }

  race(dt, now) {
    const ctx = this.ctx;
    let leader = null;
    for (let i = 0; i < this.runners.length; i++) {
      const ru = this.runners[i];
      // which part of the race this runner is in
      const zone0 = ru.zone;
      ru.zone = !this.zones ? 'top' : ru.x < DRIVE_X ? 'drive' : ru.x < FATIGUE_X ? 'top' : 'tired';
      if (ru.c.human && ru.zone !== zone0 && ru.started && this.zones) ctx.hud.flash(`${ru.c.short}: ${ru.zone === 'top' ? 'steady beat now' : 'dig in: a bit faster!'}`, ru.zone === 'top' ? '#ffc93c' : '#ff8a65');
      ru.rhythm.target = this.target * (ru.zone === 'drive' ? DRIVE_TARGET : ru.zone === 'tired' ? FATIGUE_TARGET : 1);
      if (ru.bot && !ru.finished) {
        const pace = BOT_PACE[ctx.skillName] || BOT_PACE.normal;
        const f = ru.zone === 'drive' ? 1 + (DRIVE_TARGET - 1) * pace.drive : ru.zone === 'tired' ? 1 + (FATIGUE_TARGET - 1) * pace.fatigue : 1;
        ru.bot.update(now, ru.botCad * f, ctx.skill.jitter, ctx.skill.stumble);
        if (!ru.started && ru.botGo != null && now >= ru.botGo) { ru.started = true; ru.reaction = ru.botGo - this.whistleAt; ru.startT = ru.botGo; ru.v = blockBoost(ru.reaction) * this.vmax / VMAX; }
        this.botExtra?.(ru, now);
      }
      if (ru.c.human && !ru.finished) this.assist(ru, now);
      for (const e0 of ctx.presses(i)) {
        // for Little players every button is a step (they start, and in the hurdles jump, by themselves)
        const e = ru.little && ru.started && e0.b === 'action' ? { ...e0, b: 'left' } : e0;
        if (e.t < ru.tGo) continue; // held back runners wait their half second
        // letting go of ACTION in the blocks is the push-off
        if (e.b === 'action') {
          if (!e.down && ru.block && !ru.started) {
            ru.started = true; ru.reaction = e.t - this.whistleAt; ru.startT = e.t; ru.v = blockBoost(ru.reaction);
            ctx.sound.step(1, this.pan(ru.x));
            ru.v *= this.vmax / VMAX;
            if (ru.c.human && ru.reaction < 0.2) ctx.hud.flash(`${ru.c.short}: flying start!`, '#7be495');
          }
          else if (e.down && ru.started && !ru.finished) this.onAction?.(ru, e.t);
          continue;
        }
        if (!e.down) continue;
        if (ru.finished && ru.v < 4) continue;
        const res = ru.rhythm.press(e.b, e.t);
        if (!ru.started) { ru.started = true; ru.reaction = e.t - this.whistleAt; ru.startT = e.t; ru.block = false; }
        if (res === 'stumble') {
          ru.v *= 0.85; ru.stumbleT = 0.35;
          ctx.sound.stumble(this.pan(ru.x));
        } else {
          ru.beat = 0.12;
          ctx.sound.step(ru.c.human ? 0.9 : 0.45, this.pan(ru.x));
          this.particles.emit(ru.x - 1, 0.3, ru.z + (e.b === 'left' ? 0.5 : -0.5), { vx: -6, spread: 3, up: 2.5, color: 0xf6f1e8, size: 1.1, life: 0.55, alpha: 0.28, grav: 3, grow: 1.6, n: 2 });
        }
      }
      // speed
      let eff = ru.started ? ru.rhythm.effort(now) : 0;
      if (ru.started && !ru.finished) {
        const x = ru.rhythm.ratio(now), sl = winFor(ru.c, 0.15);
        // the drive: legs spinning too fast slip on the floorboards (a smaller player has more room)
        if (ru.zone === 'drive' && x > 1 + sl) {
          eff *= Math.max(0.72, 1 - (x - 1 - sl) * 0.7);
          if (x > 1 + 2 * sl && ru.slipT <= 0) { ru.slipT = 0.6; ru.v *= 0.93; ru.stumbleT = 0.25; ctx.sound.stumble(this.pan(ru.x)); }
        }
        // tired legs: an uneven beat costs more
        if (ru.zone === 'tired') eff *= 1 - clamp((ru.rhythm.unsteadiness() - ru.rhythm.slack + 0.06) * 0.8, 0, 0.18);
        if (this.tuneEffort) eff = this.tuneEffort(ru, x, eff);
        ru.over = x;
      }
      if (ru.slipT > 0) ru.slipT -= dt;
      if (ru.walkHome) eff = Math.max(eff, ru.walkHome);
      ru.effort = eff;
      if (ru.downT > 0) { ru.downT -= dt; eff = 0; }
      const target = ru.finished ? 0 : this.vmax * eff;
      const k = target > ru.v ? ACCEL : (ru.finished ? 1.4 : DECEL);
      ru.v += (target - ru.v) * (1 - Math.exp(-k * dt));
      if (ru.stumbleT > 0) ru.stumbleT -= dt;
      const x0 = ru.x;
      ru.x += ru.v * dt;
      this.afterMove?.(ru, x0, now, dt);
      if (!ru.finished && x0 < FINISH && ru.x >= FINISH) {
        const tc = now - dt + ((FINISH - x0) / Math.max(1e-6, ru.x - x0)) * dt;
        this.finishRunner(ru, tc);
      }
      if (ru.finished && ru.x > FINISH + 46) ru.v = Math.min(ru.v, 2);
      if (!leader || ru.x > leader.x) leader = ru;
    }
    this.leader = leader;
    // history for the replay (last 5 s)
    this.history.push({ t: now, s: this.runners.map((ru) => [ru.x, ru.anim, ru.effortAnim, ru.runW, ru.stumbleT, ru.y || 0, ru.jumpU || 0, ru.downT || 0]) });
    while (this.history.length > 600) this.history.shift();
    // crowd excitement builds as the leader nears the line
    const lx = leader ? leader.x : 0;
    this.excite = Math.max(this.excite * Math.exp(-0.4 * dt), clamp((lx - 120) / 180, 0.12, 1));
    // when is it over?
    // everyone gets home: the race waits for the players (their legs take over after a while)
    const done = this.runners.every((ru) => ru.finished);
    const waiting = this.runners.some((ru) => ru.c.human && !ru.finished);
    if (done || now - this.whistleAt > 90) this.startReplay(now);
    else if (!waiting && (this.firstFinish != null ? now - this.firstFinish > 8 : now - this.whistleAt > 30)) this.startReplay(now);
  }

  // Little players start by themselves; anyone still out there a while after the winner jogs home
  assist(ru, now) {
    if (!ru.started && ru.autoGo != null && now >= ru.autoGo) {
      ru.started = true; ru.reaction = ru.autoGo - this.whistleAt; ru.startT = ru.autoGo; ru.block = false;
      ru.v = blockBoost(ru.reaction) * this.vmax / VMAX;
    }
    const late = this.firstFinish != null ? now - this.firstFinish - 5 : now - this.whistleAt - 25;
    ru.walkHome = late > 0 ? Math.min(0.8, 0.35 + late * 0.08) : 0;
    if (ru.walkHome && !ru.started) { ru.started = true; ru.startT = now; ru.block = false; ru.jogged = true; }
    if (ru.walkHome) ru.jogged = true;
  }

  finishRunner(ru, tc) {
    const ctx = this.ctx;
    ru.finished = true;
    ru.tFinish = tc;
    ru.time = tc - this.whistleAt;
    const place = this.runners.filter((o) => o.finished).length - 1;
    ru.place = place;
    if (place === 0) {
      this.firstFinish = tc;
      this.breakTape(ru);
      ctx.sound.cheer(1);
      this.phase = 'finishing';
    }
    if (ru.c.human || place === 0) ctx.hud.flash(`${ru.c.short} ${ru.time.toFixed(2)} s`, place === 0 ? '#ffc93c' : '#ffffff');
  }

  breakTape(ru) {
    this.tape.visible = false;
    const K = this.ctx.kit;
    this.tapeHalves = [new THREE.Mesh(this.tapeGeometry(-this.tapeZ, ru.z), this.tapeMat), new THREE.Mesh(this.tapeGeometry(this.tapeZ, ru.z), this.tapeMat)];
    for (const h of this.tapeHalves) { h.castShadow = true; K.group.add(h); }
    this.tapeBreakZ = ru.z;
    this.tapeT = 0;
  }

  startReplay(now) {
    const fin = this.runners.filter((ru) => ru.finished).sort((a, b) => a.tFinish - b.tFinish);
    for (const ru of this.runners) ru.bot?.stop?.();
    if (!fin.length || this.history.length < 10) { this.endRace(); return; }
    const t0 = fin[0].tFinish - 0.65;
    const t1 = (fin[1] ? Math.min(fin[1].tFinish, fin[0].tFinish + 0.6) : fin[0].tFinish) + 0.3;
    const close = fin[1] && fin[1].tFinish - fin[0].tFinish < 0.05;
    this.replay = { t: Math.max(t0, this.history[0].t), t0, t1: Math.min(t1, this.history[this.history.length - 1].t), speed: 0.35, close };
    this.phase = 'replay';
    this.setMessage(close ? 'Photo finish!' : 'Replay', 'small', close ? '#ffc93c' : '#fff');
    void now;
  }

  endRace() {
    const ctx = this.ctx;
    this.phase = 'done'; this.t = 0;
    this.setMessage('');
    ctx.sound.setLoop('crowd', 0.3);
    const results = this.runners.map((ru) => {
      if (!ru.finished) return { value: null, dnf: true, text: 'Didn\'t finish', sub: ru.reaction != null ? `reaction ${ru.reaction.toFixed(2)} s` : 'never got going' };
      const notes = [];
      if (ru.reaction != null) notes.push(`reaction ${ru.reaction.toFixed(2)} s`);
      if (ru.cards) notes.push(ru.heldBack ? 'held back after two false starts' : '1 false start');
      if (ru.jogged) notes.push('jogged home');
      const more = this.resultNote?.(ru);
      if (more) notes.push(more);
      return { value: ru.time, text: `${ru.time.toFixed(2)} s`, short: `${ru.time.toFixed(2)} s`, sub: notes.join(' · ') };
    });
    ctx.finish(results);
  }

  pan(x) { return clamp((x - this.camX) / 50, -0.8, 0.8); }

  // ---------------------------------------------------------------- per frame
  frame(dt, paused) {
    const ctx = this.ctx;
    const tt = ctx.time();
    if (!paused) {
      this.particles.update(dt);
      this.beams.update(tt);
      // the robot vacuum potters along the front of the hall and turns round at each end
      const v = this.vac;
      if (v.turn > 0) { v.turn -= dt; v.g.rotation.y += (v.dir > 0 ? -1 : 1) * Math.PI * dt; if (v.turn <= 0) v.g.rotation.y = v.dir > 0 ? 0 : Math.PI; }
      else { v.x += v.dir * 11 * dt; if (v.x > 410 || v.x < -60) { v.dir *= -1; v.turn = 1; } }
      v.g.position.set(v.x, 0, 66 + Math.sin(v.x * 0.03) * 4);
      this.vacLed.visible = Math.sin(tt * 4) > -0.3;
    }
    const replaying = this.phase === 'replay' && this.replay;
    let snap = null;
    if (replaying) snap = this.sample(this.replay.t);
    this.runners.forEach((ru, i) => {
      let pose;
      const P = this.phase;
      if (P === 'attract' || P === 'pre') {
        ru.fig.root.position.set(-8 - (i % 2) * 3, 0, ru.z);
        const kind = (i + Math.floor((tt + ru.idle) / 4)) % 4;
        pose = kind === 0 ? POSES.bounce(tt + ru.idle) : kind === 1 ? POSES.wave(tt + ru.idle) : kind === 2 ? POSES.stand(tt + ru.idle) : POSES.run((tt * 1.6 + ru.idle) % 1, 0.25);
        ru.fig.root.rotation.y = Math.PI / 2 + (kind === 1 ? 0.9 : 0.3 * Math.sin(tt * 0.5 + i));
        ru.fig.setExpression('happy');
      } else if (P === 'walk') {
        const k = clamp(this.t / 1.6, 0, 1);
        ru.fig.root.position.set(lerp(-14, -5.2, k), 0, ru.z);
        ru.fig.root.rotation.y = Math.PI / 2;
        pose = k < 1 ? blendPose(POSES.walk((this.t * 1.4 + i * 0.3) % 1), POSES.crouch(0), clamp((k - 0.75) * 4, 0, 1)) : POSES.crouch(0);
        ru.fig.setExpression('focus');
      } else if (P === 'marks' || P === 'set' || P === 'false') {
        ru.fig.root.position.set(-5.2, 0, ru.z);
        ru.fig.root.rotation.y = Math.PI / 2;
        if (P === 'false') pose = blendPose(POSES.crouch(1), POSES.stand(tt), clamp(this.t * 2, 0, 1));
        else if (P === 'set') pose = POSES.crouch(clamp(this.t / 0.45, 0, 1));
        else pose = POSES.crouch(0);
        ru.fig.setExpression(P === 'false' ? 'wow' : 'focus');
      } else {
        // racing, finishing, replay, done
        let x = ru.x, anim, effA, runW, stumble, y = ru.y || 0, jumpU = ru.jumpU || 0, down = ru.downT || 0;
        if (snap) { [x, anim, effA, runW, stumble, y, jumpU, down] = snap[i]; }
        else {
          if (!paused) {
            const cad = ru.started ? Math.min(9, ru.rhythm.cadence(tt)) : 0;
            const moving = ru.v > 1.5;
            ru.anim = (ru.anim + (moving ? Math.max(cad, ru.v / 6) : 0) * 0.5 * dt) % 1;
            ru.effortAnim = damp(ru.effortAnim, clamp(ru.v / this.vmax, 0, 1.1), 6, dt);
            ru.runW = ru.started ? clamp(ru.runW + dt * 3, 0, 1) : 0;
            ru.beat = Math.max(0, ru.beat - dt);
          }
          anim = ru.anim; effA = ru.effortAnim; runW = ru.runW; stumble = ru.stumbleT;
        }
        ru.fig.root.position.set(x, y, ru.z);
        ru.fig.root.rotation.y = Math.PI / 2;
        if (this.phase === 'done' && ru.finished && ru.v < 3) {
          const w = this.t + ru.idle;
          pose = ru.place === 0 ? POSES.cheer(w) : ru.place === 1 ? POSES.wave(w) : POSES.stand(w);
          ru.fig.root.rotation.y = Math.PI / 2 + Math.min(1.2, this.t * 1.5) * 0.9;
          ru.fig.setExpression(ru.place === 0 ? 'wow' : 'happy');
        } else {
          const runPose = POSES.run(anim, Math.max(0.25, effA));
          pose = blendPose(POSES.crouch(1), runPose, runW);
          if (stumble > 0) pose = blendPose(pose, { ...runPose, lean: 0.95, head: 0.5, shL: 1.6, shR: 1.4, abL: 0.9, abR: 0.9 }, clamp(stumble / 0.35, 0, 1) * 0.8);
          if (ru.finished && ru.v < 8 && !snap) pose = blendPose(pose, POSES.walk((tt * 0.9) % 1), clamp((8 - ru.v) / 6, 0, 1));
          ru.fig.setExpression(ru.finished && !snap ? (ru.place === 0 ? 'wow' : 'happy') : 'focus');
          if (this.runnerPose) pose = this.runnerPose(ru, pose, jumpU, down, tt);
        }
      }
      ru.pose = pose;
      ru.fig.setPose(pose);
    });
    this.animateTape(dt, paused);
    this.crowd.update(tt, this.phase === 'attract' ? 0.1 : this.phase === 'done' ? 0.55 : this.excite);
    if (!paused) ctx.sound.setLoop('crowd', this.phase === 'attract' ? 0.12 : 0.22 + this.excite * 0.55);
    this.updateHud(tt);
    this.applyCamera(dt, snap);
  }

  sample(t) {
    const H = this.history;
    let k = 1;
    while (k < H.length - 1 && H[k].t < t) k++;
    const a = H[k - 1], b = H[k];
    const f = clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1);
    return a.s.map((sa, i) => sa.map((v, j) => (j === 1 && Math.abs(b.s[i][j] - v) > 0.5 ? b.s[i][j] : lerp(v, b.s[i][j], f))));
  }

  animateTape(dt, paused) {
    if (!this.tapeHalves || paused) return;
    if (this.tapeT > 1.4) return;
    this.tapeT += dt;
    const k = clamp(this.tapeT / 1.1, 0, 1);
    const ease = 1 - (1 - k) * (1 - k);
    const z = this.tapeBreakZ;
    const halves = [[-this.tapeZ, lerp(z, z - 6, ease)], [this.tapeZ, lerp(z, z + 6, ease)]];
    this.tapeHalves.forEach((h, i) => { h.geometry.dispose(); h.geometry = this.tapeGeometry(halves[i][0], halves[i][1], ease * 9, ease); });
  }

  updateHud(t) {
    const ctx = this.ctx;
    const order = [...this.runners].sort((a, b) => (b.finished - a.finished) || (a.finished && b.finished ? a.tFinish - b.tFinish : b.x - a.x));
    this.runners.forEach((ru, i) => {
      let info = '', cls = '';
      if (ru.cards) info = '🟨 ';
      if (this.phase === 'race' || this.phase === 'finishing' || this.phase === 'replay' || this.phase === 'done') {
        info += ru.finished ? `${ORD[ru.place]} · ${ru.time.toFixed(2)}` : ru.heldBack && t < ru.tGo ? 'held back' : ORD[order.indexOf(ru)];
        cls = ru.finished && ru.place === 0 ? 'active' : '';
      } else if (ru.heldBack) { info += 'held back'; cls = 'dim'; }
      ctx.hud.chip(i, info.trim(), cls);
    });
    for (const m of this.meters) {
      const e = m.ru.started && !m.ru.finished ? clamp(m.ru.effort / 1.04, 0, 1) : 0;
      m.bar.style.width = `${(e * 100).toFixed(1)}%`;
      const ru = m.ru, fast = ru.started && ru.zone === 'drive' && ru.over > 1 + winFor(ru.c, 0.15);
      const k = fast ? 'rm fast' : e >= 0.92 ? 'rm go' : e >= 0.7 ? 'rm ok' : 'rm';
      if (k !== m.k) { m.d.className = k; m.k = k; }
      const touch = ru.c.type === 'touch';
      const ph = this.phase;
      const tip = ph === 'walk' || ph === 'marks' || ph === 'false' ? `hold ${touch ? '●' : 'action'} in the blocks`
        : ph === 'set' ? (ru.block ? 'let go on GO!' : `hold ${touch ? '●' : 'action'}!`)
          : !ru.started ? (ru.block ? 'let go!' : `${touch ? '◀ ▶' : 'left, right'}…`)
            : ru.finished ? '' : (this.tipFor?.(ru) ?? (ru.zone === 'drive' ? (fast ? 'easy! smooth steps' : 'drive: smooth steps') : ru.zone === 'top' ? 'top speed: keep the beat' : 'dig in: a bit faster!'));
      void tip;
      const zi = ru.zone === 'drive' ? 0 : ru.zone === 'top' ? 1 : 2;
      m.zones.forEach((z, n) => z.classList.toggle('on', ru.started && n <= zi));
      m.note.classList.toggle('on', m.ru.beat > 0);
      m.d.style.opacity = this.phase === 'attract' || this.phase === 'done' || this.phase === 'replay' ? '0' : '1';
    }
  }

  applyCamera(dt, snap = null) {
    const R = this.ctx.R, c = this.cam;
    const P = this.phase, tt = this.ctx.time();
    let want;
    if (P === 'attract' || P === 'pre') {
      want = { x: -2 + Math.sin(tt * 0.12) * 10, y: 4, z: 0, yaw: 0.42 + Math.sin(tt * 0.09) * 0.22, pitch: 0.34, width: 72 };
    } else if (P === 'walk' || P === 'marks' || P === 'set' || P === 'false') {
      want = { x: 2, y: 3.5, z: 0, yaw: 0.3 - (P === 'set' ? 0.08 : 0), pitch: 0.42, width: P === 'set' ? 58 : 64 };
    } else if (P === 'replay' && snap) {
      // low and close at the finish line, looking across the lanes
      want = { x: FINISH + 2, y: 3.5, z: -2, yaw: 0.12, pitch: 0.2, width: 54 };
    } else if (P === 'done') {
      want = { x: FINISH + 24, y: 4, z: 0, yaw: 0.25 + Math.sin(tt * 0.2) * 0.1, pitch: 0.36, width: 76 };
    } else {
      // follow the human runners (all of them if several), and take the leader in when close
      const humans = this.runners.filter((ru) => ru.c.human && !(ru.finished && ru.x > FINISH + 30));
      const focus = humans.length ? humans : this.leader ? [this.leader] : [];
      let lo = Math.min(...focus.map((ru) => ru.x)), hi = Math.max(...focus.map((ru) => ru.x));
      if (!focus.length) { lo = 0; hi = 0; }
      if (this.leader && this.leader.x > hi && this.leader.x - lo < 52) hi = this.leader.x;
      const width = clamp(hi - lo + 64, 76, 130);
      const cx = Math.min((lo + hi) / 2 + 8, FINISH + 4);
      want = { x: Math.max(cx, 14), y: 4, z: 0, yaw: 0, pitch: 0.58, width };
    }
    const fast = P === 'replay' ? 30 : P === 'race' || P === 'finishing' ? 4 : 1.6;
    for (const k of Object.keys(want)) c[k] = dt >= 1 ? want[k] : damp(c[k], want[k], fast, Math.min(dt, 0.1));
    this.camX = c.x;
    R.orbit(c.x, c.y, c.z, { yaw: c.yaw, pitch: c.pitch, width: c.width, shadowSpan: c.width * 2.2 });
    R.setFocus(0.48, P === 'race' || P === 'finishing' ? 0.24 : 0.2, 0.9);
  }

  // ---------------------------------------------------------------- cinematics
  get room() { return 'The front hall, on a sunny morning'; }
  flyIn() {
    return [
      { x: DOOR.x, y: 92, z: -60, yaw: 0.55, pitch: 0.02, width: 120 },
      { x: 200, y: 70, z: -60, yaw: 0.15, pitch: 0.12, width: 260 },
      { x: 60, y: 12, z: 0, yaw: 0.4, pitch: 0.32, width: 150 },
    ];
  }
  // just past the finish line, the shoebox stands and the front door behind
  ceremonySpot() { return { x: FINISH + 32, y: 0.4, z: 4, style: 'shoebox', gear: 'sprint', yaw: -0.3, pitch: 0.13, width: 50 }; }

  dispose() {
    for (const ru of this.runners) ru.fig.dispose();
    if (this.tapeHalves) for (const h of this.tapeHalves) h.geometry.dispose();
  }
}

// crayon pictures for the wall
function drawCrayon(p, kind, r) {
  const scribble = (col, pts, w = 5) => {
    p.strokeStyle = col; p.lineCap = 'round'; p.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      p.lineWidth = w * (pass ? 0.6 : 1); p.globalAlpha = pass ? 0.5 : 0.85;
      p.beginPath(); pts.forEach(([x, y], i) => (i ? p.lineTo(x + (r() - 0.5) * 2, y + (r() - 0.5) * 2) : p.moveTo(x, y))); p.stroke();
    }
    p.globalAlpha = 1;
  };
  const circle = (cx, cy, rad, n = 24) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rad, cy + Math.sin((i / n) * Math.PI * 2) * rad]);
  const fill = (col, cx, cy, rad) => { for (let i = 0; i < 18; i++) scribble(col, [[cx - rad + r() * rad * 2, cy - rad * 0.8 + i * rad / 10], [cx - rad + r() * rad * 2, cy - rad * 0.8 + i * rad / 10 + 3]], 4); };
  if (kind === 'sun') {
    fill('#f7c531', 128, 95, 30); scribble('#f0a020', circle(128, 95, 32));
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; scribble('#f0a020', [[128 + Math.cos(a) * 42, 95 + Math.sin(a) * 42], [128 + Math.cos(a) * 64, 95 + Math.sin(a) * 64]]); }
  } else if (kind === 'house') {
    fill('#e85d4a', 128, 120, 42); scribble('#b33a2a', [[86, 160], [86, 100], [170, 100], [170, 160], [86, 160]]);
    scribble('#6b4fc7', [[78, 102], [128, 52], [178, 102]], 6); scribble('#3a7bd5', [[110, 160], [110, 130], [130, 130], [130, 160]]);
    scribble('#2fae5a', [[20, 172], [236, 172]], 7);
  } else if (kind === 'runner') {
    scribble('#2f6fe0', circle(90, 60, 14)); scribble('#2f6fe0', [[90, 74], [100, 118], [80, 160]]); scribble('#2f6fe0', [[100, 118], [128, 150]]); scribble('#2f6fe0', [[94, 90], [70, 108]]); scribble('#2f6fe0', [[94, 90], [124, 80]]);
    scribble('#e23b2e', [[150, 40], [150, 170]], 6); scribble('#2fae5a', [[20, 172], [236, 172]], 6);
    for (let i = 0; i < 3; i++) scribble('#f2c230', [[30, 70 + i * 22], [56, 70 + i * 22]]);
  } else if (kind === 'rainbow') {
    ['#e23b2e', '#ef7d2c', '#f2c230', '#2fae5a', '#2f6fe0', '#6b4fc7'].forEach((col, i) => scribble(col, Array.from({ length: 21 }, (_, k) => { const a = Math.PI + (k / 20) * Math.PI; return [128 + Math.cos(a) * (96 - i * 9), 168 + Math.sin(a) * (96 - i * 9)]; }), 8));
  } else if (kind === 'cat') {
    fill('#ef9a3c', 128, 120, 34); scribble('#b8621f', circle(128, 120, 36)); scribble('#b8621f', [[100, 92], [104, 64], [118, 86]]); scribble('#b8621f', [[138, 86], [152, 64], [156, 92]]);
    p.fillStyle = '#1f1a17'; p.fillRect(114, 110, 6, 8); p.fillRect(136, 110, 6, 8);
    scribble('#1f1a17', [[118, 132], [128, 138], [138, 132]], 3); scribble('#b8621f', [[164, 140], [200, 120], [206, 96]], 7);
  } else {
    scribble('#2fae5a', [[128, 175], [128, 90]], 6);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; fill(['#e36aa0', '#f2c230'][i % 2], 128 + Math.cos(a) * 22, 70 + Math.sin(a) * 22, 12); }
    fill('#f7c531', 128, 70, 10);
  }
}

export default {
  id: 'sprint', name: 'Sprint', season: 'Summer',
  blurb: 'Four lanes chalked on the playroom floor: react to the whistle, then run with a steady rhythm.',
  venue: 'The front hall: four lanes chalked along the floorboards towards the front door, finishing at a red wool tape.',
  loading: 'Chalking the lanes…',
  how: [
    { verb: 'Timing', text: 'In the blocks, hold <b>action</b>. Let go the moment the <b>whistle</b> blows for a flying start: letting go after <b>Set</b> is a false start.' },
    { verb: 'Rhythm', text: 'Tap <b>left</b> and <b>right</b> in turn to run. Out of the blocks, smooth steps: legs spinning too fast slip. Then a steady, quick beat, and dig in a little faster for the last stretch.' },
  ],
  helpers: {
    little: 'You start by yourself on the whistle. Then tap <b>any button</b> on a slow, steady beat: the bar goes green.',
    kid: 'Your beat is slower than a grown-up\'s, and you can go a bit wild out of the blocks before you slip.',
  },
  better: 'lower',
  resultsDelay: 0.9,
  create: (ctx) => new Sprint(ctx),
};
