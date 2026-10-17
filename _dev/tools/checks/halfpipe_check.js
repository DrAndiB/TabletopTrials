// Halfpipe: computer runs per skill, then scripted humans: a good rider, a beginner, pump only
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
  // [name, pump window (units from the middle), spin share of what fits, grab every n-th air, reaction (s)]
  const W = 11;
  for (const [name, pumpAt, share, grabEvery, react] of [['good', 3, 0.85, 2, 0.15], ['beginner', W, 0.45, 0, 0.3], ['pump only', 3, 0, 0, 0]]) {
    await g.load(def, comps.map((c, i) => (i ? { ...c, type: 'cpu', human: false } : c)), { skill: 'hard', seed: 5 });
    g.start();
    const ev = g.ev, pad = g.competitors[0].pad;
    let guard = 0, plan = null, n = 0, target = null;
    pad.push('action', true, g.time); pad.push('action', false, g.time + 0.03);
    while (guard++ < 120 * 60) {
      g.simulate(1 / 120);
      const s = ev.rs, t = g.time;
      if (ev.cur !== ev.riders[0] || ev.phase === 'ended') break;
      if (!s) continue;
      if (!s.air) {
        if (plan) { pad.push('left', false, t); pad.push('right', false, t); pad.push('action', false, t); n++; }
        plan = null;
        if (target == null && Math.abs(s.q) < W && Math.sign(s.q) !== s.dir) target = Math.random() * pumpAt;
        if (target != null && !s.pumped && Math.abs(s.q) <= target + 0.3) { pad.push('action', true, t); pad.push('action', false, t + 0.03); target = null; }
        if (Math.abs(s.q) > W) target = null;
        continue;
      }
      const a = s.air;
      if (!plan) plan = { halves: Math.floor((a.T - 0.35) * 1.6 * 2 * share), dir: n % 2 ? 'left' : 'right', grab: grabEvery && n % grabEvery === 1 && a.T > 0.8 };
      const spin = plan.halves > 0 && a.t > react && a.spun < (plan.halves - 1) / 2 + 0.08 + (react > 0.2 ? 0.1 : 0);
      pad.push(plan.dir, spin, t);
      pad.push('action', !!plan.grab && a.t > react && a.t < a.T - 0.25, t);
    }
    out.push(`${name}: ${ev.rs.score} [${ev.rs.airs.map((a) => a.name + ':' + a.pts + (a.quality[0])).join(' ')}]`);
  }
  return out;
})()
