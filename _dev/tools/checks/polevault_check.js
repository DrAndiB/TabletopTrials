// Pole vault: computer vaulters per skill (best heights, attempts), then a scripted human
(async () => {
  const g = __tt.game, def = g.def, comps = g.competitors.map((c) => ({ ...c, type: 'cpu', human: false }));
  const out = [];
  for (const skill of ['easy', 'normal', 'hard']) {
    await g.load(def, comps, { skill, seed: 3 });
    g.start();
    let guard = 0;
    const hs = [];
    const orig = g.ev.release.bind(g.ev);
    g.ev.release = () => { orig(); hs.push(g.ev.va.height); };
    while (g.ev.phase !== 'done' && guard++ < 120 * 600) g.simulate(1 / 120);
    out.push(`${skill} ${(guard / 120).toFixed(0)}s: ` + g.ev.vaulters.map((v) => `${v.best ?? 'NH'} ${v.marks.join('')}`).join(' | ') + ` heights ${Math.min(...hs).toFixed(2)}-${Math.max(...hs).toFixed(2)} avg ${(hs.reduce((a, b) => a + b, 0) / hs.length).toFixed(2)}`);
  }
  return out;
})()
