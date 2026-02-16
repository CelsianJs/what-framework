import { describe, it, expect } from 'vitest';
import { fromZod, fromTypeBox, fromValibot, fromSchema } from '../src/index.js';

// ─────────────────────────────────────────────
// Mock Factories
// ─────────────────────────────────────────────

/**
 * Creates a mock Zod-like schema object with `safeParse` and `parse`.
 * The validator function should return true for valid input.
 */
function createZodMock(
  validator: (input: unknown) => boolean,
  opts?: { toJsonSchema?: () => Record<string, unknown> },
) {
  return {
    safeParse(input: unknown) {
      if (validator(input)) {
        return { success: true, data: input };
      }
      return {
        success: false,
        error: {
          issues: [
            {
              message: 'Validation failed',
              path: ['field'],
            },
          ],
        },
      };
    },
    parse(input: unknown) {
      if (validator(input)) return input;
      throw new Error('Validation failed');
    },
    ...(opts?.toJsonSchema ? { toJsonSchema: opts.toJsonSchema } : {}),
  };
}

/**
 * Creates a mock TypeBox-like schema object with `type` and `properties`.
 */
function createTypeBoxMock() {
  return {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'number' },
    },
    required: ['name'],
  };
}

/**
 * Creates a mock Valibot-like schema using `_parse`.
 */
function createValibotParseMock(validator: (input: unknown) => boolean) {
  return {
    _parse(input: unknown) {
      if (validator(input)) {
        return { output: input };
      }
      return {
        success: false,
        issues: [
          {
            message: 'Invalid input',
            path: [{ key: 'field' }],
          },
        ],
      };
    },
  };
}

/**
 * Creates a mock Valibot-like schema using `safeParse` (v1 style).
 */
function createValibotSafeParseMock(validator: (input: unknown) => boolean) {
  return {
    safeParse(input: unknown) {
      if (validator(input)) {
        return { success: true, data: input };
      }
      return {
        success: false,
        issues: [
          {
            message: 'Validation error',
            path: [{ key: 'email' }],
          },
        ],
      };
    },
  };
}

// ─────────────────────────────────────────────
// fromZod
// ─────────────────────────────────────────────

describe('fromZod', () => {
  const isString = (v: unknown) => typeof v === 'string';

  it('returns success with data for valid input', () => {
    const zodMock = createZodMock(isString);
    const schema = fromZod<string>(zodMock);
    const result = schema.validate('hello');

    expect(result.success).toBe(true);
    expect(result.data).toBe('hello');
    expect(result.issues).toBeUndefined();
  });

  it('returns failure with issues for invalid input', () => {
    const zodMock = createZodMock(isString);
    const schema = fromZod<string>(zodMock);
    const result = schema.validate(42);

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.issues).toBeDefined();
    expect(result.issues).toHaveLength(1);
    expect(result.issues![0].message).toBe('Validation failed');
    expect(result.issues![0].path).toEqual(['field']);
  });

  it('maps multiple issues correctly', () => {
    const multiIssueMock = {
      safeParse(_input: unknown) {
        return {
          success: false,
          error: {
            issues: [
              { message: 'Too short', path: ['name'] },
              { message: 'Required', path: ['age'] },
              { message: 'Nested error', path: ['address', 'zip'] },
            ],
          },
        };
      },
      parse() {
        throw new Error('fail');
      },
    };
    const schema = fromZod(multiIssueMock);
    const result = schema.validate({});

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(3);
    expect(result.issues![0]).toEqual({ message: 'Too short', path: ['name'] });
    expect(result.issues![1]).toEqual({ message: 'Required', path: ['age'] });
    expect(result.issues![2]).toEqual({ message: 'Nested error', path: ['address', 'zip'] });
  });

  it('toJsonSchema returns fallback { type: "object" } when schema has no toJsonSchema', () => {
    const zodMock = createZodMock(isString);
    const schema = fromZod(zodMock);

    expect(schema.toJsonSchema()).toEqual({ type: 'object' });
  });

  it('toJsonSchema calls schema.toJsonSchema when available', () => {
    const customJsonSchema = { type: 'string', minLength: 1 };
    const zodMock = createZodMock(isString, {
      toJsonSchema: () => customJsonSchema,
    });
    const schema = fromZod(zodMock);

    expect(schema.toJsonSchema()).toEqual(customJsonSchema);
  });

  it('has phantom _input and _output type properties', () => {
    const zodMock = createZodMock(isString);
    const schema = fromZod<string>(zodMock);

    // These are phantom types; at runtime they are undefined
    expect(schema).toHaveProperty('_input');
    expect(schema).toHaveProperty('_output');
  });
});

