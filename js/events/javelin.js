// Javelin: a pencil thrown down the living-room carpet, a tape measure to read the distance.
// Run up with the left/right rhythm, hold ACTION to draw back (the pencil tips up while you hold),
// and let go at a good angle before the red foul line. Three throws each, the best one counts.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, blendPose } from '../figurine.js';
import { crowd, banner, paintedFlagTexture } from '../props.js';
import { Rhythm, BotTapper } from '../verbs.js';
import { Particles } from '../fx.js';
import { clamp, damp, rng, makeNoise2D } from '../util.js';

const LINE_X = 0;              // the foul line
const RUN_X = -95;             // where the run-up starts
const TARGET = 6.5, VMAX = 32, ACCEL = 1.9;
const G = 30, DRAG = 0.0005;
const M_PER_UNIT = 0.75;       // metres per cm of carpet
const A0 = 8, A_RATE = 55, A_MAX = 75;   // angle while holding: start, degrees per second, limit
const PEN_L = 12;              // the pencil javelin
const ZONE = [-29, -17];       // the throw zone on the runway: start drawing back in here
const ATTEMPTS = 3;
const ORD = ['1st', '2nd', '3rd', '4th'];
// computer throwers: run-up cadence, where they start drawing back (units before the line), angle spread
const BOT = {
  easy: { cad: 0.84, hold: [26, 5], err: 8 },
  normal: { cad: 0.96, hold: [22, 3.5], err: 4.5 },
  hard: { cad: 1.08, hold: [19.5, 2], err: 2.2 },
};
const deg = (a) => (a * Math.PI) / 180;

class Javelin {
  constructor(ctx) {
    this.ctx = ctx;
    this.r = ctx.rand;
    this.phase = 'pre';
    this.t = 0;
    this.cam = { x: -60, y: 6, z: 0, yaw: 0.2, pitch: 0.35, width: 90 };
    this.throwers = [];
    this.order = [];
    this.turn = -1;
    this.round = 1;
    this.v3 = new THREE.Vector3();
  }

