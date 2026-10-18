// Simulated kids: one human player (seat 1) with the motor skills of a 4-, 7- or 12+-year-old, against
// three computer kids at easy, normal and hard, in every event. Rough developmental assumptions:
// tapping rate and steadiness, reaction time, timing to a predictable moment, release precision,
// steering lag, attention lapses, and how often a second or third rule is remembered.
// URL params: ages=4,7,12  skills=easy,normal,hard  events=sprint,...
(async () => {
  const g = __tt.game, prm = new URLSearchParams(location.search);
  const { EVENTS } = await import('/js/events/index.js');
  const AGES = {
    4: { maxRate: 3.0, cv: 0.3, same: 0.12, lapse: [6, 0.8], rt: [0.75, 0.2], ant: 0.22, hold: 0.25, steer: [0.6, 0.25], rules: 0.3, ruleDelay: 0.6, miss: 0.2, aim: 4 },
    7: { maxRate: 4.5, cv: 0.18, same: 0.04, lapse: [15, 0.4], rt: [0.45, 0.1], ant: 0.11, hold: 0.12, steer: [0.35, 0.14], rules: 0.75, ruleDelay: 0.25, miss: 0.05, aim: 2 },
    12: { maxRate: 6.5, cv: 0.1, same: 0.01, lapse: [0, 0], rt: [0.3, 0.05], ant: 0.06, hold: 0.07, steer: [0.2, 0.08], rules: 0.95, ruleDelay: 0.1, miss: 0.01, aim: 1 },
  };
  const ages = (prm.get('ages') || '4,7,12').split(',');
  const skills = (prm.get('skills') || 'easy,normal,hard').split(',');
  const evIds = (prm.get('events') || EVENTS.map((e) => e.id).join(',')).split(',');
  const rnd = Math.random;
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  function player(P, pad) {
    const S = {};
    const set = (b, d) => { if (pad.held[b] !== d) pad.push(b, d, g.time); };
    const tap = (b) => { pad.push(b, true, g.time); pad.push(b, false, g.time + 0.04); };
    const rt = () => Math.max(0.15, P.rt[0] + gauss() * P.rt[1]);
    const T = { next: 0, side: 'left', lapseUntil: 0, nextLapse: P.lapse[0] ? 2 + rnd() * P.lapse[0] : Infinity };
    // alternate left/right at a cadence, with jitter, wrong-side slips and lapses of attention
    const taps = (target) => {
      const t = g.time, cad = Math.min(P.maxRate, target);
      if (t > T.nextLapse) { T.lapseUntil = t + P.lapse[1] * (0.6 + 0.8 * rnd()); T.nextLapse = T.lapseUntil + P.lapse[0] * (0.5 + rnd()); }
      if (t < T.lapseUntil) return;
      if (!T.next) T.next = t;
      if (t >= T.next) {
        const side = rnd() < P.same ? (T.side === 'left' ? 'right' : 'left') : T.side;
        tap(side);
        T.side = side === 'left' ? 'right' : 'left';
        T.next = t + Math.max(0.06, (1 / cad) * (1 + gauss() * P.cv));
      }
    };
    // steering on what was seen a moment ago, with a dead band
    const hist = [];
    const steer = (err, keys = ['left', 'right']) => {
      hist.push({ t: g.time, err });
      while (hist.length > 2 && hist[1].t < g.time - P.steer[0]) hist.shift();
      const e = hist[0].err;
      set(keys[0], e < -P.steer[1]); set(keys[1], e > P.steer[1]);
    };
    const rule = (key) => { if (S['r_' + key] == null) S['r_' + key] = rnd() < P.rules; return S['r_' + key]; };
    const forget = (key) => { delete S['r_' + key]; };
    return { S, set, tap, rt, taps, steer, rule, forget, P };
  }

  // one policy per event: what a kid of this age does on each step
  const POLICY = {
    sprint(ev, A) { raceStart(ev, A, ev.runners[0], () => ev.whistleAt, () => A.taps(7.2)); },
    hurdles(ev, A) {
      const ru = ev.runners[0], H = Array.from({ length: 10 }, (_, k) => 39 + k * 25.5);
      raceStart(ev, A, ru, () => ev.whistleAt, () => {
        A.taps(4.6);
        const k = ru.next, hx = H[k];
        if (hx != null && A.S.jumped !== k && !ru.air) {
          if (A.S.err == null || A.S.errFor !== k) { A.S.errFor = k; A.S.err = gauss() * A.P.ant; A.S.skip = rnd() < A.P.miss; }
          const tTo = (hx - ru.x - ru.v * 0.22) / Math.max(5, ru.v);
          if (tTo <= A.S.err) { A.S.jumped = k; if (!A.S.skip) A.tap('action'); }
        }
      });
    },
    swimming(ev, A) {
      const s = ev.swimmers[0], c = ev.startCtl;
      if (!c || s.finished) return;
      if (c.phase === 'marks') { if (A.rule('hold')) A.set('action', true); return; }
      if (A.S.go == null) A.S.go = c.whistleAt + A.rt();
      if (g.time < A.S.go) return;
      if (A.S.go && A.P && !A.S.released) { A.S.released = true; A.set('action', false); }
      A.taps(5.2);
      if (s.swimming && s.air < 0.3 && s.breathT < 0) {
        if (A.S.br == null) A.S.br = rnd() < A.P.rules ? g.time + A.rt() + A.P.ruleDelay : Infinity;
        if (g.time >= A.S.br) { A.tap('action'); A.S.br = null; }
      } else if (s.air > 0.5) A.S.br = null;
      if (s.lap === 0 && s.dir > 0 && s.x >= 133 && s.x <= 146 && !s.armed) {
        if (A.S.turnAt == null) A.S.turnAt = rnd() < A.P.rules ? g.time + Math.max(0, A.rt() - 0.2) : Infinity;
        if (g.time >= A.S.turnAt) { A.tap('action'); A.S.turnAt = Infinity; }
      }
    },
    speedskating(ev, A) {
      const s = ev.skaters[0], c = ev.startCtl;
      if (!c || s.finished) return;
      if (c.phase === 'marks') { if (A.rule('hold')) A.set('action', true); return; }
      if (A.S.go == null) A.S.go = c.whistleAt + A.rt();
      if (g.time < A.S.go) return;
      if (!A.S.released) { A.S.released = true; A.set('action', false); }
      A.taps(3.7);
      const bend = ev.at(s).bend > 0;
      if (bend !== A.S.lastBend) { A.S.lastBend = bend; A.S.toggleAt = rnd() < A.P.rules ? g.time + A.rt() + A.P.ruleDelay * 0.5 : Infinity; }
      if (bend !== s.lean && g.time >= (A.S.toggleAt ?? Infinity)) { A.tap('action'); A.S.toggleAt = Infinity; }
    },
    javelin(ev, A) {
      if (!ev.cur || ev.cur.i !== 0) { A.S.thr = null; return; }
      const a = ev.ath;
      if (!(ev.phase === 'ready' || ev.phase === 'runup')) return;
      if (!A.S.thr) A.S.thr = { start: g.time + A.rt(), holdAt: 19 + gauss() * A.P.ant * 25, angle: 35 + gauss() * A.P.hold * 55 };
      const th = A.S.thr;
      if (g.time < th.start) return;
      if (!a.holding && !a.released) A.taps(6.5);
      if (!a.holding && a.started && -a.x <= th.holdAt) A.set('action', true);
      if (a.holding && a.angle >= th.angle) A.set('action', false);
    },
    polevault(ev, A) {
      if (!ev.cur || ev.cur.i !== 0) { A.S.v = null; return; }
      const a = ev.va;
      if (!A.S.v) A.S.v = { start: g.time + A.rt(), plantAt: -17 + gauss() * A.P.ant * 28, relU: 0.7 + gauss() * A.P.hold / 1.05 };
      const p = A.S.v;
      if (g.time < p.start) return;
      if (ev.phase === 'ready' || ev.phase === 'run') {
        if (!a.planted) A.taps(6.5);
        if (a.x >= p.plantAt && !a.planted) A.set('action', true);
      }
      if (ev.phase === 'swing' && a.u >= p.relU) A.set('action', false);
    },
    diving(ev, A) {
      if (!ev.cur || ev.cur.i !== 0) { A.S.d = null; A.set('action', false); return; }
      const v = ev.dv;
      if (!A.S.d) A.S.d = { start: g.time + A.rt(), qn: -1, at: null, tries: rnd() < A.P.rules, twisted: 0 };
      const d = A.S.d;
      if (ev.phase === 'ready' && g.time >= d.start && !d.began) { d.began = true; A.tap('action'); }
      if (ev.phase === 'bounce') {
        const len = 0.56 * (0.7 + 0.3 * v.amp);
        if (d.qn !== v.q.length) { d.qn = v.q.length; d.at = g.time + (len - v.hopT) + gauss() * A.P.ant; if (d.at < g.time + 0.05) d.at += len; }
        if (g.time >= d.at) { A.tap('action'); d.at = Infinity; }
      }
      if (ev.phase === 'flight') {
        if (!d.tries) { A.set('action', v.flightT > 0.1 && v.flightT < (d.rand ??= 0.2 + rnd() * 0.9)); return; }
        const T = ev.timeToWater(v), end = v.theta + 0.6 * Math.PI * T;
        const err = Math.abs(((end - Math.PI) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
        const som = Math.max(0, Math.round((end - Math.PI) / (2 * Math.PI))) + 0.5;
        const target = ev.called.som ?? 1.5;
        if (d.openAt == null && v.flightT > 0.1 && err < 0.3 && som === target) d.openAt = g.time + gauss() * A.P.hold;
        A.set('action', v.flightT > 0.1 && (d.openAt == null || g.time < d.openAt));
        if (ev.called.tw && d.openAt != null && g.time > d.openAt + A.rt() * 0.5 && d.twisted < 2) { A.tap('right'); d.twisted++; }
      }
    },
    skijump(ev, A) {
      if (!ev.cur || ev.cur.i !== 0) { A.S.j = null; A.set('left', false); A.set('right', false); return; }
      if (!A.S.j) A.S.j = { gate: g.time + A.rt(), jumpErr: gauss() * A.P.ant, landErr: gauss() * A.P.ant, missJump: rnd() < A.P.miss, missLand: rnd() < A.P.miss * 2 };
      const j = A.S.j;
      if (ev.phase === 'gate' && g.time >= j.gate && !j.g) { j.g = true; A.tap('action'); }
      if (ev.phase === 'inrun') {
        const st = ev.inrun;
        A.steer(-st.wobble, ['left', 'right']);
        if (!j.jumped && 99 - st.s <= 3 + j.jumpErr * Math.max(10, st.v) && !j.missJump) { j.jumped = true; A.tap('action'); }
      }
      if (ev.phase === 'flight') {
        const f = ev.flight;
        A.steer(-(f.lean + f.lv * 0.12), ['left', 'right']);
        if (!j.landed && ev.timeToContact() < 0.22 + j.landErr && !j.missLand) { j.landed = true; A.tap('action'); }
      }
      if (ev.phase === 'landed') { A.set('left', false); A.set('right', false); }
    },
    curling(ev, A) {
      if (!ev.cur || ev.cur.i !== 0) { A.S.c = null; A.set('left', false); A.set('right', false); A.set('action', false); return; }
      if (!A.S.c) A.S.c = { aim: gauss() * A.P.aim, start: g.time + A.rt() * 2, pErr: gauss() * A.P.hold / 1.3, sweeps: rnd() < A.P.rules };
      const c = A.S.c;
      if (ev.phase === 'aim') {
        const d = c.aim - ev.aim;
        A.set('left', d < -0.3); A.set('right', d > 0.3);
        if (g.time > c.start && Math.abs(d) <= 0.4) { A.set('left', false); A.set('right', false); A.set('action', true); }
      }
      if (ev.phase === 'power' && ev.powerDir > 0 && ev.power >= (ev.midPower ?? 0.6) + c.pErr) A.set('action', false);
      if (ev.phase === 'slide' && c.sweeps && ev.thrown) {
        const s = ev.thrown, v = Math.hypot(s.vx, s.vz);
        if (s.x + (v * v) / (2 * 6.2) < 138) A.taps(6);
      }
    },
    bobsled(ev, A) {
      if (ev.phase === 'intro') return;
      if (!ev.cur || ev.cur.i !== 0) { A.S.b = null; A.set('left', false); A.set('right', false); return; }
      const sl = ev.sl;
      if (!A.S.b) A.S.b = { start: g.time + A.rt(), jumpAt: rnd() < A.P.rules ? 26.5 + gauss() * A.P.ant * 16 : 99 };
      const b = A.S.b;
      if (g.time < b.start) return;
      if ((ev.phase === 'ready' || ev.phase === 'push') && !sl.inside) {
        A.taps(6);
        if (sl.s >= b.jumpAt) A.tap('action');
      }
      if (ev.phase === 'run') A.steer((sl.star ?? 0) - sl.phi);
    },
    halfpipe(ev, A) {
      if (!ev.cur || ev.cur.i !== 0) { A.S.h = null; A.set('left', false); A.set('right', false); A.set('action', false); return; }
      const s = ev.rs;
      if (!A.S.h) A.S.h = { start: g.time + A.rt(), n: 0 };
      const h = A.S.h;
      if (ev.phase === 'ready' && g.time >= h.start && !h.drop) { h.drop = true; A.tap('action'); }
      if (ev.phase !== 'ride' || !s) return;
      const share = A.P.rules > 0.9 ? 0.8 : A.P.rules > 0.5 ? 0.45 : 0;
      if (!s.air) {
        if (h.plan) { A.set('left', false); A.set('right', false); A.set('action', false); h.n++; h.plan = null; }
        if (h.pumpAt == null && Math.abs(s.q) < 11 && Math.sign(s.q) !== s.dir) h.pumpAt = rnd() < 1 - A.P.miss ? Math.abs(gauss() * A.P.ant * (s.v || 30)) : -1;
        if (h.pumpAt != null && h.pumpAt >= 0 && !s.pumped && Math.abs(s.q) <= h.pumpAt + 0.3) { A.tap('action'); h.pumpAt = null; }
        if (Math.abs(s.q) > 11) h.pumpAt = null;
        return;
      }
      const a = s.air;
      if (!h.plan) h.plan = { halves: Math.floor((a.T - 0.35) * 1.6 * 2 * share), dir: h.n % 2 ? 'left' : 'right', grab: share > 0.6 && h.n % 2 === 1 && a.T > 0.8, react: A.rt() * 0.5 };
      const p = h.plan;
      A.set(p.dir, p.halves > 0 && a.t > p.react && a.spun < (p.halves - 1) / 2 + 0.08 + A.P.hold * 1.6 * gauss() * 0.5);
      A.set('action', p.grab && a.t > p.react && a.t < a.T - 0.25 - A.P.hold);
    },
    biathlon(ev, A) {
      const sk = ev.skiers[0];
      if (ev.phase !== 'race' || sk.finished) return;
      if (sk.state === 'race' || sk.state === 'pen') {
        const seg = sk.state === 'pen' ? 'flat' : ev.kindAt(sk.s);
        const climb = seg === 'climb' || seg === 'top';
        if (seg !== 'descent') A.taps(climb ? 7.5 : 5.6);
        // tuck on the way down if remembered, stand up a reaction time after the descent ends
        if (seg === 'descent') { if (A.S.tuck == null) A.S.tuck = A.rule('tuck' + sk.lap); A.S.standAt = null; A.set('action', A.S.tuck); } else {
          if (A.S.standAt == null) A.S.standAt = g.time + A.rt() - 0.15;
          if (g.time >= A.S.standAt) { A.set('action', false); A.S.tuck = null; A.forget('tuck' + sk.lap); }
        }
      }
      if (sk.state === 'shoot') {
        A.set('action', false);
        A.steer(-sk.aim.x);
        if (g.time > (A.S.fired || 0) + A.rt() && Math.hypot(sk.aim.x, sk.aim.y) < 0.45 + A.P.aim * 0.05) { A.tap('action'); A.S.fired = g.time; }
      } else if (sk.state !== 'race') { A.set('left', false); A.set('right', false); }
    },
  };
  // the start of a race on the whistle (sprint, hurdles): hold action if remembered, then go after a reaction time
  function raceStart(ev, A, ru, whistle, run) {
    if (ev.phase === 'set' || ev.phase === 'marks' || ev.phase === 'walk') { if (A.rule('hold')) A.set('action', true); return; }
    if ((ev.phase === 'race' || ev.phase === 'finishing') && !ru.finished && whistle() != null) {
      if (A.S.go == null) A.S.go = whistle() + A.rt();
      if (g.time < A.S.go) return;
      if (!A.S.released) { A.S.released = true; A.set('action', false); }
      run();
    }
  }

  const out = [];
  let captured = null;
  g.onEventEnd = ({ results }) => { captured = results; };
  for (const id of evIds) {
    const def = EVENTS.find((e) => e.id === id);
    const line = [id];
    for (const age of ages) for (const skill of skills) {
      const comps = g.competitors.map((c, i) => (i ? { ...c, type: 'cpu', human: false } : { ...c, type: 'keys', human: true }));
      captured = null;
      await g.load(def, comps, { skill, seed: 7 });
      g.start();
      const A = player(AGES[age], g.competitors[0].pad);
      const pol = POLICY[id];
      let guard = 0;
      while (!captured && guard++ < 120 * 700) { pol(g.ev, A); g.simulate(1 / 120); }
      if (!captured) { line.push(`${age}/${skill}: timeout`); continue; }
      const lower = def.better === 'lower', val = (r) => (r.dnf || r.value == null ? null : r.value);
      const me = val(captured[0]), others = captured.slice(1).map(val).filter((x) => x != null);
      const better = (a, b) => (lower ? a < b : a > b);
      const place = me == null ? 4 : 1 + others.filter((o) => better(o, me)).length;
      const best = others.length ? (lower ? Math.min(...others) : Math.max(...others)) : null;
      line.push(`${age}/${skill}: #${place} ${captured[0].short || captured[0].text} (best cpu ${best == null ? '-' : captured[captured.slice(1).findIndex((r) => val(r) === best) + 1].short})`);
    }
    out.push(line.join(' | '));
  }
  return out;
})()
