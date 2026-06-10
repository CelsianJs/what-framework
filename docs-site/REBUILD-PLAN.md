# docs-site → What rebuild plan

> Goal (Kirby): "Use what-fw everywhere on the docs site without losing a single
> visual, content, or anything like that experience." Clean routes (no `.html`).

## Current state (the problem)

- **40 static HTML pages** under `docs-site/` (home + `docs/` + `docs/learn/*` +
  `docs/reference/*` + `docs/tutorial/*`).
- Chrome (head, nav, sidebar, `main.content`, toc) is **copy-pasted** across pages.
  Only the 4 full-stack learn pages are generated (`scripts/gen-fullstack-docs.mjs`).
- Drift already exists (e.g. nav badge `v0.10.0` on hand-written pages vs `v0.10`
  from the generator).
- The `docs/learn/*` interactive demos use a **fake inline `window.What` mock**, not
  the real framework.
- Deploys as pure static (Vercel root dir `docs-site/`, no build step).

## Target architecture

A **What SSG** that owns the chrome as real What components, preserves page content
verbatim, and statically exports to clean routes. Pixel-identical by construction.

Confirmed-available v0.10 APIs (no framework changes needed):
- `what-server`: `renderToString`, `renderToStringWithHead`, `renderDocument`.
- `what-server/adapter/static` → `exportStatic` (emits `outDir/<route>/index.html`).
- core `dangerouslySetInnerHTML={{__html}}` — render preserved content markup verbatim.
- core islands (`Island`, hydration) for the interactive demos.

### Zero-visual-loss strategy (the keystone)

Prose pages don't need reactivity. So we **preserve the exact content markup** and only
What-ify the chrome + interactive demos:

1. **Chrome as What components** — `Layout`, `Nav`, `Sidebar`, `Toc`, `Footer`. Ported
   1:1 from the existing markup (and the generator's `page()`/`sidebar()`), so output
   bytes match.
2. **Content preserved** — extract each page's `<main class="content">` inner HTML +
   `<title>` + active-nav/sidebar state, and render it inside the What `Layout` via
   `dangerouslySetInnerHTML`. Content markup is byte-identical → no visual change.
3. **Reuse CSS unchanged** — `design-system.css`, `docs/styles.css` are not touched.
4. **Interactive demos → real What islands** — the `docs/learn/*` inline-mock demos
   (forms, animation, data-fetching, accessibility) are reimplemented as real What
   islands hydrated on the page. This is the genuine dogfooding win.
5. **Static export → clean routes** — `exportStatic` writes `/docs/learn/forms/index.html`
   etc. (drops the `.html`).

### Section layouts (chrome variants)

| Section | Layout variant | Source of truth |
|---|---|---|
| `/` (home) | Marketing landing (no sidebar) | `index.html` (1328 lines) |
| `/docs` | Docs landing | `docs/index.html` |
| `/docs/learn/*` | Sidebar + content + toc | generator `page()`/`sidebar()` |
| `/docs/reference/*` | Reference sidebar + content | `reference/index.html` |
| `/docs/tutorial/*` | Tutorial chrome | `tutorial/index.html` |

## Build & deploy

- `docs-site/` becomes a What SSG project: add `package.json`, `what.config.js`,
  `pages/` (route components), `lib/` (Layout + extracted content), `build` script
  calling `exportStatic`.
- Output to `docs-site/dist/` (gitignored). Vercel: set build command `npm run build`,
  output dir `dist/`. Same domain (whatfw.com), now built instead of raw-static.
- Old `.html` files stay in git history; new build reproduces them at clean routes.

## Execution slices (each browser-verified before the next)

0. **Foundation** — project scaffold, `Layout`/`Nav`/`Sidebar`/`Toc` What components
   (port learn chrome), content-extraction helper, `exportStatic` wiring. Gate: builds.
1. **Learn section** — migrate all `docs/learn/*` (22 pages). Browser-verify `forms`,
   `signals`, `animation` against the live pages (light + dark). Gate: pixel parity.
2. **Interactive demos → real What islands** — replace the inline `window.What` mocks
   on the learn demo pages with real What islands. Gate: demos work + theme-aware.
3. **Reference section** — `docs/reference/*` (10 pages) + its sidebar variant.
4. **Tutorial section** — `docs/tutorial/*` (7 pages) + tutorial chrome.
5. **Docs landing** — `docs/index.html`.
6. **Home** — `index.html` (the 45K marketing landing) as a What page.
7. **Cutover** — switch Vercel to the built output; verify every route live; remove the
   superseded raw `.html` sources (kept in git history).

## Verification (per slice, per the "lose zero visuals" constraint)

- `npm run build` → serve `dist/` → headed Playwright at the same viewport.
- Compare new clean-route page vs the current live page: nav, sidebar active state,
  content, toc, footer, **light and dark** mode.
- Confirm `theme.js` toggle + `copy-code.js` still work (ported as islands/effects).
- Only advance a slice when its pages are visually confirmed.

## Risks & mitigations

- **Visual drift** → content preserved verbatim + same CSS; verify each slice headed.
- **Relative links** (`../styles.css`, `./signals.html`) → rewrite to clean routes
  during extraction; add redirects from old `.html` if any external links exist.
- **Demo regressions** → islands behind the same DOM/markup the CSS targets.
- **Deploy change** (static → built) → keep old files until slice 7 cutover verified.
