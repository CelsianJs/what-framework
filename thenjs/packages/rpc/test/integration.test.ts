// @thenjs/rpc — Integration Tests
// Tests full RPC flow, middleware chains, error propagation,
// wire protocol roundtrips, and OpenAPI spec generation.

import { describe, it, expect } from 'vitest';
import { procedure, createProcedure } from '../src/procedure.js';
import { router, RPCHandler } from '../src/router.js';
import { encode, decode } from '../src/wire.js';
import type { MiddlewareFunction, RPCContext } from '../src/types.js';

// ─── Helpers ───

/** Create a mock schema that conforms to the auto-detected Zod-like interface */
function createMockSchema(options?: {
  failValidation?: boolean;
  issues?: Array<{ message: string; path?: (string | number)[] }>;
  jsonSchema?: Record<string, unknown>;
}) {
  return {
    safeParse: (input: unknown) => {
      if (options?.failValidation) {
        return {
          success: false,
          error: {
            issues: options.issues ?? [{ message: 'Validation failed', path: [] }],
          },
        };
      }
      return { success: true, data: input };
    },
    parse: (input: unknown) => {
      if (options?.failValidation) {
        throw new Error('Validation failed');
      }
      return input;
    },
    validate: (input: unknown) => {
      if (options?.failValidation) {
        return {
          success: false,
          issues: options.issues ?? [{ message: 'Validation failed', path: [] }],
        };
      }
      return { success: true, data: input };
    },
    toJsonSchema: () => options?.jsonSchema ?? { type: 'object' },
    _input: undefined,
    _output: undefined,
  };
}

