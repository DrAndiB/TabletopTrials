// Ski jump physics, kept free of three.js so it can be tuned and tested on its own.
// Units are cm and toy seconds; the jump flies along +x. Gravity is slowed down ("toy time") so
// the in-run, flight and landing each last long enough to play.

export const G = 30;                  // gravity (units/s²)
export const EDGE = { x: 0, y: 33 };   // take-off edge
const TABLE_LEN = 10, TABLE_ANG = -8 * Math.PI / 180;
const BOOK_LEN = 52, BOOK_ANG = -32 * Math.PI / 180;

// in-run: the book (steep) then the ruler (the take-off table), ending at the edge
export const T0 = { x: EDGE.x - TABLE_LEN * Math.cos(TABLE_ANG), y: EDGE.y - TABLE_LEN * Math.sin(TABLE_ANG) };
export const B0 = { x: T0.x - BOOK_LEN * Math.cos(BOOK_ANG), y: T0.y - BOOK_LEN * Math.sin(BOOK_ANG) };
export const INRUN_LEN = BOOK_LEN + TABLE_LEN;
export const START_S = 4;             // the start bar, measured from the top of the book
export function inrunAt(s) {
  if (s <= BOOK_LEN) return { x: B0.x + s * Math.cos(BOOK_ANG), y: B0.y + s * Math.sin(BOOK_ANG), ang: BOOK_ANG };
  const k = s - BOOK_LEN;
  return { x: T0.x + k * Math.cos(TABLE_ANG), y: T0.y + k * Math.sin(TABLE_ANG), ang: TABLE_ANG };
}

// landing hill profile: a blanket over cushions, from just below the edge down to the floor
export const HILL_PTS = [[0, 30.0], [6, 28.9], [12, 26.6], [24, 21.9], [40, 15.3], [56, 8.8], [66, 5.2], [76, 2.4], [86, 0.8], [96, 0.12], [106, 0]];
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
const ARC = (() => { const a = [0]; for (let x = 0.5; x <= 200; x += 0.5) a.push(a[a.length - 1] + Math.hypot(0.5, hillY(x) - hillY(x - 0.5))); return a; })();
export function arcTo(x) { const i = Math.max(0, Math.min(ARC.length - 1, x / 0.5)); const k = Math.floor(i); return ARC[k] + (ARC[Math.min(ARC.length - 1, k + 1)] - ARC[k]) * (i - k); }
export const K_X = 56;
export const M_PER_UNIT = 90 / arcTo(K_X);    // the K-point is 90 m
export function metresAt(x) { return arcTo(x) * M_PER_UNIT; }
export function xAtMetres(m) { let x = 0; while (x < 200 && metresAt(x) < m) x += 0.1; return x; }

// ---------- in-run ----------
// st: { s, v, wobble, wv, tuck, stood }; input: { steer -1..1, tuck bool }
export const INRUN = { friction: 0.035, dragTuck: 0.00034, dragUp: 0.0011, noise: 1.5, unstable: 2.2, damp: 2.6, steerPush: 3.0, wobbleCost: 0.0022 };
export function stepInrun(st, dt, input, noise) {
  const p = inrunAt(st.s);
  const sin = -Math.sin(p.ang), cos = Math.cos(p.ang);
  const tucked = input.tuck && !st.stood;
  const drag = (tucked ? INRUN.dragTuck : INRUN.dragUp) + INRUN.wobbleCost * Math.abs(st.wobble) + (Math.abs(st.wobble) > 0.8 ? 0.0008 : 0);
  const a = G * sin - INRUN.friction * G * cos - drag * st.v * st.v;
  st.v = Math.max(0, st.v + a * dt);
  st.s += st.v * dt;
  // balance: a little unstable (it tips further once it starts), wanders more at speed, and the
  // player's left/right pushes it back
  st.wv += (INRUN.unstable * st.wobble + input.steer * INRUN.steerPush - st.wv * INRUN.damp) * dt + noise * INRUN.noise * (0.4 + st.v / 35) * Math.sqrt(dt);
  st.wobble = Math.max(-1.2, Math.min(1.2, st.wobble + st.wv * dt));
  if (Math.abs(st.wobble) >= 1.2) st.wv *= -0.3;
  return p;
}

// take-off quality from where ACTION was released (units before the edge; null = not released).
// The last JUMP_ZONE units of the ruler are painted green; releasing more than EARLY units before the
// edge means standing up too soon.
export const JUMP_ZONE = 4.5, EARLY = 18;
export function popQuality(dBefore, lateBy = null) {
  if (dBefore == null) return lateBy != null && lateBy <= 0.15 ? 0.55 : 0.15;
  if (dBefore < 0) return 0.15;
  if (dBefore <= JUMP_ZONE) return 1;
  if (dBefore <= EARLY) return 1 - ((dBefore - JUMP_ZONE) / (EARLY - JUMP_ZONE)) * 0.65;
  return 0.2;
}
export const TAKEOFF = { pop: 11 };

// ---------- flight ----------
// st: { x, y, vx, vy, lean, lv, t }; lean 0 = the sweet spot, + forward, - back.
// Flight runs in gentle slow motion: pass dt * FLIGHT.timeScale.
export const FLIGHT = { timeScale: 0.72, lift: 0.0041, leanLin: 0.7, leanSq: 1.2, drag: 0.00022, leanRate: 2.4, unstable: 4.5, damp: 3, gustTorque: 4.5, noise: 2.4, gustLift: 0.12 };
export function liftFactor(lean) { return Math.max(0.05, 1 - FLIGHT.leanLin * Math.abs(lean) - FLIGHT.leanSq * lean * lean); }
export function stepFlight(st, dt, input, gust, noise) {
  const v2 = st.vx * st.vx + st.vy * st.vy, v = Math.sqrt(v2);
  const spread = Math.min(1, st.t / 0.35);            // the skis open into a V after take-off
  const L = FLIGHT.lift * liftFactor(st.lean) * (0.55 + 0.45 * spread) * (1 + FLIGHT.gustLift * gust) * v2;
  const D = FLIGHT.drag * (1 + 0.8 * Math.abs(st.lean) + (st.lean < 0 ? 0.9 * -st.lean : 0)) * v2;
  // lift acts perpendicular to the flight path (upwards), drag against it
  const ux = st.vx / v, uy = st.vy / v;
  let ax = -D * ux - L * uy, ay = -G - D * uy + L * ux;
  if (st.lean > 0.75) ay -= (st.lean - 0.75) * 40;   // nose dive
  st.vx += ax * dt; st.vy += ay * dt;
  st.x += st.vx * dt; st.y += st.vy * dt;
  // lean: the player's left/right, the fan's gusts, a little drift and some instability
  st.lv += (input.steer * FLIGHT.leanRate * FLIGHT.damp + FLIGHT.unstable * st.lean - st.lv * FLIGHT.damp + gust * FLIGHT.gustTorque) * dt + noise * FLIGHT.noise * Math.sqrt(dt);
  st.lean = Math.max(-1.3, Math.min(1.3, st.lean + st.lv * dt));
  st.t += dt;
}

// the desk fan's gusts, the same for every jumper in a round (t = seconds since take-off)
export function gustAt(t, round) {
  const a = round * 1.7;
  return 0.55 * Math.sin(t * 2.1 + a) + 0.35 * Math.sin(t * 5.3 + a * 2.3) + 0.25 * Math.sin(t * 9.1 + a * 0.7);
}

// ---------- points ----------
export function distancePoints(m) { return Math.max(0, 60 + 2 * (m - 90)); }
export function roundHalf(v) { return Math.round(v * 2) / 2; }
