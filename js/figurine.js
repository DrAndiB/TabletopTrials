// Painted wooden figurines: a peg-doll body with jointed arms and legs, painted in a team's colours.
// Units are cm; a figurine stands about 8.3 tall and faces +z (its left side is +x).
// A pose is a flat object of numbers (see REST) so poses can be blended; events build poses with the
// helpers in POSES and apply them with fig.setPose(pose).
import * as THREE from '../vendor/three.bundle.js';
import { RoundedBoxGeometry } from '../vendor/three.bundle.js';
import { rng, clamp, lerp } from './util.js';
import { makeCanvas, toTexture } from './textures.js';

const TAU = Math.PI * 2;

// ---------- proportions ----------
const HIP_Y = 3.75;          // pelvis pivot above the soles when standing straight
const HIP_X = 0.5, HIP_DROP = 0.35;
const THIGH = 1.55, SHIN = 1.45, SOLE = 0.38;
const SH_X = 1.03, SH_Y = 1.72; // shoulder joints, relative to the spine pivot
const UPPER = 1.2, FORE = 1.08;
const HEAD_R = 1.25, NECK = 2.22;

export const SKIN_TONES = ['#f4d4b6', '#e9bd96', '#d09a6c', '#a7714b', '#7a5236', '#5a3b27'];
export const HAIR_COLORS = ['#2a1d15', '#4a3020', '#7a4b28', '#b07d45', '#d7b06c', '#1a1716', '#8e3b1f'];
const HAIR_STYLES = ['short', 'pony', 'buns', 'bob', 'curly', 'short'];

// a neutral standing pose; every pose has exactly these keys
export const REST = {
  y: 0, pitch: 0, lean: 0, roll: 0, twist: 0, head: 0, headTurn: 0, vee: 0,
  shL: 0, shR: 0, abL: 0.08, abR: 0.08, elL: 0.15, elR: 0.15,
  hipL: 0, hipR: 0, spL: 0.02, spR: 0.02, kneeL: 0, kneeR: 0, ankL: 0, ankR: 0,
};

// ---------- shared geometry (built once) ----------
let G = null;
function geos() {
  if (G) return G;
  const lathe = (pts, segs = 28) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  G = {
    torso: lathe([[0.001, -0.08], [0.82, -0.04], [0.94, 0.3], [1.0, 0.85], [1.01, 1.3], [0.93, 1.72], [0.7, 2.0], [0.36, 2.18], [0.001, 2.24]]),
    pelvis: lathe([[0.001, -0.62], [0.55, -0.6], [0.9, -0.42], [1.0, -0.12], [0.97, 0.12], [0.001, 0.14]]),
    head: new THREE.SphereGeometry(HEAD_R, 32, 24),
    face: new THREE.SphereGeometry(HEAD_R * 1.006, 24, 18, Math.PI / 2 - 0.95, 1.9, 0.72, 1.6),
    hairCap: new THREE.SphereGeometry(HEAD_R * 1.07, 28, 14, 0, TAU, 0, 1.42),
    hairBob: new THREE.SphereGeometry(HEAD_R * 1.1, 28, 16, 0, TAU, 0, 1.75),
    bead: new THREE.SphereGeometry(0.42, 16, 12),
    neck: new THREE.CylinderGeometry(0.36, 0.42, 0.4, 16),
    upper: capsule(0.31, UPPER),
    fore: capsule(0.27, FORE),
    hand: new THREE.SphereGeometry(0.36, 16, 12),
    thigh: capsule(0.46, THIGH),
    shin: capsule(0.37, SHIN),
    sock: new THREE.CylinderGeometry(0.4, 0.4, 0.55, 16, 1, true),
    foot: footGeometry(),
    bib: new THREE.PlaneGeometry(1.15, 0.92),
    band: new THREE.TorusGeometry(HEAD_R * 1.02, 0.17, 10, 36),
    helmet: new THREE.SphereGeometry(HEAD_R * 1.13, 28, 16, 0, TAU, 0, 1.6),
    goggle: new THREE.TorusGeometry(HEAD_R * 1.1, 0.24, 8, 36, 1.7),
    lens: new RoundedBoxGeometry(1.5, 0.55, 0.3, 3, 0.14),
    ski: skiGeometry(),
    ponytail: new THREE.CapsuleGeometry(0.42, 1.0, 6, 12),
    bun: new THREE.SphereGeometry(0.55, 16, 12),
    curl: new THREE.SphereGeometry(0.42, 12, 10),
  };
  return G;
}

