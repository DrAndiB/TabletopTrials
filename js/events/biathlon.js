// Biathlon: a mass start on one cotton-wool loop around the coffee table, up and over a sofa cushion,
// with a shooting range of bottle caps on a shoebox. Two laps; the range comes after the first.
// Flats: a steady skating rhythm. The climb: a slower, heavier beat (pushing harder sends your heart
// racing). The descent: hold ACTION to tuck and get your breath back, then hold LEFT through the curve at
// the bottom or end up in the cotton wool. At the range: LEFT/RIGHT steady the sight, ACTION shoots; the
// sight sways more the faster your heart beats. Every miss is a penalty loop.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, blendPose, REST } from '../figurine.js';
import { crowd, banner } from '../props.js';
import { Rhythm, BotTapper } from '../verbs.js';
import { Particles } from '../fx.js';
import { clamp, damp, rng, makeNoise2D } from '../util.js';

// ---------- the loop ----------
// a rounded rectangle around the coffee table, driven clockwise seen from above (+x along the front)
const HX = 110, HZ = 60, CR = 30;
const PIECES = [
  ['flat', 'line', [0, HZ], [HX - CR, HZ]],
  ['flat', 'arc', [HX - CR, HZ - CR], 0.5 * Math.PI, 0],       // centre, from angle, to angle (x = cos, z = sin)
  ['flat', 'line', [HX, HZ - CR], [HX, -HZ + CR]],
  ['flat', 'arc', [HX - CR, -HZ + CR], 0, -0.5 * Math.PI],
  ['flat', 'line', [HX - CR, -HZ], [-5, -HZ]],
  ['climb', 'line', [-5, -HZ], [-30, -HZ]],
  ['top', 'line', [-30, -HZ], [-45, -HZ]],
  ['descent', 'line', [-45, -HZ], [-HX + CR, -HZ]],
  ['curve', 'arc', [-HX + CR, -HZ + CR], -0.5 * Math.PI, -Math.PI],
  ['flat', 'line', [-HX, -HZ + CR], [-HX, HZ - CR]],
  ['flat', 'arc', [-HX + CR, HZ - CR], -Math.PI, -1.5 * Math.PI],
  ['flat', 'line', [-HX + CR, HZ], [0, HZ]],
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
const PEAK = 14;               // the cushion's height
const LAPS = 2;
const RANGE_SEG = SEG[9];      // the left straight: the range is beside it
const PEN = { x: -138, z: 44, r: 9 };   // the penalty loop
const PEN_LEN = 2 * Math.PI * PEN.r;
const SHOTS = 5;
const T_FLAT = 6, T_CLIMB = 4;
const V_FLAT = 34, V_CLIMB = 15, V_TUCK = 48, V_UP = 30, V_SAFE = 33;
const ORD = ['1st', '2nd', '3rd', '4th'];
const BOT = {
  easy: { cad: 0.84, push: 0.25, tuck: 0.55, steer: 0.8, aimT: [1.5, 0.6], hit: 0.5 },
  normal: { cad: 0.94, push: 0.12, tuck: 0.85, steer: 0.93, aimT: [1.1, 0.4], hit: 0.7 },
  hard: { cad: 1.0, push: 0.05, tuck: 1, steer: 0.98, aimT: [0.8, 0.25], hit: 0.84 },
};

function segAt(s) {
  s = ((s % LAP) + LAP) % LAP;
  let k = 0;
  while (k < SEG.length - 1 && s >= SEG[k + 1].s0) k++;
  return { seg: SEG[k], u: (s - SEG[k].s0) / SEG[k].len, k };
}
// position, heading (direction of travel) and height on the loop at distance s, with a sideways offset
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
  // offset to the left of travel is negative, outward (right of travel on this clockwise loop) positive
  const nx = -dz, nz = dx;
  let y = 0, slope = 0;
  if (seg.kind === 'climb') { y = PEAK * u; slope = PEAK / seg.len; }
  else if (seg.kind === 'top') y = PEAK;
  else if (seg.kind === 'descent') { const k = 1 - u; y = PEAK * k * k * (3 - 2 * k); slope = -PEAK * 6 * u * (1 - u) / seg.len; }
  return { x: x - nx * off, z: z - nz * off, dx, dz, y, slope, kind: seg.kind };
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
    this.buildRange(K, competitors.length);
    this.buildCrowd(K, competitors);
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
      this.skiers.push({
        c, fig, holder, i, s: -6 - (i % 2) * 5, dist: -6 - (i % 2) * 5, lap: 0, v: 0, off: offs[i], pref: offs[i], hr: 0.35, effort: 0,
        rhythm: new Rhythm({ target: T_FLAT }), anim: this.r(), state: 'race', crashT: 0, grip: 0, curveT: 0, tuck: false,
        shots: [], aim: { x: 0, y: 0, t: 0 }, pen: 0, penS: 0, finished: false, time: null, ranged: false, mat: i,
        bot: c.human ? null : { tap: new BotTapper(c.pad, rng(c.seed * 11 + 1)), next: 0 },
        botTuck: this.r(), botSteer: this.r(), idle: this.r() * 10,
      });
    });
    this.buildHud();
    this.placeAll(true);
    this.applyCamera(1);
  }

  buildRoom(K) {
    const g = K.group;
    const T = K.TX.woodTextures({ size: 1024, planks: 4, base: 0x9a7356, dark: 0x5f4532, light: 0xbf9a78, seed: 35, ringFreq: 12, roughBase: 0.55, lacquer: 0.35, grainContrast: 0.8 });
    const geo = new THREE.PlaneGeometry(800, 600).rotateX(-Math.PI / 2);
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
    const rug = new THREE.Mesh(new K.RoundedBoxGeometry(400, 1, 210, 2, 0.4), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(rc, { repeat: [6, 3] }), roughness: 1 }));
    rug.position.set(-20, 0.5, 0); rug.receiveShadow = true; g.add(rug);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(800, 300), K.std({ color: 0xbcc9d8, roughness: 0.95 }));
    wall.position.set(0, 150, -170); g.add(wall);
    // the coffee table in the middle, plush fans on top
    const wood = new THREE.MeshPhysicalMaterial({ color: 0x8a5a36, roughness: 0.35, clearcoat: 0.6 });
    const top = new THREE.Mesh(new K.RoundedBoxGeometry(112, 4, 44, 3, 1.4), wood);
    top.position.set(0, 20, 0); top.castShadow = true; top.receiveShadow = true; g.add(top);
    for (const x of [-49, 49]) for (const z of [-16, 16]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.6, 18, 10), wood); leg.position.set(x, 9, z); leg.castShadow = true; g.add(leg); }
    K.contact(0, 0, 60, 26, 0.4);
    this.tableTop = 22;
  }

  buildTrack(K) {
    const g = K.group;
    const W = 20, Y = 1.05;
    // the cotton-wool ribbon: a strip following the loop, piled up over the cushion
    const N = 320, verts = [], uvs = [], idx = [];
    for (let k = 0; k <= N; k++) {
      const s = (k / N) * LAP;
      for (const side of [-1, 1]) {
        const p = trackAt(s, side * W / 2);
        verts.push(p.x, Y + p.y + 0.2, p.z); uvs.push(s / 20, side > 0 ? 1 : 0);
      }
      if (k < N) idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); rg.setIndex(idx); rg.computeVertexNormals();
    const fluff = K.TX.noiseField(256, { seed: 12, period: 10, oct: 4 });
    const snowM = new THREE.MeshStandardMaterial({ color: 0xfbfbfd, roughness: 1, normalMap: K.TX.toTexture(K.TX.normalFromHeight(fluff, 256, 256, 3), { srgb: false, repeat: [1, 1] }), side: THREE.DoubleSide });
    const ribbon = new THREE.Mesh(rg, snowM);
    ribbon.receiveShadow = true; g.add(ribbon);
    // the snow ramp body over the cushion (climb, top, descent), and the cushion poking out of it
    const sh = new THREE.Shape();
    const xs = [];
    for (let k = 0; k <= 40; k++) xs.push(SEG[5].s0 + (k / 40) * (SEG[5].len + SEG[6].len + SEG[7].len));
    sh.moveTo(-trackAt(xs[0]).x, 0);
    xs.forEach((s) => { const p = trackAt(s); sh.lineTo(-p.x, p.y + Y); });
    sh.lineTo(-trackAt(xs[xs.length - 1]).x, 0);
    sh.closePath();
    const ramp = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1, bevelSegments: 3 }), snowM);
    ramp.rotation.y = Math.PI; ramp.position.set(0, 0, -HZ + W / 2);
    ramp.castShadow = true; ramp.receiveShadow = true; g.add(ramp);
    const cushion = new THREE.Mesh(new K.RoundedBoxGeometry(24, PEAK - 1, 30, 4, 4), new THREE.MeshPhysicalMaterial({ color: 0xc4655a, roughness: 0.85, sheen: 0.7, sheenColor: 0xffd6c8 }));
    cushion.position.set(-37.5, (PEAK - 1) / 2, -HZ); cushion.castShadow = true; g.add(cushion);
    // cotton-wool balls along both edges
    const balls = [];
    for (let s = 0; s < LAP; s += 4.2) for (const side of [-1, 1]) {
      const p = trackAt(s + this.r(), side * (W / 2 + 0.8));
      balls.push({ x: p.x, y: Y + p.y + 0.6, z: p.z, s: 1.2 + this.r() * 1.3, sy: 0.75 });
    }
    // the penalty loop: a small ring of cotton wool
    for (let k = 0; k < 28; k++) { const a = (k / 28) * Math.PI * 2; for (const rr of [PEN.r - 4, PEN.r + 4]) balls.push({ x: PEN.x + Math.cos(a) * rr, y: 1.6, z: PEN.z + Math.sin(a) * rr, s: 1.1 + this.r(), sy: 0.75 }); }
    // the soft landing at the bottom curve: a big drift
    for (let k = 0; k < 14; k++) balls.push({ x: -HX - 14 + this.r() * 10, y: 2, z: -HZ - 14 + this.r() * 12, s: 3 + this.r() * 3, sy: 0.8 });
    K.instances(new THREE.IcosahedronGeometry(1, 2), K.felt(0xfbfbfd, { sheenColor: 0xffffff }), balls);
    const pen = new THREE.Mesh(new THREE.RingGeometry(PEN.r - 4, PEN.r + 4, 40).rotateX(-Math.PI / 2), snowM);
    pen.position.set(PEN.x, 1.2, PEN.z); pen.receiveShadow = true; g.add(pen);
    // start/finish line in red tape, and a cardboard arrow sign at the bottom curve
    const p0 = trackAt(0);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1.6, W).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe23b2e, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.position.set(p0.x, Y + 0.3, p0.z); g.add(line);
    const sc = K.TX.makeCanvas(128, 96), c = sc.getContext('2d');
    c.fillStyle = '#c69a62'; c.fillRect(0, 0, 128, 96); c.fillStyle = '#e23b2e';
    c.beginPath(); c.moveTo(18, 48); c.lineTo(62, 12); c.lineTo(62, 34); c.lineTo(112, 34); c.lineTo(112, 62); c.lineTo(62, 62); c.lineTo(62, 84); c.fill();
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 9), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(sc, { wrap: false }), roughness: 0.9, side: THREE.DoubleSide }));
    sign.position.set(-HX + CR - 6, 12, -HZ - 14); sign.rotation.y = 0.2; sign.castShadow = true; g.add(sign);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 8, 6), K.std({ color: 0xe9d3a8 }));
    stick.position.set(-HX + CR - 6, 4, -HZ - 14); g.add(stick);
  }

  buildRange(K, n) {
    const g = K.group;
    // shooting mats beside the left straight, and the shoebox with five caps per lane
    this.mats = [];
    const matM = new THREE.MeshStandardMaterial({ color: 0x2fae5a, roughness: 0.9 });
    const card = K.std({ color: 0xc69a62, roughness: 0.9 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(22, 12, 84), [card, card, K.std({ color: 0xd8b07c, roughness: 0.9 }), card, card, card]);
    box.position.set(-205, 6, 0); box.castShadow = true; box.receiveShadow = true; g.add(box);
    // bottle caps lying on the lid, black side up; a hit flips one over to its white side
    const capGeo = new THREE.CylinderGeometry(1.5, 1.6, 0.55, 24);
    const capM = [new THREE.MeshPhysicalMaterial({ color: 0xb9bcc2, roughness: 0.3, metalness: 0.6 }), new THREE.MeshPhysicalMaterial({ color: 0x1f1a17, roughness: 0.35, clearcoat: 0.5 }), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })];
    this.targets = [];
    for (let i = 0; i < n; i++) {
      const s = RANGE_SEG.s0 + 10 + i * (RANGE_SEG.len - 20) / Math.max(1, n - 1);
      const p = trackAt(s, 16);
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(9, 6).rotateX(-Math.PI / 2), matM);
      mat.position.set(p.x, 1.1, p.z); mat.receiveShadow = true; g.add(mat);
      this.mats.push({ s, x: p.x, z: p.z });
      const row = [];
      for (let k = 0; k < SHOTS; k++) {
        const cap = new THREE.Mesh(capGeo, capM);
        const cx = -205 + (k < 3 ? -3.6 : 3.6) + 0, cz = p.z + (k < 3 ? (k - 1) * 3.8 : (k - 3.5) * 3.8);
        cap.position.set(cx, 12.3, cz);
        cap.castShadow = true; g.add(cap);
        row.push({ cap, flip: -1 });
      }
      this.targets.push(row);
    }
  }

  buildCrowd(K, competitors) {
    const spots = [];
    for (let k = 0; k < 6; k++) spots.push({ x: -42 + k * 17, y: this.tableTop, z: -8 + (k % 2) * 14, ry: (k % 2) ? 0.3 : -0.3, size: 10 });
    for (let k = 0; k < 4; k++) spots.push({ x: 160, y: 1, z: -40 + k * 26, ry: -1.3, size: 12 });
    for (let k = 0; k < 3; k++) spots.push({ x: -40 + k * 30, y: 1, z: -110, ry: 0.1, size: 12 });
    this.crowd = crowd(K.group, spots, 33);
    [[60, -96], [150, 70], [-170, -70]].forEach(([x, z], k) => {
      const b = banner(competitors[k % competitors.length].code, 15, { seed: 80 + k });
      b.position.set(x, 0, z); b.rotation.y = (this.r() - 0.5) * 0.4;
      K.group.add(b);
    });
  }

  buildHud() {
    const el = this.ctx.hud.el;
    const style = document.createElement('style');
    style.textContent = `.bi-m{position:absolute;left:12px;width:min(290px,44vw);background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17;padding:5px 10px 7px;font:800 12px/1.2 Rubik,sans-serif;color:#1f1a17}
      .bi-m .h{display:flex;align-items:center;gap:6px}.bi-m img{height:18px;width:27px;object-fit:cover;border-radius:3px;border:2px solid #1f1a17}
      .bi-m .k{margin-left:auto;font-weight:700;color:#4a413a;text-align:right}
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
      this.meters.push({ sk, d, tip: d.querySelector('.k'), ef: d.querySelector('.ef i'), hr: d.querySelector('.hr i'), caps: d.querySelectorAll('.shoot b'), sight: d.querySelector('.shoot u'), tipText: '', cls: '' });
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
    const lead = this.skiers.filter((s) => s.finished).length;
    if (lead && (this.skiers.every((s) => s.finished) || now - this.firstFinish > 25)) this.finishAll();
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
    const here = trackAt(sk.s);
    const kind = sk.state === 'pen' ? 'flat' : here.kind;
    // computer skiers: their own rhythm, tuck and steering
    if (sk.bot && (sk.state === 'race' || sk.state === 'pen')) {
      const target = kind === 'climb' || kind === 'top' ? T_CLIMB * (B.cad + (this.r() < B.push ? 0.35 : 0)) : T_FLAT * B.cad;
      const glide = kind === 'descent' || kind === 'curve';
      if (glide && sk.bot.tap.on) sk.bot.tap.stop();
      else if (!glide && !sk.bot.tap.on) sk.bot.tap.start(now);
      if (!glide) sk.bot.tap.update(now, target, 0.08, 0.004);
    }
    if (sk.state === 'race' || sk.state === 'pen') {
      for (const e of q) if (e.down && e.b !== 'action') { const res = sk.rhythm.press(e.b, e.t); if (res === 'stumble') sk.v *= 0.9; }
      sk.rhythm.target = kind === 'climb' || kind === 'top' ? T_CLIMB : T_FLAT;
      let eff = sk.rhythm.effort(now);
      const x = sk.rhythm.cadence(now) / sk.rhythm.target;
      const tuck = sk.bot ? (kind === 'descent' && sk.botTuck < B.tuck) : held.action;
      sk.tuck = tuck && kind === 'descent';
      // heart rate: up with effort (much more when pushing too hard uphill), down in a tuck or at rest
      let hrT, rate;
      if (kind === 'climb' || kind === 'top') { hrT = 0.6 + 0.3 * eff + 0.9 * Math.max(0, x - 1.1); rate = 0.8; }
      else if (kind === 'descent' || kind === 'curve') { hrT = sk.tuck ? 0.28 : 0.45; rate = sk.tuck ? 0.9 : 0.5; }
      else { hrT = 0.42 + 0.35 * eff; rate = sk.hr > hrT ? 0.3 : 0.5; }
      sk.hr = clamp(sk.hr + (hrT - sk.hr) * rate * dt, 0.2, 1);
      // uphill, legs spinning too fast just slip on the cotton wool
      if ((kind === 'climb' || kind === 'top') && x > 1.2) eff *= Math.max(0.45, 1 - (x - 1.2) * 0.8);
      if (sk.hr > 0.92) eff *= 0.8;
      sk.effort = eff;
      let vT, k;
      if (kind === 'climb' || kind === 'top') { vT = V_CLIMB * eff + (kind === 'top' ? 8 : 0); k = 2.2; }
      else if (kind === 'descent') { vT = sk.tuck ? V_TUCK : V_UP; k = 1.4; }
      else if (kind === 'curve') { vT = Math.max(sk.v, V_FLAT * eff) * 0.985; k = 0.8; }
      else { vT = V_FLAT * eff; k = 1.6; }
      sk.v += (vT - sk.v) * (1 - Math.exp(-k * dt));
      // the bottom curve: steer left all the way round or crash into the cotton wool
      if (kind === 'curve' && sk.state === 'race') {
        const left = sk.bot ? sk.botSteer < B.steer : held.left && !held.right;
        sk.curveT += dt; if (left) sk.grip += dt;
        const u = segAt(sk.s).u;
        if (u > 0.55 && !sk.curveDone) {
          sk.curveDone = true;
          if (sk.v > V_SAFE && sk.grip / sk.curveT < 0.6) this.crash(sk);
        }
      } else if (kind !== 'curve') { sk.curveT = 0; sk.grip = 0; sk.curveDone = false; if (sk.bot) sk.botSteer = this.r(); }
      if (kind !== 'descent' && sk.bot) sk.botTuck = this.r();
      // move along; the penalty loop is its own little circle
      const ds = sk.v * dt;
      if (sk.state === 'pen') {
        sk.penS += ds;
        if (sk.penS >= sk.pen * PEN_LEN) { sk.state = 'race'; sk.s = SEG[10].s0 + 2; sk.pen = 0; sk.blend = 0.5; }
      } else {
        sk.s += ds;
        // into the range on the first lap
        if (!sk.ranged && sk.lap === 0 && sk.s >= this.mats[sk.mat].s - 18) sk.state = 'toRange';
        if (sk.s >= LAP) { sk.s -= LAP; sk.lap++; if (sk.lap >= LAPS) this.finishSkier(sk, now); }
      }
    } else if (sk.state === 'crash') {
      if (!sk.ranged && sk.lap === 0 && sk.s >= this.mats[sk.mat].s - 18) { sk.state = 'toRange'; sk.v = Math.max(sk.v, 6); }
      sk.v = Math.max(0, sk.v - 40 * dt); sk.s += sk.v * dt;
      sk.crashT -= dt;
      sk.hr = clamp(sk.hr + (0.4 - sk.hr) * 0.5 * dt, 0.2, 1);
      if (sk.crashT <= 0) { sk.state = 'race'; sk.v = 4; }
    } else if (sk.state === 'toRange') {
      // glide out to the mat and stop
      const m = this.mats[sk.mat];
      sk.v = Math.max(6, sk.v - 30 * dt);
      sk.s = Math.min(m.s, sk.s + sk.v * dt);
      sk.off = damp(sk.off, 16, 4, dt);
      if (sk.s >= m.s - 0.05) { sk.state = 'shoot'; sk.v = 0; sk.shootT = 0; sk.aim = { x: 0, y: 0, t: this.r() * 10, nudge: 0 }; sk.aim.t0 = sk.aim.t; sk.bot?.tap.stop(); if (sk.bot) sk.bot.next = now + B.aimT[0] + this.r.gauss() * B.aimT[1] * 0.5; }
    } else if (sk.state === 'shoot') {
      sk.shootT += dt;
      sk.hr = clamp(sk.hr + (0.28 - sk.hr) * 0.25 * dt, 0.2, 1);
      // the sight sways with the heart rate; left/right nudge it back
      const A = 0.2 + 1.05 * sk.hr * sk.hr;
      const a = sk.aim;
      a.t += dt;
      const steer = sk.bot ? 0 : (held.right ? 1 : 0) - (held.left ? 1 : 0);
      a.nudge = clamp(a.nudge + steer * 2.4 * dt, -2.5, 2.5);
      a.x = A * (0.8 * Math.sin(1.3 * a.t) + 0.35 * Math.sin(3.1 * a.t + 1)) + a.nudge;
      a.y = A * 0.75 * Math.sin(1.9 * a.t + 0.5);
      // nobody waits for ever: after five seconds the shot goes off by itself
      let fire = q.some((e) => e.b === 'action' && e.down) || a.t - (a.t0 ?? 0) > 5;
      let forced = null;
      if (sk.bot && now >= sk.bot.next) {
        fire = true;
        forced = this.r() < B.hit - Math.max(0, sk.hr - 0.5) * 0.4;
        sk.bot.next = now + Math.max(0.5, B.aimT[0] + this.r.gauss() * B.aimT[1]);
      }
      if (fire) this.shoot(sk, forced);
    } else if (sk.state === 'leaveRange') {
      sk.off = damp(sk.off, sk.pref, 3, dt);
      sk.v = Math.min(V_FLAT * 0.7, sk.v + 20 * dt);
      sk.s += sk.v * dt;
      if (Math.abs(sk.off - sk.pref) < 1) {
        if (sk.pen > 0) { sk.state = 'pen'; sk.penS = 0; sk.blend = 0.5; if (sk.c.human) ctx.hud.flash(`${sk.c.short}: ${sk.pen} penalty loop${sk.pen > 1 ? 's' : ''}`, '#ff8a65'); }
        else sk.state = 'race';
      }
      if (sk.bot && sk.state !== 'leaveRange') sk.bot.tap.start(now);
    }
    if (sk.blend > 0) sk.blend = Math.max(0, sk.blend - dt);
  }

  shoot(sk, forced) {
    const ctx = this.ctx;
    const k = sk.shots.length;
    const a = sk.aim;
    const hit = forced != null ? forced : Math.hypot(a.x, a.y) < 0.62;
    sk.shots.push(hit);
    ctx.sound.pop();
    const t = this.targets[sk.mat][k];
    if (hit) { t.flip = 0; ctx.sound.clack(0); this.particles.emit(t.cap.position.x, t.cap.position.y + 1, t.cap.position.z, { vx: 3, spread: 2, up: 2, color: 0xffffff, size: 0.5, life: 0.35, alpha: 0.7, grav: 6, n: 6 }); }
    a.nudge *= 0.4;
    a.t0 = a.t;
    if (sk.shots.length >= SHOTS) {
      sk.pen = sk.shots.filter((h) => !h).length;
      sk.ranged = true;
      sk.state = 'leaveRange'; sk.v = 4;
      if (sk.c.human) ctx.hud.flash(sk.pen ? `${sk.c.short}: ${SHOTS - sk.pen}/${SHOTS}` : `${sk.c.short}: clean shooting!`, sk.pen ? '#ffffff' : '#7be495');
    }
  }

  crash(sk) {
    sk.state = 'crash'; sk.crashT = 1.6; sk.crashes = (sk.crashes || 0) + 1;
    this.ctx.sound.puff(); this.ctx.sound.aww();
    const p = trackAt(sk.s, sk.off);
    this.particles.emit(p.x, 2, p.z, { vx: 0, spread: 8, up: 6, color: 0xffffff, size: 2.4, life: 1.0, alpha: 0.7, grav: 6, grow: 1.6, n: 30 });
    if (sk.c.human) this.ctx.hud.flash(`${sk.c.short}: into the cotton wool!`, '#ff8a65');
  }

  // faster skiers swing out to pass; everyone drifts back to their own line afterwards
  overtake(dt) {
    const L = this.skiers.filter((s) => s.state === 'race' || s.state === 'pen');
    for (const a of L) {
      let want = a.pref;
      for (const b of L) {
        if (a === b || a.state !== b.state) continue;
        const ahead = (b.dist - a.dist);
        if (ahead > 0 && ahead < 9 && Math.abs(b.off - a.off) < 4 && a.v > b.v - 1) want = b.off + (b.off > 3 ? -7 : 7);
      }
      a.off = damp(a.off, clamp(want, -8, 8), 3, dt);
    }
    for (const s of this.skiers) s.dist = (s.lap + (s.finished ? LAPS : 0)) * LAP + s.s + (s.state === 'pen' ? 0 : 0);
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
    this.results = this.skiers.map((s) => {
      const hits = s.shots.filter((h) => h).length;
      const sub = `shooting ${hits}/${SHOTS}${s.crashes ? ` · ${s.crashes} tumble${s.crashes > 1 ? 's' : ''}` : ''}`;
      return s.finished ? { value: s.time, text: `${s.time.toFixed(1)} s`, short: `${s.time.toFixed(1)} s`, sub } : { value: null, dnf: true, text: 'Didn\'t finish', sub };
    });
  }

  // which part of the loop is at s (for tests)
  kindAt(s) { return trackAt(s).kind; }

  // ---------------------------------------------------------------- per frame
  placeAll(snap) {
    for (const sk of this.skiers) this.placeSkier(sk, snap ? 1 : 0, 0);
  }

  placeSkier(sk, dt, tt) {
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
    if (sk.state === 'shoot') head = Math.PI;   // facing the shoebox (-x)
    let dh = head - H.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    H.rotation.y = dt >= 1 ? head : H.rotation.y + dh * (1 - Math.exp(-10 * dt));
    H.rotation.z = Math.atan(p.slope || 0);
    void tt;
  }

  frame(dt, paused) {
    const ctx = this.ctx, tt = ctx.time();
    if (!paused) this.particles.update(dt);
    for (const sk of this.skiers) {
      if (!paused) this.placeSkier(sk, dt, tt);
      const fig = sk.fig;
      fig.ground = true;
      let pose;
      const kind = sk.state === 'pen' ? 'flat' : trackAt(sk.s).kind;
      if (this.phase === 'pre' || this.phase === 'attract' || this.phase === 'countdown') pose = (this.phase === 'countdown') ? { ...POSES.tuck(0), lean: 0.6, y: -0.6 } : POSES.stand(tt + sk.idle);
      else if (sk.finished && sk.v < 3) pose = sk.place === 0 ? POSES.cheer(tt) : POSES.wave(tt + sk.idle);
      else if (sk.state === 'crash') pose = POSES.heap();
      else if (sk.state === 'shoot') pose = { ...REST, lean: 0.15, head: 0.1, shL: 1.45, shR: 1.35, abL: 0.05, elL: 0.25, elR: 0.7, hipL: 0.15, kneeL: 0.2, hipR: -0.1 };
      else if (sk.tuck || kind === 'descent') pose = POSES.tuck(0);
      else {
        if (!paused) sk.anim = (sk.anim + Math.max(sk.rhythm.cadence(tt), sk.v / 8) * 0.5 * dt) % 1;
        const run = POSES.run(sk.anim, clamp(sk.v / V_FLAT, 0.3, 1));
        const sw = Math.sin(sk.anim * Math.PI * 2);
        // skating: legs push out to the sides, a deep lean; uphill shorter and bent over
        pose = { ...run, lean: kind === 'climb' ? 0.75 : 0.45, spL: 0.25 + 0.2 * Math.max(0, sw), spR: 0.25 + 0.2 * Math.max(0, -sw), hipL: run.hipL * 0.6, hipR: run.hipR * 0.6, vee: 0.25 };
        if (kind === 'curve') pose = blendPose(pose, { ...pose, roll: -0.5 }, 0.8);
      }
      fig.setPose(pose);
      if (!paused && sk.v > 20 && Math.random() < 0.3) { const hp = sk.holder.position; this.particles.emit(hp.x, hp.y - 0.8, hp.z, { vx: 0, spread: 2, up: 1.5, color: 0xffffff, size: 0.8, life: 0.45, alpha: 0.45, grav: 4, n: 1 }); }
    }
    // hit caps flip over with a little hop
    if (!paused) for (const row of this.targets) for (const t of row) if (t.flip >= 0 && t.flip < 1) { t.flip = Math.min(1, t.flip + dt / 0.3); t.cap.rotation.x = Math.PI * t.flip; t.cap.position.y = 12.3 + Math.sin(Math.PI * t.flip) * 2.5; }
    this.crowd.update(tt, this.phase === 'race' ? 0.5 : this.phase === 'done' ? 0.6 : 0.15);
    this.updateHud(tt);
    this.applyCamera(dt);
  }

  updateHud(tt) {
    const ctx = this.ctx;
    const order = [...this.skiers].sort((a, b) => (b.finished - a.finished) || (a.finished && b.finished ? a.time - b.time : b.dist - a.dist));
    this.skiers.forEach((s, i) => ctx.hud.chip(i, this.phase === 'race' || this.phase === 'done' ? (s.finished ? `${ORD[s.place]} · ${s.time.toFixed(1)}` : `${ORD[order.indexOf(s)]}${s.state === 'pen' ? ' · loop' : s.state === 'shoot' || s.state === 'toRange' ? ' · range' : ''}`) : '', s.finished && s.place === 0 ? 'active' : ''));
    this.card.style.display = this.phase === 'race' ? '' : 'none';
    this.card.querySelector('ol').innerHTML = order.map((s, k) => `<li><span>${ORD[k]}</span><img src="${s.c.flag}" alt=""><span>${s.c.short}</span><b>${s.finished ? s.time.toFixed(1) : `lap ${Math.min(LAPS, s.lap + 1)}`}</b></li>`).join('');
    for (const m of this.meters) {
      const sk = m.sk;
      const kind = sk.state === 'pen' ? 'flat' : trackAt(sk.s).kind;
      const touch = sk.c.type === 'touch';
      const range = sk.state === 'shoot';
      const cls = range ? 'bi-m range' : 'bi-m';
      if (cls !== m.cls) { m.d.className = cls; m.cls = cls; }
      const tip = this.phase !== 'race' ? (sk.finished ? '' : 'skate: left, right…')
        : sk.finished ? 'finished!' : sk.state === 'crash' ? 'oops, up you get…' : range ? `steady with ${touch ? '◀ ▶' : 'left/right'}, ${touch ? '●' : 'action'} to shoot`
          : sk.state === 'pen' ? `penalty loop${sk.pen > 1 ? 's' : ''}: skate!` : kind === 'climb' || kind === 'top' ? 'uphill: slower, heavy beat' : kind === 'descent' ? `hold ${touch ? '●' : 'action'} to tuck!` : kind === 'curve' ? `hold ${touch ? '◀' : 'left'} to steer!` : `skate: ${touch ? '◀ ▶' : 'left, right'} in turn`;
      if (tip !== m.tipText) { m.tip.textContent = tip; m.tipText = tip; }
      m.ef.style.width = `${clamp(sk.effort / 1.04, 0, 1) * 100}%`;
      m.hr.style.width = `${clamp((sk.hr - 0.2) / 0.8, 0, 1) * 100}%`;
      if (range) {
        const k = Math.min(sk.shots.length, SHOTS - 1);
        m.caps.forEach((b, i) => { b.className = i < sk.shots.length ? (sk.shots[i] ? 'hit' : 'miss') : ''; });
        m.sight.style.left = `${10 + k * 20 + sk.aim.x * 7}%`;
        m.sight.style.top = `${50 + sk.aim.y * 36}%`;
      }
    }
    void tt;
  }

  applyCamera(dt) {
    const R = this.ctx.R, c = this.cam;
    // frame every skier (the whole loop when they're spread out)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const s of this.skiers) { const p = s.holder.position; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    if (!isFinite(x0)) { x0 = -60; x1 = 60; z0 = -40; z1 = 40; }
    // keep the shoebox in view while anyone is shooting
    if (this.skiers.some((s) => s.state === 'shoot' || s.state === 'toRange')) x0 = Math.min(x0, -212);
    const span = Math.max(x1 - x0, (z1 - z0) * 1.9);
    const want = { x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2 + 6, yaw: 0, pitch: 0.95, width: clamp(span + 90, 150, 380) };
    const rate = 1.6;
    for (const k of Object.keys(want)) c[k] = dt >= 1 ? want[k] : damp(c[k], want[k], rate, Math.min(dt, 0.1));
    R.orbit(c.x, c.y, c.z, { yaw: c.yaw, pitch: c.pitch, width: c.width, shadowSpan: Math.max(260, c.width * 1.6) });
    R.setFocus(0.5, 0.45, 0.6);
  }

  dispose() {
    for (const s of this.skiers) s.fig.dispose();
  }
}

export default {
  id: 'biathlon', name: 'Biathlon', season: 'Winter',
  blurb: 'A mass start round the coffee table, over a sofa cushion, with bottle caps to shoot down.',
  venue: 'A cotton-wool loop round the coffee table, up and over a sofa cushion, and a shoebox shooting range.',
  loading: 'Laying out the cotton wool…',
  how: [
    { verb: 'Rhythm', text: 'Skate with <b>left</b>, <b>right</b> in turn. Uphill, a slower, heavier beat: pushing too hard sends your heart racing.' },
    { verb: 'Power', text: 'Downhill, <b>hold action</b> to tuck: faster, and your heart calms down. Then <b>hold left</b> through the curve at the bottom, or into the cotton wool you go.' },
    { verb: 'Timing', text: 'At the range: <b>left/right</b> steady the sight, <b>action</b> shoots. It sways more when your heart is racing. Each miss is a penalty loop. Two laps, the range after the first.' },
  ],
  better: 'lower',
  resultsDelay: 0.9,
  create: (ctx) => new Biathlon(ctx),
};
