const indexes = () => [...document.querySelectorAll('.rv-row')].map((r) => Number(r.dataset.index));

export default {
  packages: ['react-virtuoso'],
  exercised: '`Virtuoso` over 2,000 rows of varying, measured heights: a window in the DOM, scrolling, the imperative `scrollToIndex`, `rangeChanged`, a click on a row, a growing count',
  async run(t) {
    await t.step('a measured window of rows is rendered', async () => {
      await t.until(() => t.page.evaluate(indexes), (list) => list.length >= 8 && list.length < 80 && list[0] === 0, 'a window starting at item 0');
      await t.text('#rv-range', /^0-\d+$/);
    });
    await t.step('scrolling swaps the window', async () => {
      await t.page.evaluate(() => { document.querySelector('#rv-list').scrollTop = 6000; });
      await t.until(() => t.page.evaluate(indexes), (list) => list.length > 0 && list[0] > 100 && !list.includes(0), 'item 0 is gone and later items are rendered');
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
