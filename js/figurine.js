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
    belt: new THREE.CylinderGeometry(0.97, 0.92, 0.16, 28, 1, true),
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
    blade: new RoundedBoxGeometry(0.12, 0.42, 3.1, 1, 0.05).translate(0, -SOLE - 0.24, 0.45),
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

// one material for every figurine: colours come from the vertices (one draw call per figurine)
const shared = {};
function sharedMats() {
  if (shared.body) return shared;
  shared.body = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.44, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.24 });
  for (const k of ['happy', 'focus', 'wow', 'sad']) {
    shared['face_' + k] = new THREE.MeshStandardMaterial({ map: faceTexture(k), transparent: true, alphaTest: 0.02, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
  }
  return shared;
}
const WOOD = '#e2c497', SHOE = '#f6f2ea', SOLE_C = '#2b2420', LENS = '#ff9a2a', SKI = '#ecd09f', STRAP = '#2b2420';

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

// bones, in the order of the skin indices
const BONES = ['hips', 'spine', 'head', 'skull', 'shL', 'elL', 'shR', 'elR', 'hipL', 'kneeL', 'ankL', 'hipR', 'kneeR', 'ankR'];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));

// ---------- the figurine ----------
export class Figurine {
  // paint: {shirt, shorts, trim} colours; seed picks skin tone, hair and style (or pass skin/hair/style)
  constructor({ paint = { shirt: '#e23b2e', shorts: '#1f1a17', trim: '#ffffff' }, seed = 1, number = null, skin, hair, style } = {}) {
    const S = sharedMats();
    const r = rng(seed * 7919 + 13);
    this.skinColor = skin || r.pick(SKIN_TONES);
    this.hairColor = hair || r.pick(HAIR_COLORS);
    this.style = style || r.pick(HAIR_STYLES);
    this.paint = paint;
    this.curlR = Array.from({ length: 9 }, () => r());

    this.root = new THREE.Group();   // placed by the event (feet reference, facing)
    this.root.userData.fig = true;
    this.body = new THREE.Group();   // grounding offset and whole-body pitch
    this.root.add(this.body);
    // skeleton
    const bones = this.bones = BONES.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
    const at = (name, parent, x, y, z) => { bones[B[name]].position.set(x, y, z); (parent ? bones[B[parent]] : this.body).add(bones[B[name]]); };
    at('hips', null, 0, HIP_Y, 0);
    at('spine', 'hips', 0, 0.1, 0);
    at('head', 'spine', 0, NECK + 0.1, 0);
    at('skull', 'head', 0, HEAD_R * 0.92, 0);
    at('shL', 'spine', SH_X, SH_Y, 0); at('elL', 'shL', 0, -UPPER, 0);
    at('shR', 'spine', -SH_X, SH_Y, 0); at('elR', 'shR', 0, -UPPER, 0);
    at('hipL', 'hips', HIP_X, -HIP_DROP, 0); at('kneeL', 'hipL', 0, -THIGH, 0); at('ankL', 'kneeL', 0, -SHIN, 0);
    at('hipR', 'hips', -HIP_X, -HIP_DROP, 0); at('kneeR', 'hipR', 0, -THIGH, 0); at('ankR', 'kneeR', 0, -SHIN, 0);
    this.root.updateMatrixWorld(true);
    this.bind = bones.map((b) => b.matrixWorld.clone());
    this.skeleton = new THREE.Skeleton(bones);
    this.hips = bones[B.hips]; this.spine = bones[B.spine]; this.head = bones[B.head]; this.skull = bones[B.skull];
    this.arms = [{ sh: bones[B.shL], el: bones[B.elL] }, { sh: bones[B.shR], el: bones[B.elR] }];
    this.legs = [{ hip: bones[B.hipL], knee: bones[B.kneeL], ank: bones[B.ankL] }, { hip: bones[B.hipR], knee: bones[B.kneeR], ank: bones[B.ankR] }];

    this.face = new THREE.Mesh(geos().face, S.face_happy);
    this.skull.add(this.face);
    this.bib = null;
    if (number != null) this.setNumber(number);

    this.gear = null;
    this.mesh = null;
    this.setGear('none');
    this.pose = { ...REST };
    this.ground = true;
    this.expression = 'happy';
    this.setPose(REST);
  }

