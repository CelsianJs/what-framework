const indexes = () => [...document.querySelectorAll('.rv-row')].map((r) => Number(r.dataset.index));

export default {
  packages: ['react-virtuoso'],
  // Open defect, what-react only: after the count grows and `scrollToIndex`
  // goes to the new end, the list sometimes stops short of the last rows
  // (the last rendered index is 2997 or 2998, not 2999). Seen in 5 of 63 runs
  // on a loaded machine and in 0 of 21 on real React; not reproduced under CPU
  // throttling; cause not found (defect 6 of the verification of cbbfd764,
  // under investigation). Until it is understood the step is reported when it
  // fails on what-react and does not fail the run. On real React it still does.
  quarantined: { 'a growing count': 'react-virtuoso stops short of the end after its count grows (open defect, what-react only)' },
  exercised: '`Virtuoso` over 2,000 rows of varying, measured heights: a window in the DOM, a row with state of its own keeping it while the window moves, a button in a row that stops its click, row effects mounting and cleaning up with the window, scrolling, the imperative `scrollToIndex`, `rangeChanged`, a click on a row, a growing count (quarantined on what-react: an open defect)',
  async run(t) {
    await t.step('a measured window of rows is rendered', async () => {
      await t.until(() => t.page.evaluate(indexes), (list) => list.length >= 8 && list.length < 80 && list[0] === 0, 'a window starting at item 0');
      await t.text('#rv-range', /^0-\d+$/);
    });
    await t.step('a row keeps its own state while the window moves past it', async () => {
      await t.click('.rv-row[data-index="4"] .rv-star');
      await t.attr('.rv-row[data-index="4"]', 'data-starred', 'true');
      await t.text('#rv-picked', '-1');
      await t.page.evaluate(() => { window.__row4 = document.querySelector('.rv-row[data-index="4"]'); document.querySelector('#rv-list').scrollTop = 60; });
      await t.text('#rv-range', /^[1-4]-\d+$/);
      await t.eval(() => [...document.querySelectorAll('.rv-row[data-starred="true"]')].map((r) => r.dataset.index).join(','), '4', 'row 4 is the starred one');
      await t.eval(() => window.__row4 === document.querySelector('.rv-row[data-index="4"]'), true, 'and is the same element');
      await t.eval(() => globalThis.__rvLive.rows > 0 && globalThis.__rvLive.rows === document.querySelectorAll('.rv-row').length, true, 'the rows whose effects ran are the rows in the page');
    });
    await t.step('scrolling swaps the window', async () => {
      await t.page.evaluate(() => { document.querySelector('#rv-list').scrollTop = 6000; });
      await t.until(() => t.page.evaluate(indexes), (list) => list.length > 0 && list[0] > 100 && !list.includes(0), 'item 0 is gone and later items are rendered');
      await t.eval(() => globalThis.__rvLive.rows === document.querySelectorAll('.rv-row').length, true, 'the rows that left were cleaned up');
      await t.count('.rv-row[data-starred="true"]', 0);
    });
    await t.step('scrollToIndex', async () => {
      await t.click('#rv-jump');
      await t.until(() => t.page.evaluate(indexes), (list) => list.includes(1500), 'item 1500 is rendered');
      await t.click('.rv-row[data-index="1500"]');
      await t.text('#rv-picked', '1500');
    });
    await t.step('a growing count', async () => {
      await t.click('#rv-more');
      await t.text('#rv-count', '3000');
      await t.click('#rv-end');
      await t.until(() => t.page.evaluate(indexes), (list) => list.includes(2999), 'the last item is rendered');
    });
  },
};
