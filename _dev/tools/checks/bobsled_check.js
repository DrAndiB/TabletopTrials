// Bobsled: computer runs per skill (totals and both runs), plus skipping a run
(async () => {
  const g = __tt.game, def = g.def, comps = g.competitors.map((c) => ({ ...c, type: 'cpu', human: false }));
  const out = [];
  for (const skill of ['easy', 'normal', 'hard']) {
    await g.load(def, comps, { skill, seed: 3 });
    g.start();
    let guard = 0;
    while (g.ev.phase !== 'done' && guard++ < 120 * 400) g.simulate(1 / 120);
    out.push(`${skill} ${(guard / 120).toFixed(0)}s: ` + g.ev.crews.map((c) => `${c.total.toFixed(2)} (${c.times.join('+')})`).join(' | '));
  }
  return out;
})()
