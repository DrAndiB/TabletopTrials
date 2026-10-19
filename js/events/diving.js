// Diving: off a ruler springboard on top of a tower of books, into the goldfish bowl.
// Tap ACTION as you land on the board to bounce higher (three bounces, the third takes off), hold ACTION to tuck
// and spin, let go to stretch out, and tap LEFT/RIGHT for half twists. Go in head first and straight:
// the dial next to the diver turns green when stretching out now would do that. Five plush judges
// score each dive; the middle three count, times the difficulty. Three dives each.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES, REST, blendPose } from '../figurine.js';
import { crowd, banner, floorMaterial } from '../props.js';
import { Particles } from '../fx.js';
import { clamp, damp, rng, makeNoise2D, TAU } from '../util.js';
import { hudKit, Card, Guide, Tags, Skipper } from './common.js';
import { winFor, helped } from '../sizes.js';
import { paneWindow, duskSky } from '../venues.js';

const TOP = 58;                        // top of the book tower
const BOARD_X0 = -4, BOARD_LEN = 26;   // the ruler: from its pivot under the top book to its tip
const TIP_X = BOARD_X0 + BOARD_LEN - 2;
const BX = 52, BR = 16, BCY = 15;      // the bowl: centre x, radius, centre height
const WY = 23;                         // water level in the bowl
const G = 26;                          // gravity in the slowed-down toy time of a dive
const W_TUCK = 1.45 * TAU, W_OPEN = 0.3 * TAU, TWIST_RATE = 1.6;   // somersaults and twists per second
const HOP_T = 0.56;                    // one bounce on the board
const DIVES = 3;
const BOUNCES = 3;                     // timed bounces on the board; the last one takes off
// the dive called for each round (the last round is free)
const CALLED = [
  { name: 'Forward 1½ somersaults, tucked', short: '1½ tucked', som: 1.5, tw: 0 },
  { name: 'Forward 1½ somersaults with a twist', short: '1½ with a twist', som: 1.5, tw: 1 },
  { name: 'Your choice: go big!', short: 'your choice', som: null, tw: null },
];
const COM = 4.1;                       // centre of mass above the soles
// computer divers: the somersaults they go for, timing spread on the board, error when opening out (s)
const BOT = {
  easy: { som: [0.5, 1.5], twist: 0, hop: 0.12, open: 0.13 },
  normal: { som: [1.5, 1.5, 2.5], twist: 0.4, hop: 0.07, open: 0.075 },
  hard: { som: [1.5, 2.5, 2.5], twist: 0.7, hop: 0.035, open: 0.04 },
};
const TUCK = { ...REST, y: -0.4, lean: 0.45, head: 0.35, hipL: 2.3, hipR: 2.3, kneeL: 2.5, kneeR: 2.5, shL: 1.25, shR: 1.25, elL: 1.6, elR: 1.6, abL: 0.25, abR: 0.25, ankL: 0.4, ankR: 0.4 };
const LINE = { ...REST, head: 0.05, shL: 3.05, shR: 3.05, abL: -0.06, abR: -0.06, elL: 0, elR: 0, ankL: -0.6, ankR: -0.6 };
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const fmtSom = (s) => { const w = Math.floor(s), h = s - w >= 0.5; return w ? `${w}${h ? '½' : ''}` : h ? '½' : '0'; };

class Diving {
  constructor(ctx) {
    this.ctx = ctx;
    this.r = ctx.rand;
    this.phase = 'pre';
    this.t = 0;
    this.cam = { x: 20, y: 30, z: 0, yaw: 0.1, pitch: 0.2, width: 80 };
    this.divers = [];
    this.turn = -1;
    this.round = 1;
  }

  async build() {
    const { kit: K, R, competitors } = this.ctx;
    // a bedroom on a summer evening: the last of the sun low through the window, the desk lamp on
    R.setLighting({
      sunDir: [-0.85, 0.5, 0.35], sunColor: 0xffa66a, sunIntensity: 1.9,
      hemiSky: 0x8a86c8, hemiGround: 0x4a3428, hemiIntensity: 0.55,
      envIntensity: 0.45, exposure: 1.04, background: 0x161a32, shadowRadius: 4,
    });
    this.noise = makeNoise2D(17);
    this.buildRoom(K);
    this.buildTower(K);
    this.buildBowl(K);
    this.buildJudges(K, competitors);
    this.particles = new Particles(K.group, 700);
    this.particles.setScale(R.renderer.domElement.height * 0.9);
    competitors.forEach((c, i) => {
      const fig = new Figurine({ paint: c.paint, seed: c.seed, number: c.number });
      fig.setGear('swim');
      K.group.add(fig.root);
      this.divers.push({ c, i, fig, scores: [], total: 0, home: { x: -26 - (i % 2) * 7, z: 10 + i * 5 }, idle: this.r() * 10, bot: c.human ? null : { r: rng(c.seed * 17 + 3) } });
    });
    this.placeWaiting();
    const kit = hudKit(this.ctx);
    this.card = new Card(kit);
    this.guide = new Guide(kit, []);
    this.tags = new Tags(kit, R);
    this.skipper = new Skipper(this.ctx, kit);
    this.applyCamera(1);
  }

