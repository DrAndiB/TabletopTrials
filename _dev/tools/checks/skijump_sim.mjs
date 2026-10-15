// Tune the ski jump physics without a browser: node _dev/tools/checks/skijump_sim.mjs
import * as S from '../../../js/events/skijump-physics.js';

const DT = 1 / 120;
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// a jumper: tapAt = units before the edge (null = never); balance/lean: { thr, look, push } or null
// (look = seconds between corrections, thr = drift tolerated, push = how hard)
function jump({ tapAt = 3, balance, lean, warn = false, round = 1, seed = 1 }) {
  const r = rng(seed), gr = rng(1000 + round);
  const gusts = S.makeGusts(gr);
  const st = { s: S.START_S, v: 6, wobble: 0, bias: 0, stood: false };
  let t = 0, wob = 0, n = 0, next = 0, steer = 0;
  while (st.s < S.INRUN_LEN) {
    if (balance && t >= next) { next = t + balance.look; steer = Math.abs(st.wobble) > balance.thr ? -Math.sign(st.wobble) * balance.push : 0; }
    S.stepInrun(st, DT, { steer: balance ? steer : 0 }, gauss(r), gauss(r));
    wob += Math.abs(st.wobble); n++; t += DT;
  }
  const inrunT = t;
  const p = S.inrunAt(S.INRUN_LEN), q = S.popQuality(tapAt);
  const f = { x: p.x, y: p.y, vx: st.v * Math.cos(p.ang), vy: st.v * Math.sin(p.ang) + S.TAKEOFF.pop * q, lean: 0, lv: 0, t: 0 };
  let ls = 0, m = 0; next = 0; steer = 0;
  while (f.y > S.hillY(f.x) + 0.15 && f.t < 10) {
    const real = f.t / S.FLIGHT.timeScale;
    const g = S.gustAt(real, gusts);
    if (lean && real >= next) {
      next = real + lean.look;
      let want = Math.abs(f.lean) > lean.thr ? -Math.sign(f.lean + f.lv * 0.12) * lean.push : 0;
      const w = warn && S.gustWarning(real, gusts);
      if (w && w.inS < 0.25) want = -Math.sign(w.amp) * lean.push * 0.8;
      steer = want;
    }
    S.stepFlight(f, DT * S.FLIGHT.timeScale, { steer: lean ? steer : 0 }, g, gauss(r));
    ls += Math.abs(f.lean); m++;
  }
  const slope = S.hillSlope(f.x);
  const vn = Math.abs((f.vy - slope * f.vx) / Math.hypot(1, slope));
  return { v: st.v, inrunT, flightT: f.t / S.FLIGHT.timeScale, m: S.metresAt(f.x), wob: wob / n, lean: ls / Math.max(1, m), end: Math.abs(f.lean), vn };
}

const good = { thr: 0.12, look: 0.12, push: 1 }, ok = { thr: 0.25, look: 0.2, push: 1 }, poor = { thr: 0.45, look: 0.3, push: 0.8 };
const cases = {
  'perfect': { tapAt: 3, balance: good, lean: good },
  'good, no warn use': { tapAt: 4, balance: good, lean: ok },
  'ok player': { tapAt: 9, balance: ok, lean: ok, warn: true },
  'poor player': { tapAt: 15, balance: poor, lean: poor },
  'no balance': { tapAt: 3, balance: null, lean: good, warn: true },
  'no lean control': { tapAt: 3, balance: good, lean: null },
  'early 25': { tapAt: 25, balance: ok, lean: ok },
  'late (no tap)': { tapAt: null, balance: ok, lean: ok },
};
console.log('K-point x', S.K_X, 'm/unit', S.M_PER_UNIT.toFixed(3), '| 120 m at x', S.xAtMetres(120).toFixed(1), '| hill end', S.HILL_END, '=', S.metresAt(S.HILL_END).toFixed(0), 'm');
for (const [name, c] of Object.entries(cases)) {
  const res = [];
  for (let seed = 1; seed <= 16; seed++) res.push(jump({ ...c, round: 1 + (seed & 1), seed }));
  const avg = (k) => res.reduce((a, b) => a + b[k], 0) / res.length;
  const falls = res.filter((x) => x.end > 0.85).length;
  const ms = res.map((x) => x.m).sort((a, b) => a - b);
  console.log(name.padEnd(18), `${avg('m').toFixed(1)} m [${ms[0].toFixed(0)}–${ms[ms.length - 1].toFixed(0)}]`, `falls ${falls}/16`, `v ${avg('v').toFixed(1)} in ${avg('inrunT').toFixed(2)}s fl ${avg('flightT').toFixed(2)}s`, `wob ${avg('wob').toFixed(2)} lean ${avg('lean').toFixed(2)} end ${avg('end').toFixed(2)} vn ${avg('vn').toFixed(1)}`);
}
