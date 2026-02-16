# create-then

Project scaffolder for ThenJS. Creates a new project with file-based routing, API routes, TypeScript, and Vite pre-configured.

## Install

No install needed -- run directly with `npx`:

```
npx create-then my-app
```

## Usage

### Starter Template (default)

```
npx create-then my-app
```

Scaffolds:

```
my-app/
  src/
    pages/
      index.tsx          # Home page (hybrid mode)
      _layout.tsx        # Root layout
    api/
      health.ts          # GET /api/health
    entry-client.tsx     # Client hydration entry
    entry-server.tsx     # SSR render entry
  then.config.ts         # ThenJS configuration
  tsconfig.json
  package.json
```

### Full-Stack Template

```
npx create-then my-app --template full-stack
```

Includes everything from `starter` plus:

```
  src/
    rpc/
      index.ts           # RPC router index
      user.ts            # Example user procedures (Zod validation)
    middleware/
      auth.ts            # Example auth hook
```

Also adds `@thenjs/rpc` and `zod` as dependencies and configures OpenAPI generation in `then.config.ts`.

### Getting Started

```
cd my-app
npm install
npx thenjs dev
```

### Options

| Flag | Alias | Description | Default |
|---|---|---|---|
| `--template <name>` | `-t` | Template to use (`starter`, `full-stack`) | `starter` |
| `--help` | `-h` | Show help | |

## API

The package is designed to be used as a CLI via `npx`. It exports no programmatic API.

## License

[MIT](../../LICENSE)
