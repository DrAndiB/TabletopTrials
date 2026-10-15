// Sprint: computer runners' times per skill over a few races.
(async () => {
  const g = __tt.game, def = g.def, comps = g.competitors.map((c) => ({ ...c, type: 'cpu', human: false }));
  const out = {};
  for (const skill of ['easy', 'normal', 'hard']) {
    const ts = [];
    for (const seed of [3, 4, 5]) {
      await g.load(def, comps, { skill, seed });
      g.start();
      let guard = 0;
      while (!['replay', 'done'].includes(g.ev.phase) && guard++ < 120 * 60) g.simulate(1 / 120);
      for (const ru of g.ev.runners) ts.push(ru.time ?? 99);
    }
    ts.sort((a, b) => a - b);
    out[skill] = ts.map((t) => t.toFixed(2)).join(' ');
  }
  return out;
})()
