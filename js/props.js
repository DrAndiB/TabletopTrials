// Playroom props shared by every venue: wooden floorboards, the stuffed-animal crowd, kid-painted
// cardboard flag banners, letter blocks and crayons. All procedural.
import * as THREE from '../vendor/three.bundle.js';
import { RoundedBoxGeometry } from '../vendor/three.bundle.js';
import * as TX from './textures.js';
import { rng, clamp, makeNoise2D } from './util.js';
import { drawFlag } from './flags.js';
import { countryByCode } from './data/countries.js';

const TAU = Math.PI * 2;

// ---------- floor ----------
export function floorMaterial({ base = 0xb8865a, dark = 0x7d5434, light = 0xd9b183, planks = 5, seed = 3, repeat = 8 } = {}) {
  const t = TX.woodTextures({ size: 1024, planks, base, dark, light, seed, ringFreq: 14, roughBase: 0.5, lacquer: 0.5 });
  for (const k of ['map', 'normalMap', 'roughnessMap']) t[k].repeat.set(repeat, repeat * 0.25);
  return new THREE.MeshStandardMaterial({ ...t, roughness: 0.55, envMapIntensity: 0.7 });
}

// ---------- kid-painted flag on cardboard ----------
// The flag is drawn cleanly, then re-sampled through a wobble so stripe edges look brushed, with
// streaky paint and a ragged unpainted margin of cardboard.
export function paintedFlagCanvas(code, width = 256, { seed = 1, margin = 0.06 } = {}) {
  const c = countryByCode(code);
  const W = Math.round(width), H = Math.round(width * Math.max(0.5, Math.min(c.ratio, 0.8)));
  const src = document.createElement('canvas'); src.width = W; src.height = H;
  // the flag keeps its own proportions inside a banner of moderate shape
  const fw = W * (1 - margin * 2), fh = Math.min(H * (1 - margin * 2.6), fw * c.ratio);
  const fx = (W - fw) / 2, fy = (H - fh) / 2;
  const sg = src.getContext('2d');
  sg.translate(fx, fy);
  drawFlag(sg, code, fw, fh);
  const sd = sg.getImageData(0, 0, W, H).data;
  const out = TX.makeCanvas(W, H);
  const n = makeNoise2D(seed * 31 + 7);
  const r = rng(seed);
  const card = [196, 158, 108];
  TX.paint(W, H, (x, y, u, v, o) => {
    // wobble the lookup: large slow waves plus a little fine jitter
    const wx = (n.fbm(u * 6, v * 6, 3, 64) - 0.5) * W * 0.018 + (n.noise(x * 0.4, y * 0.4) - 0.5) * 1.2;
    const wy = (n.fbm(u * 6 + 9, v * 6 + 3, 3, 64) - 0.5) * W * 0.018 + (n.noise(x * 0.4 + 50, y * 0.4) - 0.5) * 1.2;
    const sx = clamp(Math.round(x + wx), 0, W - 1), sy = clamp(Math.round(y + wy), 0, H - 1);
    const i = (sy * W + sx) * 4;
    // ragged edge of the painted area
    const ex = Math.min(x - fx, fx + fw - x), ey = Math.min(y - fy, fy + fh - y);
    const edge = Math.min(ex, ey) + (n.noise(x * 0.15, y * 0.15 + 20) - 0.5) * 5;
    // corrugated cardboard underneath
    const k = 0.9 + 0.1 * Math.sin(y * 0.9) * 0.5 + (n.noise(x * 0.8, y * 0.8 + 99) - 0.5) * 0.12;
    if (edge < 0) { o[0] = card[0] * k; o[1] = card[1] * k; o[2] = card[2] * k; return; }
    // paint streaks along the brush direction (horizontal), thinner near the edges
    const streak = 0.9 + 0.1 * (n.fbm(u * 3, v * 40, 2, 32)) + (n.noise(x * 0.9, y * 0.12) - 0.5) * 0.12;
    const thin = clamp(edge / 3, 0.55, 1);
    for (let ch = 0; ch < 3; ch++) o[ch] = clamp(sd[i + ch] * streak * thin + card[ch] * k * (1 - thin), 0, 255);
  }, out);
  void r;
  return out;
}

const flagTexCache = new Map();
export function paintedFlagTexture(code, width = 256, seed = 1) {
  const key = `${code}:${width}:${seed}`;
  if (!flagTexCache.has(key)) {
    const t = TX.toTexture(paintedFlagCanvas(code, width, { seed }), { wrap: false });
    t.userData.shared = true;
    flagTexCache.set(key, t);
  }
  return flagTexCache.get(key);
}

