// The Trials flow, part 3: the closing ceremony.
(async () => {
  const T = __tt, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('#btn-next').click();
  await wait(1200);
  return { screen: T.screen(), title: document.querySelector('#closing-title').textContent, rows: [...document.querySelectorAll('#closing-table .mt-row')].map((r) => r.textContent.trim()) };
})()
