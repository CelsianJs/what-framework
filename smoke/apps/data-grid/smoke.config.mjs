// Data grid smoke contract.
//
// 10,000 rows is where an implementation that works for the 7-row tables of
// the other apps stops working: a computed that is cheap at 7 is a frame at
// 10,000, and a binding that leaks one listener per row leaks 10,000. So this
// app's checks carry time budgets as well as answers, and every expected
// answer is computed here from the same seeded data the app renders, never
// read back from the page.
//
// Timings are taken inside the page with performance.now(): from the event
// dispatch to the point where the framework's microtask flush has run and the
// DOM shows the result (a setTimeout(0) after the dispatch). Budgets follow
// RAIL: 100 ms for a response to a click, 50 ms per keystroke. Each is the
// median of several runs, so one GC pause does not decide a check.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { serveViteApp, withPage } from '../../harness/index.mjs';

const BUDGET = { sort: 100, keystroke: 50, selectAll: 100, bulk: 100, scroll: 50 };
const ROW_HEIGHT = 32;
const MAX_ROWS_IN_DOM = Math.ceil(544 / ROW_HEIGHT) + 1 + 2 * 6;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
// -1 is a run whose result never reached the DOM: it fails the budget.
const within = (xs, budget) => xs.every((t) => t >= 0) && median(xs) <= budget;
const ms = (n) => (n < 0 ? 'never' : `${n.toFixed(1)}ms`);
const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n) => n.toLocaleString('en-US');

function sums(rows) {
  let qty = 0;
  let value = 0;
  for (const r of rows) { qty += r.qty; value += r.qty * r.price; }
  return { rows: rows.length, qty, value };
}

// Runs in the page: act, then wait until the DOM shows the result (`done`,
// polled after the microtask flush and then once per frame). Returns the
// elapsed milliseconds, or -1 when the DOM never showed it.
const TIMED = `
  window.__timed = async (act, done = () => true) => {
    const t0 = performance.now();
    act();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 120 && !done(); i++) await new Promise((r) => requestAnimationFrame(r));
    return done() ? performance.now() - t0 : -1;
  };
  window.__firstRow = () => Number(document.querySelector('[data-window] [data-row]')?.dataset.row);
`;