function makeRPCRequest(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    searchParams?: Record<string, string>;
    headers?: Record<string, string>;
  },
): Request {
  const method = options?.method ?? 'GET';
  const url = new URL(`http://localhost/_rpc/${path}`);
  if (options?.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const init: RequestInit = { method };
  if (options?.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = {
      'content-type': 'application/json',
      ...options?.headers,
    };
  } else {
    init.headers = options?.headers ?? {};
  }

  return new Request(url.toString(), init);
}

// ─── 1. Full RPC Flow ───

describe('Integration: Full RPC Flow', () => {
  it('should handle a complete query flow: define → route → request → response', async () => {
    const routes = router({
      user: {
        getById: procedure
          .input(createMockSchema())
          .query(({ input }: { input: { id: string } }) => ({
            id: (input as any).id,
            name: 'Alice',
            email: 'alice@example.com',
          })),
        list: procedure.query(() => [
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Bob' },
        ]),
      },
    });

    const handler = new RPCHandler(routes);

    // Query with input
    const r1 = await handler.handle(
      makeRPCRequest('user.getById', {
        searchParams: { input: JSON.stringify(encode({ id: '42' })) },
      }),
    );
    expect(r1.status).toBe(200);
    const data1 = await r1.json();
    expect(data1.result).toEqual({ id: '42', name: 'Alice', email: 'alice@example.com' });

    // Query without input
    const r2 = await handler.handle(makeRPCRequest('user.list'));
    expect(r2.status).toBe(200);
    const data2 = await r2.json();
    expect(data2.result).toEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]);
  });

  it('should handle a complete mutation flow', async () => {
    const users: Array<{ id: string; name: string }> = [];

    const routes = router({
      user: {
        create: procedure
          .input(createMockSchema())
          .mutation(({ input }: { input: { name: string } }) => {
            const user = { id: String(users.length + 1), name: (input as any).name };
            users.push(user);
            return user;
          }),
      },
    });

    const handler = new RPCHandler(routes);

    const response = await handler.handle(
      makeRPCRequest('user.create', {
        method: 'POST',
        body: encode({ name: 'Charlie' }),
      }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result).toEqual({ id: '1', name: 'Charlie' });
    expect(users).toHaveLength(1);
  });

  it('should handle deeply nested router namespaces', async () => {
    const routes = router({
      api: {
        v2: {
          admin: {
            users: {
              list: procedure.query(() => ({ users: ['admin1', 'admin2'] })),
            },
          },
        },
      },
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('api.v2.admin.users.list'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result).toEqual({ users: ['admin1', 'admin2'] });
  });

  it('should handle procedures with no input and no output schema', async () => {
    const routes = router({
      health: procedure.query(() => ({ status: 'ok', timestamp: 'now' })),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('health'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result.status).toBe('ok');
  });
});

// ─── 2. Middleware Chain with Context Mutation ───

describe('Integration: Middleware Chain', () => {
  it('should run middleware chain and pass mutated context to handler', async () => {
    const authMiddleware: MiddlewareFunction = async ({ ctx, next }) => {
      ctx.userId = 'user-123';
      ctx.role = 'admin';
      return next();
    };

    const loggingMiddleware: MiddlewareFunction = async ({ ctx, next }) => {
      ctx.requestStartTime = Date.now();
      const result = await next();
      ctx.requestEndTime = Date.now();
      return result;
    };

    const routes = router({
      whoami: procedure
        .use(authMiddleware)
        .use(loggingMiddleware)
        .query(({ ctx }) => ({
          userId: ctx.userId,
          role: ctx.role,
        })),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('whoami'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result).toEqual({ userId: 'user-123', role: 'admin' });
  });

  it('should pass context from context factory through middleware to handler', async () => {
    const authMiddleware: MiddlewareFunction = async ({ ctx, next }) => {
      if (!ctx.userId) {
        throw Object.assign(new Error('Unauthorized'), { code: 'UNAUTHORIZED', statusCode: 401 });
      }
      return next();
    };

    const routes = router({
      protected: procedure
        .use(authMiddleware)
        .query(({ ctx }) => ({ userId: ctx.userId })),
    });

    // With user context
    const handler = new RPCHandler(routes, (request) => ({
      request,
      userId: 'user-456',
    }));

    const response = await handler.handle(makeRPCRequest('protected'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result).toEqual({ userId: 'user-456' });
  });

  it('should use createProcedure to share middleware across procedures', async () => {
    const executionLog: string[] = [];

    const authMw: MiddlewareFunction = async ({ ctx, next }) => {
      executionLog.push('auth');
      ctx.authenticated = true;
      return next();
    };

    const protectedProcedure = createProcedure(authMw);

    const routes = router({
      getProfile: protectedProcedure.query(({ ctx }) => {
        executionLog.push('getProfile');
        return { authenticated: ctx.authenticated };
      }),
      getSettings: protectedProcedure.query(({ ctx }) => {
        executionLog.push('getSettings');
        return { authenticated: ctx.authenticated };
      }),
    });

    const handler = new RPCHandler(routes);

    executionLog.length = 0;
    const r1 = await handler.handle(makeRPCRequest('getProfile'));
    expect(r1.status).toBe(200);
    expect(executionLog).toEqual(['auth', 'getProfile']);

    executionLog.length = 0;
    const r2 = await handler.handle(makeRPCRequest('getSettings'));
    expect(r2.status).toBe(200);
    expect(executionLog).toEqual(['auth', 'getSettings']);
  });

  it('should support middleware that transforms results (post-processing)', async () => {
    const cacheMiddleware: MiddlewareFunction = async ({ ctx, next }) => {
      const result = await next();
      // Wrap result with cache metadata
      return { data: result, cached: false, timestamp: 'test-time' };
    };

    const routes = router({
      getData: procedure
        .use(cacheMiddleware)
        .query(() => ({ value: 42 })),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('getData'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toEqual({
      data: { value: 42 },
      cached: false,
      timestamp: 'test-time',
    });
  });
});

// ─── 3. Error Propagation ───

describe('Integration: Error Propagation', () => {
  it('should propagate handler errors with correct status and code', async () => {
    const routes = router({
      fail: procedure.query(() => {
        const err = new Error('Database connection lost') as Error & { code: string; statusCode: number };
        err.code = 'DB_ERROR';
        err.statusCode = 503;
        throw err;
      }),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('fail'));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe('DB_ERROR');
    expect(body.error.message).toBe('Database connection lost');
  });

  it('should propagate errors from middleware', async () => {
    const failingMiddleware: MiddlewareFunction = async () => {
      throw Object.assign(new Error('Auth token expired'), {
        code: 'TOKEN_EXPIRED',
        statusCode: 401,
      });
    };

    const routes = router({
      protected: procedure
        .use(failingMiddleware)
        .query(() => ({ should: 'not reach' })),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('protected'));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('TOKEN_EXPIRED');
    expect(body.error.message).toBe('Auth token expired');
  });

  it('should return 400 for invalid JSON POST body', async () => {
    const routes = router({
      create: procedure.mutation(({ input }) => input),
    });

    const handler = new RPCHandler(routes);
    const request = new Request('http://localhost/_rpc/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json!!!',
    });

    const response = await handler.handle(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('PARSE_ERROR');
  });

  it('should return input validation errors with detailed issues', async () => {
    const schema = createMockSchema({
      failValidation: true,
      issues: [
        { message: 'Required field missing', path: ['email'] },
        { message: 'Must be at least 3 characters', path: ['name'] },
      ],
    });

    const routes = router({
      create: procedure
        .input(schema)
        .mutation(({ input }) => input),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(
      makeRPCRequest('create', { method: 'POST', body: { name: 'ab' } }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.issues).toHaveLength(2);
    expect(body.error.issues[0].path).toEqual(['email']);
    expect(body.error.issues[1].path).toEqual(['name']);
  });

  it('should return 500 for output validation failure', async () => {
    const outputSchema = createMockSchema({ failValidation: true });

    const routes = router({
      badOutput: procedure
        .output(outputSchema)
        .query(() => ({ invalid: true })),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('badOutput'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe('OUTPUT_VALIDATION_ERROR');
  });

  it('should return 405 for GET request to mutation', async () => {
    const routes = router({
      mutate: procedure.mutation(() => 'ok'),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('mutate', { method: 'GET' }));
    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('should return 404 for unknown procedure path', async () => {
    const routes = router({
      exists: procedure.query(() => 'ok'),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('does.not.exist'));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('does.not.exist');
  });
});

// ─── 4. Wire Protocol Roundtrip ───

describe('Integration: Wire Protocol Roundtrip', () => {
  it('should roundtrip Date objects through the wire protocol', async () => {
    const testDate = new Date('2025-06-15T12:00:00.000Z');

    const routes = router({
      echoDate: procedure.query(() => ({
        createdAt: testDate,
        updatedAt: testDate,
      })),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('echoDate'));
    expect(response.status).toBe(200);
    const body = await response.json();

    // The response uses wire encoding - decode it
    const decoded = decode(body.result) as any;
    expect(decoded.createdAt).toBeInstanceOf(Date);
    expect(decoded.createdAt.toISOString()).toBe('2025-06-15T12:00:00.000Z');
  });

  it('should roundtrip BigInt values through the wire protocol', async () => {
    const routes = router({
      echoBigInt: procedure.query(() => ({
        // BigInt literals can't be in JSON, so encode manually
        value: BigInt('9007199254740993'),
      })),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('echoBigInt'));
    expect(response.status).toBe(200);
    const body = await response.json();
    const decoded = decode(body.result) as any;
    expect(decoded.value).toBe(BigInt('9007199254740993'));
  });

  it('should roundtrip complex nested objects with special types', () => {
    const original = {
      name: 'test',
      count: 42,
      active: true,
      nested: {
        date: new Date('2024-01-01'),
        bigNum: BigInt('123456789012345678'),
        items: [1, 'two', new Date('2024-06-15')],
      },
      tags: new Set(['a', 'b', 'c']),
      metadata: new Map([
        ['key1', 'value1'],
        ['key2', new Date('2024-03-01')],
      ]),
      pattern: /hello\s+world/gi,
    };

    const encoded = encode(original);
    const decoded = decode(encoded) as typeof original;

    expect(decoded.name).toBe('test');
    expect(decoded.count).toBe(42);
    expect(decoded.active).toBe(true);
    expect(decoded.nested.date).toBeInstanceOf(Date);
    expect(decoded.nested.date.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(decoded.nested.bigNum).toBe(BigInt('123456789012345678'));
    expect(decoded.nested.items[0]).toBe(1);
    expect(decoded.nested.items[1]).toBe('two');
    expect(decoded.nested.items[2]).toBeInstanceOf(Date);
    expect(decoded.tags).toBeInstanceOf(Set);
    expect([...decoded.tags]).toEqual(['a', 'b', 'c']);
    expect(decoded.metadata).toBeInstanceOf(Map);
    expect(decoded.metadata.get('key1')).toBe('value1');
    expect(decoded.metadata.get('key2')).toBeInstanceOf(Date);
    expect(decoded.pattern).toBeInstanceOf(RegExp);
    expect(decoded.pattern.source).toBe('hello\\s+world');
    expect(decoded.pattern.flags).toBe('gi');
  });

  it('should roundtrip undefined values', () => {
    const encoded = encode(undefined);
    const decoded = decode(encoded);
    expect(decoded).toBeUndefined();
  });

  it('should roundtrip null values', () => {
    const encoded = encode(null);
    const decoded = decode(encoded);
    expect(decoded).toBeNull();
  });

  it('should roundtrip arrays with mixed types', () => {
    const original = [1, 'hello', null, true, new Date('2024-01-01'), BigInt(42)];
    const encoded = encode(original);
    const decoded = decode(encoded) as typeof original;

    expect(decoded[0]).toBe(1);
    expect(decoded[1]).toBe('hello');
    expect(decoded[2]).toBeNull();
    expect(decoded[3]).toBe(true);
    expect(decoded[4]).toBeInstanceOf(Date);
    expect(decoded[5]).toBe(BigInt(42));
  });

  it('should send wire-encoded input and receive decoded output end-to-end', async () => {
    const routes = router({
      echo: procedure.query(({ input }) => {
        return { received: input };
      }),
    });

    const handler = new RPCHandler(routes);

    const inputData = {
      name: 'test',
      createdAt: new Date('2025-01-01'),
    };

    const response = await handler.handle(
      makeRPCRequest('echo', {
        searchParams: {
          input: JSON.stringify(encode(inputData)),
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const decoded = decode(body.result) as any;
    const receivedInput = decoded.received;

    expect(receivedInput.name).toBe('test');
    // The input was decoded, so the Date should have been restored
    expect(receivedInput.createdAt).toBeInstanceOf(Date);
    expect(receivedInput.createdAt.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });
});

// ─── 5. OpenAPI Spec Generation ───

describe('Integration: OpenAPI Spec Generation', () => {
  it('should generate a valid OpenAPI 3.1 spec for mixed queries and mutations', async () => {
    const userInputSchema = createMockSchema({
      jsonSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
        required: ['name', 'email'],
      },
    });

    const userOutputSchema = createMockSchema({
      jsonSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
        },
      },
    });

    const routes = router({
      user: {
        getById: procedure
          .input(createMockSchema({ jsonSchema: { type: 'object', properties: { id: { type: 'string' } } } }))
          .output(userOutputSchema)
          .query(({ input }) => input),
        create: procedure
          .input(userInputSchema)
          .output(userOutputSchema)
          .mutation(({ input }) => input),
        list: procedure
          .output(createMockSchema({ jsonSchema: { type: 'array', items: { type: 'object' } } }))
          .query(() => []),
      },
      health: procedure.query(() => 'ok'),
    });

    const handler = new RPCHandler(routes);
    const spec = handler.generateOpenAPI({
      title: 'User API',
      version: '2.0.0',
      description: 'User management API',
    });

    // Validate structure
    expect(spec.openapi).toBe('3.1.0');
    expect((spec.info as any).title).toBe('User API');
    expect((spec.info as any).version).toBe('2.0.0');
    expect((spec.info as any).description).toBe('User management API');

    const paths = spec.paths as Record<string, Record<string, any>>;

    // Query routes should be GET
    expect(paths['/_rpc/user.getById']).toBeDefined();
    expect(paths['/_rpc/user.getById'].get).toBeDefined();
    expect(paths['/_rpc/user.getById'].get.operationId).toBe('user.getById');
    expect(paths['/_rpc/user.getById'].get.tags).toEqual(['user']);

    // Mutation routes should be POST
    expect(paths['/_rpc/user.create']).toBeDefined();
    expect(paths['/_rpc/user.create'].post).toBeDefined();
    expect(paths['/_rpc/user.create'].post.requestBody).toBeDefined();
    expect(paths['/_rpc/user.create'].post.requestBody.content['application/json'].schema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
      },
      required: ['name', 'email'],
    });

    // Output schema in 200 response
    expect(paths['/_rpc/user.getById'].get.responses['200'].content['application/json'].schema).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
      },
    });

    // Health endpoint (no schemas)
    expect(paths['/_rpc/health']).toBeDefined();
    expect(paths['/_rpc/health'].get).toBeDefined();
    expect(paths['/_rpc/health'].get.parameters).toBeUndefined();
    expect(paths['/_rpc/health'].get.responses['200'].description).toBe('Successful response');
  });

  it('should serve the OpenAPI spec via /_rpc/openapi.json endpoint', async () => {
    const routes = router({
      test: procedure.query(() => 'ok'),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('openapi.json'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');

    const spec = await response.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths).toBeDefined();
  });

  it('should serve the manifest via /_rpc/manifest.json endpoint', async () => {
    const routes = router({
      user: {
        list: procedure.query(() => []),
        create: procedure.mutation(({ input }) => input),
      },
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('manifest.json'));
    expect(response.status).toBe(200);

    const manifest = await response.json();
    expect(manifest.procedures).toBeDefined();
    expect(manifest.procedures['user.list']).toBeDefined();
    expect(manifest.procedures['user.list'].type).toBe('query');
    expect(manifest.procedures['user.create']).toBeDefined();
    expect(manifest.procedures['user.create'].type).toBe('mutation');
  });
});

// ─── 6. Concurrent RPC Requests ───

describe('Integration: Concurrent RPC Requests', () => {
  it('should handle many concurrent procedure calls without interference', async () => {
    const routes = router({
      echo: procedure.query(({ input }) => ({
        received: input,
      })),
    });

    const handler = new RPCHandler(routes);

    const promises = Array.from({ length: 50 }, (_, i) =>
      handler
        .handle(
          makeRPCRequest('echo', {
            searchParams: { input: JSON.stringify(encode({ index: i })) },
          }),
        )
        .then(async (r) => {
          const body = await r.json();
          return decode(body.result) as any;
        }),
    );

    const results = await Promise.all(promises);

    for (let i = 0; i < 50; i++) {
      expect(results[i].received.index).toBe(i);
    }
  });
});

// ─── 7. Edge Cases ───

describe('Integration: Edge Cases', () => {
  it('should handle empty string input for query', async () => {
    const routes = router({
      echo: procedure.query(({ input }) => ({ value: input })),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(
      makeRPCRequest('echo', {
        searchParams: { input: JSON.stringify('') },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.value).toBe('');
  });

  it('should handle async handlers that return undefined', async () => {
    const routes = router({
      noReturn: procedure.query(async () => {
        // intentionally returns nothing
      }),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('noReturn'));
    expect(response.status).toBe(200);
    const body = await response.json();
    // undefined is encoded as tagged value
    expect(body.result).toEqual({ __t: 'Undefined', v: '' });
  });

  it('should handle handler returning null', async () => {
    const routes = router({
      nullResult: procedure.query(() => null),
    });

    const handler = new RPCHandler(routes);
    const response = await handler.handle(makeRPCRequest('nullResult'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBeNull();
  });

  it('should handle POST mutation with no body (no content-type)', async () => {
    const routes = router({
      noBody: procedure.mutation(() => ({ ok: true })),
    });

    const handler = new RPCHandler(routes);
    // POST with no body or content-type header
    const request = new Request('http://localhost/_rpc/noBody', {
      method: 'POST',
    });

    const response = await handler.handle(request);
    // This will fail to parse body since there's no content-type
    // and request.json() will throw
    expect(response.status).toBe(400);
  });

  it('should allow query to be called via POST (mutation-only restriction)', async () => {
    const routes = router({
      flexQuery: procedure.query(() => ({ ok: true })),
    });

    const handler = new RPCHandler(routes);
    // POST to a query - should work (no method restriction on queries)
    const response = await handler.handle(
      makeRPCRequest('flexQuery', {
        method: 'POST',
        body: {},
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toEqual({ ok: true });
  });
});
