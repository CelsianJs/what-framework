// One-off generator for the v0.10 full-stack docs. Emits learn/{data-loading,
// actions,caching-isr,deployment}.html from a shared shell so they match the
// existing learn pages, and inserts a "Full-Stack" sidebar section into every
// learn page. Idempotent: re-running overwrites the 4 pages and skips sidebar
// inserts that already happened.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const learnDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'learn');

const FULLSTACK_SIDEBAR = `      <div class="sidebar-section">
        <div class="sidebar-title">Full-Stack</div>
        <ul class="sidebar-links">
          <li><a href="./data-loading.html">Data Loading</a></li>
          <li><a href="./actions.html">Server Actions</a></li>
          <li><a href="./caching-isr.html">Caching &amp; ISR</a></li>
          <li><a href="./deployment.html">Deployment</a></li>
        </ul>
      </div>
`;

function sidebar(active) {
  // Mirrors the existing learn sidebar, plus the Full-Stack section. `active`
  // is the current page's filename so its link gets the active class.
  const link = (href, label) =>
    `          <li><a href="./${href}"${href === active ? ' class="active"' : ''}>${label}</a></li>`;
  return `    <aside class="sidebar">
      <div class="sidebar-section">
        <div class="sidebar-title">Get Started</div>
        <ul class="sidebar-links">
${link('', 'Quick Start')}
${link('coming-from-react.html', 'Coming from React')}
${link('signals.html', 'Signals')}
${link('components.html', 'Components')}
        </ul>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Core Concepts</div>
        <ul class="sidebar-links">
${link('effects.html', 'Effects')}
${link('control-flow.html', 'Control Flow')}
${link('lifecycle.html', 'Lifecycle')}
${link('context.html', 'Context')}
        </ul>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Data &amp; State</div>
        <ul class="sidebar-links">
${link('data-fetching.html', 'Data Fetching')}
${link('forms.html', 'Forms')}
${link('stores.html', 'Stores')}
        </ul>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Navigation &amp; Caching</div>
        <ul class="sidebar-links">
${link('routing.html', 'Routing')}
${link('caching.html', 'Caching')}
        </ul>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Full-Stack</div>
        <ul class="sidebar-links">
${link('data-loading.html', 'Data Loading')}
${link('actions.html', 'Server Actions')}
${link('caching-isr.html', 'Caching &amp; ISR')}
${link('deployment.html', 'Deployment')}
        </ul>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Advanced</div>
        <ul class="sidebar-links">
${link('islands.html', 'Islands')}
${link('ssr.html', 'Server Rendering')}
${link('animation.html', 'Animation')}
${link('accessibility.html', 'Accessibility')}
        </ul>
      </div>
    </aside>`;
}

