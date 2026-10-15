// Ski jump: a big book propped on cushions is the in-run, a ruler on a tower of letter blocks the
// take-off table, and a sheet-covered cushion dusted with flour the landing hill. Two jumps each.
// Hold ACTION to tuck, steer LEFT/RIGHT to stay balanced, let go of ACTION at the edge to jump,
// lean with LEFT/RIGHT against the desk fan's gusts, and press ACTION just before touchdown to land
// a telemark.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, blendPose, REST } from '../figurine.js';
import { crowd, banner, letterBlock, stuffedAnimal } from '../props.js';
import * as P from './skijump-physics.js';
import { Particles } from '../fx.js';
import { clamp, lerp, damp, rng, makeNoise2D } from '../util.js';

const HILL_Z = 17;            // the hill is 34 wide (z from -17 to 17)
const OUTRUN_X = 104;         // where the baking tray starts
const TRAY_Y = 1.1;
const ORD = ['1st', '2nd', '3rd', '4th'];
const JUDGES = 5;
// computer jumpers: where they let go (units before the edge, mean and spread), how often they check
// their balance (s), how far they let it drift before correcting (in-run and flight), how hard they
// correct, and how precise their landing press is
const BOT = {
  easy: { release: [12, 5], look: 0.24, thr: 0.42, fly: 0.27, push: 0.85, land: 0.16 },
  normal: { release: [8.5, 3.5], look: 0.16, thr: 0.3, fly: 0.2, push: 0.9, land: 0.09 },
  hard: { release: [4.5, 2.5], look: 0.11, thr: 0.22, fly: 0.15, push: 1, land: 0.05 },
};

class SkiJump {
  constructor(ctx) {
    this.ctx = ctx;
    this.r = ctx.rand;
    this.phase = 'pre';
    this.t = 0;
    this.cam = { x: -40, y: 50, z: 0, yaw: 0.35, pitch: 0.12, width: 60 };
    this.excite = 0.1;
    this.jumpers = [];
    this.order = [];
    this.turn = -1;
    this.round = 1;
  }

  // ---------------------------------------------------------------- venue
  async build() {
    const { kit: K, R, competitors } = this.ctx;
    R.setLighting({
      sunDir: [-0.5, 1, 0.7], sunColor: 0xfff1e0, sunIntensity: 2.0,
      hemiSky: 0xdfe8f8, hemiGround: 0x5c4f45, hemiIntensity: 0.6,
      envIntensity: 0.45, exposure: 0.88, background: 0x1c2130, shadowRadius: 4,
    });
    this.noise = makeNoise2D(17);
    this.buildRoom(K);
    this.buildInrun(K);
    this.buildHill(K);
    this.buildOutrun(K);
    this.buildFan(K);
    this.buildJudges(K);
    this.buildCrowd(K, competitors);
    this.particles = new Particles(K.group, 900);
    this.particles.setScale(R.renderer.domElement.height * 0.9);

    competitors.forEach((c, i) => {
      const fig = new Figurine({ paint: c.paint, seed: c.seed, number: c.number });
      fig.setGear('ski');
      const holder = new THREE.Group();
      holder.add(fig.root);
      fig.root.rotation.y = Math.PI / 2;
      K.group.add(holder);
      const j = {
        c, fig, holder, i, jumps: [], total: 0, bot: c.human ? null : this.makeBot(),
        home: { x: 168 + i * 9, z: -14 - (i % 2) * 5 }, idle: this.r() * 10,
      };
      this.jumpers.push(j);
    });
    this.placeWaiting(true);
    this.buildHud();
    this.applyCamera(1);
  }

