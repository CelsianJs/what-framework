// whatfw.com static build — rendered through What Framework (what-server's
// renderToString). Chrome (head/nav/sidebar) is authored as What; page content
// is preserved verbatim via dangerouslySetInnerHTML so visuals never drift.
// Output: dist/<clean-route>/index.html  (no .html in URLs).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'what-framework/server';
import { h } from 'what-framework';
import * as esbuild from 'esbuild';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');

// ---------------------------------------------------------------------------
// Version — read from the framework source of truth at BUILD time so the nav
// badge / footer can never drift from the released package again (audit #5).
// ---------------------------------------------------------------------------
function readVersion() {
  const candidates = [
    join(ROOT, '..', 'packages', 'what', 'package.json'), // monorepo source of truth
    join(ROOT, '..', 'package.json'),                     // repo root fallback
    join(ROOT, 'node_modules', 'what-framework', 'package.json'), // standalone fallback
  ];
  for (const p of candidates) {
    try {
      const { version } = JSON.parse(readFileSync(p, 'utf8'));
      if (version) return version;
    } catch { /* try next */ }
  }
  throw new Error('docs-site build: could not resolve what-framework version');
}
const VERSION = readVersion();

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------
const BADGE = `v${VERSION}`;

// Stamp any hardcoded version badge / footer version in preserved page content
// with the build-time version. Targeted (badge + footer only) so prose like
// "React Router v6" is never touched.
function stampVersion(html) {
  return html
    .replace(/(<span class="logo-badge">)v[^<]+(<\/span>)/g, `$1${BADGE}$2`)
    .replace(/(<div class="footer-meta">)v[^\s<&]+/g, `$1${BADGE}`);
}
const SEARCH_BOX = `<button class="search-placeholder" type="button" aria-label="Search docs">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Search docs...
        <span class="search-shortcut">/</span>
      </button>`;
const THEME_TOGGLE = `<button class="theme-toggle" aria-label="Toggle theme">
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
      </button>`;

const NAV_ITEMS = [
  ['learn', '/docs/learn', 'Learn'],
  ['reference', '/docs/reference', 'Reference'],
  ['tutorial', '/docs/tutorial', 'Tutorial'],
];

