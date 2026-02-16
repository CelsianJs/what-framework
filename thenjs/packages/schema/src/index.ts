// @thenjs/schema — Standard Schema adapter
// Normalizes Zod, TypeBox, Valibot, ArkType to a common interface

import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

export interface SchemaResult<T = unknown> {
  success: boolean;
  data?: T;
  issues?: SchemaIssue[];
}

export interface SchemaIssue {
  message: string;
  path?: (string | number)[];
}

export interface StandardSchema<Input = unknown, Output = Input> {
  /** Validate input and return result */
  validate(input: unknown): SchemaResult<Output>;
  /** Get JSON Schema representation (for OpenAPI) */
  toJsonSchema(): Record<string, unknown>;
  /** The TypeScript input type (phantom) */
  _input: Input;
  /** The TypeScript output type (phantom) */
  _output: Output;
}

// ─── Zod Adapter ───

export function fromZod<T>(zodSchema: any): StandardSchema<T, T> {
  return {
    validate(input: unknown): SchemaResult<T> {
      const result = zodSchema.safeParse(input);
      if (result.success) {
        return { success: true, data: result.data };
      }
      return {
        success: false,
        issues: result.error.issues.map((i: any) => ({
          message: i.message,
          path: i.path,
        })),
      };
    },
    toJsonSchema(): Record<string, unknown> {
      // Zod doesn't natively export JSON Schema — users need zod-to-json-schema
      // We provide a minimal fallback
      if (typeof zodSchema.toJsonSchema === 'function') {
        return zodSchema.toJsonSchema();
      }
      return { type: 'object' };
    },
    _input: undefined as unknown as T,
    _output: undefined as unknown as T,
  };
}

// ─── TypeBox Adapter ───

export function fromTypeBox<T>(typeboxSchema: any): StandardSchema<T, T> {
  return {
    validate(input: unknown): SchemaResult<T> {
      // TypeBox uses @sinclair/typebox/value for validation
      try {
        const { Value } = _require('@sinclair/typebox/value');
        const errors = [...Value.Errors(typeboxSchema, input)];
        if (errors.length === 0) {
          return { success: true, data: Value.Cast(typeboxSchema, input) };
        }
        return {
          success: false,
          issues: errors.map((e: any) => ({
            message: e.message,
            path: e.path?.split('/').filter(Boolean),
          })),
        };
      } catch (e: any) {
        return { success: false, issues: [{ message: e.message }] };
      }
    },
    toJsonSchema(): Record<string, unknown> {
      // TypeBox schemas ARE JSON Schema
      return typeboxSchema;
    },
    _input: undefined as unknown as T,
    _output: undefined as unknown as T,
  };
}

// ─── Valibot Adapter ───

export function fromValibot<T>(valibotSchema: any): StandardSchema<T, T> {
  return {
    validate(input: unknown): SchemaResult<T> {
      try {
        // Valibot v1 uses safeParse
        const result = valibotSchema._parse?.(input) ?? valibotSchema.safeParse?.(input);
        if (!result) {
          return { success: false, issues: [{ message: 'Unknown valibot schema format' }] };
        }
        if (result.success !== false && !result.issues) {
          return { success: true, data: result.output ?? result.data };
        }
        return {
          success: false,
          issues: (result.issues || []).map((i: any) => ({
            message: i.message,
            path: i.path?.map((p: any) => p.key),
          })),
        };
      } catch (e: any) {
        return { success: false, issues: [{ message: e.message }] };
      }
    },
    toJsonSchema(): Record<string, unknown> {
      return { type: 'object' };
    },
    _input: undefined as unknown as T,
    _output: undefined as unknown as T,
  };
}

// ─── Auto-detect adapter ───

export function fromSchema<T>(schema: any): StandardSchema<T, T> {
  // Detect schema library by duck-typing
  if (typeof schema?.safeParse === 'function' && typeof schema?.parse === 'function') {
    return fromZod<T>(schema);
  }
  if (schema?.type !== undefined && schema?.properties !== undefined) {
    return fromTypeBox<T>(schema);
  }
  if (typeof schema?._parse === 'function') {
    return fromValibot<T>(schema);
  }
  // Already a StandardSchema
  if (typeof schema?.validate === 'function' && typeof schema?.toJsonSchema === 'function') {
    return schema as StandardSchema<T, T>;
  }
  throw new Error('Unsupported schema library. Use Zod, TypeBox, Valibot, or a StandardSchema-compatible schema.');
}