  // parts of the body in bind pose: [geometry, colour, bone, position, rotation, scale]
  parts() {
    const g = geos(), P = this.paint, sk = this.skinColor, hc = this.hairColor;
    const list = [
      [g.pelvis, P.shorts, 'hips'],
      [g.torso, P.shirt, 'spine'],
      [g.belt, P.trim, 'spine', [0, 0.12, 0]],
      [g.neck, sk, 'spine', [0, NECK - 0.02, 0]],
      [g.head, sk, 'skull'],
    ];
    for (const s of ['L', 'R']) {
      list.push([g.bead, P.shirt, 'sh' + s, null, null, 0.92], [g.upper, P.shirt, 'sh' + s], [g.fore, sk, 'el' + s], [g.hand, sk, 'el' + s, [0, -FORE - 0.05, 0]]);
      list.push([g.thigh, P.shorts, 'hip' + s, null, null, [1, 0.42, 1]], [g.thigh, sk, 'hip' + s, [0, -THIGH * 0.42, 0], null, [0.93, 0.58, 0.93]]);
      list.push([g.bead, WOOD, 'knee' + s, null, null, 0.92], [g.shin, sk, 'knee' + s], [g.sock, P.trim, 'knee' + s, [0, -SHIN + 0.35, 0]]);
      list.push([g.foot, SHOE, 'ank' + s], [g.foot, SOLE_C, 'ank' + s, [0, -0.06, 0], null, [1.02, 0.25, 1.02]]);
    }
    // hair (hidden under a helmet or a swim cap)
    if (!['ski', 'swim', 'helmet', 'skate'].includes(this.gear)) {
      const st = this.style;
      if (st === 'bob') list.push([g.hairBob, hc, 'skull', [0, 0.05, -0.06], [-0.42, 0, 0]]);
      else list.push([g.hairCap, hc, 'skull', [0, 0.02, -0.05], [-0.32, 0, 0]]);
      if (st === 'pony') list.push([g.ponytail, hc, 'skull', [0, 0.35, -1.45], [-0.75, 0, 0]]);
      else if (st === 'buns') list.push([g.bun, hc, 'skull', [0.95, 0.85, -0.25]], [g.bun, hc, 'skull', [-0.95, 0.85, -0.25]]);
      else if (st === 'curly') {
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU;
          list.push([g.curl, hc, 'skull', [Math.cos(a) * 0.95, 0.75 + Math.sin(i * 1.7) * 0.15, Math.sin(a) * 0.95 - 0.15], null, 0.95 + this.curlR[i] * 0.25]);
        }
      }
    }
    if (this.gear === 'sprint') {
      list.push([g.band, P.trim, 'skull', [0, 0.42, -0.05], [Math.PI / 2 - 0.22, 0, 0]]);
    } else if (this.gear === 'ski') {
      list.push([g.helmet, P.shirt, 'skull', [0, 0.05, -0.04], [-0.28, 0, 0]]);
      list.push([g.goggle, STRAP, 'skull', [0, 0.35, 0], [Math.PI / 2 - 0.08, 0, Math.PI / 2 - 0.85 + Math.PI]]);
      list.push([g.lens, LENS, 'skull', [0, 0.42, HEAD_R * 1.02], [-0.12, 0, 0]]);
      list.push([g.ski, SKI, 'ankL'], [g.ski, SKI, 'ankR']);
    } else if (this.gear === 'swim') {
      // a swim cap in the shirt colour, and goggles
      list.push([g.helmet, P.shirt, 'skull', [0, 0.02, -0.04], [-0.28, 0, 0], 0.95]);
      list.push([g.goggle, STRAP, 'skull', [0, 0.32, 0], [Math.PI / 2 - 0.08, 0, Math.PI / 2 - 0.85 + Math.PI], 0.97]);
      list.push([g.lens, LENS, 'skull', [0, 0.4, HEAD_R * 1.0], [-0.12, 0, 0], [0.9, 0.8, 1]]);
    } else if (this.gear === 'helmet' || this.gear === 'skate') {
      list.push([g.helmet, P.shirt, 'skull', [0, 0.05, -0.04], [-0.28, 0, 0]]);
      list.push([g.goggle, STRAP, 'skull', [0, 0.35, 0], [Math.PI / 2 - 0.08, 0, Math.PI / 2 - 0.85 + Math.PI]]);
      list.push([g.lens, LENS, 'skull', [0, 0.42, HEAD_R * 1.02], [-0.12, 0, 0]]);
      if (this.gear === 'skate') list.push([g.blade, 0xd8dade, 'ankL'], [g.blade, 0xd8dade, 'ankR']);
    }
    return list;
  }

  // (re)build the skinned body for the current gear
  buildMesh() {
    if (this.mesh) { this.body.remove(this.mesh); this.mesh.geometry.dispose(); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const geos = this.parts().map(([geo, color, bone, p, rot, s]) => {
      const gg = geo.index ? geo.toNonIndexed() : geo.clone();
      pos.set(...(p || [0, 0, 0]));
      q.setFromEuler(e.set(...(rot || [0, 0, 0])));
      if (Array.isArray(s)) sc.set(...s); else sc.setScalar(s ?? 1);
      m4.compose(pos, q, sc).premultiply(this.bind[B[bone]]);
      gg.applyMatrix4(m4);
      gg.userData = { color, bone: B[bone] };
      return gg;
    });
    let n = 0;
    for (const gg of geos) n += gg.attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
    const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
    const col = new THREE.Color();
    let o = 0;
    for (const gg of geos) {
      const k = gg.attributes.position.count;
      P.set(gg.attributes.position.array, o * 3);
      N.set(gg.attributes.normal.array, o * 3);
      col.set(gg.userData.color);
      for (let i = 0; i < k; i++) {
        C[(o + i) * 3] = col.r; C[(o + i) * 3 + 1] = col.g; C[(o + i) * 3 + 2] = col.b;
        SI[(o + i) * 4] = gg.userData.bone; SW[(o + i) * 4] = 1;
      }
      o += k;
      gg.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    const mesh = new THREE.SkinnedMesh(geo, sharedMats().body);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.body.add(mesh);
    // geometry is already in the body's space: bind with an identity bind matrix
    mesh.bind(this.skeleton, new THREE.Matrix4());
    this.mesh = mesh;
  }

  setNumber(n) {
    const g = geos();
    if (this.bib) { this.bib.material.map.dispose(); this.bib.material.dispose(); this.spine.remove(this.bib); }
    const light = (c) => { const k = new THREE.Color(c); return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b > 0.8; };
    const border = light(this.paint.trim) ? (light(this.paint.shorts) ? this.paint.shirt : this.paint.shorts) : this.paint.trim;
    const mat = new THREE.MeshStandardMaterial({ map: bibTexture(n, border), roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 });
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

  // 'none' | 'sprint' (headband) | 'ski' (helmet, goggles, craft-stick skis) | 'swim' (cap, goggles)
  // | 'helmet' (helmet, goggles) | 'skate' (helmet, goggles, blades)
  setGear(kind) {
    if (kind === this.gear) return;
    this.gear = kind;
    this.buildMesh();
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
    lL.hip.rotation.set(-P.hipL, 0, P.spL); lL.knee.rotation.set(P.kneeL, 0, 0); lL.ank.rotation.set(-P.ankL + P.hipL - P.kneeL, P.vee, -P.spL);
    lR.hip.rotation.set(-P.hipR, 0, -P.spR); lR.knee.rotation.set(P.kneeR, 0, 0); lR.ank.rotation.set(-P.ankR + P.hipR - P.kneeR, -P.vee, P.spR);
    // whole-body tilt about the soles (flight, falls)
    this.body.rotation.x = P.pitch;
    if (this.ground) this.groundFeet(); else this.body.position.y = 0;
  }

  // keep the lower foot on the floor (analytic, sagittal plane)
  groundFeet() {
    const P = this.pose;
    const legLow = (hip, knee) => HIP_DROP + Math.cos(hip) * THIGH + Math.cos(hip - knee) * SHIN + SOLE;
    const reach = Math.max(legLow(P.hipL, P.kneeL), legLow(P.hipR, P.kneeR)) * Math.cos(P.roll * 0.5);
    // sole of the lower foot at y = 0 (the pose's own y only matters when grounding is off)
    this.body.position.y = reach - HIP_Y - P.y;
  }

  dispose() {
    if (this.mesh) this.mesh.geometry.dispose();
    if (this.bib) { this.bib.material.map.dispose(); this.bib.material.dispose(); }
    this.skeleton.dispose();
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
      hipL: 1.35, hipR: 1.35, kneeL: 1.95, kneeR: 1.95, ankL: 0, ankR: 0,
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
