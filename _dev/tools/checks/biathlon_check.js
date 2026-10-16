// Biathlon: computer races per skill, and scripted humans.
(async () => {
  const g = __tt.game, def = g.def, base = g.competitors.map((c) => ({ ...c }));
  const out = {};
  const sum = (ev) => ev.skiers.map((s) => `${s.c.code}${s.c.human ? '*' : ''} ${s.time ? s.time.toFixed(1) : 'dnf'} ${s.shots.filter((h) => h).length}/${s.shots.length} c${s.crashes || 0}`).join(' | ');
  for (const skill of ['easy', 'normal', 'hard']) {
    await g.load(def, base.map((c) => ({ ...c, type: 'cpu', human: false })), { skill, seed: 4 });
    g.start();
    let guard = 0;
    while (g.ev.phase !== 'done' && guard++ < 120 * 300) g.simulate(1 / 120);
    out[skill] = sum(g.ev);
  }
  for (const mode of ['good', 'tuck too long', 'no tuck', 'masher']) {
    await g.load(def, base, { skill: 'normal', seed: 4 });
    g.start();
    const ev = g.ev, pad = g.competitors[0].pad, sk = ev.skiers[0];
    let guard = 0, t = 0, side = 'left', fired = 0;
    const set = (b, d) => { if (pad.held[b] !== d) pad.push(b, d, g.time); };
    while (ev.phase !== 'done' && guard++ < 120 * 300) {
      if (ev.phase === 'race' && !sk.finished) {
        const here = sk.state === 'race' || sk.state === 'pen';
        const seg = sk.state === 'pen' ? 'flat' : ev.kindAt(sk.s);
        if (here) {
          const climb = seg === 'climb' || seg === 'top';
          const cad = mode === 'masher' ? 9 : climb ? 7.5 : 5.6;
          if (g.time >= t && seg !== 'descent') { pad.push(side, true, g.time); pad.push(side, false, g.time + 0.03); side = side === 'left' ? 'right' : 'left'; t = g.time + 1 / cad; }
          const tuck = mode === 'no tuck' ? false : seg === 'descent' || (mode === 'tuck too long' && seg === 'runout');
          set('action', tuck);
        }
        if (sk.state === 'shoot') {
          set('action', false);
          set('left', sk.aim.x > 0.15); set('right', sk.aim.x < -0.15);
          if (g.time > fired + 0.25 && Math.hypot(sk.aim.x, sk.aim.y) < 0.45) { pad.push('action', true, g.time); pad.push('action', false, g.time + 0.05); fired = g.time; }
        } else { set('left', false); set('right', false); }
      }
      g.simulate(1 / 120);
    }
    out[mode] = sum(ev);
  }
  return out;
})()
