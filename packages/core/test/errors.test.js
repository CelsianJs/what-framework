/**
 * Tests for the structured error system (packages/core/src/errors.js).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  WhatError,
  ERROR_CODES,
  createWhatError,
  classifyError,
  collectError,
  getCollectedErrors,
  clearCollectedErrors,
} from '../src/errors.js';

describe('WhatError', () => {
  it('creates error with all fields', () => {
    const err = new WhatError({
      code: 'ERR_INFINITE_EFFECT',
      message: 'Effect exceeded 25 iterations',
      suggestion: 'Use untrack()',
      file: 'app.js',
      line: 42,
      component: 'Counter',
      signal: 'count',
      effect: 'updateEffect',
    });

    assert.equal(err.code, 'ERR_INFINITE_EFFECT');
    assert.equal(err.message, 'Effect exceeded 25 iterations');
    assert.equal(err.suggestion, 'Use untrack()');
    assert.equal(err.file, 'app.js');
    assert.equal(err.line, 42);
    assert.equal(err.component, 'Counter');
    assert.equal(err.signal, 'count');
    assert.equal(err.effect, 'updateEffect');
    assert.equal(err.name, 'WhatError');
  });

  it('extends Error', () => {
    const err = new WhatError({ code: 'TEST', message: 'test' });
    assert.ok(err instanceof Error);
    assert.ok(err instanceof WhatError);
  });

  it('toJSON returns structured object', () => {
    const err = new WhatError({
      code: 'ERR_MISSING_SIGNAL_READ',
      message: 'Signal "count" used without ()',
      suggestion: 'Add () to read',
      file: 'app.js',
      line: 10,
      component: 'App',
      signal: 'count',
      effect: null,
    });

    const json = err.toJSON();
    assert.equal(json.code, 'ERR_MISSING_SIGNAL_READ');
    assert.equal(json.message, 'Signal "count" used without ()');
    assert.equal(json.suggestion, 'Add () to read');
    assert.equal(json.file, 'app.js');
    assert.equal(json.line, 10);
    assert.equal(json.component, 'App');
    assert.equal(json.signal, 'count');
    assert.equal(json.effect, null);
  });

  it('toJSON is JSON-serializable', () => {
    const err = new WhatError({
      code: 'ERR_TEST',
      message: 'Test error',
      suggestion: 'Fix it',
    });
    const serialized = JSON.stringify(err.toJSON());
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.code, 'ERR_TEST');
    assert.equal(parsed.message, 'Test error');
  });
});

describe('ERROR_CODES', () => {
  it('has all expected error codes', () => {
    const expectedCodes = [
      'INFINITE_EFFECT',
      'MISSING_SIGNAL_READ',
      'HYDRATION_MISMATCH',
      'ORPHAN_EFFECT',
      'SIGNAL_WRITE_IN_RENDER',
      'MISSING_CLEANUP',
      'UNSAFE_INNERHTML',
      'MISSING_KEY',
    ];
    for (const code of expectedCodes) {
      assert.ok(ERROR_CODES[code], `Missing error code: ${code}`);
      assert.ok(ERROR_CODES[code].code, `${code} missing .code`);
      assert.ok(ERROR_CODES[code].severity, `${code} missing .severity`);
      assert.ok(ERROR_CODES[code].template, `${code} missing .template`);
      assert.ok(ERROR_CODES[code].suggestion, `${code} missing .suggestion`);
      assert.ok(ERROR_CODES[code].codeExample, `${code} missing .codeExample`);
    }
  });

  it('all codes start with ERR_', () => {
    for (const def of Object.values(ERROR_CODES)) {
      assert.ok(def.code.startsWith('ERR_'), `Code should start with ERR_: ${def.code}`);
    }
  });
});

describe('createWhatError', () => {
  it('creates error from code name', () => {
    const err = createWhatError('INFINITE_EFFECT', { effectName: 'myEffect' });
    assert.equal(err.code, 'ERR_INFINITE_EFFECT');
    assert.ok(err.message.includes('myEffect'));
  });

  it('interpolates template variables', () => {
    const err = createWhatError('MISSING_SIGNAL_READ', { signalName: 'count' });
    assert.ok(err.message.includes('count'));
    assert.ok(!err.message.includes('{{'));
  });

  it('handles missing context gracefully', () => {
    const err = createWhatError('HYDRATION_MISMATCH', {});
    assert.ok(err.message.includes('(unknown)'));
  });

  it('sets file and line from context', () => {
    const err = createWhatError('INFINITE_EFFECT', {
      effectName: 'test',
      file: 'src/app.js',
      line: 42,
    });
    assert.equal(err.file, 'src/app.js');
    assert.equal(err.line, 42);
  });

  it('returns generic error for unknown code', () => {
    const err = createWhatError('NONEXISTENT_CODE', {});
    assert.equal(err.code, 'ERR_UNKNOWN');
  });
});

describe('classifyError', () => {
  it('classifies infinite effect loop', () => {
    const err = classifyError(new Error('Possible infinite effect loop detected (25 iterations)'));
    assert.equal(err.code, 'ERR_INFINITE_EFFECT');
  });

  it('classifies hydration mismatch', () => {
    const err = classifyError(new Error('Hydration mismatch in component'));
    assert.equal(err.code, 'ERR_HYDRATION_MISMATCH');
  });

  it('classifies signal write in computed', () => {
    const err = classifyError(new Error('Signal.set() called inside a computed function (signal: count)'));
    assert.equal(err.code, 'ERR_SIGNAL_WRITE_IN_RENDER');
    assert.equal(err.signal, 'count');
  });

  it('returns generic for unknown errors', () => {
    const err = classifyError(new Error('Something unexpected happened'));
    assert.equal(err.code, 'ERR_RUNTIME');
    assert.ok(err.message.includes('Something unexpected'));
  });

  it('preserves context from caller', () => {
    const err = classifyError(new Error('infinite effect loop'), {
      component: 'App',
      file: 'app.js',
    });
    assert.equal(err.component, 'App');
    assert.equal(err.file, 'app.js');
  });
});

describe('Error collector', () => {
  beforeEach(() => {
    clearCollectedErrors();
  });

  it('collects errors', () => {
    const err = new WhatError({ code: 'ERR_TEST', message: 'test' });
    collectError(err);
    const errors = getCollectedErrors();
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'ERR_TEST');
  });

  it('adds timestamp to collected errors', () => {
    const err = new WhatError({ code: 'ERR_TEST', message: 'test' });
    const before = Date.now();
    collectError(err);
    const errors = getCollectedErrors();
    assert.ok(errors[0].timestamp >= before);
  });

  it('filters by since', () => {
    const err1 = new WhatError({ code: 'ERR_1', message: 'old' });
    collectError(err1);
    const midpoint = Date.now();
    const err2 = new WhatError({ code: 'ERR_2', message: 'new' });
    collectError(err2);

    const recent = getCollectedErrors(midpoint - 1);
    assert.ok(recent.length >= 1);
  });

  it('clears collected errors', () => {
    collectError(new WhatError({ code: 'ERR_TEST', message: 'test' }));
    assert.equal(getCollectedErrors().length, 1);
    clearCollectedErrors();
    assert.equal(getCollectedErrors().length, 0);
  });
});
