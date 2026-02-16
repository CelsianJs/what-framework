import { describe, it, expect, vi } from 'vitest';
import { router, RPCHandler } from '../src/router.js';
import { procedure, createProcedure } from '../src/procedure.js';
import type { MiddlewareFunction, RPCManifest } from '../src/types.js';

// Mock schema that conforms to StandardSchema via fromSchema auto-detection (Zod-like).
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

// Helper to create a Request for testing
function makeRequest(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    searchParams?: Record<string, string>;
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
    init.headers = { 'content-type': 'application/json' };
  }

  return new Request(url.toString(), init);
}

describe('router()', () => {
  it('returns the same object passed to it', () => {
    const routes = {
      getUser: procedure.query(() => ({ id: '1', name: 'Alice' })),
    };

    const result = router(routes);
    expect(result).toBe(routes);
  });
});

describe('RPCHandler', () => {
  describe('flattenRoutes produces correct dot-separated paths', () => {
    it('flattens nested routes into dot-separated keys', () => {
      const routes = router({
        user: {
          getById: procedure.query(({ input }) => ({ id: input })),
          create: procedure.mutation(({ input }) => input),
        },
        post: {
          list: procedure.query(() => []),
        },
      });

      const handler = new RPCHandler(routes);
      const routeMap = handler.getRoutes();

      expect(routeMap.has('user.getById')).toBe(true);
      expect(routeMap.has('user.create')).toBe(true);
      expect(routeMap.has('post.list')).toBe(true);
      expect(routeMap.size).toBe(3);
    });

    it('handles top-level procedures without prefix', () => {
      const routes = router({
        health: procedure.query(() => ({ status: 'ok' })),
      });

      const handler = new RPCHandler(routes);
      const routeMap = handler.getRoutes();

      expect(routeMap.has('health')).toBe(true);
      expect(routeMap.size).toBe(1);
    });

    it('handles deeply nested routes', () => {
      const routes = router({
        api: {
          v1: {
            user: {
              list: procedure.query(() => []),
            },
          },
        },
      });

      const handler = new RPCHandler(routes);
      const routeMap = handler.getRoutes();

      expect(routeMap.has('api.v1.user.list')).toBe(true);
    });
  });

  describe('handle() — query GET request', () => {
    it('returns result for a simple query with no input', async () => {
      const routes = router({
        health: procedure.query(() => ({ status: 'ok' })),
      });
      const handler = new RPCHandler(routes);

      const request = makeRequest('health');
      const response = await handler.handle(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.result).toEqual({ status: 'ok' });
    });

    it('returns result for a query with JSON-encoded input via search params', async () => {
      const inputSchema = createMockSchema();
      const routes = router({
        user: {
          getById: procedure
            .input(inputSchema)
            .query(({ input }: { input: { id: string } }) => ({
              id: (input as any).id,
              name: 'Alice',
            })),
        },
      });
      const handler = new RPCHandler(routes);

      const request = makeRequest('user.getById', {
        searchParams: { input: JSON.stringify({ id: '42' }) },
      });
      const response = await handler.handle(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.result).toEqual({ id: '42', name: 'Alice' });
    });
  });

  describe('handle() — mutation POST request', () => {
    it('returns result for a mutation with POST body', async () => {
      const inputSchema = createMockSchema();
      const routes = router({
        user: {
          create: procedure
            .input(inputSchema)
            .mutation(({ input }: { input: { name: string } }) => ({
              id: 'new-1',
              name: (input as any).name,
            })),
        },
      });
      const handler = new RPCHandler(routes);

      const request = makeRequest('user.create', {
        method: 'POST',
        body: { name: 'Bob' },
      });
      const response = await handler.handle(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.result).toEqual({ id: 'new-1', name: 'Bob' });
    });
  });

  describe('handle() — 404 for unknown procedure', () => {
    it('returns 404 NOT_FOUND for non-existent procedure', async () => {
      const routes = router({
        health: procedure.query(() => 'ok'),
      });
      const handler = new RPCHandler(routes);

      const request = makeRequest('nonexistent.procedure');
      const response = await handler.handle(request);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('nonexistent.procedure');
    });
  });

  describe('handle() — 405 for GET on mutation', () => {
    it('returns 405 METHOD_NOT_ALLOWED when GET is used on a mutation', async () => {
      const routes = router({
        user: {
          create: procedure.mutation(({ input }) => input),
        },
      });
      const handler = new RPCHandler(routes);

      const request = makeRequest('user.create', { method: 'GET' });
      const response = await handler.handle(request);

      expect(response.status).toBe(405);
      const body = await response.json();
      expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
      expect(body.error.message).toContain('POST');
    });
  });

  describe('handle() — validation error on invalid input', () => {
    it('returns 400 VALIDATION_ERROR when input fails schema validation', async () => {
      const inputSchema = createMockSchema({
        failValidation: true,
        issues: [{ message: 'Expected string, received number', path: ['name'] }],
      });

      const routes = router({
        user: {
          create: procedure
            .input(inputSchema)
            .mutation(({ input }) => input),
        },
      });
      const handler = new RPCHandler(routes);

      const request = makeRequest('user.create', {
        method: 'POST',
        body: { name: 123 },
      });
      const response = await handler.handle(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Input validation failed');
      expect(body.error.issues).toBeDefined();
      expect(body.error.issues).toHaveLength(1);
      expect(body.error.issues[0].message).toBe('Expected string, received number');
      expect(body.error.issues[0].path).toEqual(['name']);
    });
  });

  describe('handle() — middleware executes in order', () => {
    it('runs middleware in sequence before the handler', async () => {
      const executionOrder: string[] = [];

      const mw1: MiddlewareFunction = async ({ ctx, next }) => {
        executionOrder.push('mw1-before');
        ctx.step1 = true;
        const result = await next();
        executionOrder.push('mw1-after');
        return result;
      };

      const mw2: MiddlewareFunction = async ({ ctx, next }) => {
        executionOrder.push('mw2-before');
        ctx.step2 = true;
        const result = await next();
        executionOrder.push('mw2-after');
        return result;
      };

      const routes = router({
        test: procedure
          .use(mw1)
          .use(mw2)
          .query(({ ctx }) => {
            executionOrder.push('handler');
            return { step1: ctx.step1, step2: ctx.step2 };
          }),
      });
      const handler = new RPCHandler(routes);

      const request = makeRequest('test');
      const response = await handler.handle(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.result).toEqual({ step1: true, step2: true });
      expect(executionOrder).toEqual([
        'mw1-before',
        'mw2-before',
        'handler',
        'mw2-after',
        'mw1-after',
      ]);
    });

    it('middleware from createProcedure runs before per-procedure middleware', async () => {
      const executionOrder: string[] = [];

      const sharedMw: MiddlewareFunction = async ({ next }) => {
        executionOrder.push('shared');
        return next();
      };

      const localMw: MiddlewareFunction = async ({ next }) => {
        executionOrder.push('local');
        return next();
      };

      const protectedProcedure = createProcedure(sharedMw);

      const routes = router({
        test: protectedProcedure
          .use(localMw)
          .query(() => {
            executionOrder.push('handler');
            return 'ok';
          }),
      });
      const handler = new RPCHandler(routes);

      const request = makeRequest('test');
      await handler.handle(request);

      expect(executionOrder).toEqual(['shared', 'local', 'handler']);
    });
  });

  describe('handle() — context factory', () => {
    it('uses custom context factory to populate ctx', async () => {
      const routes = router({
        whoami: procedure.query(({ ctx }) => ({
          userId: ctx.userId,
        })),
      });

      const handler = new RPCHandler(routes, (request) => ({
        request,
        userId: 'user-from-factory',
      }));

      const request = makeRequest('whoami');
      const response = await handler.handle(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.result).toEqual({ userId: 'user-from-factory' });
    });
  });

  describe('handle() — handler errors', () => {
    it('returns 500 INTERNAL_ERROR when handler throws', async () => {
      const routes = router({
        fail: procedure.query(() => {
          throw new Error('Something went wrong');
        }),
      });
      const handler = new RPCHandler(routes);

      const request = makeRequest('fail');
      const response = await handler.handle(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Something went wrong');
    });

    it('returns custom status code and error code from thrown error', async () => {
      const routes = router({
        forbidden: procedure.query(() => {
          const err = new Error('Not authorized') as Error & {
            code: string;
            statusCode: number;
          };
          err.code = 'FORBIDDEN';
          err.statusCode = 403;
          throw err;
        }),
      });
      const handler = new RPCHandler(routes);

      const request = makeRequest('forbidden');
      const response = await handler.handle(request);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toBe('Not authorized');
    });
  });

  describe('handle() — special routes', () => {
    it('serves openapi.json', async () => {
      const routes = router({
        health: procedure.query(() => 'ok'),
      });
      const handler = new RPCHandler(routes);

      const request = makeRequest('openapi.json');
      const response = await handler.handle(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.openapi).toBe('3.1.0');
    });

    it('serves manifest.json', async () => {
      const routes = router({
        health: procedure.query(() => 'ok'),
      });
      const handler = new RPCHandler(routes);

      const request = makeRequest('manifest.json');
      const response = await handler.handle(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.procedures).toBeDefined();
      expect(body.procedures.health).toBeDefined();
    });
  });

  describe('getManifest()', () => {
    it('returns procedure metadata for all registered routes', () => {
      const inputSchema = createMockSchema({
        jsonSchema: { type: 'object', properties: { name: { type: 'string' } } },
      });
      const outputSchema = createMockSchema({
        jsonSchema: { type: 'object', properties: { id: { type: 'string' } } },
      });

      const routes = router({
        user: {
          getById: procedure
            .input(inputSchema)
            .query(({ input }) => input),
          create: procedure
            .input(inputSchema)
            .output(outputSchema)
            .mutation(({ input }) => input),
        },
      });
      const handler = new RPCHandler(routes);
      const manifest = handler.getManifest();

      expect(manifest.procedures).toBeDefined();

      const getById = manifest.procedures['user.getById'];
      expect(getById).toBeDefined();
      expect(getById.type).toBe('query');
      expect(getById.path).toBe('user.getById');
      expect(getById.inputSchema).toEqual({
        type: 'object',
        properties: { name: { type: 'string' } },
      });

      const create = manifest.procedures['user.create'];
      expect(create).toBeDefined();
      expect(create.type).toBe('mutation');
      expect(create.path).toBe('user.create');
      expect(create.outputSchema).toEqual({
        type: 'object',
        properties: { id: { type: 'string' } },
      });
    });

    it('returns undefined schemas for procedures without validation', () => {
      const routes = router({
        health: procedure.query(() => 'ok'),
      });
      const handler = new RPCHandler(routes);
      const manifest = handler.getManifest();

      expect(manifest.procedures.health.inputSchema).toBeUndefined();
      expect(manifest.procedures.health.outputSchema).toBeUndefined();
    });
  });

  describe('generateOpenAPI()', () => {
    it('returns valid OpenAPI 3.1 structure with default info', () => {
      const routes = router({
        health: procedure.query(() => 'ok'),
      });
      const handler = new RPCHandler(routes);
      const spec = handler.generateOpenAPI();

      expect(spec.openapi).toBe('3.1.0');
      expect((spec.info as any).title).toBe('ThenJS RPC API');
      expect((spec.info as any).version).toBe('1.0.0');
      expect(spec.paths).toBeDefined();
    });

    it('accepts custom info', () => {
      const routes = router({
        health: procedure.query(() => 'ok'),
      });
      const handler = new RPCHandler(routes);
      const spec = handler.generateOpenAPI({
        title: 'My API',
        version: '2.0.0',
        description: 'My awesome API',
      });

      expect((spec.info as any).title).toBe('My API');
      expect((spec.info as any).version).toBe('2.0.0');
      expect((spec.info as any).description).toBe('My awesome API');
    });

    it('creates correct paths for queries (GET) and mutations (POST)', () => {
      const routes = router({
        user: {
          list: procedure.query(() => []),
          create: procedure.mutation(({ input }) => input),
        },
      });
      const handler = new RPCHandler(routes);
      const spec = handler.generateOpenAPI();
      const paths = spec.paths as Record<string, Record<string, any>>;

      expect(paths['/_rpc/user.list']).toBeDefined();
      expect(paths['/_rpc/user.list'].get).toBeDefined();
      expect(paths['/_rpc/user.list'].get.operationId).toBe('user.list');
      expect(paths['/_rpc/user.list'].get.tags).toEqual(['user']);

      expect(paths['/_rpc/user.create']).toBeDefined();
      expect(paths['/_rpc/user.create'].post).toBeDefined();
      expect(paths['/_rpc/user.create'].post.operationId).toBe('user.create');
    });

    it('includes input schema as query parameter for GET and request body for POST', () => {
      const inputSchema = createMockSchema({
        jsonSchema: { type: 'object', properties: { name: { type: 'string' } } },
      });

      const routes = router({
        getUser: procedure.input(inputSchema).query(({ input }) => input),
        createUser: procedure.input(inputSchema).mutation(({ input }) => input),
      });
      const handler = new RPCHandler(routes);
      const spec = handler.generateOpenAPI();
      const paths = spec.paths as Record<string, Record<string, any>>;

      // GET: input as query parameter
      const getOp = paths['/_rpc/getUser'].get;
      expect(getOp.parameters).toBeDefined();
      expect(getOp.parameters[0].name).toBe('input');
      expect(getOp.parameters[0].in).toBe('query');

      // POST: input as request body
      const postOp = paths['/_rpc/createUser'].post;
      expect(postOp.requestBody).toBeDefined();
      expect(postOp.requestBody.content['application/json'].schema).toEqual({
        type: 'object',
        properties: { name: { type: 'string' } },
      });
    });

    it('includes output schema in 200 response when defined', () => {
      const outputSchema = createMockSchema({
        jsonSchema: { type: 'object', properties: { id: { type: 'string' } } },
      });

      const routes = router({
        getUser: procedure.output(outputSchema).query(() => ({ id: '1' })),
      });
      const handler = new RPCHandler(routes);
      const spec = handler.generateOpenAPI();
      const paths = spec.paths as Record<string, Record<string, any>>;

      const response200 = paths['/_rpc/getUser'].get.responses['200'];
      expect(response200.content['application/json'].schema).toEqual({
        type: 'object',
        properties: { id: { type: 'string' } },
      });
    });
  });
});
