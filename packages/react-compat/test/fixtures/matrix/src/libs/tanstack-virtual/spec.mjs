const indexes = () => [...document.querySelectorAll('.tv-row')].map((r) => Number(r.dataset.index));

export default {
  packages: ['@tanstack/react-virtual'],
  exercised: '`useVirtualizer` over 10,000 rows of two heights: only a window is in the DOM, scrolling swaps the window, `scrollToIndex`, `measureElement` refs, a click on a virtual row, a smaller count',
  async run(t) {
    await t.step('only a window of rows is rendered', async () => {
      await t.eval(() => document.querySelectorAll('.tv-row').length > 5 && document.querySelectorAll('.tv-row').length < 30, true, 'between 5 and 30 rows are in the DOM');
      await t.eval(() => document.querySelector('.tv-row').textContent, 'Row 0');
      await t.text('#tv-total', '400000');
    });
    await t.step('scrolling renders the rows at the new offset', async () => {
      await t.page.evaluate(() => { document.querySelector('#tv-scroll').scrollTop = 40000; });
      await t.until(() => t.page.evaluate(indexes), (list) => list.includes(1000) && !list.includes(0), 'row 1000 is rendered and row 0 is not');
      await t.eval(() => document.querySelectorAll('.tv-row').length < 30, true);
    });
    await t.step('scrollToIndex', async () => {
      await t.click('#tv-jump');
      await t.until(() => t.page.evaluate(indexes), (list) => list.includes(5000), 'row 5000 is rendered');
      await t.eval(() => document.querySelector('#tv-scroll').scrollTop, 200000);
    });
    await t.step('a click on a virtual row', async () => {
      await t.click('.tv-row[data-index="5001"]');
      await t.text('#tv-selected', '5001');
    });
    await t.step('a smaller count', async () => {
      await t.click('#tv-shrink');
      await t.text('#tv-total', '800');
      await t.until(() => t.page.evaluate(indexes), (list) => list.length > 0 && Math.max(...list) === 19, 'the last row is 19');
    });
  },
};
