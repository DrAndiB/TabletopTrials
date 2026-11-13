// Phone mode through the menus: one touch player with gestures, one event. Intro card with the gesture
// how-to, the event itself (sprint, tapped with two thumbs), results, then "Again" straight back to the start.
// query: autostart=1&event=sprint&p=touch,cpu,cpu,cpu&quality=low   (a phone-sized window, e.g. 412x915)
(async () => {
  const T = __tt, G = T.gestures, wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = [];
  const until = async (fn, n = 150) => { for (let k = 0; k < n && !fn(); k++) await wait(100); return fn(); };
  const S = T.settings();
  S.mode = 'single'; S.event = 'sprint'; S.teams[0].type = 'touch'; S.controls = 'gestures';
  T.startRun();
  await until(() => T.screen() === 'intro');
  out.push(`intro: ${T.screen()} · gesture how-to lines ${document.querySelectorAll('#intro-how .how-ph').length} · "${document.querySelector('#intro-players').textContent.trim()}"`);
  document.querySelector('#btn-intro-go').click();
  out.push(`started: screen ${T.screen()} · state ${T.game.state} · scheme ${G.mode} · body.phone ${document.body.classList.contains('phone')} · pads shown ${document.querySelector('#touch').classList.contains('show')} · gesture layer ${getComputedStyle(document.querySelector('#gest')).display}`);
  const play = async () => {
    const ev = T.game.ev; let next = 0, side = 0, id = 1, guard = 0;
    while (T.game.state !== 'done' && guard++ < 120 * 60) {
      T.game.simulate(1 / 120); const t = T.game.time;
      if ((ev.phase === 'race' || ev.phase === 'finishing') && !ev.runners[0].finished && t >= next && t > ev.whistleAt + 0.2) { const i = id++; G.onDown(i, side ? innerWidth * 0.75 : innerWidth * 0.25, innerHeight * 0.7, t); G.onUp(i, t + 0.03); side ^= 1; next = t + 1 / 9; }
    }
    await until(() => T.screen() === 'results');
    return T.run().last.rows.map((r) => `${r.place}:${T.run().competitors[r.i].code} ${r.text}`).join(' | ');
  };
  out.push('results 1: ' + await play() + ` · record line "${document.querySelector('#results-record').textContent}" · button "${document.querySelector('#btn-next').textContent.trim()}"`);
  document.querySelector('#btn-next').click();
  await until(() => T.screen() === 'none' && T.game.state === 'running');
  out.push(`again: screen ${T.screen()} (no intro card) · state ${T.game.state} · scheme ${G.mode}`);
  out.push('results 2: ' + await play());
  return out;
})()
