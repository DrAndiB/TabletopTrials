// Ski jump physics, kept free of three.js so it can be tuned and tested on its own.
// Units are cm and toy seconds; the jump flies along +x. Gravity is slowed down ("toy time") so
// the in-run, flight and landing each last long enough to play.
//
// The venue: an ironing board leaned on the sofa is the in-run, a long ruler on a step stool the
// take-off table, and a mountain of sofa cushions under a duvet the landing hill.

export const G = 30;                  // gravity (units/s²)
export const EDGE = { x: 0, y: 53 };   // take-off edge
const TABLE_LEN = 16, TABLE_ANG = -8 * Math.PI / 180;
const BOARD_LEN = 83, BOARD_ANG = -32 * Math.PI / 180;

// in-run: the ironing board (steep) then the ruler (the take-off table), ending at the edge
export const T0 = { x: EDGE.x - TABLE_LEN * Math.cos(TABLE_ANG), y: EDGE.y - TABLE_LEN * Math.sin(TABLE_ANG) };
export const B0 = { x: T0.x - BOARD_LEN * Math.cos(BOARD_ANG), y: T0.y - BOARD_LEN * Math.sin(BOARD_ANG) };
export const BOARD = { len: BOARD_LEN, ang: BOARD_ANG }, TABLE = { len: TABLE_LEN, ang: TABLE_ANG };
export const INRUN_LEN = BOARD_LEN + TABLE_LEN;
export const START_S = 6;             // the start bar, measured from the top of the board
export function inrunAt(s) {
  if (s <= BOARD_LEN) return { x: B0.x + s * Math.cos(BOARD_ANG), y: B0.y + s * Math.sin(BOARD_ANG), ang: BOARD_ANG };
  const k = s - BOARD_LEN;
  return { x: T0.x + k * Math.cos(TABLE_ANG), y: T0.y + k * Math.sin(TABLE_ANG), ang: TABLE_ANG };
}

