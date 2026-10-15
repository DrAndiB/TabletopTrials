// Curling: where caps come to rest for a few aims/strengths, and computer games per skill.
(async () => {
  const m = await import('/js/events/curling.js');
  const out = { probe: [] };
  for (const [aim, pw, e] of [[0, 0.5, 0], [0, 0.6, 0], [0, 0.7, 0], [4, 0.6, 0], [8, 0.6, 0], [4, 0.6, 1], [0, 0.55, 1]]) {
    const s = m.restingPoint(aim, pw, e);
    out.probe.push(`aim ${aim} pw ${pw} sweep ${e}: x ${s.x.toFixed(0)} z ${s.z.toFixed(1)}`);
  }
  const g = __tt.game, def = g.def, base = g.competitors.map((c) => ({ ...c, type: 'cpu', human: false }));
  for (const skill of ['easy', 'normal', 'hard']) {
    await g.load(def, base, { skill, seed: 4 });
    g.start();
    let guard = 0;
    while (g.ev.phase !== 'done' && guard++ < 120 * 600) g.simulate(1 / 120);
    out[skill] = `${(guard / 120).toFixed(0)} s: ` + g.ev.players.map((p) => `${p.c.code} ${p.total} (${p.endPts.join('/')})`).join(' | ');
  }
  return out;
})()
