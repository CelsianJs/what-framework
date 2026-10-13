# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-10-01
- Primary product surfaces: whatfw.com marketing, documentation and starter gallery.
- Evidence reviewed: `index.html`, `design-system.css`, `docs/styles.css`, `build.mjs` and a rendered marketing baseline.

## Brand

- Personality: direct, technical and welcoming; warm darks, cream surfaces and green accents.
- Trust signals: working demos, public source, documented limitations and reproducible builds.
- Avoid: invented deployment links, placeholder product cards, unsupported performance claims or generated project instructions in demo content.

## Product goals

- Help developers and agents choose, run and understand a real starter.
- Keep marketing consistent with the existing framework site, not a new visual system.
- Success signals: visitors can reach a live app, its source and its build explanation from one card.
- Non-goals: migrating the marketing host or redesigning existing documentation.

## Personas and jobs

- Developers evaluating What: browse by product type and rendering model, clone a complete app.
- Agents implementing an app: read the architecture and source mapping before modifying code.
- Contexts: desktop exploration, mobile browsing and machine-readable discovery.

## Information architecture

- Primary navigation: Docs, Templates, existing learning and ecosystem links.
- Core routes: `/templates`, `/templates/agents`, `/templates/catalog.json`, `/templates/llms.txt`.
- Build progress: `/templates/status` and per-starter status/reference journals. Planned and building entries are allowed here, explicitly separate from the verified-release gallery.
- Hierarchy: product preview, intended use, architecture, features, live/source/build links, clone steps.

## Design principles

- Reuse site tokens and typography. Distinct starter previews provide variety, not competing gallery chrome.
- Publish only verified releases. Draft metadata stays outside the public output.
- Tradeoff: useful static HTML first; small progressive enhancement for search, filters and copying.

## Visual language

- Color: existing `--bg-*`, `--text-*`, `--border` and `--accent` tokens.
- Typography: existing Inter and JetBrains Mono; do not introduce a new font dependency.
- Layout: centered 1200px content, generous introduction, two-column preview grid and clear section dividers.
- Shape: existing restrained rounded corners and borders; no extra elevation system.
- Motion: subtle existing transitions, no entrance animation that hides content before JavaScript.
- Imagery: actual, locally hosted demo screenshots with dimensions; no fabricated preview art. Capture dates are recorded only when known, and product-object crops should show the usable workflow rather than only a headline.

## Components

- Reuse: logo/version badge, theme toggle, buttons and code surfaces.
- New: starter card, labeled search, rendering filter, result count, agent reference list.
- Progress: compact phase counts, product/phase filters, recorded-check and journal lists, no-store refresh with last-successful-check and offline/retry states.
- Journal references pair the product identity with its verified screenshot. Build phases are a read-only connected stepper, with complete/current/upcoming labels rather than button-like boxes; a phase is not a claim that every later audit passed.
- Ownership: gallery CSS and assets under `templates/`; shared tokens remain unchanged.

## Accessibility

- Target: WCAG 2.2 AA-informed behavior, without claiming a formal audit.
- Keyboard: native links/buttons, clear focus outlines, skip link and ordinary Tab order.
- Contrast: site foreground tokens, dark text on green controls.
- Semantics: one h1, labeled search/filter fields and polite status text.
- Reduced motion: disable gallery transitions; previews never flash or autoplay.

## Responsive behavior

- Desktop: two-column cards; narrow screens: one column, wrapped navigation and stacked controls.
- Touch: controls at least 44px high; no hover-only links or copy actions.

## Interaction states

- Loading: static content is already present, not a skeleton.
- Empty: no search matches offers a reset. A catalog with no published releases shows useful framework starting paths, not unfinished demos.
- Error: failed clipboard copying leaves the selectable command and explains the failure.
- Success: copying confirms only after clipboard success.
- Offline: guide text, features and clone commands remain readable; external links need connectivity.

## Content voice

- Describe real workflows and state/storage boundaries in plain language.
- Distinguish static, client, hybrid and serverless; a local demo is not durable backend SaaS.
- Explain the agent path through `BUILD.md`, `/build`, source files and real test commands.

## Implementation constraints

- Framework: existing What SSG build; gallery content renders at build time.
- No new runtime dependency, third-party image host or private Platform source import.
- Preview assets must exist before a release can publish. HTML and JSON must omit draft entries.
- The release gallery omits drafts; the public status area intentionally shows all planned/building products without invented source, demo or preview links. Only sanitized product facts and verification summaries belong in its status data.
- Tests: metadata validation, HTML/link contracts, build check, desktop/mobile interaction and console health.

## Open questions

- None blocking this gallery integration. Release verification and preview assets are supplied by the deployment owner.
