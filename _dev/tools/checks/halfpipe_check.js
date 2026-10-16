// Halfpipe: computer runs per skill (best, runs, tricks of the last run), then scripted humans
(async () => {
  const g = __tt.game, def = g.def, comps = g.competitors.map((c) => ({ ...c }));
  const cpus = comps.map((c) => ({ ...c, type: 'cpu', human: false }));
  const out = [];
  for (const skill of ['easy', 'normal', 'hard']) {
    await g.load(def, cpus, { skill, seed: 3 });
    g.start();
    let guard = 0;
    while (g.ev.phase !== 'done' && guard++ < 120 * 400) g.simulate(1 / 120);
    out.push(`${skill} ${(guard / 120).toFixed(0)}s: ` + g.ev.riders.map((r) => `${r.best} (${r.runs.join('/')})`).join(' | '));
  }
  // a human who pumps in the middle and does a spin that fits, or does nothing
  for (const [name, pumpQ, spins] of [['good', 0.9, true], ['pump only', 0.9, false], ['nothing', -1, false]]) {
    await g.load(def, comps.map((c, i) => (i ? { ...c, type: 'cpu', human: false } : c)), { skill: 'hard', seed: 5 });
    g.start();
    const ev = g.ev, pad = g.competitors[0].pad;
    let guard = 0, done = false;
    pad.push('action', true, g.time); pad.push('action', false, g.time + 0.03);
    let plan = null;
    while (!done && guard++ < 120 * 60) {
      g.simulate(1 / 120);
      const s = ev.rs, t = g.time;
      if (ev.cur !== ev.riders[0]) { done = true; break; }
      if (!s) continue;
      if (!s.air) { plan = null; if (pumpQ > 0 && !s.pumped && Math.abs(s.q) < (1 - pumpQ) * 7 + 0.3) { pad.push('action', true, t); pad.push('action', false, t + 0.03); } }
      else if (spins) {
        if (!plan) plan = { n: Math.floor((s.air.T - 0.3) * 1.3 * 2), d: 0 };
        if (plan.d < plan.n && s.air.t > 0.05 + plan.d * 0.08) { pad.push('right', true, t); pad.push('right', false, t + 0.03); plan.d++; }
      }
      if (ev.phase === 'ended') done = true;
    }
    out.push(`${name}: ${ev.rs.score} [${ev.rs.airs.map((a) => a.name + ':' + a.pts + (a.quality[0])).join(' ')}]`);
  }
  return out;
})()
