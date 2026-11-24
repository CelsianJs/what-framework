const indexes = () => [...document.querySelectorAll('.rw-row')].map((r) => Number(r.dataset.index));

export default {
  packages: ['react-window'],
  exercised: '`List` (v2) over 5,000 rows: only a window is in the DOM, a row with state of its own keeping it while the window moves, a button in a row that stops its click, row effects mounting and cleaning up with the window, scrolling, the imperative `scrollToRow`, row props that change, a smaller count',
  async run(t) {
    await t.step('only a window of rows is rendered', async () => {
      await t.until(() => t.page.evaluate(indexes), (list) => list.length >= 10 && list.length < 40 && list[0] === 0, 'a window starting at row 0');
    });
    await t.step('a row keeps its own state while the window moves past it', async () => {
      await t.click('.rw-row[data-index="5"] .rw-star');
      await t.attr('.rw-row[data-index="5"]', 'data-starred', 'true');
      await t.text('#rw-selected', '-1');
      await t.page.evaluate(() => { window.__row5 = document.querySelector('.rw-row[data-index="5"]'); document.querySelector('#rw-list').scrollTop = 75; });
      await t.until(() => t.page.evaluate(indexes), (list) => list.includes(5) && list.includes(13), 'rows 5 and 13 are rendered');
      await t.eval(() => [...document.querySelectorAll('.rw-row[data-starred="true"]')].map((r) => r.dataset.index).join(','), '5', 'row 5 is the starred one');
      await t.eval(() => window.__row5 === document.querySelector('.rw-row[data-index="5"]'), true, 'and is the same element');
    });
    await t.step('the rows whose effects ran are the rows in the page', async () => {
      await t.eval(() => globalThis.__rwLive.rows > 0 && globalThis.__rwLive.rows === document.querySelectorAll('.rw-row').length, true, 'mounted rows equal rendered rows');
    });
    await t.step('scrolling swaps the window', async () => {
      await t.page.evaluate(() => { document.querySelector('#rw-list').scrollTop = 25000; });
      await t.until(() => t.page.evaluate(indexes), (list) => list.includes(1000) && !list.includes(0), 'row 1000 is rendered and row 0 is not');
      await t.eval(() => globalThis.__rwLive.rows === document.querySelectorAll('.rw-row').length, true, 'the rows that left were cleaned up');
      await t.count('.rw-row[data-starred="true"]', 0);
    });
    await t.step('scrollToRow', async () => {
      await t.click('#rw-jump');
      await t.until(() => t.page.evaluate(indexes), (list) => list.includes(3000), 'row 3000 is rendered');
      await t.eval(() => document.querySelector('#rw-list').scrollTop, 75000);
    });
    await t.step('row props update the visible rows', async () => {
      await t.click('.rw-row[data-index="3002"]');
      await t.text('#rw-selected', '3002');
      await t.text('.rw-row[data-index="3002"]', /^Row 3002 \*/);
      await t.attr('.rw-row[data-index="3002"]', 'aria-selected', 'true');
      await t.attr('.rw-row[data-index="3001"]', 'aria-selected', 'false');
    });
    await t.step('a smaller count', async () => {
      await t.click('#rw-shrink');
      await t.until(() => t.page.evaluate(indexes), (list) => list.join(',') === '0,1,2,3', 'rows 0 to 3');
      await t.eval(() => globalThis.__rwLive.rows, 4, 'four rows are mounted');
    });
  },
};
