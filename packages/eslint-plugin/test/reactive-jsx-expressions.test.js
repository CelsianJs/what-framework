// Without the What compiler (the islands template's automatic runtime, h()),
// a JSX child or an element's attribute is evaluated once, when the element is
// made: any expression that reads a signal there keeps its first value, not
// only a bare {count()}. A function, {() => …}, is what stays live.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import plugin from '../src/index.js';

const reports = (jsx) => {
  const src = `import { signal, useState } from 'what-framework';
export function A(props) {
  const count = signal(0);
  const items = signal([]);
  const [user, setUser] = useState({ name: '' });
  return ${jsx};
}
`;
  return new Linter().verify(src, [plugin.configs.recommended], { filename: 'a.jsx' })
    .filter((m) => m.ruleId === 'what/reactive-jsx-children' || m.fatal)
    .map((m) => m.message);
};

describe('reactive-jsx-children: every expression that reads a signal once', () => {
  for (const [shape, jsx, name] of [
    ['arithmetic', '<p>{count() * 2}</p>', 'count'],
    ['a template literal', '<p>{`n=${count()}`}</p>', 'count'],
    ['a condition', "<p>{count() > 1 ? 'big' : 'small'}</p>", 'count'],
    ['a list', '<ul>{items().map((i) => <li key={i}>{i}</li>)}</ul>', 'items'],
    ['a length', '<p>{items().length}</p>', 'items'],
    ['a field', '<p>{user().name}</p>', 'user'],
    ['an element attribute', "<p class={count() > 0 ? 'on' : 'off'}>x</p>", 'count'],
  ]) {
    it(`reports ${shape}`, () => {
      const found = reports(jsx);
      assert.equal(found.length, 1, found.join('\n'));
      assert.ok(found[0].includes(`"${name}()"`) && found[0].includes('{() =>'), found[0]);
    });
  }

  it('still reports a bare read with its own message', () => {
    assert.deepEqual(reports('<p>{count()}</p>'), ['Signal read "count()" in JSX won\'t be reactive without the What compiler. Wrap in a function: {() => count()}']);
  });

  it('leaves alone functions, handlers, refs, keys, component props and expressions that read no signal', () => {
    for (const jsx of [
      '<p>{() => count() * 2}</p>',
      '<ul>{() => items().map((i) => <li key={i}>{i}</li>)}</ul>',
      "<p class={() => (count() > 0 ? 'on' : 'off')}>x</p>",
      '<button onclick={() => count(count() + 1)}>+</button>',
      '<button onClick={() => setUser({ name: user().name })}>x</button>',
      '<ul>{props.items.map((i) => <li key={i}>{i}</li>)}</ul>',
      '<A start={count()} />',
      '<p>{count}</p>',
      '<p title={props.title}>{props.label}</p>',
      "<div>{() => (count() > 0 ? <p class={user().name ? 'named' : ''}>{`n=${count()}`}</p> : null)}</div>",
      "<ul>{() => items().map((i) => <li class={count() === i ? 'on' : ''}>{i}</li>)}</ul>",
    ]) {
      assert.deepEqual(reports(jsx), [], jsx);
    }
  });
});
