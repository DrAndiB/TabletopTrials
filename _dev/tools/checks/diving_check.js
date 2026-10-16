// Diving: computer divers per skill: totals and what each dive was
(async () => {
  const g = __tt.game, def = g.def, comps = g.competitors.map((c) => ({ ...c, type: 'cpu', human: false }));
  const out = [];
  for (const skill of ['easy', 'normal', 'hard']) {
    await g.load(def, comps, { skill, seed: 3 });
    g.start();
    let guard = 0;
    while (g.ev.phase !== 'done' && guard++ < 120 * 400) g.simulate(1 / 120);
    out.push(`${skill} ${(guard / 120).toFixed(0)}s: ` + g.ev.divers.map((d) => `${d.total.toFixed(1)} [${d.scores.map((s) => s.toFixed(0)).join(',')}] ${d.last ? `som ${d.last.som} tw ${d.last.twists} exe ${d.last.exe.toFixed(1)} dd ${d.last.dd}` : ''}`).join(' | '));
  }
  return out;
})()
