# @thenjs/schema

Standard schema adapter for ThenJS. Normalizes Zod, TypeBox, and Valibot schemas to a common `StandardSchema` interface used across the framework for validation and OpenAPI generation.

## Install

```
npm install @thenjs/schema
```

## Usage

```typescript
import { fromZod, fromTypeBox, fromValibot, fromSchema } from '@thenjs/schema';

// --- Zod ---
import { z } from 'zod';
const userSchema = fromZod<{ name: string; email: string }>(
  z.object({ name: z.string(), email: z.string().email() })
);

// --- TypeBox ---
import { Type } from '@sinclair/typebox';
const itemSchema = fromTypeBox<{ id: number; title: string }>(
  Type.Object({ id: Type.Number(), title: Type.String() })
);

// --- Valibot ---
import * as v from 'valibot';
const loginSchema = fromValibot<{ username: string }>(
  v.object({ username: v.string() })
);

// --- Auto-detect ---
// Detects the library by duck-typing and wraps automatically.
const schema = fromSchema<{ name: string }>(zodOrTypeBoxOrValibot);
```

### Validation

Every adapted schema exposes the same `validate` / `toJsonSchema` interface:

```typescript
const result = userSchema.validate({ name: 'Ada', email: 'ada@example.com' });

if (result.success) {
  console.log(result.data); // typed as { name: string; email: string }
} else {
  console.log(result.issues); // SchemaIssue[]
}

// JSON Schema (used by @thenjs/rpc for OpenAPI generation)
const jsonSchema = userSchema.toJsonSchema();
```

## API

| Export | Description |
|---|---|
| `fromZod<T>(schema)` | Wrap a Zod schema |
| `fromTypeBox<T>(schema)` | Wrap a TypeBox schema |
| `fromValibot<T>(schema)` | Wrap a Valibot schema |
| `fromSchema<T>(schema)` | Auto-detect and wrap any supported schema |
| `StandardSchema<I, O>` | The common interface all adapters produce |
| `SchemaResult<T>` | Validation result: `{ success, data?, issues? }` |
| `SchemaIssue` | Validation issue: `{ message, path? }` |

## License

[MIT](../../LICENSE)