// landing hill profile: a duvet over a mountain of cushions, from just below the edge down to the floor
export const HILL_PTS = [[0, 48], [9.6, 46.2], [19.2, 42.6], [38.4, 35], [64, 24.5], [89.6, 14.1], [105.6, 8.3], [121.6, 3.8], [137.6, 1.3], [153.6, 0.2], [170, 0]];
export const HILL_END = 170;
const HX = HILL_PTS.map((p) => p[0]), HY = HILL_PTS.map((p) => p[1]);
// monotone cubic (Fritsch–Carlson) tangents
const HM = (() => {
  const n = HX.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((HY[i + 1] - HY[i]) / (HX[i + 1] - HX[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return m;
})();
export function hillY(x) {
  if (x <= HX[0]) return HY[0];
  if (x >= HX[HX.length - 1]) return 0;
  let i = 0;
  while (x > HX[i + 1]) i++;
  const h = HX[i + 1] - HX[i], t = (x - HX[i]) / h;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * HY[i] + (t3 - 2 * t2 + t) * h * HM[i] + (-2 * t3 + 3 * t2) * HY[i + 1] + (t3 - t2) * h * HM[i + 1];
}
export function hillSlope(x) { return (hillY(x + 0.05) - hillY(x - 0.05)) / 0.1; }

// distance along the hill surface, measured from the top of the hill under the edge, in metres
const ARC = (() => { const a = [0]; for (let x = 0.5; x <= 300; x += 0.5) a.push(a[a.length - 1] + Math.hypot(0.5, hillY(x) - hillY(x - 0.5))); return a; })();
export function arcTo(x) { const i = Math.max(0, Math.min(ARC.length - 1, x / 0.5)); const k = Math.floor(i); return ARC[k] + (ARC[Math.min(ARC.length - 1, k + 1)] - ARC[k]) * (i - k); }
export const K_X = 89.6;
export const M_PER_UNIT = 90 / arcTo(K_X);    // the K-point is 90 m
export function metresAt(x) { return arcTo(x) * M_PER_UNIT; }
export function xAtMetres(m) { let x = 0; while (x < 300 && metresAt(x) < m) x += 0.1; return x; }

// ---------- in-run ----------
// st: { s, v, wobble, bias }; input: { steer -1..1 }
// Balance drifts: a slowly wandering lean (bias) pulls the jumper off centre and LEFT/RIGHT push back.
// Nothing falls over; an untidy tuck just costs speed, a tidy one keeps it.
export const INRUN = { friction: 0.035, drag: 0.00021, wobbleBrake: 7, biasRate: 0.3, biasNoise: 1.05, biasMax: 0.95, follow: 2.4, steer: 2.3, jitter: 0.25 };
export function stepInrun(st, dt, input, n1, n2) {
  const p = inrunAt(st.s);
  const sin = -Math.sin(p.ang), cos = Math.cos(p.ang);
  // wobbling skis scrub off speed
  const a = G * sin - INRUN.friction * G * cos - INRUN.drag * st.v * st.v - INRUN.wobbleBrake * st.wobble * st.wobble;
  st.v = Math.max(0, st.v + a * dt);
  st.s += st.v * dt;
  st.bias = Math.max(-INRUN.biasMax, Math.min(INRUN.biasMax, st.bias - st.bias * INRUN.biasRate * dt + n1 * INRUN.biasNoise * Math.sqrt(dt)));
  st.wobble += ((st.bias - st.wobble) * INRUN.follow + input.steer * INRUN.steer) * dt + n2 * INRUN.jitter * Math.sqrt(dt);
  st.wobble = Math.max(-1.2, Math.min(1.2, st.wobble));
  return p;
}

// take-off quality from where ACTION was tapped (units before the edge; null = not tapped).
// The last JUMP_ZONE units of the ruler are taped green; taps further back than ARMED are ignored
// (so the tap that starts the run can't jump), and taps between ARMED and the green zone are early.
export const JUMP_ZONE = 7, ARMED = 30;
export function popQuality(dBefore, lateBy = null) {
  if (dBefore == null) return lateBy != null && lateBy <= 0.18 ? 0.55 : 0.15;
  if (dBefore < 0) return 0.15;
  if (dBefore <= JUMP_ZONE) return 1;
  return 1 - ((dBefore - JUMP_ZONE) / (ARMED - JUMP_ZONE)) * 0.75;
}
export const TAKEOFF = { pop: 13.9 };

// ---------- flight ----------
// st: { x, y, vx, vy, lean, lv, t }; lean 0 = the sweet spot, + forward, - back.
// Flight runs in gentle slow motion: pass dt * FLIGHT.timeScale.
export const FLIGHT = { timeScale: 0.58, lift: 0.00238, leanLin: 0.7, leanSq: 1.2, drag: 0.000138, leanRate: 2.2, unstable: 1.4, damp: 3, gustTorque: 3.2, noise: 1.1, gustLift: 0.1 };
export function liftFactor(lean) { return Math.max(0.05, 1 - FLIGHT.leanLin * Math.abs(lean) - FLIGHT.leanSq * lean * lean); }
export function stepFlight(st, dt, input, gust, noise) {
  const v2 = st.vx * st.vx + st.vy * st.vy, v = Math.sqrt(v2);
  const spread = Math.min(1, st.t / 0.35);            // the skis open into a V after take-off
  const L = FLIGHT.lift * liftFactor(st.lean) * (0.55 + 0.45 * spread) * (1 + FLIGHT.gustLift * gust) * v2;
  const D = FLIGHT.drag * (1 + 0.8 * Math.abs(st.lean) + (st.lean < 0 ? 0.9 * -st.lean : 0)) * v2;
  // lift acts perpendicular to the flight path (upwards), drag against it
  const ux = st.vx / v, uy = st.vy / v;
  const ax = -D * ux - L * uy;
  let ay = -G - D * uy + L * ux;
  if (st.lean > 0.75) ay -= (st.lean - 0.75) * 40;   // nose dive
  st.vx += ax * dt; st.vy += ay * dt;
  st.x += st.vx * dt; st.y += st.vy * dt;
  // lean: the player's left/right, the fan's gusts, a little drift and a little instability
  st.lv += (input.steer * FLIGHT.leanRate * FLIGHT.damp + FLIGHT.unstable * st.lean - st.lv * FLIGHT.damp + gust * FLIGHT.gustTorque) * dt + noise * FLIGHT.noise * Math.sqrt(dt);
  st.lean = Math.max(-1.3, Math.min(1.3, st.lean + st.lv * dt));
  st.t += dt;
}

// The desk fan's gusts: a few distinct puffs per flight, the same for every jumper in a round, so
// they can be announced before they arrive. t = real seconds since take-off.
export function makeGusts(r) {
  const list = [];
  let t = 0.55 + r() * 0.35;
  for (let k = 0; k < 3; k++) {
    list.push({ t0: t, dur: 0.6 + r() * 0.25, amp: (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.3) });
    t += 1.05 + r() * 0.35;
  }
  return list;
}
export const GUST_WARN = 0.55;
export function gustAt(t, gusts) {
  let g = 0.08 * Math.sin(t * 2.3);
  for (const q of gusts) { const u = (t - q.t0) / q.dur; if (u > 0 && u < 1) g += q.amp * Math.sin(Math.PI * u); }
  return g;
}
// the next gust being announced (or blowing now): { amp, inS } or null
export function gustWarning(t, gusts) {
  for (const q of gusts) if (t >= q.t0 - GUST_WARN && t < q.t0 + q.dur * 0.6) return { amp: q.amp, inS: q.t0 - t };
  return null;
}

// ---------- points ----------
export function distancePoints(m) { return Math.max(0, 60 + 2 * (m - 90)); }
export function roundHalf(v) { return Math.round(v * 2) / 2; }