  buildRoom(K) {
    const g = K.group, ZW = -130;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(700, 400).rotateX(-Math.PI / 2), floorMaterial({ seed: 9, repeat: 6 }));
    floor.position.set(30, 0, -40); floor.receiveShadow = true; g.add(floor);
    // night-blue wallpaper with glow-in-the-dark stars and moons
    const wc = K.TX.makeCanvas(256), w = wc.getContext('2d'), ec = K.TX.makeCanvas(256), e = ec.getContext('2d');
    w.fillStyle = '#34477c'; w.fillRect(0, 0, 256, 256); e.fillStyle = '#000'; e.fillRect(0, 0, 256, 256);
    const star = (c, x, y, r) => { c.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); c.fill(); };
    const sr = rng(4);
    for (let k = 0; k < 22; k++) {
      const x = sr() * 256, y = sr() * 256, r = 4 + sr() * 7;
      w.fillStyle = '#e9f0b8'; e.fillStyle = '#b8d86a';
      if (k % 7 === 0) { for (const c of [w, e]) { c.beginPath(); c.arc(x, y, r * 1.2, 0, TAU); c.fill(); } w.fillStyle = '#34477c'; e.fillStyle = '#000'; w.beginPath(); w.arc(x + r * 0.6, y - r * 0.3, r * 1.1, 0, TAU); w.fill(); e.beginPath(); e.arc(x + r * 0.6, y - r * 0.3, r * 1.1, 0, TAU); e.fill(); }
      else { star(w, x, y, r); star(e, x, y, r); }
    }
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(700, 260), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(wc, { repeat: [10, 4] }), emissiveMap: K.TX.toTexture(ec, { repeat: [10, 4] }), emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.95 }));
    wall.position.set(30, 130, ZW); wall.receiveShadow = true; g.add(wall);
    // the window, the evening sky outside
    this.win = paneWindow(g, { x: -78, y: 132, z: ZW + 0.2, w: 70, h: 62, sky: duskSky(7), depth: 3 });
    // a poster of a diving dolphin over the bookcase
    const pc = K.TX.makeCanvas(256, 320), p2 = pc.getContext('2d');
    const sea = p2.createLinearGradient(0, 0, 0, 320); sea.addColorStop(0, '#7fd0f5'); sea.addColorStop(0.55, '#3b8fd6'); sea.addColorStop(1, '#1d4f9a');
    p2.fillStyle = sea; p2.fillRect(0, 0, 256, 320);
    p2.fillStyle = '#fff6dc'; p2.beginPath(); p2.arc(200, 60, 26, 0, TAU); p2.fill();
    p2.fillStyle = 'rgba(255,255,255,0.7)'; for (let k = 0; k < 4; k++) { p2.fillRect(0, 200 + k * 24, 256, 3); }
    p2.save(); p2.translate(128, 150); p2.rotate(-0.6); p2.fillStyle = '#5f7f9f';
    p2.beginPath(); p2.ellipse(0, 0, 70, 22, 0, 0, TAU); p2.fill();
    p2.beginPath(); p2.moveTo(-60, 0); p2.lineTo(-95, -22); p2.lineTo(-90, 0); p2.lineTo(-95, 22); p2.closePath(); p2.fill();
    p2.beginPath(); p2.moveTo(-5, -18); p2.lineTo(10, -42); p2.lineTo(20, -16); p2.fill();
    p2.beginPath(); p2.moveTo(60, -6); p2.lineTo(88, 0); p2.lineTo(60, 6); p2.fill();
    p2.fillStyle = '#1f1a17'; p2.beginPath(); p2.arc(48, -6, 3, 0, TAU); p2.fill();
    p2.restore();
    p2.fillStyle = '#fff'; p2.font = '64px "Lilita One", Impact, sans-serif'; p2.textAlign = 'center'; p2.fillText('DIVE!', 128, 300);
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(36, 45), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(pc, { wrap: false }), roughness: 0.6 }));
    poster.position.set(14, 96, ZW + 0.5); poster.rotation.z = 0.03; poster.receiveShadow = true; g.add(poster);
    // a planet mobile turning slowly over the bowl
    this.mobile = new THREE.Group(); this.mobile.position.set(BX - 8, 196, -46); g.add(this.mobile);
    const thread = new THREE.MeshBasicMaterial({ color: 0xe8e2d4 });
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 60, 4), thread); string.position.y = 30; this.mobile.add(string);
    const planets = [[0xf2c230, 4.2, 0, true], [0x3d7bd9, 3.2, 1], [0xe2653a, 2.6, 2], [0x9fd1c4, 3.6, 3]];
    planets.forEach(([col, r, k, ring]) => {
      const a = (k / 4) * TAU, arm = 16, len = 14 + k * 5;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, arm, 6).rotateZ(Math.PI / 2), K.std({ color: 0xd9b48a }));
      stick.position.set(Math.cos(a) * arm / 2, 0, Math.sin(a) * arm / 2); stick.rotation.y = -a; this.mobile.add(stick);
      const th = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, len, 4), thread); th.position.set(Math.cos(a) * arm, -len / 2, Math.sin(a) * arm); this.mobile.add(th);
      const pl = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), K.paint(col)); pl.position.set(Math.cos(a) * arm, -len - r, Math.sin(a) * arm); pl.castShadow = true; this.mobile.add(pl);
      if (ring) { const rg = new THREE.Mesh(new THREE.TorusGeometry(r * 1.7, 0.5, 6, 32), K.paint(0xf7e3a8)); rg.rotation.x = 1.2; rg.position.copy(pl.position); this.mobile.add(rg); }
    });
    // the desk lamp on the bookcase, bent over towards the bowl
    const lamp = new THREE.Group(); lamp.position.set(118, 30, -112); lamp.rotation.y = 2.5; g.add(lamp);
    const red = K.paint(0xd9472b);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 1.6, 24), red); base.position.y = 0.8; base.castShadow = true; lamp.add(base);
    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 26, 8), K.metal(0xcfd3d8, 0.3)); arm1.position.set(0, 13, 4); arm1.rotation.x = 0.35; lamp.add(arm1);
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 22, 8), K.metal(0xcfd3d8, 0.3)); arm2.position.set(0, 26, 14); arm2.rotation.x = 1.25; lamp.add(arm2);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(6, 9, 24, 1, true), K.paint(0xd9472b, { side: THREE.DoubleSide })); shade.position.set(0, 27, 25); shade.rotation.x = -2.2; shade.castShadow = true; lamp.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff1c8 })); bulb.position.set(0, 25.2, 26.8); lamp.add(bulb);
    this.lamp = new THREE.PointLight(0xffc27a, 3200, 0, 2); this.lamp.position.set(0, 22, 30); lamp.add(this.lamp);
    // a low bookcase along the wall, full of books
    const wood = K.std({ color: 0xe9dcc4, roughness: 0.6 });
    const bc = new THREE.Mesh(new K.RoundedBoxGeometry(200, 30, 26, 2, 1), wood);
    bc.position.set(40, 15, -116); bc.castShadow = true; bc.receiveShadow = true; g.add(bc);
    const books = [], cols = [0xb5473a, 0x2f4f7a, 0x2fae5a, 0xf2c230, 0x8a55c9, 0xef7d2c, 0x3d7bd9, 0x6e4a2f];
    for (const sy of [4]) for (let x = -56; x < 136; x += 3.4 + (books.length % 3) * 0.6) {
      const h = 17 + ((books.length * 7) % 6);
      books.push({ x, y: sy + h / 2 - 4, z: -97, sx: 3, sy: h, sz: 18, rz: (books.length % 11 === 0) ? 0.18 : 0, color: cols[(books.length * 5) % cols.length] });
    }
    K.instances(new K.RoundedBoxGeometry(1, 1, 1, 1, 0.08), K.std({ roughness: 0.7 }), books, { colors: true });
    // a round rug under the bowl
    const rc = K.TX.makeCanvas(256), r2 = rc.getContext('2d');
    for (let k = 0; k < 8; k++) { r2.fillStyle = ['#f2c4cf', '#fff1d6', '#9fd1c4', '#fff1d6'][k % 4]; r2.beginPath(); r2.arc(128, 128, 126 - k * 15, 0, TAU); r2.fill(); }
    const rug = new THREE.Mesh(new THREE.CircleGeometry(48, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(rc, { wrap: false }), roughness: 1 }));
    rug.position.set(BX, 0.15, 0); rug.receiveShadow = true; g.add(rug);
  }

  buildTower(K) {
    const g = K.group;
    // hardcover books stacked into a tower, a little skew
    const covers = [], pages = [], cols = [0xb5473a, 0x2f4f7a, 0x2fae5a, 0xf2c230, 0x8a55c9, 0xef7d2c, 0x3d7bd9, 0x9c6b3f, 0xe23b2e];
    const n = 23, th = TOP / n;
    for (let k = 0; k < n; k++) {
      const ry = (this.r() - 0.5) * 0.18, dx = (this.r() - 0.5) * 1.2, dz = (this.r() - 0.5) * 1.2;
      const w = 23 + this.r() * 4, d = 16 + this.r() * 3;
      covers.push({ x: -10 + dx, y: th * k + th / 2, z: dz, ry, sx: w, sy: th, sz: d, color: cols[(k * 4) % cols.length] });
      pages.push({ x: -10 + dx + 0.4, y: th * k + th / 2, z: dz, ry, sx: w - 0.6, sy: th * 0.8, sz: d + 0.12, color: 0xf6efdc });
    }
    K.instances(new K.RoundedBoxGeometry(1, 1, 1, 1, 0.06), K.std({ roughness: 0.6 }), covers, { colors: true });
    K.instances(new THREE.BoxGeometry(1, 1, 1), K.std({ roughness: 0.9 }), pages, { colors: true });
    K.contact(-10, 0, 16, 12, 0.45);
    // the ruler springboard, held down by a heavy book
    const rc = K.TX.makeCanvas(1024, 64), c = rc.getContext('2d');
    c.fillStyle = '#e9d3a0'; c.fillRect(0, 0, 1024, 64);
    c.fillStyle = '#3a3634'; for (let k = 0; k <= 30; k++) { const x = 8 + k * 33.5; c.fillRect(x, 0, 2, k % 5 === 0 ? 24 : 12); if (k % 5 === 0) { c.font = '16px Rubik, sans-serif'; c.fillText(String(k), x + 3, 40); } }
    this.board = new THREE.Group();
    this.board.position.set(BOARD_X0, TOP + 0.25, 0);
    const ruler = new THREE.Mesh(new K.RoundedBoxGeometry(BOARD_LEN + 6, 0.5, 3.4, 1, 0.12), [K.std({ color: 0xe9d3a0, roughness: 0.5 }), K.std({ color: 0xe9d3a0, roughness: 0.5 }), new THREE.MeshStandardMaterial({ map: K.TX.toTexture(rc, { wrap: false }), roughness: 0.5 }), K.std({ color: 0xe9d3a0 }), K.std({ color: 0xe9d3a0 }), K.std({ color: 0xe9d3a0 })]);
    ruler.position.x = (BOARD_LEN + 6) / 2 - 6; ruler.castShadow = true; ruler.receiveShadow = true;
    this.board.add(ruler);
    g.add(this.board);
    const weight = new THREE.Mesh(new K.RoundedBoxGeometry(14, 4, 12, 2, 0.4), K.std({ color: 0x2f4f7a, roughness: 0.6 }));
    weight.position.set(-11, TOP + 2.4, 0); weight.rotation.y = 0.12; weight.castShadow = true; g.add(weight);
  }

  buildBowl(K) {
    const g = K.group;
    const top = Math.asin((26.5 - BCY) / BR);   // the opening
    const cut = Math.PI / 2 - top;
    const glass = new THREE.Mesh(new THREE.SphereGeometry(BR, 48, 32, 0, TAU, cut, Math.PI - cut - 0.25), K.glass(0xe8f6ff, 0.13));
    glass.position.set(BX, BCY, 0); glass.renderOrder = 3; g.add(glass);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(BR * Math.cos(top), 0.45, 10, 48).rotateX(Math.PI / 2), K.glass(0xffffff, 0.35));
    lip.position.set(BX, 26.5, 0); g.add(lip);
    // the water inside, and its surface
    const wcut = Math.PI / 2 - Math.asin((WY - BCY) / (BR - 0.4));
    this.waterMat = new THREE.MeshPhysicalMaterial({ color: 0x7cc8e8, roughness: 0.08, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
    const water = new THREE.Mesh(new THREE.SphereGeometry(BR - 0.4, 40, 24, 0, TAU, wcut, Math.PI - wcut - 0.25), this.waterMat);
    water.position.set(BX, BCY, 0); water.renderOrder = 2; g.add(water);
    const sr = (BR - 0.4) * Math.sin(wcut);
    const nf = K.TX.noiseField(128, { seed: 5, period: 16, oct: 3 });
    this.surfNormal = K.TX.toTexture(K.TX.normalFromHeight(nf, 128, 128, 2), { srgb: false, repeat: [2, 2] });
    this.surface = new THREE.Mesh(new THREE.CircleGeometry(sr, 40).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x8fd0ea, roughness: 0.05, transparent: true, opacity: 0.5, normalMap: this.surfNormal, clearcoat: 1, depthWrite: false }));
    this.surface.position.set(BX, WY, 0); this.surface.renderOrder = 2; g.add(this.surface);
    // pebbles, a little castle and a goldfish
    const peb = [], pc = [0xf2c4cf, 0x9fd1c4, 0xfff1a8, 0xc8d8f8, 0xffffff];
    for (let k = 0; k < 70; k++) { const a = this.r() * TAU, rr = Math.sqrt(this.r()) * 9; peb.push({ x: BX + Math.cos(a) * rr, y: 2.2 + this.r() * 0.8, z: Math.sin(a) * rr, s: 0.7 + this.r() * 0.5, color: pc[k % pc.length] }); }
    K.instances(new THREE.IcosahedronGeometry(1, 1), K.plastic(0xffffff, 0.4), peb, { colors: true, cast: false });
    const castle = new THREE.Mesh(K.merge([
      { geo: new THREE.CylinderGeometry(2.2, 2.4, 6, 12), color: 0xd9a066, pos: [0, 3, 0] },
      { geo: new THREE.ConeGeometry(2.6, 3, 12), color: 0xe23b2e, pos: [0, 7.5, 0] },
      { geo: new THREE.CylinderGeometry(1.3, 1.4, 4, 10), color: 0xd9a066, pos: [3, 2, 1] },
      { geo: new THREE.ConeGeometry(1.6, 2, 10), color: 0xe23b2e, pos: [3, 5, 1] },
    ]), K.std({ vertexColors: true, roughness: 0.7 }));
    castle.position.set(BX + 4, 2.4, -4); g.add(castle);
    this.fish = new THREE.Mesh(K.merge([
      { geo: new THREE.SphereGeometry(1.4, 16, 12), color: 0xff8a2a, scale: [1.5, 1, 0.75] },
      { geo: new THREE.ConeGeometry(1.1, 1.8, 4).rotateZ(Math.PI / 2), color: 0xffb35c, pos: [-2.6, 0, 0], scale: [1, 1, 0.3] },
      { geo: new THREE.SphereGeometry(0.28, 8, 6), color: 0x1f1a17, pos: [1.5, 0.35, 0.62] },
      { geo: new THREE.SphereGeometry(0.28, 8, 6), color: 0x1f1a17, pos: [1.5, 0.35, -0.62] },
    ]), K.plastic(0xffffff, 0.3, { vertexColors: true }));
    g.add(this.fish);
    K.contact(BX, 0, BR * 0.8, BR * 0.8, 0.35);
  }

  buildJudges(K, competitors) {
    // five plush judges on a long cushion, and the rest of the toys watching
    const g = K.group;
    const cush = new THREE.Mesh(new K.RoundedBoxGeometry(62, 6, 16, 3, 3), K.felt(0xc4655a));
    cush.position.set(BX + 58, 3, -18); cush.rotation.y = -0.35; cush.castShadow = true; cush.receiveShadow = true; g.add(cush);
    this.judgeSpots = [];
    const spots = [];
    for (let k = 0; k < 5; k++) {
      const u = (k - 2) * 11.5;
      const x = BX + 58 + Math.cos(-0.35) * u, z = -18 - Math.sin(-0.35) * u;
      spots.push({ x, y: 6, z, ry: -0.6, size: 10 });
      this.judgeSpots.push({ x, y: 6, z });
    }
    for (let k = 0; k < 5; k++) spots.push({ x: -50 + k * 12, y: 0, z: -40 - (k % 2) * 5, ry: 0.4, size: 11 });
    this.crowd = crowd(g, spots, 23);
    [[-40, -24], [100, 26]].forEach(([x, z], k) => {
      const b = banner(competitors[k % competitors.length].code, 14, { seed: 30 + k });
      b.position.set(x, 0, z); b.rotation.y = k ? -0.7 : 0.3;
      g.add(b);
    });
  }

  attract() {}

  start() {
    this.ctx.sound.setLoop('crowd', 0.25);
    this.turn = -1; this.round = 1;
    this.next();
  }

  next() {
    this.turn++;
    if (this.turn >= this.divers.length) {
      if (this.round < DIVES) { this.round++; this.turn = 0; this.ctx.hud.message(this.round === DIVES ? 'Last dive!' : `Dive ${this.round}`, 'small', '#ffc93c', 1.4); } else { this.finishAll(); return; }
    }
    const d = this.cur = this.divers[this.turn];
    this.called = CALLED[this.round - 1];
    this.dv = { hop: -1, hops: 0, amp: 0.25, hopT: 0, q: [], x: TIP_X - 1.5, y: TOP + 0.5, theta: 0, twist: 0, twistGoal: 0, tucked: false, wasTucked: false, flightT: 0, last: null };
    if (!d.bot) this.skipper.update(false, false);
    this.phase = 'ready'; this.t = 0;
    this.placeWaiting();
    d.fig.setExpression('focus');
    if (d.bot) this.planBot(d);
    this.ctx.competitors.forEach((c, i) => this.ctx.hud.chip(i, this.divers[i].scores.length ? `${this.divers[i].total.toFixed(1)}` : '', i === d.i ? 'active' : ''));
    this.ctx.hud.message(`${d.c.short}: ${this.called.name}`, 'small', '#fff', 2.2);
    this.updateCard();
  }

  planBot(d) {
    const B = BOT[this.ctx.skillName] || BOT.normal, r = d.bot.r;
    d.bot.som = this.called.som ?? B.som[Math.floor(r() * B.som.length)];
    d.bot.twists = this.called.tw ?? (r() < B.twist ? (r() < 0.5 ? 1 : 2) : 0);
    d.bot.wait = 0.8 + r() * 0.6;
    d.bot.pressed = 0;
  }

  // ---------------------------------------------------------------- per step
  update(dt) {
    const ctx = this.ctx, now = ctx.time();
    this.t += dt;
    if (this.phase === 'pre') { for (const d of this.divers) ctx.presses(d.i); return; }
    if (this.phase === 'done') {
      for (const d of this.divers) ctx.presses(d.i);
      if (this.t > 1.6 && this.results) { const r = this.results; this.results = null; ctx.finish(r); }
      return;
    }
    const d = this.cur, v = this.dv;
    if (d.bot) this.botUpdate(d, now);
    let q = [], skip = false;
    for (const x of this.divers) {
      const e = ctx.presses(x.i);
      if (x === d) q = e;
      if (x.c.human && e.some((y) => y.b === 'action' && y.down)) skip = true;
    }
    // watching a computer diver: action fast-forwards
    this.skipper.update(!!d.bot, skip);
    if (this.phase === 'ready' || this.phase === 'bounce') {
      const little = d.c.human && helped(d.c);
      if (!little) for (const e of q) if (e.down && e.b === 'action') this.hopPress(e.t);
      if (v.last) v.last.t += dt;
      // Little divers bounce by themselves
      if (little && (this.phase === 'ready' ? this.t > 1.2 : v.hopT >= HOP_T * (0.7 + 0.3 * v.amp) * 0.96)) this.hopPress(now);
      if (this.phase === 'bounce') {
        v.hopT += dt;
        if (v.hopT >= HOP_T * (0.7 + 0.3 * v.amp)) { v.hopT = 0; v.hops++; ctx.sound.thump(0.25 + v.amp * 0.3); if (v.hops > 8) this.takeoff(0.2); }
      }
      if (this.phase === 'ready' && this.t > 12) this.hopPress(now);
    } else if (this.phase === 'flight') {
      const held = ctx.held(d.i), little = d.c.human && helped(d.c);
      // a Little diver tucks with any button
      v.tucked = (held.action || (little && (held.left || held.right))) && v.flightT > 0.08;
      if (v.tucked) v.wasTucked = true;
      if (!little) for (const e of q) if (e.down && e.b !== 'action' && !v.tucked) { v.twistGoal += 0.5; v.twistDir = e.b === 'left' ? -1 : 1; }
      v.flightT += dt;
      v.theta += (v.tucked ? W_TUCK : W_OPEN) * dt;
      if (v.twist < v.twistGoal) v.twist = Math.min(v.twistGoal, v.twist + TWIST_RATE * dt);
      v.x += v.vx * dt; v.vy -= G * dt; v.y += v.vy * dt;
      if (v.y <= WY) this.entry();
    } else if (this.phase === 'entry') {
      v.y = Math.max(WY - 9, v.y + v.vy * dt); v.vy = damp(v.vy, 0, 4, dt);
      if (this.t > 1.0) { this.phase = 'scores'; this.t = 0; this.showScores(); }
    } else if (this.phase === 'scores') {
      if (skip && this.t > 0.8) this.t = Math.max(this.t, 3.2);
      if (this.t > 3.6) { this.tags.clear(); this.next(); }
    }
  }

  botUpdate(d, now) {
    const v = this.dv, pad = d.c.pad, b = d.bot, B = BOT[this.ctx.skillName] || BOT.normal;
    if (this.phase === 'ready' && this.t > b.wait && !b.pressed) { pad.push('action', true, now); pad.push('action', false, now + 0.05); b.pressed = 1; b.nextHop = null; }
    if (this.phase === 'bounce') {
      // tap as the feet meet the board
      const len = HOP_T * (0.7 + 0.3 * v.amp);
      if (b.nextHop == null) b.nextHop = now + (len - v.hopT) + b.r.gauss() * B.hop;
      if (now >= b.nextHop) { pad.push('action', true, now); pad.push('action', false, now + 0.05); b.nextHop = null; }
    }
    if (this.phase === 'flight') {
      // tuck until stretching out would carry the spin round to head-down at the water
      if (b.tuckFrom == null) {
        b.tuckFrom = 0.12;
        const T = this.timeToWater(v);
        const goal = b.som * TAU;
        b.tuckFor = (goal - W_OPEN * T) / (W_TUCK - W_OPEN) + b.r.gauss() * B.open;
        if (b.tuckFor > T - 0.45) { b.som = Math.max(0.5, b.som - 1); b.tuckFor = (b.som * TAU - W_OPEN * T) / (W_TUCK - W_OPEN) + b.r.gauss() * B.open; }
        b.twistAt = b.tuckFrom + Math.max(0, b.tuckFor) + 0.05;
        // only the twists there is time for once stretched out
        const room = T - b.twistAt - 0.25;
        b.twists = Math.min(b.twists, Math.max(0, Math.floor(room * TWIST_RATE * 2) / 2));
        b.twisted = 0;
      }
      const f = v.flightT;
      const want = b.tuckFor > 0.05 && f >= b.tuckFrom && f < b.tuckFrom + b.tuckFor;
      if (want !== !!pad.held.action) pad.push('action', want, now);
      if (b.twisted < b.twists * 2 && f > b.twistAt + b.twisted * 0.08 && !want) { pad.push('right', true, now); pad.push('right', false, now + 0.04); b.twisted++; }
    } else b.tuckFrom = null;
  }

  // time until the diver reaches the water from now
  timeToWater(v) { const dy = v.y - WY; return (v.vy + Math.sqrt(v.vy * v.vy + 2 * G * dy)) / G; }

  hopPress(t) {
    const v = this.dv, ctx = this.ctx;
    if (this.phase === 'ready') { this.phase = 'bounce'; this.t = 0; v.hopT = 0; v.hops = 0; ctx.hud.message(''); ctx.sound.pop(); return; }
    // the best moment is just as the feet meet the board (the start or end of a hop)
    const len = HOP_T * (0.7 + 0.3 * v.amp);
    const u = v.hopT / len;
    const q = clamp(1 - Math.min(u, 1 - u) / winFor(this.cur.c, 0.22), 0, 1);
    v.q.push(q);
    v.amp = clamp(v.amp + 0.1 + 0.2 * q, 0, 1);
    // how it went, shown next to the board: great, or early (before the feet land) / late (after)
    v.last = { q, word: q > 0.75 ? 'great!' : q > 0.4 ? (u > 0.5 ? 'a bit early' : 'a bit late') : (u > 0.5 ? 'early' : 'late'), t: 0 };
    ctx.sound.pop();
    if (v.q.length >= BOUNCES) this.takeoff(q);
  }

  takeoff(q) {
    const v = this.dv, ctx = this.ctx;
    const avg = v.q.length ? v.q.reduce((a, b) => a + b, 0) / v.q.length : 0.2;
    v.vy = 10 + 13 * v.amp * (0.5 + 0.5 * avg) * (0.7 + 0.3 * q);
    v.y = TOP + 1.2; v.x = TIP_X;
    const T = this.timeToWater(v);
    v.vx = (BX - v.x) / T;
    v.T = T; v.flightT = 0;
    this.phase = 'flight'; this.t = 0;
    ctx.sound.whoosh(0.6);
    this.boardKick = 1;
  }

  entry() {
    const v = this.dv, d = this.cur, ctx = this.ctx;
    // how far from head-down and straight; tucked at the water is a cannonball
    const err = Math.abs(wrapPi(v.theta - Math.PI));
    const twistLeft = v.twistGoal - v.twist;
    const som = Math.max(0, Math.round((v.theta - Math.PI) / TAU)) + 0.5;
    const feet = err > Math.PI / 2;
    const cannon = v.tucked;
    // smaller divers: the judges are kinder about the angle
    let exe = 10 - 7.5 * clamp(err / winFor(d.c, 1.1), 0, 1) - (cannon ? 3 : 0) - twistLeft * 6 - (feet ? 1.5 : 0);
    if (v.T < 1.75) exe -= 0.5;
    exe = clamp(exe, 0, 10);
    const twists = Math.floor(v.twist * 2 + 1e-6) / 2;
    const dd = feet ? 1.0 : Math.round((1.2 + 0.45 * (som - 0.5) + 0.35 * twists) * 10) / 10;
    const c = this.called;
    // the called dive; a Little diver only has to get the somersaults right
    const wrong = c.som != null && (feet || som !== c.som || (twists !== c.tw && !helped(d.c)));
    v.result = { err, som: feet ? som - 0.5 : som, twists, exe, dd, cannon, feet, wrong };
    v.vy = -10;
    this.phase = 'entry'; this.t = 0;
    const big = cannon ? 3 : clamp(err / 0.6, 0.15, 2.5);
    this.particles.emit(BX, WY + 0.5, 0, { vx: 0, spread: 3 + big * 4, up: 6 + big * 9, color: 0xffffff, size: 0.8, life: 0.7, alpha: 0.8, grav: 26, n: Math.round(8 + big * 26) });
    ctx.sound.puff(0.4 + big * 0.3);
    if (d.c.human || exe > 8) ctx.hud.flash(exe > 8.5 ? 'Rip entry!' : cannon ? 'Cannonball!' : feet ? 'Feet first' : err > 0.5 ? 'Splash!' : 'Clean', exe > 8.5 ? '#7be495' : exe > 6 ? '#ffffff' : '#ff8a65');
    this.splashT = 1.2;
  }

  showScores() {
    const d = this.cur, v = this.dv, ctx = this.ctx;
    const res = v.result;
    // five judges, each a little different; the highest and lowest are dropped
    const marks = this.judgeSpots.map(() => clamp(Math.round((res.exe + this.r.gauss() * 0.45) * 2) / 2, 0, 10));
    const sorted = [...marks].sort((a, b) => a - b);
    const mid = sorted[1] + sorted[2] + sorted[3];
    // not the dive that was called: the judges halve it
    const pts = Math.round(mid * res.dd * (res.wrong ? 0.5 : 1) * 10) / 10;
    d.scores.push(pts); d.total = Math.round((d.total + pts) * 10) / 10;
    d.last = { ...res, marks, pts };
    this.judgeSpots.forEach((s, k) => this.tags.set('j' + k, `<span class="pill" style="--tc:${marks[k] >= 8 ? '#7be495' : marks[k] >= 5 ? '#fff1d6' : '#ff8a65'};font-size:15px">${marks[k].toFixed(1)}</span>`));
    const what = res.feet ? 'feet first' : `${fmtSom(res.som)} somersault${res.som > 1 ? 's' : ''}${res.twists ? `, ${fmtSom(res.twists)} twist${res.twists > 1 ? 's' : ''}` : ''}`;
    ctx.hud.message(`${pts.toFixed(1)} pts`, '', pts >= 60 ? '#ffc93c' : '#fff');
    ctx.hud.flash(`${what} · difficulty ${res.dd.toFixed(1)}`, '#ffffff');
    if (res.wrong) ctx.hud.flash(`Not the dive called (${this.called.short}): half points`, '#ff8a65');
    ctx.sound.cheer(clamp(res.exe / 10, 0.2, 1.1)); if (res.exe > 7) ctx.sound.clap(6);
    d.fig.setExpression(res.exe > 7.5 ? 'wow' : res.exe > 5 ? 'happy' : 'sad');
    ctx.hud.chip(d.i, `${d.total.toFixed(1)}`, 'active');
    this.updateCard();
  }

  finishAll() {
    this.phase = 'done'; this.t = 0;
    this.cur = null;
    this.placeWaiting();
    const ranked = [...this.divers].sort((a, b) => b.total - a.total);
    this.winner = ranked[0];
    this.ctx.hud.message(`${ranked[0].c.short} wins!`, 'small', '#ffc93c');
    this.guide.show(false);
    this.results = this.divers.map((d) => ({ value: d.total, text: `${d.total.toFixed(1)} pts`, short: `${d.total.toFixed(1)}`, sub: d.scores.map((s) => s.toFixed(1)).join(' · ') }));
    this.updateCard();
  }

  placeWaiting() {
    this.divers.forEach((d) => {
      if (this.cur === d) return;
      d.fig.root.position.set(d.home.x, 0, d.home.z);
      d.fig.root.rotation.set(0, 0.6, 0);
      d.fig.body.rotation.y = 0;
      d.fig.ground = true;
    });
  }

  updateCard() {
    const d = this.cur;
    const humans = this.divers.some((x) => x.c.human);
    const line = d ? `Dive ${this.round} of ${DIVES}: ${this.called.short}${d.bot && humans ? ' · action: fast-forward' : ''}` : 'Final scores';
    const ranked = [...this.divers].filter((x) => x.scores.length).sort((a, b) => b.total - a.total);
    this.card.set(d ? d.c : null, line, ranked.map((x) => ({ c: x.c, text: x.total.toFixed(1), me: x === d })));
  }

  // ---------------------------------------------------------------- per frame
  frame(dt, paused) {
    const ctx = this.ctx, tt = ctx.time();
    if (!paused) {
      this.particles.update(dt);
      this.surfNormal.offset.x = (tt * 0.02) % 1;
      if (this.splashT > 0) this.splashT -= dt;
    }
    // the goldfish swims round and round
    const fa = tt * 0.7;
    if (!paused) this.mobile.rotation.y += dt * 0.18;
    this.fish.position.set(BX + Math.cos(fa) * 7, 10 + Math.sin(tt * 1.3) * 2, Math.sin(fa) * 7);
    this.fish.rotation.set(0, -fa - Math.PI / 2 + Math.sin(tt * 6) * 0.15, 0);
    const d = this.cur, v = this.dv;
    this.divers.forEach((x) => {
      if (x === d && this.phase !== 'done') return;
      const w = tt + x.idle;
      x.fig.setPose(this.phase === 'done' && x === this.winner ? POSES.cheer(w) : (Math.floor(w / 3) % 3) === 1 ? POSES.wave(w) : POSES.stand(w));
    });
    // the board springs under the diver
    let bend = 0;
    if (d && v && (this.phase === 'bounce' || this.phase === 'ready')) {
      const len = HOP_T * (0.7 + 0.3 * v.amp), u = this.phase === 'bounce' ? v.hopT / len : 0;
      bend = this.phase === 'bounce' ? -Math.max(0, Math.cos(u * TAU)) * (0.5 + 1.6 * v.amp) * Math.max(0, 1 - Math.min(u, 1 - u) * 4) : 0;
    }
    if (this.boardKick > 0 && !paused) this.boardKick = Math.max(0, this.boardKick - dt * 1.5);
    const wob = (this.boardKick || 0) * Math.sin(tt * 40) * 1.2;
    this.board.rotation.z = (bend + wob) / BOARD_LEN;
    if (d && v && this.phase !== 'done') this.poseDiver(d, v, tt, bend);
    this.crowd.update(tt, this.phase === 'flight' ? 0.6 : this.phase === 'scores' ? 0.6 : 0.15);
    this.updateHud(tt);
    this.applyCamera(dt);
  }

  poseDiver(d, v, tt, bend) {
    const fig = d.fig, root = fig.root;
    fig.ground = false;
    root.rotation.set(0, Math.PI / 2, 0);
    if (this.phase === 'ready' || this.phase === 'bounce') {
      const len = HOP_T * (0.7 + 0.3 * v.amp), u = this.phase === 'bounce' ? v.hopT / len : 0;
      const h = this.phase === 'bounce' ? 4 * u * (1 - u) * (1.5 + 4 * v.amp) : 0;
      root.position.set(v.x, TOP + 0.5 + bend + h, 0);
      fig.body.rotation.y = 0;
      const crouch = this.phase === 'bounce' ? Math.max(0, 1 - Math.min(u, 1 - u) * 5) : 0;
      const arms = this.phase === 'bounce' ? 1.5 + 1.4 * Math.sin(u * Math.PI) : 0.2;
      fig.setPose({ ...(this.phase === 'ready' ? POSES.stand(tt) : REST), y: -0.6 * crouch, hipL: 0.6 * crouch, hipR: 0.6 * crouch, kneeL: 1.1 * crouch, kneeR: 1.1 * crouch, shL: arms, shR: arms, abL: 0.1, abR: 0.1, elL: 0.1, elR: 0.1, ankL: -0.3 * (1 - crouch), ankR: -0.3 * (1 - crouch) });
      return;
    }
    if (this.phase === 'flight') {
      const k = v.tucked ? 1 : 0;
      v.tk = damp(v.tk ?? 0, k, 14, 1 / 60);
      const pose = blendPose(LINE, TUCK, v.tk);
      pose.pitch = v.theta;
      fig.setPose(pose);
      fig.body.rotation.y = (v.twistDir || 1) * v.twist * TAU;
      root.position.set(v.x - COM * Math.sin(v.theta), v.y - COM * Math.cos(v.theta), 0);
      return;
    }
    // in the water: under, then bobbing up to wave
    fig.body.rotation.y = 0;
    const up = this.phase === 'scores' || this.t > 0.5;
    if (!up) {
      const pose = { ...LINE, pitch: Math.PI };
      fig.setPose(pose);
      root.position.set(BX, v.y + 7, 0);
    } else {
      const res = v.result || {};
      fig.setPose(res.exe > 6 ? { ...POSES.wave(tt), y: 0 } : { ...POSES.stand(tt), shL: 0.6, shR: 0.6, abL: 0.8, abR: 0.8 });
      root.position.set(BX, WY - 6.2 + Math.sin(tt * 3) * 0.3, 0);
      root.rotation.set(0, 0.5, 0);
    }
  }

  updateHud(tt) {
    const d = this.cur, v = this.dv, ph = this.phase;
    const show = d && d.c.human && (ph === 'ready' || ph === 'bounce' || ph === 'flight');
    this.guide.show(!!show);
    if (show) {
      const touch = d.c.type === 'touch', a = touch ? '●' : 'action';
      this.guide.tip(helped(d.c) ? (ph === 'flight' ? 'hold any button to spin · let go when the dial is green' : 'you bounce by yourself · get ready to spin!')
        : ph === 'ready' ? `${this.called.name} · tap ${a} to start bouncing`
        : ph === 'bounce' ? `tap ${a} as the ring closes (feet on the board): ${BOUNCES} bounces, the last one takes off`
          : `hold ${a} to tuck and spin · let go when the dial is green${this.called.tw ? ` · then tap ${touch ? '◀ ▶' : 'left/right'} twice to twist` : ` · ${touch ? '◀ ▶' : 'left/right'}: twist`}`);
    }
    // the bounce ring: it closes on the green circle as the feet meet the board
    if (d && v && d.c.human && (ph === 'bounce' || (ph === 'ready' && this.t > 0.2))) {
      const len = HOP_T * (0.7 + 0.3 * v.amp), u = ph === 'bounce' ? v.hopT / len : 1;
      const rr = 15 + 44 * (1 - u);
      const last = v.last && v.last.t < 0.7 ? `<span class="pill" style="--tc:${v.last.q > 0.75 ? '#7be495' : v.last.q > 0.4 ? '#fff1d6' : '#ff8a65'}">${v.last.word}</span>` : `<span class="pill" style="--tc:#fff1d6">bounce ${Math.min(BOUNCES, v.q.length + (ph === 'bounce' ? 1 : 0))} of ${BOUNCES}</span>`;
      const svg = `<svg width="130" height="130" viewBox="-65 -65 130 130"><circle r="15" fill="rgba(123,228,149,.35)" stroke="#2fae5a" stroke-width="4"/><circle r="${rr.toFixed(1)}" fill="none" stroke="#1f1a17" stroke-width="4" stroke-dasharray="${ph === 'ready' ? '6 5' : 'none'}"/></svg>`;
      this.tags.set('ring', `${svg}<br>${last}`);
      this.tags.place('ring', v.x, TOP + 0.5, 0, 'center');
    } else this.tags.hide('ring');

    // the dial beside the diver: where the spin ends up if you stretch out now
    if (d && v && ph === 'flight') {
      const T = Math.max(0, this.timeToWater(v));
      const end = v.theta + W_OPEN * T;
      const err = Math.abs(wrapPi(end - Math.PI));
      const target = this.called.som;
      const endSom = Math.max(0, Math.round((end - Math.PI) / TAU)) + 0.5;
      const good = err < winFor(d.c, 0.45) && !v.tucked && (target == null || endSom === target);
      const ang = (end * 180) / Math.PI;
      const svg = `<svg width="58" height="58" viewBox="-29 -29 58 58"><circle r="25" fill="rgba(255,244,220,.92)" stroke="#1f1a17" stroke-width="3"/><path d="M0 0 L${(Math.sin(0.45) * 24).toFixed(1)} ${(Math.cos(0.45) * 24).toFixed(1)} A24 24 0 0 1 ${(-Math.sin(0.45) * 24).toFixed(1)} ${(Math.cos(0.45) * 24).toFixed(1)} Z" fill="#7be495"/><g transform="rotate(${ang.toFixed(0)})"><line x1="0" y1="6" x2="0" y2="-19" stroke="${good ? '#2fae5a' : '#e23b2e'}" stroke-width="4" stroke-linecap="round"/><circle cy="-19" r="4.5" fill="${good ? '#2fae5a' : '#e23b2e'}"/></g></svg>`;
      const som = Math.max(0, v.theta / TAU);
      this.tags.set('dial', `${svg}<br><span class="pill" style="--tc:${good ? '#7be495' : '#fff1d6'}">${fmtSom(Math.floor(som * 2) / 2)}${target != null ? ` of ${fmtSom(target)}` : ''} ↻</span>`);
      this.tags.place('dial', v.x - 13, v.y + 1, 0, 'center');
    } else this.tags.hide('dial');
    if (ph === 'scores') this.judgeSpots.forEach((s, k) => this.tags.place('j' + k, s.x, s.y + 16, s.z));
  }

  applyCamera(dt) {
    const R = this.ctx.R, c = this.cam, ph = this.phase, v = this.dv;
    let want;
    if (ph === 'flight' && v) want = { x: v.x + (BX - v.x) * 0.35, y: v.y + (WY - v.y) * 0.3, z: 0, yaw: 0.1, pitch: 0.2, width: 72 };
    else if (ph === 'entry') want = { x: BX, y: WY + 2, z: 0, yaw: 0.1, pitch: 0.28, width: 60 };
    else if (ph === 'scores') want = { x: BX + 30, y: 16, z: -6, yaw: -0.15, pitch: 0.3, width: 128 };
    else if (ph === 'done') want = { x: 10, y: 14, z: 0, yaw: 0.25, pitch: 0.25, width: 130 };
    else want = { x: TIP_X - 1, y: TOP + 3, z: 0, yaw: 0.3, pitch: 0.24, width: 52 };
    const rate = ph === 'flight' ? 4 : 2.6;
    for (const k of Object.keys(want)) c[k] = dt >= 1 ? want[k] : damp(c[k], want[k], rate, Math.min(dt, 0.1));
    R.orbit(c.x, c.y, c.z, { yaw: c.yaw, pitch: c.pitch, width: c.width, shadowSpan: Math.max(150, c.width * 1.6) });
    R.setFocus(0.5, 0.3, 0.8);
  }

  // ---------------------------------------------------------------- cinematics
  get room() { return 'The bedroom, at dusk'; }
  flyIn() {
    return [
      { x: -78, y: 132, z: -90, yaw: 0.15, pitch: 0.03, width: 100 },
      { x: 30, y: 110, z: -60, yaw: -0.15, pitch: 0.1, width: 200 },
      { x: BX - 10, y: 36, z: 0, yaw: 0.2, pitch: 0.22, width: 150 },
    ];
  }
  ceremonySpot() { return { x: 78, y: 30, z: -112, style: 'books', gear: 'swim', yaw: 0.12, pitch: 0.14, width: 38 }; }

  dispose() {
    for (const d of this.divers) d.fig.dispose();
    this.tags?.clear();
  }
}