function navInner(activeSection) {
  const links = NAV_ITEMS.map(([key, href, label]) =>
    `        <a href="${href}"${key === activeSection ? ' class="active"' : ''}>${label}</a>`
  ).join('\n');
  return `
    <div class="nav-left">
      <a href="/docs" class="logo">What <span class="logo-badge">${BADGE}</span></a>
      <div class="nav-links">
${links}
      </div>
    </div>
    <div class="nav-right">
      ${SEARCH_BOX}
      ${THEME_TOGGLE}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Content preservation: preserve the entire <div class="layout"> inner (sidebar
// + main) verbatim + the trailing scripts/demos. Only nav + head are
// regenerated through What. Guarantees zero visual/content loss in every
// section regardless of its sidebar shape.
// ---------------------------------------------------------------------------
function extract(srcHtml) {
  const title = (srcHtml.match(/<title>(.*?)<\/title>/s)?.[1] || 'What Framework')
    .replace(/\s*—\s*What Framework\s*$/, '').trim();
  const layoutOpen = '<div class="layout">';
  const ls = srcHtml.indexOf(layoutOpen);
  const me = srcHtml.indexOf('</main>', ls);
  // the .layout closing </div> is the first </div> after </main>
  const layoutClose = srcHtml.indexOf('</div>', me);
  const layoutInner = srcHtml.slice(ls + layoutOpen.length, layoutClose);
  const bodyEnd = srcHtml.indexOf('</body>');
  const trailing = srcHtml.slice(layoutClose + '</div>'.length, bodyEnd).trim();
  return { title, layoutInner, trailing };
}

// Replace the old fake inline `window.What = {...}` mock with a classic <script>
// that loads the REAL What global (built to /what.global.js). The demo scripts
// (which read window.What synchronously) then run on the real framework.
function useRealWhat(html) {
  return html.replace(
    /<script>(?:(?!<\/script>)[\s\S])*?window\.What\s*=(?:(?!<\/script>)[\s\S])*?<\/script>/,
    '<script src="/what.global.js"></script>'
  );
}

// section base e.g. "/docs/learn"; rewrites links *within* that section + cross-section.
function rewriteLinks(html, base) {
  return html
    .replace(/href="\.\/([\w-]+)\.html"/g, (_, p) => `href="${base}/${p}"`)
    .replace(/href="\.\/"/g, `href="${base}"`)
    .replace(/href="\.\.\/([a-z]+)\/([\w-]+)\.html"/g, (_, sec, p) => `href="/docs/${sec}/${p}"`)
    .replace(/href="\.\.\/([a-z]+)\/"/g, (_, sec) => `href="/docs/${sec}"`)
    .replace(/href="\.\.\/"/g, `href="/docs"`);
}

// ---------------------------------------------------------------------------
// Search index — extracted from each page's <main> at build time and written
// to dist/search-index.json. docs/search.js queries it client-side (T6-03).
// ---------------------------------------------------------------------------
const SEARCH_INDEX = [];

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·')
    .replace(/&rarr;/g, '→').replace(/&amp;/g, '&');
}

function textify(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function indexPage({ route, title, section, layoutInner }) {
  const ms = layoutInner.indexOf('<main');
  const me = layoutInner.indexOf('</main>');
  let main = ms >= 0 && me > ms
    ? layoutInner.slice(layoutInner.indexOf('>', ms) + 1, me)
    : layoutInner;
  main = main.replace(/<aside class="toc">[\s\S]*?<\/aside>/, ' '); // skip the TOC
  const headings = [...main.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => textify(m[2]));
  SEARCH_INDEX.push({ route, title, section, headings, text: textify(main).slice(0, 6000) });
}

const HEAD = (title) => `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — What Framework</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/docs/styles.css">
  <script src="/theme.js"></script>
  <script src="/docs/copy-code.js"></script>
  <script src="/docs/search.js" defer></script>
</head>`;

// ---------------------------------------------------------------------------
// Page render — chrome through What's renderToString, content preserved.
// ---------------------------------------------------------------------------
function renderPage({ title, navSection, layoutInner, trailing }) {
  const nav = renderToString(h('nav', { dangerouslySetInnerHTML: { __html: navInner(navSection) } }));
  const layout = renderToString(h('div', { class: 'layout', dangerouslySetInnerHTML: { __html: layoutInner } }));
  const body = `  ${nav}\n\n  ${layout}${trailing ? '\n\n  ' + trailing : ''}`;
  return `<!DOCTYPE html>
<html lang="en">
${HEAD(title)}
<body>
${body}
</body>
</html>
`;
}

function write(routePath, html) {
  const dir = join(DIST, routePath.replace(/^\//, ''));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), stampVersion(html));
}

function copyAsset(rel) {
  const src = join(ROOT, rel);
  const dest = join(DIST, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
// A docs section whose pages share the nav + layout pattern (learn/reference/tutorial).
function buildSection({ dirRel, base, navSection }) {
  const dir = join(ROOT, ...dirRel.split('/'));
  let count = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.html')) continue;
    const slug = file === 'index.html' ? '' : file.replace('.html', '');
    const route = slug ? `${base}/${slug}` : base;
    const src = readFileSync(join(dir, file), 'utf8');
    if (!src.includes('<div class="layout">')) {
      console.warn(`  ! skip ${dirRel}/${file} (no .layout block)`);
      continue;
    }
    const { title, layoutInner, trailing } = extract(src);
    const rewritten = rewriteLinks(layoutInner, base);
    indexPage({ route, title, section: navSection[0].toUpperCase() + navSection.slice(1), layoutInner: rewritten });
    const html = renderPage({
      title,
      navSection,
      layoutInner: rewritten,
      trailing: useRealWhat(rewriteLinks(trailing, base)),
    });
    write(route, html);
    count++;
  }
  return count;
}

// reset dist, copy shared assets
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
for (const a of ['design-system.css', 'theme.js', 'favicon.svg', 'docs/styles.css', 'docs/copy-code.js', 'docs/search.js', 'llms.txt', 'llms-full.txt']) copyAsset(a);

// Bundle the REAL What framework as a browser global for the live demos.
await esbuild.build({
  entryPoints: [join(ROOT, 'what-global-entry.js')],
  outfile: join(DIST, 'what.global.js'),
  bundle: true, minify: true, format: 'iife', conditions: ['browser', 'import'],
  legalComments: 'none',
});
console.log('✓ what.global.js (real What for demos)');

const SECTIONS = [
  { dirRel: 'docs/learn', base: '/docs/learn', navSection: 'learn' },
  { dirRel: 'docs/reference', base: '/docs/reference', navSection: 'reference' },
  { dirRel: 'docs/tutorial', base: '/docs/tutorial', navSection: 'tutorial' },
];
let total = 0;
for (const s of SECTIONS) {
  const n = buildSection(s);
  total += n;
  console.log(`✓ ${s.navSection}: ${n} pages`);
}

writeFileSync(join(DIST, 'search-index.json'), JSON.stringify(SEARCH_INDEX));
console.log(`✓ search-index.json (${SEARCH_INDEX.length} pages indexed)`);

// Standalone pages (home, docs landing) — no shared layout/sidebar. Preserve the
// full <head> (meta/OG/title) and <body> verbatim; rewrite asset + .html links to
// absolute clean routes; route the body through What via a transparent wrapper
// (display:contents generates no box, so visuals are untouched).
function buildStandalone({ srcRel, route, headReplaces = [], bodyReplaces = [] }) {
  const src = readFileSync(join(ROOT, ...srcRel.split('/')), 'utf8');
  let head = src.slice(src.indexOf('<head>') + 6, src.indexOf('</head>'));
  let body = src.slice(src.indexOf('<body>') + 6, src.indexOf('</body>'));
  for (const [re, to] of headReplaces) head = head.replace(re, to);
  // strip .html from internal hrefs, then page-specific relative→absolute
  body = body.replace(/href="((?:\.{1,2}\/|\/)[^"]*?)\.html(#[^"]*)?"/g, (_, p, hash) => `href="${p}${hash || ''}"`);
  for (const [re, to] of bodyReplaces) body = body.replace(re, to);
  const rendered = renderToString(h('div', { style: 'display:contents', dangerouslySetInnerHTML: { __html: body } }));
  const html = `<!DOCTYPE html>
<html lang="en">
<head>${head}</head>
<body>
${rendered}
</body>
</html>
`;
  write(route, html);
}

buildStandalone({
  srcRel: 'index.html',
  route: '/',
  headReplaces: [[/(href|src)="\.\/([^"]+)"/g, '$1="/$2"']], // ./design-system.css → /design-system.css
  bodyReplaces: [],
});
total++;
console.log('✓ home: 1 page');

buildStandalone({
  srcRel: 'docs/index.html',
  route: '/docs',
  headReplaces: [
    [/href="\.\/styles\.css"/g, 'href="/docs/styles.css"'],
    [/src="\.\.\/theme\.js"/g, 'src="/theme.js"'],
    [/src="\.\/copy-code\.js"/g, 'src="/docs/copy-code.js"'],
    [/src="\.\/search\.js"/g, 'src="/docs/search.js"'],
    [/href="\.\.\/favicon\.svg"/g, 'href="/favicon.svg"'],
  ],
  bodyReplaces: [
    [/href="\.\/(learn|reference|tutorial)\//g, 'href="/docs/$1/'],
    [/href="\.\.\/"/g, 'href="/"'],
  ],
});
total++;
console.log('✓ docs landing: 1 page');

console.log(`✓ assets copied`);
console.log(`Build complete → ${DIST} (${total} pages)`);
