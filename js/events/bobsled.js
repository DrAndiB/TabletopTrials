// Bobsled: down a run of poster tubes cut in half, from the top of the toy chest to the floor.
// Tap LEFT/RIGHT in turn to push the sled off, tap ACTION to jump in before the push zone ends, then
// hold LEFT/RIGHT to keep the sled on the red line through the bends (left alone it swings up too
// high). Two runs, the times add up; the second run goes in reverse order of the standings (the
// leader last). Yellow timing lines on the way down give split times against the leader.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, REST } from '../figurine.js';
import { crowd, banner, floorMaterial } from '../props.js';
import { Rhythm, BotTapper } from '../verbs.js';
import { Particles } from '../fx.js';
import { clamp, damp, rng, makeNoise2D } from '../util.js';
import { hudKit, Card, Guide, Tags, Skipper, beatGauge, fmtTime } from './common.js';
import { fitRhythm, winFor, helped } from '../sizes.js';
import { buildTrack, stepSled, autoSteer, phiStar, RT, PUSH } from './bobsled-track.js';
import { sunPatch, sunbeams, FairyLights } from '../venues.js';

const RUNS = 2;
const SPLITS = [0.3, 0.55, 0.8];      // timing lines, as a share of the way from the end of the push to the finish
const ORD = ['1st', '2nd', '3rd', '4th'];
const BEAM = 6;                        // the clock starts here
const JUMP_ZONE = 6;                   // the green stripe at the end of the push: jump in here
const INTRO_T = 7;                     // the camera flies down the course before the first run
const TARGET = 6.0, VPUSH = 17;
const BSUN = [0.25, 1, -0.35];          // towards the skylight, high in the roof        // push cadence, top push speed
const LANE = 1.4;                      // half the width of a sled
// computer drivers: push cadence share, where they jump in (units before the end of the push), steering deadband and delay
const BOT = {
  easy: { cad: 0.84, jump: [5, 4], dead: 0.15, delay: 0.32 },
  normal: { cad: 0.94, jump: [4, 2.5], dead: 0.1, delay: 0.2 },
  hard: { cad: 1.0, jump: [3.5, 1.2], dead: 0.06, delay: 0.1 },
};
const UP = new THREE.Vector3(0, 1, 0);

