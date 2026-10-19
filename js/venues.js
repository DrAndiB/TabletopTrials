// Venue dressing: the rooms of the house the events are held in, and the small living things in them.
// Sunlight through bathwater, bath-toy and gingerbread crowds, fairy lights, a snowy night window, a cat.
// Everything here is cheap: instanced meshes, a few additive planes, canvas textures, one draw call
// wherever possible. On low quality the purely decorative movement is thinned out by the callers.
import * as THREE from '../vendor/three.bundle.js';
import { BufferGeometryUtils } from '../vendor/three.bundle.js';
import * as TX from './textures.js';
import { rng, clamp, TAU } from './util.js';

// things that give light are brighter than white (HDR), so the bloom pass picks out them alone
const GLOW = 3;
const hdr = (k = GLOW) => new THREE.Color(k, k, k);
import { letterBlock } from './props.js';

// ---------- shared soft glow ----------
let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = TX.makeCanvas(64), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,0.6)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowTex = TX.toTexture(c, { wrap: false });
  glowTex.userData.shared = true;
  return glowTex;
}

// ---------- caustics: sunlight rippling on the bottom of the water ----------
// A tileable network of bright lines (the edges of a cellular pattern), two layers drifting past each other.
function causticTexture(size = 256, seed = 7) {
  const r = rng(seed), pts = [];
  for (let i = 0; i < 22; i++) pts.push([r() * size, r() * size]);
  const c = TX.makeCanvas(size), g = c.getContext('2d'), img = g.createImageData(size, size), half = size / 2;
  // warp the plane a little first (with whole waves across the tile, so it still tiles) for wobbly, organic lines
  const f = TAU / size, A = size * 0.035;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wx = x + A * Math.sin(f * 2 * y + 1.3) + A * 0.6 * Math.sin(f * 3 * (x + y));
    const wy = y + A * Math.sin(f * 2 * x + 0.4) + A * 0.6 * Math.cos(f * 3 * (x - y));
    let f1 = 1e9, f2 = 1e9;
    for (const p of pts) {
      let dx = Math.abs(((wx - p[0]) % size + size) % size), dy = Math.abs(((wy - p[1]) % size + size) % size);
      if (dx > half) dx = size - dx;
      if (dy > half) dy = size - dy;
      const d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    const e = (Math.sqrt(f2) - Math.sqrt(f1)) / (size * 0.05);
    // a bright thin core and a soft glow round it
    const v = Math.pow(clamp(1 - e, 0, 1), 5) * 0.85 + Math.pow(clamp(1 - e * 0.45, 0, 1), 3) * 0.25;
    const k = (y * size + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(255 * clamp(v, 0, 1)); img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return TX.toTexture(c);
}
export class Caustics {
  constructor(group, { x, z, w, d, y, color = 0xfff0c8, opacity = 0.5, scale = 26 }) {
    const base = causticTexture();
    this.tex = [base, base.clone()];
    this.tex.forEach((t, k) => {
      const s = scale * (k ? 1.41 : 1);
      t.repeat.set(w / s, d / s);
      t.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: t, color, transparent: true, opacity: opacity * (k ? 0.75 : 1), blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.set(x, y + k * 0.03, z);
      m.renderOrder = 1;
      group.add(m);
    });
  }
  update(t) {
    this.tex[0].offset.set(t * 0.019, t * 0.011);
    this.tex[1].offset.set(-t * 0.014, t * 0.017);
  }
}

// ---------- shafts of light from a window ----------
// Each beam is two crossed planes with a soft gradient, so it reads from any side.
export function sunbeams(group, { from, dir, length = 150, width = 16, n = 3, spread = 18, color = 0xffe6b0, opacity = 0.09, seed = 3, motes = 160 }) {
  const c = TX.makeCanvas(32, 128), g = c.getContext('2d');
  const along = g.createLinearGradient(0, 0, 0, 128);
  along.addColorStop(0, 'rgba(255,255,255,0)'); along.addColorStop(0.12, 'rgba(255,255,255,1)'); along.addColorStop(0.7, 'rgba(255,255,255,0.55)'); along.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = along; g.fillRect(0, 0, 32, 128);
  g.globalCompositeOperation = 'destination-in';
  const across = g.createLinearGradient(0, 0, 32, 0);
  across.addColorStop(0, 'rgba(0,0,0,0)'); across.addColorStop(0.5, 'rgba(0,0,0,1)'); across.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = across; g.fillRect(0, 0, 32, 128);
  const tex = TX.toTexture(c, { wrap: false });
  const mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const d = new THREE.Vector3(...dir).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d);
  const r = rng(seed);
  const beams = new THREE.Group();
  for (let k = 0; k < n; k++) {
    const w = width * (0.6 + r() * 0.8);
    const geo = new THREE.PlaneGeometry(w, length).translate(0, -length / 2, 0);
    for (const rot of [0, Math.PI / 2]) {
      const m = new THREE.Mesh(geo, mat);
      m.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + k * 0.4));
      m.position.set(from[0] + (k - (n - 1) / 2) * spread, from[1] + (r() - 0.5) * 6, from[2]);
      m.renderOrder = 4;
      beams.add(m);
    }
  }
  group.add(beams);
  // dust motes drifting in the light
  const mp = new Float32Array(motes * 3), mc = new Float32Array(motes * 3), base = [], up = new THREE.Vector3(), side = new THREE.Vector3(), out = new THREE.Vector3();
  side.crossVectors(d, Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
  up.crossVectors(side, d).normalize();
  for (let k = 0; k < motes; k++) {
    const along = length * (0.08 + r() * 0.75), lane = Math.floor(r() * n);
    base.push({ along, a: (r() - 0.5) * width * 0.8 + (lane - (n - 1) / 2) * spread, b: (r() - 0.5) * width * 0.8, ph: r() * TAU, sp: 0.15 + r() * 0.3, tw: 0.5 + r() * 1.5 });
  }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(mp, 3).setUsage(THREE.DynamicDrawUsage));
  mg.setAttribute('color', new THREE.BufferAttribute(mc, 3).setUsage(THREE.DynamicDrawUsage));
  const dust = new THREE.Points(mg, new THREE.PointsMaterial({ size: 0.9, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color }));
  dust.frustumCulled = false; dust.renderOrder = 5;
  group.add(dust);
  const moveDust = (t) => {
    base.forEach((m, k) => {
      const w = t * m.sp + m.ph;
      out.set(from[0], from[1], from[2]).addScaledVector(d, m.along + Math.sin(w * 0.7) * 3)
        .addScaledVector(side, m.a + Math.sin(w) * 2.5).addScaledVector(up, m.b + Math.cos(w * 1.3) * 2.5);
      mp[k * 3] = out.x; mp[k * 3 + 1] = out.y; mp[k * 3 + 2] = out.z;
      const v = 0.35 + 0.65 * Math.max(0, Math.sin(t * m.tw + m.ph));
      mc[k * 3] = mc[k * 3 + 1] = mc[k * 3 + 2] = v;
    });
    mg.attributes.position.needsUpdate = true; mg.attributes.color.needsUpdate = true;
  };
  moveDust(0);
  return { beams, mat, dust, update(t) { mat.opacity = opacity * (0.85 + 0.15 * Math.sin(t * 0.7)); moveDust(t); } };
}

