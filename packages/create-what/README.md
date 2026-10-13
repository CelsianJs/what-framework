# create-what

Scaffold a new [What Framework](https://whatfw.com) project with one command.

## Usage

```bash
npm create what@latest my-app
cd my-app
npm install
npm run dev
```

Or with Bun:

```bash
bun create what@latest my-app
```

### Skip prompts

```bash
npm create what@latest my-app -- --yes
```

### Full-stack template

```bash
npm create what@latest my-app -- --fullstack
cd my-app
npm install
npm run dev   # real SSR + ISR server -> http://localhost:3000
```

File-routed SSR with server loaders, server actions, client hydration, and
origin-first ISR (stale-while-revalidate + on-demand revalidation + poll
regeneration). Buildless: the server serves the client entry and the framework
as native ES modules — no bundler, works on any Node host, no CDN required.

In production, set `WHAT_REVALIDATE_SECRET` (the server refuses to start
without it when `NODE_ENV=production`).

### Static site + islands template

```bash
npm create what@latest my-site -- --template=islands
cd my-site
npm install
npm run dev     # pages rendered on request
npm run build   # static HTML in dist/, one file per page
```

JSX pages prerendered to static HTML, with interactive islands. `npm run build`
writes `dist/index.html`, `dist/about/index.html` and so on, which any static
host can serve. A page ships only the islands it contains: each island's markup
is in the HTML, and the browser hydrates it in place when its `mode` fires
(`load`, `idle`, `visible`, `action` or `media`). A page with no islands runs
no framework code.

Pages are written in JSX compiled by What's automatic runtime
(`jsxImportSource: 'what-framework'`), not by `what-compiler`, because every
page is rendered on the server. Reactive text is therefore always a function:
`{() => count()}`.

## Options

The scaffolder prompts you for:

1. **Project name** -- directory to create
2. **Template** -- SPA (default), full-stack (`--fullstack` / `--template=fullstack`),
   or static site + islands (`--template=islands`)
3. **React compat** (SPA only) -- include `what-react` for using React libraries (zustand, TanStack Query, etc.)
4. **CSS approach** (SPA only) -- vanilla CSS, Tailwind CSS v4, or StyleX

## What You Get

### SPA (default)

```
my-app/
  src/
    main.jsx          # App entry point with counter example
    styles.css        # Styles (vanilla, Tailwind, or StyleX)
  public/
    favicon.svg       # What Framework logo
  index.html          # HTML entry
  vite.config.js      # Pre-configured Vite (What compiler or React compat)
  eslint.config.js    # eslint-plugin-what (compiler preset)
  tsconfig.json       # TypeScript config
  package.json
  .gitignore
```

### Full-stack (`--fullstack`)

```
my-app/
  src/
    pages/            # File-routed pages (loader + page config + component)
    actions/          # Server actions (mutations + cache revalidation)
    routes.js         # Route table
    entry-client.js   # Client hydration entry
    db.js             # In-memory demo data (swap for SQLite/Postgres)
    styles.css
  server.js           # Node adapter + ISR engine + revalidate webhook
  what.config.js      # Deploy adapter + ISR defaults
  eslint.config.js    # eslint-plugin-what (recommended preset)
  package.json
```

### Static site + islands (`--template=islands`)

```
my-site/
  src/
    pages/
      Home.jsx        # Page with one island
      About.jsx       # Page with no islands (ships no framework code)
    components/
      Layout.jsx      # Shared layout, sets each page's <title>
    islands/
      Counter.jsx     # The interactive island
    entry-server.js   # Route table + document shell for every page
    entry-client.js   # Registers islands; does nothing on a page without one
    styles.css
  public/
    favicon.svg
  vite.config.js      # Dev server renders pages on request
  build.js            # Static build: client bundle, then every page to dist/
  eslint.config.js    # eslint-plugin-what (recommended preset)
  package.json
```

Add a page by creating a component in `src/pages/` and adding a row to
`routes` in `src/entry-server.js`. Add an island by creating it in
`src/islands/`, registering it in `src/entry-client.js`, and placing it in a
page with `<Island name="..." mode="..." props={p}><Component {...p} /></Island>`.

### With React compat enabled

The scaffold includes a working zustand demo showing a React state library running on What's signal engine.

### With Tailwind CSS

Tailwind v4 is configured via `@tailwindcss/vite`. The counter example uses utility classes.

### With StyleX

StyleX is configured via `vite-plugin-stylex`. The counter example uses `stylex.create()` and `stylex.props()`.

## Scripts

### SPA

| Script | Command |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint (eslint-plugin-what) |

### Full-stack

| Script | Command |
|---|---|
| `npm run dev` | SSR + ISR server with auto-restart on change |
| `npm start` | Same server, no watcher (production entry point) |
| `npm run lint` | ESLint (eslint-plugin-what) |

### Static site + islands

| Script | Command |
|---|---|
| `npm run dev` | Vite dev server; each page is rendered on request |
| `npm run build` | Static HTML for every page in `dist/` |
| `npm run preview` | Serve `dist/` the way a static host does |
| `npm run lint` | ESLint (eslint-plugin-what) |

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
