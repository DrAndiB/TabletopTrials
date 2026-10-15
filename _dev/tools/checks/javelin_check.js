// Javelin: computer throws per skill, and scripted humans.
(async () => {
  const g = __tt.game, def = g.def, base = g.competitors.map((c) => ({ ...c }));
  const out = {};
  for (const skill of ['easy', 'normal', 'hard']) {
    const ms = [];
    for (const seed of [3, 4]) {
      await g.load(def, base.map((c) => ({ ...c, type: 'cpu', human: false })), { skill, seed });
      g.start();
      let guard = 0;
      while (g.ev.phase !== 'done' && guard++ < 120 * 200) g.simulate(1 / 120);
      for (const t of g.ev.throwers) ms.push(t.marks.map((m) => (m == null ? 'X' : m.toFixed(0))).join(','));
    }
    out[skill] = ms.join(' | ');
  }
  for (const [name, cad, holdAt, angle] of [['good', 7, 19, 35], ['fast tapper', 9, 19, 35], ['slow', 5.5, 17, 35], ['steep', 7, 19, 55], ['late hold', 7, 9, 35]]) {
    await g.load(def, base, { skill: 'normal', seed: 5 });
    g.start();
    const ev = g.ev, pad = g.competitors[0].pad;
    let guard = 0, t = 0, side = 'left', state = 0;
    while (ev.phase !== 'done' && guard++ < 120 * 200) {
      if (ev.cur && ev.cur.i === 0 && (ev.phase === 'ready' || ev.phase === 'runup')) {
        const a = ev.ath;
        if (state === 0) { state = 1; t = g.time + 0.3; }
        if (!a.holding && g.time >= t && !a.released) { pad.push(side, true, g.time); pad.push(side, false, g.time + 0.03); side = side === 'left' ? 'right' : 'left'; t = g.time + 1 / cad; }
        if (!a.holding && a.started && -a.x <= holdAt) pad.push('action', true, g.time);
        if (a.holding && a.angle >= angle) pad.push('action', false, g.time);
      } else state = 0;
      g.simulate(1 / 120);
    }
    out[name] = ev.throwers[0].marks.map((m) => (m == null ? 'X' : m.toFixed(1))).join(', ');
  }
  return out;
})()
