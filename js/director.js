// The camera director: takes the camera away from the event for a while. A fly-in sweeps through the
// room before an event starts and settles on the event's own opening view; the medal ceremony circles a
// podium set up at the best spot in the room. The event keeps animating underneath and keeps asking for
// its own camera every frame; the director reads that request, and blends into it at the end of a fly-in.
import * as THREE from '../vendor/three.bundle.js';
import { Figurine, POSES } from './figurine.js';
import { Particles } from './fx.js';
import { podium } from './venues.js';
import { clamp } from './util.js';

const smooth = (u) => u * u * (3 - 2 * u);
const lerp = (a, b, u) => a + (b - a) * u;
// orbit parameters to a camera position and target, the same way the renderer's orbit() does
function poseFromOrbit(R, k, pos, tgt) {
  const d = R.distanceForWidth(k.width);
  const cp = Math.cos(k.pitch);
  tgt.set(k.x, k.y, k.z);
  pos.set(k.x + d * cp * Math.sin(k.yaw), k.y + d * Math.sin(k.pitch), k.z + d * cp * Math.cos(k.yaw));
}
// Catmull-Rom through a list of numbers at parameter u (0..1 across the whole list)
function spline(vals, u) {
  const n = vals.length - 1, f = clamp(u, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
  const p0 = vals[Math.max(0, i - 1)], p1 = vals[i], p2 = vals[i + 1], p3 = vals[Math.min(n, i + 2)];
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// A flight through keyframes (orbit parameters), ending in a blend onto the event's own camera.
export class FlyIn {
  constructor(keys, { dur = 6, blend = 1.4 } = {}) {
    this.keys = keys; this.dur = dur; this.blend = blend; this.t = 0;
    this.pos = new THREE.Vector3(); this.tgt = new THREE.Vector3(); this.p2 = new THREE.Vector3(); this.t2 = new THREE.Vector3();
  }
  get done() { return this.t >= this.dur; }
  apply(R, dt) {
    this.t += dt;
    const fly = this.dur - this.blend, u = clamp(this.t / fly, 0, 1), e = smooth(u);
    const k = {};
    for (const key of ['x', 'y', 'z', 'yaw', 'pitch', 'width']) k[key] = spline(this.keys.map((q) => q[key]), e);
    poseFromOrbit(R, k, this.pos, this.tgt);
    // the event has just placed the camera where it wants it: blend onto that at the end
    const b = smooth(clamp((this.t - fly) / this.blend, 0, 1));
    if (b > 0) { this.pos.lerp(R.camera.position, b); this.tgt.lerp(R.target, b); }
    R.look(this.pos.x, this.pos.y, this.pos.z, this.tgt.x, this.tgt.y, this.tgt.z, Math.max(220, k.width * 1.6));
    R.setFocus(0.5, lerp(0.42, 0.26, b), lerp(0.55, 0.85, b));
  }
}

// The medal ceremony: a podium in the room, the three medallists on it with chocolate-coin medals,
// confetti, and the camera slowly circling.
export class Ceremony {
  // spot: { x, y, z, ry, style, gear, yaw, pitch, width, bob }; medallists: [{ c, place, medal }]
  constructor(kit, R, spot, medallists) {
    this.kit = kit; this.R = R; this.spot = spot; this.t = 0;
    this.group = new THREE.Group();
    this.group.position.set(spot.x, spot.y || 0, spot.z);
    this.group.rotation.y = spot.ry || 0;
    this.group.scale.setScalar(spot.scale || 1);
    kit.group.add(this.group);
    // everyone else steps off stage: the event's own figures are hidden for the ceremony
    kit.group.traverse((o) => { if (o.userData.fig) o.visible = false; });
    this.clearView(kit, R, spot);
    const pod = podium(kit, spot.style || 'blocks');
    this.group.add(pod.group);
    this.pod = pod;
    const MED = { gold: 0xf2c230, silver: 0xd9dde3, bronze: 0xcd7f45 };
    this.figs = medallists.map((m) => {
      const fig = new Figurine({ paint: m.c.paint, seed: m.c.seed, number: m.c.number });
      fig.setGear(spot.gear || 'none');
      fig.root.userData.ceremony = true;
      const slot = m.slot ?? m.place, top = pod.tops[slot];
      fig.root.position.set(top.x, top.y, top.z);
      fig.root.rotation.y = (spot.yaw ?? 0.3) * 0.7;   // turned towards the camera
      fig.setExpression(m.place === 0 ? 'wow' : 'happy');
      // a chocolate coin in foil on a ribbon in the team colour
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.16, 24).rotateX(Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: MED[m.medal] || MED.gold, metalness: 0.6, roughness: 0.28, clearcoat: 1, emissive: MED[m.medal] || MED.gold, emissiveIntensity: 0.22 }));
      coin.position.set(0, 0.62, 1.22); fig.spine.add(coin);
      const rib = new THREE.MeshStandardMaterial({ color: m.c.paint.shirt === '#ffffff' ? m.c.paint.shorts : m.c.paint.trim, roughness: 0.7 });
      for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.06), rib); r.position.set(s * 0.3, 1.12, 1.16); r.rotation.z = s * 0.4; fig.spine.add(r); }
      this.group.add(fig.root);
      return { fig, place: m.place, slot, ph: Math.random() * 6 };
    });
    this.particles = new Particles(kit.group, 600);
    this.particles.setScale(R.renderer.domElement.height * 0.9);
    this.pos = new THREE.Vector3(); this.tgt = new THREE.Vector3();
  }
  // crowd members standing on the podium's spot or between it and the camera's arc are cleared away
  // (the crowd behind and beside it stays as the backdrop)
  clearView(kit, R, s) {
    const sc = s.scale || 1, yaw0 = (s.ry || 0) + (s.yaw ?? 0.3);
    const dCam = R.distanceForWidth(s.width ?? 40) * Math.cos(s.pitch ?? 0.2);
    const v = new THREE.Vector3();
    // seen from the camera anywhere on its arc, does the member cover part of the podium and medallists?
    const cams = [-0.45, 0, 0.45].map((d) => [s.x + dCam * Math.sin(yaw0 + d), s.z + dCam * Math.cos(yaw0 + d)]);
    const inWay = (x, z, size) => {
      const r = size * 0.5;
      if (Math.hypot(x - s.x, z - s.z) < 12 * sc + r) return true;
      return cams.some(([cx, cz]) => {
        const px = s.x - cx, pz = s.z - cz, mx = x - cx, mz = z - cz;
        const dp = Math.hypot(px, pz), dm = Math.hypot(mx, mz);
        if (dm > dp - 4 * sc) return false;      // behind or beside the podium: part of the backdrop
        const th = Math.acos(Math.min(1, (px * mx + pz * mz) / (dp * dm)));
        return th < Math.atan((13 * sc) / dp) + Math.atan(r / dm);
      });
    };
    kit.group.updateMatrixWorld(true);
    kit.group.traverse((o) => {
      const cr = o.userData.crowd;
      if (cr && !cr.cleared) {
        cr.cleared = true;
        for (const sp of cr.spots) { v.set(sp.x, sp.y || 0, sp.z); o.parent.localToWorld(v); if (inWay(v.x, v.z, sp.size || 10)) sp.hidden = true; }
      }
      const m = o.userData.crowdMember;
      if (m) { o.getWorldPosition(v); if (inWay(v.x, v.z, m.size)) o.visible = false; }
    });
  }

  update(dt) {
    this.t += dt;
    const t = this.t, s = this.spot;
    if (s.bob) this.group.position.y = (s.y || 0) + Math.sin(t * 1.6) * 0.5;
    if (s.bob) this.group.rotation.z = Math.sin(t * 1.1) * 0.03;
    for (const f of this.figs) {
      const hop = f.place === 0 ? Math.max(0, Math.sin(t * 5 + f.ph)) * 0.9 : 0;
      f.fig.root.position.y = this.pod.tops[f.slot].y + hop;
      f.fig.setPose(f.place === 0 ? POSES.cheer(t + f.ph) : POSES.wave(t + f.ph));
    }
    // confetti from above, in party colours, a burst at the start and a steady drift after
    const n = t < 0.4 ? 14 : 2;
    const sc = this.spot.scale || 1, wx = this.group.position.x, wy = this.group.position.y, wz = this.group.position.z;
    for (let k = 0; k < n; k++) {
      const col = [0xe23b2e, 0xf2c230, 0x2f6fe0, 0x2fae5a, 0xd84f9a, 0xffffff][(Math.random() * 6) | 0];
      this.particles.emit(wx + (Math.random() - 0.5) * 24 * sc, wy + 22 * sc, wz + (Math.random() - 0.5) * 16 * sc, { vy: -2, spread: 3, up: 1, color: col, size: 0.9 * sc, life: 3.5, alpha: 0.95, grav: 2.2, grow: 1 });
    }
    this.particles.update(dt);
  }
  apply(R, dt) {
    this.update(dt);
    const s = this.spot, sc = s.scale || 1;
    const yaw = (s.yaw ?? 0.3) + Math.sin(this.t * 0.35) * 0.45;
    const k = { x: this.group.position.x, y: this.group.position.y + 7.5 * sc, z: this.group.position.z, yaw: (s.ry || 0) + yaw, pitch: s.pitch ?? 0.2, width: (s.width ?? 40) * (1.12 - 0.12 * smooth(clamp(this.t / 3, 0, 1))) };
    poseFromOrbit(R, k, this.pos, this.tgt);
    R.look(this.pos.x, this.pos.y, this.pos.z, this.tgt.x, this.tgt.y, this.tgt.z, Math.max(160, k.width * 2));
    R.setFocus(0.5, 0.34, 0.75);
  }
  dispose() {
    for (const f of this.figs) f.fig.dispose();
    this.kit.group.remove(this.group);
  }
}
