// Bobsled track and sled physics, free of three.js so they can be tuned with node.
// The track is a run of poster tubes cut in half lengthways, laid from the top of the toy chest down
// to the floor on stacks of books. Units are cm and toy seconds.
//
// A sled is { s, v, phi }: distance along the track, speed and angle up the tube wall (0 = the bottom,
// + = the right-hand wall). In a bend the sled rides up the outside wall; the fast line is where
// centrifugal push and gravity balance. Riding off it and steering scrub speed; the lip brakes hard.

export const RT = 6.2;             // tube radius
export const G = 30;
export const PUSH = 30;            // the push zone at the top: run behind the sled, then jump in
export const PHYS = { cf: 0.42, mu: 0.012, drag: 0.00035, off: 1.6, steerCost: 0.01, steer: 0.9, pull: 1.8, high: 1.55, lip: 1.3, scrape: 1.2 };
export const DS = 0.5;

// the course: [kind, length or angle (deg, + = left), radius, drop]
const COURSE = [
  ['s', 44, 0, 1.2],
  ['t', 110, 34, 4.5],
  ['s', 36, 0, 4.5],
  ['t', -95, 30, 4],
  ['s', 26, 0, 3],
  ['t', 175, 26, 6],
  ['s', 44, 0, 5],
  ['t', -55, 40, 2.5],
  ['t', 55, 40, 2.5],
  ['s', 20, 0, 2],
  ['t', -190, 25, 5],
  ['s', 50, 0, 3],
  ['t', 100, 32, 3.5],
  ['s', 30, 0, 2.5],
  ['t', -120, 30, 4],
  ['s', 30, 0, 2.5],
  ['t', 70, 40, 2.5],
  ['s', 64, 0, 2.5],
  ['s', 46, 0, -2.2],
];

export function buildTrack() {
  // walk the course: heading h (0 = +x, + turns left = towards -z), curvature eased in and out
  const raw = [];
  let x = 0, z = 0, h = 0, y = 0;
  const segs = [];
  for (const [kind, a, r, drop] of COURSE) {
    const len = kind === 's' ? a : (Math.abs(a) * Math.PI / 180) * r;
    segs.push({ kind, len, k: kind === 's' ? 0 : Math.sign(a) / r, drop });
  }
  let finishS = 0;
  const n = segs.length;
  segs.forEach((sg, si) => {
    const steps = Math.round(sg.len / DS);
    for (let k = 0; k < steps; k++) {
      // ease curvature over the first and last 8 units of a bend
      const u = k * DS;
      const ease = sg.k ? Math.min(1, (u + 0.5) / 8, (sg.len - u) / 8) : 0;
      const kk = sg.k * Math.max(0.15, ease) * (sg.k ? 1 : 0);
      raw.push({ x, y, z, h, k: kk });
      h += kk * DS;
      x += Math.cos(h) * DS; z -= Math.sin(h) * DS;
      y -= (sg.drop / sg.len) * DS;
    }
    if (si === n - 2) finishS = raw.length * DS;
  });
  raw.push({ x, y, z, h, k: 0 });
  // smooth the height so slopes change gently, then lift the whole run so its end sits on the floor
  const ys = raw.map((p) => p.y);
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < ys.length - 1; i++) ys[i] = (ys[i - 1] + ys[i] * 2 + ys[i + 1]) / 4;
  const minY = Math.min(...ys);
  raw.forEach((p, i) => { p.y = ys[i] - minY + RT + 1.5; });
  const len = (raw.length - 1) * DS;
  const at = (s) => {
    const f = Math.max(0, Math.min(raw.length - 1.001, s / DS)), i = Math.floor(f), t = f - i;
    const a = raw[i], b = raw[i + 1];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, h: a.h + (b.h - a.h) * t, k: a.k + (b.k - a.k) * t };
  };
  const slope = (s) => (at(s + 1).y - at(s - 1).y) / 2;
  return { pts: raw, len, finishS, at, slope };
}

// the wall angle where centrifugal push and gravity balance
export function phiStar(track, s, v) { return Math.atan2(PHYS.cf * v * v * track.at(s).k, G); }

// one physics step. steer -1..1 (+ = up the right wall). Left alone, a sled rides too high in a bend
// (it swings up past the line) and can hit the lip; steering moves it at a steady rate, against a pull
// back to where it wants to ride.
export function stepSled(track, sl, dt, steer) {
  const P = PHYS, p = track.at(sl.s);
  const sinA = track.slope(sl.s);
  const ac = P.cf * sl.v * sl.v * p.k;
  const star = Math.atan2(ac, G);
  const nat = star * P.high + (sl.wob || 0);
  const prev = sl.phi;
  sl.phi += ((nat - sl.phi) * P.pull + steer * P.steer) * dt;
  sl.w = (sl.phi - prev) / dt;
  let scrape = 0;
  if (Math.abs(sl.phi) > P.lip) { sl.phi = Math.sign(sl.phi) * P.lip; scrape = 1; }
  const off = sl.phi - star;
  const a = -G * sinA - P.mu * G - P.drag * sl.v * sl.v
    - sl.v * (P.off * Math.min(off * off, 0.3) + P.steerCost * Math.abs(steer)) - scrape * sl.v * P.scrape;
  sl.v = Math.max(3, sl.v + a * dt);
  sl.s += sl.v * dt;
  sl.star = star; sl.scrape = scrape; sl.off = off;
  return sl;
}

// a steady pair of hands on the steering: aim at the line, damp the swing
export function autoSteer(sl, dead = 0.08) {
  const err = (sl.star ?? 0) - sl.phi;
  return Math.abs(err) < dead ? 0 : Math.sign(err);
}