function capsule(r, len) {
  const g = new THREE.CapsuleGeometry(r, len, 6, 14);
  g.translate(0, -len / 2, 0);
  return g;
}

function footGeometry() {
  // a rounded shoe: squashed rounded box, toe towards +z
  const g = new RoundedBoxGeometry(0.78, 0.5, 1.35, 4, 0.24);
  g.translate(0, -SOLE + 0.25, 0.3);
  return g;
}

// craft-stick ski: a flat strip with a rounded, upturned tip (+z)
function skiGeometry() {
  const len = 9.6, w = 0.78, t = 0.16;
  const g = new RoundedBoxGeometry(w, t, len, 2, 0.07);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const tip = Math.max(0, (z - (len / 2 - 1.6)) / 1.6);
    p.setY(i, p.getY(i) + tip * tip * 0.9);
    // round the tip in plan view
    if (z > len / 2 - 0.5) p.setX(i, p.getX(i) * (1 - (z - (len / 2 - 0.5)) * 0.9));
  }
  g.computeVertexNormals();
  g.translate(0, -SOLE - t / 2 + 0.02, 0.9);
  return g;
}

// ---------- shared textures ----------
const faceTex = {};
function faceTexture(kind) {
  if (faceTex[kind]) return faceTex[kind];
  const S = 256, c = makeCanvas(S), g = c.getContext('2d');
  // the decal spans 1.9 rad across and 1.6 rad down; keep features inside the middle
  const ex = 0.165 * S, ey = 0.43 * S;
  const eye = (x) => {
    g.fillStyle = '#1b1411';
    g.beginPath(); g.ellipse(x, ey, 10, 14, 0, 0, TAU); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(x + 3.2, ey - 5, 3.6, 0, TAU); g.fill();
  };
  // cheeks
  for (const sx of [-1, 1]) {
    const gr = g.createRadialGradient(S / 2 + sx * 0.27 * S, 0.58 * S, 0, S / 2 + sx * 0.27 * S, 0.58 * S, 22);
    gr.addColorStop(0, 'rgba(240,110,110,0.55)'); gr.addColorStop(1, 'rgba(240,110,110,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  g.lineCap = 'round';
  if (kind === 'wow') {
    eye(S / 2 - ex); eye(S / 2 + ex);
    g.fillStyle = '#5a1f1a';
    g.beginPath(); g.ellipse(S / 2, 0.66 * S, 9, 12, 0, 0, TAU); g.fill();
  } else if (kind === 'focus') {
    eye(S / 2 - ex); eye(S / 2 + ex);
    g.strokeStyle = '#2b1d16'; g.lineWidth = 6;
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(S / 2 + sx * (ex + 14), ey - 24); g.lineTo(S / 2 + sx * (ex - 12), ey - 18); g.stroke(); }
    g.strokeStyle = '#5a1f1a'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(S / 2 - 14, 0.655 * S); g.quadraticCurveTo(S / 2, 0.675 * S, S / 2 + 14, 0.655 * S); g.stroke();
  } else if (kind === 'sad') {
    eye(S / 2 - ex); eye(S / 2 + ex);
    g.strokeStyle = '#5a1f1a'; g.lineWidth = 6;
    g.beginPath(); g.arc(S / 2, 0.71 * S, 15, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
  } else {
    eye(S / 2 - ex); eye(S / 2 + ex);
    g.strokeStyle = '#5a1f1a'; g.lineWidth = 6.5;
    g.beginPath(); g.arc(S / 2, 0.6 * S, 21, Math.PI * 0.18, Math.PI * 0.82); g.stroke();
  }
  faceTex[kind] = toTexture(c, { wrap: false });
  return faceTex[kind];
}

let woodTex = null;
function woodGrain() {
  if (woodTex) return woodTex;
  const c = makeCanvas(128), g = c.getContext('2d');
  g.fillStyle = '#e6c99c'; g.fillRect(0, 0, 128, 128);
  const r = rng(91);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(${150 + r() * 30},${100 + r() * 20},${55 + r() * 15},${0.16 + r() * 0.2})`;
    g.lineWidth = 1 + r() * 2.5;
    const y = r() * 128;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 128; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 3 + (r() - 0.5) * 2);
    g.stroke();
  }
  woodTex = toTexture(c, { repeat: [1, 2] });
  return woodTex;
}

const shared = {};
function sharedMats() {
  if (shared.wood) return shared;
  shared.wood = new THREE.MeshPhysicalMaterial({ color: 0xf0d6aa, map: woodGrain(), roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.5 });
  shared.shoe = new THREE.MeshPhysicalMaterial({ color: 0xf6f2ea, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  shared.sole = new THREE.MeshPhysicalMaterial({ color: 0x2b2420, roughness: 0.6, clearcoat: 0.3 });
  shared.lens = new THREE.MeshPhysicalMaterial({ color: 0xffa83a, roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04, emissive: 0x3a1800, emissiveIntensity: 0.4 });
  shared.ski = new THREE.MeshPhysicalMaterial({ color: 0xf0d3a2, map: woodGrain(), roughness: 0.55, clearcoat: 0.35 });
  for (const k of ['happy', 'focus', 'wow', 'sad']) {
    shared['face_' + k] = new THREE.MeshStandardMaterial({ map: faceTexture(k), transparent: true, alphaTest: 0.02, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
  }
  return shared;
}

function paintMat(color, extra = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.22, ...extra });
}

// readable ink (dark or light) on top of a paint colour
function inkFor(hex) {
  const c = new THREE.Color(hex);
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return l > 0.45 ? '#1f1a17' : '#ffffff';
}

function bibTexture(number, border) {
  const c = makeCanvas(128, 104), g = c.getContext('2d');
  g.fillStyle = '#fbf7ee';
  g.beginPath(); g.roundRect(4, 4, 120, 96, 14); g.fill();
  g.lineWidth = 7; g.strokeStyle = border; g.stroke();
  g.fillStyle = '#1f1a17';
  g.font = '64px "Lilita One", Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(number), 64, 58);
  return toTexture(c, { wrap: false });
}

// ---------- the figurine ----------
export class Figurine {
  // paint: {shirt, shorts, trim} colours; seed picks skin tone, hair and style (or pass skin/hair/style)
  constructor({ paint = { shirt: '#e23b2e', shorts: '#1f1a17', trim: '#ffffff' }, seed = 1, number = null, skin, hair, style } = {}) {
    const g = geos(), S = sharedMats();
    const r = rng(seed * 7919 + 13);
    this.skinColor = skin || r.pick(SKIN_TONES);
    this.hairColor = hair || r.pick(HAIR_COLORS);
    this.style = style || r.pick(HAIR_STYLES);
    this.paint = paint;
    const M = this.mats = {
      shirt: paintMat(paint.shirt),
      shorts: paintMat(paint.shorts),
      trim: paintMat(paint.trim),
      skin: paintMat(this.skinColor, { roughness: 0.5, clearcoat: 0.35 }),
      hair: paintMat(this.hairColor, { roughness: 0.55, clearcoat: 0.3 }),
    };
    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    this.root = new THREE.Group();        // placed by the event (feet reference, facing)
    this.body = new THREE.Group();        // grounding offset
    this.root.add(this.body);
    const hips = this.hips = new THREE.Group();
    hips.position.y = HIP_Y;
    this.body.add(hips);
    mesh(g.pelvis, M.shorts, hips);

    const spine = this.spine = new THREE.Group();
    spine.position.y = 0.1;
    hips.add(spine);
    this.torso = mesh(g.torso, M.shirt, spine);
    // painted waistband stripe in the trim colour
    const belt = mesh(new THREE.CylinderGeometry(0.95, 0.9, 0.16, 28, 1, true), M.trim, spine, 0, 0.12, 0);
    belt.castShadow = false;
    mesh(g.neck, M.skin, spine, 0, NECK - 0.02, 0);

    const head = this.head = new THREE.Group();
    head.position.y = NECK + 0.1;
    spine.add(head);
    const skull = new THREE.Group();
    skull.position.y = HEAD_R * 0.92;
    head.add(skull);
    this.skull = skull;
    mesh(g.head, M.skin, skull);
    this.face = mesh(g.face, S.face_happy, skull);
    this.face.castShadow = false;
    this.buildHair(skull, r);

    this.bib = null;
    if (number != null) this.setNumber(number);

    // arms
    this.arms = [1, -1].map((side) => {
      const sh = new THREE.Group();
      sh.position.set(side * SH_X, SH_Y, 0);
      spine.add(sh);
      mesh(g.bead, M.shirt, sh).scale.setScalar(0.92);
      mesh(g.upper, M.shirt, sh);
      const el = new THREE.Group();
      el.position.y = -UPPER;
      sh.add(el);
      mesh(g.fore, M.skin, el);
      mesh(g.hand, M.skin, el, 0, -FORE - 0.05, 0);
      return { sh, el, side };
    });

    // legs
    this.legs = [1, -1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * HIP_X, -HIP_DROP, 0);
      hips.add(hip);
      mesh(g.thigh, M.shorts, hip).scale.set(1, 0.42, 1);
      const thighSkin = mesh(g.thigh, M.skin, hip, 0, -THIGH * 0.42, 0);
      thighSkin.scale.set(0.93, 0.58, 0.93);
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      hip.add(knee);
      mesh(g.bead, S.wood, knee).scale.setScalar(0.92);
      mesh(g.shin, M.skin, knee);
      const sock = mesh(g.sock, M.trim, knee, 0, -SHIN + 0.35, 0);
      sock.castShadow = false;
      const ank = new THREE.Group();
      ank.position.y = -SHIN;
      knee.add(ank);
      const shoe = mesh(g.foot, S.shoe, ank);
      const sole = mesh(g.foot, S.sole, ank, 0, -0.06, 0);
      sole.scale.set(1.02, 0.25, 1.02);
      return { hip, knee, ank, side, shoe };
    });

    this.gear = 'none';
    this.gearObjs = [];
    this.pose = { ...REST };
    this.ground = true;
    this.expression = 'happy';
    this.setPose(REST);
  }

  buildHair(skull, r) {
    const g = geos(), M = this.mats;
    const hair = this.hair = new THREE.Group();
    skull.add(hair);
    const add = (geo, x, y, z, s = 1) => { const m = new THREE.Mesh(geo, M.hair); m.position.set(x, y, z); m.scale.setScalar(s); m.castShadow = true; hair.add(m); return m; };
    const style = this.style;
    if (style === 'bob') {
      const cap = add(g.hairBob, 0, 0.05, -0.06);
      cap.rotation.x = -0.42;
    } else {
      const cap = add(g.hairCap, 0, 0.02, -0.05);
      cap.rotation.x = -0.32;
    }
    if (style === 'pony') {
      const p = add(g.ponytail, 0, 0.35, -1.45);
      p.rotation.x = -0.75;
    } else if (style === 'buns') {
      add(g.bun, 0.95, 0.85, -0.25); add(g.bun, -0.95, 0.85, -0.25);
    } else if (style === 'curly') {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        add(g.curl, Math.cos(a) * 0.95, 0.75 + Math.sin(i * 1.7) * 0.15, Math.sin(a) * 0.95 - 0.15, 0.95 + r() * 0.25);
      }
    }
  }

  setNumber(n) {
    const g = geos();
    if (this.bib) { this.bib.material.map.dispose(); this.bib.material.dispose(); this.spine.remove(this.bib); }
    const mat = new THREE.MeshStandardMaterial({ map: bibTexture(n, this.paint.trim === '#ffffff' || this.paint.trim === '#FFFFFF' ? this.paint.shorts : this.paint.trim), roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 });
    const m = new THREE.Mesh(g.bib, mat);
    m.position.set(0, 1.05, 1.025);
    m.rotation.x = -0.03;
    this.spine.add(m);
    this.bib = m;
  }

  setExpression(kind) {
    if (kind === this.expression) return;
    this.expression = kind;
    this.face.material = sharedMats()['face_' + kind] || sharedMats().face_happy;
  }

  // 'none' | 'sprint' (headband) | 'ski' (helmet, goggles, craft-stick skis)
  setGear(kind) {
    if (kind === this.gear) return;
    for (const o of this.gearObjs) o.parent.remove(o);
    this.gearObjs = [];
    this.gear = kind;
    const g = geos(), S = sharedMats(), M = this.mats;
    const keep = (o) => { o.castShadow = true; this.gearObjs.push(o); return o; };
    this.hair.visible = true;
    if (kind === 'sprint') {
      const b = keep(new THREE.Mesh(g.band, M.trim));
      b.rotation.x = Math.PI / 2 - 0.22;
      b.position.set(0, 0.42, -0.05);
      this.skull.add(b);
    } else if (kind === 'ski') {
      this.hair.visible = false;
      const h = keep(new THREE.Mesh(g.helmet, M.shirt));
      h.rotation.x = -0.28; h.position.set(0, 0.05, -0.04);
      this.skull.add(h);
      const strap = keep(new THREE.Mesh(g.goggle, S.sole));
      strap.rotation.set(Math.PI / 2 - 0.08, 0, Math.PI / 2 - 0.85 + Math.PI);
      strap.position.y = 0.35;
      this.skull.add(strap);
      const lens = keep(new THREE.Mesh(g.lens, S.lens));
      lens.position.set(0, 0.42, HEAD_R * 1.02);
      lens.rotation.x = -0.12;
      this.skull.add(lens);
      for (const L of this.legs) {
        const s = keep(new THREE.Mesh(g.ski, S.ski));
        s.receiveShadow = true;
        L.ank.add(s);
      }
    }
  }

  // apply a pose (missing keys keep REST values)
  setPose(p) {
    const P = this.pose;
    for (const k in REST) P[k] = p[k] ?? REST[k];
    this.hips.position.y = HIP_Y + P.y;
    this.hips.rotation.set(0, P.twist * 0.5, P.roll * 0.5);
    this.spine.rotation.set(P.lean, P.twist * 0.5, P.roll * 0.5);
    this.head.rotation.set(P.head - P.lean * 0.45, P.headTurn, 0);
    const [aL, aR] = this.arms;
    aL.sh.rotation.set(-P.shL, 0, P.abL); aL.el.rotation.set(-P.elL, 0, 0);
    aR.sh.rotation.set(-P.shR, 0, -P.abR); aR.el.rotation.set(-P.elR, 0, 0);
    const [lL, lR] = this.legs;
    lL.hip.rotation.set(-P.hipL, 0, P.spL); lL.knee.rotation.set(P.kneeL, 0, 0); lL.ank.rotation.set(-P.ankL + P.hipL - P.kneeL, 0, -P.spL);
    lR.hip.rotation.set(-P.hipR, 0, -P.spR); lR.knee.rotation.set(P.kneeR, 0, 0); lR.ank.rotation.set(-P.ankR + P.hipR - P.kneeR, 0, P.spR);
    lL.ank.rotation.y = P.vee; lR.ank.rotation.y = -P.vee;
    // whole-body tilt about the soles (flight, falls)
    this.body.rotation.x = P.pitch;
    if (this.ground) this.groundFeet(); else this.body.position.y = 0;
  }

  // keep the lower foot on the floor (analytic, sagittal plane)
  groundFeet() {
    const P = this.pose;
    const legLow = (hip, knee) => {
      const a1 = hip, a2 = hip - knee; // angles from vertical
      return HIP_DROP + Math.cos(a1) * THIGH + Math.cos(a2) * SHIN + SOLE;
    };
    const lowL = legLow(P.hipL, P.kneeL), lowR = legLow(P.hipR, P.kneeR);
    const reach = Math.max(lowL, lowR) * Math.cos(P.roll * 0.5);
    // sole of the lower foot at y = 0 (the pose's own y only matters when grounding is off)
    this.body.position.y = reach - HIP_Y - P.y;
  }

  dispose() {
    for (const m of Object.values(this.mats)) m.dispose();
    if (this.bib) { this.bib.material.map.dispose(); this.bib.material.dispose(); }
    this.root.parent?.remove(this.root);
  }
}

// ---------- poses ----------
export function blendPose(a, b, t) {
  const o = {};
  for (const k in REST) o[k] = lerp(a[k] ?? REST[k], b[k] ?? REST[k], t);
  return o;
}

export const POSES = {
  stand(t = 0) {
    const s = Math.sin(t * 1.7);
    return { ...REST, y: 0.03 * s, lean: 0.02, head: 0.05 * Math.sin(t * 0.9), abL: 0.1 + 0.02 * s, abR: 0.1 - 0.02 * s, elL: 0.2, elR: 0.2 };
  },
  // bouncy warm-up on the spot
  bounce(t = 0) {
    const s = Math.abs(Math.sin(t * 6));
    return { ...REST, y: 0.25 * s - 0.15, kneeL: 0.25 * (1 - s), kneeR: 0.25 * (1 - s), hipL: 0.12 * (1 - s), hipR: 0.12 * (1 - s), elL: 1.2, elR: 1.2, shL: 0.3, shR: 0.3, abL: 0.2, abR: 0.2, lean: 0.08 };
  },
  // phase 0..1 = two strides; effort 0..1 scales the stride and arm drive
  run(phase, effort = 1) {
    const a = phase * TAU, s = Math.sin(a), c = Math.cos(a);
    const E = clamp(effort, 0, 1.2);
    const swing = 0.25 + 0.55 * E;
    // knee bends most while the leg swings forward (recovery) and a little on landing
    const kneeOf = (ph) => 0.25 + (0.6 + 0.9 * E) * Math.max(0, Math.sin(ph + 0.7)) ** 1.4;
    return {
      ...REST,
      y: -0.25 + 0.32 * Math.abs(c) * E - 0.12 * E,
      lean: 0.12 + 0.22 * E,
      twist: 0.12 * s * E,
      head: 0.1 * E,
      hipL: swing * s, hipR: -swing * s,
      kneeL: kneeOf(a), kneeR: kneeOf(a + Math.PI),
      ankL: 0.15 * c, ankR: -0.15 * c,
      shL: -swing * 1.2 * s, shR: swing * 1.2 * s,
      elL: 1.45, elR: 1.45, abL: 0.12, abR: 0.12,
    };
  },
  // sprint start: "set" position, crouched with hands near the line
  crouch(set = 0) {
    return {
      ...REST,
      y: -1.6 + 0.6 * set, lean: 1.15 - 0.15 * set, head: -0.35,
      hipL: 1.25 + 0.15 * set, kneeL: 2.0 - 0.4 * set, hipR: 0.35 + 0.2 * set, kneeR: 1.4 - 0.4 * set,
      ankL: 0.4, ankR: 0.5,
      shL: 1.35, shR: 1.35, abL: 0.18, abR: 0.18, elL: 0.05, elR: 0.05,
    };
  },
  // ski in-run tuck; wobble -1..1 rolls the body
  tuck(wobble = 0) {
    return {
      ...REST,
      y: -1.3, lean: 1.05, head: -0.5, roll: wobble * 0.35,
      hipL: 1.35, hipR: 1.35, kneeL: 1.95, kneeR: 1.95, ankL: 0.25, ankR: 0.25,
      shL: -0.35, shR: -0.35, elL: 0.2, elR: 0.2, abL: 0.06, abR: 0.06,
      spL: 0.04, spR: 0.04,
    };
  },
  // flight: the whole body tilted forward over the skis (pitch); lean 0..1 = how far over, wobble rolls it.
  // The event rotates the root to follow the flight path; skis stay roughly level in this pose.
  flight(lean = 0.6, wobble = 0) {
    const p = 0.7 + 0.45 * lean;
    return {
      ...REST,
      pitch: p, lean: 0.12, head: 0.75, roll: wobble * 0.3,
      hipL: 0.05, hipR: 0.05, kneeL: 0.08, kneeR: 0.08, ankL: p + 0.12, ankR: p + 0.12, vee: 0.32,
      shL: -0.35, shR: -0.35, abL: 0.38, abR: 0.38, elL: 0.06, elR: 0.06, spL: 0.1, spR: 0.1,
    };
  },
  // telemark landing: one foot forward, knees bent, arms out
  telemark(k = 1) {
    return {
      ...REST,
      y: -0.9 * k, lean: 0.25,
      hipL: 0.55 * k, kneeL: 0.9 * k, hipR: -0.15 * k, kneeR: 1.25 * k, ankL: 0.0, ankR: -0.35 * k,
      shL: 0.35, shR: 0.35, abL: 1.05 * k, abR: 1.05 * k, elL: 0.25, elR: 0.25,
    };
  },
  // both arms up, little hops
  cheer(t = 0) {
    const s = Math.abs(Math.sin(t * 7));
    return { ...REST, y: 0.5 * s, shL: 2.7 + 0.2 * Math.sin(t * 7), shR: 2.7 - 0.2 * Math.sin(t * 7), abL: 0.35, abR: 0.35, elL: 0.25, elR: 0.25, head: -0.25, kneeL: 0.2 * (1 - s), kneeR: 0.2 * (1 - s), hipL: 0.1 * (1 - s), hipR: 0.1 * (1 - s) };
  },
  wave(t = 0) {
    return { ...REST, shL: 2.6, abL: 0.6, elL: 0.6 + 0.45 * Math.sin(t * 9), shR: 0.05, elR: 0.25, head: -0.1, headTurn: 0.15 };
  },
  // sitting on the floor in a heap (after a fall)
  heap() {
    return { ...REST, y: -2.9, lean: -0.35, head: 0.3, hipL: 1.45, hipR: 1.25, kneeL: 0.25, kneeR: 0.5, shL: 0.6, shR: -0.4, abL: 0.6, abR: 0.8, elL: 0.6, elR: 0.3 };
  },
  // walking: phase 0..1 = two steps
  walk(phase) {
    const a = phase * TAU, s = Math.sin(a);
    return { ...REST, y: -0.05 + 0.08 * Math.abs(Math.cos(a)), lean: 0.04, hipL: 0.38 * s, hipR: -0.38 * s, kneeL: 0.1 + 0.55 * Math.max(0, Math.sin(a + 0.9)), kneeR: 0.1 + 0.55 * Math.max(0, Math.sin(a + 0.9 + Math.PI)), shL: -0.35 * s, shR: 0.35 * s, elL: 0.3, elR: 0.3, abL: 0.1, abR: 0.1 };
  },
};
