import { describe, it, expect, vi } from 'vitest';
import { procedure, createProcedure } from '../src/procedure.js';
import type { ProcedureDefinition, MiddlewareFunction } from '../src/types.js';

// Mock schema conforming to the StandardSchema interface.
// Includes safeParse/parse so that fromSchema auto-detects it as Zod-like,
// plus validate/toJsonSchema for StandardSchema compatibility.
function createMockSchema(options?: {
  failValidation?: boolean;
  issues?: Array<{ message: string; path?: (string | number)[] }>;
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
    toJsonSchema: () => ({ type: 'object' }),
    _input: undefined,
    _output: undefined,
  };
}

describe('procedure builder', () => {
  describe('procedure.input().query()', () => {
    it('creates a valid ProcedureDefinition with type "query"', () => {
      const inputSchema = createMockSchema();
      const handler = vi.fn(({ input }: { input: { name: string } }) => ({
        greeting: `Hello, ${input.name}`,
      }));

      const def = procedure
        .input(inputSchema)
        .query(handler);

      expect(def).toBeDefined();
      expect(def.type).toBe('query');
      expect(def.handler).toBeDefined();
      expect(typeof def.handler).toBe('function');
      expect(def.inputSchema).toBeDefined();
      expect(def.inputSchema!.toJsonSchema()).toEqual({ type: 'object' });
      expect(def.middlewares).toEqual([]);
    });

    it('handler is invocable and returns expected result', async () => {
      const inputSchema = createMockSchema();
      const handler = vi.fn(({ input }: { input: { name: string } }) => ({
        greeting: `Hello, ${input.name}`,
      }));

      const def = procedure
        .input(inputSchema)
        .query(handler);

      const result = await def.handler({
        input: { name: 'Alice' } as any,
        ctx: { request: new Request('http://localhost') },
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(result).toEqual({ greeting: 'Hello, Alice' });
    });
  });

  describe('procedure.input().output().mutation()', () => {
    it('creates a mutation ProcedureDefinition with input and output schemas', () => {
      const inputSchema = createMockSchema();
      const outputSchema = createMockSchema();
      const handler = vi.fn(({ input }: { input: { title: string } }) => ({
        id: '1',
        title: input.title,
      }));

      const def = procedure
        .input(inputSchema)
        .output(outputSchema)
        .mutation(handler);

      expect(def.type).toBe('mutation');
      expect(def.inputSchema).toBeDefined();
      expect(def.outputSchema).toBeDefined();
      expect(def.inputSchema!.toJsonSchema()).toEqual({ type: 'object' });
      expect(def.outputSchema!.toJsonSchema()).toEqual({ type: 'object' });
      expect(def.middlewares).toEqual([]);
    });

    it('handler is invocable and returns expected result', async () => {
      const inputSchema = createMockSchema();
      const outputSchema = createMockSchema();
      const handler = vi.fn(({ input }: { input: { title: string } }) => ({
        id: '1',
        title: input.title,
      }));

      const def = procedure
        .input(inputSchema)
        .output(outputSchema)
        .mutation(handler);

      const result = await def.handler({
        input: { title: 'Test' } as any,
        ctx: { request: new Request('http://localhost') },
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(result).toEqual({ id: '1', title: 'Test' });
    });
  });

  describe('procedure.use(middleware).query()', () => {
    it('includes the middleware in the ProcedureDefinition', () => {
      const middleware: MiddlewareFunction = async ({ ctx, next }) => {
        ctx.userId = 'user-123';
        return next();
      };

      const def = procedure
        .use(middleware)
        .query(({ ctx }) => ({ userId: ctx.userId }));

      expect(def.type).toBe('query');
      expect(def.middlewares).toHaveLength(1);
      expect(def.middlewares[0]).toBe(middleware);
    });

    it('supports chaining multiple .use() calls', () => {
      const mw1: MiddlewareFunction = async ({ ctx, next }) => {
        ctx.step1 = true;
        return next();
      };
      const mw2: MiddlewareFunction = async ({ ctx, next }) => {
        ctx.step2 = true;
        return next();
      };

      const def = procedure
        .use(mw1)
        .use(mw2)
        .query(({ ctx }) => ({ step1: ctx.step1, step2: ctx.step2 }));

      expect(def.middlewares).toHaveLength(2);
      expect(def.middlewares[0]).toBe(mw1);
      expect(def.middlewares[1]).toBe(mw2);
    });

    it('preserves schemas when adding middleware', () => {
      const inputSchema = createMockSchema();
      const middleware: MiddlewareFunction = async ({ next }) => next();

      const def = procedure
        .input(inputSchema)
        .use(middleware)
        .query(({ input }) => input);

      expect(def.inputSchema).toBeDefined();
      expect(def.middlewares).toHaveLength(1);
    });
  });

  describe('createProcedure(mw1, mw2)', () => {
    it('creates a builder with shared middleware', () => {
      const authMiddleware: MiddlewareFunction = async ({ ctx, next }) => {
        ctx.authenticated = true;
        return next();
      };
      const logMiddleware: MiddlewareFunction = async ({ ctx, next }) => {
        ctx.logged = true;
        return next();
      };

      const protectedProcedure = createProcedure(authMiddleware, logMiddleware);

      const def = protectedProcedure.query(({ ctx }) => ({
        authenticated: ctx.authenticated,
        logged: ctx.logged,
      }));

      expect(def.type).toBe('query');
      expect(def.middlewares).toHaveLength(2);
      expect(def.middlewares[0]).toBe(authMiddleware);
      expect(def.middlewares[1]).toBe(logMiddleware);
    });

    it('additional .use() appends after shared middleware', () => {
      const shared: MiddlewareFunction = async ({ next }) => next();
      const extra: MiddlewareFunction = async ({ next }) => next();

      const builder = createProcedure(shared);
      const def = builder.use(extra).query(() => 'ok');

      expect(def.middlewares).toHaveLength(2);
      expect(def.middlewares[0]).toBe(shared);
      expect(def.middlewares[1]).toBe(extra);
    });

    it('does not share state between definitions from the same builder', () => {
      const shared: MiddlewareFunction = async ({ next }) => next();
      const builder = createProcedure(shared);

      const extra: MiddlewareFunction = async ({ next }) => next();

      const def1 = builder.query(() => 'first');
      const def2 = builder.use(extra).mutation(() => 'second');

      // def1 should only have the shared middleware
      expect(def1.middlewares).toHaveLength(1);
      // def2 should have shared + extra
      expect(def2.middlewares).toHaveLength(2);
    });
  });

  describe('builder immutability', () => {
    it('input() returns a new builder, leaving the original unchanged', () => {
      const schema = createMockSchema();
      const def1 = procedure.query(() => 'no-input');
      const def2 = procedure.input(schema).query(() => 'with-input');

      expect(def1.inputSchema).toBeUndefined();
      expect(def2.inputSchema).toBeDefined();
    });

    it('use() returns a new builder, leaving the original unchanged', () => {
      const mw: MiddlewareFunction = async ({ next }) => next();
      const def1 = procedure.query(() => 'no-mw');
      const def2 = procedure.use(mw).query(() => 'with-mw');

      expect(def1.middlewares).toHaveLength(0);
      expect(def2.middlewares).toHaveLength(1);
    });
  });
});
