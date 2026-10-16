// Swimming: computer races per skill, then one human with tapping profiles [name, cadence, cv, breathe below air, tumble?]
(async () => {
  const g = __tt.game, def = g.def, comps = g.competitors.map((c) => ({ ...c }));
  const out = [];
  const cpus = comps.map((c) => ({ ...c, type: 'cpu', human: false }));
  for (const skill of ['easy', 'normal', 'hard']) {
    await g.load(def, cpus, { skill, seed: 4 });
    g.start();
    let guard = 0;
    while (g.ev.phase !== 'done' && guard++ < 120 * 150) g.simulate(1 / 120);
    out.push(`${skill}: ` + g.ev.swimmers.map((s) => (s.time ? s.time.toFixed(2) : 'dnf') + (s.notes.length ? `(${s.notes.join(',')})` : '')).join(' | '));
  }
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const cases = [['good', 5.2, 0.08, 0.3, true], ['steady 5', 5, 0.1, 0.3, true], ['masher 9', 9, 0.1, 0.3, true], ['no breath', 5.2, 0.08, -1, true], ['no turn', 5.2, 0.08, 0.3, false], ['casual 4', 4, 0.12, 0.3, false]];
  for (const [name, cad, cv, airAt, tumble] of cases) {
    await g.load(def, comps, { skill: 'hard', seed: 5 });
    g.start();
    const ev = g.ev, pad = g.competitors[0].pad, s = ev.swimmers[0];
    let guard = 0;
    pad.push('action', true, g.time);
    while (ev.phase !== 'race' && guard++ < 8000) g.simulate(1 / 120);
    let t = ev.startCtl.whistleAt + 0.2;
    while (g.time < t) g.simulate(1 / 120);
    pad.push('action', false, t);
    t += 0.1;
    let side = 'left', armed = false;
    while (!s.finished && g.time < ev.startCtl.whistleAt + 60) {
      while (g.time < t) g.simulate(1 / 120);
      if (s.air < airAt && s.breathT < 0) { pad.push('action', true, t); pad.push('action', false, t + 0.03); }
      if (tumble && !armed && s.lap === 0 && s.x > 140) { armed = true; pad.push('action', true, t); pad.push('action', false, t + 0.03); }
      pad.push(side, true, t); pad.push(side, false, t + 0.03);
      side = side === 'left' ? 'right' : 'left';
      t += Math.max(0.04, (1 / cad) * (1 + gauss() * cv));
    }
    guard = 0;
    while (ev.phase !== 'done' && guard++ < 120 * 60) g.simulate(1 / 120);
    out.push(`${name}: ${s.time ? s.time.toFixed(2) : 'dnf'} ${s.notes.join(',')} | hard cpus ${ev.swimmers.slice(1).map((x) => x.time?.toFixed(2)).join('/')}`);
  }
  return out;
})()
