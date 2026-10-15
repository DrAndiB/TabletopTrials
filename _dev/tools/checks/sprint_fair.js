// Sprint: one human runner with different tapping profiles. [name, drive cadence, top cadence, last-stretch cadence, cv, block start?, reaction]
(async () => {
  const g = __tt.game, def = g.def, comps = g.competitors.map((c) => ({ ...c }));
  const cases = [
    ['best', 6, 7.6, 8, 0.08, true, 0.16], ['good', 6, 7.2, 7.6, 0.08, true, 0.2], ['good touch', 6, 7.2, 7.6, 0.15, true, 0.2],
    ['steady 7', 7, 7, 7, 0.08, true, 0.2], ['steady 7 no block', 7, 7, 7, 0.08, false, 0.25], ['masher 10', 10, 10, 10, 0.1, true, 0.2],
    ['casual 6', 6, 6, 6, 0.12, false, 0.3], ['slow 5', 5, 5, 5, 0.1, false, 0.35], ['erratic 7', 7, 7, 7, 0.4, true, 0.25],
  ];
  const out = [];
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const R = +(new URLSearchParams(location.search).get('reps') || 1);
  for (const [name, c1, c2, c3, cv, block, react] of cases) for (let rep = 0; rep < R; rep++) {
    await g.load(def, comps, { skill: 'hard', seed: 5 + rep });
    g.start();
    const ev = g.ev, pad = g.competitors[0].pad;
    let guard = 0;
    while (ev.phase !== 'set' && guard++ < 4000) g.simulate(1 / 120);
    if (block) pad.push('action', true, g.time);
    while (ev.phase !== 'race' && guard++ < 8000) g.simulate(1 / 120);
    let t = ev.whistleAt + react, side = 'left';
    if (block) { while (g.time < t) g.simulate(1 / 120); pad.push('action', false, t); t += 0.12; }
    const ru = ev.runners[0];
    while (!ru.finished && g.time < ev.whistleAt + 25) {
      while (g.time < t) g.simulate(1 / 120);
      pad.push(side, true, t); pad.push(side, false, t + 0.03);
      side = side === 'left' ? 'right' : 'left';
      const cad = ru.x < 90 ? c1 : ru.x < 240 ? c2 : c3;
      t += Math.max(0.04, (1 / cad) * (1 + gauss() * cv));
    }
    while (ev.phase === 'race' || ev.phase === 'finishing') g.simulate(0.25);
    const cpu = ev.runners.slice(1).map((r) => r.time ? r.time.toFixed(2) : 'dnf').join('/');
    out.push(`${name}: ${ru.time ? ru.time.toFixed(2) + ' s' : 'dnf'} (react ${ru.reaction?.toFixed(2)}) | hard cpus ${cpu}`);
  }
  return out;
})()
