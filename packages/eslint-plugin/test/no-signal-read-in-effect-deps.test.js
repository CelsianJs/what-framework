// what/no-signal-read-in-effect-deps, through the real ESLint Linter and its
// fixer. useEffect's deps take accessors: the runtime reports a plain value
// there as ERR_EFFECT_DEP_NOT_FUNCTION, and this rule catches the signal read
// that produces one before the code runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import what from '../src/index.js';

const RULE = 'what/no-signal-read-in-effect-deps';

function lint(code) {
  const linter = new Linter();
  const config = what.configs.recommended;
  const messages = linter.verify(code, [config], { filename: 'app.jsx' }).filter((m) => m.ruleId === RULE);
  const { output } = linter.verifyAndFix(code, [config], { filename: 'app.jsx' });
  return { messages, output };
}

test('reports a signal read in the deps and fixes it to the accessor', () => {
  const { messages, output } = lint([
    "import { signal, useEffect } from 'what-framework';",
    'function A() {',
    '  const count = signal(0);',
    '  useEffect(() => { document.title = String(count()); }, [count()]);',
    '  return null;',
    '}',
  ].join('\n'));
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /write count, not count\(\)/);
  assert.match(output, /\}, \[count\]\);/);
});

test('knows the accessors useState, useReducer and useMemo return', () => {
  const { messages } = lint([
    "import { useState, useReducer, useMemo, useEffect } from 'what-framework';",
    'function A() {',
    '  const [count, setCount] = useState(0);',
    '  const [state, dispatch] = useReducer((s) => s, { n: 0 });',
    '  const doubled = useMemo(() => count() * 2);',
    '  useEffect(() => {}, [count(), state(), doubled()]);',
    '  return null;',
    '}',
  ].join('\n'));
  assert.deepEqual(messages.map((m) => m.message.match(/write (\w+),/)[1]), ['count', 'state', 'doubled']);
});

test('accepts accessors, plain identifiers, calls with arguments and no deps array', () => {
  const { messages } = lint([
    "import { signal, useEffect } from 'what-framework';",
    'function A(props) {',
    '  const count = signal(0);',
    '  useEffect(() => {}, [count, props.id, format(1)]);',
    '  useEffect(() => { count(); });',
    '  useEffect(() => {}, []);',
    '  return null;',
    '}',
  ].join('\n'));
  assert.deepEqual(messages, []);
});

test('carries the runtime code, so docs and what_fix describe one mistake', () => {
  assert.equal(what.rules['no-signal-read-in-effect-deps'].meta.docs.code, 'ERR_EFFECT_DEP_NOT_FUNCTION');
});
