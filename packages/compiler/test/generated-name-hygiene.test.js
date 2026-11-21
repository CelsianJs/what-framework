// Names the compiler introduces never collide with names the file uses. A user
// binding spelled like a generated one (`_el$0`, `_tmpl$0`, `_sel$0`, `_c$0`,
// a helper import such as `_$insert` or `_$Island`, ...) used to be a
// SyntaxError or a silent shadowing; generated names now skip every name the
// file spells.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();
await import('../../core/src/index.js');

const NAMES = ['_el$0', '_el$1', '_tmpl$0', '_sel$0', '_c$0', '_k$0', '_each$0', '_for$0', '_fb$0',
  '_$insert', '_$template', '_$effect', '_$mapArray', '_$createSelector', '_$memo', '_$className',
  '_$createComponent', '_$delegate$', '_$delegated$', '_$Island'];

function source(name) {
  return `
    import { signal, For } from 'what-framework';
    const selected = signal(1), rows = signal([1]), show = signal(true);
    function Counter() { return <i>c</i>; }
    export function build() {
      const ${name} = 'keep';
      return <ul onClick={() => 1}>
        {show() ? <b /> : null}
        {rows().map(id => <li key={id} class={selected() === id ? 'on' : ''}>{${name}}</li>)}
        <For each={rows} fallback={<em>none</em>}>{(r) => <s>{r}</s>}</For>
        <Counter client:load />
      </ul>;
    }`;
}

describe('generated names are hygienic', () => {
  for (const name of NAMES) {
    it(`a user binding named ${name} keeps its value`, async () => {
      const mod = await loadCompiled(source(name));
      const el = mod.build();
      assert.equal(el.querySelector('li').textContent, 'keep');
    });
  }

  it('a file with no collision gets exactly the names it always did', () => {
    const code = compileJSX('const a = () => <p onClick={go}>{x()}</p>;');
    assert.match(code, /const _tmpl\$0 = /);
    assert.match(code, /const _el\$0 = _tmpl\$0\(\);/);
    assert.match(code, /insert as _\$insert/);
  });
});
