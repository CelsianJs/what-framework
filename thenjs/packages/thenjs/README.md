# thenjs

The main package for ThenJS -- a meta-framework for What Framework. Provides the CLI for development, production builds, and preview, plus re-exports from `@thenjs/server`, `@thenjs/build`, and `@thenjs/rpc`.

## Install

```
npm install thenjs
```

## CLI

```
npx thenjs dev          # Start dev server with HMR (default command)
npx thenjs build        # Production build (client + server + static)
npx thenjs preview      # Preview the production build locally
```

### Options

| Flag | Alias | Description | Default |
|---|---|---|---|
| `--port <port>` | `-p` | Server port | `3000` |
| `--host <host>` | `-H` | Server host | `localhost` |
| `--open` | `-o` | Open in browser | `false` |
| `--help` | `-h` | Show help | |
| `--version` | `-v` | Show version | |

## Configuration

Create a `then.config.ts` at your project root:

```typescript
import { defineConfig } from 'thenjs';

export default defineConfig({
  server: {
    port: 3000,
    host: 'localhost',
    defaultPageMode: 'hybrid', // 'client' | 'server' | 'static' | 'hybrid'
  },
  build: {
    adapter: 'auto', // 'auto' | 'node' | 'vercel' | custom string
    outDir: 'dist',
  },
  rpc: {
    schema: 'zod',
    openapi: {
      title: 'My API',
      version: '1.0.0',
    },
  },
  what: {
    compiler: {
      mode: 'fine-grained', // 'vdom' | 'fine-grained'
    },
  },
});
```

## Re-exports

`thenjs` re-exports the most common APIs so you can import from a single package:

```typescript
// Server
import { createApp, defineConfig, loadConfig } from 'thenjs';
import type { ThenConfig, ThenApp, ThenRequest, ThenReply } from 'thenjs';

// Build
import { thenVitePlugin } from 'thenjs';
import type { ThenVitePluginOptions } from 'thenjs';

// RPC
import { procedure, router, createRPCClient } from 'thenjs';
import type { RPCContext, ProcedureDefinition, RouterDefinition } from 'thenjs';
```

## API

| Export | Source |
|---|---|
| `createApp` | `@thenjs/server` |
| `defineConfig` / `loadConfig` | `@thenjs/server` |
| `thenVitePlugin` | `@thenjs/build` |
| `procedure` / `router` | `@thenjs/rpc` |
| `createRPCClient` | `@thenjs/rpc` |

## License

[MIT](../../LICENSE)
