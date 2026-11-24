const indexes = () => [...document.querySelectorAll('.tv-row')].map((r) => Number(r.dataset.index));

export default {
  packages: ['@tanstack/react-virtual'],
  exercised: '`useVirtualizer` over 10,000 rows of two heights: only a window is in the DOM, a row that grows and is measured again through its `measureElement` ref, a row with state of its own keeping it while the window moves, a button in a row that stops its click, row effects mounting and cleaning up with the window, scrolling, `scrollToIndex`, a click on a virtual row, a smaller count',
  async run(t) {
    await t.step('only a window of rows is rendered', async () => {
      await t.eval(() => document.querySelectorAll('.tv-row').length > 5 && document.querySelectorAll('.tv-row').length < 30, true, 'between 5 and 30 rows are in the DOM');
      await t.eval(() => document.querySelector('.tv-row').textContent.startsWith('Row 0'), true);
      await t.text('#tv-total', '400000');
      await t.eval(() => globalThis.__tvLive.rows > 0 && globalThis.__tvLive.rows === document.querySelectorAll('.tv-row').length, true, 'the rows whose effects ran are the rows in the page');
    });
    await t.step('a row that grows is measured again through its ref', async () => {
      await t.click('.tv-row[data-index="2"] .tv-grow');
      await t.attr('.tv-row[data-index="2"]', 'data-tall', 'true');
      await t.text('#tv-total', '400070');
      await t.eval(() => document.querySelector('.tv-row[data-index="3"]').style.transform, 'translateY(200px)', 'the next row moved down');
      await t.text('#tv-selected', '-1');
    });
    await t.step('the row keeps its state while the window moves past it', async () => {
      await t.page.evaluate(() => { window.__row2 = document.querySelector('.tv-row[data-index="2"]'); document.querySelector('#tv-scroll').scrollTop = 300; });
      await t.until(() => t.page.evaluate(indexes), (list) => list.includes(2) && !list.includes(0), 'the window moved past row 0 and row 2 is still rendered');
      await t.eval(() => [...document.querySelectorAll('.tv-row[data-tall="true"]')].map((r) => r.dataset.index).join(','), '2', 'row 2 is the tall one');
      await t.eval(() => window.__row2 === document.querySelector('.tv-row[data-index="2"]'), true, 'and is the same element');
      await t.eval(() => globalThis.__tvLive.rows === document.querySelectorAll('.tv-row').length, true, 'mounted rows equal rendered rows');
      await t.click('.tv-row[data-index="2"] .tv-grow');
      await t.text('#tv-total', '400000');
    });
    await t.step('scrolling renders the rows at the new offset', async () => {
      await t.page.evaluate(() => { document.querySelector('#tv-scroll').scrollTop = 40000; });
      await t.until(() => t.page.evaluate(indexes), (list) => list.includes(1000) && !list.includes(0), 'row 1000 is rendered and row 0 is not');
      await t.eval(() => document.querySelectorAll('.tv-row').length < 30, true);
      await t.eval(() => globalThis.__tvLive.rows === document.querySelectorAll('.tv-row').length, true, 'the rows that left were cleaned up');
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
