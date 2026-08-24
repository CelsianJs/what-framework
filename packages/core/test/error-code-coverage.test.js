// The error-code catalogue is the framework's only lookup table for what a
// failure means and how to fix it, and the audience reading it is usually an
// agent rather than a person. Two things have to hold for that to be worth
// anything:
//
//   1. every failure the framework raises carries a code
//   2. every code resolves to a suggestion and a worked example
//
// Before this, only what-core's own dev warnings had codes. Every other
// package threw bare Errors with good prose and nothing machine-readable, so
// a caller could not branch on the failure and what_errors could not describe
// it. The codes now live at the throw sites; the prose lives here, once,
// because importing the catalogue into the client-shipped action surface cost
// 6 KB gzipped (see the comment in errors.js).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ERROR_CODES,
  getErrorDefinition,
  classifyError,
  createWhatError,
} from '../src/index.js';

describe('error code catalogue', () => {
  it('gives every entry a code, severity, template and suggestion', () => {
    for (const [key, def] of Object.entries(ERROR_CODES)) {
      assert.match(def.code, /^ERR_[A-Z0-9_]+$/, `${key}.code`);
      assert.ok(['error', 'warning'].includes(def.severity), `${key}.severity`);
      assert.ok(def.template?.length > 0, `${key}.template`);
      assert.ok(def.suggestion?.length > 20, `${key}.suggestion is too thin`);
    }
  });

  it('keeps codes unique', () => {
    const codes = Object.values(ERROR_CODES).map((d) => d.code);
    assert.equal(new Set(codes).size, codes.length);
  });

  it('indexes every entry by its code', () => {
    for (const def of Object.values(ERROR_CODES)) {
      assert.equal(getErrorDefinition(def.code), def);
    }
  });

  it('returns undefined for a code it does not know', () => {
    assert.equal(getErrorDefinition('ERR_NOT_A_REAL_CODE'), undefined);
  });
});

describe('classifyError resolves a thrown code', () => {
  it('recovers the suggestion and example for a code-only throw', () => {
    // Exactly the shape what-isr throws: it never imports what-core, so all it
    // can carry is the code.
    const raw = Object.assign(
      new Error('[what-isr] createRedisStore requires { client }'),
      { code: 'ERR_ISR_MISSING_CLIENT' },
    );
    const classified = classifyError(raw);
    assert.equal(classified.code, 'ERR_ISR_MISSING_CLIENT');
    assert.equal(classified.message, raw.message, 'keeps the specific message');
    assert.equal(classified.suggestion, ERROR_CODES.ISR_MISSING_CLIENT.suggestion);
    assert.equal(classified.codeExample, ERROR_CODES.ISR_MISSING_CLIENT.codeExample);
  });

  it('carries context through', () => {
    const raw = Object.assign(new Error('bad tag'), { code: 'ERR_INVALID_SSR_TAG' });
    const classified = classifyError(raw, { component: 'ProductRow', line: 12 });
    assert.equal(classified.component, 'ProductRow');
    assert.equal(classified.line, 12);
  });

  it('falls through to message sniffing for an unknown code', () => {
    const raw = Object.assign(new Error('hydration mismatch at <li>'), { code: 'ENOENT' });
    assert.equal(classifyError(raw).code, 'ERR_HYDRATION_MISMATCH');
  });

  it('still returns ERR_RUNTIME for an error with no code and no pattern', () => {
    assert.equal(classifyError(new Error('something else entirely')).code, 'ERR_RUNTIME');
  });
});

describe('the errors packages actually throw', () => {
  // Each of these is raised by a package that cannot import the catalogue, so
  // the pairing of throw site to entry is only enforced by
  // scripts/check-error-codes.mjs and by this list.
  const RAISED_OUTSIDE_CORE = [
    'ERR_NO_SECURE_RANDOM',
    'ERR_ACTION_FAILED',
    'ERR_STATIC_WRITE_ESCAPE',
    'ERR_INVALID_SSR_TAG',
    'ERR_FORM_ACTION_NOT_REGISTERED',
    'ERR_FORM_ACTION_MISSING',
    'ERR_ISLAND_STORE_OUTSIDE_RENDER',
    'ERR_ISR_MISSING_CLIENT',
    'ERR_ISR_VARY_UNRESOLVED',
    'ERR_ISR_VARY_NO_HEADERS',
    'ERR_DUPLICATE_ACTION_ID',
    'ERR_PAGE_NO_DEFAULT_EXPORT',
    'ERR_HOOK_OUTSIDE_RENDER',
    'ERR_CHILDREN_ONLY',
    'ERR_USE_INVALID_ARG',
    'ERR_PRETEXT_NOT_INSTALLED',
    'ERR_UNKNOWN_TOOL',
    'ERR_DESTRUCTURED_PROPS',
  ];

  for (const code of RAISED_OUTSIDE_CORE) {
    it(`${code} resolves to a suggestion`, () => {
      const def = getErrorDefinition(code);
      assert.ok(def, `${code} is thrown somewhere but not catalogued`);
      assert.ok(def.suggestion.length > 20);
    });
  }
});

describe('createWhatError', () => {
  it('interpolates context into the template', () => {
    const err = createWhatError('ISLAND_STORE_OUTSIDE_RENDER', { name: 'cart' });
    assert.match(err.message, /Island store "cart"/);
  });

  it('falls back to ERR_UNKNOWN for a key that is not in the catalogue', () => {
    assert.equal(createWhatError('NOT_A_KEY').code, 'ERR_UNKNOWN');
  });
});
