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
- WebSocket-based HMR with automatic reconnection (same-origin only)
- Bare import transforms (`what-framework`, `what-framework/router`, `what-framework/server` -> `/@what/*.js`)
- File-based routing from `src/pages/`
- SPA fallback for client-side routing
- Server action endpoint

### `what build`

Create a production build: minified JavaScript, content hashing, and gzip compression. HTML files are copied as authored.

```bash
what build
```

Output:
- Minified JS and HTML
- Content-hashed filenames for cache busting
- Gzipped copies of all JS files
- `manifest.json` mapping original filenames to hashed versions
- The framework runtime under `dist/@what/` (unhashed, so app imports keep resolving)

The build fails with a non-zero exit code if there is no app to build, if the
framework runtime cannot be resolved (`npm install what-framework`), or if any
bare import specifier survives into the output.

### `what preview`

Preview a production build locally.

```bash
what preview
what preview --port 4000
```

### `what generate`

Static site generation. Runs a build, then pre-renders every page module in
`pagesDir` to `dist/<route>/index.html` (running each page's `loader` first and
collecting its `<Head>` tags). Dynamic routes (`[id].js`) are skipped.

```bash
what generate
```

### `what start`

Run the project's full-stack server (`server.js`, Node adapter + ISR). Scaffold
one with `npm create what@latest -- --fullstack`.

```bash
what start
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

`what dev` answers only requests whose Host is localhost (or `*.localhost`), an
IP address, its `--host`, or a name in `allowedHosts` (`what.config.js`, a list,
or `true` for any) or `--allowed-hosts`; any other Host gets 403. A page on
another site that points its own domain at your machine (DNS rebinding) cannot
read your sources through it. The HMR WebSocket also checks the page's Origin.

| Flag | Description | Default |
|---|---|---|
| `--port` | Server port | `3000` (dev), `4000` (preview) |
| `--host` | Server host | `localhost` |
| `--allowed-hosts` | `what dev`: more Host names to answer, comma-separated (`true` for any) | |
| `--version` | Print the CLI version | |

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
