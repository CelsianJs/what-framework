// Chat smoke contract.
//
// live-feed's stream is a timer inside the page. This one comes from the
// app's own server over server-sent events, and the server is unreliable on
// purpose: it closes each stream after 0.5 to 1.5 s, half the time by
// destroying the socket halfway through an event, and the check drops every
// stream at once a few more times. The page appends each message to a keyed
// log capped at 1,000 rows, follows the bottom, and shows its own posts at
// once (pending) until the server echoes them back. Meanwhile the check
// types into the composer, during bursts of 400 messages at once.
//
// Sequence numbers make loss and repeats exact: what the server emitted is
// compared with what the page received and with the rows on screen. The
// composer is read back after every typing session (value and caret), each
// post's pending row is followed until the echo takes its place, and frames
// are measured in the page (requestAnimationFrame gaps). The heap after a
// forced GC is read in Chromium only.

import { startProcess, waitForHttp } from '../../harness/index.mjs';

const MAX_ROWS = 1000;
const RUN_MS = 12_000;
// The run goes on past RUN_MS until the page has reconnected this often (up
// to MAX_RUN_MS). The server asks for `retry: 150`; Chromium and WebKit
// reopen 150 ms after a drop, Firefox waits at least 500 ms whatever the
// server asks, so it needs a few seconds more for the same reconnects.
const MIN_RECONNECTS = 10;
const MAX_RUN_MS = 30_000;
const ROOM = { rate: 600, burst: 400, burstEvery: 1500, drop: [500, 1500], running: true };
const MIN_SESSIONS = 6;
// The 99th-percentile frame: about the eighth longest of the run, so frames
// that took a burst of 400 messages count and one stall of a busy machine does
// not. On an M-series Mac: about 35 ms in Chromium and 100 ms in WebKit, the
// longest frame 50 to 190 ms. The bound leaves room for a slow Linux runner.
const FRAME_BOUND = 400;
const HEAP_GROWTH_BOUND = 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INIT = `
  (() => {
    window.__frames = { gaps: [], on: false };
    let last = 0;
    const tick = (t) => {
      const f = window.__frames;
      if (f.on && last) f.gaps.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // Started before a post: catches the pending row the post adds, and
    // follows it until the server's echo takes its place. Resolves with
    // whether the echo kept the row's element, where it landed, and how many
    // rows carry its key.
    window.__followPost = () => new Promise((resolve) => {
      const log = document.querySelector('[data-log]');
      let el = null;
      let key = null;
      let t0 = 0;
      const caught = new MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) {
          if (!el && n.nodeType === 1 && n.classList.contains('pending')) { el = n; key = n.dataset.key; t0 = performance.now(); }
        }
        if (el) { caught.disconnect(); look(); }
      });
      caught.observe(log, { childList: true });
      setTimeout(() => { if (!el) { caught.disconnect(); resolve({ key: null }); } }, 5000);
      const look = () => {
        if (el.classList.contains('pending') && performance.now() - t0 < 5000) return setTimeout(look, 5);
        const now = document.querySelectorAll('[data-key="' + key + '"]');
        resolve({
          key,
          same: now.length === 1 && now[0] === el,
          count: now.length,
          seq: Number(el.dataset.seq),
          ordered: !el.nextElementSibling || el.nextElementSibling.classList.contains('pending') || Number(el.nextElementSibling.dataset.seq) > Number(el.dataset.seq),
          ms: performance.now() - t0,
        });
      };
    });

    // The topmost row in view and its offset from the top of the log.
    window.__anchor = () => {
      const box = document.querySelector('[data-scroller]');
      const top = box.getBoundingClientRect().top;
      for (const li of box.querySelectorAll('li')) {
        const r = li.getBoundingClientRect();
        if (r.bottom > top + 1) return { key: li.dataset.key, offset: Math.round(r.top - top) };
      }
      return null;
    };
  })();
`;

