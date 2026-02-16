# @thenjs/build

Vite plugin and production build pipeline for ThenJS. Handles SSR middleware, API routes, RPC, virtual modules, and multi-step client + server builds with adapter integration.

## Install

```
npm install @thenjs/build
```

Peer dependencies: `vite ^6.0.0`, `what-framework`.

## Usage

### Vite Plugin

Add `thenVitePlugin` to your Vite config. In most cases the `thenjs` CLI does this for you automatically:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { thenVitePlugin } from '@thenjs/build';

export default defineConfig({
  plugins: [
    ...thenVitePlugin({
      config: {
        server: { defaultPageMode: 'hybrid' },
      },
    }),
  ],
});
```

The plugin provides:

- **SSR middleware** -- renders pages via `src/entry-server.tsx` during dev
- **API route middleware** -- auto-loads handlers from `src/api/` (file-based)
- **RPC middleware** -- serves `/_rpc/` calls from `src/rpc/index.ts`
- **Virtual modules** -- `virtual:then-routes`, `virtual:then-manifest`, `virtual:then-rpc-client`

### Production Build

`build()` runs a full client + server Vite build, pre-renders static pages, generates route and task manifests, and invokes the configured adapter:

```typescript
import { build } from '@thenjs/build';
import { loadConfig } from '@thenjs/server';

const config = await loadConfig();

const result = await build({
  config,
  root: process.cwd(),
});

// result.clientDir   -- built client assets
// result.serverEntry -- SSR entry bundle
// result.staticDir   -- pre-rendered HTML
// result.routes      -- RouteManifest (pages, api, rpc)
// result.tasks       -- TaskManifest (cron, queue)
```

### Virtual Modules

Import these in application code to access auto-generated route data:

```typescript
import { routes, apiRoutes, pageModes } from 'virtual:then-routes';
import { manifest } from 'virtual:then-manifest';
import { rpc } from 'virtual:then-rpc-client';
```

## API

| Export | Description |
|---|---|
| `thenVitePlugin(options?)` | Returns Vite `Plugin[]`. Options: `{ config?, root? }` |
| `build(options)` | Run a full production build. Options: `{ config, root }` |
| `ThenVitePluginOptions` | Plugin option types |
| `BuildOptions` / `BuildResult` | Build input/output types |
| `RouteManifest` | Pages, API routes, and RPC procedures discovered at build time |
| `TaskManifest` | Cron jobs and queue workers discovered at build time |

## License

[MIT](../../LICENSE)
