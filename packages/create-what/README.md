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

## Options

The scaffolder prompts you for:

1. **Project name** -- directory to create
2. **Template** -- SPA (default) or full-stack (`--fullstack` / `--template=fullstack`)
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

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
