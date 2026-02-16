# ThenJS

**The meta-framework for [What Framework](https://github.com/zvndev/what-fw).**

ThenJS provides file-based routing, server-side rendering, type-safe RPC, schema validation, and deployment adapters — all built on Web Standard APIs.

## Packages

| Package | Description |
|---------|-------------|
| [`thenjs`](packages/thenjs) | Main package — CLI + re-exports |
| [`@thenjs/server`](packages/server) | Hook-based server runtime (Web Standard APIs) |
| [`@thenjs/rpc`](packages/rpc) | Type-safe RPC with schema validation |
| [`@thenjs/schema`](packages/schema) | Standard schema adapter (Zod, TypeBox, Valibot) |
| [`@thenjs/build`](packages/build) | Vite plugin + production build pipeline |
| [`@thenjs/adapter-node`](packages/adapter-node) | Node.js deployment adapter |
| [`@thenjs/adapter-vercel`](packages/adapter-vercel) | Vercel deployment adapter |
| [`create-then`](packages/create-then) | Project scaffolder (`npx create-then`) |

## Quick Start

```bash
npx create-then my-app
cd my-app
npm install
npx thenjs dev
```

## Architecture

```
┌─────────────────────────────────────────────┐
│                   thenjs                     │
│              (CLI + re-exports)              │
├──────────┬──────────┬───────────────────────┤
│  server  │  build   │         rpc           │
│  (hooks, │  (Vite   │  (procedures,         │
│  router, │  plugin, │   router, client,     │
│  reply)  │  bundle) │   wire protocol)      │
├──────────┴──────────┼───────────────────────┤
│                     │       schema           │
│                     │  (Zod/TypeBox/Valibot) │
├─────────────────────┴───────────────────────┤
│          adapter-node / adapter-vercel       │
└─────────────────────────────────────────────┘
```

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

## Project Structure

```
thenjs/
├── packages/
│   ├── schema/          # Standard schema adapter
│   ├── server/          # Hook-based server
│   ├── rpc/             # Type-safe RPC
│   ├── build/           # Vite plugin + build
│   ├── thenjs/          # Main CLI package
│   ├── adapter-node/    # Node.js adapter
│   ├── adapter-vercel/  # Vercel adapter
│   └── create-then/     # Project scaffolder
├── examples/
│   ├── starter/         # Basic app
│   └── full-stack/      # Full-stack with RPC
└── docs-site/           # Documentation
```

## License

[MIT](LICENSE)