export default {
  description: 'Compiled SPA on its own SSE server that drops and reconnects mid-run: a capped keyed chat log anchored to the bottom, optimistic sends, a composer typed into during bursts; loss, repeats, caret, frames and memory.',

  covers: [
    'stream:reconnect',
    'list:capped-log',
    'form:input-under-load',
    'perf:long-tasks',
    'perf:memory',
  ],

  async check({ workDir, appPort, browser, browserName, check, skip, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;
    const post = (path, body = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

    const buildLog = run('npm', ['run', 'build'], { cwd: workDir });
    reporter.assert(/built in/.test(buildLog), 'vite build produced a bundle', buildLog.trim().split('\n').pop());

    const server = startProcess('node', ['server.js'], { cwd: workDir, env: { ...process.env, PORT: String(appPort) } });
    await waitForHttp(`${base}/__stats`, { child: server });
    await post('/__control', { ...ROOM, running: false });

    const context = await browser.newContext();
    await context.addInitScript(INIT);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // A stream the server destroys mid-event is reported as a failed load of
    // /events; that is the point of the exercise, not a page error.
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/\/events\b/.test(m.location()?.url || '') || /ERR_INCOMPLETE_CHUNKED_ENCODING|network error/i.test(m.text())) return;
      errors.push(`console: ${m.text()}`);
    });

    try {
      // The page holds a stream open, so 'networkidle' never comes.
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__chat?.stats.opens > 0, null, { timeout: 15000 });
      const state = () => page.evaluate(() => ({ ...window.__chat.stats, probes: { ...window.__chat.probes } }));

      // === The run: 600 messages a second, a burst of 400 every 1.5 s, every
      // stream closed after 0.5 to 1.5 s, typing and posting throughout =====
      await post('/__control', ROOM);
      await page.evaluate(() => { window.__frames.on = true; });
      const t0 = Date.now();
      const sessions = [];
      const follows = [];
      let anchorCheck = null;
      let manualDrops = 0;
      let opened = 0;
      const more = () => Date.now() - t0 < RUN_MS || (opened - 1 < MIN_RECONNECTS && Date.now() - t0 < MAX_RUN_MS);
      for (let k = 0; k < MIN_SESSIONS || more(); k++) {
        // A burst lands while the keys go in.
        post('/__burst', { n: 400 });
        if (k % 3 === 1) { post('/__drop'); manualDrops++; }
        const head = `msg ${k} the deploy is`;
        await page.focus('[data-composer]');
        await page.keyboard.press('End');
        await page.keyboard.type(`${head} green`, { delay: 5 });
        for (let i = 0; i < 'green'.length; i++) await page.keyboard.press('ArrowLeft');
        await page.keyboard.type('really ', { delay: 5 });
        const want = `${head} really green`;
        const caret = `${head} really `.length;
        const got = await page.$eval('[data-composer]', (el) => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, focused: document.activeElement === el }));
        sessions.push({ want, caret, ...got, ok: got.value === want && got.start === caret && got.end === caret && got.focused });
        // The catcher is in place before the key goes in.
        await page.evaluate(() => { window.__follow = window.__followPost(); });
        await page.keyboard.press('Enter');
        follows.push(await page.evaluate(() => window.__follow));
        const cleared = await page.$eval('[data-composer]', (el) => el.value);
        if (cleared !== '') sessions.push({ want: '', value: cleared, ok: false });

        // Once, midway: scroll up and read while messages keep arriving.
        if (k === 3) {
          const box = await page.$('[data-scroller]');
          const r = await box.boundingBox();
          await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
          await page.mouse.wheel(0, -800);
          await sleep(300);
          const before = await page.evaluate(() => ({ anchor: window.__anchor(), received: window.__chat.stats.lastSeq }));
          await sleep(1500);
          const after = await page.evaluate(() => ({
            anchor: window.__anchor(),
            received: window.__chat.stats.lastSeq,
            unseen: document.querySelector('[data-unseen]')?.textContent || '',
            rows: document.querySelectorAll('[data-log] li').length,
          }));
          // Back to the bottom; read where the view is once the room is quiet
          // (while it talks, a frame can end with rows the next frame scrolls
          // to).
          await page.click('[data-unseen]');
          await post('/__control', { running: false });
          await sleep(400);
          const back = await page.evaluate(() => {
            const b = document.querySelector('[data-scroller]');
            return { bottom: b.scrollTop + b.clientHeight >= b.scrollHeight - 4, rows: document.querySelectorAll('[data-log] li:not(.pending)').length, pill: !!document.querySelector('[data-unseen]') };
          });
          anchorCheck = { before, after, back };
          await post('/__control', ROOM);
        }
        await sleep(250);
        ({ opened } = await fetch(`${base}/__stats`).then((r) => r.json()));
      }
      await post('/__control', { running: false });
      const frames = await page.evaluate(() => {
        window.__frames.on = false;
        const gaps = window.__frames.gaps.slice().sort((a, b) => a - b);
        return { n: gaps.length, p99: gaps[Math.floor(gaps.length * 0.99)] ?? 0, max: gaps[gaps.length - 1] ?? 0, over100: gaps.filter((g) => g > 100).length };
      });

      // Let the stream drain: the page has everything the server emitted.
      const served = await fetch(`${base}/__stats`).then((r) => r.json());
      await page.waitForFunction((n) => window.__chat.stats.lastSeq >= n, served.emitted, { timeout: 15000 }).catch(() => {});
      await sleep(300);
      const end = await state();
      const dom = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-log] li'));
        const seqs = rows.map((li) => Number(li.dataset.seq));
        const keys = new Set(rows.map((li) => li.dataset.key));
        const box = document.querySelector('[data-scroller]');
        return {
          rows: rows.length,
          unique: keys.size === rows.length,
          first: seqs[0],
          last: seqs[seqs.length - 1],
          contiguous: seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1),
          pending: document.querySelectorAll('[data-log] li.pending').length,
          bottom: box.scrollTop + box.clientHeight >= box.scrollHeight - 4,
          received: document.querySelector('[data-received]').textContent,
        };
      });

      const reconnects = served.opened - 1;
      check('stream:reconnect',
        reconnects >= MIN_RECONNECTS && served.drops >= MIN_RECONNECTS && end.reconnects >= MIN_RECONNECTS
          && end.lastSeq === served.emitted && end.gaps === 0 && end.repeats === 0
          && dom.received === served.emitted.toLocaleString('en-US'),
        'across streams dropped mid-run (cleanly, mid-event and all at once) the page received every message exactly once',
        `emitted=${served.emitted} received=${end.lastSeq} gaps=${end.gaps} repeats=${end.repeats} streams opened=${served.opened} dropped=${served.drops} (${manualDrops} all-at-once) page reconnects=${end.reconnects}`);

      check('list:capped-log',
        dom.rows === MAX_ROWS && dom.unique && dom.contiguous && dom.last === served.emitted && dom.first === served.emitted - MAX_ROWS + 1
          && dom.pending === 0 && dom.bottom && end.probes.effectBeforeDom === 0,
        `the log keeps the last ${MAX_ROWS.toLocaleString('en-US')} of ${served.emitted.toLocaleString('en-US')} messages in order, one row per key, anchored to the bottom, and an effect after an append always sees the new row`,
        `rows=${dom.rows} unique=${dom.unique} seq ${dom.first}..${dom.last} contiguous=${dom.contiguous} pending=${dom.pending} at-bottom=${dom.bottom} effect-runs=${end.probes.effectRuns} before-dom=${end.probes.effectBeforeDom}`);

      const badFollows = follows.filter((f) => !(f.key && f.same && f.count === 1 && f.seq > 0 && f.ordered));
      check('list:capped-log', follows.length >= MIN_SESSIONS && badFollows.length === 0,
        'each post shows at once as a pending row, and the server\'s echo takes over that same element under its key, in sequence order',
        `${follows.length} posts; ${badFollows.length ? `bad: ${badFollows.slice(0, 3).map((f) => JSON.stringify(f)).join(' ')}` : `echo after median ${follows.map((f) => f.ms).sort((a, b) => a - b)[Math.floor(follows.length / 2)].toFixed(0)}ms`}`);

      const a = anchorCheck;
      check('list:capped-log',
        !!a && a.before.anchor && a.after.anchor && a.before.anchor.key === a.after.anchor.key && Math.abs(a.before.anchor.offset - a.after.anchor.offset) <= 1
          && a.after.received > a.before.received && /new message/.test(a.after.unseen) && a.back.bottom && a.back.rows === MAX_ROWS && !a.back.pill,
        'scrolled up, the row being read stays put while messages arrive; back at the bottom the log follows it again and is capped again',
        a ? `row ${a.before.anchor?.key}@${a.before.anchor?.offset}px -> ${a.after.anchor?.key}@${a.after.anchor?.offset}px while ${a.after.received - a.before.received} arrived; pill "${a.after.unseen}"; rows ${a.after.rows} while up; back: bottom=${a.back.bottom} rows=${a.back.rows}` : 'never scrolled up');

      const badSessions = sessions.filter((s) => !s.ok);
      check('form:input-under-load', sessions.length >= MIN_SESSIONS && badSessions.length === 0,
        'typing into the composer during bursts and reconnects loses no character and keeps the caret where the keys put it',
        `${sessions.length} sessions${badSessions.length ? `; bad: ${badSessions.slice(0, 2).map((s) => `"${s.value}" caret ${s.start}-${s.end} (want "${s.want}" caret ${s.caret})${s.focused === false ? ' unfocused' : ''}`).join('; ')}` : ' exact'}`);

      check('perf:long-tasks', frames.n > 0 && frames.p99 <= FRAME_BOUND,
        `the 99th-percentile frame stays within ${FRAME_BOUND}ms while ~900 messages a second arrive in bursts of 400`,
        `frames=${frames.n} p99=${frames.p99.toFixed(0)}ms worst=${frames.max.toFixed(0)}ms over-100ms=${frames.over100}`);

      // === Memory: thousands more messages, the heap after a forced GC =====
      if (browserName === 'chromium') {
        const cdp = await context.newCDPSession(page);
        const heap = async () => {
          await cdp.send('HeapProfiler.collectGarbage');
          await cdp.send('HeapProfiler.collectGarbage');
          return (await cdp.send('Runtime.getHeapUsage')).usedSize;
        };
        // Six samples 1.2 s apart. A forced GC does not always free all it
        // could (samples of a level heap differ by up to ~0.8 MB), so the
        // growth compares the lowest of the last three with the lowest of
        // the first three.
        await post('/__control', { ...ROOM, drop: [800, 1600] });
        await sleep(1000);
        const from = (await state()).lastSeq;
        const heaps = [];
        for (let i = 0; i < 6; i++) {
          heaps.push(await heap());
          await sleep(1200);
        }
        await post('/__control', { running: false });
        const to = (await state()).lastSeq;
        const growth = Math.min(...heaps.slice(3)) - Math.min(...heaps.slice(0, 3));
        const climbing = heaps.every((h, i) => i === 0 || h > heaps[i - 1]);
        check('perf:memory', growth < HEAP_GROWTH_BOUND && !(climbing && growth > 512 * 1024) && to - from > 3000,
          'the heap after a forced GC stays level while thousands more messages pass through the capped log',
          `${(to - from).toLocaleString('en-US')} messages; heap ${heaps.map((h) => `${(h / 1048576).toFixed(2)}MB`).join(' -> ')} (growth ${(growth / 1024).toFixed(0)}KB)`);
      } else {
        skip('perf:memory', 'the heap after a forced GC stays level while thousands more messages pass through the capped log',
          `${browserName} has no devtools-protocol session to force a GC and read the heap`);
      }

      reporter.assert(errors.length === 0, 'the room ran with zero page errors', errors.slice(0, 3).join(' | '));
      log(`emitted=${served.emitted} reconnects=${reconnects} p99-frame=${frames.p99.toFixed(0)}ms worst=${frames.max.toFixed(0)}ms sessions=${sessions.length}`);
    } finally {
      await context.close();
    }
  },
};