// ---------- window panes painted on a canvas (day or night), with optional falling snow ----------
export function paneWindow(group, { x, y, z, w, h, ry = 0, sky, frame = 0xf7f4ee, snow = 0, sill = true, depth = 3 }) {
  const cw = 512, ch = Math.round((512 * h) / w);
  const base = TX.makeCanvas(cw, ch);
  sky(base.getContext('2d'), cw, ch);
  const live = snow ? TX.makeCanvas(cw, ch) : base;
  const tex = TX.toTexture(live, { wrap: false });
  const win = new THREE.Group();
  win.position.set(x, y, z); win.rotation.y = ry;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: true }));
  win.add(glass);
  // the frame: four sides and a cross of glazing bars
  const fm = new THREE.MeshStandardMaterial({ color: frame, roughness: 0.5 });
  const bar = (bw, bh, bx, by, bd = depth) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), fm); m.position.set(bx, by, bd / 2 - 0.4); m.castShadow = true; m.receiveShadow = true; win.add(m); };
  const fw = Math.max(2.4, w * 0.04);
  bar(w + 2 * fw, fw, 0, h / 2 + fw / 2); bar(w + 2 * fw, fw, 0, -h / 2 - fw / 2);
  bar(fw, h, -w / 2 - fw / 2, 0); bar(fw, h, w / 2 + fw / 2, 0);
  bar(fw * 0.5, h, 0, 0, depth * 0.6); bar(w, fw * 0.5, 0, h * 0.1, depth * 0.6);
  if (sill) { const s = new THREE.Mesh(new THREE.BoxGeometry(w + 4 * fw, 1.6, 9), fm); s.position.set(0, -h / 2 - fw - 0.8, 4); s.castShadow = true; s.receiveShadow = true; win.add(s); }
  group.add(win);
  const flakes = [];
  const r = rng(91);
  for (let i = 0; i < snow; i++) flakes.push({ x: r() * cw, y: r() * ch, s: 1 + r() * 2.6, v: 14 + r() * 30, ph: r() * TAU });
  let acc = 0;
  const out = {
    group: win, sillY: y - h / 2 - fw - 0.8 + 0.8,
    update(dt, t) {
      if (!snow) return;
      acc += dt;
      if (acc < 1 / 20) return;
      const step = acc; acc = 0;
      const g = live.getContext('2d');
      g.drawImage(base, 0, 0);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (const f of flakes) {
        f.y += f.v * step; f.x += Math.sin(t * 0.8 + f.ph) * 8 * step;
        if (f.y > ch + 4) { f.y = -4; f.x = r() * cw; }
        g.globalAlpha = 0.45 + 0.4 * (f.s / 3.6);
        g.beginPath(); g.arc(f.x, f.y, f.s, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      tex.needsUpdate = true;
    },
  };
  return out;
}

// a bright summer morning: sky, a soft sun glow, leaves of the tree outside
export function daySky(seed = 5) {
  return (g, w, h) => {
    const r = rng(seed);
    const s = g.createLinearGradient(0, 0, 0, h);
    s.addColorStop(0, '#8fd0f5'); s.addColorStop(0.7, '#d6f0fb'); s.addColorStop(1, '#fff6dc');
    g.fillStyle = s; g.fillRect(0, 0, w, h);
    const sun = g.createRadialGradient(w * 0.25, h * 0.2, 0, w * 0.25, h * 0.2, w * 0.45);
    sun.addColorStop(0, 'rgba(255,250,225,1)'); sun.addColorStop(0.2, 'rgba(255,244,205,0.7)'); sun.addColorStop(1, 'rgba(255,244,205,0)');
    g.fillStyle = sun; g.fillRect(0, 0, w, h);
    // a few clouds
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let k = 0; k < 3; k++) { const cx = w * (0.45 + k * 0.2), cy = h * (0.25 + r() * 0.2); for (let j = 0; j < 5; j++) { g.beginPath(); g.ellipse(cx + (j - 2) * w * 0.03, cy + Math.sin(j) * h * 0.02, w * 0.045, h * 0.05, 0, 0, TAU); g.fill(); } }
    // leaves hanging into the top corners
    for (const [cx, cy, n] of [[w * 0.95, 0, 40], [w * 0.05, -h * 0.05, 26]]) {
      for (let k = 0; k < n; k++) {
        const a = r() * TAU, d = r() * w * 0.22;
        g.fillStyle = ['#4f9a4a', '#6cb35a', '#3d7f3f', '#86c46a'][k % 4];
        g.globalAlpha = 0.85;
        g.beginPath(); g.ellipse(cx + Math.cos(a) * d, cy + Math.abs(Math.sin(a)) * d * 0.9, w * 0.035, h * 0.03, a, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    // the far garden hedge along the bottom
    g.fillStyle = '#7fbf6a';
    for (let x = 0; x < w; x += w * 0.04) { g.beginPath(); g.arc(x, h * 1.02, w * 0.05, 0, TAU); g.fill(); }
  };
}

// a summer evening: the sun just down, an orange-to-violet sky, a thin moon, trees and roofs in silhouette
export function duskSky(seed = 7) {
  return (g, w, h) => {
    const r = rng(seed);
    const s = g.createLinearGradient(0, 0, 0, h);
    s.addColorStop(0, '#3a3f86'); s.addColorStop(0.45, '#9a5aa0'); s.addColorStop(0.8, '#f28a5a'); s.addColorStop(1, '#ffc66e');
    g.fillStyle = s; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 25; k++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.6})`; g.fillRect(r() * w, r() * h * 0.35, 1.5, 1.5); }
    g.fillStyle = '#fff6dc'; g.beginPath(); g.arc(w * 0.72, h * 0.2, w * 0.05, 0, TAU); g.fill();
    g.fillStyle = '#4a4890'; g.beginPath(); g.arc(w * 0.74, h * 0.19, w * 0.045, 0, TAU); g.fill();
    // trees and roofs against the glow
    g.fillStyle = '#2a2448';
    for (let x = -20; x < w + 40; x += w * 0.09) { const th = h * (0.18 + r() * 0.14); g.beginPath(); g.ellipse(x, h - th * 0.6, w * 0.06, th, 0, 0, TAU); g.fill(); }
    for (let x = 0; x < w; x += w * 0.22) { const bh = h * (0.12 + r() * 0.08); g.fillRect(x, h - bh, w * 0.16, bh); g.beginPath(); g.moveTo(x - 4, h - bh); g.lineTo(x + w * 0.08, h - bh - h * 0.07); g.lineTo(x + w * 0.16 + 4, h - bh); g.fill(); if (r() < 0.8) { g.fillStyle = '#ffcf6a'; g.fillRect(x + w * 0.05, h - bh * 0.7, w * 0.03, bh * 0.25); g.fillStyle = '#2a2448'; } }
  };
}

// a winter night: deep blue sky, stars, the moon, snowy roofs across the street with lit windows
export function nightSky(seed = 9) {
  return (g, w, h) => {
    const r = rng(seed);
    const s = g.createLinearGradient(0, 0, 0, h);
    s.addColorStop(0, '#0a1430'); s.addColorStop(0.65, '#1d3466'); s.addColorStop(1, '#3a5590');
    g.fillStyle = s; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 90; k++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; g.fillRect(r() * w, r() * h * 0.6, 1 + r() * 1.5, 1 + r() * 1.5); }
    const mx = w * 0.78, my = h * 0.22, mr = w * 0.055;
    const glow = g.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4);
    glow.addColorStop(0, 'rgba(220,230,255,0.55)'); glow.addColorStop(1, 'rgba(220,230,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4f2e6'; g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
    g.fillStyle = 'rgba(200,200,190,0.5)'; for (const [a, b, c] of [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.16], [-0.05, 0.35, 0.12]]) { g.beginPath(); g.arc(mx + a * mr, my + b * mr, c * mr, 0, TAU); g.fill(); }
    // roofs across the street
    let x = -10;
    while (x < w) {
      const bw = w * (0.12 + r() * 0.12), bh = h * (0.18 + r() * 0.16), top = h - bh;
      g.fillStyle = '#16213d'; g.fillRect(x, top, bw, bh);
      g.fillStyle = '#e9eef8'; g.beginPath(); g.moveTo(x - 4, top + 2); g.lineTo(x + bw / 2, top - h * 0.08); g.lineTo(x + bw + 4, top + 2); g.closePath(); g.fill();
      g.fillStyle = '#16213d'; g.beginPath(); g.moveTo(x + 4, top + 4); g.lineTo(x + bw / 2, top - h * 0.06); g.lineTo(x + bw - 4, top + 4); g.closePath(); g.fill();
      g.fillStyle = '#e9eef8'; g.fillRect(x + bw * 0.7, top - h * 0.1, bw * 0.08, h * 0.07);
      for (let k = 0; k < 3; k++) if (r() < 0.7) { g.fillStyle = r() < 0.6 ? '#ffd27a' : '#ffb35c'; g.fillRect(x + bw * (0.18 + k * 0.26), top + bh * 0.35, bw * 0.12, bh * 0.18); }
      x += bw + w * 0.02;
    }
    // snow on the ground and frost creeping in at the corners
    g.fillStyle = '#e9eef8'; g.fillRect(0, h * 0.94, w, h * 0.06);
    for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const f = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.22);
      f.addColorStop(0, 'rgba(235,245,255,0.75)'); f.addColorStop(1, 'rgba(235,245,255,0)');
      g.fillStyle = f; g.fillRect(0, 0, w, h);
    }
  };
}

// ---------- fairy lights: bulbs on a wire through a list of points, sagging between them ----------
const FAIRY = [0xffd59a, 0xffd59a, 0xff7a6a, 0xffd59a, 0x8fe8a0, 0xffd59a, 0x8cc8ff, 0xffe066];
export class FairyLights {
  constructor(group, points, { sag = 2, per = 6, bulb = 0.55, halo = 5, seed = 4, wire = 0x2a3a2c, colors = FAIRY } = {}) {
    const pts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = new THREE.Vector3(...points[i]), b = new THREE.Vector3(...points[i + 1]);
      for (let k = 0; k < per; k++) { const u = k / per, p = a.clone().lerp(b, u); p.y -= sag * 4 * u * (1 - u); pts.push(p); }
    }
    pts.push(new THREE.Vector3(...points[points.length - 1]));
    const curve = new THREE.CatmullRomCurve3(pts);
    const wireM = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 3, 0.12, 4, false), new THREE.MeshStandardMaterial({ color: wire, roughness: 0.7 }));
    group.add(wireM);
    // bulbs every so often along the wire, hanging just below it
    const r = rng(seed), n = Math.max(2, Math.round(curve.getLength() / 3.2));
    this.n = n;
    this.base = new Float32Array(n * 3);
    this.ph = new Float32Array(n);
    this.sp = new Float32Array(n);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(bulb, 8, 6).scale(1, 1.35, 1), new THREE.MeshBasicMaterial({ color: hdr() }), n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const p = curve.getPointAt((i + 0.5) / n);
      p.y -= bulb * 1.2;
      pos.set([p.x, p.y, p.z], i * 3);
      c.set(colors[i % colors.length]);
      this.base.set([c.r, c.g, c.b], i * 3);
      col.set([c.r, c.g, c.b], i * 3);
      this.ph[i] = r() * TAU; this.sp[i] = 0.6 + r() * 1.8;
      m4.makeTranslation(p.x, p.y, p.z); im.setMatrixAt(i, m4); im.setColorAt(i, c);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false; im.receiveShadow = false;
    im.computeBoundingSphere();
    group.add(im);
    this.bulbs = im;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    this.halo = new THREE.Points(geo, new THREE.PointsMaterial({ size: halo, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
    this.halo.renderOrder = 5;
    group.add(this.halo);
    this.c = c;
  }
  // a gentle twinkle: each bulb breathes at its own pace
  update(t) {
    const col = this.halo.geometry.attributes.color;
    for (let i = 0; i < this.n; i++) {
      const k = 0.55 + 0.45 * Math.sin(t * this.sp[i] + this.ph[i]);
      col.array[i * 3] = this.base[i * 3] * k; col.array[i * 3 + 1] = this.base[i * 3 + 1] * k; col.array[i * 3 + 2] = this.base[i * 3 + 2] * k;
    }
    col.needsUpdate = true;
  }
}

// ---------- crowds that suit the room ----------
// Instanced, so a whole crowd is a couple of draw calls; update(t, level) makes them hop as excitement rises.
class HopCrowd {
  // yaw: turns models built facing +x so that, like the plush toys, they face +z at ry = 0
  constructor(spots, seed, yaw = 0) {
    this.spots = spots;
    this.yaw = yaw;
    const r = rng(seed);
    this.ph = spots.map(() => r() * TAU);
    this.sp = spots.map(() => 5 + r() * 3);
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.meshes = [];
  }
  update(t, level = 0) {
    const { m4, q, e, p, s } = this;
    this.spots.forEach((sp, i) => {
      // floating ones just bob on the water; the rest hop as the excitement rises
      const hop = sp.float ? 0.25 * Math.sin(t * 2.1 + this.ph[i]) : Math.max(0, Math.sin(t * this.sp[i] + this.ph[i])) * level * level * sp.size * 0.35;
      const sway = Math.sin(t * 1.3 + this.ph[i]) * (0.05 + level * 0.12);
      e.set(0, (sp.ry || 0) + this.yaw, sway, 'YXZ'); q.setFromEuler(e);
      p.set(sp.x, (sp.y || 0) + hop, sp.z);
      const k = sp.size / 10, squash = 1 + (hop > 0 ? 0.04 : -0.03) * level;
      s.set(k, k * squash, k);
      m4.compose(p, q, s);
      for (const m of this.meshes) m.setMatrixAt(i, m4);
    });
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}

// rubber ducks (yellow mostly, the odd pink, blue or green one) along a bath shelf and the floor
export function duckCrowd(group, spots, seed = 3) {
  const crowd = new HopCrowd(spots, seed, -Math.PI / 2);
  // body tinted per duck; beak and eyes the same for all. Sized for size 10.
  const body = new THREE.SphereGeometry(4.2, 20, 14).scale(1.25, 0.82, 1).translate(0, 3.4, 0);
  const head = new THREE.SphereGeometry(2.7, 18, 12).translate(2.9, 7.7, 0);
  const tail = new THREE.ConeGeometry(1.4, 2.6, 10).rotateZ(1.1).translate(-5, 5.2, 0);
  const bodyG = mergeGeos([body, head, tail]);
  const beak = new THREE.SphereGeometry(1.15, 12, 8).scale(1.5, 0.55, 1.1).translate(5.6, 7.1, 0);
  const eyeL = new THREE.SphereGeometry(0.42, 8, 6).translate(4.6, 8.6, 1.35);
  const eyeR = new THREE.SphereGeometry(0.42, 8, 6).translate(4.6, 8.6, -1.35);
  const detail = colorMerge([[beak, 0xef7d2c], [eyeL, 0x1f1a17], [eyeR, 0x1f1a17]]);
  const tints = [0xffd23a, 0xffd23a, 0xffd23a, 0xffc0d4, 0xffd23a, 0x9fd6ff, 0xffd23a, 0xa8e6a0];
  const r = rng(seed);
  const bm = new THREE.InstancedMesh(bodyG, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.15 }), spots.length);
  const dm = new THREE.InstancedMesh(detail, new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, clearcoat: 0.6 }), spots.length);
  const c = new THREE.Color();
  spots.forEach((sp, i) => bm.setColorAt(i, c.set(sp.color ?? tints[Math.floor(r() * tints.length)])));
  for (const m of [bm, dm]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; group.add(m); }
  crowd.meshes = [bm, dm];
  crowd.update(0, 0);
  return crowd;
}

// gingerbread people with white icing faces, buttons and cuffs
export function gingerCrowd(group, spots, seed = 5) {
  const crowd = new HopCrowd(spots, seed);
  const sh = new THREE.Shape();
  // the classic outline, built from a head, arms and legs (units for size 10: about 12 tall)
  sh.moveTo(-1.4, 0);
  sh.quadraticCurveTo(-3.6, 0, -3.4, 1.4); sh.lineTo(-2.2, 5.2);
  sh.quadraticCurveTo(-4.6, 6, -5.2, 6.6); sh.quadraticCurveTo(-5.6, 8.2, -3.8, 8.1); sh.lineTo(-1.8, 7.7);
  sh.quadraticCurveTo(-3.3, 9.6, -2.6, 11); sh.quadraticCurveTo(0, 13.4, 2.6, 11); sh.quadraticCurveTo(3.3, 9.6, 1.8, 7.7);
  sh.lineTo(3.8, 8.1); sh.quadraticCurveTo(5.6, 8.2, 5.2, 6.6); sh.quadraticCurveTo(4.6, 6, 2.2, 5.2);
  sh.lineTo(3.4, 1.4); sh.quadraticCurveTo(3.6, 0, 1.4, 0); sh.lineTo(0.7, 2.6); sh.quadraticCurveTo(0, 3.1, -0.7, 2.6); sh.lineTo(-1.4, 0);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.45, bevelSize: 0.4, bevelSegments: 2, curveSegments: 8 }).translate(0, 0.4, -0.55);
  // icing on the front face: a canvas laid over the outline's bounding box
  const tc = TX.makeCanvas(256), g = tc.getContext('2d');
  g.fillStyle = '#b8743a'; g.fillRect(0, 0, 256, 256);
  const X = (x) => ((x + 6) / 12) * 256, Yc = (y) => 256 - ((y + 0.5) / 14) * 256;
  g.strokeStyle = '#fff8ee'; g.fillStyle = '#fff8ee'; g.lineCap = 'round'; g.lineWidth = 5;
  for (const sx of [-0.9, 0.9]) { g.beginPath(); g.arc(X(sx), Yc(10.6), 7, 0, TAU); g.fill(); }
  g.beginPath(); g.arc(X(0), Yc(10), 18, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
  for (const y of [6.6, 5.2, 3.9]) { g.fillStyle = ['#e23b2e', '#2fae5a', '#f2c230'][Math.round(y) % 3]; g.beginPath(); g.arc(X(0), Yc(y), 7, 0, TAU); g.fill(); }
  g.strokeStyle = '#fff8ee'; g.lineWidth = 4;
  const zig = (x0, y0, x1, y1) => { g.beginPath(); for (let k = 0; k <= 6; k++) { const u = k / 6; g.lineTo(X(x0 + (x1 - x0) * u), Yc(y0 + (y1 - y0) * u) + (k % 2 ? -6 : 6)); } g.stroke(); };
  zig(-5, 7.4, -3.6, 7.2); zig(3.6, 7.2, 5, 7.4); zig(-3.2, 1.3, -1.7, 1.3); zig(1.7, 1.3, 3.2, 1.3);
  const face = TX.toTexture(tc, { wrap: false });
  face.repeat.set(1 / 12, 1 / 14); face.offset.set(0.5, 0.5 / 14);
  const cookie = new THREE.MeshStandardMaterial({ map: face, roughness: 0.8 });
  const side = new THREE.MeshStandardMaterial({ color: 0xa8662f, roughness: 0.85 });
  const m = new THREE.InstancedMesh(geo, [cookie, side], spots.length);
  m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  group.add(m);
  crowd.meshes = [m];
  crowd.update(0, 0);
  return crowd;
}

// snowmen: three snowballs, a carrot, coal eyes and buttons, a hat and a scarf in a team-ish colour
export function snowCrowd(group, spots, seed = 9) {
  const crowd = new HopCrowd(spots, seed, -Math.PI / 2);
  const snow = mergeGeos([
    new THREE.SphereGeometry(4.2, 18, 14).translate(0, 3.8, 0),
    new THREE.SphereGeometry(3.2, 18, 14).translate(0, 9.3, 0),
    new THREE.SphereGeometry(2.4, 16, 12).translate(0, 13.6, 0),
  ]);
  const bits = colorMerge([
    [new THREE.ConeGeometry(0.5, 2.6, 8).rotateZ(-Math.PI / 2).translate(3.4, 13.6, 0), 0xef7d2c],
    [new THREE.SphereGeometry(0.35, 6, 4).translate(2.05, 14.3, 0.8), 0x1f1a17],
    [new THREE.SphereGeometry(0.35, 6, 4).translate(2.05, 14.3, -0.8), 0x1f1a17],
    [new THREE.SphereGeometry(0.4, 6, 4).translate(3.1, 9.8, 0), 0x1f1a17],
    [new THREE.SphereGeometry(0.4, 6, 4).translate(3.15, 8.5, 0), 0x1f1a17],
    [new THREE.CylinderGeometry(2.1, 2.1, 0.5, 16).translate(0, 15.6, 0), 0x2b2622],
    [new THREE.CylinderGeometry(1.5, 1.5, 2.6, 16).translate(0, 17.1, 0), 0x2b2622],
  ]);
  const scarf = new THREE.TorusGeometry(2.6, 0.75, 8, 20).rotateX(Math.PI / 2).translate(0, 11.6, 0);
  const sm = new THREE.InstancedMesh(snow, new THREE.MeshPhysicalMaterial({ color: 0xf6f8fc, roughness: 0.75, sheen: 0.6, sheenColor: 0xd8e6ff }), spots.length);
  const bm = new THREE.InstancedMesh(bits, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), spots.length);
  const cm = new THREE.InstancedMesh(scarf, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.95, sheen: 1, sheenColor: 0xffffff }), spots.length);
  const r = rng(seed), c = new THREE.Color(), cols = [0xd9472b, 0x2f6fe0, 0x2fae5a, 0xf2c230, 0x8a55c9, 0xef7d2c];
  spots.forEach((sp, i) => cm.setColorAt(i, c.set(sp.color ?? cols[Math.floor(r() * cols.length)])));
  for (const m of [sm, bm, cm]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; group.add(m); }
  crowd.meshes = [sm, bm, cm];
  crowd.update(0, 0);
  return crowd;
}

// boiled eggs in egg cups, with drawn-on faces; a few wear knitted cosies
export function eggCrowd(group, spots, seed = 11) {
  const crowd = new HopCrowd(spots, seed, -Math.PI / 2);
  const r = rng(seed);
  const cupG = new THREE.LatheGeometry([[0.01, 0], [2.6, 0], [2.6, 0.6], [1.2, 1.4], [1.1, 2.6], [2.8, 4.2], [3.2, 6.4], [2.9, 6.6], [0.01, 4.6]].map(([x, y]) => new THREE.Vector2(x, y)), 24);
  const eggG = new THREE.SphereGeometry(2.7, 20, 16).scale(1, 1.32, 1).translate(0, 8.3, 0);
  const face = colorMerge([
    [new THREE.SphereGeometry(0.32, 6, 4).translate(2.45, 9.4, 0.85), 0x1f1a17],
    [new THREE.SphereGeometry(0.32, 6, 4).translate(2.45, 9.4, -0.85), 0x1f1a17],
    [new THREE.TorusGeometry(0.75, 0.16, 4, 10, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI).translate(2.55, 8.3, 0), 0x1f1a17],
    [new THREE.SphereGeometry(0.45, 6, 4).scale(0.4, 1, 1).translate(2.3, 8.6, 1.5), 0xf28a8a],
    [new THREE.SphereGeometry(0.45, 6, 4).scale(0.4, 1, 1).translate(2.3, 8.6, -1.5), 0xf28a8a],
  ]);
  const cosyG = mergeGeos([new THREE.SphereGeometry(2.9, 18, 10, 0, TAU, 0, Math.PI / 2).scale(1, 1.2, 1).translate(0, 9.8, 0), new THREE.SphereGeometry(0.9, 10, 8).translate(0, 13.6, 0)]);
  const n = spots.length;
  const cm = new THREE.InstancedMesh(cupG, new THREE.MeshPhysicalMaterial({ roughness: 0.25, clearcoat: 0.8 }), n);
  const em = new THREE.InstancedMesh(eggG, new THREE.MeshStandardMaterial({ roughness: 0.55 }), n);
  const fm = new THREE.InstancedMesh(face, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), n);
  const hats = spots.map(() => r() < 0.45);
  const hm = new THREE.InstancedMesh(cosyG, new THREE.MeshPhysicalMaterial({ roughness: 0.95, sheen: 1, sheenColor: 0xffffff }), n);
  const c = new THREE.Color(), cups = [0xffffff, 0xf2c230, 0x2f6fe0, 0xd9472b, 0x2fae5a], eggs = [0xf7f1e6, 0xe2b98a, 0xf7f1e6], cos = [0xd9472b, 0x8a55c9, 0x2f6fe0, 0xef7d2c];
  spots.forEach((sp, i) => { cm.setColorAt(i, c.set(cups[Math.floor(r() * cups.length)])); em.setColorAt(i, c.set(eggs[i % eggs.length])); hm.setColorAt(i, c.set(cos[i % cos.length])); });
  for (const m of [cm, em, fm, hm]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; group.add(m); }
  crowd.meshes = [cm, em, fm];
  crowd.hats = { m: hm, on: hats };
  const base = crowd.update.bind(crowd);
  // the cosies follow their eggs; eggs without one keep theirs out of sight
  const zero = new THREE.Matrix4().makeScale(0, 0, 0), m4 = new THREE.Matrix4();
  crowd.update = (t, level) => {
    base(t, level);
    for (let i = 0; i < n; i++) { if (hats[i]) { em.getMatrixAt(i, m4); hm.setMatrixAt(i, m4); } else hm.setMatrixAt(i, zero); }
    hm.instanceMatrix.needsUpdate = true;
  };
  crowd.update(0, 0);
  return crowd;
}

// a winter sunrise: pink and gold low in the sky, snowy roofs, smoke from a chimney
export function sunriseSky(seed = 3) {
  return (g, w, h) => {
    const r = rng(seed);
    const s = g.createLinearGradient(0, 0, 0, h);
    s.addColorStop(0, '#7fa6d8'); s.addColorStop(0.5, '#f4b7b0'); s.addColorStop(0.85, '#ffd79a'); s.addColorStop(1, '#fff1d0');
    g.fillStyle = s; g.fillRect(0, 0, w, h);
    const sun = g.createRadialGradient(w * 0.3, h * 0.8, 0, w * 0.3, h * 0.8, w * 0.35);
    sun.addColorStop(0, 'rgba(255,240,200,1)'); sun.addColorStop(0.15, 'rgba(255,220,160,0.7)'); sun.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = sun; g.fillRect(0, 0, w, h);
    let x = -10;
    while (x < w) {
      const bw = w * (0.14 + r() * 0.1), bh = h * (0.16 + r() * 0.12), top = h - bh;
      g.fillStyle = '#8a7f98'; g.fillRect(x, top, bw, bh);
      g.fillStyle = '#f6f4f8'; g.beginPath(); g.moveTo(x - 4, top + 2); g.lineTo(x + bw / 2, top - h * 0.07); g.lineTo(x + bw + 4, top + 2); g.closePath(); g.fill();
      if (r() < 0.5) { g.fillStyle = 'rgba(255,255,255,0.6)'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + bw * 0.75 + k * 3, top - h * 0.12 - k * h * 0.05, 4 + k * 2, 0, TAU); g.fill(); } }
      x += bw + w * 0.03;
    }
  };
}

// action figures and tin robots for the garage: a boxy robot body, a dome head with an antenna, one
// colour per robot, and a light on top that blinks
export function robotCrowd(group, spots, seed = 13) {
  const crowd = new HopCrowd(spots, seed);
  const body = mergeGeos([
    new THREE.BoxGeometry(5.4, 6, 4).translate(0, 6.6, 0),
    new THREE.BoxGeometry(1.5, 3.6, 1.6).translate(-1.4, 1.8, 0),
    new THREE.BoxGeometry(1.5, 3.6, 1.6).translate(1.4, 1.8, 0),
    new THREE.BoxGeometry(1.2, 4.4, 1.2).translate(-3.4, 6.8, 0),
    new THREE.BoxGeometry(1.2, 4.4, 1.2).translate(3.4, 6.8, 0),
    new THREE.CylinderGeometry(2.4, 2.4, 3.4, 18).translate(0, 11.4, 0),
  ]);
  const trim = colorMerge([
    [new THREE.SphereGeometry(2.4, 18, 8, 0, TAU, 0, Math.PI / 2).translate(0, 13.1, 0), 0xc8ccd2],
    [new THREE.CylinderGeometry(0.15, 0.15, 3, 4).translate(0, 16, 0), 0xc8ccd2],
    [new THREE.BoxGeometry(3.6, 2.4, 0.3).translate(0, 7.2, 2.1), 0x2b2622],
    [new THREE.SphereGeometry(0.45, 8, 6).translate(-0.9, 11.8, 2.3), 0x9cf0ff],
    [new THREE.SphereGeometry(0.45, 8, 6).translate(0.9, 11.8, 2.3), 0x9cf0ff],
    [new THREE.BoxGeometry(1.6, 0.4, 0.3).translate(0, 10.6, 2.4), 0x2b2622],
  ]);
  const lamp = new THREE.SphereGeometry(0.7, 10, 8).translate(0, 17.6, 0);
  const n = spots.length, r = rng(seed), c = new THREE.Color(), cols = [0xd9472b, 0x2f6fe0, 0xf2c230, 0x2fae5a, 0xc8ccd2, 0xef7d2c];
  const bm = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ metalness: 0.55, roughness: 0.35 }), n);
  const tm = new THREE.InstancedMesh(trim, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.3 }), n);
  const lm = new THREE.InstancedMesh(lamp, new THREE.MeshBasicMaterial({ color: hdr() }), n);
  spots.forEach((sp, i) => { bm.setColorAt(i, c.set(cols[Math.floor(r() * cols.length)])); lm.setColorAt(i, c.set(0xff4a3a)); });
  for (const m of [bm, tm, lm]) { m.castShadow = m !== lm; m.receiveShadow = true; m.frustumCulled = false; group.add(m); }
  crowd.meshes = [bm, tm, lm];
  const base = crowd.update.bind(crowd), on = new THREE.Color(0xff4a3a), off = new THREE.Color(0x5a1a14);
  crowd.update = (t, level) => {
    base(t, level);
    for (let i = 0; i < n; i++) lm.setColorAt(i, Math.sin(t * 3 + i * 1.7) > 0.2 ? on : off);
    lm.instanceColor.needsUpdate = true;
  };
  crowd.update(0, 0);
  return crowd;
}

// penguins: black back, white front, orange beak and feet, a few in bobble hats
export function penguinCrowd(group, spots, seed = 17) {
  const crowd = new HopCrowd(spots, seed, -Math.PI / 2);
  const back = mergeGeos([
    new THREE.SphereGeometry(3.6, 18, 14).scale(1, 1.45, 0.95).translate(0, 5.6, 0),
    new THREE.SphereGeometry(2.5, 16, 12).translate(0.2, 10.6, 0),
    new THREE.SphereGeometry(1.2, 10, 8).scale(0.5, 2.2, 1.2).translate(-0.4, 6, 3.3),
    new THREE.SphereGeometry(1.2, 10, 8).scale(0.5, 2.2, 1.2).translate(-0.4, 6, -3.3),
  ]);
  const front = colorMerge([
    [new THREE.SphereGeometry(3.1, 18, 14).scale(0.7, 1.35, 0.85).translate(1.35, 5.4, 0), 0xf7f4ee],
    [new THREE.SphereGeometry(1.5, 12, 8).scale(0.6, 0.9, 1.3).translate(1.7, 10.6, 0), 0xf7f4ee],
    [new THREE.ConeGeometry(0.55, 1.6, 8).rotateZ(-Math.PI / 2).translate(3.3, 10.4, 0), 0xf2a33a],
    [new THREE.SphereGeometry(0.32, 6, 4).translate(2.3, 11.2, 0.9), 0x1f1a17],
    [new THREE.SphereGeometry(0.32, 6, 4).translate(2.3, 11.2, -0.9), 0x1f1a17],
    [new THREE.SphereGeometry(1, 10, 6).scale(1.6, 0.4, 1).translate(1, 0.4, 1.3), 0xf2a33a],
    [new THREE.SphereGeometry(1, 10, 6).scale(1.6, 0.4, 1).translate(1, 0.4, -1.3), 0xf2a33a],
  ]);
  const hat = mergeGeos([new THREE.SphereGeometry(2.55, 16, 8, 0, TAU, 0, Math.PI / 2).translate(0.2, 11.2, 0), new THREE.SphereGeometry(0.9, 10, 8).translate(0.2, 14, 0)]);
  const n = spots.length, r = rng(seed), c = new THREE.Color(), cols = [0xd9472b, 0x2f6fe0, 0xf2c230, 0x2fae5a, 0x8a55c9];
  const bm = new THREE.InstancedMesh(back, new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.55 }), n);
  const fm = new THREE.InstancedMesh(front, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), n);
  const hm = new THREE.InstancedMesh(hat, new THREE.MeshPhysicalMaterial({ roughness: 0.95, sheen: 1, sheenColor: 0xffffff }), n);
  const hats = spots.map(() => r() < 0.5);
  spots.forEach((sp, i) => hm.setColorAt(i, c.set(cols[i % cols.length])));
  for (const m of [bm, fm, hm]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; group.add(m); }
  crowd.meshes = [bm, fm];
  const base = crowd.update.bind(crowd), zero = new THREE.Matrix4().makeScale(0, 0, 0), m4 = new THREE.Matrix4();
  crowd.update = (t, level) => {
    base(t, level);
    for (let i = 0; i < n; i++) { if (hats[i]) { bm.getMatrixAt(i, m4); hm.setMatrixAt(i, m4); } else hm.setMatrixAt(i, zero); }
    hm.instanceMatrix.needsUpdate = true;
  };
  crowd.update(0, 0);
  return crowd;
}

// a fireplace: brick surround, a mantel with stockings, logs and a fire that flickers and lights the room
export class Fireplace {
  constructor(group, { x, z, ry = 0, w = 90, h = 80, light = 16000, stockings = ['#d9472b', '#2fae5a', '#2f6fe0', '#f2c230'] }) {
    this.root = new THREE.Group(); this.root.position.set(x, 0, z); this.root.rotation.y = ry; group.add(this.root);
    const bc = TX.makeCanvas(256), b = bc.getContext('2d');
    b.fillStyle = '#d8cfc2'; b.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 16; y++) for (let k = -1; k < 5; k++) { b.fillStyle = ['#a8513a', '#b55e44', '#9a4a36', '#b8664a'][(k + y * 3 + 8) % 4]; b.fillRect(k * 64 + (y % 2) * 32 + 2, y * 16 + 2, 60, 12); }
    const brick = new THREE.MeshStandardMaterial({ map: TX.toTexture(bc, { repeat: [w / 50, h / 50] }), roughness: 0.9 });
    const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; this.root.add(m); return m; };
    const ow = w * 0.5, oh = h * 0.55;
    add(new THREE.BoxGeometry((w - ow) / 2, h, 14), brick, -(ow + (w - ow) / 2) / 2, h / 2, 7);
    add(new THREE.BoxGeometry((w - ow) / 2, h, 14), brick, (ow + (w - ow) / 2) / 2, h / 2, 7);
    add(new THREE.BoxGeometry(ow, h - oh, 14), brick, 0, oh + (h - oh) / 2, 7);
    const soot = new THREE.MeshStandardMaterial({ color: 0x1c1614, roughness: 1 });
    add(new THREE.BoxGeometry(ow, oh, 2), soot, 0, oh / 2, 1);
    add(new THREE.BoxGeometry(ow + 10, 2, 22), new THREE.MeshStandardMaterial({ color: 0x5a5450, roughness: 0.7 }), 0, 1, 12);
    const mantel = add(new THREE.BoxGeometry(w + 16, 5, 20), new THREE.MeshStandardMaterial({ color: 0x6e4a2f, roughness: 0.5 }), 0, h + 2.5, 9);
    void mantel;
    // logs and the fire
    const logM = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.9 });
    for (const [lx, ly, rz] of [[-6, 3.5, 0.1], [6, 3.5, -0.1], [0, 8, 0]]) { const l = add(new THREE.CylinderGeometry(3, 3, ow * 0.7, 10).rotateZ(Math.PI / 2 + rz), logM, lx * 0.2, ly, 8); l.rotation.y = lx * 0.04; }
    this.flames = [];
    const fc = TX.makeCanvas(64, 128), f = fc.getContext('2d');
    const gr = f.createRadialGradient(32, 100, 2, 32, 80, 60); gr.addColorStop(0, 'rgba(255,250,210,1)'); gr.addColorStop(0.3, 'rgba(255,190,80,0.95)'); gr.addColorStop(0.7, 'rgba(240,90,30,0.6)'); gr.addColorStop(1, 'rgba(200,40,10,0)');
    f.fillStyle = gr; f.beginPath(); f.moveTo(32, 2); f.quadraticCurveTo(64, 80, 50, 120); f.lineTo(14, 120); f.quadraticCurveTo(0, 80, 32, 2); f.fill();
    const flameTex = TX.toTexture(fc, { wrap: false });
    for (let k = 0; k < 5; k++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: hdr(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.position.set((k - 2) * ow * 0.14, 12, 9); m.scale.set(10, 20, 1); this.root.add(m);
      this.flames.push({ m, ph: k * 1.7, s: 0.8 + (k % 2) * 0.3 });
    }
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff9a40, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.position.set(0, 16, 16); this.glow.scale.set(ow * 2.4, oh * 1.8, 1); this.root.add(this.glow);
    this.light = new THREE.PointLight(0xff9a4a, light, 0, 2); this.light.position.set(0, 22, 26); this.root.add(this.light);
    this.base = light;
    // stockings hung from the mantel
    stockings.forEach((col, k) => {
      const sx = -w / 2 + 10 + k * ((w - 20) / Math.max(1, stockings.length - 1));
      const sg = new THREE.Group(); sg.position.set(sx, h - 2, 19); sg.rotation.z = (k % 2 ? 0.05 : -0.05); this.root.add(sg);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(3.4, 12, 4, 12), new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.95, sheen: 1, sheenColor: 0xffffff })); leg.position.y = -9; leg.castShadow = true; sg.add(leg);
      const foot = new THREE.Mesh(new THREE.CapsuleGeometry(3.2, 5, 4, 12).rotateZ(Math.PI / 2), leg.material); foot.position.set(3.5, -17, 0); foot.castShadow = true; sg.add(foot);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 4, 14), new THREE.MeshPhysicalMaterial({ color: 0xf7f4ee, roughness: 1, sheen: 1 })); cuff.position.y = -1.5; sg.add(cuff);
    });
  }
  update(t) {
    const k = 0.82 + 0.1 * Math.sin(t * 13) + 0.08 * Math.sin(t * 23 + 1.3);
    this.light.intensity = this.base * k;
    this.glow.material.opacity = 0.5 * k;
    for (const f of this.flames) { const s = f.s * (0.85 + 0.2 * Math.sin(t * 9 + f.ph) + 0.1 * Math.sin(t * 21 + f.ph * 2)); f.m.scale.set(10 * (0.9 + 0.1 * Math.sin(t * 7 + f.ph)), 20 * s, 1); f.m.position.y = 6 + 10 * s; }
  }
}

// a Christmas tree: three tiers, baubles, a star, fairy lights spiralling round, presents underneath
export class ChristmasTree {
  constructor(group, { x, z, h = 110, seed = 6 }) {
    const r = rng(seed);
    this.root = new THREE.Group(); this.root.position.set(x, 0, z); group.add(this.root);
    const green = new THREE.MeshStandardMaterial({ color: 0x2f6b3f, roughness: 0.8, flatShading: true });
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(9, 7, 12, 20), new THREE.MeshStandardMaterial({ color: 0xb5473a, roughness: 0.6 })); pot.position.y = 6; pot.castShadow = true; this.root.add(pot);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 14, 10), new THREE.MeshStandardMaterial({ color: 0x6e4a2f })); trunk.position.y = 16; this.root.add(trunk);
    const tiers = [[h * 0.36, h * 0.42, h * 0.32], [h * 0.28, h * 0.36, h * 0.55], [h * 0.19, h * 0.3, h * 0.76]];
    for (const [rad, th, y] of tiers) { const c = new THREE.Mesh(new THREE.ConeGeometry(rad, th, 14, 2), green); c.position.y = y; c.castShadow = true; c.receiveShadow = true; this.root.add(c); }
    const sc = TX.makeCanvas(64), sg = sc.getContext('2d'); sg.fillStyle = '#ffd34a'; sg.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? 12 : 30; sg.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr); } sg.fill();
    const star = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ map: TX.toTexture(sc, { wrap: false }), color: hdr(2.4), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })); star.position.y = h * 0.93 + 5; star.userData.live = true; this.root.add(star); this.star = star;
    // baubles on the surface of the cones
    const baubles = [];
    const bc = [0xd9262b, 0xf2c230, 0x2f6fe0, 0xe8e2d4, 0xd84f9a];
    for (const [rad, th, y] of tiers) for (let k = 0; k < 9; k++) {
      const u = 0.15 + r() * 0.75, a = r() * TAU, rr = rad * (1 - u) * 0.98 + 1.2;
      baubles.push({ x: Math.cos(a) * rr, y: y - th / 2 + u * th, z: Math.sin(a) * rr, color: bc[(k + Math.round(y)) % bc.length] });
    }
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(1.7, 12, 8), new THREE.MeshPhysicalMaterial({ roughness: 0.15, metalness: 0.4, clearcoat: 1 }), baubles.length);
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    baubles.forEach((b, i) => { bm.setMatrixAt(i, m4.makeTranslation(b.x, b.y, b.z)); bm.setColorAt(i, c.set(b.color)); });
    bm.castShadow = true; this.root.add(bm);
    // fairy lights round the tree in a spiral
    const pts = [];
    for (let k = 0; k <= 60; k++) { const u = k / 60, y = h * 0.14 + u * h * 0.74, rad = (1 - u * 0.92) * h * 0.37 + 1; const a = u * TAU * 4; pts.push([x + Math.cos(a) * rad, y, z + Math.sin(a) * rad]); }
    this.lights = new FairyLights(group, pts, { sag: 0, per: 1, bulb: 0.55, halo: 5, seed: seed + 3, wire: 0x1f3a24 });
    // presents
    const wrap = [[0xd9262b, 0xf2c230], [0x2f6fe0, 0xffffff], [0x2fae5a, 0xd9262b], [0xf2c230, 0x8a55c9]];
    wrap.forEach(([col, rib], k) => {
      const w = 12 + r() * 8, ht = 8 + r() * 8, d = 10 + r() * 6, a = k * 1.4 + 0.3, rr = h * 0.3;
      const gp = new THREE.Group(); gp.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr + 6); gp.rotation.y = r() * 1.5; this.root.add(gp);
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, ht, d), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 })); box.position.y = ht / 2; box.castShadow = true; box.receiveShadow = true; gp.add(box);
      const ribM = new THREE.MeshStandardMaterial({ color: rib, roughness: 0.4 });
      const r1 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, ht + 0.2, 1.6), ribM); r1.position.y = ht / 2; gp.add(r1);
      const r2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, ht + 0.2, d + 0.2), ribM); r2.position.y = ht / 2; gp.add(r2);
      const bow = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.6, 6, 12), ribM); bow.position.y = ht + 1.4; gp.add(bow);
    });
  }
  update(t) { this.lights.update(t); this.star.rotation.y = Math.sin(t * 0.5) * 0.4; }
}

// a snowy afternoon: low grey-blue sky, snow on the hills, dark firs
export function snowSky(seed = 12) {
  return (g, w, h) => {
    const r = rng(seed);
    const s = g.createLinearGradient(0, 0, 0, h);
    s.addColorStop(0, '#56709f'); s.addColorStop(0.6, '#a6badb'); s.addColorStop(1, '#e9eef6');
    g.fillStyle = s; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4f7fb';
    g.beginPath(); g.moveTo(0, h * 0.78); g.quadraticCurveTo(w * 0.25, h * 0.62, w * 0.47, h * 0.74); g.quadraticCurveTo(w * 0.75, h * 0.58, w, h * 0.72); g.lineTo(w, h); g.lineTo(0, h); g.fill();
    g.fillStyle = '#2f3f5a';
    for (let k = 0; k < 7; k++) { const x = r() * w, th = h * (0.1 + r() * 0.12), base = h * (0.8 + r() * 0.06); g.beginPath(); g.moveTo(x, base - th); g.lineTo(x - th * 0.32, base); g.lineTo(x + th * 0.32, base); g.fill(); }
  };
}

// ---------- a cat: sits at the back, watches the leader, swishes its tail, blinks ----------
export class Cat {
  constructor(group, { x, y = 0, z, ry = 0, size = 40, fur = 0xe8954a, belly = 0xfbe6c8, seed = 2 }) {
    const k = size / 40;
    this.root = new THREE.Group();
    this.root.position.set(x, y, z); this.root.rotation.y = ry; this.root.scale.setScalar(k); this.root.userData.live = true;
    const furM = new THREE.MeshStandardMaterial({ color: fur, roughness: 0.85 });
    const bellyM = new THREE.MeshStandardMaterial({ color: belly, roughness: 0.9 });
    const add = (geo, mat, px, py, pz, parent = this.root) => { const o = new THREE.Mesh(geo, mat); o.position.set(px, py, pz); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
    // sitting: haunches, a pear-shaped body, front legs, paws
    add(new THREE.SphereGeometry(10, 24, 16).scale(1.15, 0.9, 1), furM, -2, 8.5, 0);
    add(new THREE.SphereGeometry(8.5, 24, 16).scale(0.95, 1.45, 0.95), furM, 1.5, 17, 0);
    add(new THREE.SphereGeometry(5.6, 20, 14).scale(0.8, 1.5, 0.9), bellyM, 6.2, 15, 0);
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(1.9, 2.2, 12, 12), furM, 6.6, 6.5, s * 3.2);
      add(new THREE.SphereGeometry(2.5, 14, 10).scale(1.3, 0.7, 1), bellyM, 7.8, 1.2, s * 3.2);
    }
    // the head turns as a group
    this.head = new THREE.Group(); this.head.position.set(3, 31, 0); this.root.add(this.head);
    add(new THREE.SphereGeometry(7.4, 24, 18).scale(1, 0.9, 1.05), furM, 0, 0, 0, this.head);
    add(new THREE.SphereGeometry(3.4, 16, 12).scale(1, 0.7, 1.25), bellyM, 5.4, -2.2, 0, this.head);
    add(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe88a98, roughness: 0.5 }), 7.9, -0.9, 0, this.head);
    for (const s of [-1, 1]) {
      const ear = add(new THREE.ConeGeometry(3, 5.5, 4), furM, -0.5, 6.8, s * 4.2, this.head); ear.rotation.set(s * 0.35, 0, -0.15);
      const inner = add(new THREE.ConeGeometry(1.7, 3.8, 4), bellyM, 0.6, 6.6, s * 4.1, this.head); inner.rotation.set(s * 0.35, 0, -0.15);
    }
    // eyes: green with a dark slit, on a group that squashes to blink
    this.eyes = new THREE.Group(); this.head.add(this.eyes);
    const iris = new THREE.MeshStandardMaterial({ color: 0x9ccf4a, roughness: 0.25, emissive: 0x2c4010, emissiveIntensity: 0.6 });
    const slit = new THREE.MeshBasicMaterial({ color: 0x14100c });
    for (const s of [-1, 1]) {
      add(new THREE.SphereGeometry(1.7, 14, 10).scale(0.5, 1, 1), iris, 6.3, 1.4, s * 2.9, this.eyes);
      add(new THREE.SphereGeometry(0.75, 8, 8).scale(0.4, 1.6, 0.45), slit, 7.05, 1.4, s * 2.9, this.eyes);
    }
    // whiskers
    const wm = new THREE.MeshBasicMaterial({ color: 0xfff6e8 });
    for (const s of [-1, 1]) for (const a of [-0.18, 0, 0.18]) { const w = add(new THREE.CylinderGeometry(0.08, 0.08, 9, 3), wm, 7, -1.6 + a * 4, s * 4.5, this.head); w.rotation.set(Math.PI / 2 + s * 0.25, 0, a); }
    // the tail: a chain of segments curling round the side, updated each frame
    this.tail = [];
    for (let i = 0; i < 9; i++) this.tail.push(add(new THREE.SphereGeometry(2.1 - i * 0.12, 10, 8), furM, 0, 0, 0));
    group.add(this.root);
    this.r = rng(seed);
    this.blinkAt = 2; this.look = 0; this.world = new THREE.Vector3();
  }
  // lookAt: a world x/z the cat watches (the leader); excite makes the tail busier
  update(t, dt, lookAt = null, excite = 0) {
    if (lookAt) {
      this.world.set(lookAt.x, 0, lookAt.z);
      this.root.worldToLocal(this.world);
      const want = clamp(Math.atan2(-this.world.z, this.world.x), -0.9, 0.9);
      this.look += (want - this.look) * (1 - Math.exp(-3 * dt));
    }
    this.head.rotation.set(0, this.look, Math.sin(t * 0.6) * 0.06);
    // blink now and then
    if (t > this.blinkAt) { this.blinkAt = t + 2.5 + this.r() * 4; this.blinkT = t; }
    const b = this.blinkT != null ? clamp((t - this.blinkT) / 0.18, 0, 1) : 1;
    this.eyes.scale.y = b < 1 ? Math.max(0.08, Math.abs(1 - 2 * b)) : 1;
    // tail: out behind, curling up and round, the tip flicking
    const sw = Math.sin(t * (1.4 + excite * 2.2)) * (0.35 + excite * 0.4);
    let px = -11, py = 2.5, pz = -3, a = Math.PI * 0.95;
    this.tail.forEach((s, i) => {
      s.position.set(px, py, pz);
      const bend = 0.12 + sw * 0.05 * i;
      a += bend;
      px += Math.cos(a) * 2.6; pz += Math.sin(a) * 2.6 * 0.6; py += 0.3 + (i > 5 ? (i - 5) * 0.9 : 0) * (1 + sw * 0.6);
    });
  }
}

// ---------- a patch of sunlight on the floor, the window's shape thrown along the light ----------
// corners: the window's four corners in world space; sun: towards the sun; y: the floor height.
export function sunPatch(group, { corners, sun, y = 0.1, panes = [2, 2], color = 0xffd9a0, opacity = 0.32 }) {
  const d = new THREE.Vector3(...sun).normalize();
  const pts = corners.map(([x, wy, z]) => { const t = (wy - y) / d.y; return new THREE.Vector3(x - d.x * t, y, z - d.z * t); });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
  const c = TX.makeCanvas(256), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  g.filter = 'blur(5px)';
  const [nx, ny] = panes, bw = 14;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const x0 = 12 + i * (232 / nx) + (i ? bw / 2 : 0), y0 = 12 + j * (232 / ny) + (j ? bw / 2 : 0);
    g.fillStyle = '#fff'; g.fillRect(x0, y0, 232 / nx - bw / 2 - (i ? 0 : 0), 232 / ny - bw / 2);
  }
  g.filter = 'none';
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: TX.toTexture(c, { wrap: false }), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.renderOrder = 1;
  group.add(m);
  return m;
}

// ---------- a dog asleep on its bed: breathes, twitches an ear, thumps its tail when it's exciting ----------
export class Dog {
  constructor(group, { x, y = 0, z, ry = 0, size = 30, coat = 0xc98a4b, patch = 0xf4e3c8, ear = 0x7a4a2a, bed = 0x2f6fe0 }) {
    const k = size / 30;
    this.root = new THREE.Group(); this.root.position.set(x, y, z); this.root.rotation.y = ry; this.root.scale.setScalar(k); this.root.userData.live = true;
    const coatM = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.9 });
    const patchM = new THREE.MeshStandardMaterial({ color: patch, roughness: 0.9 });
    const earM = new THREE.MeshStandardMaterial({ color: ear, roughness: 0.9 });
    const add = (geo, mat, px, py, pz, parent = this.root) => { const o = new THREE.Mesh(geo, mat); o.position.set(px, py, pz); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
    // the bed: a fat ring cushion with a flat middle
    add(new THREE.TorusGeometry(15, 4.6, 12, 32).rotateX(Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: bed, roughness: 0.9, sheen: 1, sheenColor: 0xffffff }), 0, 4, 0);
    add(new THREE.CylinderGeometry(15, 15, 3, 32), new THREE.MeshStandardMaterial({ color: 0xf2e8d8, roughness: 1 }), 0, 1.6, 0);
    // curled up: body, haunch, head resting on the front paws
    this.body = add(new THREE.SphereGeometry(9, 22, 16).scale(1.45, 0.75, 1), coatM, -1, 8, 0);
    add(new THREE.SphereGeometry(6, 18, 12).scale(1, 0.8, 1), coatM, -9, 8.5, 3.5);
    add(new THREE.SphereGeometry(5.5, 16, 12).scale(1.3, 0.55, 0.9), patchM, 3, 6.4, 5.5);
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(2.4, 12, 8).scale(1.8, 0.7, 1), patchM, 10.5, 4.6, s * 2.8 + 3);
    this.head = new THREE.Group(); this.head.position.set(11, 8.2, 3); this.root.add(this.head);
    add(new THREE.SphereGeometry(5, 18, 14).scale(1.05, 0.85, 1), coatM, 0, 0, 0, this.head);
    add(new THREE.SphereGeometry(3, 14, 10).scale(1.3, 0.8, 0.9), patchM, 4.4, -1.2, 0, this.head);
    add(new THREE.SphereGeometry(1.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x241c18, roughness: 0.4 }), 8, -0.6, 0, this.head);
    // closed eyes: little dark arcs
    for (const s of [-1, 1]) { const e = add(new THREE.TorusGeometry(0.9, 0.22, 4, 10, Math.PI), new THREE.MeshBasicMaterial({ color: 0x241c18 }), 3.2, 1.6, s * 2.3, this.head); e.rotation.set(0, Math.PI / 2, Math.PI); }
    this.ears = [-1, 1].map((s) => { const e = add(new THREE.SphereGeometry(3, 12, 8).scale(0.5, 1.4, 1), earM, -1, -0.5, s * 4.6, this.head); e.rotation.x = s * 0.5; return e; });
    // the tail curls round the front of the bed
    this.tail = new THREE.Group(); this.tail.position.set(-13, 6.5, 4); this.root.add(this.tail);
    const tailG = new THREE.CapsuleGeometry(1.4, 9, 6, 10).rotateZ(Math.PI / 2).translate(5, 0, 0);
    add(tailG, coatM, 0, 0, 0, this.tail);
    this.tail.rotation.y = -1.1;
    group.add(this.root);
    this.wag = 0;
  }
  update(t, dt, excite = 0) {
    // slow breathing, an ear that twitches now and then, a happy tail when the crowd cheers
    this.body.scale.y = 1 + 0.035 * Math.sin(t * 1.6);
    this.head.rotation.z = 0.03 * Math.sin(t * 1.6 - 0.5);
    this.ears[0].rotation.z = Math.max(0, Math.sin(t * 0.7) - 0.92) * 6;
    this.wag += ((excite > 0.5 ? 1 : 0) - this.wag) * (1 - Math.exp(-3 * dt));
    this.tail.rotation.y = -1.1 + this.wag * 0.5 * Math.sin(t * 14);
  }
}

// ---------- podiums for the medal ceremony, built from whatever the room has to hand ----------
// Returns { group, tops: [{x, y, z}] by place (0 = gold) }. The podium faces +z, gold in the middle.
const POD_X = [0, -6.8, 6.8], POD_H = [4.6, 3.4, 2.4];
export function podium(K, style = 'blocks') {
  const group = new THREE.Group(), r = rng(31);
  const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; group.add(m); return m; };
  const std = (color, rough = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
  const phys = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, clearcoat: 0.6, ...extra });
  // a big painted number on the front of each step
  const label = (place, x, y, z, w = 4.4, col = '#1f1a17') => {
    const c = TX.makeCanvas(128), g = c.getContext('2d');
    g.fillStyle = col; g.font = '112px "Lilita One", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(place + 1), 64, 70);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.55, w * 0.55), new THREE.MeshBasicMaterial({ map: TX.toTexture(c, { wrap: false }), transparent: true, depthWrite: false, toneMapped: false }));
    m.position.set(x, y, z); m.renderOrder = 2; group.add(m);
  };
  const tops = [];
  for (let p = 0; p < 3; p++) {
    const x = POD_X[p], H = POD_H[p];
    let top = H;
    switch (style) {
      case 'shoebox': {
        const cols = [[0xf2c230, 0xd9472b], [0xd9dde3, 0x2f6fe0], [0xcd7f45, 0xf7f2e8]][p];
        add(new THREE.BoxGeometry(6, H - 0.6, 6), std(cols[0], 0.7), x, (H - 0.6) / 2, 0);
        add(new THREE.BoxGeometry(6.4, 0.9, 6.4), std(cols[1], 0.6), x, H - 0.45, 0);
        label(p, x, H / 2 - 0.3, 3.02, 4.4);
        break;
      }
      case 'float': {
        // an inflatable raft: puffy striped tubes in pool-toy colours
        const cols = [0xff6f9a, 0xffd23a, 0x5fc9f0];
        const c = TX.makeCanvas(64, 16), g = c.getContext('2d');
        for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#ffffff' : '#' + cols[p].toString(16).padStart(6, '0'); g.fillRect(k * 8, 0, 8, 16); }
        const mat = phys(0xffffff, { map: TX.toTexture(c, { repeat: [1, 1] }), roughness: 0.25, clearcoat: 1 });
        const m = add(new THREE.CylinderGeometry(3.2, 3.4, H, 24), mat, x, H / 2, 0);
        const rim = add(new THREE.TorusGeometry(3.2, 0.55, 10, 28).rotateX(Math.PI / 2), phys(0xffffff, { roughness: 0.2, clearcoat: 1 }), x, H, 0);
        void m; void rim;
        label(p, x, H / 2, 3.45, 4.4, '#ffffff');
        if (p === 0) add(new THREE.TorusGeometry(13.5, 1.7, 14, 48).rotateX(Math.PI / 2), phys(0xffffff, { map: TX.toTexture(c, { repeat: [6, 1] }), roughness: 0.25, clearcoat: 1 }), 0, 0.6, 0);
        top = H + 0.5;
        break;
      }
      case 'books': {
        let y = 0;
        const cols = [0xb5473a, 0x2f4f7a, 0x2fae5a, 0xf2c230, 0x8a55c9, 0xef7d2c, 0x3d7bd9];
        while (y < H - 0.1) {
          const t = Math.min(H - y, 0.7 + r() * 0.5);
          add(new K.RoundedBoxGeometry(6.4 + r() * 0.8, t, 5 + r() * 0.8, 2, 0.12), std(cols[(r() * cols.length) | 0], 0.6), x + (r() - 0.5) * 0.4, y + t / 2, (r() - 0.5) * 0.4, (r() - 0.5) * 0.15);
          y += t;
        }
        label(p, x, H / 2, 3.2, 4.2, '#fff6dc');
        break;
      }
      case 'cushions': {
        const cols = [[0xd9a73a, 0xc4655a], [0x2f6b6b, 0x9fd1c4], [0xc4655a, 0xf2e3c4]][p];
        const n = p === 0 ? 3 : p === 1 ? 2 : 2, t = H / n;
        for (let k = 0; k < n; k++) add(new K.RoundedBoxGeometry(6.4, t, 6.4, 4, Math.min(1.1, t * 0.45)), phys(cols[k % 2], { roughness: 0.9, clearcoat: 0, sheen: 1, sheenColor: 0xffffff }), x, t * (k + 0.5), 0, (r() - 0.5) * 0.2);
        label(p, x, H / 2, 3.25, 4.2, '#fff6dc');
        break;
      }
      case 'gifts': {
        const cols = [[0xd9262b, 0xf2c230], [0x2f6fe0, 0xffffff], [0x2fae5a, 0xd9262b]][p];
        add(new THREE.BoxGeometry(6, H, 6), std(cols[0], 0.45), x, H / 2, 0);
        const rib = std(cols[1], 0.35);
        add(new THREE.BoxGeometry(6.08, H + 0.04, 1), rib, x, H / 2, 0);
        add(new THREE.BoxGeometry(1, H + 0.04, 6.08), rib, x, H / 2, 0);
        label(p, x - 1.7, H / 2, 3.05, 3, '#fff6dc');
        top = H;
        break;
      }
      case 'biscuits': {
        let y = 0, k = 0;
        while (y < H - 0.1) { add(new THREE.CylinderGeometry(3.1, 3.1, 0.62, 28), std(k % 3 === 2 ? 0x5a3220 : 0xd59a55, 0.85), x + (r() - 0.5) * 0.4, y + 0.31, (r() - 0.5) * 0.4); y += 0.62; k++; }
        top = y;
        label(p, x, top + 0.02, 0, 4.6, '#fff6dc');
        group.children[group.children.length - 1].rotation.x = -Math.PI / 2;
        break;
      }
      case 'sugar': {
        const n = Math.round(H / 1.5), cubes = [];
        for (let k = 0; k < n; k++) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) cubes.push([x - 0.78 + i * 1.56, 0.75 + k * 1.5, -0.78 + j * 1.56]);
        const m = new THREE.InstancedMesh(new K.RoundedBoxGeometry(1.5, 1.5, 1.5, 2, 0.18), std(0xfbfaf6, 0.95), cubes.length);
        const m4 = new THREE.Matrix4();
        cubes.forEach(([cx, cy, cz], i) => m.setMatrixAt(i, m4.makeTranslation(cx + (r() - 0.5) * 0.08, cy, cz + (r() - 0.5) * 0.08)));
        m.castShadow = true; m.receiveShadow = true; group.add(m);
        top = n * 1.5;
        label(p, x, top / 2, 1.6, 2.8);
        if (p === 0) add(new THREE.CylinderGeometry(14, 11, 0.6, 40), phys(0xf7f4ee, { roughness: 0.2, clearcoat: 1 }), 0, -0.3, 0);
        break;
      }
      case 'boxes': {
        const c = TX.makeCanvas(128), g = c.getContext('2d');
        g.fillStyle = '#c69a62'; g.fillRect(0, 0, 128, 128); g.fillStyle = 'rgba(214,170,104,0.9)'; g.fillRect(52, 0, 24, 128);
        add(new THREE.BoxGeometry(6.4, H, 6.4), std(0xffffff, 0.9, { map: TX.toTexture(c, { wrap: false }) }), x, H / 2, 0, (r() - 0.5) * 0.12);
        label(p, x, H / 2, 3.25, 4.2);
        break;
      }
      case 'tins': {
        const n = p === 0 ? 2 : 1, t = H / n;
        const cols = [0xd9472b, 0x2f6fe0, 0xf2c230, 0x2fae5a];
        for (let k = 0; k < n; k++) {
          add(new THREE.CylinderGeometry(3, 3, t - 0.1, 28), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.8, roughness: 0.3 }), x, t * k + t / 2, 0);
          add(new THREE.CylinderGeometry(3.04, 3.04, t * 0.5, 28, 1, true), phys(cols[(p + k) % 4]), x, t * k + t / 2, 0);
        }
        label(p, x, H / 2, 3.1, 3.6, '#ffffff');
        break;
      }
      case 'bricks': {
        let y = 0, k = 0;
        while (y < H - 0.1) {
          for (let i = 0; i < 2; i++) add(new K.RoundedBoxGeometry(k % 2 ? 6.4 : 3.1, 1.1, k % 2 ? 3.1 : 6.4, 2, 0.12), std([0xa8513a, 0xb55e44, 0x9a4a36][(k + i) % 3], 0.85), x + (k % 2 ? 0 : (i - 0.5) * 3.2), y + 0.55, k % 2 ? (i - 0.5) * 3.2 : 0);
          y += 1.1; k++;
        }
        top = y;
        label(p, x, top / 2, 3.3, 3.6, '#fff6dc');
        break;
      }
      default: {
        // letter blocks
        const s = p === 0 ? H / 2 : H;
        const n = p === 0 ? 2 : 1;
        for (let k = 0; k < n; k++) { const b = letterBlock([String(p + 1)], s, 40 + p * 3 + k); b.position.set(x, s * (k + 0.5), 0); b.rotation.y = (r() - 0.5) * 0.2; group.add(b); }
        break;
      }
    }
    tops[p] = { x, y: top, z: 0 };
  }
  return { group, tops };
}

// ---------- baking: one draw call per material for all the still things in a room ----------
// Merges every plain mesh under `root` that shares a material (and shadow flags) into one mesh. Anything
// that moves is left alone: mark it (or a parent) with userData.live = true. Instanced meshes, sprites,
// points, lights and meshes with several materials are never touched.
export function bakeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const live = (o) => { for (let p = o; p && p !== root; p = p.parent) if (p.userData.live) return true; return false; };
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.morphTargetInfluences || live(o)) return;
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });
  const m4 = new THREE.Matrix4();
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => {
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
      g.clearGroups();
      return g;
    });
    // all of them need the same attributes to merge; vertex colours only when every part has them
    const hasColor = geos.every((g) => g.attributes.color);
    if (!hasColor) for (const g of geos) if (g.attributes.color) g.deleteAttribute('color');
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    if (!merged) continue;
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow; mesh.renderOrder = first.renderOrder;
    root.add(mesh);
    for (const o of list) { o.parent.remove(o); o.geometry.dispose(); }
  }
  return root;
}

// ---------- small helpers ----------
function mergeGeos(list) {
  const geos = list.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; });
  return mergeBuffer(geos);
}
function colorMerge(pairs) {
  const geos = pairs.map(([g, col]) => {
    const n = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(col), cnt = n.attributes.position.count, a = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) a.set([c.r, c.g, c.b], i * 3);
    n.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return n;
  });
  return mergeBuffer(geos);
}
function mergeBuffer(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const key of Object.keys(geos[0].attributes)) {
    const size = geos[0].attributes[key].itemSize, arr = new Float32Array(n * size);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[key].array, o); o += g.attributes[key].array.length; }
    out.setAttribute(key, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}
