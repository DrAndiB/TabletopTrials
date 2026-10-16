// The Trials, all events with computer players: play each to its results, then the closing ceremony.
(async () => {
  const T = __tt, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  for (let n = 0; n < 14; n++) {
    let s = 0;
    const id = T.game.def.id;
    while ((!T.run().last || T.run().last.def.id !== id) && s < 600) { T.game.simulate(0.5); s += 0.5; await wait(0); }
    for (let k = 0; k < 80 && T.screen() !== 'results'; k++) await wait(100);
    const L = T.run().last;
    out.push(`${id} (${s}s sim): ` + L.rows.map((r) => `${r.place ?? '-'}:${T.run().competitors[r.i].code} ${r.text} ${r.medal || ''}`).join(' | '));
    const last = T.run().index >= T.run().events.length - 1;
    document.querySelector('#btn-next').click();
    if (last) break;
    for (let k = 0; k < 400 && T.screen() !== 'intro'; k++) await wait(100);
    document.querySelector('#btn-intro-go').click();
  }
  await wait(1200);
  out.push(`closing: ${T.screen()} ${document.querySelector('#closing-title').textContent} | ` + [...document.querySelectorAll('#closing-table .mt-row')].slice(1).map((r) => r.textContent.trim()).join(' / '));
  return out;
})()
