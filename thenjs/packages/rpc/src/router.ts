// @thenjs/rpc — Router + handler execution

import type {
  ProcedureDefinition,
  RouterDefinition,
  RPCContext,
  RPCRequest,
  RPCResponse,
  RPCManifest,
  ContextFactory,
} from './types.js';
import { encode, decode } from './wire.js';

// ─── Router ───

export function router<T extends RouterDefinition>(routes: T): T {
  return routes;
}

// ─── Handler ───

export class RPCHandler {
  private flatRoutes = new Map<string, ProcedureDefinition>();
  private contextFactory: ContextFactory;

  constructor(
    routes: RouterDefinition,
    contextFactory?: ContextFactory,
  ) {
    this.contextFactory = contextFactory ?? ((request) => ({ request }));
    this.flattenRoutes(routes, '');
  }

  private flattenRoutes(routes: RouterDefinition, prefix: string): void {
    for (const [key, value] of Object.entries(routes)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (this.isProcedure(value)) {
        this.flatRoutes.set(path, value as ProcedureDefinition);
      } else {
        this.flattenRoutes(value as RouterDefinition, path);
      }
    }
  }

  private isProcedure(value: unknown): value is ProcedureDefinition {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      'handler' in value &&
      ((value as ProcedureDefinition).type === 'query' || (value as ProcedureDefinition).type === 'mutation')
    );
  }

  /** Handle a Web Standard Request for an RPC call */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Extract procedure path from URL: /_rpc/user.getById
    const rpcPath = url.pathname.replace(/^\/_rpc\//, '');

    if (rpcPath === 'openapi.json') {
      return new Response(JSON.stringify(this.generateOpenAPI()), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (rpcPath === 'manifest.json') {
      return new Response(JSON.stringify(this.getManifest()), {
        headers: { 'content-type': 'application/json' },
      });
    }

    const proc = this.flatRoutes.get(rpcPath);
    if (!proc) {
      return this.errorResponse(404, 'NOT_FOUND', `Procedure "${rpcPath}" not found`);
    }

    // Method check
    if (proc.type === 'mutation' && request.method !== 'POST') {
      return this.errorResponse(405, 'METHOD_NOT_ALLOWED', 'Mutations require POST');
    }

    // Parse input
    let rawInput: unknown;
    if (request.method === 'GET') {
      const inputParam = url.searchParams.get('input');
      if (inputParam) {
        try {
          rawInput = decode(JSON.parse(inputParam));
        } catch {
          return this.errorResponse(400, 'PARSE_ERROR', 'Invalid input parameter');
        }
      }
    } else {
      const contentType = request.headers.get('content-type') ?? '';
      if (contentType.includes('multipart/form-data')) {
        rawInput = await request.formData();
      } else {
        try {
          const body = await request.json();
          rawInput = decode(body);
        } catch {
          return this.errorResponse(400, 'PARSE_ERROR', 'Invalid JSON body');
        }
      }
    }

    // Validate input
    if (proc.inputSchema) {
      const result = proc.inputSchema.validate(rawInput);
      if (!result.success) {
        return this.errorResponse(400, 'VALIDATION_ERROR', 'Input validation failed', result.issues);
      }
      rawInput = result.data;
    }

    // Build context
    const ctx = await this.contextFactory(request);

    // Run middleware chain + handler
    try {
      const output = await this.runProcedure(proc, rawInput, ctx);

      // Validate output
      if (proc.outputSchema) {
        const result = proc.outputSchema.validate(output);
        if (!result.success) {
          return this.errorResponse(500, 'OUTPUT_VALIDATION_ERROR', 'Output validation failed');
        }
      }

      const response: RPCResponse = { result: encode(output) };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      const code = (error as { code?: string }).code ?? 'INTERNAL_ERROR';
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      return this.errorResponse(status, code, message);
    }
  }

  private async runProcedure(
    proc: ProcedureDefinition,
    input: unknown,
    ctx: RPCContext,
  ): Promise<unknown> {
    // Build middleware chain
    const middlewares = proc.middlewares;
    let index = 0;

    const next = async (): Promise<unknown> => {
      if (index < middlewares.length) {
        const mw = middlewares[index++]!;
        return mw({ ctx, next });
      }
      // All middleware done — run handler
      return proc.handler({ input, ctx });
    };

    return next();
  }

  private errorResponse(
    status: number,
    code: string,
    message: string,
    issues?: Array<{ message: string; path?: (string | number)[] }>,
  ): Response {
    const response: RPCResponse = {
      error: { message, code, issues },
    };
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  /** Generate manifest of all procedures */
  getManifest(): RPCManifest {
    const procedures: RPCManifest['procedures'] = {};
    for (const [path, proc] of this.flatRoutes) {
      procedures[path] = {
        type: proc.type,
        path,
        inputSchema: proc.inputSchema?.toJsonSchema(),
        outputSchema: proc.outputSchema?.toJsonSchema(),
      };
    }
    return { procedures };
  }

  /** Generate OpenAPI 3.1 spec */
  generateOpenAPI(info?: { title?: string; version?: string; description?: string }): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};

    for (const [path, proc] of this.flatRoutes) {
      const urlPath = `/_rpc/${path}`;
      const method = proc.type === 'query' ? 'get' : 'post';

      const operation: Record<string, unknown> = {
        operationId: path,
        tags: [path.split('.')[0]],
        summary: path,
      };

      if (proc.inputSchema) {
        const schema = proc.inputSchema.toJsonSchema();
        if (method === 'get') {
          operation.parameters = [{
            name: 'input',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'JSON-encoded input',
          }];
        } else {
          operation.requestBody = {
            required: true,
            content: {
              'application/json': { schema },
            },
          };
        }
      }

      if (proc.outputSchema) {
        operation.responses = {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: proc.outputSchema.toJsonSchema(),
              },
            },
          },
        };
      } else {
        operation.responses = {
          '200': { description: 'Successful response' },
        };
      }

      paths[urlPath] = { [method]: operation };
    }

    return {
      openapi: '3.1.0',
      info: {
        title: info?.title ?? 'ThenJS RPC API',
        version: info?.version ?? '1.0.0',
        description: info?.description,
      },
      paths,
    };
  }

  /** Get flat route map (for client generation) */
  getRoutes(): Map<string, ProcedureDefinition> {
    return this.flatRoutes;
  }
}
