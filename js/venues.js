// Venue dressing: the rooms of the house the events are held in, and the small living things in them.
// Sunlight through bathwater, bath-toy and gingerbread crowds, fairy lights, a snowy night window, a cat.
// Everything here is cheap: instanced meshes, a few additive planes, canvas textures, one draw call
// wherever possible. On low quality the purely decorative movement is thinned out by the callers.
import * as THREE from '../vendor/three.bundle.js';
import * as TX from './textures.js';
import { rng, clamp, TAU } from './util.js';

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
export function sunbeams(group, { from, dir, length = 150, width = 16, n = 3, spread = 18, color = 0xffe6b0, opacity = 0.09, seed = 3 }) {
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
  return { beams, mat, update(t) { mat.opacity = opacity * (0.85 + 0.15 * Math.sin(t * 0.7)); } };
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
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(bulb, 8, 6).scale(1, 1.35, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
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
  constructor(spots, seed) {
    this.spots = spots;
    const r = rng(seed);
    this.ph = spots.map(() => r() * TAU);
    this.sp = spots.map(() => 5 + r() * 3);
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.meshes = [];
  }
  update(t, level = 0) {
    const { m4, q, e, p, s } = this;
    this.spots.forEach((sp, i) => {
      const hop = Math.max(0, Math.sin(t * this.sp[i] + this.ph[i])) * level * level * sp.size * 0.35;
      const sway = Math.sin(t * 1.3 + this.ph[i]) * (0.05 + level * 0.12);
      e.set(0, sp.ry || 0, sway, 'YXZ'); q.setFromEuler(e);
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
  const crowd = new HopCrowd(spots, seed);
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

// ---------- a cat: sits at the back, watches the leader, swishes its tail, blinks ----------
export class Cat {
  constructor(group, { x, y = 0, z, ry = 0, size = 40, fur = 0xe8954a, belly = 0xfbe6c8, seed = 2 }) {
    const k = size / 40;
    this.root = new THREE.Group();
    this.root.position.set(x, y, z); this.root.rotation.y = ry; this.root.scale.setScalar(k);
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
