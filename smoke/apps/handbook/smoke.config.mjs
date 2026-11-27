// Handbook smoke contract.
//
// ops-console has one lazy pane. Here every page but the contents is a
// code-split route: twelve chapters and an editor desk behind a sign-in
// guard, each its own chunk. The check controls the network for those chunks
// (page routing, so it is the same in every browser): it delays one, makes
// one fail, and delays another long enough for a second navigation to
// overtake it. Then it walks the chapters, back and forward, and counts what
// the pages built and released.
//
// What a reader should see, and what is checked:
// - a first visit downloads that chapter's chunk and nothing else, and the
//   page being left stays (and says it is busy) until the new one can show;
// - hovering a link downloads the chunk, so the click shows the page
//   without waiting for the network;
// - a navigation overtaken by a newer one never shows, even once its chunk
//   lands, and leaves one history entry, the newer one's;
// - a chunk that fails shows the route's error page inside the layout, the
//   rest of the handbook keeps working, and "Try again" loads the chapter
//   once the network is back;
// - back and forward through chapters already loaded need no request;
// - the guard keeps a guest from the desk without downloading it;
// - every page left releases its timer and its component.
//
// Navigation times are measured in the page, from just before the click to
// the mutation that shows the new page.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { startProcess, waitForHttp } from '../../harness/index.mjs';

const CHUNK_DELAY = 700;
const PREFETCH_DELAY = 800;
const RACE_DELAY = 1500;
const WALKS = 3;
// From the click to the page shown, for a chapter whose chunk is already
// here (a revisit, back, forward) and for one whose chunk the hover fetched.
// Measured on an M-series Mac: under 20 ms in every browser.
const BUDGET = { cached: 150, prefetched: 250 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];

const INIT = `
  (() => {
    const CONTENT = '[data-chapter],[data-home],[data-chapter-failed],[data-desk],[data-signin],[data-not-found]';
    // Started just before a click (or a history step): resolves when the
    // page area shows \`want\`, with the time from the click event (or from
    // the start) until then, whether the page area was ever empty or showed
    // the loading fallback meanwhile, and whether it said it was busy.
    window.__watch = (want) => {
      window.__watched = new Promise((resolve) => {
        const main = document.querySelector('[data-page]');
        let t0 = performance.now();
        addEventListener('click', () => { t0 = performance.now(); }, { capture: true, once: true });
        const seen = { blank: false, fallback: false, busy: false };
        const look = () => {
          if (!main.querySelector(CONTENT)) seen.blank = true;
          if (main.querySelector('[data-page-loading]')) seen.fallback = true;
          if (main.getAttribute('aria-busy') === 'true') seen.busy = true;
          if (main.querySelector(want)) {
            mo.disconnect();
            resolve({ ms: performance.now() - t0, ...seen, path: location.pathname + location.search });
          }
        };
        const mo = new MutationObserver(look);
        mo.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
        setTimeout(() => { mo.disconnect(); resolve({ ms: -1, ...seen, path: location.pathname + location.search }); }, 8000);
      });
    };
    window.__shown = () => {
      const el = document.querySelector('[data-page]').querySelector(CONTENT);
      return el ? (el.dataset.chapter ?? Object.keys(el.dataset)[0]) : null;
    };
  })();
`;

