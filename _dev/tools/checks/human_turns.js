// Scripted human turns in diving, pole vault and bobsled: does the human path work and score sensibly?
(async () => {
  const g = __tt.game, out = [];
  const tap = (pad, b, t) => { pad.push(b, true, t); pad.push(b, false, t + 0.03); };
  const evs = (await import('/js/events/index.js')).EVENTS;
  const comps = g.competitors.map((c, i) => (i ? { ...c, type: 'cpu', human: false } : { ...c, type: 'keys', human: true }));
  // diving: bounce on time, tuck until the dial says stretch out
  await g.load(evs.find((e) => e.id === 'diving'), comps, { skill: 'normal', seed: 2 });
  g.start();
  let ev = g.ev, pad = g.competitors[0].pad, guard = 0;
  const dives = [];
  while (ev.phase !== 'done' && guard++ < 120 * 200) {
    g.simulate(1 / 120);
    const t = g.time;
    if (ev.cur !== ev.divers[0]) continue;
    const v = ev.dv;
    if (ev.phase === 'ready' && ev.t > 0.3) tap(pad, 'action', t);
    if (ev.phase === 'bounce') { const len = 0.56 * (0.7 + 0.3 * v.amp); if (v.hopT > len - 0.02 && !v.tapped) { tap(pad, 'action', t); v.tapped = true; } if (v.hopT < 0.1) v.tapped = false; }
    if (ev.phase === 'flight') {
      const T = ev.timeToWater(v), end = v.theta + 0.3 * 2 * Math.PI * T;
      const err = Math.abs(((end - Math.PI) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      const want = v.flightT > 0.1 && !(err < 0.12 && v.theta > Math.PI) && v.theta < 4 * Math.PI && T > 0.35;
      if (want !== pad.held.action) pad.push('action', want, t);
      if (!want && v.twistGoal < 1 && v.wasTucked && T > 0.6) tap(pad, 'right', t);
    }
    if (ev.phase === 'scores' && ev.cur === ev.divers[0] && ev.t < 1 / 100) dives.push(ev.dv.result);
  }
  out.push('diving human ' + ev.divers[0].total + ' [' + ev.divers[0].scores.join(', ') + '] vs ' + ev.divers.slice(1).map((d) => d.total).join('/') + ' | ' + dives.map((r) => r && `${r.som}s ${r.twists}t exe ${r.exe.toFixed(1)}`).join('; '));
  // pole vault: steady run, plant mid-tape, push on time
  await g.load(evs.find((e) => e.id === 'polevault'), comps, { skill: 'normal', seed: 2 });
  g.start();
  ev = g.ev; pad = g.competitors[0].pad; guard = 0;
  let next = 0, side = 'left';
  while (ev.phase !== 'done' && guard++ < 120 * 600) {
    g.simulate(1 / 120);
    const t = g.time;
    if (ev.cur !== ev.vaulters[0]) { if (ev.phase === 'ready' || ev.phase === 'run') tap(pad, 'action', t); continue; }
    if ((ev.phase === 'ready' || ev.phase === 'run') && t >= next) { tap(pad, side, t); side = side === 'left' ? 'right' : 'left'; next = t + 1 / 6.6; }
    if (ev.phase === 'run' && ev.va.x >= -17 && !ev.va.planted) pad.push('action', true, t);
    if (ev.phase === 'swing' && ev.va.u >= 0.7) pad.push('action', false, t);
  }
  out.push('polevault human ' + ev.vaulters[0].best + ' ' + ev.vaulters[0].marks.join('') + ' vs ' + ev.vaulters.slice(1).map((v) => v.best).join('/'));
  // bobsled: push, jump in late, steer onto the line
  await g.load(evs.find((e) => e.id === 'bobsled'), comps, { skill: 'normal', seed: 2 });
  g.start();
  ev = g.ev; pad = g.competitors[0].pad; guard = 0; next = 0;
  while (ev.phase !== 'done' && guard++ < 120 * 400) {
    g.simulate(1 / 120);
    const t = g.time;
    if (ev.cur !== ev.crews[0]) { if (ev.phase === 'run' || ev.phase === 'push') tap(pad, 'action', t); continue; }
    const sl = ev.sl;
    if ((ev.phase === 'ready' || ev.phase === 'push') && !sl.inside && t >= next) { tap(pad, side, t); side = side === 'left' ? 'right' : 'left'; next = t + 1 / 6.2; }
    if (ev.phase === 'push' && sl.s > 26.5 && !sl.inside) tap(pad, 'action', t);
    if (ev.phase === 'run') { const e = (sl.star ?? 0) - sl.phi; pad.push('left', e < -0.08, t); pad.push('right', e > 0.08, t); }
  }
  out.push('bobsled human ' + ev.crews[0].total + ' (' + ev.crews[0].times.join('+') + ') vs ' + ev.crews.slice(1).map((c) => c.total).join('/'));
  return out;
})()