  // ---------------------------------------------------------------- venue
  async build() {
    const { kit: K, R, competitors } = this.ctx;
    R.setLighting({
      sunDir: [-0.35, 1, 0.6], sunColor: 0xffe6c8, sunIntensity: 2.15,
      hemiSky: 0xfff3e2, hemiGround: 0x6a4a33, hemiIntensity: 0.62,
      envIntensity: 0.5, exposure: 0.98, background: 0x2a2019, shadowRadius: 4,
    });
    this.noise = makeNoise2D(29);
    this.buildRoom(K);
    this.buildCarpet(K);
    this.buildCrowd(K, competitors);
    this.particles = new Particles(K.group, 500);
    this.particles.setScale(R.renderer.domElement.height * 0.9);
    // the pencil javelin (one per thrower, so each colour shows on its marker)
    const pg = this.pencilGeometry(K);
    const penM = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, clearcoat: 0.4 });
    competitors.forEach((c, i) => {
      const fig = new Figurine({ paint: c.paint, seed: c.seed, number: c.number });
      fig.setGear('sprint');
      fig.root.rotation.y = Math.PI / 2;
      K.group.add(fig.root);
      const pen = new THREE.Mesh(pg, penM);
      pen.castShadow = true;
      K.group.add(pen);
      // a toothpick flag in the team's colours marks the best throw
      const flag = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 7, 6), K.std({ color: 0xe9d3a8, roughness: 0.8 }));
      stick.position.y = 3.5; flag.add(stick);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.8), new THREE.MeshStandardMaterial({ map: paintedFlagTexture(c.code, 128, 3 + i), roughness: 0.9, side: THREE.DoubleSide }));
      cloth.position.set(2.2, 5.6, 0); flag.add(cloth);
      flag.visible = false;
      K.group.add(flag);
      this.throwers.push({
        c, fig, pen, flag, i, marks: [], best: null, bot: c.human ? null : { tap: new BotTapper(c.pad, rng(c.seed * 13 + 5)) },
        home: { x: RUN_X - 14 - (i % 2) * 7, z: -14 - i * 5 }, idle: this.r() * 10,
      });
    });
    this.placeWaiting();
    this.buildHud();
    this.applyCamera(1);
  }

  pencilGeometry(K) {
    const L = PEN_L - 2.2;
    const cyl = (len, r, seg = 6) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
    // along +x: the sharpened tip points forward
    return K.merge([
      { geo: cyl(L, 0.32), color: 0x3d7bd9 },
      { geo: cyl(0.45, 0.33, 10), color: 0xc8ccd2, pos: [-L / 2 - 0.22, 0, 0] },
      { geo: cyl(0.55, 0.31, 10), color: 0xf08aa3, pos: [-L / 2 - 0.7, 0, 0] },
      { geo: new THREE.ConeGeometry(0.32, 1.0, 6).rotateZ(-Math.PI / 2), color: 0xe9c89a, pos: [L / 2 + 0.5, 0, 0] },
      { geo: new THREE.ConeGeometry(0.12, 0.35, 6).rotateZ(-Math.PI / 2), color: 0x3a3634, pos: [L / 2 + 0.92, 0, 0] },
    ]);
  }

  buildRoom(K) {
    const g = K.group;
    const T = K.TX.woodTextures({ size: 1024, planks: 4, base: 0xa47b5a, dark: 0x664a35, light: 0xc9a27e, seed: 61, ringFreq: 12, roughBase: 0.55, lacquer: 0.35, grainContrast: 0.8 });
    const geo = new THREE.PlaneGeometry(900, 420);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getZ(i) / 58, pos.getX(i) / 150);
    const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ ...T, roughness: 0.66, envMapIntensity: 0.35 }));
    floor.position.set(60, 0, -40);
    floor.receiveShadow = true;
    g.add(floor);
    // the wall behind, with a warm stripe wallpaper and a framed picture
    const wc = K.TX.makeCanvas(256, 256), w = wc.getContext('2d');
    w.fillStyle = '#e9d8b8'; w.fillRect(0, 0, 256, 256);
    w.fillStyle = '#dcc7a0'; for (let x = 0; x < 256; x += 32) w.fillRect(x, 0, 14, 256);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(900, 260), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(wc, { repeat: [24, 7] }), roughness: 0.95 }));
    wall.position.set(60, 130, -150);
    wall.receiveShadow = true;
    g.add(wall);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(900, 10, 2), K.paint(0xf7f4ee));
    skirt.position.set(60, 5, -149); skirt.castShadow = true; g.add(skirt);
    // the sofa along the back wall, with plush fans on it
    const fab = (base, line) => {
      const c = K.TX.makeCanvas(256), f = c.getContext('2d');
      f.fillStyle = base; f.fillRect(0, 0, 256, 256);
      f.fillStyle = line; for (let y = 0; y < 256; y += 16) f.fillRect(0, y, 256, 5);
      const img = f.getImageData(0, 0, 256, 256), d = img.data;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const k = (y * 256 + x) * 4, v = 0.9 + 0.08 * ((x + y) % 2) + (this.noise.noise(x * 0.2, y * 0.2) - 0.5) * 0.1; d[k] *= v; d[k + 1] *= v; d[k + 2] *= v; }
      f.putImageData(img, 0, 0);
      return K.TX.toTexture(c, { repeat: [2, 2] });
    };
    const sofaM = new THREE.MeshPhysicalMaterial({ map: fab('#c4655a', '#b75a50'), roughness: 0.85, sheen: 0.8, sheenRoughness: 0.5, sheenColor: 0xffd6c8 });
    const rb = (w2, h, d, x, y, z, rad = 6) => { const m = new THREE.Mesh(new K.RoundedBoxGeometry(w2, h, d, 4, rad), sofaM); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); };
    const SX = 110, SZ = -118;
    rb(230, 26, 70, SX, 17, SZ); rb(105, 13, 54, SX - 56, 36, SZ + 6); rb(105, 13, 54, SX + 56, 36, SZ + 6);
    rb(226, 50, 20, SX, 55, SZ - 26, 8); rb(22, 34, 70, SX - 120, 42, SZ); rb(22, 34, 70, SX + 120, 42, SZ);
    K.contact(SX, SZ, 125, 40, 0.45);
    this.sofaTop = { x: SX, y: 42.5, z: SZ + 8 };
    // a floor lamp and a plant pot for the room
    const lamp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 120, 10), K.metal(0x3a3634, 0.35)); pole.position.y = 60; lamp.add(pole);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(12, 17, 20, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xf4e3c2, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x6b5330, emissiveIntensity: 0.25 }));
    shade.position.y = 124; lamp.add(shade);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 2.5, 24), K.metal(0x3a3634, 0.35)); base.position.y = 1.25; lamp.add(base);
    lamp.position.set(-40, 0, -130);
    lamp.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    g.add(lamp);
  }

  buildCarpet(K) {
    const g = K.group;
    // a big patterned living-room rug: border bands, a field of little diamonds
    const W = 1024, H = 512;
    const cc = K.TX.makeCanvas(W, H), c = cc.getContext('2d');
    c.fillStyle = '#2f4f7a'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#e9d8b8'; c.fillRect(18, 18, W - 36, H - 36);
    c.fillStyle = '#b5473a'; c.fillRect(34, 34, W - 68, H - 68);
    c.fillStyle = '#8c3a2f'; c.fillRect(58, 58, W - 116, H - 116);
    for (let y = 80; y < H - 70; y += 34) for (let x = 80; x < W - 70; x += 34) {
      c.fillStyle = ((x + y) / 34) % 2 ? 'rgba(233,216,184,0.45)' : 'rgba(47,79,122,0.5)';
      c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x + 9, y); c.lineTo(x, y + 9); c.lineTo(x - 9, y); c.fill();
    }
    const img = c.getImageData(0, 0, W, H), d = img.data, n = this.noise;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = (y * W + x) * 4, v = 0.86 + 0.14 * n.noise(x * 0.6, y * 0.6); d[k] *= v; d[k + 1] *= v; d[k + 2] *= v; }
    c.putImageData(img, 0, 0);
    const rh = K.TX.noiseField(256, { seed: 82, period: 48, oct: 2 });
    const rug = new THREE.Mesh(new K.RoundedBoxGeometry(440, 1.2, 170, 2, 0.5), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(cc, { wrap: false }), normalMap: K.TX.toTexture(K.TX.normalFromHeight(rh, 256, 256, 2), { srgb: false, repeat: [10, 4] }), roughness: 1 }));
    rug.position.set(100, 0.6, -10);
    rug.receiveShadow = true;
    g.add(rug);
    const Y = 1.25;
    // the runway: two strips of masking tape, the foul line in red tape
    const tapeM = new THREE.MeshStandardMaterial({ color: 0xe8d9a8, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const z of [-6, 6]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(108, 1.4).rotateX(-Math.PI / 2), tapeM); m.position.set(RUN_X / 2 - 6, Y, z); m.receiveShadow = true; g.add(m); }
    // the throw zone: green striped tape where you start drawing back
    const zc = K.TX.makeCanvas(256, 256), z2 = zc.getContext('2d');
    z2.fillStyle = 'rgba(47,174,90,0.85)'; z2.fillRect(0, 0, 256, 256);
    z2.fillStyle = 'rgba(255,255,255,0.35)';
    for (let k = -256; k < 512; k += 40) { z2.beginPath(); z2.moveTo(k, 0); z2.lineTo(k + 20, 0); z2.lineTo(k + 276, 256); z2.lineTo(k + 256, 256); z2.fill(); }
    z2.fillStyle = '#ffffff'; z2.font = '64px "Lilita One", Impact, sans-serif'; z2.textAlign = 'center'; z2.textBaseline = 'middle'; z2.fillText('THROW', 128, 132);
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(ZONE[1] - ZONE[0], 11).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(zc, { wrap: false }), roughness: 0.8, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }));
    zone.position.set((ZONE[0] + ZONE[1]) / 2, Y + 0.01, 0); zone.receiveShadow = true; g.add(zone);
    // a protractor that pops up beside the thrower while drawing back, the needle showing the angle
    const pc = K.TX.makeCanvas(256), p2 = pc.getContext('2d');
    p2.fillStyle = 'rgba(255,255,255,0.82)'; p2.beginPath(); p2.moveTo(128, 128); p2.arc(128, 128, 126, Math.PI, 0); p2.fill();
    p2.fillStyle = 'rgba(47,174,90,0.9)'; p2.beginPath(); p2.moveTo(128, 128); p2.arc(128, 128, 122, -deg(40), -deg(30)); p2.fill();
    p2.strokeStyle = '#1f1a17'; p2.lineWidth = 3;
    for (let a = 0; a <= 180; a += 10) { const r0 = a % 30 === 0 ? 96 : 108; p2.beginPath(); p2.moveTo(128 + Math.cos(deg(a)) * r0, 128 - Math.sin(deg(a)) * r0); p2.lineTo(128 + Math.cos(deg(a)) * 124, 128 - Math.sin(deg(a)) * 124); p2.stroke(); }
    p2.lineWidth = 5; p2.beginPath(); p2.arc(128, 128, 125, Math.PI, 0); p2.stroke();
    this.protractor = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(6, 32, 0, Math.PI), new THREE.MeshBasicMaterial({ map: K.TX.toTexture(pc, { wrap: false }), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.protractor.add(disc);
    this.needle = new THREE.Mesh(new THREE.BoxGeometry(6, 0.45, 0.1).translate(3, 0, 0.05), new THREE.MeshBasicMaterial({ color: 0xe23b2e }));
    this.protractor.add(this.needle);
    this.protractor.visible = false;
    g.add(this.protractor);
    const foul = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 15).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe23b2e, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    foul.position.set(LINE_X + 0.8, Y + 0.01, 0); foul.receiveShadow = true; g.add(foul);
    // the landing sector: two lines of wool, and wool arcs every 10 m with number cards
    const woolM = new THREE.MeshStandardMaterial({ color: 0xfaf6ee, roughness: 1 });
    const SECT = deg(14);
    for (const s of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 8; k++) { const rr = 8 + k * 20; pts.push(new THREE.Vector3(Math.cos(SECT) * rr + (this.r() - 0.5) * 0.6, Y + 0.25, s * Math.sin(SECT) * rr + (this.r() - 0.5) * 0.6)); }
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.32, 5), woolM); m.castShadow = true; g.add(m);
    }
    const cardGeo = new THREE.PlaneGeometry(6, 4.2), pick = new THREE.CylinderGeometry(0.15, 0.15, 7, 6), pickM = K.std({ color: 0xe9d3a8, roughness: 0.8 });
    for (let m = 40; m <= 100; m += 10) {
      const rr = m / M_PER_UNIT, pts = [];
      for (let k = 0; k <= 16; k++) { const a = -SECT + (2 * SECT * k) / 16; pts.push(new THREE.Vector3(Math.cos(a) * rr, Y + 0.2, Math.sin(a) * rr)); }
      const arc = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.22, 4), m % 20 === 0 ? K.paint(0xf2c230) : woolM);
      g.add(arc);
      const cc2 = K.TX.makeCanvas(128, 88), c2 = cc2.getContext('2d');
      c2.fillStyle = '#fffdf6'; c2.fillRect(0, 0, 128, 88);
      c2.fillStyle = '#2f4f7a'; c2.font = '54px "Lilita One", Impact, sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle'; c2.fillText(String(m), 64, 48);
      const zc = -Math.sin(SECT) * rr - 4;
      const card = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ map: K.TX.toTexture(cc2, { wrap: false }), roughness: 0.9, side: THREE.DoubleSide }));
      card.position.set(Math.cos(SECT) * rr, 8, zc); card.rotation.y = 0.1; card.castShadow = true; g.add(card);
      const tp = new THREE.Mesh(pick, pickM); tp.position.set(Math.cos(SECT) * rr, 3.5, zc); g.add(tp);
    }
    // the yellow tape measure, pulled out along the middle of the sector, and its case at the line
    const TL = 180;
    const tc = K.TX.makeCanvas(4096, 64), t = tc.getContext('2d');
    t.fillStyle = '#f2cf3d'; t.fillRect(0, 0, 4096, 64);
    t.fillStyle = '#2b2622'; t.textAlign = 'center';
    const mMax = TL * M_PER_UNIT;
    for (let m = 0; m <= mMax; m += 1) {
      const x = (m / mMax) * 4096;
      t.fillRect(x - 1.5, 0, 3, m % 10 === 0 ? 30 : m % 5 === 0 ? 20 : 11);
      if (m % 10 === 0 && m > 0) { t.font = '28px "Lilita One", Impact, sans-serif'; t.fillText(String(m), x, 58); }
    }
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(TL, 2.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(tc, { wrap: false }), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    tape.position.set(LINE_X + TL / 2, Y + 0.02, 9); tape.receiveShadow = true; g.add(tape);
    const caseM = new THREE.Mesh(new K.RoundedBoxGeometry(2.8, 2.8, 1.4, 3, 0.6), K.plastic(0xe23b2e, 0.3));
    caseM.position.set(LINE_X - 1, Y + 1.4, 11); caseM.castShadow = true; g.add(caseM);
  }

  buildCrowd(K, competitors) {
    const spots = [];
    const s = this.sofaTop;
    for (let k = 0; k < 7; k++) spots.push({ x: s.x - 90 + k * 30, y: s.y, z: s.z, ry: 0.1, size: 12 + this.r() * 3 });
    for (let k = 0; k < 4; k++) spots.push({ x: 190 + k * 18, y: 1.2, z: -60 - (k % 2) * 8, ry: -0.3, size: 11 });
    for (let k = 0; k < 3; k++) spots.push({ x: -70 + k * 16, y: 1.2, z: -52, ry: 0.4, size: 10 });
    this.crowd = crowd(K.group, spots, 41);
    [[-30, -46], [60, -66], [150, -64], [230, -50]].forEach(([x, z], k) => {
      const b = banner(competitors[k % competitors.length].code, 14, { seed: 60 + k });
      b.position.set(x, 0, z); b.rotation.y = (this.r() - 0.5) * 0.3;
      K.group.add(b);
    });
  }

  buildHud() {
    const el = this.ctx.hud.el;
    const style = document.createElement('style');
    style.textContent = `.jv-card{position:absolute;left:12px;top:12px;width:min(260px,42vw);background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17;padding:8px 10px;font:700 12px/1.25 Rubik,sans-serif;color:#1f1a17}
      .jv-card .who{display:flex;align-items:center;gap:7px;font:400 18px/1.1 "Lilita One",Impact,sans-serif}.jv-card .who img{height:20px;width:30px;object-fit:cover;border:2px solid #1f1a17;border-radius:3px}
      .jv-card .rd{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#4a413a;font-weight:800;margin-top:2px}
      .jv-card ol{list-style:none;margin:6px 0 0;padding:6px 0 0;border-top:2px dashed rgba(31,26,23,.25);display:grid;gap:2px}
      .jv-card li{display:grid;grid-template-columns:28px 22px 1fr auto;gap:5px;align-items:center;font-variant-numeric:tabular-nums}.jv-card li img{height:13px;width:20px;object-fit:cover;border-radius:2px}
      .jv-card li.me{background:#ffc93c;border-radius:6px}
      .jv-g{position:absolute;left:50%;bottom:calc(18px + var(--tb,0px));transform:translateX(-50%);width:min(400px,84vw);background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17;padding:6px 12px 8px;font:800 12px/1.2 Rubik,sans-serif;color:#1f1a17;text-align:center}
      .jv-g .tip{font-weight:800}
      .jv-g .row{display:grid;grid-template-columns:54px 1fr;gap:8px;align-items:center;margin-top:5px;text-align:left;color:#4a413a}
      .jv-g .bar{position:relative;height:12px;border:2px solid #1f1a17;border-radius:99px;background:#fff;overflow:hidden}
      .jv-g .bar i{position:absolute;inset:0 auto 0 0;width:0;background:#ef7d2c}.jv-g .bar.go i{background:#2fae5a}
      .jv-g .bar b{position:absolute;top:0;bottom:0;width:4px;background:#1f1a17;margin-left:-2px}
      .jv-g .bar u{position:absolute;top:0;bottom:0;background:#bfe6c7}.jv-g .bar s{position:absolute;top:0;bottom:0;right:0;width:5px;background:#e23b2e}
      .jv-hidden{display:none}`;
    el.appendChild(style);
    const mk = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; el.appendChild(d); return d; };
    this.hudCard = mk('jv-card', '<div class="who"></div><div class="rd"></div><ol></ol>');
    this.hudG = mk('jv-g jv-hidden', '<div class="row"><span>Speed</span><div class="bar sp"><i></i></div></div>');
    if (this.ctx.competitors.some((c) => c.type === 'touch')) this.hudG.style.setProperty('--tb', '110px');
  }

  // ---------------------------------------------------------------- flow
  attract() {}

  start() {
    this.ctx.sound.setLoop('crowd', 0.3);
    this.order = this.throwers.map((t) => t.i);
    this.round = 1;
    this.turn = -1;
    this.next();
  }

  next() {
    this.turn++;
    if (this.turn >= this.order.length) {
      if (this.round < ATTEMPTS) { this.round++; this.turn = 0; this.ctx.hud.message(this.round === ATTEMPTS ? 'Last throw!' : `Throw ${this.round}`, 'small', '#ffc93c', 1.4); } else { this.finishAll(); return; }
    }
    const th = this.cur = this.throwers[this.order[this.turn]];
    this.ath = { x: RUN_X, v: 0, rhythm: new Rhythm({ target: TARGET }), started: false, holding: false, angle: A0, anim: 0, effort: 0, released: false, relT: 0 };
    this.pen = null;
    this.land = null;
    this.phase = 'ready';
    this.t = 0;
    this.placeWaiting();
    th.fig.setExpression('focus');
    if (th.bot) { th.bot.started = false; th.bot.go = 0.8 + this.r() * 0.6; const B = BOT[this.ctx.skillName] || BOT.normal; th.bot.holdAt = Math.max(9, B.hold[0] + this.r.gauss() * B.hold[1]); th.bot.angle = 36 + this.r.gauss() * B.err; }
    this.ctx.competitors.forEach((c, i) => this.ctx.hud.chip(i, this.throwers[i].best != null ? `${this.throwers[i].best.toFixed(1)} m` : '', i === th.i ? 'active' : ''));
    if (th.c.human) this.ctx.hud.message(`${th.c.short}: ${th.c.type === 'touch' ? 'tap ◀ ▶' : 'tap left, right'} to run`, 'small', '#fff');
    else this.ctx.hud.message('');
    this.updateCard();
  }

  botUpdate(th, now) {
    const b = th.bot, a = this.ath, pad = th.c.pad, B = BOT[this.ctx.skillName] || BOT.normal;
    if (this.phase === 'ready' && !b.started && this.t > b.go) { b.started = true; b.tap.start(now); }
    if (this.phase === 'runup' || (this.phase === 'ready' && b.started)) {
      if (!a.holding) b.tap.update(now, TARGET * B.cad, 0.08, 0.004);
      if (!a.holding && LINE_X - a.x <= b.holdAt) pad.push('action', true, now);
      if (a.holding && a.angle >= b.angle) { pad.push('action', false, now); b.tap.stop(); }
    }
  }

  update(dt) {
    const ctx = this.ctx, now = ctx.time();
    this.t += dt;
    if (this.phase === 'pre') { for (let i = 0; i < this.throwers.length; i++) ctx.presses(i); return; }
    if (this.phase === 'done') {
      for (let i = 0; i < this.throwers.length; i++) ctx.presses(i);
      if (this.t > 1.6 && this.results) { const r = this.results; this.results = null; ctx.finish(r); }
      return;
    }
    const th = this.cur;
    if (th.bot) this.botUpdate(th, now);
    let q = [], skip = false;
    for (let i = 0; i < this.throwers.length; i++) {
      const e = ctx.presses(i);
      if (i === th.i) q = e;
      if (this.throwers[i].c.human && e.some((x) => x.b === 'action' && x.down)) skip = true;
    }
    const a = this.ath;
    if (this.phase === 'ready' || this.phase === 'runup') {
      for (const e of q) {
        if (e.b === 'action') {
          if (e.down && !a.holding && a.started) { a.holding = true; a.holdT = e.t; ctx.sound.pop(); }
          else if (!e.down && a.holding) { this.release(e.t); break; }
          continue;
        }
        if (!e.down || a.holding) continue;
        const res = a.rhythm.press(e.b, e.t);
        if (!a.started) { a.started = true; this.phase = 'runup'; this.t = 0; ctx.hud.message(''); }
        if (res === 'stumble') { a.v *= 0.85; ctx.sound.stumble(); } else ctx.sound.step(th.c.human ? 0.8 : 0.4);
      }
      if (this.phase === 'ready' && this.t > 12) { this.foul('No throw'); return; }
      if (a.started && !a.released) {
        const eff = a.holding ? 0 : a.rhythm.effort(now);
        a.effort = eff;
        // drawing back: the run carries on, just a little slower
        const target = a.holding ? a.v : VMAX * eff;
        a.v += (target - a.v) * (1 - Math.exp(-(target > a.v ? ACCEL : 1.2) * dt));
        if (a.holding) { a.v *= Math.exp(-0.35 * dt); a.angle = Math.min(A_MAX, A0 + (now - a.holdT) * A_RATE); }
        a.x += a.v * dt;
        if (a.x > LINE_X) { this.foul('Foul! Over the line'); return; }
      }
    } else if (this.phase === 'flight') {
      const p = this.pen;
      const v = Math.hypot(p.vx, p.vy);
      p.vx -= DRAG * v * p.vx * dt; p.vy -= (G + DRAG * v * p.vy) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.pitch = Math.atan2(p.vy, p.vx); p.roll += dt * 9;
      const tipY = p.y + Math.sin(p.pitch) * PEN_L / 2;
      if (tipY <= 1.3) this.landed();
      this.followThrough(dt);
    } else if (this.phase === 'landed' || this.phase === 'foul') {
      this.followThrough(dt);
      if (skip && this.t > 0.8) this.t = Math.max(this.t, 2.6);
      if (this.t > 3.2) this.next();
    }
  }

  followThrough(dt) {
    const a = this.ath;
    a.v *= Math.exp(-4 * dt);
    a.x += a.v * dt;
  }

  release(t) {
    const a = this.ath, th = this.cur, ctx = this.ctx;
    a.released = true; a.holding = false; a.relT = t;
    th.bot?.tap.stop();
    const ang = deg(a.angle);
    const v0 = 28 + 1.2 * a.v;
    const hand = this.handPos(th);
    this.pen = { x: hand.x, y: Math.max(hand.y, 6), z: 0.5, vx: v0 * Math.cos(ang), vy: v0 * Math.sin(ang), pitch: ang, roll: 0, relX: a.x, angle: a.angle, speed: a.v, vz: (this.r() - 0.5) * 3 };
    this.phase = 'flight'; this.t = 0;
    ctx.sound.whoosh(1);
    const good = a.angle >= 30 && a.angle <= 40;
    ctx.hud.flash(good ? `Great angle: ${a.angle.toFixed(0)}°` : `${a.angle.toFixed(0)}°`, good ? '#7be495' : '#ffffff');
  }

  landed() {
    const p = this.pen, th = this.cur, ctx = this.ctx;
    const tipX = p.x + Math.cos(p.pitch) * PEN_L / 2;
    const metres = Math.round(Math.max(0, tipX - LINE_X) * M_PER_UNIT * 10) / 10;
    // the tip sticks in the carpet
    p.pitch = clamp(p.pitch, deg(-70), deg(-14));
    p.y = 1.3 - Math.sin(p.pitch) * (PEN_L / 2 - 0.7);
    p.x = tipX - Math.cos(p.pitch) * (PEN_L / 2 - 0.7);
    p.stuck = true; p.wob = 1;
    th.marks.push(metres);
    const best = th.best == null || metres > th.best;
    if (best) { th.best = metres; th.flag.visible = true; th.flag.position.set(tipX, 1.2, p.z - 4 - th.i * 1.2); }
    this.land = { metres, best };
    this.phase = 'landed'; this.t = 0;
    ctx.sound.pop(); ctx.sound.thump(0.4);
    ctx.sound.cheer(clamp((metres - 40) / 40, 0.3, 1.2));
    ctx.hud.message(`${metres.toFixed(1)} m`, '', metres >= 80 ? '#ffc93c' : '#ffffff');
    if (best && th.marks.length > 1) ctx.hud.flash('Personal best!', '#7be495');
    th.fig.setExpression(metres >= 75 ? 'wow' : 'happy');
    this.particles.emit(tipX, 1.5, p.z, { vx: 0, spread: 4, up: 3, color: 0xd9c7a8, size: 0.9, life: 0.6, alpha: 0.5, grav: 6, n: 10 });
    ctx.hud.chip(th.i, `${th.best.toFixed(1)} m`, 'active');
    this.updateCard();
  }

  foul(why) {
    const th = this.cur, ctx = this.ctx;
    th.marks.push(null);
    th.bot?.tap.stop();
    this.ath.released = true;
    this.phase = 'foul'; this.t = 0;
    this.land = null;
    ctx.sound.whistle(0.3); ctx.sound.aww();
    ctx.hud.message(why, 'small', '#ff8a65');
    th.fig.setExpression('sad');
    this.updateCard();
  }

  finishAll() {
    this.phase = 'done'; this.t = 0;
    this.cur = null;
    this.placeWaiting(true);
    const ranked = [...this.throwers].sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
    this.winner = ranked[0];
    this.ctx.hud.message(ranked[0].best != null ? `${ranked[0].c.short} wins!` : 'No marks today!', 'small', '#ffc93c');
    this.hudG.classList.add('jv-hidden');
    this.results = this.throwers.map((t) => ({
      value: t.best, dnf: t.best == null, text: t.best != null ? `${t.best.toFixed(1)} m` : 'No mark', short: t.best != null ? `${t.best.toFixed(1)} m` : 'No mark',
      sub: t.marks.map((m) => (m == null ? 'X' : m.toFixed(1))).join(' · '),
    }));
  }

  placeWaiting() {
    // everyone but the thrower waits behind the runway
    this.throwers.forEach((t) => {
      if (this.cur === t && this.phase !== 'done') return;
      t.fig.root.position.set(t.home.x, 0, t.home.z);
      t.fig.ground = true;
    });
  }

  updateCard() {
    const th = this.cur;
    const who = this.hudCard.querySelector('.who'), rd = this.hudCard.querySelector('.rd'), ol = this.hudCard.querySelector('ol');
    if (th) {
      who.innerHTML = `<img src="${th.c.flag}" alt=""><span>${th.c.short}</span>`;
      rd.textContent = `Throw ${this.round} of ${ATTEMPTS} · ${th.marks.map((m) => (m == null ? 'X' : m.toFixed(1))).join(' · ') || 'first throw'}`;
    }
    const ranked = [...this.throwers].filter((x) => x.best != null).sort((a, b) => b.best - a.best);
    ol.innerHTML = ranked.map((x, k) => `<li class="${x === th ? 'me' : ''}"><span>${ORD[k]}</span><img src="${x.c.flag}" alt=""><span>${x.c.short}</span><b>${x.best.toFixed(1)} m</b></li>`).join('');
    ol.style.display = ranked.length ? '' : 'none';
  }

  // ---------------------------------------------------------------- per frame
  handPos(th) {
    th.fig.root.updateMatrixWorld(true);
    return th.fig.arms[1].el.localToWorld(this.v3.set(0, -1.13, 0)).clone();
  }

  frame(dt, paused) {
    const ctx = this.ctx, tt = ctx.time();
    if (!paused) this.particles.update(dt);
    const th = this.cur;
    this.throwers.forEach((t) => {
      if (t === th && this.phase !== 'done') return;
      const w = tt + t.idle;
      t.fig.root.rotation.y = Math.PI / 2 - 0.9 + Math.sin(w * 0.3) * 0.2;
      t.fig.setPose(this.phase === 'done' && t === this.winner ? POSES.cheer(w) : (Math.floor(w / 3) % 3) === 1 ? POSES.wave(w) : POSES.stand(w));
      // waiting throwers hold their pencil upright like a flag pole
      const h = this.handPos(t);
      t.pen.position.copy(h); t.pen.rotation.set(0, 0, Math.PI / 2 - 0.15);
    });
    if (th && this.phase !== 'done') this.poseThrower(th, tt, dt, paused);
    this.crowd.update(tt, this.phase === 'flight' ? 0.8 : this.phase === 'landed' ? 0.6 : 0.15);
    if (!paused) ctx.sound.setLoop('crowd', this.phase === 'flight' ? 0.5 : 0.25);
    this.updateHud();
    this.applyCamera(dt);
  }

  poseThrower(th, tt, dt, paused) {
    const a = this.ath, fig = th.fig;
    fig.root.position.set(a.x, 0, 0);
    fig.root.rotation.y = Math.PI / 2;
    fig.ground = true;
    if (!paused && a.v > 1) a.anim = (a.anim + Math.max(a.rhythm.cadence(tt), a.v / 6) * 0.5 * dt) % 1;
    const carry = { shR: 2.5, elR: 1.5, abR: 0.25 };
    let pose;
    if (this.phase === 'ready') pose = { ...POSES.stand(tt), ...carry };
    else if (!a.released) {
      const run = { ...POSES.run(a.anim, clamp(a.v / VMAX, 0.25, 1)), ...carry };
      // drawing back: arm straight behind, shoulders turned, leaning back as the angle rises
      const k = a.holding ? clamp((tt - a.holdT) * 5, 0, 1) : 0;
      pose = blendPose(run, { ...run, lean: -0.25, twist: -0.6, shR: -1.25, elR: 0.1, abR: 0.35, shL: 1.4, elL: 0.4, head: -0.1 }, k);
    } else {
      // the throw: the arm whips over, then back to standing, a cheer or a wave (or a sulk after a foul)
      const over = { ...POSES.run(a.anim, 0.4), lean: 0.55, twist: 0.4, shR: 1.4, elR: 0.2, shL: -0.6, elL: 0.6 };
      pose = this.phase === 'foul' ? blendPose(POSES.stand(tt), { ...POSES.stand(tt), head: 0.4, lean: 0.2 }, clamp(this.t * 3, 0, 1))
        : blendPose(over, POSES.stand(tt), clamp((tt - a.relT - 0.6) * 2, 0, 1));
      if (this.phase === 'landed' && this.t > 0.6) pose = blendPose(pose, this.land && this.land.metres >= 70 ? POSES.cheer(tt) : POSES.wave(tt), clamp((this.t - 0.6) * 3, 0, 1));
    }
    fig.setPose(pose);
    // the pencil: in the hand, tilting up with the angle while drawing back; in flight; stuck in the carpet
    const pen = th.pen;
    if (!this.pen) {
      const h = this.handPos(th);
      pen.position.copy(h);
      pen.rotation.set(0, 0, deg(a.holding ? a.angle : 10));
    } else {
      const p = this.pen;
      if (p.stuck && !paused) { p.wob = Math.max(0, p.wob - dt * 1.6); }
      const wob = p.stuck ? Math.sin(tt * 30) * 0.12 * p.wob : 0;
      pen.position.set(p.x, p.y, p.z);
      pen.rotation.set(p.roll, 0, p.pitch + wob);
      if (this.phase === 'flight' && !paused && Math.random() < 0.3) this.particles.emit(p.x - Math.cos(p.pitch) * 5, p.y - Math.sin(p.pitch) * 5, p.z, { vx: 0, spread: 0.6, up: 0, color: 0xffffff, size: 0.5, life: 0.35, alpha: 0.35, grav: 0, n: 1 });
    }
  }

  updateHud() {
    const th = this.cur, ph = this.phase, a = this.ath;
    const showP = !!th && !!a && a.holding && !a.released;
    this.protractor.visible = showP;
    if (showP) { this.protractor.position.set(a.x - 2, 11.5, 3); this.needle.rotation.z = deg(a.angle); }
    const show = th && th.c.human && (ph === 'ready' || ph === 'runup');
    this.hudG.classList.toggle('jv-hidden', !show);
    if (!show) return;
    const e = clamp(a.v / VMAX, 0, 1);
    const sp = this.hudG.querySelector('.sp');
    sp.querySelector('i').style.width = `${(e * 100).toFixed(0)}%`;
    sp.classList.toggle('go', e > 0.9);
  }

  applyCamera(dt) {
    const R = this.ctx.R, c = this.cam, ph = this.phase;
    let want;
    if (ph === 'flight' && this.pen) {
      const p = this.pen;
      want = { x: p.x + 14, y: Math.max(4, p.y * 0.8), z: 0, yaw: 0.12, pitch: 0.36, width: 128 };
    } else if ((ph === 'landed') && this.pen) {
      want = { x: this.pen.x + 2, y: 2, z: 2, yaw: 0.35, pitch: 0.42, width: 62 };
    } else if (ph === 'done') {
      want = { x: RUN_X - 4, y: 6, z: -18, yaw: 0.25, pitch: 0.3, width: 70 };
    } else {
      const ax = this.ath ? this.ath.x : RUN_X;
      want = { x: ax + 22, y: 5, z: 0, yaw: 0.18, pitch: 0.3, width: 78 };
    }
    const rate = ph === 'flight' ? 4 : 2.6;
    for (const k of Object.keys(want)) c[k] = dt >= 1 ? want[k] : damp(c[k], want[k], rate, Math.min(dt, 0.1));
    R.orbit(c.x, c.y, c.z, { yaw: c.yaw, pitch: c.pitch, width: c.width, shadowSpan: Math.max(150, c.width * 1.8) });
    R.setFocus(0.5, 0.26, 0.85);
  }

  dispose() {
    for (const t of this.throwers) t.fig.dispose();
  }
}

export default {
  id: 'javelin', name: 'Javelin', season: 'Summer',
  blurb: 'A pencil javelin down the living-room carpet: three throws each, the longest counts.',
  venue: 'The big rug in the living room, a runway of masking tape, a red foul line and a tape measure.',
  loading: 'Sharpening the javelins…',
  how: [
    { verb: 'Rhythm', text: 'Tap <b>left</b> and <b>right</b> in turn to run up: faster run, longer throw.' },
    { verb: 'Power', text: 'Near the line, <b>hold action</b> to draw back: the pencil tips up as you hold. Let go at <b>30 to 40°</b>.' },
    { verb: 'Timing', text: 'Let go before the <b>red line</b>: step over it and the throw doesn\'t count. Three throws, the best one counts.' },
  ],
  better: 'higher',
  resultsDelay: 0.6,
  create: (ctx) => new Javelin(ctx),
};
