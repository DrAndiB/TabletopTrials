// Biathlon: computer races per skill, and scripted humans.
(async () => {
  const g = __tt.game, def = g.def, base = g.competitors.map((c) => ({ ...c }));
  const out = {};
  const sum = (ev) => ev.skiers.map((s) => `${s.c.code}${s.c.human ? '*' : ''} ${s.time ? s.time.toFixed(1) : 'dnf'} ${s.shots.filter((h) => h).length}/5 c${s.crashes || 0}`).join(' | ');
  for (const skill of ['easy', 'normal', 'hard']) {
    await g.load(def, base.map((c) => ({ ...c, type: 'cpu', human: false })), { skill, seed: 4 });
    g.start();
    let guard = 0;
    while (g.ev.phase !== 'done' && guard++ < 120 * 200) g.simulate(1 / 120);
    out[skill] = sum(g.ev);
  }
  for (const mode of ['good', 'no tuck/steer', 'tuck no steer', 'masher']) {
    await g.load(def, base, { skill: 'normal', seed: 4 });
    g.start();
    const ev = g.ev, pad = g.competitors[0].pad, sk = ev.skiers[0];
    let guard = 0, t = 0, side = 'left', fired = 0;
    const set = (b, d) => { if (pad.held[b] !== d) pad.push(b, d, g.time); };
    while (ev.phase !== 'done' && guard++ < 120 * 200) {
      if (ev.phase === 'race' && !sk.finished) {
        const here = sk.state === 'race' || sk.state === 'pen';
        const seg = sk.state === 'pen' ? 'flat' : ev.kindAt(sk.s);
        if (here) {
          const climb = seg === 'climb' || seg === 'top';
          const cad = mode === 'masher' ? 9 : climb ? 4 : 6;
          if (g.time >= t && seg !== 'descent') { pad.push(side, true, g.time); pad.push(side, false, g.time + 0.03); side = side === 'left' ? 'right' : 'left'; t = g.time + 1 / cad; }
          set('action', seg === 'descent' && mode !== 'no tuck/steer');
          set('left', seg === 'curve' && (mode === 'good' || mode === 'masher'));
        }
        if (sk.state === 'shoot') { set('left', sk.aim.x > 0.2); set('right', sk.aim.x < -0.2); }
        if (sk.state === 'shoot' && g.time > fired + 0.3) {
          if (Math.hypot(sk.aim.x, sk.aim.y) < 0.5) { pad.push('action', true, g.time); pad.push('action', false, g.time + 0.05); fired = g.time; }
        }
      }
      g.simulate(1 / 120);
    }
    out[mode] = sum(ev);
  }
  return out;
})()
