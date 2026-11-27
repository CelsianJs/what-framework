// Board smoke contract.
//
// The other apps reorder a keyed list in place (a sort, a tape). Here a card
// leaves one keyed list and joins another: five columns, 1,000 cards, each
// column its own keyed list inside a keyed list of columns, and every move
// is made the way a person makes it, by dragging with the pointer. Then
// every move is undone and redone.
//
// The check keeps its own copy of the board (src/data.js `move`, the same
// function the page uses) and compares every column, card by card, after
// every move, undo and redo. A move within a column must keep the card's
// element (and the state in it); a move between columns builds one card and
// disposes one; and a card that never changed column must still have the
// element it started with after the whole run, which a column rebuilt on a
// move would break. Each commit is timed in the page, from the pointer's
// release (or the key) until the DOM shows the card in its place.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { startProcess, waitForHttp, withPage } from '../../harness/index.mjs';

const MOVES = 24;
const BUDGET = { commit: 100, undo: 100 };
const FRAME_BOUND = 250;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (n) => (n < 0 ? 'never' : `${n.toFixed(1)}ms`);
// The waits that ran out (__awaitPlaced): the event never came, the browser
// cancelled the pointer, or the card never landed.
const missed = (times) => {
  const silent = times.filter((t) => t === -2).length;
  const cancelled = times.filter((t) => t === -3).length;
  const unplaced = times.filter((t) => t === -1).length;
  return silent + cancelled + unplaced === 0 ? '' : `; no event ${silent}, pointer cancelled ${cancelled}, not placed ${unplaced}`;
};

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INIT = `
  (() => {
    window.__frames = { gaps: [], on: false };
    let last = 0;
    const tick = (t) => {
      if (window.__frames.on && last) window.__frames.gaps.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const list = (col) => document.querySelector('[data-list="' + col + '"]');
    window.__board_ids = () => Array.from(document.querySelectorAll('[data-list]'), (l) => Array.from(l.children, (li) => li.dataset.card));

    // Scrolls the source card and the drop place into view and returns where
    // to press and where to release (just above the card that will follow
    // the dropped one, or below the last card).
    window.__dropPoint = (fromCol, fromIndex, toCol, toIndex) => {
      const source = list(fromCol).children[fromIndex];
      source.scrollIntoView({ block: 'center' });
      const others = Array.from(list(toCol).children).filter((li) => li !== source);
      const next = others[toIndex];
      if (fromCol !== toCol) (next || others[others.length - 1])?.scrollIntoView({ block: 'center' });
      const s = source.getBoundingClientRect();
      let y;
      if (next) y = next.getBoundingClientRect().top - 3;
      else {
        const lastCard = others[others.length - 1];
        y = lastCard ? lastCard.getBoundingClientRect().bottom + 3 : list(toCol).getBoundingClientRect().top + 10;
      }
      const t = list(toCol).getBoundingClientRect();
      return { id: source.dataset.card, sx: s.left + s.width / 2, sy: s.top + s.height / 2, tx: t.left + t.width / 2, ty: y };
    };

    // Started before the release or the key: resolves with the milliseconds
    // from that event until the DOM shows card \`id\` at \`index\` of \`col\`.
    // A timer, not the frames, keeps the five-second deadline, so it answers
    // even when the page stops painting or the event never comes: -1 when the
    // event came and the card did not land, -2 when the event never came, -3
    // when the browser cancelled the pointer instead of releasing it.
    window.__awaitPlaced = (type, id, col, index) => new Promise((resolve) => {
      let t0 = -1;
      let cancelled = false;
      const placed = () => list(col).children[index]?.dataset.card === id;
      const deadline = setTimeout(() => resolve(t0 >= 0 ? -1 : cancelled ? -3 : -2), 5000);
      if (type === 'pointerup') window.addEventListener('pointercancel', () => { cancelled = true; }, { capture: true, once: true });
      const poll = () => {
        if (!placed()) return requestAnimationFrame(poll);
        clearTimeout(deadline);
        resolve(performance.now() - t0);
      };
      window.addEventListener(type, () => { t0 = performance.now(); setTimeout(poll, 0); }, { capture: true, once: true });
    });
  })();
`;

