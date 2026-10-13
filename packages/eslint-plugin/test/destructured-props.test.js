import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import what from '../src/index.js';

async function messages(code, preset = 'compiler') {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [what.configs[preset]] });
  const [result] = await eslint.lintText(code, { filePath: 'component.jsx' });
  assert.equal(result.fatalErrorCount, 0);
  return result.messages.filter(message => message.ruleId === 'what/no-destructured-props');
}

test('native component parameter destructuring is detected in every preset', async () => {
  for (const preset of ['recommended', 'strict', 'compiler']) {
    const found = await messages("import { signal } from 'what-framework'; export function Button({label}) { return <button>{label}</button>; }", preset);
    assert.equal(found.length, 1, preset);
    assert.equal(found[0].severity, preset === 'strict' ? 2 : 1);
  }
});

test('compiler preset guards components without runtime imports, including arrows', async () => {
  assert.equal((await messages('export const Button = ({label}) => <button>{label}</button>;')).length, 1);
  assert.equal((await messages('export default ({label}) => <button>{label}</button>;')).length, 1);
  assert.equal((await messages('export default function ({label} = {}) { return <button>{label}</button>; }')).length, 1);
});

test('local destructuring of the component props is detected', async () => {
  assert.equal((await messages('export function Button(props) { const {label: text = "Default"} = props; return <button>{text}</button>; }')).length, 1);
});

test('native h() components are guarded when the factory is imported with an alias', async () => {
  assert.equal((await messages("import { h as element } from 'what-core'; function Button({label}) { return element('button', {}, label); }", 'recommended')).length, 1);
});

test('reading props in reactive JSX does not warn', async () => {
  assert.deepEqual(await messages('export function Button(props) { return <button class={props.variant}>{props.label}</button>; }'), []);
});

test('event payloads, domain objects and ordinary helpers are not component props', async () => {
  const source = `
    function Decode({value}) { return value; }
    export function Button(props) {
      const {name} = props.user;
      const {label} = {label: 'literal'};
      function handleClick({target}) { const {value} = target; return value; }
      { const props = {label:'local'}; const {label: local} = props; console.log(local); }
      return <button onclick={handleClick}>{name}{label}</button>;
    }
  `;
  assert.deepEqual(await messages(source), []);
});

test('destructuring inside a rerunning reactive callback does not capture setup-time props', async () => {
  assert.deepEqual(await messages(`import { computed } from 'what-framework'; function Button(props) {
    const label = computed(() => { const {label} = props; return label; });
    return <button>{label()}</button>;
  }`), []);
});

test('a nested callback parameter named props is not the component props binding', async () => {
  assert.deepEqual(await messages('function Button(props) { const texts = [{label:"x"}].map(props => {const {label} = props; return label;}); return <button>{texts.join()}</button>; }'), []);
});

test('React and what-react components retain their normal destructuring semantics', async () => {
  for (const source of [
    "import React from 'react'; function Button({label}) { return <button>{label}</button>; }",
    "import { useState } from 'what-react'; function Button(props) { const {label} = props; return <button>{label}</button>; }",
    "import { useState } from 'react'; import { signal } from 'what-framework'; const Button = ({label}) => <button>{label}</button>;",
    "function Button({label}) { return <button>{label}</button>; } import React from 'react';",
  ]) assert.deepEqual(await messages(source), []);
});
