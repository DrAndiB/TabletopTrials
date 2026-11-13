// Phone mode, all twelve events: scripted gestures (taps, swipes, holds, drags) play the human's part
// against the computer kids, to check that every gesture path works and scores sensibly.
// query: autostart=1&event=sprint&p=touch,cpu,cpu,cpu&quality=low&skipcpu=on   (a phone-sized window)
(async () => {
  const g = __tt.game, G = __tt.gestures;
  const W = innerWidth, H = innerHeight; let _id = 1;
  const EV = (await import('/js/events/index.js')).EVENTS;
  const load = async (id, skill = 'normal', seed = 3) => { await g.load(EV.find((e) => e.id === id), __tt.run().competitors, { skill, seed }); g.start({ flyIn: false }); return g.ev; };
  const tap = (t, x = W / 2, y = H * 0.7) => { const i = _id++; G.onDown(i, x, y, t); G.onUp(i, t + 0.03); };
  const swipe = (t, x = W / 2, len = 120, dx = 0) => { const i = _id++; G.onDown(i, x, H * 0.5, t); G.onMove(i, x + dx, H * 0.5 + len, t + 0.04); G.onUp(i, t + 0.05); };
  const step = () => { g.simulate(1 / 120); return g.time; };
  const out = [];
  // ---- sprint
  {
  const tap2 = (x, t) => { const i = _id++; G.onDown(i, x, H * 0.7, t); G.onUp(i, t + 0.03); };
  for (const rate of [7, 8.5, 10, 12]) {
    const ev = await load('sprint'); let next = 0, side = 0, guard = 0;
    while (ev.phase !== 'done' && guard++ < 120 * 60) {
      g.simulate(1 / 120);
      const t = g.time;
      if ((ev.phase === 'race' || ev.phase === 'finishing') && !ev.runners[0].finished && t >= next && t > ev.whistleAt + 0.18) { tap2(side ? W * 0.75 : W * 0.25, t); side ^= 1; next = t + 1 / rate; }
    }
    out.push(`sprint ${rate}/s: ` + ev.runners.map((r) => r.time?.toFixed(2)).join(' / ') + ' phone=' + ev.runners[0].ph + ' scheme=' + G.mode);
  }
  }
  // ---- hurdles
  {
  for (const err of [0, 1.5, 3.5]) {
    const ev = await load('hurdles'), ru = ev.runners[0]; let guard = 0, started = false, jumpedFor = -1;
    while (ev.phase !== 'done' && guard++ < 120 * 60) {
      g.simulate(1 / 120);
      const t = g.time;
      if ((ev.phase === 'race') && !started && t > ev.whistleAt + 0.2) { tap(t); started = true; }
      if (started && !ru.finished && ev.cue && ru.next !== jumpedFor && ru.x >= ev.cue.position.x + err * (ru.next % 2 ? 1 : -1)) { tap(t); jumpedFor = ru.next; }
    }
    out.push(`hurdles err ${err}: ` + ev.runners.map((r) => `${r.time?.toFixed(2)}(${r.clips}c${r.falls}f)`).join(' / ') + ' scheme=' + G.mode + ' cueLen=' + ev.cueLen?.toFixed(1));
  }
  }
  // ---- swim
  {
  for (const [rate, len] of [[2.5, 120], [2.5, 40], [3.5, 120], [1.8, 120]]) {
    const ev = await load('swimming'); const s = ev.swimmers[0]; let next = 0, side = 0, guard = 0, breaths = 0, skip = 0;
    while (ev.phase !== 'done' && guard++ < 120 * 90) {
      const t = step();
      if (ev.phase === 'race' && !s.finished && t >= next && t > ev.startCtl.whistleAt + 0.2 && !s.turn) {
        if (s.air < 0.3 && s.swimming && skip === 0) { skip = 1; next = t + 1.6 / rate; breaths++; continue; }
        skip = 0; swipe(t, side ? W * 0.75 : W * 0.25, len); side ^= 1; next = t + 1 / rate;
      }
    }
    out.push(`swim ${rate}/s len ${len}: ` + ev.swimmers.map((r) => r.time?.toFixed(2)).join(' / ') + ` notes=${s.notes.join(',')} skips=${breaths} ph=${s.ph} mode=${G.mode}`);
  }
  for (const [rate, lean] of [[2.4, true], [2.4, false], [3.2, true]]) {
    const ev = await load('speedskating'); const s = ev.skaters[0]; let next = 0, side = 0, guard = 0, hid = null;
    while (ev.phase !== 'done' && guard++ < 120 * 90) {
      const t = step();
      if (ev.phase !== 'race' || s.finished || t < ev.startCtl.whistleAt + 0.2) continue;
      const bend = s.started && ev.at(s).bend > 0;
      if (lean && bend && hid == null) { hid = _id++; G.onDown(hid, W / 2, H / 2, t); }
      if (hid != null && !bend) { G.onUp(hid, t); hid = null; next = t + 0.15; }
      if (hid == null && t >= next) { swipe(t, side ? W * 0.75 : W * 0.25, 120); side ^= 1; next = t + 1 / rate; }
    }
    out.push(`skate ${rate}/s lean ${lean}: ` + ev.skaters.map((r) => r.time?.toFixed(2)).join(' / ') + ` wide=${s.notes.wide.toFixed(1)} straightLean=${s.notes.straight.toFixed(1)} mode=${G.mode}`);
  }
  }
  // ---- jav
  {
  for (const [pullAt, pull, relAt] of [[-30, 62, -3], [-45, 62, -12], [-30, 40, -3], [-30, 62, 5]]) {
    const ev = await load('javelin'); let guard = 0, hid = null; const me = ev.throwers[0];
    while (ev.phase !== 'done' && guard++ < 120 * 240) {
      const t = step();
      if (ev.cur !== me) continue;
      const a = ev.ath;
      if (ev.phase === 'ready' && ev.t > 0.4 && !a.started && hid == null) { tap(t); }
      if (ev.phase === 'runup' && hid == null && a.x >= pullAt && !a.released) { hid = _id++; G.onDown(hid, W / 2, H / 2, t); G.onMove(hid, W / 2 - pull / G.scale * 0.7, H / 2 + pull / G.scale * 0.714, t + 0.01); }
      if (hid != null && (a.x >= relAt || a.released)) { if (!a.released) G.onUp(hid, t); else G.onUp(hid, t); hid = null; }
    }
    out.push(`javelin pull@${pullAt} ${pull}u rel@${relAt}: me ${me.marks.join(',')} vs ` + ev.throwers.slice(1).map((x) => x.best).join('/') + ` ph=${me.c.phone}`);
  }
  }
  // ---- dive
  {
  // pole vault
  { const ev = await load('polevault'); let guard = 0, hid = null; const me = ev.vaulters[0];
    while (ev.phase !== 'done' && guard++ < 120 * 900) {
      const t = step();
      if (ev.cur !== me) continue;
      const a = ev.va;
      if (ev.phase === 'ready' && ev.t > 0.4 && !a.started && !a.tapped) { a.tapped = true; const i = _id++; G.onDown(i, W/2, H/2, t); a.upAt = [i, t + 0.06]; }
      if (a.upAt && t >= a.upAt[1]) { G.onUp(a.upAt[0], t); a.upAt = null; }
      if (ev.phase === 'run' && hid == null && a.x >= -17.5 && !a.planted) { hid = _id++; G.onDown(hid, W / 2, H / 2, t); }
      if (hid != null && ev.phase === 'swing' && a.u >= 0.69) { G.onUp(hid, t); hid = null; }
      if (hid != null && (ev.phase === 'miss' || ev.phase === 'landed')) { G.onUp(hid, t); hid = null; }
    }
    out.push(`polevault me ${me.best} ${me.marks.join('')} vs ` + ev.vaulters.slice(1).map((x) => `${x.best}`).join('/') + ` simT=${g.time.toFixed(0)}`);
  }
  // diving
  { const ev = await load('diving'); let guard = 0, hid = null; const me = ev.divers[0]; const res = [];
    while (ev.phase !== 'done' && guard++ < 120 * 400) {
      const t = step();
      if (ev.cur !== me) continue;
      const v = ev.dv;
      if (ev.phase === 'ready' && ev.t > 0.3 && !v.t0) { v.t0 = 1; tap(t); }
      if (ev.phase === 'bounce') { const len = 0.56 * (0.7 + 0.3 * v.amp); if (v.hopT > len - 0.02 && !v.tapped) { tap(t); v.tapped = true; } if (v.hopT < 0.1) v.tapped = false; }
      if (ev.phase === 'flight') {
        const T = ev.timeToWater(v), end = v.theta + 0.3 * 2 * Math.PI * T;
        const err = Math.abs(((end - Math.PI) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
        const want = v.flightT > 0.1 && !(err < 0.12 && v.theta > Math.PI) && v.theta < 4 * Math.PI && T > 0.35 && !v.done;
        if (want && hid == null) { hid = _id++; G.onDown(hid, W / 2, H / 2, t); }
        if (!want && hid != null) { G.onUp(hid, t); hid = null; v.done = true; }
        if (!want && v.done && ev.called.tw && v.twistGoal < ev.called.tw && !v.sw && T > 0.5) { v.sw = 1; const i = _id++; G.onDown(i, W / 2, H / 2, t); G.onMove(i, W / 2 + 80, H / 2, t + 0.01); v.swUp = [i, t + 0.05]; }
        if (v.swUp && t >= v.swUp[1]) { G.onUp(v.swUp[0], t); v.swUp = null; v.sw = v.twistGoal < ev.called.tw ? 0 : 1; }
      }
      if (ev.phase === 'scores' && ev.t < 1 / 100) res.push(ev.dv.result);
    }
    out.push('diving me ' + me.total + ' [' + me.scores.join(', ') + '] vs ' + ev.divers.slice(1).map((d) => d.total).join('/') + ' | ' + res.map((r) => r && `${r.som}s ${r.twists}t exe ${r.exe.toFixed(1)}`).join('; '));
  }
  }
  // ---- sj
  {
  const P = await import('/js/events/skijump-physics.js');
  const hold = { id: null };
  const press = (t, x = W / 2, y = H / 2) => { if (hold.id == null) { hold.id = _id++; G.onDown(hold.id, x, y, t); } };
  const move = (t, x, y) => { if (hold.id != null) G.onMove(hold.id, x, y, t); };
  const lift = (t) => { if (hold.id != null) { G.onUp(hold.id, t); hold.id = null; } };
  for (const lean of [true, false]) {
    const ev = await load('skijump'); let guard = 0; const me = ev.jumpers[0]; let st = {}; const log = [];
    while (ev.phase !== 'done' && guard++ < 120 * 400) {
      const t = step();
      if (ev.cur !== me) { st = {}; continue; }
      if (ev.phase === 'gate' && ev.t > 0.4 && !st.go) { st.go = 1; press(t); st.up = t + 0.05; }
      if (st.up && t >= st.up) { lift(t); st.up = 0; }
      if (ev.phase === 'inrun' && !st.j && P.INRUN_LEN - ev.inrun.s <= P.JUMP_ZONE * 0.5) { st.j = 1; press(t); }
      if (ev.phase === 'flight') {
        const f = ev.flight;
        if (!st.f) { st.f = 1; log.push('q=' + f.q.toFixed(2) + ' down=' + G.down + ' mode=' + G.mode + ' wob=' + (ev.inrun.wobSum / ev.inrun.n).toFixed(2)); }
        if (hold.id == null && !st.landed) press(t);
        if (hold.id != null) { if (lean) move(t, W / 2, H / 2 + Math.max(-60, Math.min(60, (f.lean + f.lv * 0.12) * 140)) / G.scale); if (ev.timeToContact() < 0.25) { lift(t); st.landed = 1; } }
        st.maxLean = Math.max(st.maxLean || 0, Math.abs(f.lean));
      }
      if (ev.phase === 'landed' && !st.done) { st.done = 1; log.push('maxLean=' + st.maxLean.toFixed(2) + ' land=' + JSON.stringify(ev.land && { m: ev.land.metres, k: ev.land.kind })); }
    }
    out.push(`skijump lean=${lean}: me ${me.total} vs ` + ev.jumpers.slice(1).map((x) => x.total).join('/') + ' | ' + log.join(' ; '));
  }
  }
  // ---- rest
  {
  const hold = { id: null };
  const press = (t, x = W / 2, y = H / 2) => { if (hold.id == null) { hold.id = _id++; G.onDown(hold.id, x, y, t); } };
  const move = (t, x, y) => { if (hold.id != null) G.onMove(hold.id, x, y, t); };
  const lift = (t) => { if (hold.id != null) { G.onUp(hold.id, t); hold.id = null; } };
  const run = async (name, fn) => { try { out.push(await fn()); } catch (e) { out.push(`${name} ERROR ${e.message} ${String(e.stack).split('\n')[1]}`); } lift(g.time); };
  // curling: aim straight, pull to the yellow mark, rub
  await run('curling', async () => {
    const ev = await load('curling'); let guard = 0; const me = ev.players[0]; let st = {}; let rubX = 0, rubDir = 1;
    while (ev.phase !== 'done' && guard++ < 120 * 600) {
      const t = step();
      if (ev.cur !== me) { st = {}; continue; }
      if (ev.phase === 'aim' && ev.t > 0.5 && !st.a) { st.a = t; press(t); }
      if ((ev.phase === 'power' || ev.phase === 'aim') && st.a && hold.id != null) {
        const want = (ev.midPower ?? 0.5) * 150 + 12;
        move(t, W / 2, H / 2 + Math.min(want, (t - st.a) * 200) / G.scale);
        if ((t - st.a) * 200 > want + 30) { lift(t); st.rub = 1; }
      }
      if (ev.phase === 'slide' && st.rub) { press(t, W / 2, H / 2); rubX += rubDir * 9; if (Math.abs(rubX) > 40) rubDir *= -1; move(t, W / 2 + rubX, H / 2); }
      if (ev.phase === 'settle') { lift(t); st = {}; rubX = 0; }
    }
    return 'curling me ' + me.total + ' vs ' + ev.players.slice(1).map((x) => x.total).join('/') + ' mode=' + G.mode;
  });
  // bobsled: mash, steer onto the line
  await run('bobsled', async () => {
    const ev = await load('bobsled'); let guard = 0; const me = ev.crews[0]; let next = 0, side = 0;
    while (ev.phase !== 'done' && guard++ < 120 * 500) {
      const t = step();
      if (ev.phase === 'intro') { if (ev.t > 0.3 && ev.t < 0.32) tap(t); continue; }
      if (ev.cur !== me) continue;
      const sl = ev.sl;
      if ((ev.phase === 'ready' || ev.phase === 'push') && !sl.inside && t >= next && ev.t > 0.3) { tap(t, side ? W * 0.75 : W * 0.25); side ^= 1; next = t + 1 / 9; }
      if (ev.phase === 'run') { press(t); const e = (sl.star ?? 0) - sl.phi; move(t, W / 2 + Math.max(-56, Math.min(56, e * 160)) / G.scale, H / 2); }
      if (ev.phase === 'finished') lift(t);
    }
    return 'bobsled me ' + me.total + ' (' + me.times.join('+') + ') vs ' + ev.crews.slice(1).map((c) => c.total).join('/') + ' mode=' + G.mode;
  });
  // halfpipe: pump, spin a half turn, let go
  await run('halfpipe', async () => {
    const ev = await load('halfpipe'); let guard = 0; const me = ev.riders[0]; let st = {};
    while (ev.phase !== 'done' && guard++ < 120 * 400) {
      const t = step();
      if (ev.cur !== me) { st = {}; continue; }
      const s = ev.rs;
      if (ev.phase === 'ready' && ev.t > 0.4 && !st.go) { st.go = 1; tap(t); }
      if (ev.phase !== 'ride' || s.out) { lift(t); continue; }
      if (s.air) {
        const a = s.air;
        if (!a.did && a.t > 0.06) { a.did = 1; press(t); move(t + 0.001, W / 2 + 60 / G.scale, H / 2 + (a.T > 0.9 ? 40 : 0) / G.scale); }
        if (a.did && hold.id != null && a.t > Math.min(a.T - 0.45, 0.25 + (a.T > 1 ? 0.3 : 0))) lift(t);
      } else if (!s.pumped && Math.abs(s.q) < 2 && s.crashT <= 0) tap(t);
    }
    return 'halfpipe me ' + me.best + ' ' + JSON.stringify(me.runs) + ' vs ' + ev.riders.slice(1).map((x) => x.best).join('/') + ' mode=' + G.mode;
  });
  // biathlon: push on the flat, ease on the climb; aim and lift
  await run('biathlon', async () => {
    const ev = await load('biathlon'); let guard = 0; const me = ev.skiers[0];
    while (ev.phase !== 'done' && guard++ < 120 * 400) {
      const t = step();
      if (ev.phase !== 'race' || me.finished) { lift(t); continue; }
      if (me.state === 'race' || me.state === 'pen') { const k = ev.kindAt(me.s); if (me.hr < 0.86 && !(k === 'stadium' && me.hr > 0.55 && me.visit < 2 && me.visit === me.lap)) press(t); else lift(t); }
      else if (me.state === 'shoot') {
        const a = me.aim;
        if (a.needLift) { lift(t); continue; }
        if (hold.id == null) { press(t); a._x = W / 2; }
        else { a._x -= Math.max(-3, Math.min(3, a.x * 6)); move(t, a._x, H / 2); if (Math.hypot(a.x, a.y) < 0.3 && a.t - a.t0 > 0.4) lift(t); }
      } else lift(t);
    }
    return 'biathlon ' + ev.skiers.map((s) => `${s.time?.toFixed(1)}(${s.shots.filter((h) => h).length}/${s.shots.length})`).join(' / ') + ' crashes=' + me.crashes + ' mode=' + G.mode;
  });
  }
  return out;
})()