export default {
  description: 'Compiled SPA: an engineering handbook of twelve code-split chapters and a guarded editor desk; chunks delayed, failed and overtaken, prefetched on hover, walked back and forward.',

  covers: [
    'route:lazy-chunk',
    'route:prefetch',
    'route:lazy-race',
    'route:chunk-error',
    'route:guard',
    'route:history',
    'lifecycle:unmount-cleanup',
  ],

  async check({ workDir, appPort, browser, browserName, check, skip, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;
    const { CHAPTERS, chapterPath } = await import(pathToFileURL(join(workDir, 'src/chapters.js')).href);

    const buildLog = run('npm', ['run', 'build'], { cwd: workDir });
    reporter.assert(/built in/.test(buildLog), 'vite build produced a bundle', buildLog.trim().split('\n').pop());

    // Which chunk is which page, from the build's manifest.
    const manifest = JSON.parse(readFileSync(join(workDir, 'dist/.vite/manifest.json'), 'utf8'));
    const pageOfChunk = new Map();
    for (const c of CHAPTERS) pageOfChunk.set(manifest[`src/chapters/${c.slug}.jsx`]?.file, c.slug);
    pageOfChunk.set(manifest['src/desk/Desk.jsx']?.file, 'desk');
    pageOfChunk.delete(undefined);
    reporter.assert(pageOfChunk.size === CHAPTERS.length + 1, 'every chapter and the desk were built into a chunk of their own',
      `${pageOfChunk.size} page chunks`);

    const server = startProcess(
      'npx',
      ['vite', 'preview', '--port', String(appPort), '--strictPort', '--host', '127.0.0.1'],
      { cwd: workDir, env: { ...process.env } },
    );
    await waitForHttp(`${base}/`, { child: server });

    // The network for page chunks: a delay or a failure per page.
    const rules = new Map();
    const requests = [];
    const requested = (page) => requests.filter((r) => r === page).length;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(INIT);
    await context.route(/\/assets\/[^/]+\.js$/, async (route) => {
      const page = pageOfChunk.get(new URL(route.request().url()).pathname.slice(1));
      if (page) requests.push(page);
      const rule = page ? rules.get(page) : undefined;
      if (rule?.fail) return route.abort('failed');
      if (rule?.delay) await sleep(rule.delay);
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    const chunkFailures = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      // The download the check made fail, as each browser reports it.
      if (/\/assets\/security-|Failed to load resource|dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(text + (m.location()?.url ?? ''))) {
        chunkFailures.push(text);
        return;
      }
      errors.push(`console: ${text}`);
    });

    // Clicks `selector` and waits until the page area shows `want`.
    const go = async (selector, want) => {
      await page.evaluate((w) => window.__watch(w), want);
      await page.click(selector);
      return page.evaluate(() => window.__watched);
    };
    const traverse = async (step, want) => {
      await page.evaluate((w) => window.__watch(w), want);
      await page.evaluate((n) => history.go(n), step);
      return page.evaluate(() => window.__watched);
    };
    const stats = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__handbook.stats)));
    const chapterSel = (slug) => `[data-chapter="${slug}"]`;
    const visits = {};
    const visited = (slug) => { visits[slug] = (visits[slug] ?? 0) + 1; };

    try {
      // === A deep link: the contents' chunk only ===========================
      await page.goto(`${base}${chapterPath('welcome')}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(chapterSel('welcome'));
      visited('welcome');
      check('route:lazy-chunk', requested('welcome') === 1 && requests.length === 1,
        'a deep link to a chapter downloads that chapter\'s chunk and no other page\'s',
        `requested: ${requests.join(', ')}`);

      // === First visit: the page being left stays until the chunk lands =====
      rules.set('on-call', { delay: CHUNK_DELAY });
      await page.evaluate((w) => window.__watch(w), chapterSel('on-call'));
      await page.click('[data-nav="on-call"]');
      await sleep(CHUNK_DELAY / 2);
      const midway = await page.evaluate(() => ({
        shown: window.__shown(),
        path: location.pathname,
        busy: document.querySelector('[data-page]').getAttribute('aria-busy'),
      }));
      const first = await page.evaluate(() => window.__watched);
      visited('on-call');
      check('route:lazy-chunk',
        first.ms >= CHUNK_DELAY * 0.8 && !first.blank && !first.fallback && first.busy
          && midway.shown === 'welcome' && midway.path === chapterPath('welcome') && midway.busy === 'true'
          && first.path === chapterPath('on-call') && requested('on-call') === 1,
        'while a chapter\'s chunk downloads, the page being left stays on screen, at its URL, marked busy, and the new page replaces it once the chunk lands',
        `midway: showing ${midway.shown} at ${midway.path} busy=${midway.busy}; shown after ${first.ms.toFixed(0)}ms (chunk ${CHUNK_DELAY}ms) blank=${first.blank} fallback=${first.fallback}`);

      // A revisit needs no request.
      await go('[data-nav="welcome"]', chapterSel('welcome'));
      visited('welcome');
      const again = await go('[data-nav="on-call"]', chapterSel('on-call'));
      visited('on-call');
      check('route:lazy-chunk', requested('on-call') === 1 && requested('welcome') === 1 && again.ms >= 0 && again.ms < BUDGET.cached && !again.blank,
        `a revisit downloads nothing and shows within ${BUDGET.cached}ms`,
        `${again.ms.toFixed(1)}ms; on-call requested ${requested('on-call')}x`);

      // === Prefetch on hover ===============================================
      rules.set('deploys', { delay: PREFETCH_DELAY });
      await page.hover('[data-nav="deploys"]');
      await sleep(PREFETCH_DELAY + 300);
      const onHover = requested('deploys');
      const prefetched = await go('[data-nav="deploys"]', chapterSel('deploys'));
      visited('deploys');
      check('route:prefetch', onHover === 1 && requested('deploys') === 1 && prefetched.ms >= 0 && prefetched.ms < BUDGET.prefetched,
        `hovering a chapter's link downloads its chunk, so the click shows it within ${BUDGET.prefetched}ms instead of waiting ${PREFETCH_DELAY}ms for the network`,
        `requested on hover: ${onHover}; click to page ${prefetched.ms.toFixed(0)}ms`);

      // === A navigation overtaken by a newer one ===========================
      rules.set('incidents', { delay: RACE_DELAY });
      const lengthBefore = await page.evaluate(() => history.length);
      await page.evaluate((w) => window.__watch(w), chapterSel('reviews'));
      await page.click('[data-nav="incidents"]');
      await sleep(150);
      await page.click('[data-nav="reviews"]');
      const overtaken = await page.evaluate(() => window.__watched);
      visited('reviews');
      await sleep(RACE_DELAY + 300);
      const afterRace = await page.evaluate(() => ({ shown: window.__shown(), path: location.pathname, length: history.length }));
      const raceStats = await stats();
      check('route:lazy-race',
        requested('incidents') === 1 && overtaken.ms >= 0 && afterRace.shown === 'reviews' && afterRace.path === chapterPath('reviews')
          && !raceStats.mounts.incidents && afterRace.length === lengthBefore + 1,
        'a navigation to a slow chunk that a newer one overtakes never shows, even after its chunk lands, and leaves only the newer one in history',
        `showing ${afterRace.shown} at ${afterRace.path} ${RACE_DELAY + 300}ms later; incidents built ${raceStats.mounts.incidents ?? 0}x; history +${afterRace.length - lengthBefore}`);

      // The overtaken chapter's chunk did land: a visit now is immediate.
      rules.delete('incidents');
      const late = await go('[data-nav="incidents"]', chapterSel('incidents'));
      visited('incidents');
      check('route:lazy-race', requested('incidents') === 1 && late.ms >= 0 && late.ms < BUDGET.cached && (await stats()).mounts.incidents === 1,
        'the overtaken chapter\'s chunk is kept: visiting it afterwards downloads nothing and builds it once',
        `${late.ms.toFixed(1)}ms; requested ${requested('incidents')}x`);

      // === A chunk that fails ==============================================
      rules.set('security', { fail: true });
      const failed = await go('[data-nav="security"]', '[data-chapter-failed]');
      const failedView = await page.evaluate(() => ({
        sidebar: !!document.querySelector('[data-sidebar] [data-nav="testing"]'),
        message: document.querySelector('[data-failed-message]')?.textContent ?? '',
        path: location.pathname,
      }));
      const onward = await go('[data-nav="testing"]', chapterSel('testing'));
      visited('testing');
      check('route:chunk-error',
        failed.ms >= 0 && failedView.sidebar && failedView.path === chapterPath('security') && onward.ms >= 0 && errors.length === 0,
        'a chapter whose chunk fails shows the route\'s error page inside the layout, with no uncaught error, and the next link works',
        `error page after ${failed.ms.toFixed(0)}ms at ${failedView.path} ("${failedView.message.slice(0, 60)}"); next chapter ${onward.ms.toFixed(0)}ms; errors=${errors.length}`);

      // The network is back. lazy() keeps the failed download's error, so a
      // second visit shows the error page again and downloads nothing; the
      // page's "Try again" loads the page again, which downloads the chapter.
      rules.delete('security');
      const before = requested('security');
      const revisit = await go('[data-nav="security"]', '[data-chapter-failed]');
      const onRevisit = requested('security') - before;
      await Promise.all([page.waitForEvent('load'), page.click('[data-retry]')]);
      const retried = await page.waitForSelector(chapterSel('security'), { timeout: 8000 }).then(() => true, () => false);
      // A new document: its pages have built nothing yet.
      for (const slug of Object.keys(visits)) delete visits[slug];
      if (retried) visited('security');
      const retryName = 'once the network is back, the error page\'s "Try again" loads the page again and the chapter shows';
      const retryDetail = `second visit: ${revisit.ms >= 0 ? 'the error page again' : 'no error page'}, ${onRevisit} downloads; after the retry (${requested('security') - before - onRevisit} downloads): ${retried ? 'the chapter' : await page.evaluate(() => window.__shown())}`;
      if (browserName === 'webkit') {
        skip('route:chunk-error', retryName, `WebKit under Playwright's request routing does not request a chunk whose download failed again after a reload, so the reloaded page fails the import with no request (${retryDetail})`);
      } else {
        check('route:chunk-error', revisit.ms >= 0 && retried && onRevisit === 0 && requested('security') === before + 1 && errors.length === 0, retryName, retryDetail);
      }

      // === Back and forward ================================================
      const trail = ['data', 'writing', 'hiring', 'leaving'];
      for (const slug of trail) {
        await go(`[data-nav="${slug}"]`, chapterSel(slug));
        visited(slug);
      }
      const requestsBefore = requests.length;
      const walk = [];
      for (const slug of [trail[2], trail[1], trail[0]]) walk.push({ slug, ...(await traverse(-1, chapterSel(slug))) });
      for (const slug of [trail[1], trail[2], trail[3]]) walk.push({ slug, ...(await traverse(1, chapterSel(slug))) });
      for (const w of walk) if (w.ms >= 0) visited(w.slug);
      const badSteps = walk.filter((w) => w.ms < 0 || w.ms > BUDGET.cached || w.path !== chapterPath(w.slug) || w.blank);
      check('route:history', badSteps.length === 0 && requests.length === requestsBefore,
        `back three and forward three through code-split chapters each show the chapter of their URL within ${BUDGET.cached}ms and download nothing`,
        `${walk.map((w) => `${w.slug} ${w.ms.toFixed(0)}ms`).join(', ')}; requests during the walk: ${requests.length - requestsBefore}`);

      // === The guard =======================================================
      const toSignIn = await go('[data-nav="desk"]', '[data-signin]');
      const guarded = { path: toSignIn.path, desk: requested('desk') };
      const toDesk = await go('[data-signin-submit]', '[data-desk]');
      const signedIn = await stats();
      const out = await go('[data-signout]', '[data-signin]');
      const signedOut = await stats();
      check('route:guard',
        guarded.path === `/signin?next=${encodeURIComponent('/desk')}` && guarded.desk === 0
          && toDesk.path === '/desk' && requested('desk') === 1 && signedIn.deskMounts === 1
          && out.path.startsWith('/signin') && signedOut.deskMounts === 0,
        'a guest sent to sign-in never downloads the guarded desk; signing in downloads and shows it, signing out leaves it and releases it',
        `guest: ${guarded.path}, desk requested ${guarded.desk}x; signed in: ${toDesk.path} (desk ${requested('desk')}x, built ${signedIn.deskMounts}); signed out: ${out.path}, desk live ${signedOut.deskMounts}`);

      // === Walk every chapter, three times =================================
      // The first walk downloads what the reloaded page has not; the others
      // are timed, between chapters all loaded.
      rules.clear();
      const walked = CHAPTERS.filter((c) => c.slug !== 'security' || retried);
      const times = [];
      let walkRequests = 0;
      for (let w = 0; w < WALKS; w++) {
        const from = requests.length;
        for (const c of walked) {
          const r = await go(`[data-nav="${c.slug}"]`, chapterSel(c.slug));
          visited(c.slug);
          if (w > 0) times.push(r.ms);
        }
        if (w > 0) walkRequests += requests.length - from;
      }
      const end = await stats();
      const wrongBuilds = CHAPTERS.filter((c) => (end.mounts[c.slug] ?? 0) !== (visits[c.slug] ?? 0)).map((c) => `${c.slug} ${end.mounts[c.slug] ?? 0}/${visits[c.slug] ?? 0}`);
      check('lifecycle:unmount-cleanup',
        end.live === 1 && end.timers === 1 && wrongBuilds.length === 0 && times.every((t) => t >= 0),
        `after ${WALKS * walked.length} more navigations every page left has released its component and its timer, and each visit built its page exactly once`,
        `live pages ${end.live}, timers ${end.timers}; builds per chapter match visits: ${wrongBuilds.length ? wrongBuilds.join(', ') : 'all'}`);
      reporter.assert(times.length > 0 && p95(times) < BUDGET.cached && walkRequests === 0,
        `a navigation between loaded chapters downloads nothing and shows the page within ${BUDGET.cached}ms (95th percentile)`,
        `p95 ${p95(times).toFixed(1)}ms, worst ${Math.max(...times).toFixed(1)}ms over ${times.length}; requests ${walkRequests}`);

      // The reader's marks and notes outlive the pages.
      await page.check(`${chapterSel('leaving')} [data-read]`);
      await page.fill(`${chapterSel('leaving')} [data-note]`, 'Ask Robin about the billing alerts.');
      await go('[data-nav="welcome"]', chapterSel('welcome'));
      await go('[data-nav="leaving"]', chapterSel('leaving'));
      const kept = await page.evaluate(() => ({
        read: document.querySelector('[data-chapter="leaving"] [data-read]').checked,
        note: document.querySelector('[data-chapter="leaving"] [data-note]').value,
        tick: !!document.querySelector('[data-nav="leaving"] .tick'),
      }));
      reporter.assert(kept.read && kept.note === 'Ask Robin about the billing alerts.' && kept.tick,
        'a chapter rebuilt on a revisit shows the mark and the note the reader left',
        `read=${kept.read} note="${kept.note}" sidebar tick=${kept.tick}`);

      reporter.assert(errors.length === 0, 'the handbook ran with zero page errors', errors.slice(0, 3).join(' | '));
      log(`page chunks requested: ${requests.length}; chunk failure messages: ${chunkFailures.length}`);
    } finally {
      await context.close();
    }
  },
};