export default {
  description: 'Compiled SPA: 1,000 cards in five keyed columns, dragged with pointer events within and between lists, with undo and redo; order, identity, accounting and commit time checked after every step.',

  covers: [
    'list:cross-parent-move',
  ],

  async check({ workDir, appPort, browser, check, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;
    const data = await import(pathToFileURL(join(workDir, 'src/data.js')).href);
    const COLS = data.COLUMNS.map((c) => c.id);
    const initial = data.makeBoard();
    const idsOf = (board) => board.map((c) => c.cards);
    const same = (a, b) => a.length === b.length && a.every((col, i) => col.length === b[i].length && col.every((id, j) => id === b[i][j]));

    // The moves: alternately within a column (a few places up or down, so
    // both ends are on screen) and to another column (anywhere in it).
    const rand = mulberry32(99);
    const moves = [];
    let model = initial;
    for (let k = 0; k < MOVES; k++) {
      const col = Math.floor(rand() * COLS.length);
      const len = model[col].cards.length;
      const index = 10 + Math.floor(rand() * (len - 20));
      let to;
      if (k % 2 === 0) {
        const delta = (1 + Math.floor(rand() * 5)) * (rand() < 0.5 ? -1 : 1);
        to = { col, index: index + delta };
      } else {
        const other = (col + 1 + Math.floor(rand() * (COLS.length - 1))) % COLS.length;
        to = { col: other, index: Math.floor(rand() * (model[other].cards.length + 1)) };
      }
      const id = model[col].cards[index];
      moves.push({ from: { col, index }, to, id, cross: to.col !== col });
      model = data.move(model, { col, index }, to);
    }
    const states = [initial];
    for (const m of moves) states.push(data.move(states.at(-1), m.from, m.to));
    const final = states.at(-1);

    const buildLog = run('npm', ['run', 'build'], { cwd: workDir });
    reporter.assert(/built in/.test(buildLog), 'vite build produced a bundle', buildLog.trim().split('\n').pop());

    const server = startProcess(
      'npx',
      ['vite', 'preview', '--port', String(appPort), '--strictPort', '--host', '127.0.0.1'],
      { cwd: workDir, env: { ...process.env } },
    );
    await waitForHttp(`${base}/`, { child: server });

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(INIT);
    try {
      await withPage(browser, `${base}/`, async (page, diag) => {
        await page.waitForSelector('[data-card]');
        const boardIds = () => page.evaluate(() => window.__board_ids());
        const probes = () => page.evaluate(() => ({ ...window.__board.probes }));
        reporter.assert(same(await boardIds(), idsOf(initial)), 'the board starts as its seed: five columns of 200 cards', '');

        // Every card's element, to tell later which were built again.
        await page.evaluate(() => { window.__start = new Map(Array.from(document.querySelectorAll('[data-card]'), (el) => [el.dataset.card, el])); });

        // A card opened before it moves within its column must still be open.
        const opened = moves.find((m) => !m.cross);
        await page.evaluate(({ col, index }) => {
          const el = document.querySelector(`[data-list="${col}"]`).children[index];
          el.scrollIntoView({ block: 'center' });
          el.querySelector('[data-more]').click();
        }, { col: COLS[opened.from.col], index: opened.from.index });

        // === The moves, by drag ==============================================
        log(`dragging ${moves.length} cards`);
        await page.evaluate(() => { window.__frames.on = true; });
        const commitTimes = [];
        const problems = [];
        let withinKept = 0;
        let withinTotal = 0;
        let acct = await probes();
        for (let k = 0; k < moves.length; k++) {
          const m = moves[k];
          const p = await page.evaluate(({ a, b, c, d }) => window.__dropPoint(a, b, c, d), { a: COLS[m.from.col], b: m.from.index, c: COLS[m.to.col], d: m.to.index });
          if (p.id !== m.id) { problems.push(`move ${k}: card under the pointer ${p.id}, want ${m.id}`); break; }
          await page.evaluate((id) => { window.__moving = document.querySelector(`[data-card="${id}"]`); }, m.id);
          await page.mouse.move(p.sx, p.sy);
          await page.mouse.down();
          const steps = 8;
          for (let i = 1; i <= steps; i++) await page.mouse.move(p.sx + ((p.tx - p.sx) * i) / steps, p.sy + ((p.ty - p.sy) * i) / steps);
          await page.evaluate(({ id, col, index }) => { window.__placed = window.__awaitPlaced('pointerup', id, col, index); }, { id: m.id, col: COLS[m.to.col], index: m.to.index });
          await page.mouse.up();
          commitTimes.push(await page.evaluate(() => window.__placed));
          const now = await boardIds();
          const after = await page.evaluate((id) => {
            const el = document.querySelector(`[data-card="${id}"]`);
            const all = Array.from(document.querySelectorAll('[data-card]'), (e) => e.dataset.card);
            return { same: el === window.__moving, total: all.length, unique: new Set(all).size };
          }, m.id);
          const pr = await probes();
          if (!same(now, idsOf(states[k + 1]))) problems.push(`move ${k} (${m.id} ${COLS[m.from.col]}#${m.from.index} -> ${COLS[m.to.col]}#${m.to.index}): board differs`);
          if (after.total !== 1000 || after.unique !== 1000) problems.push(`move ${k}: ${after.total} cards, ${after.unique} keys`);
          const built = pr.created - acct.created;
          const gone = pr.disposed - acct.disposed;
          if (m.cross ? built !== 1 || gone !== 1 : built !== 0 || gone !== 0) problems.push(`move ${k}: built ${built}, disposed ${gone}`);
          if (!m.cross) { withinTotal++; if (after.same) withinKept++; }
          acct = pr;
        }
        const stillOpen = await page.evaluate((id) => document.querySelector(`[data-card="${id}"] [data-detail]`) !== null, opened.id);
        const frames = await page.evaluate(() => {
          window.__frames.on = false;
          const gaps = window.__frames.gaps.slice().sort((a, b) => a - b);
          return { n: gaps.length, p99: gaps[Math.floor(gaps.length * 0.99)] ?? 0, max: gaps.at(-1) ?? 0 };
        });

        check('list:cross-parent-move', problems.length === 0 && withinKept === withinTotal && stillOpen,
          `${MOVES} drags within and between columns each leave every column exactly as the model has it, one element per key; a card moved within its column keeps its element and its state`,
          `${problems.slice(0, 3).join('; ') || `${MOVES} moves exact`}; within-column kept ${withinKept}/${withinTotal}; opened card still open=${stillOpen}`);
        check('list:cross-parent-move', commitTimes.every((t) => t >= 0) && median(commitTimes) <= BUDGET.commit,
          `a drop settles within ${BUDGET.commit}ms of the release`,
          `median=${ms(median(commitTimes))} max=${ms(Math.max(...commitTimes))}${missed(commitTimes)}`);
        reporter.assert(frames.p99 <= FRAME_BOUND, `the 99th-percentile frame while dragging stays within ${FRAME_BOUND}ms`,
          `frames=${frames.n} p99=${frames.p99.toFixed(0)}ms worst=${frames.max.toFixed(0)}ms`);

        // === Undo every move, then redo every move ===========================
        log('undoing and redoing every move');
        const undoTimes = [];
        const undoProblems = [];
        for (let k = moves.length - 1; k >= 0; k--) {
          const m = moves[k];
          await page.evaluate(({ id, col, index }) => { window.__placed = window.__awaitPlaced('keydown', id, col, index); }, { id: m.id, col: COLS[m.from.col], index: m.from.index });
          await page.keyboard.press('Control+z');
          undoTimes.push(await page.evaluate(() => window.__placed));
          if (!same(await boardIds(), idsOf(states[k]))) undoProblems.push(`undo of move ${k}`);
        }
        const undone = await boardIds();
        for (let k = 0; k < moves.length; k++) {
          const m = moves[k];
          await page.evaluate(({ id, col, index }) => { window.__placed = window.__awaitPlaced('keydown', id, col, index); }, { id: m.id, col: COLS[m.to.col], index: m.to.index });
          await page.keyboard.press('Control+Shift+z');
          undoTimes.push(await page.evaluate(() => window.__placed));
          if (!same(await boardIds(), idsOf(states[k + 1]))) undoProblems.push(`redo of move ${k}`);
        }
        const redone = await boardIds();

        // A card that never changed column has the element it started with.
        const crossed = [...new Set(moves.filter((m) => m.cross).map((m) => m.id))];
        const keptElements = await page.evaluate((crossedIds) => {
          const skip = new Set(crossedIds);
          let kept = 0;
          let rebuilt = 0;
          for (const [id, el] of window.__start) {
            if (skip.has(id)) continue;
            if (document.querySelector(`[data-card="${id}"]`) === el) kept++; else rebuilt++;
          }
          return { kept, rebuilt };
        }, crossed);
        const end = await probes();
        check('list:cross-parent-move',
          undoProblems.length === 0 && same(undone, idsOf(initial)) && same(redone, idsOf(final))
            && keptElements.rebuilt === 0 && end.created - end.disposed === 1000,
          'undoing every move restores the seed exactly and redoing restores the end; every card that never changed column kept its element throughout',
          `${undoProblems.slice(0, 3).join(', ') || `${moves.length} undos and ${moves.length} redos exact`}; cards that stayed in their column kept ${keptElements.kept}, rebuilt ${keptElements.rebuilt}; live cards ${end.created - end.disposed}`);
        check('list:cross-parent-move', undoTimes.every((t) => t >= 0) && median(undoTimes) <= BUDGET.undo,
          `an undo or redo settles within ${BUDGET.undo}ms of the key`,
          `median=${ms(median(undoTimes))} max=${ms(Math.max(...undoTimes))}${missed(undoTimes)}`);

        reporter.assert(diag.errors.length === 0, 'the board ran with zero page errors', diag.errors.slice(0, 3).join(' | '));
        log(`commit=${ms(median(commitTimes))} undo/redo=${ms(median(undoTimes))} p99-frame=${frames.p99.toFixed(0)}ms`);
      }, { context });
    } finally {
      await context.close();
    }
  },
};
