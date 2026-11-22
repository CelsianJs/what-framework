// A call of a function the module declares is as reactive as what that
// function runs. The compiler follows the module's call graph on a stack of
// its own, by the kinds of value each call hands over: a call is static only
// when every value it can reach is proven static (literals, the values a
// function is given, built-ins applied to them, functions and object literals
// the module declares and keeps), and anything else is assumed to read.
// Mutual recursion, a function declaration that is reassigned, a local
// function or method named like a built-in, a helper declared in a nested
// block, an object literal whose method may be replaced, getters and setters,
// class instances, callbacks handed by name, generators, async functions and
// default parameters all compile to the reactive form, and so does a getter
// read through any local alias or a member written through a destructuring.
// A chain of thousands of helpers, of constant aliases, or of variables
// written from each other compiles.

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

// The proof is an allowlist: a call is static only when every value it
// reaches is proven static. Each of these reaches a signal some other way than
// by calling it by name, and each must update after the write.
describe('a call reaches a signal through anything the compiler cannot prove', () => {
  const cases = [
    ['a getter reached through a helper', "const model = { get text() { return label(); } }; function read(x) { return model.text; }", "read('x')"],
    ['a getter read at the top of the expression', "const model = { get text() { return label(); } };", 'model.text'],
    ['a setter reached through an assignment', "let value; const model = { set text(x) { value = label(); } }; function read(x) { model.text = x; return value; }", "read('x')"],
    ['a class that overrides a built-in method name', "class Model { replace(x) { return label(); } } const model = new Model();", "model.replace('x')"],
    ['a class instance handed to a helper', "class Model { trim() { return label(); } } const model = new Model(); function show(m) { return m.trim(); }", 'show(model)'],
    ['this, calling a method named like a built-in', "const model = { format(x) { return this.replace(x); }, replace(x) { return label(); } };", "model.format('x')"],
    ['a function handed by name to an array method', 'function format(x) { return label(); }', "[1].map(format).join('')"],
    ['a generator consumed in a helper', 'function* values(x) { yield label(); } function read(x) { const [result] = values(x); return result; }', "read('x')"],
    ['an async helper reading before its first await', "let value; async function update(x) { await (value = label()); } function read(x) { void update(x); return value; }", "read('x')"],
    ['a default parameter', 'function read(x, value = label()) { return value; }', "read('x')"],
    ['a destructured parameter of an object with a getter', "const model = { get text() { return label(); } }; function read({ text }) { return text; }", 'read(model)'],
    ['a template literal converting an object', "const model = { toString() { return label(); } }; function read(x) { return `${model}`; }", "read('x')"],
    ['an operator converting an object', "const model = { valueOf() { return label(); } }; function read(x) { return model + ''; }", "read('x')"],
    ['a closure over a parameter that is called', 'function read(get) { return [1].map(() => get()).join(\'\'); }', 'read(label)'],
    ['call() and apply() of a declared function', 'function read(x) { return label(); }', "read.call(null, 'x') + read.apply(null, ['x'])"],
    ['a constructor the module declares', 'class Box { constructor(x) { this.value = label(); } } function read(x) { return new Box(x).value; }', "read('x')"],
    ['a global the platform does not define', "globalThis.__whatTestText = { get text() { return label(); } }; function read(x) { return __whatTestText.text; }", "read('x')"],
    ['iterating a value nobody built', "const items = { *[Symbol.iterator]() { yield label(); } }; function read(x) { for (const item of items) return item; return ''; }", "read('x')"],
    ['an object literal method replaced elsewhere', "const model = { format: (x) => 'first' }; function swap(m) { m.format = () => label(); } swap(model);", "model.format('x')"],
    ['a getter read through a local alias', 'const model = { get text() { return label(); } }; const alias = model;', 'alias.text'],
    ['a getter read through a chain of aliases, `||` and `?:`', 'const model = { get text() { return label(); } }; const a = model; const b = a || null; const c = b ? b : a;', 'c.text'],
    ['a getter read through a variable assigned later', 'const model = { get text() { return label(); } }; let current = null; current = model;', 'current.text'],
    ['a class instance read through an alias', 'class Model { get text() { return label(); } } const model = new Model(); const alias = model;', 'alias.text'],
    ['a method replaced through an array destructuring', "const model = { format() { return 'first'; } }; [model.format] = [() => label()];", "model.format(0)"],
    ['a method replaced through an object destructuring, a default or a rest', "const model = { format() { return 'first'; } }; ({ f: model.format = () => label() } = {});", "model.format(0)"],
    ['a method replaced by a for-of loop', "const model = { format() { return 'first'; } }; for (model.format of [() => label()]);", "model.format(0)"],
    ['`this` writing its own method through a destructuring', "const model = { swap() { [this.format] = [() => label()]; return ''; }, format() { return 'first'; } }; model.swap();", "model.format(0)"],
    ['an array element replaced through a destructuring', "const names = ['first']; [names[0]] = [{ toString: () => label() }];", "names.join('')"],
  ];
  it('a function handed to a package utility, which may call it', () => {
    const code = compileJSX("import { apply } from 'some-lib'; import { signal } from 'what-framework'; const label = signal(''); function format(x) { return label(); } export function View() { return <p>{apply(format, 1)}</p>; }");
    assert.ok(code.includes('() => apply(format, 1)'), code);
  });

  for (const [name, helper, expression] of cases) {
    it(name, () => follows(`${helper}\nexport function View() { return <p>{${expression}}</p>; }`, (value) => value.repeat(expression.includes('apply(null') ? 2 : 1)));
  }
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

  it('methods of a kept object literal, `this` among them, given plain values', () => {
    const code = compileJSX(`
      const literal = { format(x) { return this.read(x); }, read(x) { return x.toUpperCase(); } };
      const day = new Date(0);
      const LIMIT = 3;
      function pad(n, width = LIMIT) { let out = String(n); for (let i = out.length; i < width; i++) out = '0' + out; return out; }
      export function View() { return <p>{literal.format('b')}{day.toISOString()}{pad(7)}{['a', 'b'].map((x) => x + '!')}</p>; }
    `, { production: true });
    for (const call of ["literal.format('b')", 'day.toISOString()', 'pad(7)', "['a', 'b'].map("]) isStatic(code, call);
  });

  it('a local object literal method that only computes, and real built-ins', () => {
    const code = compileJSX(`
      const units = { px: (n) => n + 'px' };
      export function View({ text }) { return <p>{units.px(4)}{String(4)}{'a-b'.replace('-', '+')}</p>; }
    `);
    isStatic(code, 'units.px(4)');
    isStatic(code, 'String(4)');
  });

  it('a chain of 20,000 constant aliases compiles, with the call static', () => {
    const count = 20000;
    const aliases = Array.from({ length: count - 1 }, (_, i) => `const value${i + 1} = value${i};`);
    const code = compileJSX(`const value0 = 'catalog';\n${aliases.join('\n')}\nexport const Row = () => <p>{value${count - 1}.toUpperCase()}</p>;`, { production: true });
    isStatic(code, `value${count - 1}.toUpperCase()`);
  });

  it('a chain of 20,000 aliases of a getter compiles, with the read reactive', async () => {
    const count = 20000;
    const aliases = Array.from({ length: count - 1 }, (_, i) => `const model${i + 1} = model${i};`);
    await follows(`const model0 = { get text() { return label(); } };\n${aliases.join('\n')}\nexport const View = () => <p>{model${count - 1}.text}</p>;`);
  });

  it('a variable written from 4,500 others, each written later, compiles, reactive past the bound', () => {
    const count = 4500;
    const declared = Array.from({ length: count - 1 }, (_, i) => `let v${i + 1} = 1;`).join(' ');
    const writes = Array.from({ length: count - 1 }, (_, i) => `v${count - 1 - i} = v${count - 2 - i};`).join(' ');
    const code = compileJSX(`function read(a) { let v0 = a; ${declared} ${writes} return v${count - 1}.toFixed(1); }\nexport const View = () => <p>{read(1)}</p>;`, { production: true });
    assert.ok(code.includes('() => read(1)'), 'past the bound the call is wrapped');
    const short = compileJSX('function read(a) { let v0 = a; let v1 = 1; let v2 = 1; v2 = v1; v1 = v0; return v2.toFixed(1); }\nexport const View = () => <p>{read(1)}</p>;', { production: true });
    isStatic(short, 'read(1)');
  });

  it('a fixed array built by Array.from or Array.of, and its length', () => {
    const code = compileJSX(`
      const ROWS = Array.from({ length: 10000 }, (_, i) => i);
      const DOUBLED = Array.from([1, 2], (n) => n * 2);
      const NAMES = Array.of('a', 'b');
      const LETTERS = Array.from('abc');
      export const View = () => <p>{ROWS.length.toLocaleString()}{DOUBLED.join('-')}{NAMES.join('')}{LETTERS.length.toFixed(0)}</p>;
    `, { production: true });
    for (const call of ['ROWS.length.toLocaleString()', "DOUBLED.join('-')", "NAMES.join('')", 'LETTERS.length.toFixed(0)']) isStatic(code, call);
  });
});

describe('an array Array.from builds is reactive where its elements may be', () => {
  const isWrapped = (code, call) => assert.ok(code.includes(`() => ${call}`), code);

  it('a mapper that reads, a mapper with a body, a mutated result, a shadowed Array', () => {
    const code = compileJSX(`
      import { signal } from 'what-framework';
      const label = signal('a');
      const READ = Array.from({ length: 2 }, () => label());
      const BODY = Array.from({ length: 2 }, (_, i) => { return i; });
      const PUSHED = Array.from({ length: 2 }, (_, i) => i);
      PUSHED.push(label);
      export const View = () => <p>{READ.join('')}{BODY.join('')}{PUSHED.join('')}</p>;
    `, { production: true });
    for (const call of ["READ.join('')", "BODY.join('')", "PUSHED.join('')"]) isWrapped(code, call);
    const shadowed = compileJSX(`
      const Array = { from: (x) => x };
      const ROWS = Array.from({ length: 2 });
      export const View = () => <p>{ROWS.join('')}</p>;
    `, { production: true });
    isWrapped(shadowed, "ROWS.join('')");
  });
});
