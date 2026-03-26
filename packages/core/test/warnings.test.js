// Tests for What Framework - Warning System
// Validates dev-mode warnings fire correctly and only once per unique occurrence.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Set up DOM globals before importing framework modules
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const {
  warn,
  _resetWarnings,
  _wasWarned,
  warnMissingSignalRead,
  warnSignalWriteDuringRender,
  warnEffectWithoutCleanup,
  warnLargeListWithoutKeys,
  warnUnusedSignal,
} = await import('../src/warnings.js');

// =========================================================================
// Core warn() function
// =========================================================================

describe('warn()', () => {
  beforeEach(() => {
    _resetWarnings();
  });

  it('should emit a warning with console.warn', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      warn('test-key', 'Test warning message');
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0], 'Test warning message');
    } finally {
      console.warn = orig;
    }
  });

  it('should only emit each unique key once', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      warn('duplicate-key', 'First');
      warn('duplicate-key', 'Second');
      warn('duplicate-key', 'Third');
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0], 'First');
    } finally {
      console.warn = orig;
    }
  });

  it('should emit different keys independently', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      warn('key-a', 'Warning A');
      warn('key-b', 'Warning B');
      assert.equal(warnings.length, 2);
    } finally {
      console.warn = orig;
    }
  });
});

// =========================================================================
// _wasWarned()
// =========================================================================

describe('_wasWarned()', () => {
  beforeEach(() => {
    _resetWarnings();
  });

  it('should return false for un-emitted warnings', () => {
    assert.equal(_wasWarned('never-warned'), false);
  });

  it('should return true after warning is emitted', () => {
    const orig = console.warn;
    console.warn = () => {};
    try {
      warn('was-warned-test', 'msg');
      assert.equal(_wasWarned('was-warned-test'), true);
    } finally {
      console.warn = orig;
    }
  });
});

// =========================================================================
// _resetWarnings()
// =========================================================================

describe('_resetWarnings()', () => {
  it('should clear all emitted state', () => {
    const orig = console.warn;
    console.warn = () => {};
    try {
      warn('reset-test', 'msg');
      assert.equal(_wasWarned('reset-test'), true);
      _resetWarnings();
      assert.equal(_wasWarned('reset-test'), false);
    } finally {
      console.warn = orig;
    }
  });

  it('should allow the same key to warn again after reset', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      warn('re-warn', 'First');
      _resetWarnings();
      warn('re-warn', 'Second');
      assert.equal(warnings.length, 2);
    } finally {
      console.warn = orig;
    }
  });
});

// =========================================================================
// Specific warning functions
// =========================================================================

describe('warnMissingSignalRead()', () => {
  beforeEach(() => { _resetWarnings(); });

  it('should emit a warning about missing signal read', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      warnMissingSignalRead('count', 'Counter');
      assert.equal(warnings.length, 1);
      assert(warnings[0].includes("Signal 'count'"));
      assert(warnings[0].includes('without being called'));
      assert(warnings[0].includes('<Counter>'));
      assert(warnings[0].includes('{count()}'));
    } finally {
      console.warn = orig;
    }
  });

  it('should work without component name', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      warnMissingSignalRead('count');
      assert.equal(warnings.length, 1);
      assert(warnings[0].includes("Signal 'count'"));
    } finally {
      console.warn = orig;
    }
  });

  it('should fire only once for the same signal+component', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      warnMissingSignalRead('count', 'Counter');
      warnMissingSignalRead('count', 'Counter');
      assert.equal(warnings.length, 1);
    } finally {
      console.warn = orig;
    }
  });
});

describe('warnSignalWriteDuringRender()', () => {
  beforeEach(() => { _resetWarnings(); });

  it('should emit a warning about signal write during render', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      warnSignalWriteDuringRender('count', 'Counter');
      assert.equal(warnings.length, 1);
      assert(warnings[0].includes("Signal 'count'"));
      assert(warnings[0].includes('written during render'));
      assert(warnings[0].includes('<Counter>'));
      assert(warnings[0].includes('effect or event handler'));
    } finally {
      console.warn = orig;
    }
  });
});

describe('warnEffectWithoutCleanup()', () => {
  beforeEach(() => { _resetWarnings(); });

  it('should emit a warning about effect without cleanup', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      warnEffectWithoutCleanup('Timer');
      assert.equal(warnings.length, 1);
      assert(warnings[0].includes('Effect'));
      assert(warnings[0].includes('<Timer>'));
      assert(warnings[0].includes('no cleanup'));
    } finally {
      console.warn = orig;
    }
  });
});

describe('warnLargeListWithoutKeys()', () => {
  beforeEach(() => { _resetWarnings(); });

  it('should emit a warning about large list without keys', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      warnLargeListWithoutKeys(150, 'TodoList');
      assert.equal(warnings.length, 1);
      assert(warnings[0].includes('150'));
      assert(warnings[0].includes('without keys'));
      assert(warnings[0].includes('<TodoList>'));
    } finally {
      console.warn = orig;
    }
  });
});

describe('warnUnusedSignal()', () => {
  beforeEach(() => { _resetWarnings(); });

  it('should emit a warning about unused signal', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      warnUnusedSignal('tempValue', 'Form');
      assert.equal(warnings.length, 1);
      assert(warnings[0].includes("Signal 'tempValue'"));
      assert(warnings[0].includes('<Form>'));
      assert(warnings[0].includes('never read'));
    } finally {
      console.warn = orig;
    }
  });
});
