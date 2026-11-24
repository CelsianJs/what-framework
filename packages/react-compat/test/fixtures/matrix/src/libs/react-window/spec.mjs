const indexes = () => [...document.querySelectorAll('.rw-row')].map((r) => Number(r.dataset.index));

export default {
  packages: ['react-window'],
  exercised: '`List` (v2) over 5,000 rows: only a window is in the DOM, scrolling swaps it, the imperative `scrollToRow`, row props that change, a smaller count',
  async run(t) {
    await t.step('only a window of rows is rendered', async () => {
      await t.until(() => t.page.evaluate(indexes), (list) => list.length >= 10 && list.length < 40 && list[0] === 0, 'a window starting at row 0');
    });
    await t.step('scrolling swaps the window', async () => {
      await t.page.evaluate(() => { document.querySelector('#rw-list').scrollTop = 25000; });
      await t.until(() => t.page.evaluate(indexes), (list) => list.includes(1000) && !list.includes(0), 'row 1000 is rendered and row 0 is not');
    });
    await t.step('scrollToRow', async () => {
      await t.click('#rw-jump');
      await t.until(() => t.page.evaluate(indexes), (list) => list.includes(3000), 'row 3000 is rendered');
      await t.eval(() => document.querySelector('#rw-list').scrollTop, 75000);
    });
    await t.step('row props update the visible rows', async () => {
      await t.click('.rw-row[data-index="3002"]');
      await t.text('#rw-selected', '3002');
      await t.text('.rw-row[data-index="3002"]', 'Row 3002 *');
      await t.attr('.rw-row[data-index="3002"]', 'aria-selected', 'true');
      await t.attr('.rw-row[data-index="3001"]', 'aria-selected', 'false');
    });
    await t.step('a smaller count', async () => {
      await t.click('#rw-shrink');
      await t.until(() => t.page.evaluate(indexes), (list) => list.join(',') === '0,1,2,3', 'rows 0 to 3');
    });
  },
};