// ─────────────────────────────────────────────
// fromTypeBox
// ─────────────────────────────────────────────

describe('fromTypeBox', () => {
  it('toJsonSchema returns the schema object directly (passthrough)', () => {
    const tbMock = createTypeBoxMock();
    const schema = fromTypeBox(tbMock);

    // TypeBox schemas ARE JSON Schema, so toJsonSchema returns the schema itself
    const jsonSchema = schema.toJsonSchema();
    expect(jsonSchema).toBe(tbMock); // exact same reference
    expect(jsonSchema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    });
  });

  it('validate returns failure with issues when @sinclair/typebox/value is not installed', () => {
    // Since we don't have @sinclair/typebox installed, createRequire will throw.
    // The adapter catches this and returns a failure result.
    const tbMock = createTypeBoxMock();
    const schema = fromTypeBox(tbMock);
    const result = schema.validate({ name: 'test' });

    expect(result.success).toBe(false);
    expect(result.issues).toBeDefined();
    expect(result.issues!.length).toBeGreaterThanOrEqual(1);
    // The error message should indicate the module could not be found
    expect(result.issues![0].message).toBeTruthy();
  });

  it('has phantom _input and _output type properties', () => {
    const tbMock = createTypeBoxMock();
    const schema = fromTypeBox(tbMock);

    expect(schema).toHaveProperty('_input');
    expect(schema).toHaveProperty('_output');
  });
});

// ─────────────────────────────────────────────
// fromValibot
// ─────────────────────────────────────────────

describe('fromValibot', () => {
  describe('with _parse method', () => {
    const isNonEmpty = (v: unknown) => typeof v === 'string' && v.length > 0;

    it('returns success with data for valid input', () => {
      const mock = createValibotParseMock(isNonEmpty);
      const schema = fromValibot<string>(mock);
      const result = schema.validate('hello');

      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
      expect(result.issues).toBeUndefined();
    });

    it('returns failure with issues for invalid input', () => {
      const mock = createValibotParseMock(isNonEmpty);
      const schema = fromValibot<string>(mock);
      const result = schema.validate('');

      expect(result.success).toBe(false);
      expect(result.issues).toBeDefined();
      expect(result.issues).toHaveLength(1);
      expect(result.issues![0].message).toBe('Invalid input');
      expect(result.issues![0].path).toEqual(['field']);
    });
  });

  describe('with safeParse method (valibot v1 style)', () => {
    const isEmail = (v: unknown) => typeof v === 'string' && v.includes('@');

    it('returns success with data for valid input', () => {
      const mock = createValibotSafeParseMock(isEmail);
      const schema = fromValibot<string>(mock);
      const result = schema.validate('test@example.com');

      expect(result.success).toBe(true);
      expect(result.data).toBe('test@example.com');
    });

    it('returns failure with issues for invalid input', () => {
      const mock = createValibotSafeParseMock(isEmail);
      const schema = fromValibot<string>(mock);
      const result = schema.validate('not-an-email');

      expect(result.success).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues![0].message).toBe('Validation error');
      expect(result.issues![0].path).toEqual(['email']);
    });
  });

  it('returns failure when schema has neither _parse nor safeParse', () => {
    const emptyMock = {};
    const schema = fromValibot(emptyMock);
    const result = schema.validate('anything');

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues![0].message).toBe('Unknown valibot schema format');
  });

  it('returns failure when _parse throws an error', () => {
    const throwingMock = {
      _parse() {
        throw new Error('Parse exploded');
      },
    };
    const schema = fromValibot(throwingMock);
    const result = schema.validate('anything');

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues![0].message).toBe('Parse exploded');
  });

  it('prefers _parse over safeParse when both are present', () => {
    let parseCalled = false;
    let safeParseCalled = false;
    const mock = {
      _parse(input: unknown) {
        parseCalled = true;
        return { output: input };
      },
      safeParse(input: unknown) {
        safeParseCalled = true;
        return { success: true, data: input };
      },
    };
    const schema = fromValibot(mock);
    schema.validate('test');

    // The implementation uses ??  so _parse is preferred over safeParse
    expect(parseCalled).toBe(true);
    expect(safeParseCalled).toBe(false);
  });

  it('falls back to safeParse when _parse returns nullish', () => {
    let safeParseCalled = false;
    const mock = {
      _parse() {
        return undefined;
      },
      safeParse(input: unknown) {
        safeParseCalled = true;
        return { success: true, data: input };
      },
    };
    const schema = fromValibot(mock);
    schema.validate('test');

    expect(safeParseCalled).toBe(true);
  });

  it('handles issues without a path', () => {
    const mock = {
      _parse() {
        return {
          success: false,
          issues: [{ message: 'Bad value' }],
        };
      },
    };
    const schema = fromValibot(mock);
    const result = schema.validate('x');

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues![0].message).toBe('Bad value');
    expect(result.issues![0].path).toBeUndefined();
  });

  it('toJsonSchema returns fallback { type: "object" }', () => {
    const mock = createValibotParseMock(() => true);
    const schema = fromValibot(mock);

    expect(schema.toJsonSchema()).toEqual({ type: 'object' });
  });
});

