// Workspace, server-rendered: smoke contract.
//
// The client-only `workspace` app proves the router's nested layouts, guard
// and wizard in a page that builds itself. This one renders the same screens
// on the server and hydrates them, which is where they meet the parts of the
// router a single-page app never runs: a middleware redirect that has to be a
// real 3xx, a layout chain the client must adopt instead of building, route
// state that belongs to one request while others render beside it, and a
// reload in the middle of the wizard, rendered from the visitor's cookies.

import { startProcess, waitForHttp } from '../../harness/index.mjs';

const cookieValue = (value) => encodeURIComponent(JSON.stringify(value));
const cookieHeader = (user, draft) => [
  user ? `atlas-user=${cookieValue(user)}` : null,
  draft ? `atlas-draft=${cookieValue(draft)}` : null,
].filter(Boolean).join('; ');

const DRAFT = { name: 'Orchard', owner: 'Bo Lindqvist', kind: 'research', members: ['kim@atlas.dev'] };

export default {
  description: 'Workspace, server-rendered and hydrated: server-side guard redirects, a nested layout that hydrates onto the server DOM, a wizard reload rendered from cookies, concurrent visitors.',

  // WHAT_SMOKE_MODE=dev runs `npm run dev` (server.js --dev): the pages
  // rendered from the source through Vite's dev server (smoke/README.md).
  dev: true,

  covers: [
    'render:server',
    'render:hydration',
    'render:no-hydration-mismatch',
    'route:guard',
    'route:nested-layout',
    'route:params',
    'form:wizard',
    'server:request-isolation',
    'route:server-redirect',
    'route:layout-hydrates',
  ],

  async check({ workDir, appPort, mode, browser, check, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;
    if (mode !== 'dev') {
      const buildLog = run('npm', ['run', 'build'], { cwd: workDir });
      reporter.assert(/built in/.test(buildLog) && (buildLog.match(/built in/g) || []).length === 2,
        'vite built the client and the server bundles', buildLog.trim().split('\n').pop());
    }

    const server = startProcess('node', ['server.js', ...(mode === 'dev' ? ['--dev'] : [])], { cwd: workDir, env: { ...process.env, PORT: String(appPort) } });
    await waitForHttp(`${base}/signin`, { child: server });

    const get = (path, cookie) => fetch(`${base}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });

    // === The guards, on the server ==============================================
    {
      const anon = await get('/new/team');
      const noDetails = await get('/new/review', cookieHeader({ name: 'Ana' }, { name: '', owner: '', members: [] }));
      const noTeam = await get('/new/review', cookieHeader({ name: 'Ana' }, { ...DRAFT, members: [] }));
      const admitted = await get('/new/review', cookieHeader({ name: 'Ana' }, DRAFT));
      const statuses = [anon, noDetails, noTeam, admitted].map((r) => r.status);
      check('route:server-redirect',
        [302, 303, 307].includes(anon.status) && anon.headers.get('location') === `/signin?next=${encodeURIComponent('/new/team')}`
          && noDetails.headers.get('location') === '/new/details'
          && noTeam.headers.get('location') === '/new/team'
          && admitted.status === 200,
        'a middleware redirect is a real 3xx with its Location on the server: signed out, details missing, team missing',
        `statuses=${statuses.join(',')} locations=${[anon, noDetails, noTeam].map((r) => r.headers.get('location')).join(' ')}`);
      await admitted.text();
    }

    // === A deep link to a nested route, rendered on the server =================
    const deep = await (await get('/new/team', cookieHeader({ name: 'Ana Ruiz' }, DRAFT))).text();
    const nested = /data-shell[\s\S]*data-outlet[\s\S]*data-wizard[\s\S]*data-form="team"/.test(deep);
    check('render:server',
      nested && deep.includes('data-member="kim@atlas.dev"') && /data-user="true"><!--\$-->Ana Ruiz<!--\/\$--></.test(deep)
        && /data-step="team"[^>]*aria-current="step"|aria-current="step"[^>]*data-step="team"/.test(deep),
      'a deep link to /new/team renders shell > wizard layout > team step on the server, with the draft from the cookie',
      `nested=${nested} member=${deep.includes('data-member="kim@atlas.dev"')} user=${/data-user="true"><!--\$-->Ana Ruiz<!--\/\$--></.test(deep)}`);

    // === Hydration adopts the layout chain, and the layout stays ===============
    const context = await browser.newContext();
    await context.addCookies([
      { name: 'atlas-user', value: cookieValue({ name: 'Ana Ruiz' }), url: base },
      { name: 'atlas-draft', value: cookieValue(DRAFT), url: base },
    ]);
    const page = await context.newPage();
    const diag = { errors: [], warnings: [] };
    page.on('pageerror', (e) => diag.errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') diag.errors.push(m.text()); if (m.type() === 'warning') diag.warnings.push(m.text()); });
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route(mode === 'dev' ? '**/src/entry-client.jsx' : '**/assets/entry-client-*.js', async (route) => { await gate; await route.continue(); });
    try {
      await page.goto(`${base}/new/team`, { waitUntil: 'commit' });
      await page.waitForSelector('[data-wizard]');
      // Mark the server's nodes before any script runs.
      await page.evaluate(() => {
        document.querySelector('[data-shell]').__fromServer = true;
        document.querySelector('[data-wizard]').__fromServer = true;
        document.querySelector('[data-form="team"]').__fromServer = true;
      });
      release();
      await page.waitForFunction(() => window.__atlas?.hydrated === true, undefined, { timeout: 10000 });
      const probe = await page.evaluate(() => window.__atlas);
      const kept = await page.evaluate(() => ['[data-shell]', '[data-wizard]', '[data-form="team"]']
        .map((s) => document.querySelector(s)?.__fromServer === true));

      await page.click('[data-tips-toggle]');
      const tipsHidden = await page.locator('[data-tips]').count() === 0;
      check('render:hydration', tipsHidden && diag.errors.length === 0,
        'the server-rendered wizard hydrates and its layout answers a click',
        `tips-toggled=${tipsHidden} errors=${diag.errors.slice(0, 2).join(' | ') || 0}`);
      check('render:no-hydration-mismatch',
        probe.mismatches.length === 0 && probe.added === 0 && !diag.warnings.some((w) => /mismatch|ERR_HYDRATION/i.test(w)),
        'the shell, the wizard layout and the step hydrate with no mismatch and no node added',
        `mismatches=${JSON.stringify(probe.mismatches)} added=${probe.added}`);
      check('route:layout-hydrates', kept.every(Boolean),
        'hydration keeps the server DOM of the shell, the wizard layout and the step',
        `shell=${kept[0]} layout=${kept[1]} step=${kept[2]}`);

      // Client navigation between steps keeps the hydrated layout and its state.
      await page.click('[data-back]');
      await page.waitForSelector('[data-form="details"]');
      const afterBack = await page.evaluate(() => ({
        layout: document.querySelector('[data-wizard]').__fromServer === true,
        shell: document.querySelector('[data-shell]').__fromServer === true,
        tips: document.querySelectorAll('[data-tips]').length,
        name: document.querySelector('[data-field="name"]').value,
        current: document.querySelector('[aria-current="step"]')?.dataset.step,
      }));
      check('route:nested-layout',
        afterBack.layout && afterBack.shell && afterBack.tips === 0 && afterBack.name === DRAFT.name && afterBack.current === 'details',
        'moving from the hydrated team step to details keeps the server-built layout, with its state',
        `layout-same-node=${afterBack.layout} shell-same-node=${afterBack.shell} tips-hidden=${afterBack.tips === 0} name=${afterBack.name} step=${afterBack.current}`);

      // === A reload mid-wizard, rendered by the server from the cookie =========
      await page.click('[data-next]');
      await page.waitForSelector('[data-form="team"]');
      await page.fill('[data-field="email"]', 'lee@atlas.dev');
      await page.click('[data-add-member]');
      await page.waitForSelector('[data-member="lee@atlas.dev"]');
      const cookies = (await context.cookies(base)).map((c) => `${c.name}=${c.value}`).join('; ');
      const serverHtml = await (await get('/new/team', cookies)).text();
      await page.reload();
      await page.waitForFunction(() => window.__atlas?.hydrated === true, undefined, { timeout: 10000 });
      const reloaded = await page.evaluate(() => ({
        members: [...document.querySelectorAll('[data-member]')].map((el) => el.dataset.member),
        mismatches: window.__atlas.mismatches.length,
        added: window.__atlas.added,
        path: location.pathname,
      }));
      await page.click('[data-next]');
      await page.waitForSelector('[data-form="review"]');
      const review = await page.textContent('[data-review="members"]');
      check('form:wizard',
        serverHtml.includes('data-member="lee@atlas.dev"') && reloaded.path === '/new/team'
          && JSON.stringify(reloaded.members) === JSON.stringify(['kim@atlas.dev', 'lee@atlas.dev'])
          && reloaded.mismatches === 0 && reloaded.added === 0 && review === 'kim@atlas.dev, lee@atlas.dev',
        'a reload mid-wizard is rendered by the server with the answers, hydrates cleanly, and the review shows them',
        `server-has-new-member=${serverHtml.includes('data-member="lee@atlas.dev"')} members=${reloaded.members.join(',')} mismatches=${reloaded.mismatches} added=${reloaded.added} review="${review}"`);

      // Create the project; its detail page is a deep link the server renders.
      await page.click('[data-create]');
      await page.waitForSelector('[data-detail] [data-project-name]');
      const createdPath = new URL(page.url()).pathname;
      // Without the hydration markers: the text as the visitor reads it.
      const detailHtml = (await (await get(createdPath, cookies)).text()).replace(/<!--[^>]*-->/g, '');
      check('route:params',
        /^\/projects\/\d+$/.test(createdPath) && detailHtml.includes(`>${DRAFT.name}</h1>`) && detailHtml.includes('kim@atlas.dev, lee@atlas.dev'),
        'the created project is a deep link the server renders by its :id',
        `path=${createdPath} server-has-name=${detailHtml.includes(`>${DRAFT.name}</h1>`)}`);
    } finally {
      await context.close();
    }

    // === Sign-in through the guard, then a reload is signed in on the server ====
    {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      try {
        await p.goto(`${base}/projects/3`);
        const atSignIn = new URL(p.url());
        await p.waitForFunction(() => window.__atlas?.hydrated === true, undefined, { timeout: 10000 });
        await p.fill('[data-signin-name]', 'Dana Park');
        await p.click('[data-signin-submit]');
        await p.waitForSelector('[data-detail="3"] [data-project-name]');
        const name = await p.textContent('[data-project-name]');
        await p.reload();
        await p.waitForFunction(() => window.__atlas?.hydrated === true, undefined, { timeout: 10000 });
        const afterReload = await p.evaluate(() => ({ path: location.pathname, user: document.querySelector('[data-user]')?.textContent, name: document.querySelector('[data-project-name]')?.textContent }));
        check('route:guard',
          atSignIn.pathname === '/signin' && atSignIn.searchParams.get('next') === '/projects/3' && name === 'Project Cinder'
            && afterReload.path === '/projects/3' && afterReload.user === 'Dana Park' && afterReload.name === 'Project Cinder',
          'a signed-out deep link is redirected by the server to sign-in, comes back, and a reload stays signed in',
          `redirected-to=${atSignIn.pathname}${atSignIn.search} detail="${name}" after-reload=${afterReload.path} user=${afterReload.user}`);
      } finally {
        await ctx.close();
      }
    }

    // === Concurrent visitors, each with their own cookies ========================
    {
      const visitors = Array.from({ length: 40 }, (_, i) => ({
        user: { name: `Visitor ${i}` },
        draft: { name: `Plan ${i}`, owner: 'Chidi Obi', kind: 'launch', members: [`v${i}@atlas.dev`] },
        path: i % 2 ? '/new/team' : '/new/review',
      }));
      const results = await Promise.all(visitors.map(async (v) => {
        const res = await get(v.path, cookieHeader(v.user, v.draft));
        return { v, status: res.status, html: await res.text() };
      }));
      const wrong = results.filter(({ v, status, html }) => {
        const users = [...html.matchAll(/data-user="true"><!--\$-->([^<]*)<!--\/\$--></g)].map((m) => m[1]);
        const members = [...html.matchAll(/v(\d+)@atlas\.dev/g)].map((m) => m[1]);
        return status !== 200 || users.length !== 1 || users[0] !== v.user.name
          || members.length === 0 || members.some((n) => `v${n}@atlas.dev` !== v.draft.members[0])
          || !html.includes(v.path === '/new/team' ? 'data-form="team"' : 'data-form="review"');
      }).map((r) => r.v.user.name);
      check('server:request-isolation', wrong.length === 0,
        '40 concurrent visitors, each with their own cookies, each get their own user, draft and step',
        `wrong=${wrong.join(',') || 0}`);
    }

    reporter.assert(server.exitCode === null, 'the server is still running after every check', `exit=${server.exitCode}`);
    log('workspace-ssr checks complete');
  },
};
