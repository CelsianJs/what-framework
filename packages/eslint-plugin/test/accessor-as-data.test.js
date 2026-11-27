// what/no-uncalled-signals reports What state stored or passed as data where
// its value is what is used (`setSubmitted({ name, age })`,
// `JSON.stringify(submitted)`, `[a, b].join()`), with a suggestion that adds
// the call, and stays quiet where handing on the accessor is the point (a
// prop, a dependency array, untrack(), computed(), a custom hook) and for
// state What did not make (React's useState in a what-react file).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import plugin from '../src/index.js';

const HEAD = "import { useState, useSignal, signal, computed, untrack, useEffect } from 'what-framework';\n";
const BODY = 'const [name] = useState(\'\'); const [age] = useState(0); const [submitted, setSubmitted] = useState(null); const items = useSignal([]);';

function lint(code, { head = HEAD, wrap = true } = {}) {
  const source = head + (wrap ? `function App({ url }) {\n  ${BODY}\n  const run = () => { ${code}; };\n  return <button onClick={run} />;\n}\n` : code);
  return new Linter()
    .verify(source, [plugin.configs.compiler], { filename: 'app.jsx' })
    .filter((m) => m.ruleId === 'what/no-uncalled-signals' || m.fatal);
}

function fixed(code, index = 0) {
  const source = HEAD + `function App({ url }) {\n  ${BODY}\n  const run = () => { ${code}; };\n  return <button onClick={run} />;\n}\n`;
  const messages = new Linter().verify(source, [plugin.configs.compiler], { filename: 'app.jsx' }).filter((m) => m.ruleId === 'what/no-uncalled-signals');
  const { fix } = messages[index].suggestions[0];
  const out = source.slice(0, fix.range[0]) + fix.text + source.slice(fix.range[1]);
  return out.split('\n')[3].replace(/^ {2}const run = \(\) => \{ /, '').replace(/; \};$/, '');
}

describe('no-uncalled-signals: What state used as data', () => {
  for (const [shape, code, names] of [
    ['shorthand properties written to a setter', 'setSubmitted({ name, age })', ['name', 'age']],
    ['a property value written to a setter', 'setSubmitted({ who: name })', ['name']],
    ['an array written to .set()', 'items.set([name, age])', ['name', 'age']],
    ['JSON.stringify of an accessor', 'JSON.stringify(submitted)', ['submitted']],
    ['JSON.stringify nested in fetch options', "fetch(url, { method: 'POST', body: JSON.stringify({ name }) })", ['name']],
    ['String() and console.log()', 'String(name); console.log(age)', ['name', 'age']],
    ['an array literal joined', "[name, age].join(', ')", ['name', 'age']],
    ['localStorage.setItem', "localStorage.setItem('name', name)", ['name']],
  ]) {
    it(`reports ${shape}`, () => {
      const messages = lint(code);
      assert.deepEqual(messages.map((m) => m.message.match(/^"(\w+)" is What state, a function: /)?.[1]), names, JSON.stringify(messages));
    });
  }

  it('says why, and suggests the call', () => {
    const [m] = lint('JSON.stringify(submitted)');
    assert.equal(m.message, '"submitted" is What state, a function: JSON.stringify() is given the function, not its value. Call it to use the value: submitted()');
    assert.equal(fixed('JSON.stringify(submitted)'), 'JSON.stringify(submitted())');
    assert.equal(fixed('setSubmitted({ name, age })', 1), 'setSubmitted({ name, age: age() })');
  });

  it('still reports the plain shapes, now with the same suggestion', () => {
    for (const code of ['`Hello ${name}`', 'items.length', 'if (submitted) {}', "name + '!'", 'submitted.name']) {
      const messages = lint(code);
      assert.equal(messages.length, 1, code);
      assert.equal(messages[0].suggestions[0].desc.startsWith('Call it'), true);
    }
    assert.equal(fixed('items.length'), 'items().length');
  });

  for (const [why, code] of [
    ['a dependency array', 'useEffect(() => {}, [name, age])'],
    ['untrack() and computed()', 'untrack(name); computed(name)'],
    ['a custom hook or any other function', 'useThing(name); save({ name }); register([name, age])'],
    ['an accessor stored in a plain object or array', 'const fields = { name, age }; const list = [name, age]; return fields && list'],
    ['the call written', 'setSubmitted({ name: name(), age: age() }); JSON.stringify(submitted())'],
    ['a setter given an updater', 'setSubmitted((s) => ({ ...s, name: name() }))'],
  ]) {
    it(`does not report ${why}`, () => assert.deepEqual(lint(code), []));
  }

  it('does not report a prop that takes an accessor', () => {
    assert.deepEqual(lint(`function App() {\n  ${BODY}\n  return <Field value={name} fields={{ name, age }} list={[name, age]} />;\n}\n`, { wrap: false }), []);
  });

  it('does not report a plain shape on a same-named variable of another scope', () => {
    // `idx` is a signal in one component and a plain local in another.
    const code = "function A() { const idx = useSignal(0); return <p>{() => idx() + 1}</p>; }\n" +
      'function B({ current }) { return <div>{() => { const idx = current(); if (idx === 0) return <i />; return `n${idx}`; }}</div>; }';
    assert.deepEqual(lint(code, { wrap: false }), []);
    assert.equal(lint('function C() { const idx = useSignal(0); return <p>{() => (idx === 0 ? 1 : 2)}</p>; }', { wrap: false }).length, 1, 'the signal itself still is');
  });

  it('does not report state What did not make, or a name that shadows it', () => {
    const react = "import { useState } from 'react';\n";
    assert.deepEqual(lint("function A() { const [name] = useState(''); const [s, setS] = useState(null); return <p onClick={() => setS({ name })}>{JSON.stringify(s)}</p>; }", { head: react, wrap: false }), []);
    assert.deepEqual(lint("function A() { const [name] = useState(''); const show = (name) => JSON.stringify({ name }); return <p>{show(1)}{name}</p>; }", { wrap: false }), []);
  });

  it('does not report a React state value compared or interpolated', () => {
    const code = "function A() { const [status] = useState('loading'); const [error] = useState(null); " +
      "return <div className={`card ${status}`}>{status === 'fail' && `FAIL: ${error}`}</div>; }";
    for (const source of ['react', 'preact/hooks', 'what-react']) {
      assert.deepEqual(lint(code, { head: `import { useState } from '${source}';\n`, wrap: false }), [], source);
    }
    assert.equal(lint(code, { wrap: false }).length, 3, "What's own useState still is");
  });
});
