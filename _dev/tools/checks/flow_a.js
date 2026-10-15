// The Trials flow, part 1: run the sprint to its results screen.
(async () => {
  const T = __tt, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let s = 0;
  while (!T.run().last && s < 90) { T.game.simulate(0.5); s += 0.5; await wait(0); }
  for (let k = 0; k < 60 && T.screen() !== 'results'; k++) await wait(100);
  const L = T.run().last;
  return { screen: T.screen(), event: L.def.id, rows: L.rows.map((r) => `${r.place}:${T.run().competitors[r.i].code} ${r.text} ${r.medal || ''}`), next: document.querySelector('#btn-next').textContent, tally: T.run().tally };
})()
