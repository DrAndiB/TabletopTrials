// Ski jump: computer kids' distances and falls per skill over a few competitions.
(async () => {
  const g = __tt.game, def = g.def, comps = g.competitors.map((c) => ({ ...c, type: 'cpu', human: false }));
  const out = {};
  for (const skill of ['easy', 'normal', 'hard']) {
    const m = [];
    let falls = 0, tele = 0;
    for (const seed of [3, 4, 5, 6, 7]) {
      await g.load(def, comps, { skill, seed });
      g.start();
      let guard = 0;
      while (g.ev.phase !== 'done' && guard++ < 120 * 150) g.simulate(1 / 120);
      for (const j of g.ev.jumpers) for (const x of j.jumps) { m.push(x.metres); if (x.kind === 'fall') falls++; if (x.kind === 'telemark') tele++; }
    }
    m.sort((a, b) => a - b);
    out[skill] = `n ${m.length} mean ${(m.reduce((a, b) => a + b, 0) / m.length).toFixed(1)} median ${m[m.length >> 1]} min ${m[0]} max ${m[m.length - 1]} falls ${falls} telemarks ${tele}`;
  }
  return out;
})()
