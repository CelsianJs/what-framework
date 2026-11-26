// Newsroom smoke contract.
//
// A server-rendered content site under load. What it exposes is the server:
// a stream that must not wait for its slowest query, a long page that must
// hydrate without building anything, islands that must wake on their own
// triggers, and a process that serves many requests at once and for a long
// time, where any state kept at module scope in the request path shows up as
// one visitor's page inside another's.
//
// Every expected value is computed here from the app's seeded data module
// (src/data/news.js), never read back from the page.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { startProcess, waitForHttp, withPage } from '../../harness/index.mjs';

const SLOW_MS = 1200; // the "most read" query (src/db.js default)
const FAST_MS = 120; // the markets brief
const CONCURRENT = 50;
const MEMORY_REQUESTS = 2000;
const HEAP_GROWTH_BOUND = 4 * 1024 * 1024;

// Counts every node a script creates, before any page script runs. The
// entry reads it around its hydrate() call.
const COUNT_CREATED = `
  (() => {
    let created = 0;
    const wrap = (proto, name) => {
      const original = proto[name];
      proto[name] = function (...args) { created++; return original.apply(this, args); };
    };
    for (const name of ['createElement', 'createElementNS', 'createTextNode', 'createComment', 'createDocumentFragment', 'importNode']) wrap(Document.prototype, name);
    wrap(Node.prototype, 'cloneNode');
    window.__nodesCreated = () => created;
  })();
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with the arrival time of every chunk, from the request's start. */
function timedGet(url) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    http.get(url, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (text) => chunks.push({ at: performance.now() - t0, text }));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, chunks, body: chunks.map((c) => c.text).join(''), total: performance.now() - t0 }));
    }).on('error', reject);
  });
}

const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null;
const metaOf = (html, attr, name) => new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html)?.[1] ?? null;
const unescape = (s) => s?.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const slugsIn = (html, attr) => [...html.matchAll(new RegExp(`${attr}="(story-\\d+)"`, 'g'))].map((m) => m[1]);

export default {
  description: 'Newsroom: a streamed front page with out-of-order Suspense, long ISR articles that hydrate, five islands on one page, comments as server actions; concurrency and memory under load.',

  covers: [
    'render:server',
    'render:hybrid-isr',
    'render:hydration',
    'render:no-hydration-mismatch',
    'route:params',
    'data:loader',
    'cmp:head',
    'server:action-js',
    'server:action-nojs',
    'server:revalidate',
    'server:action-error',
    'island:load',
    'island:idle',
    'island:visible',
    'island:interaction',
    'island:media',
    'island:ssr-content',
    'stream:ttfb',
    'stream:out-of-order',
    'route:query-pagination',
    'render:hydration-adopts-long-page',
    'island:input-before-hydration',
    'server:request-isolation',
    'server:memory',
  ],

  async check({ workDir, appPort, browser, check, reporter, log }) {
    const base = `http://127.0.0.1:${appPort}`;
    const news = await import(pathToFileURL(join(workDir, 'src/data/news.js')).href);

    const server = startProcess('node', ['--expose-gc', 'server.js'], {
      cwd: workDir,
      env: { ...process.env, PORT: String(appPort), NEWSROOM_DIAGNOSTICS: '1' },
    });
    await waitForHttp(`${base}/__diag/heap`, { child: server });

    // === The stream: first byte before the slow query; boundaries out of order ==
    {
      const page = 3;
      const res = await timedGet(`${base}/?page=${page}`);
      const first = res.chunks[0];
      const at = (needle) => res.chunks.find((c) => c.text.includes(needle))?.at ?? null;
      const marketsAt = at(`data-markets="${page}"`);
      const mostReadAt = at(`data-most-read="${page}"`);
      const wantStories = news.pageOfStories(page).map((s) => s.slug);
      check('stream:ttfb',
        res.status === 200 && first.at < SLOW_MS / 2 && res.total >= SLOW_MS
          && first.text.includes('data-masthead') && wantStories.every((slug) => first.text.includes(`data-story="${slug}"`))
          && first.text.includes('data-most-read-loading') && !first.text.includes('data-most-read='),
        'the shell (masthead, the page of stories, both fallbacks) arrives before the slow query resolves',
        `first-byte=${first.at.toFixed(0)}ms slow-query=${SLOW_MS}ms whole=${res.total.toFixed(0)}ms chunks=${res.chunks.length}`);

      const body = res.body;
      const wantMostRead = news.mostReadFor(page).map((m) => m.slug);
      const mostReadHtml = /<ol[^>]*class="most-read"[\s\S]*?<\/ol>/.exec(body)?.[0] ?? '';
      check('stream:out-of-order',
        marketsAt !== null && mostReadAt !== null && marketsAt < mostReadAt && marketsAt < SLOW_MS
          && body.indexOf('data-most-read-loading') < body.indexOf('data-markets-loading')
          && body.indexOf(`data-markets="${page}"`) < body.indexOf(`data-most-read="${page}"`)
          && JSON.stringify([...mostReadHtml.matchAll(/\/article\/(story-\d+)/g)].map((m) => m[1])) === JSON.stringify(wantMostRead),
        'the markets brief (later in the page, fast) streams before the most-read rail above it (slow), each with its own data',
        `markets-at=${marketsAt?.toFixed(0)}ms most-read-at=${mostReadAt?.toFixed(0)}ms fast=${FAST_MS}ms slow=${SLOW_MS}ms`);
    }

    // === Front page in the browser: hydration, pagination, head ===============
    const frontPage = 2;
    await withPage(browser, `${base}/?page=${frontPage}`, async (page, diag) => {
      const apiCalls = [];
      page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(new URL(r.url()).pathname); });
      await page.waitForFunction(() => window.__newsroom?.hydrated === true, undefined, { timeout: 10000 });
      const probe = await page.evaluate(() => window.__newsroom);
      const dom = await page.evaluate(() => ({
        stories: [...document.querySelectorAll('[data-story]')].map((el) => el.dataset.story),
        mostRead: [...document.querySelectorAll('[data-most-read] a')].map((a) => new URL(a.href).pathname.split('/').pop()),
        markets: [...document.querySelectorAll('[data-market]')].map((el) => `${el.dataset.market}=${el.textContent}`),
        fallbacks: document.querySelectorAll('[data-most-read-loading], [data-markets-loading]').length,
        railOrder: [...document.querySelectorAll('.rail > *')].map((el) => el.tagName.toLowerCase()).join(','),
        templates: document.querySelectorAll('template').length,
        title: document.title,
      }));
      const wantMarkets = news.marketsFor(frontPage).map((m) => `${m.name}=${m.value}`);
      await page.click('[data-compact]');
      const compact = await page.evaluate(() => document.querySelector('.stories').classList.contains('compact')
        && document.querySelector('[data-compact]').getAttribute('aria-pressed') === 'true');
      await sleep(300);
      check('render:server',
        JSON.stringify(dom.stories) === JSON.stringify(news.pageOfStories(frontPage).map((s) => s.slug))
          && JSON.stringify(dom.mostRead) === JSON.stringify(news.mostReadFor(frontPage).map((m) => m.slug))
          && JSON.stringify(dom.markets) === JSON.stringify(wantMarkets)
          && dom.fallbacks === 0 && dom.templates === 0 && dom.railOrder === 'h2,ol,h2,dl',
        'the streamed page lands each boundary in its own place, with no fallback or template left',
        `stories=${dom.stories.length} most-read=${dom.mostRead.length} markets=${dom.markets.join(',')} fallbacks=${dom.fallbacks} rail=${dom.railOrder}`);
      check('render:hydration', compact && probe.hydrated && diag.errors.length === 0 && apiCalls.length === 0,
        'the streamed front page hydrates and is interactive, adopting both queries without fetching them',
        `compact=${compact} api-calls=${apiCalls.join(',') || 0} errors=${diag.errors.slice(0, 2).join(' | ') || 0}`);
      reporter.assert(probe.mismatches.length === 0 && probe.added === 0 && probe.textChanged === 0,
        'the streamed front page hydrates with zero mismatches and adds no node',
        `mismatches=${JSON.stringify(probe.mismatches)} added=${probe.added} text-changed=${probe.textChanged}`);

      await page.click('[data-next]');
      await page.waitForFunction((n) => document.querySelector('[data-front]')?.dataset.front === String(n) && window.__newsroom?.hydrated, frontPage + 1, { timeout: 10000 });
      const next = await page.evaluate(() => ({
        search: location.search,
        stories: [...document.querySelectorAll('[data-story]')].map((el) => el.dataset.story),
        pageOf: document.querySelector('[data-page-of]').textContent,
      }));
      const statuses = {};
      for (const q of ['?page=0', `?page=${news.PAGE_COUNT + 1}`, '?page=two', `?page=${news.PAGE_COUNT}`]) {
        statuses[q] = (await fetch(`${base}/${q}`)).status;
      }
      check('route:query-pagination',
        next.search === `?page=${frontPage + 1}`
          && JSON.stringify(next.stories) === JSON.stringify(news.pageOfStories(frontPage + 1).map((s) => s.slug))
          && next.pageOf === `Page ${frontPage + 1} of ${news.PAGE_COUNT}`
          && statuses['?page=0'] === 404 && statuses[`?page=${news.PAGE_COUNT + 1}`] === 404 && statuses['?page=two'] === 404
          && statuses[`?page=${news.PAGE_COUNT}`] === 200,
        'the query string drives the page of stories; a page out of range is a 404',
        `next=${next.search} ${next.pageOf} statuses=${JSON.stringify(statuses)}`);
      reporter.assert(dom.title === `Page ${frontPage} · The Morning Ledger`, 'the front page title names its page', dom.title);
    });

    // === Article: ISR, head, a long page that hydrates without building =====
    const slug = 'story-04';
    const article = news.articleBody(slug);
    // The words the body shows: each paragraph is its lead, the emphasis, the
    // link and the tail, joined as src/pages/article.js joins them.
    const blockText = (b) => (b.type === 'p' ? `${b.lead} ${b.em}, as ${b.link.text} showed.${b.tail}` : b.type === 'quote' ? `${b.text} ${b.source}` : b.text);
    const words = article.blocks.map(blockText).join(' ').split(/\s+/).filter(Boolean).length;
    const first = await fetch(`${base}/article/${slug}`);
    const html = await first.text();
    const second = await fetch(`${base}/article/${slug}`);
    await second.text();
    check('render:hybrid-isr',
      first.headers.get('x-what-cache') === 'MISS' && second.headers.get('x-what-cache') === 'HIT',
      'an article page is cached: MISS, then HIT',
      `${first.headers.get('x-what-cache')} then ${second.headers.get('x-what-cache')}`);
    check('cmp:head',
      unescape(titleOf(html)) === `${article.headline} · The Morning Ledger`
        && unescape(metaOf(html, 'name', 'description')) === article.dek
        && unescape(metaOf(html, 'property', 'og:title')) === article.headline
        && metaOf(html, 'property', 'og:type') === 'article',
      'each article server-renders its own title, description and Open Graph tags',
      `title="${titleOf(html)}"`);
    check('island:ssr-content',
      /data-island="CommentForm"[^>]*>[\s\S]*?<form[^>]*data-comment-form/.test(html)
        && /data-island="ShareMenu"[^>]*>[\s\S]*?data-share=""/.test(html)
        && /data-island="ReadingNow"[^>]*>[\s\S]*?reading now/.test(html),
      'each island ships its server HTML: the comment form works before any script',
      'CommentForm, ShareMenu, ReadingNow');

    const context = await browser.newContext({ viewport: { width: 800, height: 900 } });
    await context.addInitScript(COUNT_CREATED);
    try {
      await withPage(browser, `${base}/article/${slug}`, async (page, diag) => {
        const readingCalls = [];
        page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/reading-now') readingCalls.push(r.url()); });
        await page.waitForFunction(() => window.__newsroom?.hydrated === true, undefined, { timeout: 10000 });
        const probe = await page.evaluate(() => window.__newsroom);
        const body = await page.evaluate(() => {
          const el = document.querySelector('[data-article-body]');
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
          let nodes = 0;
          while (walker.nextNode()) nodes++;
          // Block by block: textContent runs one block's last word into the next.
          const text = [...el.children].map((b) => (b.tagName === 'BLOCKQUOTE' ? [...b.children].map((c) => c.textContent).join(' ') : b.textContent)).join(' ');
          return { nodes, words: text.split(/\s+/).filter(Boolean).length, headline: document.querySelector('[data-headline]').textContent, title: document.title };
        });
        await page.click('[data-save]');
        const saved = await page.getAttribute('[data-save]', 'aria-pressed');

        check('render:hydration-adopts-long-page',
          body.words === words && words >= 2500 && body.nodes >= 400 && probe.created === 0 && probe.added === 0 && probe.textChanged === 0,
          'a long article hydrates by adopting the server DOM: no node created, added or rewritten',
          `words=${body.words} (want ${words}) nodes=${body.nodes} created=${probe.created} added=${probe.added} text-changed=${probe.textChanged}`);
        check('render:no-hydration-mismatch',
          probe.mismatches.length === 0 && !diag.all.some((l) => /mismatch|ERR_HYDRATION/i.test(l)),
          'the article hydrates with zero mismatch reports',
          `reports=${JSON.stringify(probe.mismatches)}`);
        check('route:params', body.headline === article.headline && body.title === `${article.headline} · The Morning Ledger`,
          'the :slug param picks the article', body.headline);
        check('data:loader', body.words === words, 'the loader supplies the whole article body', `words=${body.words}`);
        reporter.assert(saved === 'true', 'the article page is interactive after hydration (save toggle)', `aria-pressed=${saved}`);

        // --- Islands, at 800 px wide and the top of the page ------------------
        const hydratedNow = () => page.evaluate(() => [...document.querySelectorAll('[data-island-hydrated]')].map((el) => el.dataset.island));
        check('island:load', (await hydratedNow()).includes('CommentForm'),
          'client:load: the comment form hydrates with the page', (await hydratedNow()).join(','));
        await page.waitForSelector('[data-island="TextSize"][data-island-hydrated]', { timeout: 5000 });
        await page.click('[data-text-larger]');
        const size = await page.getAttribute('[data-article-body]', 'data-text-size');
        check('island:idle', size === 'large', 'client:idle: text size hydrates once the page is idle and drives the article', `size=${size}`);
        await sleep(500);
        const beforeScroll = await hydratedNow();
        const readingBefore = readingCalls.length;
        await page.locator('[data-reading-now]').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => /^\d+$/.test(document.querySelector('[data-reading-count]')?.textContent ?? ''), undefined, { timeout: 6000 });
        const readers = await page.textContent('[data-reading-count]');
        check('island:visible',
          !beforeScroll.includes('ReadingNow') && readingBefore === 0 && Number(readers) >= 1,
          'client:visible: the reading-now counter wakes (and polls) only once scrolled into view',
          `before=${beforeScroll.includes('ReadingNow')} polls-before=${readingBefore} readers=${readers}`);

        await page.locator('[data-share]').scrollIntoViewIfNeeded();
        const shareBefore = (await hydratedNow()).includes('ShareMenu');
        await page.click('[data-share]');
        const openAfterFirstClick = await page.getAttribute('[data-share]', 'aria-expanded');
        const menuShown = await page.locator('[data-share-menu]').isVisible();
        await page.keyboard.press('Escape');
        const closed = await page.getAttribute('[data-share]', 'aria-expanded');
        check('island:interaction',
          !shareBefore && openAfterFirstClick === 'true' && menuShown && closed === 'false',
          'client:interaction: the share menu hydrates on the first click, and that click opens it',
          `hydrated-before=${shareBefore} first-click=${openAfterFirstClick} shown=${menuShown} after-escape=${closed}`);

        const contentsNarrow = (await hydratedNow()).includes('Contents');
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.waitForSelector('[data-island="Contents"][data-island-hydrated]', { timeout: 5000 }).catch(() => {});
        const contentsWide = (await hydratedNow()).includes('Contents');
        await page.click('[data-contents-toggle]').catch(() => {});
        const contentsHidden = await page.locator('[data-contents-list]').isHidden().catch(() => false);
        check('island:media', !contentsNarrow && contentsWide && contentsHidden,
          'client:media: the contents rail hydrates only once (min-width: 1100px) matches',
          `at-800px=${contentsNarrow} at-1280px=${contentsWide} toggled=${contentsHidden}`);
        // Nothing above builds a node once hydrated (the menu and the list
        // toggle `hidden`, the counter rewrites a text node), so the whole
        // page, its five islands included, should have created none.
        const createdTotal = await page.evaluate(() => window.__nodesCreated());
        reporter.assert(createdTotal === 0, 'the page and all five islands hydrated, and were used, without creating a node',
          `created=${createdTotal}`);
        reporter.assert(diag.errors.length === 0, 'the article ran all five islands with zero page errors', diag.errors.slice(0, 2).join(' | '));
      }, { context });
    } finally {
      await context.close();
    }

    // === Typed before hydration survives it; the action with JavaScript =======
    {
      const context = await browser.newContext();
      await context.addInitScript(COUNT_CREATED);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      let release;
      const gate = new Promise((r) => { release = r; });
      await page.route('**/src/entry-client.js', async (route) => { await gate; await route.continue(); });
      try {
        await page.goto(`${base}/article/${slug}`, { waitUntil: 'commit' });
        await page.waitForSelector('[data-comment-body]');
        const typed = { author: 'Wren', body: 'Typed while the scripts were still on their way.' };
        await page.fill('[data-comment-author]', typed.author);
        await page.fill('[data-comment-body]', typed.body);
        const hydratedEarly = await page.evaluate(() => window.__newsroom !== undefined);
        release();
        await page.waitForSelector('[data-island="CommentForm"][data-island-hydrated]', { timeout: 10000 });
        const kept = {
          author: await page.inputValue('[data-comment-author]'),
          body: await page.inputValue('[data-comment-body]'),
        };
        const probe = await page.evaluate(() => window.__newsroom);
        check('island:input-before-hydration',
          !hydratedEarly && kept.author === typed.author && kept.body === typed.body && probe.mismatches.length === 0,
          'text typed into the comment form before hydration survives it',
          `typed-before-hydration=${!hydratedEarly} author="${kept.author}" body-kept=${kept.body === typed.body} mismatches=${probe.mismatches.length}`);

        const createdBeforePost = await page.evaluate(() => window.__nodesCreated());
        await page.click('[data-comment-submit]');
        await page.waitForFunction(() => document.querySelector('[data-comment-status]')?.dataset.commentStatus !== 'sending'
          && document.querySelector('[data-comment-status]')?.dataset.commentStatus !== 'idle', undefined, { timeout: 10000 });
        const outcome = await page.evaluate(() => ({
          status: document.querySelector('[data-comment-status]').dataset.commentStatus,
          shown: [...document.querySelectorAll('[data-just-posted] .comment-body')].map((el) => el.textContent),
          body: document.querySelector('[data-comment-body]').value,
          url: location.pathname,
        }));
        const createdByPost = await page.evaluate((n) => window.__nodesCreated() - n, createdBeforePost);
        reporter.assert(createdByPost > 0, 'the node counter the hydration check relies on counts what the page creates (the posted comment)',
          `created-by-post=${createdByPost}`);
        const after = await fetch(`${base}/article/${slug}`);
        const afterHtml = await after.text();
        const again = await fetch(`${base}/article/${slug}`);
        await again.text();
        check('server:action-js',
          outcome.status === 'posted' && outcome.shown.includes(typed.body) && outcome.body === '' && outcome.url === `/article/${slug}`,
          'with JavaScript, the comment posts through the action and shows without a reload',
          `status=${outcome.status} shown=${outcome.shown.length} form-reset=${outcome.body === ''}`);
        check('server:revalidate',
          after.headers.get('x-what-cache') === 'MISS' && afterHtml.includes(typed.body) && again.headers.get('x-what-cache') === 'HIT',
          "the action's tag revalidation makes the cached article render the comment, then cache again",
          `${after.headers.get('x-what-cache')} (has comment: ${afterHtml.includes(typed.body)}) then ${again.headers.get('x-what-cache')}`);

        // The error path with JavaScript: an empty comment.
        await page.fill('[data-comment-body]', ' ');
        await page.click('[data-comment-submit]');
        await page.waitForFunction(() => document.querySelector('[data-comment-status]')?.dataset.commentStatus === 'failed', undefined, { timeout: 10000 }).catch(() => {});
        const failed = await page.getAttribute('[data-comment-status]', 'data-comment-status');
        reporter.assert(failed === 'failed' && errors.length === 0, 'a refused comment shows as failed in the island, with no page error',
          `status=${failed} errors=${errors.slice(0, 2).join(' | ') || 0}`);
      } finally {
        await context.close();
      }
    }

    // === The action without JavaScript ========================================
    {
      const noJsSlug = 'story-03';
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      try {
        await page.goto(`${base}/article/${noJsSlug}`);
        const text = 'Posted from a browser with scripting off.';
        await page.fill('[data-comment-author]', 'Ines');
        await page.fill('[data-comment-body]', text);
        await Promise.all([page.waitForNavigation(), page.click('[data-comment-submit]')]);
        const landed = new URL(page.url());
        const comments = await page.$$eval('[data-comment-list] .comment-body', (els) => els.map((el) => el.textContent));
        check('server:action-nojs',
          landed.pathname === `/article/${noJsSlug}` && landed.hash === '#comments' && comments.includes(text),
          'without JavaScript, the comment form posts, redirects back, and the article shows the comment',
          `landed=${landed.pathname}${landed.hash} comments=${comments.length} has-new=${comments.includes(text)}`);

        // The error path without JavaScript, then the server is still serving.
        await page.goto(`${base}/article/${noJsSlug}`);
        await page.fill('[data-comment-body]', '');
        const refused = await Promise.all([page.waitForNavigation(), page.click('[data-comment-submit]')]).then(([res]) => res?.status());
        const refusedText = await page.textContent('body');
        const json = await fetch(`${base}/__what_action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-what-action': 'postComment', origin: base },
          body: JSON.stringify({ args: [{ slug: 'no-such-story', body: 'hello there' }] }),
        });
        const jsonBody = await json.json().catch(() => ({}));
        const stillServing = await Promise.all([fetch(`${base}/`), fetch(`${base}/article/${noJsSlug}`)]);
        check('server:action-error',
          refused === 500 && !/two characters/.test(refusedText) && json.status === 500 && !/no-such-story/.test(JSON.stringify(jsonBody))
            && stillServing.every((r) => r.status === 200),
          'a refused comment (empty, or for an unknown story) is a generic 500, and the server keeps serving',
          `no-js=${refused} json=${json.status} ${JSON.stringify(jsonBody)} after=${stillServing.map((r) => r.status).join(',')}`);
      } finally {
        await context.close();
      }
    }

    // === 100 concurrent requests, each for its own page =========================
    {
      const articleSlugs = news.storyList().slice(news.STORY_COUNT - CONCURRENT).map((s) => s.slug); // never requested yet: all MISS
      const frontPages = Array.from({ length: CONCURRENT }, (_, i) => (i % news.PAGE_COUNT) + 1);
      const t0 = performance.now();
      const [articles, fronts] = await Promise.all([
        Promise.all(articleSlugs.map((s) => fetch(`${base}/article/${s}`).then(async (r) => ({ s, cache: r.headers.get('x-what-cache'), status: r.status, html: await r.text() })))),
        Promise.all(frontPages.map((n) => fetch(`${base}/?page=${n}`).then(async (r) => ({ n, status: r.status, html: await r.text() })))),
      ]);
      const elapsed = performance.now() - t0;
      const wrongArticles = articles.filter(({ s, status, html }) => {
        const meta = news.storyBySlug(s);
        const islandSlugs = [...html.matchAll(/data-island-props="([^"]*)"/g)].map((m) => JSON.parse(unescape(m[1])).slug).filter(Boolean);
        return status !== 200
          || unescape(titleOf(html)) !== `${meta.headline} · The Morning Ledger`
          || !html.includes(`data-article="${s}"`)
          || unescape(/data-headline="">([^<]*)</.exec(html)?.[1]) !== meta.headline
          || unescape(metaOf(html, 'name', 'description')) !== meta.dek
          || islandSlugs.length !== 3 || islandSlugs.some((x) => x !== s);
      }).map((a) => a.s);
      const wrongFronts = fronts.filter(({ n, status, html }) => {
        const mostReadHtml = /<ol[^>]*class="most-read"[\s\S]*?<\/ol>/.exec(html)?.[0] ?? '';
        return status !== 200
          || !html.includes(`data-front="${n}"`)
          || JSON.stringify(slugsIn(html, 'data-story')) !== JSON.stringify(news.pageOfStories(n).map((s) => s.slug))
          || !html.includes(`data-most-read="${n}"`) || !html.includes(`data-markets="${n}"`)
          || JSON.stringify([...mostReadHtml.matchAll(/\/article\/(story-\d+)/g)].map((m) => m[1])) !== JSON.stringify(news.mostReadFor(n).map((m) => m.slug))
          || unescape(titleOf(html)) !== (n === 1 ? 'The Morning Ledger' : `Page ${n} · The Morning Ledger`);
      }).map((f) => f.n);
      check('server:request-isolation',
        wrongArticles.length === 0 && wrongFronts.length === 0 && articles.every((a) => a.cache === 'MISS'),
        `${CONCURRENT} concurrent article renders and ${CONCURRENT} concurrent streamed front pages each carry only their own content`,
        `wrong-articles=${wrongArticles.join(',') || 0} wrong-fronts=${wrongFronts.join(',') || 0} cache=${[...new Set(articles.map((a) => a.cache))].join('/')} in ${elapsed.toFixed(0)}ms`);
    }

    // === Memory over 2,000 requests =============================================
    {
      const heap = async () => (await (await fetch(`${base}/__diag/heap`)).json()).heapUsed;
      const slugs = news.storyList().map((s) => s.slug);
      let sent = 0;
      let failures = 0;
      const batch = async (count) => {
        const queue = Array.from({ length: count }, (_, i) => {
          const k = sent + i;
          return k % 4 === 0 ? `/?page=${(k % news.PAGE_COUNT) + 1}` : `/article/${slugs[k % slugs.length]}`;
        });
        sent += count;
        const worker = async () => {
          while (queue.length) {
            const path = queue.shift();
            const res = await fetch(`${base}${path}`);
            await res.arrayBuffer();
            if (res.status !== 200) failures++;
          }
        };
        await Promise.all(Array.from({ length: 50 }, worker));
      };
      await batch(500);
      const heaps = [await heap()];
      for (let i = 0; i < 3; i++) {
        await batch((MEMORY_REQUESTS - 500) / 3);
        heaps.push(await heap());
      }
      const growth = heaps[3] - heaps[0];
      const climbing = heaps.every((h, i) => i === 0 || h > heaps[i - 1]);
      check('server:memory',
        sent === MEMORY_REQUESTS && failures === 0 && growth < HEAP_GROWTH_BOUND && !(climbing && growth > 1024 * 1024),
        `the server's heap after a full GC stays level across ${MEMORY_REQUESTS} requests (a quarter of them streamed)`,
        `heap ${heaps.map((h) => `${(h / 1048576).toFixed(2)}MB`).join(' -> ')} growth=${(growth / 1024).toFixed(0)}KB requests=${sent} failures=${failures}`);
      log(`heap=${heaps.map((h) => (h / 1048576).toFixed(2)).join('/')}MB`);
    }

    reporter.assert(server.exitCode === null, 'the server is still running after every check', `exit=${server.exitCode}`);
  },
};