function page({ file, title, subtitle, toc, body }) {
  const tocLinks = toc.map(([id, label]) => `            <li><a href="#${id}">${label}</a></li>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — What Framework</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../styles.css">
  <script src="../../theme.js"></script>
  <script src="../copy-code.js"></script>
</head>
<body>
  <nav>
    <div class="nav-left">
      <a href="../" class="logo">What <span class="logo-badge">v0.10</span></a>
      <div class="nav-links">
        <a href="./" class="active">Learn</a>
        <a href="../reference/">Reference</a>
        <a href="../tutorial/">Tutorial</a>
      </div>
    </div>
    <div class="nav-right">
      <button class="theme-toggle" aria-label="Toggle theme">
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
      </button>
    </div>
  </nav>

  <div class="layout">
${sidebar(file)}

    <main class="content">
      <div class="content-wrapper">
        <div class="content-inner">
          <h1>${title}</h1>
          <p class="subtitle">${subtitle}</p>
${body}
        </div>

        <aside class="toc">
          <div class="toc-title">On This Page</div>
          <ul class="toc-links">
${tocLinks}
          </ul>
        </aside>
      </div>
    </main>
  </div>

  <script>
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          document.querySelectorAll('.toc-links a').forEach(a => {
            a.classList.toggle('active', a.getAttribute('href') === '#' + entry.target.id);
          });
        }
      });
    }, { rootMargin: '-100px 0px -66%' });
    document.querySelectorAll('h2[id], h3[id]').forEach(el => observer.observe(el));
  </script>
</body>
</html>
`;
}

// Tiny code-block helper — escapes HTML so source renders literally.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const code = (s) => `<pre><code>${esc(s)}</code></pre>`;

// --- Page: Data Loading ---------------------------------------------------
const dataLoading = page({
  file: 'data-loading.html',
  title: 'Data Loading',
  subtitle: 'Co-locate a server loader with a page; its data is rendered on the server and hydrated on the client — no waterfalls, no client fetch on first paint.',
  toc: [
    ['loader', 'The loader export'],
    ['use-loader-data', 'useLoaderData'],
    ['static-paths', 'getStaticPaths'],
    ['vs-fetching', 'Loaders vs client fetching'],
  ],
  body: `
          <p>A <strong>loader</strong> runs on the server before a page renders. What awaits it, renders the page with the resolved data in scope, and serializes that data into the HTML so the client hydrates without re-fetching. This is the data path for SSR and ISR pages.</p>

          <h2 id="loader">The loader export</h2>
          <p>Export a function named <code>loader</code> from a page module. It receives <code>{ params, query, request }</code> and returns data (sync or async).</p>
${code(`// src/pages/blog/[slug].jsx
export const loader = async ({ params, query, request }) => {
  const post = await db.posts.find(params.slug);
  return { post };
};

export default function Post() {
  const { post } = useLoaderData();
  return <article><h1>{post.title}</h1><p>{post.body}</p></article>;
}`)}
          <ul>
            <li><code>params</code> — dynamic route segments (e.g. <code>{ slug: 'hello' }</code> for <code>/blog/[slug]</code>).</li>
            <li><code>query</code> — parsed query string as an object.</li>
            <li><code>request</code> — the standard <code>Request</code> (read cookies/headers for auth).</li>
          </ul>
          <div class="callout callout-note">
            <p class="callout-title">Runs before render</p>
            <p>The loader resolves <em>outside</em> the synchronous render, so the value handed to the component is plain data — never a promise. That keeps render fast and concurrency-safe.</p>
          </div>

          <h2 id="use-loader-data">useLoaderData</h2>
          <p><code>useLoaderData()</code> returns the current page's loader data. It is isomorphic: on the server it reads the render-scoped context; on the client it reads the hydration payload (<code>&lt;script id="__what_data"&gt;</code>). It is not a hook-slot consumer, so you can call it anywhere in a component.</p>
${code(`import { useLoaderData } from 'what-framework';

function Post() {
  const { post } = useLoaderData();
  // ...
}`)}

          <h2 id="static-paths">getStaticPaths</h2>
          <p>For dynamic routes that should be pre-rendered, export <code>getStaticPaths</code>. It returns the set of paths to build ahead of time plus a <code>fallback</code> policy for everything else.</p>
${code(`export async function getStaticPaths() {
  const posts = await db.posts.all();
  return {
    paths: posts.map((p) => ({ params: { slug: p.slug } })),
    fallback: 'blocking', // 'blocking' | true | false
  };
}`)}
          <ul>
            <li><code>'blocking'</code> — an unbuilt path renders on first request, then is cached (default-feeling, great for ISR).</li>
            <li><code>true</code> — serve a skeleton immediately, then swap in the rendered page.</li>
            <li><code>false</code> — anything not in <code>paths</code> is a 404.</li>
          </ul>
          <p>Because <code>getStaticPaths</code> is a function (it can't be JSON), it is a <strong>named export</strong>, never part of the <code>page</code> config object.</p>

          <h2 id="vs-fetching">Loaders vs client fetching</h2>
          <p>Use a <strong>loader</strong> for data the page needs to render on the server (SEO content, the primary record). Use the client <a href="./data-fetching.html">data-fetching hooks</a> (<code>useSWR</code>, <code>useQuery</code>) for data that loads after hydration (user-specific widgets, polling dashboards). They compose: a loader seeds the first paint, hooks keep it live.</p>
`,
});

// --- Page: Server Actions -------------------------------------------------
const actions = page({
  file: 'actions.html',
  title: 'Server Actions',
  subtitle: 'Write a mutation as a server function, call it from the client, and revalidate the cache it affects — all type-checked, CSRF-protected, and served at one endpoint.',
  toc: [
    ['define', 'Defining an action'],
    ['serve', 'Serving actions'],
    ['call', 'Calling from the client'],
    ['revalidate', 'Revalidating after a mutation'],
    ['security', 'CSRF & error masking'],
  ],
  body: `
          <h2 id="define">Defining an action</h2>
          <p>Wrap a server function with <code>action()</code>. Give it a stable <code>id</code> so the client can dispatch it, and optionally declare what to revalidate on success.</p>
${code(`// src/actions/posts.js
import { action, revalidatePath } from 'what-framework/server';
import { createPost } from '../db.js';

export const createPostAction = action(
  async ({ title, body }) => {
    const post = createPost({ title, body });
    return { ok: true, slug: post.slug };
  },
  { id: 'createPost', revalidate: ['/'], revalidateTags: ['posts'] }
);`)}

          <h2 id="serve">Serving actions</h2>
          <p>Actions are dispatched over <code>POST /__what_action</code>. The deploy adapters mount this for you; importing the action module (e.g. from your routes file) registers it. With a manual server you can mount it directly:</p>
${code(`import { createActionHandler } from 'what-framework/server';
const handler = createActionHandler({ getCsrfToken });`)}

          <h2 id="call">Calling from the client</h2>
          <p>A progressively-enhanced form works with no JavaScript — it POSTs to the endpoint with a <code>data-action</code> attribute:</p>
${code(`<form method="post" action="/__what_action" data-action="createPost">
  <input name="title" required />
  <textarea name="body" required></textarea>
  <button>Publish</button>
</form>`)}
          <p>Or call it imperatively and get the typed return value:</p>
${code(`const res = await fetch('/__what_action', {
  method: 'POST',
  headers: { 'x-what-action': 'createPost', 'content-type': 'application/json' },
  body: JSON.stringify({ args: [{ title, body }] }),
});
const { slug } = await res.json();`)}

          <h2 id="revalidate">Revalidating after a mutation</h2>
          <p>The <code>revalidate</code> / <code>revalidateTags</code> options fire automatically after the action resolves, purging the origin ISR cache (and any CDN) so the next request re-renders with fresh data. You can also call them by hand inside the action:</p>
${code(`import { revalidatePath, revalidateTag } from 'what-framework/server';

revalidatePath('/');          // purge one path
revalidateTag('posts');       // purge everything tagged 'posts'`)}
          <div class="callout callout-note">
            <p class="callout-title">Two revalidates, on purpose</p>
            <p>Server <code>revalidatePath</code>/<code>revalidateTag</code> (cache) are distinct from the client router's <code>invalidatePath</code> (in-memory nav pub-sub). Server purges the rendered cache; the client one re-runs a client loader. See <a href="./caching-isr.html">Caching &amp; ISR</a>.</p>
          </div>

          <h2 id="security">CSRF &amp; error masking</h2>
          <p>The handler validates a CSRF token by default (inject one via <code>getCsrfToken</code>; a meta tag is emitted into the document). It fails closed: a missing or bad token is rejected. Thrown errors are masked to a generic 500 so internal details never reach the client — the real error is logged server-side.</p>
`,
});

// --- Page: Caching & ISR (the flagship) -----------------------------------
const cachingIsr = page({
  file: 'caching-isr.html',
  title: 'Caching & ISR',
  subtitle: 'Origin-first incremental static regeneration: stale-while-revalidate, on-demand purge by path or tag, scheduled poll regeneration, and getStaticPaths fallbacks — on any host, no CDN required.',
  toc: [
    ['model', 'The model'],
    ['config', 'Per-page config'],
    ['swr', 'Stale-while-revalidate'],
    ['on-demand', 'On-demand revalidation'],
    ['poll', 'Poll regeneration'],
    ['webhook', 'Revalidation webhook'],
    ['headers', 'Cache headers'],
    ['degradation', 'No-CDN vs CDN'],
  ],
  body: `
          <h2 id="model">The model</h2>
          <p>What's caching is <strong>origin-first</strong>. A render cache lives next to your server and does the full job: it serves fresh hits instantly, serves stale content while regenerating in the background, dedupes concurrent regenerations, and purges on demand. A CDN is <em>optional upside</em> — when present, the engine emits the right <code>Cache-Control</code> headers and fans purges out to it. Nothing about your code changes whether or not you have one.</p>
${code(`import { createCacheEngine, createMemoryStore } from 'what-isr';

const cache = createCacheEngine({ store: createMemoryStore() });`)}
          <p>Swap the store without touching pages: <code>createMemoryStore()</code> (default, fast, single-process), <code>createFilesystemStore({ dir })</code> (survives restarts, multi-process), or <code>createRedisStore({ client })</code> (multi-instance).</p>

          <h2 id="config">Per-page config</h2>
          <p>A page declares its caching policy with the JSON-safe <code>page</code> export:</p>
${code(`export const page = {
  mode: 'static',     // 'static' | 'hybrid' | 'server'
  revalidate: 60,     // seconds until a cached entry goes stale
  swr: 600,           // extra seconds it may be served stale while regenerating
  tags: ['posts'],    // purge handles for revalidateTag
  vary: ['cookie:theme'],   // split cache by these request signals
  fallback: 'blocking',     // for dynamic routes (see Data Loading)
  pollInterval: 300,        // background regeneration, seconds (optional)
};`)}
          <ul>
            <li><code>mode: 'static'</code> — cacheable, regenerated by ISR.</li>
            <li><code>mode: 'server'</code> — always rendered fresh, never cached (<code>private, no-store</code>). Use for per-user pages.</li>
            <li><code>mode: 'hybrid'</code> — static shell with dynamic islands.</li>
          </ul>

          <h2 id="swr">Stale-while-revalidate</h2>
          <p>After <code>revalidate</code> seconds an entry is <strong>stale</strong> but still served instantly; the engine kicks off one background re-render and swaps the entry in when it's done. Readers never wait. If <code>swr</code> is set, stale-if-error keeps serving the last good copy when regeneration fails.</p>
          <div class="callout callout-note">
            <p class="callout-title">One render for N concurrent misses</p>
            <p>When a thousand requests hit a stale entry at once, an in-flight lock (a per-key promise, or a Redis <code>SET NX</code> across instances) ensures exactly one regeneration runs — the rest are served the stale copy. No thundering herd.</p>
          </div>

          <h2 id="on-demand">On-demand revalidation</h2>
          <p>Purge precisely when your data changes — from an action, a route, or anywhere on the server:</p>
${code(`import { revalidatePath, revalidateTag } from 'what-framework/server';

revalidatePath('/blog/hello');   // one path
revalidateTag('posts');          // every entry tagged 'posts'`)}
          <p>This is <strong>progressive regeneration</strong>: the purged entry re-renders on its next request (or immediately, with <code>{ regenerate: true }</code>). Pages stay cached until the moment their data actually changes.</p>

          <h2 id="poll">Poll regeneration</h2>
          <p>For data that drifts without an explicit trigger (an external feed, prices), set <code>pollInterval</code> or register a route with the scheduler. It re-renders on a timer with jitter (anti-herd), a global concurrency cap, and it joins the same in-flight lock so a tick during a live regeneration is a no-op.</p>
${code(`import { createScheduler } from 'what-isr';

const scheduler = createScheduler(cache);
scheduler.register(
  { path: '/', query: {}, config: routes[0].page },
  { intervalMs: 5 * 60 * 1000 }   // keep the home page warm every 5 min
);
// scheduler.start() / stop() — the Node adapter wires SIGTERM cleanup.`)}

          <h2 id="webhook">Revalidation webhook</h2>
          <p>Let a CMS trigger purges over HTTP. Mount <code>createRevalidateWebhook</code> (the adapters expose it at <code>POST /__what_revalidate</code>) with a secret:</p>
${code(`import { createRevalidateWebhook } from 'what-isr';
const webhook = createRevalidateWebhook(cache, { secret: process.env.WHAT_REVALIDATE_SECRET });

// POST /__what_revalidate
// { "tags": ["posts"], "paths": ["/"], "secret": "…", "regenerate": true }`)}
          <p>The secret is checked in constant time.</p>

          <h2 id="headers">Cache headers</h2>
          <p>When a CDN is in front, the engine emits standard headers so the edge caches and revalidates in lockstep with the origin:</p>
${code(`Cache-Control: public, s-maxage=60, stale-while-revalidate=600
Cache-Tag: posts            // Fastly / generic
Surrogate-Key: posts        // (alias)
X-What-Cache: HIT | STALE | MISS`)}
          <p>Server-mode and action responses send <code>private, no-store</code>. Skeleton (fallback <code>true</code>) responses send <code>s-maxage=0</code> so the edge doesn't pin a placeholder.</p>

          <h2 id="degradation">No-CDN vs CDN — graceful degradation</h2>
          <p>Every capability works at the origin. A CDN only changes <em>where</em> the cache also lives.</p>
          <table>
            <thead><tr><th>Capability</th><th>Origin only (no CDN)</th><th>With a CDN</th></tr></thead>
            <tbody>
              <tr><td>Fresh / stale serving (SWR)</td><td>✓ origin store</td><td>✓ origin + edge</td></tr>
              <tr><td>In-flight dedupe</td><td>✓ per-process / Redis</td><td>✓ same</td></tr>
              <tr><td>revalidatePath / revalidateTag</td><td>✓ purges origin store</td><td>✓ purges origin <em>and</em> edge (<code>CDNAdapter.purge</code>)</td></tr>
              <tr><td>Poll regeneration</td><td>✓ scheduler in the server process</td><td>✓ same (origin re-render → edge revalidate)</td></tr>
              <tr><td>getStaticPaths fallback</td><td>✓ render-on-first-hit</td><td>✓ same, then edge-cached</td></tr>
              <tr><td>Edge latency</td><td>origin round-trip</td><td>✓ served from nearest PoP</td></tr>
            </tbody>
          </table>
          <p>Provide a CDN with <code>createCacheEngine({ store, cdn })</code> — adapters ship for <code>cloudflare</code>, <code>fastly</code>, and <code>vercel</code>. Omit it and every line above still holds, minus edge latency. That is the whole promise: <strong>no host lock-in</strong>.</p>
`,
});

// --- Page: Deployment -----------------------------------------------------
const deployment = page({
  file: 'deployment.html',
  title: 'Deployment',
  subtitle: 'One Web-Fetch handler powers Node, static export, Vercel, and Cloudflare. Pick an adapter in what.config.js; the ISR engine and actions come along for free.',
  toc: [
    ['adapters', 'Adapter matrix'],
    ['node', 'Node'],
    ['static', 'Static export'],
    ['vercel', 'Vercel'],
    ['cloudflare', 'Cloudflare'],
    ['env', 'Environment'],
  ],
  body: `
          <p>All adapters are thin shells over one framework-agnostic core: <code>(request) =&gt; Response</code>. Match a route, intercept <code>/__what_action</code> and <code>/__what_revalidate</code>, consult the ISR engine, render, and emit cache headers. Choosing a target is a config line, not a rewrite.</p>

          <h2 id="adapters">Adapter matrix</h2>
          <table>
            <thead><tr><th>Adapter</th><th>Best for</th><th>ISR mechanism</th><th>Poll scheduler</th></tr></thead>
            <tbody>
              <tr><td><code>node</code></td><td>Long-running server, full control</td><td>origin store (memory/fs/redis)</td><td>✓ in-process</td></tr>
              <tr><td><code>static</code></td><td>Pure SSG to any static host</td><td>build-time pre-render</td><td>— (use external cron → webhook)</td></tr>
              <tr><td><code>vercel</code></td><td>Serverless + edge ISR</td><td>prerender + <code>expiration</code></td><td>— (Vercel Cron → webhook)</td></tr>
              <tr><td><code>cloudflare</code></td><td>Workers at the edge</td><td>Cache API / KV + <code>waitUntil</code></td><td>— (Cron Trigger → webhook)</td></tr>
            </tbody>
          </table>
          <div class="callout callout-note">
            <p class="callout-title">Serverless &amp; polling</p>
            <p>Serverless platforms have no always-on process, so the in-process poll scheduler doesn't run there. Use the platform's cron to hit <code>POST /__what_revalidate</code> on a schedule — same effect, platform-native.</p>
          </div>

          <h2 id="node">Node</h2>
${code(`import { createServer } from 'what-framework/server';
import { createCacheEngine, createMemoryStore } from 'what-isr';

const server = createServer({
  routes,
  cache: createCacheEngine({ store: createMemoryStore() }),
});
server.listen(3000);`)}
          <p>Run it with <code>what start</code> (or <code>node server.js</code>). SIGTERM stops the scheduler cleanly.</p>

          <h2 id="static">Static export</h2>
          <p>Render every static/hybrid route (expanding <code>getStaticPaths</code>) to <code>index.html</code> + a <code>__what_data.json</code> for client navigation:</p>
${code(`import { exportStatic } from 'what-framework/server';
await exportStatic({ routes, outDir: 'dist' });
// or: what build --static`)}

          <h2 id="vercel">Vercel</h2>
${code(`import { buildVercelOutput } from 'what-framework/server';
await buildVercelOutput({ routes }); // emits .vercel/output (Build Output API v3)`)}
          <p>Static routes become prerenders with an <code>expiration</code> equal to <code>revalidate</code>; dynamic routes become a render function.</p>

          <h2 id="cloudflare">Cloudflare</h2>
${code(`import { createCloudflareHandler } from 'what-framework/server';
export default { fetch: createCloudflareHandler({ routes, cache }) };`)}
          <p>ISR uses the Cache API (or KV) and <code>ctx.waitUntil</code> for background SWR.</p>

          <h2 id="env">Environment</h2>
          <ul>
            <li><code>WHAT_REVALIDATE_SECRET</code> — required to authorize the revalidation webhook.</li>
            <li><code>PORT</code> — Node server port (default 3000).</li>
          </ul>
          <p>See the <a href="https://github.com/zvndev/what-fw/tree/main/examples">blog and shop examples</a> for complete, tested setups.</p>
`,
});

// Write the four pages.
const pages = {
  'data-loading.html': dataLoading,
  'actions.html': actions,
  'caching-isr.html': cachingIsr,
  'deployment.html': deployment,
};
for (const [name, html] of Object.entries(pages)) {
  writeFileSync(join(learnDir, name), html);
  console.log('wrote', name);
}

// Insert the Full-Stack sidebar section into every OTHER learn page (the four
// new ones already have it). Anchor after the Advanced section's accessibility
// link. Idempotent.
const ANCHOR = `          <li><a href="./accessibility.html">Accessibility</a></li>
        </ul>
      </div>`;
for (const name of readdirSync(learnDir)) {
  if (!name.endsWith('.html') || pages[name]) continue;
  const p = join(learnDir, name);
  let html = readFileSync(p, 'utf8');
  if (html.includes('sidebar-title">Full-Stack')) continue; // already has it
  if (!html.includes(ANCHOR)) { console.log('SKIP (no anchor)', name); continue; }
  // Insert the Full-Stack section *before* the Advanced section. The Advanced
  // section opens just before its "Advanced" title; insert ahead of it.
  const advOpen = `      <div class="sidebar-section">\n        <div class="sidebar-title">Advanced</div>`;
  if (html.includes(advOpen)) {
    html = html.replace(advOpen, FULLSTACK_SIDEBAR + advOpen);
    writeFileSync(p, html);
    console.log('sidebar +', name);
  } else {
    console.log('SKIP (no Advanced)', name);
  }
}