export default {
  id: 'diving', name: 'Diving', season: 'Summer',
  blurb: 'Off a ruler on a tower of books into the goldfish bowl: bounce, spin, and in head first.',
  venue: 'A bedroom on a summer evening: a tower of picture books with a ruler for a springboard, the goldfish bowl below and five plush judges.',
  loading: 'Filling the fishbowl…',
  how: [
    { verb: 'Timing', text: 'Tap <b>action</b> to start bouncing, then tap as the ring closes and your feet touch the board. Three bounces: the third takes off, higher if they were on time.' },
    { verb: 'Power', text: '<b>Hold action</b> to tuck and spin, let go to stretch out. The dial next to you turns <b>green</b> when stretching out now gets you in head first.' },
    { verb: 'Steer', text: 'Stretched out, tap <b>left</b> or <b>right</b> for half twists. Dive 1 is 1½ somersaults, dive 2 adds a twist, dive 3 is your choice: a different dive from the one called scores half.' },
  ],
  helpers: {
    little: 'You <b>bounce by yourself</b>. In the air, hold <b>any button</b> to spin and let go when the dial turns <b>green</b>. No twists needed.',
    kid: 'More time on the board, and the dial and the judges forgive a bit more.',
  },
  better: 'higher',
  resultsDelay: 0.6,
  create: (ctx) => new Diving(ctx),
};
