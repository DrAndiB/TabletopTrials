// Sprint fairness: one human runner tapping at different cadences and jitters (coefficient of variation).
// Keyboard-like (cv ~0.08) and touch-like (cv ~0.15) tapping at the same cadence should give the same time,
// and tapping faster than the 7 strides/s target should help only a little.
(async () => {
  const g = __tt.game, def = g.def, comps = g.competitors.map((c) => ({ ...c }));
  const cases = [[7, 0.08], [7, 0.15], [8, 0.08], [8, 0.15], [10, 0.1], [6, 0.1], [5, 0.1], [7, 0.3], [7, 0.45]];
  const out = [];
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (const [cad, cv] of cases) {
    await g.load(def, comps, { skill: 'normal', seed: 5 });
    g.start();
    const ev = g.ev, pad = g.competitors[0].pad;
    let guard = 0;
    while (ev.phase !== 'race' && guard++ < 4000) g.simulate(1 / 120);
    let t = ev.whistleAt + 0.2, side = 'left';
    while (!ev.runners[0].finished && g.time < ev.whistleAt + 25) {
      while (g.time < t) g.simulate(1 / 120);
      pad.push(side, true, t); pad.push(side, false, t + 0.03);
      side = side === 'left' ? 'right' : 'left';
      t += Math.max(0.04, (1 / cad) * (1 + gauss() * cv));
    }
    out.push(`${cad}/s cv ${cv}: ${ev.runners[0].time ? ev.runners[0].time.toFixed(2) + ' s' : 'dnf'}`);
  }
  return out;
})()
