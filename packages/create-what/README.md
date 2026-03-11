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

## Options

The scaffolder prompts you for:

1. **Project name** -- directory to create
2. **React compat** -- include `what-react` for using React libraries (zustand, TanStack Query, etc.)
3. **CSS approach** -- vanilla CSS, Tailwind CSS v4, or StyleX

## What You Get

```
my-app/
  src/
    main.jsx         # App entry point with counter example
    styles.css        # Styles (vanilla, Tailwind, or StyleX)
  public/
    favicon.svg       # What Framework logo
  index.html          # HTML entry
  vite.config.js      # Pre-configured Vite (What compiler or React compat)
  tsconfig.json       # TypeScript config
  package.json
  .gitignore
```

### With React compat enabled

The scaffold includes a working zustand demo showing a React state library running on What's signal engine.

### With Tailwind CSS

Tailwind v4 is configured via `@tailwindcss/vite`. The counter example uses utility classes.

### With StyleX

StyleX is configured via `vite-plugin-stylex`. The counter example uses `stylex.create()` and `stylex.props()`.

## Scripts

| Script | Command |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
