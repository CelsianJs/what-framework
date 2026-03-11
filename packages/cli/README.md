# what-framework-cli

CLI for [What Framework](https://whatfw.com). Provides a zero-config dev server with HMR, production builds with content hashing and gzip, preview server, and static site generation.

## Install

```bash
npm install what-framework-cli --save-dev
```

Or use directly:

```bash
npx what-framework-cli dev
```

## Commands

### `what dev`

Start a development server with hot module reloading via WebSocket.

```bash
what dev
what dev --port 8080
what dev --host 0.0.0.0
```

Features:
- WebSocket-based HMR with automatic reconnection
- Bare import transforms (`what` -> framework modules)
- File-based routing from `src/pages/`
- SPA fallback for client-side routing
- Server action endpoint

### `what build`

Create a production build with minification, content hashing, and gzip compression.

```bash
what build
```

Output:
- Minified JS and HTML
- Content-hashed filenames for cache busting
- Gzipped copies of all JS files
- `manifest.json` mapping original filenames to hashed versions
- Bundled framework runtime

### `what preview`

Preview a production build locally.

```bash
what preview
what preview --port 4000
```

### `what generate`

Static site generation. Runs a build, then pre-renders all pages.

```bash
what generate
```

### `what init`

Create a new project (prefer `npx create-what` for the full scaffolding experience).

```bash
what init my-app
```

## Configuration

Create a `what.config.js` in your project root:

```js
export default {
  mode: 'hybrid',          // 'static' | 'server' | 'client' | 'hybrid'
  pagesDir: 'src/pages',   // Pages directory for file-based routing
  outDir: 'dist',          // Build output directory
};
```

## Options

| Flag | Description | Default |
|---|---|---|
| `--port` | Server port | `3000` (dev), `4000` (preview) |
| `--host` | Server host | `localhost` |

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
