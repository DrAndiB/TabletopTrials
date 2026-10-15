// Tune the ski jump physics without a browser: node _dev/tools/checks/skijump_sim.mjs
import * as S from '../../../js/events/skijump-physics.js';

const DT = 1 / 120;
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// a jumper: releaseAt = units before the edge (null = never), inrunSkill/leanSkill 0..1
function jump({ releaseAt = 1.5, inrunSkill = 1, leanSkill = 1, round = 1, seed = 1 }) {
  const r = rng(seed);
  const st = { s: S.START_S, v: 0, wobble: 0, wv: 0, stood: false };
  let t = 0, wobbleSum = 0, n = 0;
  while (st.s < S.INRUN_LEN) {
    const d = S.INRUN_LEN - st.s;
    const tuck = releaseAt == null ? true : d > releaseAt;
    if (!tuck && d > 15) st.stood = true;
    const steer = Math.abs(st.wobble) > 0.12 * (2 - inrunSkill) ? -Math.sign(st.wobble) * inrunSkill : 0;
    S.stepInrun(st, DT, { steer, tuck: tuck || st.stood }, gauss(r));
    wobbleSum += Math.abs(st.wobble); n++; t += DT;
    if (!tuck && !st.stood) break;
  }
  const inrunT = t;
  const p = S.inrunAt(Math.min(st.s, S.INRUN_LEN));
  const q = S.popQuality(releaseAt);
  const f = { x: p.x, y: p.y, vx: st.v * Math.cos(p.ang), vy: st.v * Math.sin(p.ang) + S.TAKEOFF.pop * q, lean: 0, lv: 0, t: 0 };
  let leanSum = 0, m = 0;
  while (f.y > S.hillY(f.x) + 0.2 && f.t < 8) {
    const g = S.gustAt(f.t, round);
    const steer = Math.abs(f.lean) > 0.1 * (2 - leanSkill) ? -Math.sign(f.lean) * leanSkill : 0;
    S.stepFlight(f, DT * S.FLIGHT.timeScale, { steer }, g, gauss(r));
    leanSum += Math.abs(f.lean); m++;
  }
  const slope = S.hillSlope(f.x);
  const vn = Math.abs((f.vy - slope * f.vx) / Math.hypot(1, slope));
  return { vEdge: +st.v.toFixed(1), inrunT: +inrunT.toFixed(2), flightT: +(f.t / S.FLIGHT.timeScale).toFixed(2), x: +f.x.toFixed(1), m: S.roundHalf(S.metresAt(f.x)), wob: +(wobbleSum / n).toFixed(2), lean: +(leanSum / Math.max(1, m)).toFixed(2), impact: +vn.toFixed(1), q };
}

console.log('K-point x', S.K_X, 'metres/unit', S.M_PER_UNIT.toFixed(3), 'HS 100 m at x', S.xAtMetres(100).toFixed(1), '120 m at x', S.xAtMetres(120).toFixed(1));
const cases = [
  ['perfect', { releaseAt: 1.5, inrunSkill: 1, leanSkill: 1 }],
  ['good', { releaseAt: 3.5, inrunSkill: 0.85, leanSkill: 0.85 }],
  ['ok', { releaseAt: 6, inrunSkill: 0.7, leanSkill: 0.7 }],
  ['early 10', { releaseAt: 10, inrunSkill: 0.7, leanSkill: 0.7 }],
  ['early 20', { releaseAt: 20, inrunSkill: 0.7, leanSkill: 0.7 }],
  ['never released', { releaseAt: null, inrunSkill: 0.7, leanSkill: 0.7 }],
  ['no lean control', { releaseAt: 2, inrunSkill: 0.9, leanSkill: 0 }],
  ['no balance', { releaseAt: 2, inrunSkill: 0, leanSkill: 0.9 }],
];
for (const [name, c] of cases) for (const round of [1, 2]) console.log(name.padEnd(16), 'round', round, JSON.stringify(jump({ ...c, round, seed: 3 + round })));
