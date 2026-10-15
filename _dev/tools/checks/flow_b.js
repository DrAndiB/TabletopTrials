// The Trials flow, part 2: next event (ski jump) through intro, play it out, results.
(async () => {
  const T = __tt, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('#btn-next').click();
  for (let k = 0; k < 300 && T.screen() !== 'intro'; k++) await wait(100);
  const intro = document.querySelector('#intro-title').textContent + ' / ' + document.querySelector('#intro-kicker').textContent;
  document.querySelector('#btn-intro-go').click();
  let s = 0;
  while (T.run().last.def.id !== 'skijump' && s < 200) { T.game.simulate(0.5); s += 0.5; await wait(0); }
  for (let k = 0; k < 60 && T.screen() !== 'results'; k++) await wait(100);
  const L = T.run().last;
  return { intro, simSeconds: s, screen: T.screen(), event: L.def.id, rows: L.rows.map((r) => `${r.place}:${T.run().competitors[r.i].code} ${r.text} [${r.sub}] ${r.medal || ''}`), next: document.querySelector('#btn-next').textContent, tally: T.run().tally };
})()