// A cardboard banner on two pencils, w units wide. Returns a Group standing on the floor, facing +z.
export function banner(code, w = 14, { seed = 1, poleColor = 0xf2c230 } = {}) {
  const tex = paintedFlagTexture(code, 256, seed);
  const h = w * (tex.image.height / tex.image.width);
  const g = new THREE.Group();
  // slightly bent board
  const geo = new THREE.PlaneGeometry(w, h, 12, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / w) * Math.PI) * w * 0.035);
  geo.computeVertexNormals();
  const front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }));
  const poleH = h + 6;
  front.position.y = poleH - h / 2 - 0.3;
  front.castShadow = true; front.receiveShadow = true;
  g.add(front);
  const pencil = pencilGeometry(poleH);
  const pm = new THREE.MeshPhysicalMaterial({ color: poleColor, roughness: 0.4, clearcoat: 0.6 });
  const tipM = new THREE.MeshStandardMaterial({ color: 0xe6c8a0, roughness: 0.8 });
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(pencil.body, pm);
    m.position.set(sx * (w / 2 + 0.25), 0, -0.3);
    m.castShadow = true;
    g.add(m);
    const t = new THREE.Mesh(pencil.tip, tipM);
    t.position.copy(m.position);
    g.add(t);
  }
  g.userData.height = poleH;
  return g;
}

let pencilCache = null;
function pencilGeometry(len) {
  if (pencilCache && pencilCache.len === len) return pencilCache;
  const body = new THREE.CylinderGeometry(0.36, 0.36, len - 1.2, 6);
  body.translate(0, (len - 1.2) / 2, 0);
  const tip = new THREE.ConeGeometry(0.36, 1.2, 6);
  tip.translate(0, len - 0.6, 0);
  pencilCache = { body, tip, len };
  return pencilCache;
}

// ---------- stuffed animals ----------
const ANIMALS = ['bear', 'bunny', 'cat', 'elephant', 'dino', 'bear', 'duck', 'bunny'];
const FUR = {
  bear: [0x9a6a43, 0xc89a62, 0xeee4d4, 0x6e4a32],
  bunny: [0xf3eee6, 0xd9c8c0, 0xf2c4cf, 0xb7b0a6],
  cat: [0xe8954a, 0x9c9c9a, 0x3a3532, 0xf0e2c8],
  elephant: [0x9aa6b4, 0x8fb3d9, 0xc8a8d8],
  dino: [0x6dbb5a, 0x9a7ad0, 0x4fb3a6, 0xe6a23c],
  duck: [0xf6cf3a, 0xf3eee6],
};
let animalGeos = null;
function AG() {
  if (animalGeos) return animalGeos;
  animalGeos = {
    s: new THREE.SphereGeometry(1, 20, 14),
    sLow: new THREE.SphereGeometry(1, 12, 8),
    cap: new THREE.CapsuleGeometry(1, 1, 4, 10),
    cone: new THREE.ConeGeometry(1, 1, 10),
    flat: new THREE.CylinderGeometry(1, 1, 0.25, 18),
  };
  return animalGeos;
}
let feltMat = null, eyeMat = null;
function feltNormal() {
  const h = TX.noiseField(128, { seed: 77, period: 32, oct: 2 });
  const t = TX.toTexture(TX.normalFromHeight(h, 128, 128, 1.5), { srgb: false, repeat: [3, 3] });
  t.userData.shared = true;
  return t;
}
function mats() {
  if (!feltMat) {
    feltMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.92, sheen: 1, sheenRoughness: 0.5, sheenColor: 0xffffff, normalMap: feltNormal(), normalScale: new THREE.Vector2(0.5, 0.5) });
    eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x141012, roughness: 0.15, clearcoat: 1 });
  }
  return { felt: feltMat, eye: eyeMat };
}

