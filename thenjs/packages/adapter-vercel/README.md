# @thenjs/adapter-vercel

Vercel deployment adapter for ThenJS. Produces a [Build Output API v3](https://vercel.com/docs/build-output-api/v3) directory structure with static assets, serverless functions, and cron configuration.

## Install

```
npm install @thenjs/adapter-vercel
```

Peer dependency: `@thenjs/build`.

## Usage

### Configuration

Set the adapter in your project config:

```typescript
// then.config.ts
import { defineConfig } from 'thenjs';

export default defineConfig({
  build: {
    adapter: 'vercel', // or 'auto' (detects Vercel when VERCEL env is set)
  },
});
```

### Build

Run the production build:

```
npx thenjs build
```

The adapter generates the following structure:

```
.vercel/output/
  config.json          # Routing rules (static, SSR, API, RPC, SPA fallback)
  crons.json           # Cron schedules (if tasks are defined)
  static/              # Client assets + pre-rendered HTML (served from CDN)
  functions/
    index.func/        # SSR serverless function
    api-health.func/   # API route function
    _rpc.func/         # RPC handler function
```

### What It Does

1. Copies client assets and pre-rendered pages to `static/` for CDN serving
2. Creates a serverless function (Node.js 22.x) for each SSR page and API route
3. Creates a single serverless function for all RPC procedures at `/_rpc/`
4. Generates `config.json` with routing rules: immutable cache for assets, function destinations for dynamic routes, and SPA fallback
5. Generates `crons.json` for any scheduled tasks

### Deploy

Push to your Vercel-connected repository or use the Vercel CLI:

```
vercel deploy
```

## API

| Export | Description |
|---|---|
| `default` (adapter) | Build adapter with `buildEnd()` hook -- generates `.vercel/output/` |
| `ThenAdapter` | Adapter interface type |

## License

[MIT](../../LICENSE)
