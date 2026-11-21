// A call of a function the module declares is as reactive as what that
// function runs. The compiler follows the module's call graph on a stack of
// its own: a call is static only when every function it can reach is seen and
// none of them reads. Mutual recursion, a function declaration that is
// reassigned, a local function or method named like a built-in, a helper
// declared in a nested block, and an object literal whose method may be
// replaced all compile to the reactive form; a chain of thousands of helpers
// compiles.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');
const { mount, flushSync } = await import('../../core/src/index.js');

async function follows(source, expected = (value) => value) {
  const { label, View } = await loadCompiled(`
    import { signal } from 'what-framework';
    export const label = signal('first');
    ${source}
  `);
  const host = document.createElement('div');
  const stop = mount(View(), host);
  try {
    assert.equal(host.textContent, expected('first'));
    label('second');
    flushSync();
    assert.equal(host.textContent, expected('second'));
  } finally {
    stop();
  }
}

describe('a call reaches a signal through local functions', () => {
  it('mutually recursive functions, whichever is called first', async () => {
    const both = (value) => `${value}|${value}`;
    await follows(`
      export function View() { return <p>{a(0)}|{b(0)}</p>; }
      function a(n) { if (n > 0) return b(n - 1); return label(); }
      function b(n) { return a(n); }
    `, both);
    await follows(`
      export function View() { return <p>{b(0)}|{a(0)}</p>; }
      function a(n) { if (n > 0) return b(n - 1); return label(); }
      function b(n) { return a(n); }
    `, both);
  });

  it('a function declaration that is reassigned', () => follows(`
    export function View() { return <p>{format('x')}</p>; }
    function format(prefix) { return prefix; }
    format = (prefix) => label();
  `));

  it('a local method named like a built-in method', () => follows(`
    const model = { replace(value) { return label(); } };
    export function View() { return <p>{model.replace('x')}</p>; }
  `));

  it('a local function that shadows a built-in global', () => follows(`
    function String(value) { return label(); }
    export function View() { return <p>{String('x')}</p>; }
  `));

  it('a helper declared in a nested block of the callee', () => follows(`
    function format(arg) {
      if (arg) {
        function read(prefix) { return label(); }
        return read(arg);
      }
      return '';
    }
    export function View() { return <p>{format('x')}</p>; }
  `));

  it('a helper declared inside a callback', () => follows(`
    function format(fn) { return fn(); }
    export function View() {
      return <p>{format(() => {
        function read(prefix) { return label(); }
        return read('x');
      })}</p>;
    }
  `));

  it('a method an object literal may get from a later spread or duplicate key', async () => {
    await follows(`
      const reading = { format: () => label() };
      const model = { format: (value) => value, ...reading };
      export function View() { return <p>{model.format('x')}</p>; }
    `);
    await follows(`
      const model = { format: (value) => 'x', format: (value) => label() };
      export function View() { return <p>{model.format('x')}</p>; }
    `);
  });

  it('a method of an object literal that is replaced or handed elsewhere', async () => {
    await follows(`
      const model = { format: (value) => 'first' };
      model.format = () => label();
      export function View() { return <p>{model.format('x')}</p>; }
    `);
    await follows(`
      const model = { format: (value) => 'first' };
      Object.assign(model, { format: () => label() });
      export function View() { return <p>{model.format('x')}</p>; }
    `);
  });

  it('the end of a chain of 5,000 helpers', async () => {
    const count = 5000;
    const helpers = Array.from({ length: count }, (_, i) =>
      `function f${i}(n) { return ${i + 1 === count ? 'label()' : `f${i + 1}(n)`}; }`);
    await follows(`export function View() { return <p>{f0(1)}</p>; }\n${helpers.join('\n')}`);
  });
});

describe('a call stays static when nothing it reaches reads', () => {
  const isStatic = (code, call) => assert.ok(!code.includes(`() => ${call}`), code);

  it('a chain of 5,000 static helpers compiles, with the call static', () => {
    const count = 5000;
    const helpers = Array.from({ length: count }, (_, i) =>
      `function f${i}(n) { return ${i + 1 === count ? 'n' : `f${i + 1}(n)`}; }`);
    const code = compileJSX(`export function View() { return <p>{f0(1)}</p>; }\n${helpers.join('\n')}`, { production: true });
    isStatic(code, 'f0(1)');
  });

  it('self and mutual recursion that never reads', () => {
    isStatic(compileJSX(`
      export function View() { return <p>{count(3)}</p>; }
      export function count(n) { return n > 0 ? count(n - 1) : 0; }
    `), 'count(3)');
    const code = compileJSX(`
      export function View() { return <p>{even(4)}{odd(3)}</p>; }
      function even(n) { return n === 0 ? true : odd(n - 1); }
      function odd(n) { return n === 0 ? false : even(n - 1); }
    `);
    isStatic(code, 'even(4)');
    isStatic(code, 'odd(3)');
  });

  it('a local object literal method that only computes, and real built-ins', () => {
    const code = compileJSX(`
      const units = { px: (n) => n + 'px' };
      export function View({ text }) { return <p>{units.px(4)}{String(4)}{'a-b'.replace('-', '+')}</p>; }
    `);
    isStatic(code, 'units.px(4)');
    isStatic(code, 'String(4)');
  });
});