// ─────────────────────────────────────────────
// fromSchema (auto-detection)
// ─────────────────────────────────────────────

describe('fromSchema', () => {
  describe('Zod detection (has safeParse + parse)', () => {
    it('detects Zod and delegates to fromZod', () => {
      const zodMock = createZodMock((v) => typeof v === 'number');
      const schema = fromSchema<number>(zodMock);

      const successResult = schema.validate(42);
      expect(successResult.success).toBe(true);
      expect(successResult.data).toBe(42);

      const failResult = schema.validate('not a number');
      expect(failResult.success).toBe(false);
      expect(failResult.issues).toBeDefined();
    });
  });

  describe('TypeBox detection (has type + properties)', () => {
    it('detects TypeBox and delegates to fromTypeBox', () => {
      const tbMock = createTypeBoxMock();
      const schema = fromSchema(tbMock);

      // Should pass through as JSON Schema
      expect(schema.toJsonSchema()).toBe(tbMock);
    });
  });

  describe('Valibot detection (has _parse)', () => {
    it('detects Valibot _parse and delegates to fromValibot', () => {
      const valibotMock = createValibotParseMock((v) => v === 'valid');
      const schema = fromSchema<string>(valibotMock);

      const successResult = schema.validate('valid');
      expect(successResult.success).toBe(true);

      const failResult = schema.validate('invalid');
      expect(failResult.success).toBe(false);
    });
  });

  describe('StandardSchema passthrough', () => {
    it('returns the schema directly when it already has validate + toJsonSchema', () => {
      const standardSchema = {
        validate(input: unknown) {
          return { success: true, data: input as string };
        },
        toJsonSchema() {
          return { type: 'string' };
        },
        _input: undefined as unknown as string,
        _output: undefined as unknown as string,
      };
      const result = fromSchema<string>(standardSchema);

      // Should be the exact same object
      expect(result).toBe(standardSchema);
    });
  });

  describe('unknown schema type', () => {
    it('throws for an empty object', () => {
      expect(() => fromSchema({})).toThrow(
        'Unsupported schema library',
      );
    });

    it('throws for null', () => {
      expect(() => fromSchema(null)).toThrow(
        'Unsupported schema library',
      );
    });

    it('throws for undefined', () => {
      expect(() => fromSchema(undefined)).toThrow(
        'Unsupported schema library',
      );
    });

    it('throws for a plain string', () => {
      expect(() => fromSchema('not a schema')).toThrow(
        'Unsupported schema library',
      );
    });

    it('throws for an object with only safeParse but no parse (not Zod)', () => {
      const almostZod = { safeParse() { return { success: true }; } };
      expect(() => fromSchema(almostZod)).toThrow(
        'Unsupported schema library',
      );
    });

    it('throws for an object with only type but no properties (not TypeBox)', () => {
      const almostTypeBox = { type: 'string' };
      expect(() => fromSchema(almostTypeBox)).toThrow(
        'Unsupported schema library',
      );
    });

    it('throws for an object with only validate but no toJsonSchema (not StandardSchema)', () => {
      const almostStandard = { validate() { return { success: true }; } };
      expect(() => fromSchema(almostStandard)).toThrow(
        'Unsupported schema library',
      );
    });
  });

  describe('detection precedence', () => {
    it('Zod check takes precedence over Valibot when object has safeParse+parse+_parse', () => {
      let zodPath = false;
      const hybrid = {
        safeParse(input: unknown) {
          zodPath = true;
          return { success: true, data: input };
        },
        parse(input: unknown) {
          return input;
        },
        _parse(input: unknown) {
          return { output: input };
        },
      };

      const schema = fromSchema(hybrid);
      schema.validate('test');

      // Zod detection comes first in the code, so safeParse should be called
      expect(zodPath).toBe(true);
    });

    it('TypeBox check takes precedence over Valibot when object has type+properties+_parse', () => {
      const hybrid = {
        type: 'object',
        properties: { x: { type: 'string' } },
        _parse() {
          return { output: 'valibot' };
        },
      };

      const schema = fromSchema(hybrid);
      // TypeBox passthrough means toJsonSchema returns the schema itself
      expect(schema.toJsonSchema()).toBe(hybrid);
    });
  });
});
