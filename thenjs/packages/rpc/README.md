# @thenjs/rpc

Type-safe RPC layer for ThenJS. Define procedures with input/output validation, compose them into routers, handle requests on the server, and call them from the client with full type inference.

## Install

```
npm install @thenjs/rpc
```

Peer dependency: `@thenjs/schema` (installed automatically within the monorepo).

## Usage

### Define Procedures

```typescript
import { procedure } from '@thenjs/rpc';
import { z } from 'zod';

const getUser = procedure
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .query(async ({ input }) => {
    return { id: input.id, name: 'Ada Lovelace' };
  });

const createUser = procedure
  .input(z.object({ name: z.string(), email: z.string().email() }))
  .mutation(async ({ input }) => {
    return { id: crypto.randomUUID(), ...input };
  });
```

### Build a Router

```typescript
import { router } from '@thenjs/rpc';

const appRouter = router({
  user: {
    getById: getUser,
    create: createUser,
  },
});

export type AppRouter = typeof appRouter;
```

### Server Handler

`RPCHandler` converts a router into a Web Standard Request handler. Mount it at `/_rpc/`:

```typescript
import { RPCHandler } from '@thenjs/rpc';

const handler = new RPCHandler(appRouter, (request) => ({
  request,
  // Add context (e.g. authenticated user)
}));

// In a ThenJS app the build plugin mounts this automatically.
// For manual usage:
const response = await handler.handle(request);
```

### Client Proxy

`createRPCClient` returns a Proxy with full autocompletion derived from the router type:

```typescript
import { createRPCClient } from '@thenjs/rpc';
import type { AppRouter } from './rpc/index.js';

const rpc = createRPCClient<AppRouter>({ baseUrl: '/_rpc' });

// Query
const user = await rpc.user.getById.query({ id: '1' });

// Mutation
const created = await rpc.user.create.mutate({ name: 'Ada', email: 'ada@example.com' });

// SWR integration (What Framework)
const { key, fetcher } = rpc.user.getById.useSWR({ id: '1' });
```

### Middleware

```typescript
import { createProcedure } from '@thenjs/rpc';

const authedProcedure = createProcedure(async ({ ctx, next }) => {
  const token = ctx.request.headers.get('authorization');
  if (!token) throw new Error('Unauthorized');
  ctx.user = await verifyToken(token);
  return next();
});

const secretData = authedProcedure
  .input(z.object({ key: z.string() }))
  .query(async ({ input, ctx }) => {
    return { value: 'secret', owner: (ctx as any).user.id };
  });
```

## API

| Export | Description |
|---|---|
| `procedure` | Default procedure builder. Chain `.input()`, `.output()`, `.use()`, then `.query()` or `.mutation()` |
| `createProcedure(...mw)` | Create a builder with shared middleware |
| `router(routes)` | Group procedures into a nested router |
| `RPCHandler` | Server-side handler. `handle(Request) -> Response`. Also exposes `getManifest()` and `generateOpenAPI()` |
| `createRPCClient<T>(opts?)` | Type-safe client proxy with `.query()`, `.mutate()`, `.useSWR()` |
| `RPCError` | Error class thrown by the client on failure |
| `encode(value)` / `decode(value)` | Wire protocol for Date, BigInt, Set, Map, RegExp over JSON |

## License

[MIT](../../LICENSE)
