// Ski jump: a scripted good human (player 1), a careless one and an early tapper, plus everyone else.
(async () => {
  const g = __tt.game, def = g.def, comps = g.competitors.map((c) => ({ ...c }));
  const out = [];
  const L = 99;
  for (const mode of ['good', 'careless', 'early', 'skip']) {
    await g.load(def, comps, { skill: 'normal', seed: 9 });
    g.start();
    const ev = g.ev, pad = g.competitors[0].pad;
    const set = (b, down) => { if (pad.held[b] !== down) pad.push(b, down, g.time); };
    const tap = () => { set('action', true); tapUp = g.time + 0.08; };
    let guard = 0, tapUp = 0, did = {}, t0 = 0;
    while (ev.phase !== 'done' && guard++ < 120 * 160) {
      if (pad.held.action && g.time >= tapUp) set('action', false);
      if (ev.cur && ev.cur.i === 0) {
        const key = `${ev.round}-${ev.phase}`;
        if (ev.phase === 'gate' && !did[key]) { did[key] = 1; tap(); }
        if (ev.phase === 'inrun') {
          const st = ev.inrun, d = L - st.s;
          if (mode !== 'careless') { set('left', st.wobble > 0.08); set('right', st.wobble < -0.08); }
          const at = mode === 'early' ? 20 : mode === 'careless' ? -1 : 3;
          if (d <= at && !did[key]) { did[key] = 1; tap(); }
        }
        if (ev.phase === 'flight') {
          const f = ev.flight;
          if (mode !== 'careless') { const l = f.lean + f.lv * 0.12; set('right', l < -0.06); set('left', l > 0.06); }
          else { set('left', false); set('right', false); }
          if (mode !== 'careless' && ev.timeToContact() < 0.22 && !did[key]) { did[key] = 1; tap(); }
        }
        if (ev.phase === 'landed') { set('left', false); set('right', false); }
      }
      if (mode === 'skip' && ev.phase === 'landed' && ev.t > 1 && g.time > t0 + 0.3) { tap(); t0 = g.time; }
      g.simulate(1 / 120);
    }
    out.push(`${mode} (${g.time.toFixed(0)} s): ` + ev.jumpers.map((j) => `${j.c.code}${j.c.human ? '*' : ''} ${j.jumps.map((x) => x.metres + 'm ' + x.kind).join(', ')} = ${j.total}`).join(' | '));
  }
  return out;
})()