class Bobsled {
  constructor(ctx) {
    this.ctx = ctx;
    this.r = ctx.rand;
    this.phase = 'pre';
    this.t = 0;
    this.track = buildTrack();
    this.crews = [];
    this.turn = -1;
    this.run = 1;
    this.camPos = new THREE.Vector3(); this.camTgt = new THREE.Vector3();
    this.tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), m: new THREE.Matrix4() };
  }

  // the tube frame at s: axis point, forward, right, up (perpendicular to the track)
  frameAt(s, out = {}) {
    const tr = this.track, p = tr.at(s), q = tr.at(s + 0.5), o = tr.at(s - 0.5);
    out.c = (out.c || new THREE.Vector3()).set(p.x, p.y, p.z);
    out.t = (out.t || new THREE.Vector3()).set(q.x - o.x, q.y - o.y, q.z - o.z).normalize();
    out.r = (out.r || new THREE.Vector3()).crossVectors(out.t, UP).normalize();
    out.u = (out.u || new THREE.Vector3()).crossVectors(out.r, out.t).normalize();
    return out;
  }

  async build() {
    const { kit: K, R, competitors } = this.ctx;
    // the attic on a snowy day: cold white light down through the skylight, string lights glowing
    R.setLighting({
      sunDir: BSUN, sunColor: 0xe6eeff, sunIntensity: 2.1,
      hemiSky: 0xc8d2ea, hemiGround: 0x5a4430, hemiIntensity: 0.58,
      envIntensity: 0.5, exposure: 0.98, background: 0x1e1a18, shadowRadius: 4,
    });
    this.noise = makeNoise2D(91);
    // a perfect run gives the speed the red line is drawn for
    this.nominal = this.simulate((sl) => autoSteer(sl, 0.03));
    this.buildRoom(K);
    this.buildTube(K);
    this.buildSupports(K);
    this.buildFinish(K, competitors);
    this.particles = new Particles(K.group, 600);
    this.particles.setScale(R.renderer.domElement.height * 0.9);
    const ff = this.frameAt(this.track.finishS + 40);
    competitors.forEach((c, i) => {
      const fig = new Figurine({ paint: c.paint, seed: c.seed, number: c.number });
      fig.setGear('helmet');
      const sled = this.buildSled(K, c);
      K.group.add(sled); K.group.add(fig.root);
      const home = { x: ff.c.x + ff.r.x * (18 + i * 9), z: ff.c.z + ff.r.z * (18 + i * 9) - ff.t.z * 4 };
      this.crews.push({ c, i, fig, sled, times: [], splits: [], total: 0, home, idle: this.r() * 10, bot: c.human ? null : { tap: new BotTapper(c.pad, rng(c.seed * 37 + 3)) } });
    });
    this.parkDir = { x: ff.t.x, z: ff.t.z };
    this.placeWaiting();
    const kit = hudKit(this.ctx);
    this.card = new Card(kit);
    this.guide = new Guide(kit, [{ key: 'sp', label: 'Speed' }, { key: 'ln', label: 'Line' }]);
    this.tags = new Tags(kit, R);
    this.skipper = new Skipper(this.ctx, kit);
    this.buildMap(kit);
    this.applyCamera(1);
  }

  // run a whole descent with a steering function, no push: returns speed every 2 units
  simulate(steerFn) {
    const sl = { s: PUSH, v: VPUSH, phi: 0 }, vs = [];
    let t = 0;
    while (sl.s < this.track.finishS && t < 90) { stepSled(this.track, sl, 1 / 60, steerFn(sl)); vs[Math.floor(sl.s / 2)] = sl.v; t += 1 / 60; }
    for (let k = 0; k < vs.length; k++) if (vs[k] == null) vs[k] = vs[k - 1] ?? VPUSH;
    return { vs, t };
  }

  buildRoom(K) {
    const g = K.group;
    const b = this.bounds();
    // wide old attic boards, a braided rag rug, moving boxes round the edges, light from the skylight
    const T = K.TX.woodTextures({ size: 1024, planks: 3, base: 0x9a8268, dark: 0x5e4a38, light: 0xb9a184, seed: 55, ringFreq: 8, roughBase: 0.7, lacquer: 0.05, grainContrast: 0.9 });
    for (const k of ['map', 'normalMap', 'roughnessMap']) if (T[k]) T[k].repeat.set((b.w + 400) / 150, (b.d + 400) / 150);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(b.w + 400, b.d + 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ ...T }));
    floor.position.set(b.cx, 0, b.cz); floor.receiveShadow = true; g.add(floor);
    const rc = K.TX.makeCanvas(512), r2 = rc.getContext('2d');
    const bands = ['#a65a45', '#e6d6bc', '#7f9a78', '#c99a5e', '#5d6b8a', '#e6d6bc', '#b07a62', '#8a7f6e', '#d8c7a6'];
    for (let k = 0; k < 22; k++) { r2.fillStyle = bands[k % bands.length]; r2.beginPath(); r2.ellipse(256, 256, 254 - k * 11.5, 254 - k * 11.5, 0, 0, Math.PI * 2); r2.fill(); }
    r2.strokeStyle = 'rgba(0,0,0,0.12)'; r2.lineWidth = 2; for (let k = 0; k < 44; k++) { r2.beginPath(); r2.ellipse(256, 256, 254 - k * 5.75, 254 - k * 5.75, 0, 0, Math.PI * 2); r2.stroke(); }
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(rc, { wrap: false }), roughness: 1 }));
    rug.scale.set(b.w * 0.42, 1, b.d * 0.42); rug.position.set(b.cx, 0.2, b.cz); rug.receiveShadow = true; g.add(rug);
    // moving boxes, taped and labelled, round the edges of the run
    const labels = ['XMAS', 'TOYS', 'BOOKS', 'WINTER', 'BABY CLOTHES', 'LEGO', 'PHOTOS', 'SKIS?'];
    const boxMats = labels.map((l, i) => {
      const c = K.TX.makeCanvas(256, 128), x = c.getContext('2d');
      x.fillStyle = '#c69a62'; x.fillRect(0, 0, 256, 128);
      x.fillStyle = 'rgba(214,170,104,0.85)'; x.fillRect(110, 0, 36, 128);
      x.fillStyle = '#2b2622'; x.font = `${l.length > 8 ? 26 : 38}px "Lilita One", Impact, sans-serif`; x.textAlign = 'center'; x.fillText(l, 128, 84);
      void i;
      return new THREE.MeshStandardMaterial({ map: K.TX.toTexture(c, { wrap: false }), roughness: 0.9 });
    });
    const plain = new THREE.MeshStandardMaterial({ color: 0xbf9259, roughness: 0.92 });
    const tapeTop = new THREE.MeshStandardMaterial({ color: 0xc9a46c, roughness: 0.8 });
    const placed = [];
    const clear = (x, z, r) => { for (const p of this.track.pts) if (Math.hypot(p.x - x, p.z - z) < r + RT + 8) return false; for (const q of placed) if (Math.hypot(q[0] - x, q[1] - z) < r + q[2]) return false; return true; };
    const rr = rng(77);
    for (let k = 0, tries = 0; k < 18 && tries < 400; tries++) {
      const a = rr() * Math.PI * 2, d = 0.55 + rr() * 0.25;
      const x = b.cx + Math.cos(a) * (b.w * d), z = b.cz + Math.sin(a) * (b.d * d);
      const w = 26 + rr() * 16, h = 18 + rr() * 14, dd = 22 + rr() * 10;
      if (!clear(x, z, Math.max(w, dd) * 0.75)) continue;
      placed.push([x, z, Math.max(w, dd) * 0.75]);
      const bm = boxMats[k % boxMats.length];
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), [plain, plain, tapeTop, plain, bm, plain]);
      m.position.set(x, h / 2, z); m.rotation.y = Math.atan2(b.cx - x, b.cz - z) + (rr() - 0.5) * 0.4; m.castShadow = true; m.receiveShadow = true; g.add(m);
      if (rr() < 0.4) { const m2 = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, h * 0.7, dd * 0.8), [plain, plain, tapeTop, plain, boxMats[(k + 3) % boxMats.length], plain]); m2.position.set(x, h + h * 0.35, z); m2.rotation.y = m.rotation.y + (rr() - 0.5) * 0.5; m2.castShadow = true; g.add(m2); }
      k++;
    }
    // the skylight: a patch of light on the boards, a shaft of it with dust in it
    const sx = b.cx + b.w * 0.12, sz = b.cz - b.d * 0.1, SY = 240;
    sunPatch(g, { corners: [[sx - 40, SY, sz + 30], [sx + 40, SY, sz + 30], [sx + 40, SY, sz - 30], [sx - 40, SY, sz - 30]], sun: BSUN, y: 0.35, color: 0xdfe8ff, opacity: 0.28 });
    this.beams = sunbeams(g, { from: [sx, SY - 60, sz], dir: BSUN.map((v) => -v), length: 200, width: 40, n: 2, spread: 30, color: 0xe6eeff, opacity: 0.05 });
    this.dust = { x: sx - BSUN[0] * 120, z: sz - BSUN[2] * 120, t: 0 };
    // string lights looped from the toy chest along the boxes
    const ring = [];
    for (let k = 0; k <= 16; k++) { const a = (k / 16) * Math.PI * 2; ring.push([b.cx + Math.cos(a) * (b.w * 0.62 + 30), 30 + (k % 2) * 6, b.cz + Math.sin(a) * (b.d * 0.62 + 30)]); }
    this.lights = new FairyLights(g, ring, { sag: 6, per: 6, halo: 6, seed: 19 });
    // the toy chest at the top, holding the start
    const s0 = this.frameAt(PUSH / 2);
    const h = s0.c.y - RT - 1;
    const chest = new THREE.Mesh(new K.RoundedBoxGeometry(PUSH + 34, h, 34, 3, 1.5), K.paint(0xe23b2e));
    chest.position.set(s0.c.x - 4, h / 2, s0.c.z); chest.castShadow = true; chest.receiveShadow = true; g.add(chest);
    const lid = new THREE.Mesh(new K.RoundedBoxGeometry(PUSH + 36, 2.4, 36, 2, 1), K.paint(0xf2c230));
    lid.position.set(s0.c.x - 4, h - 1.2, s0.c.z); lid.castShadow = true; g.add(lid);
    const sc = K.TX.makeCanvas(256, 128), s2 = sc.getContext('2d');
    s2.fillStyle = '#fffdf6'; s2.fillRect(0, 0, 256, 128); s2.fillStyle = '#e23b2e'; s2.font = '72px "Lilita One", Impact, sans-serif'; s2.textAlign = 'center'; s2.textBaseline = 'middle'; s2.fillText('START', 128, 68);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(sc, { wrap: false }), roughness: 0.9 }));
    sign.position.set(s0.c.x - 4, h * 0.55, s0.c.z + 17.1); g.add(sign);
    this.wallZ = b.cz - b.d / 2 - 60;
  }

  bounds() {
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for (const p of this.track.pts) { mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z); }
    return { cx: (mnx + mxx) / 2, cz: (mnz + mxz) / 2, w: mxx - mnx, d: mxz - mnz };
  }

  buildTube(K) {
    const tr = this.track, N = Math.floor(tr.len), SEG = 18, A = 1.68;
    // cardboard inside, spiral seams, frosted with icing sugar along the bottom
    const C = 256, cc = K.TX.makeCanvas(C), c = cc.getContext('2d');
    const img = c.createImageData(C, C);
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const k = (y * C + x) * 4, u = x / C, n = this.noise.noise(x * 0.08, y * 0.08);
      const frost = Math.max(0, 1 - Math.abs(u - 0.5) * 3.2) * (0.55 + 0.45 * n);
      const seam = ((x + y * 0.6) % 64) < 2 ? 0.8 : 1;
      const base = [196 * seam, 150 * seam, 104 * seam];
      img.data[k] = base[0] + (250 - base[0]) * frost; img.data[k + 1] = base[1] + (250 - base[1]) * frost; img.data[k + 2] = base[2] + (252 - base[2]) * frost; img.data[k + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    const pos = [], uv = [], idx = [];
    const f = {};
    for (let i = 0; i <= N; i++) {
      this.frameAt(i, f);
      for (let j = 0; j <= SEG; j++) {
        const a = -A + (2 * A * j) / SEG, sa = Math.sin(a), ca = Math.cos(a);
        pos.push(f.c.x + RT * (sa * f.r.x - ca * f.u.x), f.c.y + RT * (sa * f.r.y - ca * f.u.y), f.c.z + RT * (sa * f.r.z - ca * f.u.z));
        uv.push(j / SEG, i / 24);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < SEG; j++) { const a = i * (SEG + 1) + j, b = a + SEG + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const tube = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: K.TX.toTexture(cc), roughness: 0.75, side: THREE.DoubleSide }));
    tube.castShadow = true; tube.receiveShadow = true; K.group.add(tube);
    // the fast line in red: dashes at the angle a perfect run rides at
    const lp = [], li = [];
    for (let i = 0; i < N; i++) {
      if (Math.floor(i / 3) % 2) continue;
      for (const s of [i, i + 2]) {
        this.frameAt(s, f);
        const v = this.nominal.vs[Math.floor(s / 2)] ?? 20;
        const ph = phiStar(tr, s, v);
        for (const d of [-0.05, 0.05]) {
          const a = ph + d, sa = Math.sin(a), ca = Math.cos(a), rr = RT - 0.06;
          lp.push(f.c.x + rr * (sa * f.r.x - ca * f.u.x), f.c.y + rr * (sa * f.r.y - ca * f.u.y), f.c.z + rr * (sa * f.r.z - ca * f.u.z));
        }
      }
      const b = lp.length / 3 - 4;
      li.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setIndex(li); lg.computeVertexNormals();
    K.group.add(new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: 0xe23b2e, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })));
    // blue tape where the tubes join
    const tapes = [];
    for (let s = 40; s < N; s += 40) {
      this.frameAt(s, f);
      tapes.push({ x: f.c.x, y: f.c.y, z: f.c.z, ry: Math.atan2(-f.t.z, f.t.x) });
    }
    const band = new THREE.CylinderGeometry(RT + 0.12, RT + 0.12, 1.6, 24, 1, true, Math.PI / 2 - A + Math.PI, 2 * A).rotateZ(Math.PI / 2);
    K.instances(band, new THREE.MeshStandardMaterial({ color: 0x3d7bd9, roughness: 0.7, side: THREE.DoubleSide }), tapes);
    // the start: a white start line, a green stripe to jump in on, a red line where the push ends
    this.stripe(K, BEAM - 0.4, BEAM + 0.4, 0xffffff);
    this.stripe(K, PUSH - JUMP_ZONE, PUSH, 0x2fae5a);
    this.stripe(K, PUSH, PUSH + 0.8, 0xe23b2e);
    // the timing lines for the split times
    this.splitS = SPLITS.map((f) => PUSH + f * (this.track.finishS - PUSH));
    for (const s of this.splitS) this.stripe(K, s - 0.5, s + 0.5, 0xffc93c);
  }

  stripe(K, s0, s1, color) {
    const pos = [], idx = [], f = {}, A = 1.0, n = 8;
    for (let k = 0; k <= 4; k++) {
      this.frameAt(s0 + ((s1 - s0) * k) / 4, f);
      for (let j = 0; j <= n; j++) {
        const a = -A + (2 * A * j) / n, sa = Math.sin(a), ca = Math.cos(a), rr = RT - 0.05;
        pos.push(f.c.x + rr * (sa * f.r.x - ca * f.u.x), f.c.y + rr * (sa * f.r.y - ca * f.u.y), f.c.z + rr * (sa * f.r.z - ca * f.u.z));
      }
    }
    for (let k = 0; k < 4; k++) for (let j = 0; j < n; j++) { const a = k * (n + 1) + j, b = a + n + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.receiveShadow = true; K.group.add(m);
  }

  // a little map of the course in the corner, with a dot for the sled
  buildMap(kit) {
    const S = 150, cv = document.createElement('canvas');
    cv.width = S * 2; cv.height = S * 2;
    cv.className = 'bs-map';
    const st = document.createElement('style');
    st.textContent = '.bs-map{position:absolute;right:12px;top:64px;width:150px;height:150px;background:rgba(255,244,220,.92);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17}@media (max-width:600px){.bs-map{width:104px;height:104px;top:58px}}';
    kit.el.appendChild(st); kit.el.appendChild(cv);
    this.mapEl = cv;
    const b = this.bounds(), sc = (S * 2 - 36) / Math.max(b.w, b.d);
    this.mapXY = (x, z) => [S + (x - b.cx) * sc, S + (z - b.cz) * sc];
    // the course drawn once into a background canvas
    const bg = document.createElement('canvas'); bg.width = S * 2; bg.height = S * 2;
    const g = bg.getContext('2d');
    g.lineCap = 'round'; g.lineJoin = 'round';
    const path = (from, to) => { g.beginPath(); for (let s = from; s <= to; s += 4) { const p = this.track.at(s), [x, y] = this.mapXY(p.x, p.z); if (s === from) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); };
    g.strokeStyle = '#1f1a17'; g.lineWidth = 13; path(0, this.track.len);
    g.strokeStyle = '#d9b48a'; g.lineWidth = 8; path(0, this.track.len);
    g.strokeStyle = '#2fae5a'; g.lineWidth = 8; path(0, PUSH);
    const fin = this.track.at(this.track.finishS), [fx, fy] = this.mapXY(fin.x, fin.z);
    g.fillStyle = '#1f1a17'; g.fillRect(fx - 7, fy - 7, 14, 14); g.fillStyle = '#fff'; g.fillRect(fx - 7, fy - 7, 7, 7); g.fillRect(fx, fy, 7, 7);
    for (const s of this.splitS) { const p = this.track.at(s), [x, y] = this.mapXY(p.x, p.z); g.fillStyle = '#1f1a17'; g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fill(); g.fillStyle = '#ffc93c'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
    this.mapBg = bg;
  }

  drawMap(s, color) {
    const g = this.mapEl.getContext('2d');
    g.clearRect(0, 0, this.mapEl.width, this.mapEl.height);
    g.drawImage(this.mapBg, 0, 0);
    const p = this.track.at(Math.max(0, s)), [x, y] = this.mapXY(p.x, p.z);
    g.fillStyle = color; g.strokeStyle = '#1f1a17'; g.lineWidth = 4;
    g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  buildSupports(K) {
    const tr = this.track, list = [], cols = [0xb5473a, 0x2f4f7a, 0x2fae5a, 0xf2c230, 0x8a55c9, 0xef7d2c, 0x3d7bd9];
    const f = {};
    for (let s = PUSH + 14; s < tr.len - 4; s += 22) {
      this.frameAt(s, f);
      const top = f.c.y - RT - 0.3, ry = Math.atan2(-f.t.z, f.t.x);
      if (top < 1.5) continue;
      const n = Math.max(1, Math.round(top / 2.6)), th = top / n;
      for (let k = 0; k < n; k++) list.push({ x: f.c.x + (this.r() - 0.5) * 0.8, y: th * k + th / 2, z: f.c.z + (this.r() - 0.5) * 0.8, ry: ry + Math.PI / 2 + (this.r() - 0.5) * 0.2, sx: 15 + this.r() * 3, sy: th * 0.96, sz: 11 + this.r() * 2, color: cols[(list.length * 3) % cols.length] });
      K.contact(f.c.x, f.c.z, 10, 8, 0.35);
    }
    K.instances(new K.RoundedBoxGeometry(1, 1, 1, 1, 0.06), K.std({ roughness: 0.65 }), list, { colors: true });
  }

  buildFinish(K, competitors) {
    const g = K.group, f = this.frameAt(this.track.finishS);
    // two crayons and a paper banner over the finish
    const ry = Math.atan2(-f.t.z, f.t.x);
    for (const sd of [-1, 1]) {
      const cr = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 30, 10), K.paint([0xe23b2e, 0x2fae5a][(sd + 1) / 2]));
      cr.position.set(f.c.x + f.r.x * sd * (RT + 3), 15, f.c.z + f.r.z * sd * (RT + 3)); cr.castShadow = true; g.add(cr);
    }
    const bc = K.TX.makeCanvas(512, 96), b2 = bc.getContext('2d');
    for (let x = 0; x < 512; x += 32) for (let y = 0; y < 96; y += 32) { b2.fillStyle = ((x + y) / 32) % 2 ? '#1f1a17' : '#fffdf6'; b2.fillRect(x, y, 32, 32); }
    b2.fillStyle = '#ffc93c'; b2.fillRect(130, 18, 252, 60); b2.fillStyle = '#1f1a17'; b2.font = '52px "Lilita One", Impact, sans-serif'; b2.textAlign = 'center'; b2.textBaseline = 'middle'; b2.fillText('FINISH', 256, 50);
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(2 * RT + 6, 5), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(bc, { wrap: false }), roughness: 0.9, side: THREE.DoubleSide }));
    ban.position.set(f.c.x, 27, f.c.z); ban.rotation.y = ry + Math.PI / 2; g.add(ban);
    // the crowd watches the finish and the big bends
    const spots = [];
    for (let k = 0; k < 6; k++) { const a = this.frameAt(this.track.finishS - 30 + k * 14); spots.push({ x: a.c.x - a.r.x * (RT + 12 + (k % 2) * 6), y: 0, z: a.c.z - a.r.z * (RT + 12 + (k % 2) * 6), ry: Math.atan2(a.r.x, a.r.z), size: 12 }); }
    for (const s of [200, 320, 470]) { const a = this.frameAt(s); spots.push({ x: a.c.x + a.r.x * (RT + 14), y: 0, z: a.c.z + a.r.z * (RT + 14), ry: Math.atan2(-a.r.x, -a.r.z), size: 12 }); }
    this.crowd = crowd(g, spots, 71);
    [[this.track.finishS + 20, -1], [this.track.finishS - 50, 1]].forEach(([s, sd], k) => {
      const a = this.frameAt(s);
      const b = banner(competitors[k % competitors.length].code, 16, { seed: 40 + k });
      b.position.set(a.c.x + a.r.x * sd * (RT + 8), 0, a.c.z + a.r.z * sd * (RT + 8)); b.rotation.y = ry + (sd > 0 ? Math.PI : 0);
      g.add(b);
    });
  }

  buildSled(K, c) {
    // a little bobsled along +x: a painted shell, a rounded nose, two metal runners
    const geo = K.merge([
      { geo: new K.RoundedBoxGeometry(9, 2.4, 3.6, 3, 0.9), color: c.paint.shirt, pos: [0, 1.6, 0] },
      { geo: new THREE.SphereGeometry(1.8, 16, 10, 0, Math.PI), color: c.paint.shirt, pos: [4.4, 1.7, 0], rot: [0, Math.PI / 2, 0], scale: [1, 0.75, 1] },
      { geo: new K.RoundedBoxGeometry(5, 0.5, 3.0, 2, 0.2), color: c.paint.trim, pos: [-1.2, 2.85, 0] },
      { geo: new THREE.BoxGeometry(9.6, 0.25, 0.3), color: 0xc8ccd2, pos: [0.2, 0.15, 1.35] },
      { geo: new THREE.BoxGeometry(9.6, 0.25, 0.3), color: 0xc8ccd2, pos: [0.2, 0.15, -1.35] },
    ]);
    const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.7 }));
    m.castShadow = true;
    const grp = new THREE.Group();
    grp.add(m);
    grp.matrixAutoUpdate = false;
    return grp;
  }

  attract() {}

  start() {
    this.ctx.sound.setLoop('crowd', 0.25);
    this.turn = -1; this.run = 1;
    this.runs = RUNS;
    this.order = this.crews.map((c) => c.i);
    // a flight down the whole course first (any player's action skips it)
    this.phase = 'intro'; this.t = 0;
    this.ctx.hud.message('The course', 'small', '#fff', 2);
  }

  next() {
    this.turn++;
    if (this.turn >= this.crews.length) {
      if (this.run < this.runs) {
        this.run++; this.turn = 0;
        // the second run in reverse order of the standings: the leader goes last
        this.order = [...this.crews].sort((a, b) => b.total - a.total).map((c) => c.i);
        this.ctx.hud.message('Second run: the leader goes last', 'small', '#ffc93c', 1.8);
      } else { this.finishAll(); return; }
    }
    const cr = this.cur = this.crews[this.order[this.turn]];
    this.sl = { s: 0, v: 0, phi: 0, w: 0, wob: 0, rhythm: fitRhythm(new Rhythm({ target: TARGET }), cr.c), little: cr.c.human && helped(cr.c), kid: cr.c.human && helped(cr.c, 1), pushing: false, inside: false, jumpT: -1, startT: null, time: null, anim: 0, hist: [], note: null, split: 0, splits: [], splitNote: null };
    if (!cr.bot) this.skipper.update(false, false);
    this.camInit = false;   // cut to the start
    this.phase = 'ready'; this.t = 0;
    this.placeWaiting();
    cr.fig.setExpression('focus');
    if (cr.bot) { const B = BOT[this.ctx.skillName] || BOT.normal; cr.bot.go = 0.6 + this.r() * 0.5; cr.bot.started = false; cr.bot.jumpAt = PUSH - clamp(B.jump[0] + this.r.gauss() * B.jump[1], 0.5, 12); }
    this.ctx.competitors.forEach((c, i) => this.ctx.hud.chip(i, this.crews[i].times.length ? fmtTime(this.crews[i].total) : '', i === cr.i ? 'active' : ''));
    if (cr.c.human) this.ctx.hud.message(`${cr.c.short}: ${cr.c.type === 'touch' ? 'tap ◀ ▶' : 'tap left, right'} to push!`, 'small', '#fff');
    else this.ctx.hud.message('');
    this.updateCard();
  }

  // ---------------------------------------------------------------- per step
  botUpdate(cr, now) {
    const b = cr.bot, sl = this.sl, pad = cr.c.pad, B = BOT[this.ctx.skillName] || BOT.normal;
    if (this.phase === 'ready' && !b.started && this.t > b.go) { b.started = true; b.tap.start(now); }
    if (this.phase === 'push' || (this.phase === 'ready' && b.started)) {
      b.tap.update(now, TARGET * B.cad, 0.07, 0.003);
      if (sl.s >= b.jumpAt && !sl.inside) { b.tap.stop(); pad.push('action', true, now); pad.push('action', false, now + 0.04); }
    }
    if (this.phase === 'run') {
      // steer by what it saw a moment ago
      const past = sl.hist[Math.max(0, sl.hist.length - 1 - Math.round(B.delay * 120))] || sl;
      const st = autoSteer(past, B.dead);
      pad.push('left', st < 0, now); pad.push('right', st > 0, now);
    }
  }

  update(dt) {
    const ctx = this.ctx, now = ctx.time();
    this.t += dt;
    if (this.phase === 'pre') { for (const c of this.crews) ctx.presses(c.i); return; }
    if (this.phase === 'intro') {
      let skipIntro = false;
      for (const c of this.crews) if (ctx.presses(c.i).some((e) => e.b === 'action' && e.down) && c.c.human) skipIntro = true;
      if (skipIntro || this.t > INTRO_T) { this.ctx.hud.message(''); this.next(); }
      return;
    }
    if (this.phase === 'done') {
      for (const c of this.crews) ctx.presses(c.i);
      if (this.t > 1.6 && this.results) { const r = this.results; this.results = null; ctx.finish(r); }
      return;
    }
    const cr = this.cur, sl = this.sl;
    if (cr.bot) this.botUpdate(cr, now);
    let q = [], skip = false;
    for (const x of this.crews) {
      const e = ctx.presses(x.i);
      if (x === cr) q = e;
      if (x.c.human && e.some((y) => y.b === 'action' && y.down)) skip = true;
    }
    // watching a computer crew: action fast-forwards
    this.skipper.update(!!cr.bot, skip);
    if (sl.note) sl.note.t += dt;
    if (this.phase === 'ready' || this.phase === 'push') {
      for (const e of q) {
        if (!e.down) continue;
        if (e.b === 'action' && !sl.little) { if (sl.pushing) this.jumpIn(); continue; }
        const res = sl.rhythm.press(e.b, e.t);
        if (!sl.pushing) { sl.pushing = true; this.phase = 'push'; this.t = 0; ctx.hud.message(''); }
        if (res === 'stumble') { sl.v *= 0.85; ctx.sound.stumble(); } else ctx.sound.step(cr.c.human ? 0.8 : 0.4);
      }
      if (this.phase === 'ready' && this.t > 10) { sl.pushing = true; this.phase = 'push'; }
      if (sl.pushing) {
        // a crew that doesn't push gets the sled rolling slowly anyway (nobody waits at the top for ever)
        const eff = sl.inside ? 0 : Math.max(sl.rhythm.effort(now), cr.c.human && this.t > 5 ? Math.min(0.6, 0.3 + (this.t - 5) * 0.05) : 0);
        if (!sl.inside) sl.v += (VPUSH * eff - sl.v) * (1 - Math.exp(-1.6 * dt));
        sl.s += sl.v * dt;
        // Little crews jump in by themselves on the green stripe
        if (sl.little && !sl.inside && sl.s >= PUSH - JUMP_ZONE * 0.6) this.jumpIn();
        if (sl.startT == null && sl.s >= BEAM) sl.startT = now - (sl.s - BEAM) / Math.max(1, sl.v);
        if (sl.s >= PUSH) {
          if (!sl.inside) { this.jumpIn(true); }
          this.phase = 'run'; this.t = 0;
          // the start time: from the clock beam to the end of the push, the best so far beside it
          const st = sl.startT != null ? now - sl.startT : null;
          if (st != null) {
            const best = this.bestStart;
            if (cr.c.human) this.ctx.hud.flash(`${cr.c.short}: start ${st.toFixed(2)} s${best != null ? (st <= best ? ' · best so far!' : ` · best ${best.toFixed(2)}`) : ''} · top push ${Math.round((sl.v / VPUSH) * 100)}%`, best == null || st <= best ? '#7be495' : '#ffc93c');
            this.bestStart = best == null ? st : Math.min(best, st);
            cr.starts = (cr.starts || []).concat(st);
          }
        }
      }
    } else if (this.phase === 'run') {
      const held = ctx.held(cr.i);
      let steer = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      // Little crews: the sled mostly steers itself; Kids get a nudge back when they drift well off the line
      if (sl.little) steer = clamp(steer * 0.5 + autoSteer(sl, 0.15), -1, 1);
      else if (sl.kid && !steer) steer = autoSteer(sl, 0.3);
      sl.wob = 0.06 * this.noise.noise(sl.s * 0.05, cr.i * 7);
      stepSled(this.track, sl, dt, steer);
      sl.hist.push({ s: sl.s, v: sl.v, phi: sl.phi, star: sl.star });
      if (sl.hist.length > 120) sl.hist.shift();
      if (sl.scrape && !sl.scraping) { ctx.sound.stumble(); sl.scraping = true; } else if (!sl.scrape) sl.scraping = false;
      ctx.sound.setLoop('hiss', clamp(sl.v / 60, 0.1, 0.6), 1800 + sl.v * 40);
      if (sl.split < this.splitS.length && sl.startT != null && sl.s >= this.splitS[sl.split]) this.passSplit(now - (sl.s - this.splitS[sl.split]) / Math.max(1, sl.v));
      if (sl.s >= this.track.finishS) this.crossFinish(now - (sl.s - this.track.finishS) / Math.max(1, sl.v));
    } else if (this.phase === 'finished') {
      // the run-out: braking to a stop
      sl.v = Math.max(0, sl.v - 40 * dt);
      sl.s = Math.min(this.track.len - 6, sl.s + sl.v * dt);
      sl.phi = damp(sl.phi, 0, 3, dt);
      if (skip && this.t > 0.8) this.t = Math.max(this.t, 2.6);
      if (this.t > 3.2) { this.ctx.sound.setLoop('hiss', 0); this.next(); }
    }
  }

  jumpIn(late = false) {
    const sl = this.sl, ctx = this.ctx, cr = this.cur;
    if (sl.inside) return;
    sl.inside = true; sl.jumpT = 0;
    const left = PUSH - sl.s;
    // jumping in too early loses the rest of the push; missing the end of the zone is a clumsy scramble
    if (late) { sl.v *= 0.9; sl.note = { text: 'late jump: slow!', col: '#ff8a65', t: 0 }; } else if (left <= winFor(cr.c, JUMP_ZONE)) { sl.v *= 1.04; sl.note = { text: 'perfect jump-in!', col: '#7be495', t: 0 }; } else sl.note = { text: `early jump: ${Math.round(left - JUMP_ZONE)} cm of push lost`, col: '#ffc93c', t: 0 };
    cr.bot?.tap.stop();
    ctx.sound.thump(0.4);
  }

  crossFinish(t) {
    const sl = this.sl, cr = this.cur, ctx = this.ctx;
    const time = Math.round((t - (sl.startT ?? t)) * 100) / 100;
    sl.time = time;
    cr.times.push(time); cr.total = Math.round(cr.times.reduce((a, b) => a + b, 0) * 100) / 100;
    this.phase = 'finished'; this.t = 0;
    for (const b of ['left', 'right']) cr.c.pad.push(b, false, t);
    cr.splits[this.run - 1] = sl.splits.slice();
    // against the leader: the run time in run 1, the two runs added up in run 2
    const ref = this.splitRef(0), r = this.run - 1;
    const total = this.sumTimes(cr, r + 1);
    const first = !ref || ref.projected;   // first down this run: nobody to beat yet
    const lead = first || total <= ref.final;
    const place = 1 + this.crews.filter((x) => x !== cr && x.times.length > r && this.sumTimes(x, r + 1) < total).length;
    ctx.hud.message(r ? `${fmtTime(time)} · total ${fmtTime(total)}` : fmtTime(time), '', lead ? '#ffc93c' : '#fff');
    if (first) ctx.hud.flash(`${cr.c.short}: ${fmtTime(total)} is the time to beat`, '#ffc93c');
    else {
      const d = total - ref.final;
      ctx.hud.flash(Math.abs(d) < 0.005 ? `level with ${ref.c.c.short}!` : lead ? `${cr.c.short} take the lead! −${Math.abs(d).toFixed(2)}` : `+${d.toFixed(2)} behind ${ref.c.c.short} · ${ORD[place - 1]}`, lead ? '#7be495' : '#ff8a65');
    }
    ctx.sound.cheer(lead ? 1 : 0.5); ctx.sound.clap(6);
    ctx.hud.chip(cr.i, fmtTime(cr.total), 'active');
    cr.fig.setExpression(lead ? 'wow' : 'happy');
    this.updateCard();
  }

  sumTimes(x, n) { return x.times.slice(0, n).reduce((a, b) => a + b, 0); }

  // who to measure against at split k: the leader among the crews that have finished this run (the two
  // runs added up in run 2); before anyone has, the leader after run 1, going by their run-1 splits.
  // value: their time at split k; final: their time at the finish (both including earlier runs)
  splitRef(k) {
    const r = this.run - 1, cur = this.cur;
    const done = this.crews.filter((x) => x !== cur && x.times.length > r && x.splits[r]);
    if (done.length) {
      const ld = done.reduce((a, b) => (this.sumTimes(a, r + 1) <= this.sumTimes(b, r + 1) ? a : b));
      return { c: ld, value: this.sumTimes(ld, r) + ld.splits[r][k], final: this.sumTimes(ld, r + 1) };
    }
    if (r > 0) {
      const prev = this.crews.filter((x) => x !== cur && x.times.length >= r && x.splits[r - 1]);
      if (prev.length) {
        const ld = prev.reduce((a, b) => (this.sumTimes(a, r) <= this.sumTimes(b, r) ? a : b));
        return { c: ld, value: this.sumTimes(ld, r) + ld.splits[r - 1][k], final: this.sumTimes(ld, r) + ld.times[r - 1], projected: true };
      }
    }
    return null;
  }

  // through a yellow timing line: the split time, and how it compares with the leader's
  passSplit(t) {
    const sl = this.sl, cr = this.cur, k = sl.split++;
    const time = t - sl.startT;
    sl.splits.push(time);
    const mine = this.sumTimes(cr, this.run - 1) + time;
    const ref = this.splitRef(k);
    const d = ref ? mine - ref.value : null;
    sl.splitNote = { k, d, mine, t: 0 };
    if (d == null) this.ctx.hud.flash(`Split ${k + 1}: ${mine.toFixed(2)} s`, '#fff1d6');
    else this.ctx.hud.flash(Math.abs(d) < 0.005 ? `Split ${k + 1}: level with ${ref.c.c.short}` : `Split ${k + 1}: ${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(2)} ${d <= 0 ? 'ahead of' : 'behind'} ${ref.c.c.short}`, d <= 0 ? '#7be495' : '#ff8a65');
    this.ctx.sound.thump(0.15);
  }

  finishAll() {
    this.phase = 'done'; this.t = 0;
    this.cur = null;
    this.ctx.sound.setLoop('hiss', 0);
    this.placeWaiting();
    const ranked = [...this.crews].sort((a, b) => a.total - b.total);
    this.winner = ranked[0];
    this.ctx.hud.message(`${ranked[0].c.short} wins!`, 'small', '#ffc93c');
    this.guide.show(false);
    this.results = this.crews.map((c) => ({ value: c.total, text: fmtTime(c.total), short: fmtTime(c.total), sub: c.times.map((x) => x.toFixed(2)).join(' + ') }));
    this.updateCard();
  }

  placeWaiting() {
    this.crews.forEach((c, k) => {
      if (this.cur === c) return;
      c.fig.root.position.set(c.home.x, 0, c.home.z);
      c.fig.root.rotation.set(0, -0.6, 0);
      if (c.fig.root.parent !== this.ctx.kit.group) this.ctx.kit.group.add(c.fig.root);
      c.fig.ground = true;
      // the sled parked in front of its crew, all in a neat row pointing down the run-out
      const d = this.parkDir, m = this.tmp.m.makeRotationY(Math.atan2(-d.z, d.x));
      m.setPosition(c.home.x + d.x * 7, 0, c.home.z + d.z * 7);
      c.sled.matrix.copy(m);
      c.sled.matrixWorldNeedsUpdate = true;
    });
  }

  updateCard() {
    const cr = this.cur;
    const live = cr && this.sl && this.sl.startT != null && this.phase !== 'finished' ? ` · ${(this.ctx.time() - this.sl.startT).toFixed(1)} s` : '';
    const sn = this.sl && this.sl.splitNote && this.phase === 'run' ? this.sl.splitNote : null;
    const split = sn ? ` · split ${sn.k + 1} ${sn.d == null ? sn.mine.toFixed(2) : `${sn.d <= 0 ? '−' : '+'}${Math.abs(sn.d).toFixed(2)}`}` : '';
    const line = cr ? `Run ${this.run} of ${this.runs}${cr.times.length ? ` · ${cr.times.map((x) => x.toFixed(2)).join(' + ')}` : ''}${live}${split}${cr.bot && this.crews.some((x) => x.c.human) ? ' · action: fast-forward' : ''}` : 'Final times';
    const ranked = [...this.crews].filter((x) => x.times.length).sort((a, b) => (b.times.length - a.times.length) || (a.total - b.total));
    this.card.set(cr ? cr.c : null, line, ranked.map((x) => ({ c: x.c, text: fmtTime(x.total), me: x === cr })));
  }

  // ---------------------------------------------------------------- per frame
  frame(dt, paused) {
    const ctx = this.ctx, tt = ctx.time();
    if (!paused) this.particles.update(dt);
    const cr = this.cur;
    this.crews.forEach((c) => {
      if (c === cr && this.phase !== 'done') return;
      const w = tt + c.idle;
      c.fig.setPose(this.phase === 'done' && c === this.winner ? POSES.cheer(w) : (Math.floor(w / 3) % 3) === 1 ? POSES.wave(w) : POSES.stand(w));
    });
    if (cr && this.sl && this.phase !== 'done') this.poseSled(cr, tt, dt, paused);
    if (!paused) { this.cardT = (this.cardT || 0) + dt; if (this.cardT > 0.1) { this.cardT = 0; if (this.phase === 'run') this.updateCard(); } }
    this.crowd.update(tt, this.phase === 'run' ? 0.6 : this.phase === 'finished' ? 0.7 : 0.15);
    if (!paused) {
      this.lights.update(tt); this.beams.update(tt);
      // dust drifting in the skylight's shaft
      this.dust.t -= dt;
      if (this.dust.t <= 0 && this.ctx.kit.quality.grass > 0.5) { this.dust.t = 0.12; this.particles.emit(this.dust.x + (Math.random() - 0.5) * 70, 20 + Math.random() * 90, this.dust.z + (Math.random() - 0.5) * 50, { vy: -0.6, spread: 1.2, up: 1.2, color: 0xfff6e0, size: 0.5, life: 5, alpha: 0.7, grav: 0, grow: 1 }); }
    }
    this.updateHud();
    this.applyCamera(dt);
  }

  sledPlace(sl, f) {
    this.frameAt(sl.s, f);
    const sa = Math.sin(sl.phi), ca = Math.cos(sl.phi), T = this.tmp;
    const out = T.a.copy(f.r).multiplyScalar(sa).addScaledVector(f.u, -ca);     // from the axis to the wall
    const pos = T.b.copy(f.c).addScaledVector(out, RT - 0.05);
    const up = T.c.copy(out).negate();
    const right = T.d.crossVectors(f.t, up).normalize();
    T.m.makeBasis(f.t, up, right).setPosition(pos);
    return T.m;
  }

  poseSled(cr, tt, dt, paused) {
    const sl = this.sl, fig = cr.fig, f = this.ff || (this.ff = {});
    const m = this.sledPlace(sl, f);
    cr.sled.matrix.copy(m);
    cr.sled.matrixWorldNeedsUpdate = true;
    // the driver: running behind and pushing, then sitting in
    if (fig.root.parent !== cr.sled) { cr.sled.add(fig.root); }
    fig.ground = false;
    fig.root.rotation.set(0, Math.PI / 2, 0);
    if (!sl.inside) {
      if (!paused && sl.v > 1) sl.anim = (sl.anim + Math.max(sl.rhythm.cadence(tt), sl.v / 5) * 0.5 * dt) % 1;
      fig.root.position.set(-7.2, 0.1, 0);
      const run = this.phase === 'push' ? POSES.run(sl.anim, clamp(sl.v / VPUSH, 0.3, 1)) : POSES.stand(tt);
      fig.ground = true;
      fig.setPose({ ...run, lean: this.phase === 'push' ? 0.9 : 0.4, shL: 1.5, shR: 1.5, elL: 0.3, elR: 0.3, abL: 0.2, abR: 0.2, head: -0.5 });
    } else {
      if (!paused && sl.jumpT >= 0 && sl.jumpT < 1) sl.jumpT = Math.min(1, sl.jumpT + dt / 0.28);
      const u = sl.jumpT, hop = Math.sin(Math.PI * u) * 3;
      fig.root.position.set(-7.2 + 5.6 * u, 0.1 - 2.1 * u + hop, 0);
      const lean = clamp(-sl.phi * 0.25, -0.3, 0.3);
      fig.setPose({ ...REST, y: 0, lean: 0.35, roll: lean, hipL: 1.55, hipR: 1.55, kneeL: 1.7, kneeR: 1.7, shL: 1.1, shR: 1.1, elL: 0.6, elR: 0.6, abL: 0.25, abR: 0.25, head: -0.25 });
      if (this.phase === 'finished' && this.t > 0.6) { fig.setPose({ ...REST, hipL: 1.55, hipR: 1.55, kneeL: 1.7, kneeR: 1.7, shL: 2.8, shR: 2.8, abL: 0.4, abR: 0.4, elL: 0.3, elR: 0.3 }); }
    }
    // icing sugar flying off the runners
    if (!paused && this.phase === 'run' && Math.random() < 0.5) {
      const p = this.tmp.b;
      this.particles.emit(p.x - f.t.x * 4, p.y + 0.3, p.z - f.t.z * 4, { vx: -f.t.x * 4, vz: -f.t.z * 4, spread: 2, up: 2, color: 0xffffff, size: 0.45, life: 0.35, alpha: 0.6, grav: 8, n: sl.scrape ? 5 : 1 });
    }
  }

  updateHud() {
    const cr = this.cur, sl = this.sl, ph = this.phase;
    // the map: the camera's place on the intro flight, then the sled
    if (!this.mapT || this.ctx.time() - this.mapT > 0.03) {
      this.mapT = this.ctx.time();
      if (ph === 'intro') this.drawMap(this.introS ?? 0, '#ffffff');
      else if (cr && sl) this.drawMap(sl.s, cr.c.paint.shirt);
    }
    const show = cr && cr.c.human && (ph === 'ready' || ph === 'push' || ph === 'run');
    this.guide.show(!!show);
    if (!show) { this.tags.hide('bs'); return; }
    const touch = cr.c.type === 'touch';
    const act = touch ? '●' : 'action', lr = touch ? '◀ ▶' : 'left, right';
    this.guide.tip(sl.little ? (ph === 'run' ? 'the sled steers itself: lean on left or right if you like' : 'tap any button on a steady beat to push: you jump in by yourself')
      : ph === 'run' ? `hold ${lr} to keep the sled on the red line (the dot in the green)` : `tap ${lr} in turn to push · tap ${act} on the green stripe to jump in`);
    const e = clamp(sl.v / 45, 0, 1);
    this.guide.bar('sp', e, { go: e > 0.75 });
    const map = (a) => clamp(0.5 + a / 2.8, 0, 1);
    const star = sl.star ?? 0;
    this.guide.bar('ln', 0, { mark: map(sl.phi), zone: [map(star - 0.12), map(star + 0.12)], hide: ph !== 'run' });
    // over the sled: the push beat, then when to jump in, then how it went
    const note = sl.note && sl.note.t < 1.4 ? `<span class="pill" style="--tc:${sl.note.col}">${sl.note.text}</span><br>` : '';
    let html = note;
    // in the run: which way to steer when the sled is off the red line
    if (ph === 'run' && sl.star != null && !sl.little) {
      const err = sl.star - sl.phi;
      if (Math.abs(err) > 0.16) html += `<span class="pill big" style="--tc:${Math.abs(err) > 0.35 ? '#ff8a65' : '#ffc93c'}">${err < 0 ? '◀ steer left' : 'steer right ▶'}</span>`;
    }
    if (!sl.inside && ph !== 'run') {
      const zw = winFor(cr.c, JUMP_ZONE), inZone = sl.s >= PUSH - zw;
      const toGo = Math.max(0, PUSH - zw - sl.s);
      html += inZone && !sl.little ? `<span class="pill big" style="--tc:#7be495">jump in now! (${act})</span>`
        : `<span class="pill" style="--tc:#fff1d6">push! green stripe in ${Math.ceil(toGo)} cm</span><br>${beatGauge(sl.rhythm.ratio(this.ctx.time()))}`;
    }
    if (html) {
      this.tags.set('bs', html);
      const m = this.sledPlace(sl, this.ff || (this.ff = {}));
      const p = this.tmp.b.setFromMatrixPosition(m);
      this.tags.place('bs', p.x, p.y + 9, p.z);
    } else this.tags.hide('bs');
  }

  applyCamera(dt) {
    const R = this.ctx.R, ph = this.phase, sl = this.sl, f = this.cf || (this.cf = {});
    let pos, tgt;
    const T = new THREE.Vector3(), P = new THREE.Vector3();
    if (ph === 'intro') {
      // fly down the whole course, high above it
      const u = clamp(this.t / INTRO_T, 0, 1), s = (u * u * (3 - 2 * u)) * (this.track.len - 20);
      this.introS = s;
      this.frameAt(s, f);
      P.copy(f.c).addScaledVector(UP, 46).addScaledVector(f.t, -40).addScaledVector(f.r, 18);
      this.frameAt(s + 45, f);
      T.copy(f.c);
      pos = P; tgt = T;
    } else if ((ph === 'ready' || ph === 'push' || ph === 'run') && sl) {
      // a chase camera behind and above the sled
      const back = ph === 'run' ? 32 + clamp(sl.v / 4, 0, 8) : 30;
      this.frameAt(Math.max(-14, sl.s - back), f);
      P.copy(f.c).addScaledVector(UP, ph === 'run' ? 17 : 18);
      this.frameAt(sl.s + 16, f);
      // look between the sled and the track ahead, so the sled stays in view through tight bends
      const sp = this.sledPlace(sl, this.ff || (this.ff = {}));
      T.copy(f.c).addScaledVector(UP, -1).lerp(this.tmp.b.setFromMatrixPosition(sp), 0.45);
      pos = P; tgt = T;
    } else if (ph === 'finished' && sl) {
      this.frameAt(this.track.finishS + 26, f);
      P.copy(f.c).addScaledVector(f.r, 30).addScaledVector(UP, 22);
      this.frameAt(Math.min(sl.s, this.track.len - 8), f);
      T.copy(f.c);
      pos = P; tgt = T;
    } else {
      const c0 = this.crews[0];
      this.frameAt(this.track.finishS + 30, f);
      P.copy(f.c).addScaledVector(f.r, -40).addScaledVector(UP, 22);
      T.set(c0.home.x + 8, 4, c0.home.z);
      pos = P; tgt = T;
    }
    const k = dt >= 1 ? 1 : 1 - Math.exp(-(ph === 'run' || ph === 'intro' ? 10 : 3) * Math.min(dt, 0.1));
    if (this.camInit !== true || dt >= 1) { this.camPos.copy(pos); this.camTgt.copy(tgt); this.camInit = true; }
    this.camPos.lerp(pos, k); this.camTgt.lerp(tgt, k);
    R.look(this.camPos.x, this.camPos.y, this.camPos.z, this.camTgt.x, this.camTgt.y, this.camTgt.z, 200);
    R.setFocus(0.45, 0.4, 0.6);
  }

  // ---------------------------------------------------------------- cinematics (the course flight is the fly-in)
  // past the row where the crews park, the sleds lined up nose-first in front of the podium
  ceremonySpot() {
    const f = this.frameAt(this.track.finishS + 30);
    const x = f.c.x + f.r.x * (RT + 52), z = f.c.z + f.r.z * (RT + 52);
    const ry = Math.atan2(f.r.x, f.r.z), yaw = ry + 0.3;
    const cx = Math.sin(yaw), cz = Math.cos(yaw), n = this.crews.length;
    this.crews.forEach((c, k) => {
      const o = (k - (n - 1) / 2) * 9;
      const m = this.tmp.m.makeRotationY(Math.atan2(-cz, cx) + (k - (n - 1) / 2) * 0.12);
      m.setPosition(x + cx * 16 + cz * o, 0, z + cz * 16 - cx * o);
      c.sled.matrix.copy(m);
      c.sled.matrixWorldNeedsUpdate = true;
    });
    return { x, y: 0, z, ry, style: 'boxes', gear: 'helmet', yaw: 0.3, pitch: 0.3, width: 56 };
  }

  dispose() {
    for (const c of this.crews) c.fig.dispose();
    this.ctx.sound.setLoop('hiss', 0);
  }
}

