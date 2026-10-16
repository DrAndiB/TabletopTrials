// Hurdles: computer times per skill (with knocked hurdles), and scripted humans.
(async () => {
  const g = __tt.game, def = g.def, base = g.competitors.map((c) => ({ ...c }));
  const out = {};
  for (const skill of ['easy', 'normal', 'hard']) {
    const ts = [];
    for (const seed of [3, 4]) {
      await g.load(def, base.map((c) => ({ ...c, type: 'cpu', human: false })), { skill, seed });
      g.start();
      let guard = 0;
      while (!['replay', 'done'].includes(g.ev.phase) && guard++ < 120 * 60) g.simulate(1 / 120);
      for (const ru of g.ev.runners) ts.push(`${(ru.time ?? 99).toFixed(2)}/${ru.clips}c${ru.falls}f`);
    }
    out[skill] = ts.join(' ');
  }
  const H = Array.from({ length: 10 }, (_, k) => 39 + k * 25.5);
  for (const [name, cad, aim, err] of [['good human', 4.7, 0.5, 0.02], ['sloppy human', 4.4, 0.5, 0.1], ['masher', 8, 0.5, 0.02], ['no jumps', 4.7, null, 0]]) {
    await g.load(def, base, { skill: 'hard', seed: 5 });
    g.start();
    const ev = g.ev, pad = g.competitors[0].pad, ru = ev.runners[0];
    let guard = 0;
    while (ev.phase !== 'set' && guard++ < 4000) g.simulate(1 / 120);
    pad.push('action', true, g.time);
    while (ev.phase !== 'race' && guard++ < 8000) g.simulate(1 / 120);
    let t = ev.whistleAt + 0.2, side = 'left', jumpedFor = -1;
    while (g.time < t) g.simulate(1 / 120);
    pad.push('action', false, t); t += 0.12;
    while (!ru.finished && g.time < ev.whistleAt + 30) {
      while (g.time < t) {
        g.simulate(1 / 120);
        const k = ru.next, hx = H[k];
        if (aim != null && hx != null && jumpedFor !== k && !ru.air) {
          const tTo = (hx - ru.x - ru.v * 0.44 * aim) / Math.max(5, ru.v);
          const e = jumpedFor === -2 ? 0 : (Math.random() - 0.5) * 2 * err;
          if (tTo <= e) { jumpedFor = k; pad.push('action', true, g.time); pad.push('action', false, g.time + 0.05); }
        }
      }
      pad.push('right', true, t); pad.push('right', false, t + 0.03);
      t += 1 / cad;
    }
    out[name] = `${ru.time ? ru.time.toFixed(2) : 'dnf'} clips ${ru.clips} falls ${ru.falls}`;
  }
  return out;
})()
