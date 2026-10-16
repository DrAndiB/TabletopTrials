// Speed skating: computer races per skill, then one human with profiles [name, cadence, cv, lean delay (s) or null]
(async () => {
  const g = __tt.game, def = g.def, comps = g.competitors.map((c) => ({ ...c }));
  const out = [];
  const cpus = comps.map((c) => ({ ...c, type: 'cpu', human: false }));
  for (const skill of ['easy', 'normal', 'hard']) {
    await g.load(def, cpus, { skill, seed: 4 });
    g.start();
    let guard = 0;
    while (g.ev.phase !== 'done' && guard++ < 120 * 120) g.simulate(1 / 120);
    out.push(`${skill}: ` + g.ev.skaters.map((s) => (s.time ? s.time.toFixed(2) : 'dnf') + ` w${s.notes.wide.toFixed(1)}`).join(' | '));
  }
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const cases = [['good', 3.7, 0.08, 0.06], ['steady 3.6', 3.6, 0.1, 0.1], ['masher 7', 7, 0.1, 0.06], ['never lean', 3.7, 0.08, null], ['late lean', 3.7, 0.08, 0.4]];
  for (const [name, cad, cv, delay] of cases) {
    await g.load(def, comps, { skill: 'hard', seed: 5 });
    g.start();
    const ev = g.ev, pad = g.competitors[0].pad, s = ev.skaters[0];
    let guard = 0;
    pad.push('action', true, g.time);
    while (ev.phase !== 'race' && guard++ < 8000) g.simulate(1 / 120);
    let t = ev.startCtl.whistleAt + 0.2;
    while (g.time < t) g.simulate(1 / 120);
    pad.push('action', false, t); t += 0.05;
    let side = 'left', due = null;
    while (!s.finished && g.time < ev.startCtl.whistleAt + 60) {
      while (g.time < t) g.simulate(1 / 120);
      const want = ev.at(s).bend > 0;
      if (delay != null && want !== s.lean) { if (due == null) due = t + delay; if (t >= due) { pad.push('action', true, t); pad.push('action', false, t + 0.03); due = null; } } else due = null;
      pad.push(side, true, t); pad.push(side, false, t + 0.03);
      side = side === 'left' ? 'right' : 'left';
      t += Math.max(0.04, (1 / cad) * (1 + gauss() * cv));
    }
    guard = 0;
    while (ev.phase !== 'done' && guard++ < 120 * 60) g.simulate(1 / 120);
    out.push(`${name}: ${s.time ? s.time.toFixed(2) : 'dnf'} wide ${s.notes.wide.toFixed(1)} | hard cpus ${ev.skaters.slice(1).map((x) => x.time?.toFixed(2)).join('/')}`);
  }
  return out;
})()