// A seated plush toy about `size` units tall, facing +z. Returns {group, update(t, level)}.
export function stuffedAnimal(kind, seed = 1, size = 10) {
  const r = rng(seed * 101 + 3);
  const G = AG();
  const fur = r.pick(FUR[kind] || FUR.bear);
  const furC = new THREE.Color(fur);
  const light = furC.clone().lerp(new THREE.Color(0xffffff), 0.45).getHex();
  const dark = furC.clone().multiplyScalar(0.7).getHex();
  const s = size / 10;
  const body = [], arms = [];
  const P = (geo, color, pos, scale, rot) => ({ geo, color, pos: pos.map((v) => v * s), scale: (Array.isArray(scale) ? scale : [scale, scale, scale]).map((v) => v * s), rot });
  // body and head
  body.push(P(G.s, fur, [0, 3, 0], [3, 3.2, 2.7]));
  body.push(P(G.s, light, [0, 2.7, 1.5], [1.8, 2.1, 1.3]));       // tummy
  const hy = kind === 'duck' ? 7.4 : 7.2;
  body.push(P(G.s, fur, [0, hy, 0.2], kind === 'elephant' ? [2.6, 2.4, 2.4] : [2.4, 2.25, 2.2]));
  // legs (sitting, feet forward)
  for (const sx of [-1, 1]) {
    body.push(P(G.s, fur, [sx * 1.7, 1.0, 1.6], [1.15, 1.0, 1.6]));
    body.push(P(G.s, light, [sx * 1.7, 1.0, 3.1], [0.8, 0.8, 0.25]));
  }
  // face and ears by kind
  const eyes = [];
  if (kind === 'bear' || kind === 'cat' || kind === 'bunny' || kind === 'elephant' || kind === 'dino') {
    eyes.push([-0.8, hy + 0.35, 2.1], [0.8, hy + 0.35, 2.1]);
  }
  if (kind === 'bear') {
    body.push(P(G.s, light, [0, hy - 0.55, 1.95], [1.05, 0.8, 0.75]));
    body.push(P(G.s, 0x2a1d17, [0, hy - 0.25, 2.65], [0.35, 0.26, 0.2]));
    for (const sx of [-1, 1]) { body.push(P(G.s, fur, [sx * 1.7, hy + 1.6, -0.1], [0.85, 0.85, 0.45])); body.push(P(G.s, light, [sx * 1.7, hy + 1.6, 0.18], [0.5, 0.5, 0.2])); }
  } else if (kind === 'bunny') {
    body.push(P(G.s, light, [0, hy - 0.6, 1.9], [0.9, 0.65, 0.6]));
    body.push(P(G.s, 0xe58a9a, [0, hy - 0.35, 2.4], [0.28, 0.2, 0.15]));
    for (const sx of [-1, 1]) { body.push(P(G.cap, fur, [sx * 0.8, hy + 3.2, -0.2], [0.55, 1.4, 0.35], [0, 0, -sx * 0.18])); body.push(P(G.cap, 0xf2b8c4, [sx * 0.8, hy + 3.2, 0.05], [0.32, 1.2, 0.15], [0, 0, -sx * 0.18])); }
  } else if (kind === 'cat') {
    body.push(P(G.s, light, [0, hy - 0.6, 1.85], [0.95, 0.7, 0.6]));
    body.push(P(G.s, 0xe58a9a, [0, hy - 0.3, 2.35], [0.26, 0.18, 0.15]));
    for (const sx of [-1, 1]) body.push(P(G.cone, fur, [sx * 1.25, hy + 2.0, 0], [0.75, 1.3, 0.5], [0, 0, -sx * 0.32]));
    body.push(P(G.cap, fur, [2.6, 2.0, -1.8], [0.45, 2.0, 0.45], [0.4, 0, -0.9]));
  } else if (kind === 'elephant') {
    body.push(P(G.cap, fur, [0, hy - 1.4, 2.3], [0.6, 1.3, 0.6], [0.5, 0, 0]));
    for (const sx of [-1, 1]) body.push(P(G.flat, dark, [sx * 2.3, hy + 0.2, -0.2], [1.6, 1, 1.9], [0, 0, sx * 1.3]));
  } else if (kind === 'dino') {
    body.push(P(G.s, light, [0, hy - 0.7, 1.9], [1.4, 0.8, 0.7]));
    for (let i = 0; i < 5; i++) body.push(P(G.cone, dark, [0, hy + 2.0 - i * 1.4, -1.4 - i * 0.35], [0.55, 0.9, 0.3], [-0.5 - i * 0.2, 0, 0]));
    body.push(P(G.cap, fur, [0, 1.4, -3.4], [0.7, 2.2, 0.7], [1.3, 0, 0]));
  } else if (kind === 'duck') {
    body.push(P(G.s, 0xf08a2a, [0, hy - 0.5, 2.3], [1.2, 0.45, 0.9]));
    eyes.push([-0.85, hy + 0.5, 1.85], [0.85, hy + 0.5, 1.85]);
  }
  for (const e of eyes) body.push(P(G.sLow, 0x141012, e, 0.32));
  // arms, merged and rotated together about the shoulder line
  for (const sx of [-1, 1]) arms.push(P(G.cap, fur, [sx * 2.6, -1.0, 0.4], [0.85, 1.1, 0.85], [0, 0, sx * 0.35]));

  const M = mats();
  const kit = { merge: mergeParts };
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  const bm = new THREE.Mesh(kit.merge(body), M.felt);
  bm.castShadow = true; bm.receiveShadow = true;
  inner.add(bm);
  const armPivot = new THREE.Group();
  armPivot.position.set(0, 5.0 * s, 0);
  inner.add(armPivot);
  const am = new THREE.Mesh(kit.merge(arms), M.felt);
  am.castShadow = true;
  armPivot.add(am);
  const ph = r() * TAU, sp = 0.8 + r() * 0.5;
  return {
    group, kind,
    // level 0..1: how excited; jumps, waves its arms and wiggles
    update(t, level = 0) {
      const b = Math.max(0, Math.sin(t * 9 * sp + ph));
      inner.position.y = b * b * 1.6 * s * level;
      inner.rotation.z = Math.sin(t * 2.3 * sp + ph) * (0.04 + 0.1 * level);
      armPivot.rotation.x = -(0.25 + level * (1.8 + 0.6 * Math.sin(t * 10 * sp + ph)));
    },
  };
}