export default {
  id: 'bobsled', name: 'Bobsled', season: 'Winter',
  blurb: 'Down a run of poster tubes from the top of the toy chest: push off, jump in, hold the line.',
  venue: 'The attic on a snowy day: poster tubes cut in half and frosted with icing sugar, on stacks of books from the toy chest to the floor.',
  loading: 'Taping the tubes together…',
  how: [
    { verb: 'Rhythm', text: 'Tap <b>left</b> and <b>right</b> in turn to push the sled off: a quick, steady beat keeps the needle in the green, and a faster push is a faster start.' },
    { verb: 'Timing', text: 'Tap <b>action</b> to jump in, as late as you dare before the push zone ends.' },
    { verb: 'Steer', text: 'Hold <b>left</b> or <b>right</b> to keep the sled on the <b>red line</b>: left alone it swings up too high in the bends. Two runs, the times add up; the second goes in reverse order, the leader last. At the <b>yellow lines</b> you see your split time against the leader.' },
  ],
  helpers: {
    little: 'Tap <b>any button</b> on a steady beat to push. You <b>jump in by yourself</b>, and the sled <b>steers itself</b>.',
    kid: 'A slower push beat, more time to jump in, and the sled steers back if it drifts far off the red line.',
  },
  better: 'lower',
  resultsDelay: 0.6,
  create: (ctx) => new Bobsled(ctx),
};
