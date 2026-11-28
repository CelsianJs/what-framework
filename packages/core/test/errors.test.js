/**
 * Tests for the structured error system (packages/core/src/errors.js).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WhatError,
  ERROR_CODES,
  createWhatError,
  classifyError,
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
  // classifyError used to guess codes from message text, and the guesses sent
  // agents to the wrong fix ("Signal.set() called inside a computed" became
  // ERR_SIGNAL_WRITE_IN_RENDER). Framework checks now report coded events
  // through diagnostics.js, so text is never matched.
  it('does not guess a code from message text', () => {
    for (const msg of [
      'Possible infinite effect loop detected (25 iterations)',
      'Hydration mismatch in component',
      'Signal.set() called inside a computed function (signal: count)',
    ]) {
      assert.equal(classifyError(new Error(msg)).code, 'ERR_RUNTIME', msg);
    }
  });

  it('resolves a code the error already carries', () => {
    const err = classifyError(Object.assign(new Error('[what] useState() can only be called inside a component function.'), { code: 'ERR_HOOK_OUTSIDE_COMPONENT' }));
    assert.equal(err.code, 'ERR_HOOK_OUTSIDE_COMPONENT');
    assert.equal(err.severity, 'error');
    assert.equal(err.suggestion, ERROR_CODES.HOOK_OUTSIDE_COMPONENT.suggestion);
    assert.ok(err.message.includes('useState()'), 'keeps the specific thrown message');
  });

  it('returns generic for unknown errors with the catalogue fallback text', () => {
    const err = classifyError(new Error('Something unexpected happened'));
    assert.equal(err.code, 'ERR_RUNTIME');
    assert.ok(err.message.includes('Something unexpected'));
    assert.equal(err.suggestion, ERROR_CODES.RUNTIME.suggestion);
  });

  it('preserves context from caller', () => {
    const err = classifyError(new Error('boom'), {
      component: 'App',
      file: 'app.js',
    });
    assert.equal(err.component, 'App');
    assert.equal(err.file, 'app.js');
  });
});

describe('WhatError severity', () => {
  it('serializes the catalogue severity', () => {
    assert.equal(createWhatError('MISSING_SIGNAL_READ', { signalName: 'n' }).toJSON().severity, 'warning');
    assert.equal(createWhatError('INFINITE_EFFECT', {}).toJSON().severity, 'error');
  });

  // The class is a root export used for `instanceof`; a catalogue lookup in it
  // kept all of ERROR_CODES in every app that imported it (check-size's
  // what-error scenario). Only the factories read the entry.
  it('takes severity from its caller, not from the catalogue', () => {
    assert.equal(new WhatError({ code: 'ERR_MISSING_SIGNAL_READ', message: 'm' }).severity, 'error');
    assert.equal(new WhatError({ code: 'ERR_MISSING_SIGNAL_READ', severity: 'warning', message: 'm' }).severity, 'warning');
  });

  it('is filled from the entry by classifyError for a coded throw', () => {
    const err = classifyError(Object.assign(new Error('read without ()'), { code: 'ERR_MISSING_SIGNAL_READ' }));
    assert.equal(err.severity, 'warning');
    assert.equal(err.codeExample, ERROR_CODES.MISSING_SIGNAL_READ.codeExample);
  });

  it('is filled from the fallback entries', () => {
    assert.equal(createWhatError('NONEXISTENT_CODE').severity, ERROR_CODES.UNKNOWN.severity);
    assert.equal(classifyError(new Error('boom')).severity, ERROR_CODES.RUNTIME.severity);
  });
});
