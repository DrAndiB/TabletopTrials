// Ski jump: a scripted good human (player 1) and a careless one, plus everyone else's jumps.
(async () => {
  const g = __tt.game, def = g.def, comps = g.competitors.map((c) => ({ ...c }));
  const out = [];
  for (const mode of ['good', 'careless', 'early']) {
    await g.load(def, comps, { skill: 'normal', seed: 9 });
    g.start();
    const ev = g.ev, pad = g.competitors[0].pad;
    const set = (b, down) => { if (pad.held[b] !== down) pad.push(b, down, g.time); };
    let guard = 0;
    while (ev.phase !== 'done' && guard++ < 120 * 120) {
      if (ev.cur && ev.cur.i === 0) {
        if (ev.phase === 'gate') set('action', true);
        if (ev.phase === 'inrun') {
          const st = ev.inrun, d = 62 - st.s;
          if (mode === 'good') { const w = st.wobble + st.wv * 0.15; set('left', w > 0.06); set('right', w < -0.06); if (d <= 2) set('action', false); }
          if (mode === 'early' && d <= 12) set('action', false);
        }
        if (ev.phase === 'flight') {
          const f = ev.flight;
          if (mode === 'good') { const l = f.lean + f.lv * 0.12; set('right', l < -0.05); set('left', l > 0.05); if (ev.timeToContact() < 0.22) set('action', true); }
          else { set('left', false); set('right', false); }
        }
        if (ev.phase === 'landed') { set('left', false); set('right', false); set('action', false); }
      }
      g.simulate(1 / 120);
    }
    out.push(mode + ': ' + ev.jumpers.map((j) => `${j.c.code}${j.c.human ? '*' : ''} ${j.jumps.map((x) => x.metres + 'm ' + x.kind).join(', ')} = ${j.total}`).join(' | '));
  }
  return out;
})()