  fabric(K, { base = '#d9c7a8', stripe = null, check = null, dots = null, seed = 1 } = {}) {
    const c = K.TX.makeCanvas(256), g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    if (check) { g.fillStyle = check; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 0) g.fillRect(x * 32, y * 32, 32, 32); g.globalAlpha = 0.5; for (let k = 0; k < 8; k++) { g.fillRect(k * 32, 0, 32, 256); } g.globalAlpha = 1; }
    if (stripe) { g.fillStyle = stripe; for (let k = 0; k < 8; k++) g.fillRect(0, k * 32 + 8, 256, 12); }
    if (dots) { g.fillStyle = dots; const r = rng(seed); for (let k = 0; k < 60; k++) { g.beginPath(); g.arc(r() * 256, r() * 256, 5 + r() * 3, 0, Math.PI * 2); g.fill(); } }
    // weave
    const img = g.getImageData(0, 0, 256, 256), d = img.data, n = this.noise;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const k = (y * 256 + x) * 4, v = 0.9 + 0.08 * ((x + y) % 2) + (n.noise(x * 0.2, y * 0.2) - 0.5) * 0.1; d[k] *= v; d[k + 1] *= v; d[k + 2] *= v; }
    g.putImageData(img, 0, 0);
    return K.TX.toTexture(c, { repeat: [1, 1] });
  }

  buildRoom(K) {
    const g = K.group;
    // floorboards along the jump
    const T = K.TX.woodTextures({ size: 1024, planks: 4, base: 0x9a7356, dark: 0x5f4532, light: 0xbf9a78, seed: 33, ringFreq: 12, roughBase: 0.55, lacquer: 0.35, grainContrast: 0.8 });
    const geo = new THREE.PlaneGeometry(700, 360);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getZ(i) / 58, pos.getX(i) / 150);
    const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ ...T, roughness: 0.66, envMapIntensity: 0.35 }));
    floor.position.set(60, 0, -60);
    floor.receiveShadow = true;
    g.add(floor);
    // a woolly rug under the landing hill and the outrun
    const rc = K.TX.makeCanvas(512, 256), rg = rc.getContext('2d');
    const cols = ['#e7ddd0', '#bcd4e6', '#e7ddd0', '#d9c2e0', '#e7ddd0', '#c7e0c9'];
    cols.forEach((col, k) => { rg.fillStyle = col; rg.fillRect(0, k * 43, 512, 43); });
    const rimg = rg.getImageData(0, 0, 512, 256), rd = rimg.data, n = this.noise;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 512; x++) { const k = (y * 512 + x) * 4, v = 0.85 + 0.15 * n.noise(x * 0.5, y * 0.5) + 0.05 * Math.sin(x * 1.3); rd[k] *= v; rd[k + 1] *= v; rd[k + 2] *= v; }
    rg.putImageData(rimg, 0, 0);
    const rh = K.TX.noiseField(256, { seed: 81, period: 64, oct: 2 });
    const rug = new THREE.Mesh(new K.RoundedBoxGeometry(230, 1.2, 100, 2, 0.5), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(rc, { repeat: [1, 1] }), normalMap: K.TX.toTexture(K.TX.normalFromHeight(rh, 256, 256, 2), { srgb: false, repeat: [6, 3] }), roughness: 1 }));
    rug.position.set(80, 0.6, -6);
    rug.receiveShadow = true;
    g.add(rug);
    // the wall with a winter window
    const wc = K.TX.makeCanvas(512, 512), w = wc.getContext('2d');
    w.fillStyle = '#bcc9d8'; w.fillRect(0, 0, 512, 512);
    const r = rng(12);
    w.strokeStyle = 'rgba(240,245,252,0.7)'; w.lineWidth = 3;
    for (let k = 0; k < 26; k++) {
      const x = r() * 512, y = r() * 512, s = 8 + r() * 8;
      for (let a = 0; a < 6; a++) { w.beginPath(); w.moveTo(x, y); w.lineTo(x + Math.cos(a * Math.PI / 3) * s, y + Math.sin(a * Math.PI / 3) * s); w.stroke(); }
    }
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(700, 200), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(wc, { repeat: [5, 1.5] }), roughness: 0.95 }));
    wall.position.set(60, 100, -100);
    wall.receiveShadow = true;
    g.add(wall);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(700, 9, 2), K.paint(0xf7f4ee));
    skirt.position.set(60, 4.5, -99); skirt.castShadow = true; skirt.receiveShadow = true;
    g.add(skirt);
    // window: snowy evening outside
    const sc = K.TX.makeCanvas(256, 256), s = sc.getContext('2d');
    const sky = s.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, '#5f78a8'); sky.addColorStop(0.6, '#a9bcd9'); sky.addColorStop(1, '#e9eef6');
    s.fillStyle = sky; s.fillRect(0, 0, 256, 256);
    s.fillStyle = '#f4f7fb';
    s.beginPath(); s.moveTo(0, 200); s.quadraticCurveTo(60, 160, 120, 190); s.quadraticCurveTo(190, 150, 256, 185); s.lineTo(256, 256); s.lineTo(0, 256); s.fill();
    s.fillStyle = '#2f3f5a';
    for (const [x, h] of [[30, 40], [52, 30], [200, 46], [226, 34]]) { s.beginPath(); s.moveTo(x, 200 - h); s.lineTo(x - 12, 200); s.lineTo(x + 12, 200); s.fill(); }
    s.fillStyle = 'rgba(255,255,255,0.9)';
    for (let k = 0; k < 90; k++) { s.beginPath(); s.arc(r() * 256, r() * 230, 0.8 + r() * 1.8, 0, Math.PI * 2); s.fill(); }
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshBasicMaterial({ map: K.TX.toTexture(sc, { wrap: false }) }));
    glass.position.set(40, 85, -99.4);
    g.add(glass);
    const frameM = K.paint(0xf6f2ea, { roughness: 0.45 });
    const bar = (w2, h2, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w2, h2, 2.4), frameM); m.position.set(x, y, -98.8); m.castShadow = true; g.add(m); };
    bar(96, 4, 40, 121.5); bar(96, 4, 40, 48.5); bar(4, 70, -6, 85); bar(4, 70, 86, 85); bar(2.4, 70, 40, 85); bar(92, 2.4, 40, 85);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(104, 2.4, 9), frameM);
    sill.position.set(40, 47, -95.5); sill.castShadow = true; sill.receiveShadow = true; g.add(sill);
    // paper snowflakes on the window and the wall
    const fc = K.TX.makeCanvas(128), f = fc.getContext('2d');
    f.translate(64, 64); f.fillStyle = '#ffffff';
    for (let a = 0; a < 6; a++) {
      f.save(); f.rotate(a * Math.PI / 3);
      f.fillRect(-3, -58, 6, 58);
      for (const yy of [-22, -38]) { f.save(); f.translate(0, yy); f.rotate(0.7); f.fillRect(-2, -14, 4, 14); f.restore(); f.save(); f.translate(0, yy); f.rotate(-0.7); f.fillRect(-2, -14, 4, 14); f.restore(); }
      f.restore();
    }
    f.beginPath(); f.arc(0, 0, 9, 0, Math.PI * 2); f.fill();
    const flakes = [];
    for (let k = 0; k < 9; k++) flakes.push({ x: -40 + k * 30 + r() * 12, y: 60 + r() * 60, z: -98.6, rz: r() * 3, s: 5 + r() * 4 });
    const flakeMat = new THREE.MeshStandardMaterial({ map: K.TX.toTexture(fc, { wrap: false }), transparent: true, alphaTest: 0.3, roughness: 0.9, side: THREE.DoubleSide });
    K.instances(new THREE.PlaneGeometry(2, 2), flakeMat, flakes, { cast: false });
  }

  buildInrun(K) {
    const g = K.group;
    // the pile of floor cushions and pillows the book rests on
    const cushions = [
      { w: 52, d: 46, h: 13, y: 0, tex: this.fabric(K, { base: '#7a96c2', check: '#5e7aa8' }), x: -64, ry: 0.06 },
      { w: 48, d: 44, h: 13, y: 13, tex: this.fabric(K, { base: '#e3b34f', stripe: '#d69a2e' }), x: -62, ry: -0.08 },
      { w: 46, d: 42, h: 13, y: 26, tex: this.fabric(K, { base: '#c4655a', dots: '#e9c9a8', seed: 3 }), x: -63, ry: 0.04 },
      { w: 40, d: 36, h: 10, y: 39, tex: this.fabric(K, { base: '#9cc7a3', stripe: '#7fb088' }), x: -64, ry: -0.05 },
      { w: 26, d: 30, h: 9, y: 49, tex: this.fabric(K, { base: '#efe6d8', check: '#d8c9b2' }), x: -69, ry: 0.07 },
    ];
    for (const cu of cushions) {
      const m = new THREE.Mesh(new K.RoundedBoxGeometry(cu.w, cu.h, cu.d, 4, Math.min(cu.h / 2 - 0.1, 4.5)), new THREE.MeshPhysicalMaterial({ map: cu.tex, roughness: 0.92, sheen: 0.6, sheenRoughness: 0.6, sheenColor: 0xffffff }));
      m.position.set(cu.x, cu.y + cu.h / 2, 0); m.rotation.y = cu.ry;
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    K.contact(-63, 0, 30, 27, 0.4);
    // the big book: cloth cover, page block on the sides, a made-up title on the cover
    const len = 54, wid = 30, th = 3.4;
    const cc = K.TX.makeCanvas(512, 256), c = cc.getContext('2d');
    c.fillStyle = '#2e4f7a'; c.fillRect(0, 0, 512, 256);
    const img = c.getImageData(0, 0, 512, 256), d = img.data;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 512; x++) { const k = (y * 512 + x) * 4, v = 0.9 + 0.1 * ((x % 3) === 0 ? 1 : 0) * ((y % 3) === 0 ? 1 : 0.6) + (this.noise.noise(x * 0.3, y * 0.3) - 0.5) * 0.08; d[k] *= v; d[k + 1] *= v; d[k + 2] *= v; }
    c.putImageData(img, 0, 0);
    c.strokeStyle = '#d9b45a'; c.lineWidth = 6; c.strokeRect(22, 22, 468, 212);
    c.fillStyle = '#e8c56a'; c.font = '44px "Lilita One", Impact, sans-serif'; c.textAlign = 'center';
    c.fillText('THE BIG BOOK OF', 256, 104); c.fillText('MOUNTAINS', 256, 160);
    // two flour tracks down the cover
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(0, 108, 512, 7); c.fillRect(0, 141, 512, 7);
    const coverTex = K.TX.toTexture(cc, { wrap: false });
    const pageM = new THREE.MeshStandardMaterial({ color: 0xf3ead6, roughness: 0.9 });
    const coverM = new THREE.MeshPhysicalMaterial({ map: coverTex, roughness: 0.75, sheen: 0.3 });
    const spineM = new THREE.MeshStandardMaterial({ color: 0x24406a, roughness: 0.8 });
    const book = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(len, th, wid), [spineM, spineM, coverM, spineM, spineM, spineM]);
    const pages = new THREE.Mesh(new THREE.BoxGeometry(len - 1.6, th - 0.7, wid + 0.01), pageM);
    pages.position.x = 0.6;
    for (const m of [cover, pages]) { m.castShadow = true; m.receiveShadow = true; book.add(m); }
    const bAng = Math.atan2(P.T0.y - P.B0.y, P.T0.x - P.B0.x);
    const mid = { x: (P.B0.x + P.T0.x) / 2, y: (P.B0.y + P.T0.y) / 2 };
    book.position.set(mid.x + Math.sin(bAng) * th / 2 + Math.cos(bAng) * 0.8, mid.y - Math.cos(bAng) * th / 2 + Math.sin(bAng) * 0.8, 0);
    book.rotation.z = bAng;
    g.add(book);
    // the ruler (take-off table), its last stretch taped green: the jump zone
    const rlen = 16;
    const rc = K.TX.makeCanvas(512, 64), rr = rc.getContext('2d');
    rr.fillStyle = '#e8cf8f'; rr.fillRect(0, 0, 512, 64);
    rr.fillStyle = '#2b2622';
    for (let k = 0; k <= 160; k++) { const x = 6 + k * 3.1; rr.fillRect(x, 0, 1.6, k % 10 === 0 ? 22 : k % 5 === 0 ? 15 : 9); if (k % 10 === 0 && k < 160) { rr.font = '12px Rubik, sans-serif'; rr.fillText(String(k / 10), x + 2, 36); } }
    const zonePx = (P.JUMP_ZONE / rlen) * 512;
    rr.fillStyle = 'rgba(47,174,90,0.85)'; rr.fillRect(512 - zonePx, 0, zonePx, 64);
    rr.fillStyle = '#ffffff'; rr.font = '30px "Lilita One", Impact, sans-serif'; rr.textAlign = 'center'; rr.fillText('JUMP!', 512 - zonePx / 2, 46);
    const ruler = new THREE.Mesh(new THREE.BoxGeometry(rlen, 0.5, 6), [K.paint(0xd9bb73), K.paint(0xd9bb73), new THREE.MeshPhysicalMaterial({ map: K.TX.toTexture(rc, { wrap: false }), roughness: 0.4, clearcoat: 0.5 }), K.paint(0xd9bb73), K.paint(0xd9bb73), K.paint(0xd9bb73)]);
    const tAng = Math.atan2(P.EDGE.y - P.T0.y, P.EDGE.x - P.T0.x);
    ruler.position.set(P.EDGE.x - Math.cos(tAng) * rlen / 2 + Math.sin(tAng) * 0.25, P.EDGE.y - Math.sin(tAng) * rlen / 2 - Math.cos(tAng) * 0.25, 0);
    ruler.rotation.z = tAng;
    ruler.castShadow = true; ruler.receiveShadow = true;
    g.add(ruler);
    // a wobbly tower of letter blocks holding up the ruler
    const words = [['S', 'K', 'I', 'J', 'U', 'M'], ['P', 'O', 'W', 'D', 'E', 'R'], ['S', 'N', 'O', 'W', 'Y', 'Z'], ['F', 'L', 'Y', 'H', 'I', 'G'], ['H', 'O', 'P', 'Z', 'O', 'O'], ['W', 'H', 'E', 'E', 'E', 'E']];
    const bs = 5.2;
    for (let k = 0; k < 6; k++) {
      const b = letterBlock(words[k], bs, 21 + k);
      b.position.set(-7.5 + (this.r() - 0.5) * 0.8, bs / 2 + k * bs, (this.r() - 0.5) * 1.2);
      b.rotation.y = (this.r() - 0.5) * 0.5;
      g.add(b);
    }
    K.contact(-7.5, 0, 4.5, 4.5, 0.35);
    // the start bar: a pencil across the top of the in-run, on two erasers
    const sp = P.inrunAt(P.START_S - 1.6);
    const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, wid + 4, 6), K.paint(0xf2c230));
    pencil.rotation.x = Math.PI / 2;
    pencil.position.set(sp.x, sp.y + 1.6, 0);
    pencil.castShadow = true;
    g.add(pencil);
    for (const zz of [-wid / 2 - 0.5, wid / 2 + 0.5]) {
      const er = new THREE.Mesh(new K.RoundedBoxGeometry(2.4, 2.2, 1.6, 2, 0.3), K.paint(0xf08aa3, { roughness: 0.8, clearcoat: 0 }));
      er.position.set(sp.x, sp.y + 0.6, zz); er.rotation.z = bAng; er.castShadow = true;
      g.add(er);
    }
  }

  buildHill(K) {
    const g = K.group;
    // body: the hill profile extruded across, with soft edges
    const shape = new THREE.Shape();
    // the bevel grows the shape outwards, so trace the profile that much lower: the surface stays on hillY
    const BV = 0.4;
    shape.moveTo(-1, 0);
    shape.lineTo(-1, P.hillY(0) - 0.5 - BV);
    for (let x = 0; x <= 110; x += 2) shape.lineTo(x, Math.max(P.hillY(x) - BV, 0.05));
    shape.lineTo(112, 0.05);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: HILL_Z * 2 - 2, bevelEnabled: true, bevelThickness: 1, bevelSize: BV, bevelSegments: 3, curveSegments: 4, steps: 1 });
    geo.translate(0, 0, -HILL_Z + 1);
    // world-space UVs so the sheet texture doesn't stretch
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + pos.getZ(i) * 0.3) / 40, (pos.getY(i) + pos.getZ(i)) / 40);
    const wh = K.TX.noiseField(512, { seed: 44, period: 6, oct: 4, sx: 1, sy: 0.4 });
    const sheetN = K.TX.toTexture(K.TX.normalFromHeight(wh, 512, 512, 3.5), { srgb: false, repeat: [1, 1] });
    const sheet = new THREE.MeshStandardMaterial({ color: 0xedf0f5, roughness: 0.9, normalMap: sheetN, normalScale: new THREE.Vector2(0.7, 0.7) });
    // the sides are a duvet in a snowflake print, draped over the cushions underneath
    const dc = K.TX.makeCanvas(256), dg = dc.getContext('2d');
    dg.fillStyle = '#8fb3d9'; dg.fillRect(0, 0, 256, 256);
    dg.fillStyle = 'rgba(255,255,255,0.8)';
    const dr = rng(5);
    for (let k = 0; k < 18; k++) {
      const x = dr() * 256, y = dr() * 256, sz = 7 + dr() * 6;
      dg.save(); dg.translate(x, y);
      for (let a = 0; a < 6; a++) { dg.rotate(Math.PI / 3); dg.fillRect(-1.2, 0, 2.4, sz); }
      dg.restore();
    }
    dg.fillStyle = 'rgba(255,255,255,0.35)';
    for (let y = 0; y < 256; y += 32) dg.fillRect(0, y, 256, 3);
    const duvet = new THREE.MeshPhysicalMaterial({ map: K.TX.toTexture(dc, { repeat: [1, 1] }), normalMap: sheetN, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.9, sheen: 0.5, sheenRoughness: 0.6, sheenColor: 0xffffff });
    const hill = new THREE.Mesh(geo, [duvet, sheet]);
    hill.castShadow = true; hill.receiveShadow = true;
    g.add(hill);
    // flour sparkle on the surface
    const n = 2600, pts = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { const x = this.r() * 104; pts[k * 3] = x; pts[k * 3 + 1] = P.hillY(x) + 0.15; pts[k * 3 + 2] = (this.r() - 0.5) * (HILL_Z * 2 - 2); }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    g.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false })));
    // distance lines in coloured tape, the K-line in red, and number cards on toothpicks
    const lines = [[70, '#3d7bd9'], [80, '#3d7bd9'], [90, '#e23b2e'], [100, '#2fae5a'], [110, '#f2c230']];
    const stripGeo = new THREE.BoxGeometry(1, 0.15, HILL_Z * 2 - 1);
    const cardGeo = new THREE.PlaneGeometry(5.5, 3.8);
    const pick = new THREE.CylinderGeometry(0.13, 0.13, 6, 6);
    const pickM = new THREE.MeshStandardMaterial({ color: 0xe9d3a8, roughness: 0.8 });
    for (const [m, col] of lines) {
      const x = P.xAtMetres(m), y = P.hillY(x), a = Math.atan(P.hillSlope(x));
      const s = new THREE.Mesh(stripGeo, K.paint(col, { roughness: 0.6, clearcoat: 0.2 }));
      s.scale.x = m === 90 ? 2 : 1.2;
      s.position.set(x, y + 0.14, 0); s.rotation.z = a;
      s.receiveShadow = true;
      g.add(s);
      const cc = K.TX.makeCanvas(128, 88), c = cc.getContext('2d');
      c.fillStyle = '#fffdf6'; c.fillRect(0, 0, 128, 88);
      c.fillStyle = col; c.font = '52px "Lilita One", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(m === 90 ? 'K90' : String(m), 64, 48);
      const card = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ map: K.TX.toTexture(cc, { wrap: false }), roughness: 0.9, side: THREE.DoubleSide }));
      card.position.set(x, y + 6.5, -HILL_Z - 1.5); card.rotation.y = 0.15;
      card.castShadow = true;
      g.add(card);
      const tp = new THREE.Mesh(pick, pickM); tp.position.set(x, y + 3, -HILL_Z - 1.5); g.add(tp);
    }
    // the yellow measuring tape along the front edge of the hill, in metres
    const arcMax = P.arcTo(100);
    const tc = K.TX.makeCanvas(4096, 64), t = tc.getContext('2d');
    t.fillStyle = '#f2cf3d'; t.fillRect(0, 0, 4096, 64);
    t.fillStyle = '#2b2622'; t.textAlign = 'center';
    const mMax = arcMax * P.M_PER_UNIT;
    for (let m = 0; m <= mMax; m += 1) {
      const x = (m / mMax) * 4096;
      t.fillRect(x - 1.5, 0, 3, m % 10 === 0 ? 30 : m % 5 === 0 ? 20 : 11);
      if (m % 10 === 0 && m > 0) { t.font = '28px "Lilita One", Impact, sans-serif'; t.fillText(String(m), x, 58); }
    }
    const tape = [];
    const N = 120;
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * arcMax;
      let x = 0; while (P.arcTo(x) < a && x < 120) x += 0.1;
      tape.push([x, P.hillY(x), a / arcMax]);
    }
    const tp = new Float32Array((N + 1) * 2 * 3), tuv = new Float32Array((N + 1) * 2 * 2), idx = [];
    tape.forEach(([x, y, u], k) => {
      const zz = HILL_Z - 0.4;
      tp.set([x, y + 0.12, zz, x, y + 0.12, zz - 2.4], k * 6);
      tuv.set([u, 1, u, 0], k * 4);
      if (k < N) idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3);
    });
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(tp, 3)); tg.setAttribute('uv', new THREE.BufferAttribute(tuv, 2)); tg.setIndex(idx); tg.computeVertexNormals();
    const tapeMesh = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: K.TX.toTexture(tc, { wrap: false }), roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    tapeMesh.receiveShadow = true;
    g.add(tapeMesh);
    // cotton-wool drifts around the bottom
    const drift = [];
    const r = this.r;
    for (let k = 0; k < 46; k++) {
      const side = k % 2 ? 1 : -1;
      const x = -8 + r() * 120;
      drift.push({ x, y: 1 + r() * 1.5, z: side * (HILL_Z + 1.5 + r() * 4), s: 1.8 + r() * 2.6, sy: 0.7 + r() * 0.3 });
    }
    for (let k = 0; k < 14; k++) drift.push({ x: -85 + r() * 50, y: 1.2, z: 24 + r() * 8, s: 2 + r() * 2.5, sy: 0.7 });
    K.instances(new THREE.IcosahedronGeometry(1, 2), K.felt(0xfbfbfd, { sheenColor: 0xffffff }), drift);
  }

  buildOutrun(K) {
    const g = K.group;
    // a baking tray dusted with flour
    const L = 64, W = 30;
    const trayM = K.metal(0xc9ccd2, 0.35);
    const base = new THREE.Mesh(new THREE.BoxGeometry(L, 0.5, W), trayM);
    base.position.set(OUTRUN_X + L / 2, 0.25, 0); base.receiveShadow = true;
    g.add(base);
    for (const [w2, d2, x, z] of [[L, 0.6, OUTRUN_X + L / 2, -W / 2], [L, 0.6, OUTRUN_X + L / 2, W / 2], [0.6, W, OUTRUN_X + L, 0]]) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w2, 2.2, d2), trayM);
      rim.position.set(x, 1.1, z); rim.castShadow = true; rim.receiveShadow = true;
      g.add(rim);
    }
    const fc = K.TX.makeCanvas(512, 256), f = fc.getContext('2d');
    for (let k = 0; k < 1400; k++) { const r = this.r; f.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.5})`; const rad = 2 + r() * 10; f.beginPath(); f.arc(r() * 512, r() * 256, rad, 0, Math.PI * 2); f.fill(); }
    const flour = new THREE.Mesh(new THREE.PlaneGeometry(L - 1, W - 1), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(fc, { wrap: false }), transparent: true, roughness: 1, depthWrite: false }));
    flour.rotation.x = -Math.PI / 2; flour.position.set(OUTRUN_X + L / 2, TRAY_Y - 0.55 + 0.06, 0);
    g.add(flour);
    K.contact(OUTRUN_X + L / 2, 0, L * 0.55, W * 0.6, 0.3);
  }

  buildFan(K) {
    const g = K.group;
    const fan = new THREE.Group();
    fan.position.set(84, 0, -34);
    g.add(fan);
    const body = K.plastic(0x7ec4c4, 0.3);
    const dark = K.plastic(0x2b3036, 0.4);
    const base = new THREE.Mesh(K.lathe([[0.01, 0], [9, 0], [9.5, 1.2], [7, 2.6], [0.01, 2.8]], 32), body);
    base.castShadow = true; base.receiveShadow = true; fan.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 16, 12), body);
    pole.position.y = 10; pole.castShadow = true; fan.add(pole);
    const head = this.fanHead = new THREE.Group();
    head.position.y = 19;
    head.rotation.y = -Math.PI / 2;   // faces -x, blowing towards the take-off
    fan.add(head);
    const motor = new THREE.Mesh(new THREE.CapsuleGeometry(3.2, 4, 6, 16), body);
    motor.rotation.x = Math.PI / 2; motor.position.z = -3.5; motor.castShadow = true; head.add(motor);
    // guard: rings and spokes
    const ringM = K.metal(0xe6e8eb, 0.3);
    for (const [r, z] of [[10, 1.5], [10, -0.8], [6.5, 2.8], [3, 3.6]]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.18, 6, 48), ringM); ring.position.z = z; head.add(ring); }
    const spokes = [];
    for (let k = 0; k < 16; k++) spokes.push({ x: 0, y: 0, z: 2.2, rz: (k / 16) * Math.PI * 2 });
    K.instances(new THREE.BoxGeometry(0.22, 10, 0.22).translate(0, 5, 0), ringM, spokes, { parent: head, cast: false });
    const blades = this.fanBlades = new THREE.Group();
    blades.position.z = 0.6;
    head.add(blades);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.2, 16), dark);
    hub.rotation.x = Math.PI / 2; blades.add(hub);
    for (let k = 0; k < 3; k++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), K.plastic(0xbfe3e3, 0.25, { transparent: true, opacity: 0.85 }));
      b.scale.set(2.6, 7.6, 0.35);
      b.position.set(Math.sin((k / 3) * Math.PI * 2) * 4.6, Math.cos((k / 3) * Math.PI * 2) * 4.6, 0);
      b.rotation.z = -(k / 3) * Math.PI * 2;
      blades.add(b);
    }
    // a ribbon tied to the guard shows the wind
    const rg = new THREE.PlaneGeometry(1.4, 12, 1, 16);
    rg.translate(0, -6, 0);
    this.ribbonBase = Float32Array.from(rg.attributes.position.array);
    this.ribbon = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0xe23b2e, roughness: 0.8, side: THREE.DoubleSide }));
    this.ribbon.position.set(0, 10, 2);
    this.ribbon.rotation.x = Math.PI / 2 - 0.3;
    head.add(this.ribbon);
    K.contact(84, -34, 10, 10, 0.4);
  }

  buildJudges(K) {
    const g = K.group;
    // a shoe box with a cardboard sign and five plush judges on top
    const bx = 126, bz = -40;
    const cc = K.TX.makeCanvas(512, 128), c = cc.getContext('2d');
    c.fillStyle = '#c69a62'; c.fillRect(0, 0, 512, 128);
    c.fillStyle = '#1f1a17'; c.font = '76px "Lilita One", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('JUDGES', 256, 68);
    const box = new THREE.Mesh(new THREE.BoxGeometry(46, 14, 16), [K.std({ color: 0xb98b56, roughness: 0.9 }), K.std({ color: 0xb98b56, roughness: 0.9 }), K.std({ color: 0xd8b07c, roughness: 0.9 }), K.std({ color: 0xb98b56, roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(cc, { wrap: false }), roughness: 0.9 }), K.std({ color: 0xb98b56, roughness: 0.9 })]);
    box.position.set(bx, 7, bz); box.castShadow = true; box.receiveShadow = true;
    g.add(box);
    K.contact(bx, bz, 26, 10, 0.4);
    const kinds = ['bear', 'bunny', 'cat', 'elephant', 'duck'];
    this.judges = kinds.map((kind, k) => {
      const a = stuffedAnimal(kind, 70 + k, 8);
      a.group.position.set(bx - 18 + k * 9, 14, bz + 1);
      a.group.rotation.y = (bx - 18 + k * 9 < 120 ? 0.3 : -0.2);
      g.add(a.group);
      // a number card on a stick, hidden until the scores go up
      const cv = K.TX.makeCanvas(128, 96);
      const tex = K.TX.toTexture(cv, { wrap: false });
      const card = new THREE.Mesh(new THREE.PlaneGeometry(6, 4.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 6), new THREE.MeshStandardMaterial({ color: 0xe9d3a8 }));
      const holder = new THREE.Group();
      card.position.y = 5.2; stick.position.y = 2.5;
      holder.add(card, stick);
      holder.position.set(bx - 18 + k * 9 + 2, 14 + 7, bz + 3.5);
      holder.scale.setScalar(0.001);
      card.castShadow = true;
      g.add(holder);
      return { a, cv, tex, holder, up: 0 };
    });
  }

  setJudgeCards(scores, dropped) {
    this.judges.forEach((j, k) => {
      const g = j.cv.getContext('2d');
      g.fillStyle = dropped.includes(k) ? '#e6dfd2' : '#fffdf6'; g.fillRect(0, 0, 128, 96);
      g.strokeStyle = '#1f1a17'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 90);
      g.fillStyle = dropped.includes(k) ? '#8a8178' : '#1f1a17';
      g.font = '58px "Lilita One", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(scores[k].toFixed(1), 64, 52);
      j.tex.needsUpdate = true;
    });
  }

  buildCrowd(K, competitors) {
    const g = K.group;
    const spots = [];
    // plush fans on a row of books behind the hill and around the outrun
    const bookM = [K.paint(0x8a3b3b, { roughness: 0.6 }), K.paint(0x3b6a8a, { roughness: 0.6 }), K.paint(0x6a8a3b, { roughness: 0.6 })];
    for (let k = 0; k < 4; k++) {
      const b = new THREE.Mesh(new K.RoundedBoxGeometry(36, 5, 20, 2, 0.4), bookM[k % 3]);
      b.position.set(14 + k * 30, 2.5, -40 + (k % 2) * 2); b.rotation.y = (this.r() - 0.5) * 0.15;
      b.castShadow = true; b.receiveShadow = true; g.add(b);
      spots.push({ x: 6 + k * 30, y: 5, z: -40, ry: 0.2, size: 9 }, { x: 20 + k * 30, y: 5, z: -41, ry: -0.1, size: 10 });
    }
    for (let k = 0; k < 6; k++) spots.push({ x: 150 + k * 14 + this.r() * 4, y: 1.2, z: -30 - (k % 2) * 6, ry: -0.2 + this.r() * 0.4, size: 10 + this.r() * 2 });
    for (let k = 0; k < 3; k++) spots.push({ x: -100 + k * 13, y: 0, z: -34 - (k % 2) * 4, ry: 0.4, size: 11 });
    this.crowd = crowd(g, spots, 23);
    const codes = competitors.map((c) => c.code);
    [[148, -38], [196, -36], [-30, -44], [60, -50]].forEach(([x, z], k) => {
      const b = banner(codes[k % codes.length], 13, { seed: 40 + k });
      b.position.set(x, 0, z); b.rotation.y = (this.r() - 0.5) * 0.3;
      g.add(b);
    });
  }

  buildHud() {
    const el = this.ctx.hud.el;
    const style = document.createElement('style');
    style.textContent = `.sj-card{position:absolute;left:12px;top:12px;width:min(250px,40vw);background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17;padding:8px 10px;font:700 12px/1.25 Rubik,sans-serif;color:#1f1a17}
      .sj-card .who{display:flex;align-items:center;gap:7px;font:400 18px/1.1 "Lilita One",Impact,sans-serif}.sj-card .who img{height:20px;width:30px;object-fit:cover;border:2px solid #1f1a17;border-radius:3px}
      .sj-card .rd{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#4a413a;font-weight:800;margin-top:2px}
      .sj-card ol{list-style:none;margin:6px 0 0;padding:6px 0 0;border-top:2px dashed rgba(31,26,23,.25);display:grid;gap:2px}
      .sj-card li{display:grid;grid-template-columns:28px 22px 1fr auto;gap:5px;align-items:center;font-variant-numeric:tabular-nums}.sj-card li img{height:13px;width:20px;object-fit:cover;border-radius:2px}
      .sj-card li.me{background:#ffc93c;border-radius:6px}
      .sj-gauge{position:absolute;left:50%;bottom:calc(18px + var(--tb,0px));transform:translateX(-50%);width:min(380px,80vw);background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:14px;box-shadow:0 3px 0 #1f1a17;padding:6px 12px 8px;font:800 12px/1.2 Rubik,sans-serif;color:#1f1a17;text-align:center}
      .sj-gauge .lab{display:flex;justify-content:space-between;color:#4a413a;font-weight:700}.sj-gauge .lab b{color:#1f1a17}
      .sj-gauge .g{position:relative;height:18px;border:2px solid #1f1a17;border-radius:99px;background:linear-gradient(90deg,#f6b3a8,#fff3c4 38%,#bfe6c7 44%,#bfe6c7 56%,#fff3c4 62%,#f6b3a8);margin-top:4px}
      .sj-gauge .g i{position:absolute;top:-5px;bottom:-5px;width:6px;margin-left:-3px;left:50%;background:#1f1a17;border-radius:3px}
      .sj-gauge .p{position:relative;height:8px;border:2px solid #1f1a17;border-radius:99px;background:#fff;margin-top:6px;overflow:hidden}
      .sj-gauge .p u{position:absolute;top:0;bottom:0;right:0;background:#2fae5a}.sj-gauge .p i{position:absolute;top:0;bottom:0;left:0;background:#2f6fe0}
      .sj-score{position:absolute;left:50%;bottom:calc(16px + var(--tb,0px));transform:translateX(-50%);display:grid;justify-items:center;gap:6px;font:800 14px Rubik,sans-serif;color:#1f1a17}
      .sj-score .cards{display:flex;gap:6px}.sj-score .cards span{background:#fffdf6;border:3px solid #1f1a17;border-radius:8px;padding:3px 8px;font:400 22px "Lilita One",Impact,sans-serif;box-shadow:0 3px 0 #1f1a17}
      .sj-score .cards span.x{opacity:.45;text-decoration:line-through}
      .sj-score .sum{background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:12px;padding:4px 12px;box-shadow:0 3px 0 #1f1a17;font-variant-numeric:tabular-nums}
      .sj-wind{position:absolute;right:12px;top:64px;background:rgba(255,244,220,.95);border:3px solid #1f1a17;border-radius:12px;box-shadow:0 3px 0 #1f1a17;padding:4px 10px;font:800 12px Rubik,sans-serif;color:#1f1a17}
      .sj-hidden{display:none}`;
    el.appendChild(style);
    const mk = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; el.appendChild(d); return d; };
    this.hudCard = mk('sj-card', '<div class="who"></div><div class="rd"></div><ol></ol>');
    this.hudGauge = mk('sj-gauge sj-hidden', '<div class="lab"><span>◀ back</span><b></b><span>forward ▶</span></div><div class="g"><i></i></div><div class="p"><u></u><i></i></div>');
    this.hudGauge.querySelector('.p u').style.width = `${(P.JUMP_ZONE / P.INRUN_LEN) * 100}%`;
    this.hudScore = mk('sj-score sj-hidden', '<div class="cards"></div><div class="sum"></div>');
    this.hudWind = mk('sj-wind sj-hidden', '');
    if (this.ctx.competitors.some((c) => c.type === 'touch')) { this.hudGauge.style.setProperty('--tb', '110px'); this.hudScore.style.setProperty('--tb', '110px'); }
  }

  // ---------------------------------------------------------------- computer jumpers
  makeBot() { return { next: 0, steer: 0, release: null, landAt: null }; }

  botUpdate(j, now) {
    const pad = j.c.pad, b = j.bot, B = BOT[this.ctx.skillName] || BOT.normal;
    const press = (k, down) => { if (pad.held[k] !== down) pad.push(k, down, now); };
    const steerTo = (v) => { press('left', v < 0); press('right', v > 0); };
    if (this.phase === 'gate') {
      if (b.release == null) { b.release = Math.max(1.2, B.release[0] + this.r.gauss() * B.release[1]); b.go = now + 0.7 + this.r() * 0.8; }
      if (now >= b.go) press('action', true);
    } else if (this.phase === 'inrun') {
      const st = this.inrun;
      if (now >= b.next) {
        // look at the balance every so often (less often and less precisely when less skilled)
        b.next = now + B.look * (0.7 + this.r() * 0.6);
        b.steer = Math.abs(st.wobble) > B.thr ? -Math.sign(st.wobble + st.wv * 0.15) * B.push : 0;
      }
      steerTo(b.steer);
      if (P.INRUN_LEN - st.s <= b.release) press('action', false);
    } else if (this.phase === 'flight') {
      const f = this.flight;
      if (now >= b.next) {
        b.next = now + B.look * (0.7 + this.r() * 0.6);
        b.steer = Math.abs(f.lean) > B.fly ? -Math.sign(f.lean + f.lv * 0.12) * Math.min(1, B.push + Math.abs(f.lean) * 0.4) : 0;
      }
      steerTo(b.steer);
      if (b.landAt == null && pad.held.action) press('action', false);
      if (b.landAt == null && !pad.held.action) b.landAt = 0.22 + this.r.gauss() * B.land;
      if (b.landAt != null && this.timeToContact() <= b.landAt) press('action', true);
    } else {
      steerTo(0); press('action', false);
      b.release = null; b.landAt = null;
    }
  }

  // ---------------------------------------------------------------- flow
  attract() {}

  start() {
    this.ctx.sound.setLoop('crowd', 0.3);
    this.ctx.sound.setLoop('fan', 0.35);
    this.order = this.jumpers.map((j) => j.i);
    this.round = 1;
    this.turn = -1;
    this.nextJumper();
  }

  nextJumper() {
    this.turn++;
    if (this.turn >= this.order.length) {
      if (this.round === 1 && this.jumpers.length) {
        // round 2: reverse order of the standings, leader last
        this.round = 2;
        this.order = [...this.jumpers].sort((a, b) => a.total - b.total || b.i - a.i).map((j) => j.i);
        this.turn = 0;
        this.ctx.hud.message('Round 2', 'small', '#ffc93c', 1.4);
      } else { this.finishAll(); return; }
    }
    const j = this.cur = this.jumpers[this.order[this.turn]];
    this.inrun = { s: P.START_S, v: 0, wobble: 0, wv: 0, stood: false, wobSum: 0, n: 0 };
    this.flight = null;
    this.land = null;
    this.release = null;
    this.landPress = null;
    this.phase = 'gate';
    this.t = 0;
    this.placeWaiting(false);
    j.fig.ground = false;
    j.fig.setExpression('focus');
    this.ctx.competitors.forEach((c, i) => this.ctx.hud.chip(i, this.chipInfo(this.jumpers[i]), i === j.i ? 'active' : ''));
    if (j.c.human) this.ctx.hud.message(`Hold ${j.c.type === 'touch' ? '●' : 'your action key'} to go!`, 'small', '#fff');
    else this.ctx.hud.message('');
    this.updateCard();
  }

  chipInfo(j) {
    const n = j.jumps.length;
    return n ? `${j.total.toFixed(1)}` : '';
  }

  timeToContact() {
    const f = this.flight;
    if (!f) return Infinity;
    const slope = P.hillSlope(f.x), h = f.y - P.hillY(f.x);
    const vrel = -(f.vy - slope * f.vx) / Math.hypot(1, slope);
    return h / Math.max(vrel, 2) / P.FLIGHT.timeScale;
  }

  update(dt) {
    const ctx = this.ctx, now = ctx.time();
    this.t += dt;
    if (this.phase === 'pre') { for (let i = 0; i < this.jumpers.length; i++) ctx.presses(i); return; }
    if (this.phase === 'done') {
      for (let i = 0; i < this.jumpers.length; i++) ctx.presses(i);
      if (this.t > 1.8 && this.results) { const r = this.results; this.results = null; ctx.finish(r); }
      return;
    }
    const j = this.cur;
    if (j && j.bot) this.botUpdate(j, now);
    // presses of everyone but the jumper are dropped
    let q = [];
    for (let i = 0; i < this.jumpers.length; i++) { const e = ctx.presses(i); if (j && i === j.i) q = e; }
    if (!j) return;
    const held = ctx.held(j.i);
    const steer = (held.right ? 1 : 0) - (held.left ? 1 : 0);

    if (this.phase === 'gate') {
      if (q.some((e) => e.b === 'action' && e.down) || held.action || this.t > 12) {
        this.phase = 'inrun'; this.t = 0;
        this.inrun.v = 6;
        ctx.hud.message('');
        ctx.sound.pop();
      }
    } else if (this.phase === 'inrun') {
      const st = this.inrun;
      const d = P.INRUN_LEN - st.s;
      // letting go of ACTION is the jump: the pop happens at the edge, its strength set by when you let go
      const up = q.find((e) => e.b === 'action' && !e.down);
      if (this.release == null && (up || !held.action)) {
        this.release = d;
        this.pendingQ = P.popQuality(d);
        if (d > P.EARLY) { st.stood = true; ctx.hud.flash('Too early!', '#ff8a65'); }
      }
      P.stepInrun(st, dt, { steer, tuck: held.action && !st.stood }, this.r.gauss());
      st.wobSum += Math.abs(st.wobble); st.n++;
      if (st.s >= P.INRUN_LEN) this.takeoff(this.release != null ? this.pendingQ : P.popQuality(null, null));
      ctx.sound.setLoop('hiss', clamp(st.v / 40, 0, 1), 4200 + st.v * 40);
    } else if (this.phase === 'flight') {
      const f = this.flight;
      // a very late release still gets a little hop
      if (this.lateHop && q.some((e) => e.b === 'action' && !e.down) && f.t / P.FLIGHT.timeScale < 0.15) { f.vy += P.TAKEOFF.pop * 0.4; this.lateHop = false; }
      if (this.landPress == null) {
        const dn = q.find((e) => e.b === 'action' && e.down);
        if (dn) this.landPress = { t: dn.t, tc: this.timeToContact() };
      }
      const gust = P.gustAt(f.t / P.FLIGHT.timeScale, this.round);
      this.gust = gust;
      P.stepFlight(f, dt * P.FLIGHT.timeScale, { steer }, gust, this.r.gauss());
      f.leanSum += Math.abs(f.lean); f.n++;
      if (f.y <= P.hillY(f.x) + 0.15 || f.y < TRAY_Y) this.touchdown(now);
      ctx.sound.setLoop('wind', clamp(Math.hypot(f.vx, f.vy) / 45, 0, 1) * (0.7 + 0.3 * Math.abs(gust)));
      ctx.sound.setLoop('hiss', 0);
      this.excite = clamp(0.25 + (f.x / 70) * 0.75, 0, 1);
    } else if (this.phase === 'landed') {
      const L = this.land;
      // slide down and out along the outrun
      const slope = L.x < OUTRUN_X ? P.hillSlope(L.x) : 0;
      L.v += (-slope * 22 - (L.fall ? 28 : 7) - L.v * 0.05) * dt;
      L.v = Math.max(0, L.v);
      L.x = Math.min(OUTRUN_X + 58, L.x + L.v * dt);
      ctx.sound.setLoop('hiss', clamp(L.v / 50, 0, 0.8));
      if (this.t > 1.1 && !L.shown) { L.shown = true; this.showDistance(); }
      if (this.t > 2.3 && !L.scored) { L.scored = true; this.showScores(); }
      if (this.t > 5.6) {
        this.hudScore.classList.add('sj-hidden');
        for (const jj of this.judges) jj.up = 0;
        this.nextJumper();
      }
    }
  }

  takeoff(q) {
    const ctx = this.ctx, st = this.inrun;
    const p = P.inrunAt(Math.min(st.s, P.INRUN_LEN));
    this.flight = { x: p.x, y: p.y + 0.05, vx: st.v * Math.cos(p.ang), vy: st.v * Math.sin(p.ang) + P.TAKEOFF.pop * q, lean: (this.r() - 0.5) * 0.1, lv: 0, t: 0, leanSum: 0, n: 0, q, vEdge: st.v };
    this.lateHop = this.release == null;
    this.phase = 'flight'; this.t = 0;
    ctx.sound.whoosh(1);
    if (q >= 0.95) ctx.hud.flash('Perfect take-off!', '#7be495');
    else if (this.release == null) ctx.hud.flash('Late!', '#ff8a65');
    this.particles.emit(p.x, p.y + 0.5, 0, { vx: 6, spread: 8, up: 4, color: 0xffffff, size: 1.6, life: 0.9, alpha: 0.6, grav: 6, grow: 1.5, n: 18 });
  }

  touchdown(now) {
    const ctx = this.ctx, f = this.flight, j = this.cur;
    const x = f.x, slope = P.hillSlope(x);
    const vn = Math.abs((f.vy - slope * f.vx) / Math.hypot(1, slope));
    const metres = P.roundHalf(P.metresAt(Math.min(x, 140)));
    // the landing: a press just before touchdown is a telemark
    let kind;
    const lp = this.landPress;
    const before = lp ? lp.tc : null;
    if (Math.abs(f.lean) > 0.85 || vn > 27 || x > 98) kind = 'fall';
    else if (before != null && before >= 0.03 && before <= 0.45) kind = 'telemark';
    else if (before != null && before > 0.45) kind = 'two-footed';
    else kind = Math.abs(f.lean) > 0.55 ? 'fall' : 'no telemark';
    const inrunWob = this.inrun.wobSum / Math.max(1, this.inrun.n);
    const leanAvg = f.leanSum / Math.max(1, f.n);
    // five judges: deductions for wobble, lean and the landing, each with their own opinion
    const ded = clamp(inrunWob * 3.2, 0, 3) + clamp(leanAvg * 4.5, 0, 3) + (f.q < 0.6 ? 0.5 : 0)
      + { telemark: 0, 'two-footed': 2, 'no telemark': 3, fall: 8.5 }[kind];
    const scores = Array.from({ length: JUDGES }, () => clamp(P.roundHalf(19.5 - ded + this.r.gauss() * 0.45), 0, 20));
    const sorted = scores.map((s, k) => [s, k]).sort((a, b) => a[0] - b[0]);
    const dropped = [sorted[0][1], sorted[JUDGES - 1][1]];
    const style = scores.reduce((a, s, k) => a + (dropped.includes(k) ? 0 : s), 0);
    const dpts = P.distancePoints(metres);
    const jump = { metres, kind, scores, dropped, style, dpts, points: Math.round((dpts + style) * 10) / 10, lean: f.lean, vn, press: before };
    j.jumps.push(jump);
    j.total = Math.round(j.jumps.reduce((a, b) => a + b.points, 0) * 10) / 10;
    this.land = { x, v: Math.hypot(f.vx, f.vy) * 0.75, fall: kind === 'fall', kind, jump, t0: now };
    this.phase = 'landed'; this.t = 0;
    ctx.sound.setLoop('wind', 0);
    ctx.sound.thump(kind === 'fall' ? 1.2 : 0.8);
    ctx.sound.puff();
    this.particles.emit(x, P.hillY(x) + 0.5, 0, { vx: 10, spread: 14, up: kind === 'fall' ? 12 : 6, color: 0xffffff, size: kind === 'fall' ? 3 : 1.8, life: 1.2, alpha: 0.7, grav: 7, grow: 1.8, n: kind === 'fall' ? 50 : 28 });
    if (kind === 'fall') { ctx.sound.aww(); j.fig.setExpression('sad'); }
    else { ctx.sound.cheer(clamp((metres - 70) / 35, 0.3, 1.2)); j.fig.setExpression(metres >= 95 ? 'wow' : 'happy'); }
    const label = { telemark: 'Telemark!', 'two-footed': 'Two-footed landing', 'no telemark': 'No telemark', fall: 'Ouch, a tumble!' }[kind];
    ctx.hud.flash(label, kind === 'telemark' ? '#7be495' : kind === 'fall' ? '#ff8a65' : '#ffffff');
    ctx.hud.message('');
  }

  showDistance() {
    const L = this.land;
    this.ctx.hud.message(`${L.jump.metres.toFixed(1)} m`, '', L.jump.metres >= 100 ? '#ffc93c' : '#ffffff');
    if (L.jump.metres >= 100) this.ctx.sound.cheer(1.3);
  }

  showScores() {
    const { jump } = this.land, j = this.cur;
    this.setJudgeCards(jump.scores, jump.dropped);
    for (const jj of this.judges) jj.up = 1;
    this.ctx.sound.clap(10);
    this.hudScore.querySelector('.cards').innerHTML = jump.scores.map((s, k) => `<span class="${jump.dropped.includes(k) ? 'x' : ''}">${s.toFixed(1)}</span>`).join('');
    this.hudScore.querySelector('.sum').textContent = `Distance ${jump.dpts.toFixed(1)} + style ${jump.style.toFixed(1)} = ${jump.points.toFixed(1)} · total ${j.total.toFixed(1)}`;
    this.hudScore.classList.remove('sj-hidden');
    this.ctx.hud.message('');
    this.ctx.hud.chip(j.i, this.chipInfo(j), 'active');
    this.updateCard();
  }

  finishAll() {
    const ctx = this.ctx;
    this.phase = 'done'; this.t = 0;
    this.cur = null;
    this.placeWaiting(true);
    ctx.sound.setLoop('hiss', 0); ctx.sound.setLoop('wind', 0);
    const ranked = [...this.jumpers].sort((a, b) => b.total - a.total);
    this.winner = ranked[0];
    ctx.hud.message(`${ranked[0].c.short} wins!`, 'small', '#ffc93c');
    this.hudGauge.classList.add('sj-hidden');
    this.hudWind.classList.add('sj-hidden');
    const results = this.jumpers.map((j) => ({
      value: j.total, text: `${j.total.toFixed(1)} pts`, short: `${j.total.toFixed(1)} pts`,
      sub: j.jumps.map((x) => `${x.metres.toFixed(1)} m${x.kind === 'fall' ? ' (fall)' : x.kind === 'telemark' ? ' (telemark)' : ''}`).join(' · '),
    }));
    this.results = results;
  }

  placeWaiting(all) {
    this.jumpers.forEach((j) => {
      if (!all && this.cur === j) return;
      j.holder.position.set(j.home.x, 0, j.home.z);
      j.holder.rotation.set(0, 0, 0);
      j.fig.ground = true;
    });
  }

  updateCard() {
    const j = this.cur;
    const who = this.hudCard.querySelector('.who'), rd = this.hudCard.querySelector('.rd'), ol = this.hudCard.querySelector('ol');
    if (j) {
      who.innerHTML = `<img src="${j.c.flag}" alt=""><span>${j.c.short}</span>`;
      rd.textContent = `Round ${this.round} · jumper ${this.turn + 1} of ${this.order.length}`;
    }
    const ranked = [...this.jumpers].filter((x) => x.jumps.length).sort((a, b) => b.total - a.total);
    ol.innerHTML = ranked.map((x, k) => `<li class="${x === j ? 'me' : ''}"><span>${ORD[k]}</span><img src="${x.c.flag}" alt=""><span>${x.c.short}</span><b>${x.total.toFixed(1)}</b></li>`).join('');
    ol.style.display = ranked.length ? '' : 'none';
  }

  // ---------------------------------------------------------------- per frame
  frame(dt, paused) {
    const ctx = this.ctx, tt = ctx.time();
    if (!paused) this.particles.update(dt);
    // waiting jumpers cheer the jumper on
    this.jumpers.forEach((j) => {
      if (j === this.cur && this.phase !== 'done') return;
      const w = tt + j.idle;
      const k = this.phase === 'flight' ? 1 : (Math.floor(w / 3) % 3);
      j.fig.ground = true;
      j.fig.setPose(this.phase === 'done' && j === this.winner ? POSES.cheer(w) : k === 1 ? POSES.cheer(w) : k === 2 ? POSES.wave(w) : POSES.stand(w));
      j.fig.root.rotation.y = Math.PI / 2 - 1.2 + Math.sin(w * 0.3) * 0.2;
      if (this.phase === 'done') j.fig.setExpression(j === this.winner ? 'wow' : 'happy');
    });
    const j = this.cur;
    if (j && this.phase !== 'done') this.poseJumper(j, tt, dt);
    // fan and ribbon
    if (this.fanBlades && !paused) {
      this.fanBlades.rotation.z -= dt * 26;
      this.fanHead.rotation.y = -Math.PI / 2 + Math.sin(tt * 0.6) * 0.45;
      const pos = this.ribbon.geometry.attributes.position, B = this.ribbonBase;
      const strength = 1 + (this.gust || 0) * 0.4;
      for (let i = 0; i < pos.count; i++) {
        const y = B[i * 3 + 1];
        pos.setZ(i, Math.sin(-y * 0.9 + tt * 14) * 0.6 * (-y / 12) * strength);
      }
      pos.needsUpdate = true;
    }
    // judges' cards pop up
    for (const jj of this.judges) {
      const s = jj.holder.scale.x, target = jj.up ? 1 : 0.001;
      jj.holder.scale.setScalar(damp(s, target, jj.up ? 9 : 14, dt));
    }
    const lvl = this.phase === 'flight' ? this.excite : this.phase === 'landed' && this.land && !this.land.fall ? 0.7 : this.phase === 'done' ? 0.6 : 0.15;
    this.crowd.update(tt, lvl);
    for (const jj of this.judges) jj.a.update(tt, jj.up ? 0.25 : 0);
    if (!paused) ctx.sound.setLoop('crowd', 0.2 + lvl * 0.5);
    this.updateHud();
    this.applyCamera(dt);
  }

  poseJumper(j, tt, dt) {
    const fig = j.fig, H = j.holder;
    let pose, x, y, ang = 0;
    if (this.phase === 'gate' || this.phase === 'inrun') {
      const st = this.inrun;
      const p = P.inrunAt(st.s);
      x = p.x; y = p.y; ang = p.ang;
      const tuckPose = POSES.tuck(clamp(st.wobble, -1, 1));
      pose = st.stood ? blendPose(tuckPose, { ...POSES.stand(tt), roll: st.wobble * 0.3 }, 0.6) : tuckPose;
      if (this.phase === 'gate') pose = { ...tuckPose, lean: 0.75, y: -1.1, shL: 0.9, shR: 0.9, elL: 0.6, elR: 0.6 };
    } else if (this.phase === 'flight') {
      const f = this.flight;
      x = f.x; y = f.y;
      ang = Math.atan2(f.vy, f.vx) * 0.55;
      const open = clamp(f.t / 0.25, 0, 1);
      pose = blendPose(POSES.tuck(0), POSES.flight(clamp(0.55 + f.lean * 0.45, 0, 1), f.lean * 0.6), open);
      // getting ready to land
      const tc = this.timeToContact();
      if (this.landPress) pose = blendPose(pose, POSES.telemark(0.6), clamp((0.5 - tc) * 3, 0, 0.8));
    } else if (this.phase === 'landed') {
      const L = this.land;
      x = L.x; y = L.x < OUTRUN_X ? P.hillY(L.x) : TRAY_Y - 0.5;
      ang = Math.atan(L.x < OUTRUN_X ? P.hillSlope(L.x) : 0);
      const k = clamp(this.t / 0.25, 0, 1);
      if (L.fall) {
        // tumble, then sit in a heap of flour
        pose = this.t < 0.8 ? { ...POSES.heap(), pitch: Math.sin(this.t * 9) * 0.8, roll: Math.cos(this.t * 7) * 0.5 } : POSES.heap();
      } else if (L.kind === 'telemark') pose = blendPose(POSES.flight(0.6), POSES.telemark(1), k);
      else pose = blendPose(POSES.flight(0.6), { ...POSES.tuck(0), y: -0.6, lean: 0.4, kneeL: 1.0, kneeR: 1.0, hipL: 0.6, hipR: 0.6 }, k);
      if (this.t > 2.6 && !L.fall) pose = blendPose(pose, POSES.cheer(tt), clamp((this.t - 2.6) * 2, 0, 1));
      fig.ground = false;
    }
    H.position.set(x, y, 0);
    H.rotation.set(0, 0, ang);
    fig.ground = false;
    fig.root.rotation.y = Math.PI / 2;
    fig.setPose(pose);
    // flour spray from the skis on the in-run and the outrun
    if (this.phase === 'inrun' && this.inrun.v > 20 && Math.random() < 0.5) this.particles.emit(x - 2, y + 0.3, (Math.random() - 0.5) * 2, { vx: -4, spread: 3, up: 2, color: 0xffffff, size: 0.8, life: 0.4, alpha: 0.4, grav: 4, n: 1 });
    if (this.phase === 'landed' && this.land.v > 6 && Math.random() < 0.6) this.particles.emit(x - 2, y + 0.4, (Math.random() - 0.5) * 3, { vx: -3, spread: 4, up: 3, color: 0xffffff, size: 1.2, life: 0.6, alpha: 0.5, grav: 5, n: 2 });
    void dt;
  }

  updateHud() {
    const ph = this.phase, j = this.cur;
    const showGauge = j && j.c.human && (ph === 'gate' || ph === 'inrun' || ph === 'flight');
    this.hudGauge.classList.toggle('sj-hidden', !showGauge);
    if (showGauge) {
      const flying = ph === 'flight';
      const v = flying ? this.flight.lean : this.inrun.wobble;
      this.hudGauge.querySelector('.lab b').textContent = flying ? 'Lean into the wind' : ph === 'gate' ? 'Balance' : 'Balance · let go in the green!';
      const lab = this.hudGauge.querySelectorAll('.lab span');
      lab[0].textContent = flying ? '◀ back' : '◀ left'; lab[1].textContent = flying ? 'forward ▶' : 'right ▶';
      this.hudGauge.querySelector('.g i').style.left = `${clamp(50 + v * 42, 2, 98)}%`;
      const prog = this.hudGauge.querySelector('.p');
      prog.style.display = flying ? 'none' : '';
      this.hudGauge.querySelector('.p i').style.width = `${clamp((this.inrun.s / P.INRUN_LEN) * 100, 0, 100)}%`;
    }
    // still holding ACTION after the take-off: let go, so the landing press can count
    if (ph === 'flight' && j.c.human && !this.landPress && this.ctx.held(j.i).action && this.timeToContact() >= 0.65) {
      if (!this.letGoShown) { this.letGoShown = true; this.ctx.hud.message('Let go!', 'small', '#ff8a65'); }
    } else if (this.letGoShown) { this.letGoShown = false; if (!this.landShown) this.ctx.hud.message(''); }
    // LAND! prompt
    if (ph === 'flight' && j.c.human && !this.landPress && this.timeToContact() < 0.65) {
      if (!this.landShown) { this.landShown = true; this.ctx.hud.message('LAND!', 'big', '#ffc93c'); }
    } else if (this.landShown && ph !== 'flight') { this.landShown = false; }
    if (ph === 'flight' && this.landPress && this.landShown) { this.landShown = false; this.ctx.hud.message(''); }
    // wind from the fan
    const windOn = ph === 'flight' || ph === 'inrun' || ph === 'gate';
    this.hudWind.classList.toggle('sj-hidden', !windOn);
    if (windOn) {
      const g = ph === 'flight' ? this.gust : P.gustAt(0, this.round);
      this.hudWind.textContent = `Fan gusts ${'≋'.repeat(1 + Math.round(clamp(Math.abs(g), 0, 1) * 3))}`;
    }
  }

  applyCamera(dt) {
    const R = this.ctx.R, c = this.cam, ph = this.phase;
    let want;
    if (ph === 'gate' || ph === 'pre') {
      const p = P.inrunAt(P.START_S);
      want = { x: p.x + 24, y: p.y - 13, z: 0, yaw: 0.14, pitch: 0.2, width: 84 };
    } else if (ph === 'inrun') {
      const p = P.inrunAt(this.inrun.s);
      want = { x: p.x + 20, y: p.y - 9, z: 0, yaw: 0.12, pitch: 0.2, width: 80 };
    } else if (ph === 'flight') {
      const f = this.flight;
      const ahead = Math.max(f.x + 22, 40);
      want = { x: (f.x + ahead) / 2, y: (f.y + P.hillY(ahead)) / 2, z: 0, yaw: 0.1, pitch: 0.34, width: 100 };
    } else if (ph === 'landed') {
      const L = this.land;
      want = { x: Math.min(L.x + 12, OUTRUN_X + 40), y: Math.max(11, P.hillY(L.x) + 5), z: -10, yaw: 0.16, pitch: 0.26, width: 100 };
    } else {
      want = { x: 150, y: 8, z: -14, yaw: 0.2, pitch: 0.22, width: 96 };
    }
    const rate = ph === 'flight' ? 3.5 : ph === 'inrun' ? 6 : 2.2;
    for (const k of Object.keys(want)) c[k] = dt >= 1 ? want[k] : damp(c[k], want[k], rate, Math.min(dt, 0.1));
    R.orbit(c.x, c.y, c.z, { yaw: c.yaw, pitch: c.pitch, width: c.width, shadowSpan: Math.max(140, c.width * 1.8) });
    R.setFocus(0.5, 0.26, 0.85);
  }

  dispose() {
    for (const j of this.jumpers) j.fig.dispose();
    this.ctx.sound.setLoop('fan', 0); this.ctx.sound.setLoop('hiss', 0); this.ctx.sound.setLoop('wind', 0);
  }
}

export default {
  id: 'skijump', name: 'Ski jump', season: 'Winter',
  blurb: 'Off a big book, over a flour-dusted cushion: two jumps each, judged for distance and style.',
  venue: 'A book propped on cushions, a ruler on a tower of letter blocks, and a sheet-covered cushion dusted with flour.',
  loading: 'Dusting the hill with flour…',
  how: [
    { verb: 'Power', text: 'Hold your <b>action</b> key to push off and tuck. Let go in the <b>green zone</b> at the end of the ruler to jump.' },
    { verb: 'Steer', text: 'On the way down, <b>left</b> and <b>right</b> keep you balanced. In the air, <b>right</b> leans forward and <b>left</b> leans back: stay in the green while the fan gusts.' },
    { verb: 'Timing', text: 'When it says <b>LAND!</b>, press <b>action</b> just before you touch down for a telemark and top style marks.' },
  ],
  better: 'higher',
  resultsDelay: 0.6,
  create: (ctx) => new SkiJump(ctx),
};