export default {
  description: 'Compiled SPA over 10,000 rows: virtual scroll, sort, filter, selection, inline edit, derived summary, 1,000-row bulk update, with time budgets.',

  // WHAT_SMOKE_MODE=dev serves the app on its Vite dev server (smoke/README.md).
  dev: true,

  covers: [
    'list:large',
    'list:virtual-scroll',
    'perf:budget',
    'state:global-store',
    'state:computed',
    'cmp:inline-edit',
  ],

  async check({ workDir, appPort, mode, browser, check, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;
    const { makeRows } = await import(pathToFileURL(join(workDir, 'src/data.js')).href);
    const ROWS = makeRows();

    await serveViteApp({ mode, workDir, appPort, run, reporter });

    await withPage(browser, `${base}/`, async (page, diag) => {
      await page.waitForSelector('[data-row]');
      await page.evaluate(TIMED);

      const text = (sel) => page.$eval(sel, (el) => el.textContent.trim());
      const domRows = () => page.$$eval('[data-window] [data-row]', (els) => els.map((el) => Number(el.dataset.row)));
      const summary = async () => ({
        rows: await text('[data-sum-rows]'),
        qty: await text('[data-sum-qty]'),
        value: await text('[data-sum-value]'),
      });

      // === Initial render: the summary is over all 10,000 =====================
      const all = sums(ROWS);
      const first = await summary();
      check('list:large',
        first.rows === '10,000 rows' && first.qty === num(all.qty) && first.value === money(all.value),
        'the summary row derives over all 10,000 rows',
        `rows="${first.rows}" qty=${first.qty} (want ${num(all.qty)}) value=${first.value} (want ${money(all.value)})`);

      // === Virtual scroll ====================================================
      // Scroll through the whole set. At every stop the slice in the DOM is
      // bounded and is the slice for that position, and the page's element
      // count stays where it started.
      // Elements outside the rendered rows: constant, whatever the slice.
      const elements = () => page.evaluate(() => {
        const rows = document.querySelectorAll('[data-window] [data-row]');
        let inRows = 0;
        for (const r of rows) inRows += 1 + r.getElementsByTagName('*').length;
        return document.getElementsByTagName('*').length - inRows;
      });
      const startElements = await elements();
      const stops = [0.1, 0.25, 0.5, 0.75, 1, 0.33, 0];
      const scrollTimes = [];
      const scrollProblems = [];
      let maxRows = 0;
      let maxElements = startElements;
      for (const f of stops) {
        const top = Math.round(f * (ROWS.length * ROW_HEIGHT - 544));
        const t = await page.evaluate((y) => window.__timed(() => {
          const vp = document.querySelector('[data-viewport]');
          vp.scrollTop = y;
          vp.dispatchEvent(new Event('scroll'));
        }, () => !!document.querySelector(`[data-window] [data-row="${Math.floor(y / 32) + 1}"]`)), top);
        scrollTimes.push(t);
        const ids = await domRows();
        maxRows = Math.max(maxRows, ids.length);
        maxElements = Math.max(maxElements, await elements());
        const firstVisible = Math.floor(top / ROW_HEIGHT);
        // The view is in id order, so the row at index i has id i + 1.
        if (!ids.includes(firstVisible + 1)) scrollProblems.push(`at ${f}: row ${firstVisible + 1} not rendered (${ids[0]}..${ids.at(-1)})`);
        if (ids.some((id, i) => i > 0 && id !== ids[i - 1] + 1)) scrollProblems.push(`at ${f}: slice not contiguous`);
      }
      await page.evaluate(() => { document.querySelector('[data-viewport]').scrollTop = 0; });
      check('list:virtual-scroll',
        scrollProblems.length === 0 && maxRows <= MAX_ROWS_IN_DOM && maxElements === startElements,
        'scrolling 10,000 rows keeps the DOM bounded and shows the slice for the position',
        `max-rows=${maxRows} (bound ${MAX_ROWS_IN_DOM}) other-elements ${startElements}->${maxElements} ${scrollProblems.join('; ')}`);
      check('perf:budget', within(scrollTimes, BUDGET.scroll),
        `a scroll step settles within ${BUDGET.scroll}ms`,
        `median=${ms(median(scrollTimes))} max=${ms(Math.max(...scrollTimes))}`);

      // === Sort ==============================================================
      // Qty ascending, then descending, then back to SKU, three times over.
      const byQty = [...ROWS].sort((a, b) => (a.qty - b.qty) || (a.id - b.id));
      const byQtyDesc = [...ROWS].sort((a, b) => (b.qty - a.qty) || (b.id - a.id));
      const sortTimes = [];
      let sortedHead = null;
      let sortedTail = null;
      for (let i = 0; i < 3; i++) {
        sortTimes.push(await page.evaluate((id) => window.__timed(() => document.querySelector('[data-sort="qty"]').click(),
          () => window.__firstRow() === id), byQty[0].id));
        if (i === 0) sortedHead = (await domRows()).slice(0, 3);
        sortTimes.push(await page.evaluate((id) => window.__timed(() => document.querySelector('[data-sort="qty"]').click(),
          () => window.__firstRow() === id), byQtyDesc[0].id));
        if (i === 0) sortedTail = (await domRows()).slice(0, 3);
        await page.evaluate(() => window.__timed(() => document.querySelector('[data-sort="sku"]').click()));
      }
      const wantHead = byQty.slice(0, 3).map((r) => r.id);
      const wantTail = byQtyDesc.slice(0, 3).map((r) => r.id);
      reporter.assert(
        JSON.stringify(sortedHead) === JSON.stringify(wantHead) && JSON.stringify(sortedTail) === JSON.stringify(wantTail),
        'sorting by quantity orders all 10,000 rows both ways',
        `asc=${sortedHead} (want ${wantHead}) desc=${sortedTail} (want ${wantTail})`);
      check('perf:budget', within(sortTimes, BUDGET.sort),
        `sorting 10,000 rows settles within ${BUDGET.sort}ms`,
        `median=${ms(median(sortTimes))} max=${ms(Math.max(...sortTimes))}`);

      // === Filter, one keystroke at a time =====================================
      const term = 'brass';
      const match = (q) => ROWS.filter((r) => r.name.includes(q) || r.sku.toLowerCase().includes(q));
      const wantCounts = [...term].map((_, i) => `${num(match(term.slice(0, i + 1)).length)} rows`);
      const keyTimes = await page.evaluate(async ([word, counts]) => {
        const input = document.querySelector('[data-filter]');
        const sum = document.querySelector('[data-sum-rows]');
        const out = [];
        for (let i = 1; i <= word.length; i++) {
          out.push(await window.__timed(() => {
            input.value = word.slice(0, i);
            input.dispatchEvent(new InputEvent('input', { bubbles: true, data: word[i - 1], inputType: 'insertText' }));
          }, () => sum.textContent === counts[i - 1]));
        }
        return out;
      }, [term, wantCounts]);
      const filtered = match(term);
      const afterFilter = await summary();
      const filteredIds = await domRows();
      check('state:computed',
        afterFilter.rows === `${num(filtered.length)} rows` && afterFilter.value === money(sums(filtered).value)
          && filteredIds[0] === filtered[0].id,
        'the filtered view and its summary follow each keystroke',
        `rows="${afterFilter.rows}" (want ${num(filtered.length)}) value=${afterFilter.value} (want ${money(sums(filtered).value)}) first=${filteredIds[0]}`);
      check('perf:budget', within(keyTimes, BUDGET.keystroke),
        `a filter keystroke over 10,000 rows settles within ${BUDGET.keystroke}ms`,
        `per-key=${keyTimes.map(ms).join(',')}`);
      // Clear the filter the way a user does: select all, delete.
      await page.fill('[data-filter]', '');
      await page.waitForFunction(() => document.querySelector('[data-sum-rows]').textContent === '10,000 rows');

      // === Select all 10,000, then one warehouse ================================
      const selectAllTimes = [];
      for (let i = 0; i < 3; i++) {
        selectAllTimes.push(await page.evaluate(() => window.__timed(() => document.querySelector('[data-select-all]').click(),
          () => document.querySelector('[data-selected-count]').textContent === '10,000 selected')));
        if (i === 0) {
          const state = await page.evaluate(() => ({
            count: document.querySelector('[data-selected-count]').textContent,
            boxes: [...document.querySelectorAll('[data-window] [data-row] input[type=checkbox]')].map((b) => b.checked),
            header: document.querySelector('[data-select-all]').checked,
          }));
          reporter.assert(state.count === '10,000 selected' && state.header && state.boxes.every(Boolean),
            'select-all selects every row and every rendered checkbox shows it',
            `count="${state.count}" header=${state.header} rendered-checked=${state.boxes.filter(Boolean).length}/${state.boxes.length}`);
        }
        selectAllTimes.push(await page.evaluate(() => window.__timed(() => document.querySelector('[data-select-all]').click(),
          () => document.querySelector('[data-selected-count]').textContent === '0 selected')));
      }
      check('perf:budget', within(selectAllTimes, BUDGET.selectAll),
        `select-all and deselect-all over 10,000 rows settle within ${BUDGET.selectAll}ms`,
        `median=${ms(median(selectAllTimes))} max=${ms(Math.max(...selectAllTimes))}`);

      // === Bulk update: one warehouse, 1,000 rows, +10% ========================
      await page.selectOption('[data-warehouse]', 'Berlin');
      await page.waitForFunction(() => document.querySelector('[data-sum-rows]').textContent === '1,000 rows');
      await page.click('[data-select-all]');
      await page.waitForFunction(() => document.querySelector('[data-selected-count]').textContent === '1,000 selected');
      const bulkTimes = [];
      let expected = ROWS;
      for (let i = 0; i < 3; i++) {
        bulkTimes.push(await page.evaluate(() => {
          const sum = document.querySelector('[data-sum-value]');
          const was = sum.textContent;
          return window.__timed(() => document.querySelector('[data-reprice]').click(), () => sum.textContent !== was);
        }));
        expected = expected.map((r) => (r.warehouse === 'Berlin' ? { ...r, price: Math.round(r.price * 1.1 * 100) / 100 } : r));
      }
      const berlin = expected.filter((r) => r.warehouse === 'Berlin');
      const afterBulk = await summary();
      const firstBerlin = await page.evaluate(() => {
        const row = document.querySelector('[data-window] [data-row]');
        return { id: Number(row.dataset.row), price: row.querySelector('[data-cell="price"]').textContent.trim() };
      });
      const lastBulk = await text('[data-last-bulk]');
      reporter.assert(
        afterBulk.value === money(sums(berlin).value) && lastBulk === 'Repriced 1,000 rows by 10%'
          && firstBerlin.price === money(berlin.find((r) => r.id === firstBerlin.id).price),
        'a bulk reprice of 1,000 rows lands in the rows and in the summary',
        `value=${afterBulk.value} (want ${money(sums(berlin).value)}) "${lastBulk}" row ${firstBerlin.id} ${firstBerlin.price}`);
      check('perf:budget', within(bulkTimes, BUDGET.bulk),
        `a 1,000-row bulk update settles within ${BUDGET.bulk}ms`,
        `median=${ms(median(bulkTimes))} max=${ms(Math.max(...bulkTimes))}`);
      await page.click('[data-clear]');
      await page.selectOption('[data-warehouse]', 'all');
      await page.waitForFunction(() => document.querySelector('[data-sum-rows]').textContent === '10,000 rows');

      // === Inline editing ======================================================
      const cell = (id, key) => `[data-window] [data-row="${id}"] [data-cell="${key}"]`;
      const before = await summary();

      await page.dblclick(cell(3, 'name'));
      await page.waitForSelector(`${cell(3, 'name')} [data-cell-input]`);
      const focused = await page.evaluate(() => document.activeElement?.hasAttribute('data-cell-input'));
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('titanium sprocket 99');
      await page.keyboard.press('Enter');
      await page.waitForFunction((sel) => !document.querySelector(`${sel} [data-cell-input]`), cell(3, 'name'));
      const renamed = await text(cell(3, 'name'));

      // Escape leaves the value as it was.
      await page.dblclick(cell(4, 'qty'));
      await page.waitForSelector(`${cell(4, 'qty')} [data-cell-input]`);
      await page.keyboard.type('12345');
      await page.keyboard.press('Escape');
      const kept = await text(cell(4, 'qty'));

      // A quantity edit moves the summary by exactly the change.
      const row5 = ROWS[4];
      await page.dblclick(cell(5, 'qty'));
      await page.waitForSelector(`${cell(5, 'qty')} [data-cell-input]`);
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type(String(row5.qty + 1000));
      await page.keyboard.press('Enter');
      await page.waitForFunction((sel) => !document.querySelector(`${sel} [data-cell-input]`), cell(5, 'qty'));
      const edited = await summary();
      const wantQty = all.qty + 1000;

      // Scroll the edited rows away and back: they are rebuilt from the store.
      await page.evaluate(() => window.__timed(() => {
        const vp = document.querySelector('[data-viewport]');
        vp.scrollTop = 160000;
        vp.dispatchEvent(new Event('scroll'));
      }));
      await page.evaluate(() => window.__timed(() => {
        const vp = document.querySelector('[data-viewport]');
        vp.scrollTop = 0;
        vp.dispatchEvent(new Event('scroll'));
      }));
      const renamedAfterScroll = await text(cell(3, 'name'));

      check('cmp:inline-edit',
        focused && renamed === 'titanium sprocket 99' && kept === num(ROWS[3].qty)
          && edited.qty === num(wantQty) && before.qty === num(all.qty) && renamedAfterScroll === renamed,
        'double-click edits a cell: Enter commits, Escape cancels, the summary follows, the edit survives a scroll',
        `focused=${focused} name="${renamed}" escaped-qty=${kept} (want ${num(ROWS[3].qty)}) sum-qty ${before.qty}->${edited.qty} (want ${num(wantQty)}) after-scroll="${renamedAfterScroll}"`);

      // Sorting by name now places the renamed row by its new name.
      await page.evaluate(() => window.__timed(() => document.querySelector('[data-sort="name"]').click()));
      await page.evaluate(() => window.__timed(() => document.querySelector('[data-sort="name"]').click()));
      const topByNameDesc = await page.$eval('[data-window] [data-row]', (el) => el.querySelector('[data-cell="name"]').textContent.trim());
      const names = ROWS.map((r) => (r.id === 3 ? 'titanium sprocket 99' : r.name));
      const wantTop = [...names].sort((a, b) => b.localeCompare(a))[0];
      check('state:global-store', topByNameDesc === wantTop,
        'an edited row sorts by its edited value',
        `top="${topByNameDesc}" (want "${wantTop}")`);

      reporter.assert(diag.errors.length === 0, 'the grid ran with zero page errors', diag.errors.slice(0, 3).join(' | '));
      log(`timings sort=${ms(median(sortTimes))} key=${ms(median(keyTimes))} select-all=${ms(median(selectAllTimes))} bulk=${ms(median(bulkTimes))} scroll=${ms(median(scrollTimes))}`);
    });
  },
};