function mergeParts(parts) {
  const geos = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot || [0, 0, 0]), 'XYZ')), new THREE.Vector3(...p.scale));
    g.applyMatrix4(m);
    const c = new THREE.Color(p.color);
    const n = g.attributes.position.count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  });
  const out = mergeAll(geos);
  return out;
}
function mergeAll(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// A crowd of plush toys at the given spots [{x, y, z, ry, size}]. update(t, level) animates them all.
export function crowd(parent, spots, seed = 1) {
  const r = rng(seed);
  const list = spots.map((sp, i) => {
    const kind = r.pick(ANIMALS);
    const a = stuffedAnimal(kind, seed * 17 + i, sp.size || 9 + r() * 3);
    a.group.position.set(sp.x, sp.y || 0, sp.z);
    a.group.rotation.y = sp.ry || 0;
    parent.add(a.group);
    return a;
  });
  return {
    list,
    update(t, level = 0) { for (const a of list) a.update(t, level); },
  };
}

// ---------- letter blocks and crayons ----------
const BLOCK_COLORS = ['#e23b2e', '#2f6fe0', '#f2c230', '#2fae5a', '#ef7d2c', '#8a55c9'];
const blockTex = new Map();
function letterTexture(letter, color) {
  const k = letter + color;
  if (blockTex.has(k)) return blockTex.get(k);
  const c = TX.makeCanvas(128), g = c.getContext('2d');
  g.fillStyle = '#f1dcb6'; g.fillRect(0, 0, 128, 128);
  // a hint of grain
  const r = rng(letter.charCodeAt(0));
  for (let i = 0; i < 14; i++) { g.strokeStyle = `rgba(150,105,60,${0.08 + r() * 0.1})`; g.lineWidth = 1 + r() * 2; const y = r() * 128; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(40, y + 4, 80, y - 4, 128, y + 2); g.stroke(); }
  g.strokeStyle = color; g.lineWidth = 9; g.strokeRect(12, 12, 104, 104);
  g.fillStyle = color; g.font = '84px "Lilita One", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const t = TX.toTexture(c, { wrap: false });
  t.userData.shared = true;
  blockTex.set(k, t);
  return t;
}
let blockGeo = null;
// a wooden alphabet block, edge `s`, letters on its sides
export function letterBlock(letters, s = 6, seed = 1) {
  if (!blockGeo) blockGeo = new RoundedBoxGeometry(1, 1, 1, 3, 0.08);
  const r = rng(seed);
  const mats = [];
  for (let i = 0; i < 6; i++) mats.push(new THREE.MeshPhysicalMaterial({ map: letterTexture(letters[i % letters.length], BLOCK_COLORS[(r() * BLOCK_COLORS.length) | 0]), roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.4 }));
  const m = new THREE.Mesh(blockGeo, mats);
  m.scale.setScalar(s);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

const CRAYON = [0xd93a2b, 0x2c6fd6, 0xf1c232, 0x2ba150, 0xf07b23, 0x8b4fc7, 0xe36aa0, 0x5a3a24];
let crayonGeo = null;
export function crayon(colorIndex = 0, len = 9) {
  if (!crayonGeo) {
    const prof = [[0.001, 0], [0.42, 0.02], [0.45, 0.2], [0.45, 7.6], [0.42, 7.75], [0.18, 8.7], [0.12, 8.85], [0.001, 8.9]];
    crayonGeo = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 16);
    crayonGeo.rotateZ(-Math.PI / 2);
  }
  const c = CRAYON[colorIndex % CRAYON.length];
  const m = new THREE.Mesh(crayonGeo, new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.45, clearcoat: 0.3, sheen: 0.3 }));
  m.scale.setScalar(len / 8.9);
  m.castShadow = true; m.receiveShadow = true;
  // paper wrapper band
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 5, 16, 1, true), new THREE.MeshStandardMaterial({ color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.25), roughness: 0.9 }));
  wrap.rotation.z = Math.PI / 2;
  wrap.position.x = 3.6;
  m.add(wrap);
  return m;
}
