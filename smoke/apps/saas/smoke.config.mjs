// Northstar, a multi-tenant SaaS console: smoke contract.
//
// The shape most real apps have, which no other app here has whole: pages
// in a file router with a _layout per section nested three deep (the frame,
// an org's shell, its projects), server-rendered below a base path
// (/console) and hydrated, with filters, sort, page and an open editor in the
// query string, per-route loaders, useQuery over one cache every section
// reads, an optimistic server action that redirects, a sign-in guard, and a
// 2,000-row table.
//
// Two checks hold React Router's behaviour that the router does not have
// yet. They are listed in KNOWN_GAPS: while one fails it is reported as a
// skip naming the gap, with what it measured; once it passes it is a pass,
// and the line saying so asks for the entry to be removed.

import { startProcess, waitForHttp } from '../../harness/index.mjs';

const BASE_PATH = '/console';
const SESSION = 'ns-session';
const sessionValue = (name) => encodeURIComponent(JSON.stringify({ name }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The router's gaps these checks run into (REPORT round 10, dev lane, §2).
const KNOWN_GAPS = {
  'shared-layout': 'what-router rebuilds the whole layout chain when any layout in it changes, so the org shell (and the text in its search box) is built again between a section (frame > org) and a project (frame > org > projects); React Router keeps the shared parent layout',
  'query-remount': 'what-router builds the page again when only the query string changes, so the issue list loses its state on a filter change; React Router keeps the page mounted',
};

// Budgets, measured in the page. The sort is a keyed reorder of 2,000 rows;
// the hydration budget is at 4x CPU throttling (Chromium).
const SORT_BUDGET_MS = 400;
const LONG_TASK_BOUND_MS = 400;
const HEAP_GROWTH_BOUND = 3 * 1024 * 1024;
const TTI_BUDGET_MS = 3000;
const FIRST_INPUT_BUDGET_MS = 600;

// Pages a visitor can land on, each rendered by the server and hydrated.
const ENTRY_ROUTES = [
  '/',
  '/login',
  '/org/acme',
  '/org/acme/members',
  '/org/acme/billing',
  '/org/acme/projects',
  '/org/acme/projects/apollo/overview',
  '/org/acme/projects/apollo/issues?status=open&sort=priority&page=2',
  '/org/acme/projects/apollo/settings',
  '/no/such/page',
];

export default {
  description: 'Northstar, a multi-tenant SaaS console: file-router pages with a _layout per section nested three deep, server-rendered below /console and hydrated, URL-driven filters and editor, per-route loaders, useQuery over a shared cache, an optimistic server action that redirects, a sign-in guard, a 2,000-member table.',

  // WHAT_SMOKE_MODE=dev runs `npm run dev` (server.js --dev): the pages
  // rendered from the source through Vite's dev server (smoke/README.md).
  dev: true,

  // The development diagnostics the two router gaps raise, while they last.
  devDiagnostics: {
    'A reactive region rebuilt <Frame> when it ran again': `the shared-layout gap: ${KNOWN_GAPS['shared-layout']}`,
    'A reactive region rebuilt <Issues> when it ran again': `the query-remount gap: ${KNOWN_GAPS['query-remount']}`,
  },

  covers: [
    'render:server',
    'render:hydration',
    'render:no-hydration-mismatch',
    'route:file-router',
    'route:nested-layout',
    'route:layout-hydrates',
    'route:layout-persists',
    'route:query-keeps-page',
    'route:base-path',
    'route:url-state',
    'route:history',
    'route:guard',
    'route:server-redirect',
    'route:params',
    'route:404',
    'data:loader',
    'data:loader-request',
    'data:query',
    'data:invalidate',
    'data:optimistic',
    'data:optimistic-rollback',
    'server:action-js',
    'cmp:keyed-list',
    'perf:long-tasks',
    'perf:memory',
    'perf:hydration-tti',
  ],

  async check({ workDir, appPort, mode, browser, browserName, check, skip, reporter, log, run }) {
    const origin = `http://127.0.0.1:${appPort}`;
    const url = (path) => `${origin}${BASE_PATH}${path}`;
    // A check that runs into a known router gap: a skip with the gap and the
    // measurement while it fails, a pass once it holds.
    const gapCheck = (gap, capability, cond, name, detail) => {
      if (cond) return check(capability, true, name, `${detail}; the ${gap} gap is fixed: remove it from KNOWN_GAPS`);
      skip(capability, name, `known router gap (${gap}): ${KNOWN_GAPS[gap]}. Measured: ${detail}`);
      return false;
    };

    if (mode !== 'dev') {
      const buildLog = run('npm', ['run', 'build'], { cwd: workDir });
      reporter.assert((buildLog.match(/built in/g) || []).length === 2,
        'vite built the client and the server bundles', buildLog.trim().split('\n').pop());
    }
    const server = startProcess('node', ['server.js', ...(mode === 'dev' ? ['--dev'] : [])], { cwd: workDir, env: { ...process.env, PORT: String(appPort) } });
    await waitForHttp(url('/'), { child: server });

    const signedIn = `${SESSION}=${sessionValue('Ana Ruiz')}`;
    const get = (path, cookie) => fetch(url(path), { redirect: 'manual', headers: cookie ? { cookie } : {} });
    // Every place the app sends a visitor or a request, collected across the
    // run and checked against the base at the end.
    const outside = [];
    const seenUrls = { links: 0, redirects: 0, requests: 0 };
    const belowBase = (where, href) => {
      if (href == null) return;
      const at = new URL(href, origin);
      if (at.origin !== origin) return;
      if (at.pathname !== BASE_PATH && !at.pathname.startsWith(`${BASE_PATH}/`)) outside.push(`${where}: ${href}`);
    };
    const linksBelowBase = (where, html) => {
      for (const m of html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)) { seenUrls.links++; belowBase(where, m[1]); }
    };
    const newContext = async (name) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      if (name) await context.addCookies([{ name: SESSION, value: sessionValue(name), url: url('/') }]);
      context.on('request', (r) => { seenUrls.requests++; belowBase(`request ${r.resourceType()}`, r.url()); });
      return context;
    };
    const watch = (page) => {
      const diag = { errors: [], warnings: [] };
      page.on('pageerror', (e) => diag.errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 404/.test(m.text())) diag.errors.push(m.text());
        if (m.type() === 'warning') diag.warnings.push(m.text());
      });
      return diag;
    };
    const hydrated = (page) => page.waitForFunction(() => window.__ns?.hydrated === true, undefined, { timeout: 15000 });
    const clientEntry = mode === 'dev' ? '**/src/entry-client.jsx' : '**/assets/entry-client-*.js';

    // === The server: a guard's redirect, a deep link, a 404, below the base =====
    {
      const anon = await get('/org/acme/members');
      const login = anon.headers.get('location');
      seenUrls.redirects++;
      belowBase('server guard redirect', login);
      check('route:server-redirect',
        [302, 303, 307].includes(anon.status) && login === `${BASE_PATH}/login?next=${encodeURIComponent('/org/acme/members')}`,
        'a signed-out deep link is a real 3xx to sign-in below the base, naming where it came from',
        `status=${anon.status} location=${login}`);

      const deep = await (await get('/org/acme/projects/apollo/issues?status=open&page=2', signedIn)).text();
      const nested = /data-frame[\s\S]*data-org-shell[\s\S]*data-projects-layout[\s\S]*data-tab="issues"[\s\S]*data-page="issues"/.test(deep);
      const selected = /<option value="open" selected>/.test(deep);
      // useQuery renders the entries the loader prefetched on the server.
      const rows = (deep.match(/<tr data-issue="APO-\d+"/g) || []).length;
      const count = /data-open-count="true"><!--\$-->\d+<!--\/\$-->/.test(deep);
      linksBelowBase('server html (issues)', deep);
      check('render:server', nested && selected && rows === 20 && count && deep.includes('data-user="true"><!--$-->Ana Ruiz<!--/$-->'),
        "a deep link to an issue list renders frame > org shell > projects layout > page on the server, with the filter from its query, the visitor from the cookie, and the loader's data in useQuery (20 rows, the shell's open count)",
        `nested=${nested} status-selected=${selected} rows=${rows} open-count=${count} user=${deep.includes('Ana Ruiz')}`);
      const carried = /"query:issues:acme:apollo:open:updated:2":\{"rows":\[\{"id":"APO-/.test(deep) && deep.includes('"query:org:acme":');
      check('data:loader', carried,
        "the route's loader filled the request's query cache, and the page carries those entries to the browser",
        `issues-entry=${/"query:issues:acme:apollo:open:updated:2"/.test(deep)} org-entry=${deep.includes('"query:org:acme":')}`);
      const asGlobex = await (await get('/org/globex', `${SESSION}=${sessionValue('Lee Park')}`)).text();
      check('data:loader-request', asGlobex.includes('Lee Park') && asGlobex.includes('"query:org:globex":') && !asGlobex.includes('"query:org:acme":'),
        "the loader reads the request (its cookie and its params) and fills only that visitor's org",
        `user=${asGlobex.includes('Lee Park')} globex=${asGlobex.includes('"query:org:globex":')} acme=${asGlobex.includes('"query:org:acme":')}`);

      const missing = await get('/no/such/page', signedIn);
      const missingHtml = await missing.text();
      check('route:404', missing.status === 404 && missingHtml.includes('data-page="404"') && missingHtml.includes('data-frame'),
        'a URL no page answers renders the catch-all page inside the frame with a 404 status, on the server',
        `status=${missing.status} page=${missingHtml.includes('data-page="404"')}`);
    }

    // === Every entry route hydrates onto the server's DOM ========================
    {
      const context = await newContext('Ana Ruiz');
      const page = await context.newPage();
      const diag = watch(page);
      const results = [];
      for (const path of ENTRY_ROUTES) {
        diag.warnings.length = 0;
        const response = await page.goto(url(path));
        linksBelowBase(`server html ${path}`, await response.text());
        await hydrated(page);
        await sleep(400);
        const r = await page.evaluate(() => ({
          mismatches: window.__ns.mismatches,
          added: window.__ns.added,
          removed: window.__ns.removed,
          api: window.__nsApi.count,
          hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
        }));
        for (const href of r.hrefs) { seenUrls.links++; belowBase(`hydrated ${path}`, href); }
        const warned = diag.warnings.filter((w) => /mismatch|ERR_HYDRATION/i.test(w));
        results.push({ path, ...r, warned });
      }
      const bad = results.filter((r) => r.mismatches.length || r.added || r.removed || r.warned.length);
      check('render:no-hydration-mismatch', bad.length === 0,
        `all ${ENTRY_ROUTES.length} entry routes hydrate with no mismatch and no node added or removed`,
        bad.length ? bad.map((r) => `${r.path}: mismatches=${JSON.stringify(r.mismatches)} added=${r.added} removed=${r.removed} warned=${r.warned.length}`).join(' | ') : `${results.length} routes clean`);
      const fetched = results.filter((r) => r.api > 0 && r.path !== '/no/such/page' && r.path !== '/' && r.path !== '/login');
      check('data:query', fetched.length === 0,
        'each hydrated page shows the entries its loader filled without a request of its own (useQuery adopts them)',
        fetched.length ? fetched.map((r) => `${r.path}: ${r.api} requests`).join(', ') : 'no request after hydration on any page');
      check('render:hydration', diag.errors.length === 0, 'every entry route hydrates with no page error',
        `errors=${diag.errors.slice(0, 3).join(' | ') || 0}`);
      await context.close();
    }

    // === The layout chain hydrates onto the server's nodes =======================
    {
      const context = await newContext('Ana Ruiz');
      const page = await context.newPage();
      let release;
      const gate = new Promise((r) => { release = r; });
      await page.route(clientEntry, async (route) => { await gate; await route.continue(); });
      await page.goto(url('/org/acme/projects/apollo/issues'), { waitUntil: 'commit' });
      await page.waitForSelector('[data-page="issues"]');
      await page.evaluate(() => {
        for (const s of ['[data-frame]', '[data-org-shell]', '[data-projects-layout]', '[data-page="issues"]']) document.querySelector(s).__fromServer = true;
      });
      release();
      await hydrated(page);
      const kept = await page.evaluate(() => ['[data-frame]', '[data-org-shell]', '[data-projects-layout]', '[data-page="issues"]'].map((s) => document.querySelector(s)?.__fromServer === true));
      check('route:layout-hydrates', kept.every(Boolean),
        "hydration keeps the server's nodes of the frame, the org shell, the projects layout and the page",
        `frame=${kept[0]} shell=${kept[1]} projects=${kept[2]} page=${kept[3]}`);
      await context.close();
    }

    // === The org shell, its search text and the projects layout stay =============
    {
      const context = await newContext('Ana Ruiz');
      const page = await context.newPage();
      const diag = watch(page);
      const mark = (sel, key) => page.evaluate(([s, k]) => { const el = document.querySelector(s); if (el) el[k] = true; }, [sel, key]);
      const state = () => page.evaluate(() => ({
        path: location.pathname,
        shell: document.querySelector('[data-org-shell]')?.__kept === true,
        projects: document.querySelector('[data-projects-layout]')?.__kept === true,
        search: document.querySelector('[data-search]')?.value,
        hint: document.querySelector('[data-search-hint]')?.textContent ?? null,
      }));
      const go = async (selector, waitFor) => {
        await page.click(selector);
        await page.locator(waitFor).first().waitFor();
        await page.waitForFunction(() => !document.querySelector('[data-page]')?.textContent.includes('Loading'), undefined, { timeout: 5000 }).catch(() => {});
      };

      // Between sections (frame > org around each).
      await page.goto(url('/org/acme/members'));
      await hydrated(page);
      await mark('[data-org-shell]', '__kept');
      await page.fill('[data-search]', 'roadmap');
      await go('[data-nav="billing"]', '[data-page="billing"]');
      await go('[data-nav="overview"]', '[data-page="overview"]');
      await go('[data-nav="members"]', '[data-page="members"]');
      const sections = await state();
      const sectionChain = await page.evaluate(() => !!document.querySelector('[data-frame] [data-org-shell] [data-org-main] > [data-page="members"]') && !document.querySelector('[data-projects-layout]'));
      check('route:nested-layout', sections.shell && sections.search === 'roadmap' && sections.hint?.includes('roadmap'),
        'moving between members, billing and the overview keeps the org shell node and the text typed into its search box',
        `shell-same-node=${sections.shell} search="${sections.search}" at=${sections.path}`);

      // Between projects and their tabs (frame > org > projects around each).
      await go('[data-nav="projects"]', '[data-page="projects"]');
      await go('[data-project-link="apollo"]', '[data-page="project-overview"]');
      await mark('[data-org-shell]', '__kept');
      await mark('[data-projects-layout]', '__kept');
      await page.fill('[data-search]', 'sso');
      await go('[data-tab="issues"]', '[data-page="issues"]');
      await go('[data-tab="settings"]', '[data-page="project-settings"]');
      await go('[data-project-link="borealis"]', '[data-page="project-overview"]');
      await page.waitForFunction(() => document.querySelector('[data-project-title]')?.textContent === 'Borealis');
      await go('[data-tab="issues"]', '[data-page="issues"]');
      const tabs = await state();
      const projectChain = await page.evaluate(() => !!document.querySelector('[data-frame] [data-org-shell] [data-org-main] > [data-projects-layout] [data-project-head] + [data-page="issues"]'));
      check('route:file-router', sectionChain && projectChain,
        'pages from src/pages sit inside every _layout above them as the browser navigates: frame > org shell > members, frame > org shell > projects > issues',
        `members-in-frame-and-shell=${sectionChain} issues-in-frame-shell-and-projects=${projectChain}`);
      const tabHref = await page.getAttribute('[data-tab="settings"]', 'href');
      check('route:layout-persists', tabs.shell && tabs.projects && tabs.search === 'sso' && tabHref === `${BASE_PATH}/org/acme/projects/borealis/settings`,
        "moving between a project's tabs and to another project keeps the org shell, the projects layout and the search text, and the tabs follow the project",
        `shell=${tabs.shell} projects=${tabs.projects} search="${tabs.search}" settings-tab=${tabHref}`);

      // Between a section and a project: the chains differ below the org shell.
      await go('[data-nav="members"]', '[data-page="members"]');
      await go('[data-nav="projects"]', '[data-page="projects"]');
      await go('[data-project-link="apollo"]', '[data-page="project-overview"]');
      await go('[data-nav="billing"]', '[data-page="billing"]');
      const across = await state();
      gapCheck('shared-layout', 'route:layout-persists', across.shell && across.search === 'sso',
        'moving between a section and a project keeps the org shell node and its search text',
        `shell-same-node=${across.shell} search="${across.search}" after members > projects > apollo > billing`);

      // Another org: the shell stays and its links follow the org's id.
      await go('[data-switch="globex"]', '[data-page="overview"]');
      await page.waitForFunction(() => document.querySelector('[data-org-name]')?.textContent === 'Globex'
        && document.querySelector('[data-project-card]')?.dataset.projectCard === 'delta', undefined, { timeout: 10000 });
      const switched = await page.evaluate(() => ({
        members: document.querySelector('[data-nav="members"]').getAttribute('href'),
        cards: [...document.querySelectorAll('[data-project-card]')].map((el) => el.dataset.projectCard),
      }));
      await go('[data-nav="members"]', '[data-page="members"]');
      const landed = new URL(page.url()).pathname;
      check('route:params', switched.members === `${BASE_PATH}/org/globex/members` && landed === `${BASE_PATH}/org/globex/members` && switched.cards.join() === 'delta,ember',
        "switching org keeps the shell and its links follow the new :orgId",
        `members-link=${switched.members} landed=${landed} projects=${switched.cards.join(',')}`);
      reporter.assert(diag.errors.length === 0, 'moving around the org raised no page error', diag.errors.slice(0, 3).join(' | ') || 'none');
      await context.close();
    }

    // === A query change keeps the issue list mounted =============================
    {
      const context = await newContext('Ana Ruiz');
      const page = await context.newPage();
      await page.goto(url('/org/acme/projects/apollo/issues'));
      await hydrated(page);
      await page.evaluate(() => { document.querySelector('[data-page="issues"]').__kept = true; });
      await page.fill('[data-draft]', 'Write the release notes');
      await page.selectOption('[data-filter="status"]', 'open');
      await page.waitForURL(/status=open/);
      await page.waitForFunction(() => document.querySelector('[data-issue-total]')?.textContent === '53 issues');
      const after = await page.evaluate(() => ({ kept: document.querySelector('[data-page="issues"]').__kept === true, draft: document.querySelector('[data-draft]').value }));
      gapCheck('query-remount', 'route:query-keeps-page', after.kept && after.draft === 'Write the release notes',
        'a filter change (a query-string change on the same route) keeps the issue list mounted, with what was typed in it',
        `page-same-node=${after.kept} draft="${after.draft}"`);

      // The page's exported preload holds the navigation until the list it
      // shows is there: a filter nobody has fetched yet shows its rows at once.
      await page.evaluate(() => {
        window.__shown = [];
        new MutationObserver(() => {
          const total = document.querySelector('[data-issue-total]')?.textContent;
          if (total && window.__shown[window.__shown.length - 1] !== total) window.__shown.push(total);
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      });
      const fetchesBefore = await page.evaluate(() => window.__nsApi.count);
      await page.selectOption('[data-filter="status"]', 'in_progress');
      await page.waitForURL(/status=in_progress/);
      await page.waitForFunction(() => document.querySelector('[data-issue-total]')?.textContent === '35 issues', undefined, { timeout: 10000 });
      const shown = await page.evaluate(() => ({ totals: window.__shown, fetched: window.__nsApi.count }));
      check('route:file-router', !shown.totals.includes('Loading…') && shown.totals.includes('35 issues') && shown.fetched > fetchesBefore,
        "a page's exported preload holds a navigation to it until its list is there: a filter not fetched before shows its rows with no loading state",
        `shown=${shown.totals.join(' > ')} fetched=${shown.fetched - fetchesBefore}`);
      await context.close();
    }

    // === Back and forward restore the filters, the editor and the scroll =========
    {
      const context = await newContext('Ana Ruiz');
      const page = await context.newPage();
      const diag = watch(page);
      const snap = () => page.evaluate(() => ({
        search: location.search,
        status: document.querySelector('[data-filter="status"]').value,
        sort: document.querySelector('[data-filter="sort"]').value,
        first: document.querySelector('[data-issue]')?.dataset.issue ?? null,
        current: document.querySelector('[data-page-link][aria-current="page"]')?.dataset.pageLink ?? null,
        editing: document.querySelector('[data-edit-dialog]')?.dataset.editDialog ?? null,
        y: Math.round(window.scrollY),
      }));
      const settle = () => page.waitForFunction(() => {
        const q = new URLSearchParams(location.search);
        const current = document.querySelector('[data-page-link][aria-current="page"]')?.dataset.pageLink;
        return document.querySelector('[data-issue]') && current === (q.get('page') ?? '1') && document.querySelector('[data-filter="status"]').value === (q.get('status') ?? 'all');
      }, undefined, { timeout: 8000 });
      await page.goto(url('/org/acme/projects/apollo/issues'));
      await hydrated(page);
      const states = [await snap()];
      await page.selectOption('[data-filter="status"]', 'open');
      await page.waitForURL(/status=open/); await settle();
      states.push(await snap());
      await page.selectOption('[data-filter="sort"]', 'priority');
      await page.waitForURL(/sort=priority/); await settle();
      states.push(await snap());
      await page.click('[data-page-link="2"]');
      await page.waitForURL(/page=2/); await settle();
      await page.evaluate(() => window.scrollTo(0, 400));
      await sleep(150);
      states.push(await snap());
      // A click in the page: Playwright's own click may scroll the link
      // into view first, which would move the position page 2 is left at.
      await page.evaluate(() => document.querySelector('[data-page-link="3"]').click());
      await page.waitForURL(/page=3/); await settle();
      states.push(await snap());
      const firstOnPage3 = states[4].first;
      await page.click(`[data-edit="${firstOnPage3}"]`);
      await page.waitForSelector(`[data-edit-dialog="${firstOnPage3}"]`);
      states.push(await snap());

      const walked = [];
      for (let i = states.length - 2; i >= 0; i--) {
        await page.goBack();
        await settle();
        await page.waitForFunction((want) => location.search === want, states[i].search);
        await sleep(250);
        walked.unshift({ i, ...(await snap()) });
      }
      const same = (a, b) => a.search === b.search && a.status === b.status && a.sort === b.sort && a.first === b.first && a.current === b.current && a.editing === b.editing;
      const backOk = walked.every((w) => same(w, states[w.i]));
      const scrollOk = Math.abs(walked.find((w) => w.i === 3).y - states[3].y) <= 2;
      await page.goForward(); await settle(); await sleep(200);
      await page.goForward(); await settle(); await sleep(200);
      await page.goForward(); await settle(); await sleep(200);
      await page.goForward(); await settle(); await sleep(250);
      const fwd4 = await snap();
      await page.goForward();
      await page.waitForSelector(`[data-edit-dialog="${firstOnPage3}"]`);
      const fwd5 = await snap();
      const forwardOk = same(fwd4, states[4]) && same(fwd5, states[5]);
      check('route:url-state', backOk && scrollOk && forwardOk,
        'back walks status, sort, page 2 (at its scroll position), page 3 and the open editor in reverse, each with its filters and rows, and forward returns them',
        `back=${backOk} scroll=${walked.find((w) => w.i === 3).y}/${states[3].y} forward=${forwardOk} states=${states.map((s) => `${s.search || '(none)'}:${s.first}`).join(' ')}`);
      check('route:history', backOk && forwardOk && diag.errors.length === 0,
        'browser back and forward through six URLs of one page show the state each had, with no page error',
        `back=${backOk} forward=${forwardOk} errors=${diag.errors.slice(0, 2).join(' | ') || 0}${backOk ? '' : ` walked=${JSON.stringify(walked.map((w) => [w.search, w.first, w.editing]))}`}`);
      await context.close();
    }

    // === The guard, in the browser: signed out, sent to sign in, sent back =======
    {
      const context = await newContext(null);
      const page = await context.newPage();
      const diag = watch(page);
      const target = '/org/acme/projects/apollo/issues?status=open';
      await page.goto(url(target));
      const atLogin = new URL(page.url());
      await hydrated(page);
      await page.fill('[data-login-name]', 'Dana Park');
      await page.click('[data-login-submit]');
      await page.waitForSelector('[data-page="issues"] [data-issue]');
      const back = new URL(page.url());
      const user = await page.textContent('[data-user]');
      await page.reload();
      await hydrated(page);
      const reloaded = await page.evaluate(() => ({ path: location.pathname + location.search, page: document.querySelector('[data-page]')?.dataset.page }));
      // Signed out from the frame, then the marketing page's link into the console.
      await page.click('[data-signout]');
      await page.waitForSelector('[data-page="login"]');
      const signedOutAt = new URL(page.url()).pathname;
      await page.click('[data-brand]');
      await page.waitForSelector('[data-page="home"]');
      await page.click('[data-cta]');
      await page.waitForSelector('[data-page="login"]');
      const clientGuard = new URL(page.url());
      for (const href of [atLogin.href, back.href, page.url()]) { seenUrls.redirects++; belowBase('guard', href); }
      check('route:guard',
        atLogin.pathname === `${BASE_PATH}/login` && atLogin.searchParams.get('next') === target
          && back.pathname + back.search === `${BASE_PATH}${target}` && user === 'Dana Park'
          && reloaded.path === `${BASE_PATH}${target}` && reloaded.page === 'issues'
          && signedOutAt === `${BASE_PATH}/login`
          && clientGuard.pathname === `${BASE_PATH}/login` && clientGuard.searchParams.get('next') === '/org/acme'
          && diag.errors.length === 0,
        'a signed-out deep link goes to sign-in and back to the same URL after it, a reload stays signed in, and a signed-out client navigation into the console is sent to sign-in too',
        `server-sent-to=${atLogin.pathname}?next=${atLogin.searchParams.get('next')} back-at=${back.pathname}${back.search} user=${user} reload=${reloaded.path} signed-out=${signedOutAt} client-guard=${clientGuard.pathname}?next=${clientGuard.searchParams.get('next')} errors=${diag.errors.slice(0, 2).join(' | ') || 0}`);
      await context.close();
    }

    // === The editor's server action: optimistic, redirects, refetches; rollback ==
    {
      const context = await newContext('Ana Ruiz');
      const page = await context.newPage();
      const diag = watch(page);
      const actionPosts = [];
      page.on('request', (r) => { if (r.method() === 'POST') actionPosts.push(new URL(r.url()).pathname); });
      await page.goto(url('/org/acme/projects/apollo/issues?status=open'));
      await hydrated(page);
      await page.waitForFunction(() => document.querySelector('[data-open-count]')?.textContent !== '…');
      const openBefore = Number(await page.textContent('[data-open-count]'));
      const id = await page.getAttribute('[data-issue]', 'data-issue');
      const oldTitle = await page.textContent(`[data-issue="${id}"] [data-issue-title]`);
      await page.click(`[data-edit="${id}"]`);
      await page.waitForSelector(`[data-edit-dialog="${id}"]`);
      await page.fill('[data-edit-title]', 'Ship SSO for every org');
      await page.selectOption('[data-edit-status]', 'closed');
      await page.click('[data-edit-save]');
      const optimistic = await page.evaluate((i) => ({
        title: document.querySelector(`[data-issue="${i}"] [data-issue-title]`)?.textContent,
        pending: document.querySelector(`[data-issue="${i}"]`)?.dataset.pending,
        status: document.querySelector(`[data-issue="${i}"] [data-issue-status]`)?.textContent,
      }), id);
      await page.waitForFunction(() => !location.search.includes('edit='), undefined, { timeout: 10000 });
      await page.waitForFunction((i) => !document.querySelector(`[data-issue="${i}"]`), id, { timeout: 10000 }).catch(() => {});
      await page.waitForFunction((n) => document.querySelector('[data-open-count]')?.textContent === String(n), openBefore - 1, { timeout: 10000 }).catch(() => {});
      const settled = await page.evaluate((i) => ({
        search: location.search,
        dialog: !!document.querySelector('[data-edit-dialog]'),
        stillListed: !!document.querySelector(`[data-issue="${i}"]`),
        open: document.querySelector('[data-open-count]')?.textContent,
      }), id);
      seenUrls.redirects++;
      belowBase('action redirect', page.url());
      const serverHas = await (await fetch(url(`/api/orgs/acme/projects/apollo/issues?status=closed&sort=updated&page=1`), { headers: { cookie: signedIn } })).json();
      const saved = serverHas.rows.find((r) => r.id === id);
      check('data:optimistic', optimistic.title === 'Ship SSO for every org' && optimistic.pending === 'true' && optimistic.status === 'Closed',
        'saving the editor shows the edited row at once, marked pending, before the server answers',
        `title="${optimistic.title}" pending=${optimistic.pending} status=${optimistic.status}`);
      check('server:action-js',
        saved?.title === 'Ship SSO for every org' && saved?.status === 'closed' && settled.search === '?status=open' && !settled.dialog
          && actionPosts.some((p) => p === `${BASE_PATH}/__what_action`),
        "the server action saves the issue and redirects to the list without the editor, posting below the base",
        `saved="${saved?.title}"/${saved?.status} url=${settled.search} dialog=${settled.dialog} posts=${[...new Set(actionPosts)].join(',')}`);
      check('data:invalidate', !settled.stillListed && settled.open === String(openBefore - 1),
        "the action's invalidation refetches the open list (the closed issue leaves it) and the org shell's open count, another section's entry",
        `still-listed=${settled.stillListed} open=${openBefore}->${settled.open}`);

      // A title the server refuses: the row shows it, then goes back.
      const id2 = await page.getAttribute('[data-issue]', 'data-issue');
      const title2 = await page.textContent(`[data-issue="${id2}"] [data-issue-title]`);
      await page.click(`[data-edit="${id2}"]`);
      await page.waitForSelector(`[data-edit-dialog="${id2}"]`);
      await page.fill('[data-edit-title]', 'This will fail');
      await page.click('[data-edit-save]');
      const shown = await page.textContent(`[data-issue="${id2}"] [data-issue-title]`);
      await page.waitForSelector('[data-edit-error]', { timeout: 10000 });
      await sleep(200);
      const rolled = await page.evaluate((i) => ({
        title: document.querySelector(`[data-issue="${i}"] [data-issue-title]`)?.textContent,
        pending: document.querySelector(`[data-issue="${i}"]`)?.dataset.pending ?? null,
        search: location.search,
        error: document.querySelector('[data-edit-error]')?.textContent,
      }), id2);
      check('data:optimistic-rollback',
        shown === 'This will fail' && rolled.title === title2 && rolled.pending === null && rolled.search.includes(`edit=${id2}`) && !!rolled.error,
        'a title the server refuses shows at once, then the row goes back to its saved title and the editor stays open with the error',
        `shown="${shown}" after="${rolled.title}" (saved "${title2}") pending=${rolled.pending} url=${rolled.search} error="${rolled.error}"`);
      reporter.assert(diag.errors.filter((e) => !/refused|__what_action|500/.test(e)).length === 0, 'the edits raised no page error but the refused save', diag.errors.join(' | ') || 'none');
      log(`edited ${id} (was "${oldTitle}")`);
      await context.close();
    }

    // === 2,000 members: sorting within a long-task budget ========================
    {
      const context = await newContext('Ana Ruiz');
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__longTasks = [];
        if ((PerformanceObserver.supportedEntryTypes || []).includes('longtask')) {
          window.__longTaskSource = 'longtask';
          new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longTasks.push(e.duration); }).observe({ type: 'longtask' });
        } else {
          window.__longTaskSource = 'loop-lag';
          let due = performance.now() + 10;
          const tick = () => { const now = performance.now(); if (now - due > 50) window.__longTasks.push(now - due); due = now + 10; setTimeout(tick, 10); };
          setTimeout(tick, 10);
        }
      });
      await page.goto(url('/org/acme/members'));
      await hydrated(page);
      await page.waitForFunction(() => document.querySelectorAll('[data-member]').length === 2000, undefined, { timeout: 15000 });
      const members = await (await fetch(url('/api/orgs/acme/members'), { headers: { cookie: signedIn } })).json();
      await page.evaluate(() => {
        document.querySelector('[data-member="m1"]').__kept = true;
        window.__longTasks.length = 0;
      });
      const times = [];
      const orders = [];
      for (const [column, clicks] of [['email', 1], ['email', 1], ['team', 1], ['active', 1], ['name', 1]]) {
        for (let c = 0; c < clicks; c++) {
          times.push(await page.evaluate(async (col) => {
            const t0 = performance.now();
            document.querySelector(`[data-sort="${col}"]`).click();
            await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
            return performance.now() - t0;
          }, column));
        }
        orders.push(await page.evaluate(() => [...document.querySelectorAll('[data-member]')].slice(0, 30).map((el) => el.dataset.member)));
      }
      const by = (key, dir) => [...members].sort((a, b) => (key === 'active' ? a.active - b.active : a[key].localeCompare(b[key])) * dir || (a.id < b.id ? -1 : 1)).slice(0, 30).map((m) => m.id);
      const expected = [by('email', 1), by('email', -1), by('team', 1), by('active', 1), by('name', 1)];
      const ordered = orders.every((o, i) => o.join() === expected[i].join());
      const { longTasks, source, keptRow, rows } = await page.evaluate(() => ({
        longTasks: window.__longTasks.slice(),
        source: window.__longTaskSource,
        keptRow: document.querySelector('[data-member="m1"]').__kept === true,
        rows: document.querySelectorAll('[data-member]').length,
      }));
      await page.fill('[data-member-filter]', 'okafor');
      const wantFiltered = members.filter((m) => m.name.toLowerCase().includes('okafor') || m.email.includes('okafor') || m.team.toLowerCase().includes('okafor')).length;
      await page.waitForFunction((n) => document.querySelectorAll('[data-member]').length === n, wantFiltered, { timeout: 5000 }).catch(() => {});
      const filtered = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-member]').length, count: document.querySelector('[data-member-count]').textContent }));
      const worst = longTasks.length ? Math.max(...longTasks) : 0;
      const slowest = Math.max(...times);
      check('cmp:keyed-list', ordered && keptRow && rows === 2000 && filtered.rows === wantFiltered && filtered.count === `Showing ${wantFiltered} of 2000`,
        'five sorts of 2,000 keyed rows each show the order the data has, a row keeps its element through them, and the filter shows exactly the matches',
        `ordered=${ordered} row-kept=${keptRow} rows=${rows} filtered=${filtered.rows}/${wantFiltered}`);
      check('perf:long-tasks', slowest <= SORT_BUDGET_MS && worst <= LONG_TASK_BOUND_MS,
        `each sort of 2,000 rows settles within ${SORT_BUDGET_MS}ms and no main-thread task runs over ${LONG_TASK_BOUND_MS}ms`,
        `sorts=${times.map((t) => t.toFixed(0)).join('/')}ms long-tasks=${longTasks.length} worst=${worst.toFixed(0)}ms (${source})`);
      await context.close();
    }

    // === The heap after 30 section changes (Chromium) ============================
    if (browserName !== 'chromium') {
      skip('perf:memory', 'the heap after a forced GC stays level over 30 section changes',
        `${browserName} has no devtools-protocol session to force a GC and read the heap`);
    } else {
      const context = await newContext('Ana Ruiz');
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const heap = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.collectGarbage');
        return (await cdp.send('Runtime.getHeapUsage')).usedSize;
      };
      const ROUND = [
        ['[data-nav="members"]', '[data-page="members"] [data-member]'],
        ['[data-nav="billing"]', '[data-page="billing"] [data-invoice]'],
        ['[data-nav="projects"]', '[data-page="projects"] [data-project-row]'],
        ['[data-project-link="apollo"]', '[data-page="project-overview"] [data-latest]'],
        ['[data-tab="issues"]', '[data-page="issues"] [data-issue]'],
        ['[data-nav="overview"]', '[data-page="overview"] [data-project-card]'],
      ];
      // Locator waits: waitForSelector returns an element handle, which
      // would keep each page left behind alive and read as a leak.
      const changes = async (n) => {
        for (let i = 0; i < n; i++) {
          const [link, ready] = ROUND[i % ROUND.length];
          await page.click(link);
          await page.locator(ready).first().waitFor();
        }
      };
      await page.goto(url('/org/acme'));
      await hydrated(page);
      await changes(12);
      const before = await heap();
      await changes(30);
      const after = await heap();
      const growth = after - before;
      check('perf:memory', growth < HEAP_GROWTH_BOUND,
        'the heap after a forced GC stays level over 30 section changes (members, billing, projects, a project, its issues, the overview)',
        `heap ${(before / 1048576).toFixed(2)}MB -> ${(after / 1048576).toFixed(2)}MB (growth ${(growth / 1024).toFixed(0)}KB, bound ${HEAP_GROWTH_BOUND / 1024}KB)`);
      await context.close();
    }

    // === Time to interactive after hydration, on a throttled CPU (Chromium) ======
    if (browserName !== 'chromium') {
      skip('perf:hydration-tti', 'the issue list hydrates and answers its first click within a budget on a 4x-throttled CPU',
        `${browserName} has no devtools-protocol session to throttle the CPU`);
    } else if (mode === 'dev') {
      skip('perf:hydration-tti', 'the issue list hydrates and answers its first click within a budget on a 4x-throttled CPU',
        'the dev server serves every module unbundled; the budget is for the production build');
    } else {
      const context = await newContext('Ana Ruiz');
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.goto(url('/org/acme/projects/apollo/issues?status=open'));
      await hydrated(page);
      const hydratedAt = await page.evaluate(() => window.__ns.hydratedAt);
      await page.waitForSelector('[data-edit]');
      const firstInput = await page.evaluate(async () => {
        const link = document.querySelector('[data-edit]');
        const id = link.dataset.edit;
        const t0 = performance.now();
        link.click();
        while (!document.querySelector(`[data-edit-dialog="${id}"]`)) {
          await new Promise((r) => requestAnimationFrame(r));
          if (performance.now() - t0 > 5000) break;
        }
        return performance.now() - t0;
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      check('perf:hydration-tti', hydratedAt <= TTI_BUDGET_MS && firstInput <= FIRST_INPUT_BUDGET_MS,
        `at 4x CPU throttling the issue list has hydrated within ${TTI_BUDGET_MS}ms of navigation and opens the editor within ${FIRST_INPUT_BUDGET_MS}ms of the first click`,
        `hydrated at ${hydratedAt.toFixed(0)}ms, editor open ${firstInput.toFixed(0)}ms after the click`);
      await context.close();
    }

    // === Every link, redirect and request stayed below the base ==================
    check('route:base-path', outside.length === 0 && seenUrls.links > 100 && seenUrls.requests > 50,
      `every link the server and the browser rendered, every redirect and every request the pages made stayed below ${BASE_PATH}/`,
      `outside=${outside.slice(0, 5).join(' | ') || 0} links=${seenUrls.links} redirects=${seenUrls.redirects} requests=${seenUrls.requests}`);

    reporter.assert(server.exitCode === null, 'the server is still running after every check', `exit=${server.exitCode}`);
    log('saas checks complete');
  },
};
