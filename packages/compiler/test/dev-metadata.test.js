// Development names and source locations (devMetadata). The format is a
// contract with the runtime and devtools: "name@path:line:column", path
// relative to projectRoot, 1-based column, read in the same pass that lowers
// the JSX so the positions are the original source's. A production build is
// byte-identical with the option on or off.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();
const { mount, flushSync, h } = await import('../../core/src/index.js');
const { renderToString } = await import('../../server/src/index.js');

const SOURCE = `import { signal, effect, computed } from 'what-framework';
import * as W from 'what-core';
import { signal as foreignSignal } from 'some-lib';
const count = signal(0);
const named = signal(1, 'given');
const store = { total: W.signal(2) };
let late;
late = signal(3);
const other = foreignSignal(4);
const doubled = computed(() => count() * 2);
effect(() => { count(); });
effect(() => {}, { phase: 'user' });
effect(() => {}, { name: 'kept' });
export function Row(props) { return <li title={count()}>{count()}<b>{props.label}</b></li>; }
export function App() { return <ul><Row label="a" /><Counter client:idle /></ul>; }
function Counter() { return <i>c</i>; }
export { count, named, store, late, other, doubled };
`;

// The same module without the imports a data: URL cannot resolve.
const RUNTIME_SOURCE = SOURCE
  .replace("import * as W from 'what-core';\n", '')
  .replace("import { signal as foreignSignal } from 'some-lib';\n", '')
  .replace('const store = { total: W.signal(2) };', 'const store = { total: signal(2) };')
  .replace('const other = foreignSignal(4);', 'const other = 4;');

const dev = (source, options = {}) => compileJSX(source, {
  filename: '/proj/src/App.jsx',
  ...options,
  pluginOptions: { devMetadata: true, projectRoot: '/proj', ...options.pluginOptions },
});

describe('development metadata: what is emitted', () => {
  const code = dev(SOURCE);

  it('names components at their JSX position', () => {
    assert.match(code, /_\$createComponent\(Row, \{\s*label: "a"\s*\}, \[\], "Row@src\/App\.jsx:15:36"\)/);
    assert.match(code, /_\$createComponent\(_\$Island, \{[^}]*\}, \[\], "Counter@src\/App\.jsx:15:53"\)/);
  });

  it('names What signals and computeds and preserves an explicit signal name', () => {
    assert.match(code, /const count = signal\(0, "count@src\/App\.jsx:4:15"\);/);
    assert.match(code, /const named = signal\(1, 'given', "named@src\/App\.jsx:5:15"\);/);
    assert.match(code, /total: W\.signal\(2, "total@src\/App\.jsx:6:24"\)/);
    assert.match(code, /late = signal\(3, "late@src\/App\.jsx:8:8"\);/);
    assert.match(code, /const other = foreignSignal\(4\);/);
    assert.match(code, /const doubled = computed\(\(\) => count\(\) \* 2, "doubled@src\/App\.jsx:10:17"\);/);
  });

  it('names effects through their options object', () => {
    assert.match(code, /effect\(\(\) => \{\s*count\(\);\s*\}, \{\s*name: "effect@src\/App\.jsx:11:1"\s*\}\);/);
    assert.match(code, /phase: 'user',\s*name: "effect@src\/App\.jsx:12:1"/);
    assert.match(code, /\{\s*name: 'kept'\s*\}, "effect@src\/App\.jsx:13:1"/);
  });

  it('names binding effects and inserts by what they write', () => {
    assert.match(code, /_\$effect\(\(\) => _\$setProp\(_el\$0, "title", count\(\)\), \{\s*name: "li\.title@src\/App\.jsx:14:41",\s*binding: _el\$0\s*\}\);/);
    assert.match(code, /_\$insert\(_el\$0, \(\) => count\(\), _el\$1, "li\.children@src\/App\.jsx:14:57"\);/);
    assert.match(code, /_\$insert\(_el\$1, _\$place\(props, "label"\), void 0, "b\.children@src\/App\.jsx:14:69"\);/);
  });

  it('names server components too', () => {
    const ssr = dev('const a = <Card title="x" />;', { pluginOptions: { generate: 'ssr' } });
    assert.match(ssr, /_\$ssrComponent\(Card, \{\s*title: "x"\s*\}, \[\], "Card@src\/App\.jsx:1:11"\)/);
  });
});

describe('development metadata: production output is untouched', () => {
  it('a production build is byte-identical with the option on and off', () => {
    for (const generate of ['dom', 'ssr']) {
      const off = compileJSX(SOURCE, { production: true, filename: '/proj/src/App.jsx', pluginOptions: { generate } });
      const on = compileJSX(SOURCE, { production: true, filename: '/proj/src/App.jsx', pluginOptions: { generate, devMetadata: true, projectRoot: '/proj' } });
      assert.equal(on, off, generate);
    }
  });

  it('a development build without the option emits none of it', () => {
    const code = compileJSX(SOURCE, { filename: '/proj/src/App.jsx' });
    assert.doesNotMatch(code, /@src\/App\.jsx/);
  });
});

describe('development metadata: output still renders and updates', () => {
  it('a compiled DOM tree renders and updates the same with the metadata', async () => {
    const plain = await loadCompiled(RUNTIME_SOURCE);
    const named = await loadCompiled(RUNTIME_SOURCE, { filename: '/proj/src/App.jsx', pluginOptions: { devMetadata: true, projectRoot: '/proj' } });
    const html = [];
    for (const mod of [plain, named]) {
      const host = document.createElement('div');
      document.body.appendChild(host);
      mount(mod.App, host);
      flushSync();
      mod.count(5);
      flushSync();
      html.push(host.innerHTML);
      host.remove();
    }
    assert.equal(html[1], html[0]);
    assert.match(html[1], /<li title="5">5<b>a<\/b><\/li>/);
    assert.equal(named.count._debugName, 'count@src/App.jsx:2:15', 'signal() already stores the name it is given');
  });

  it('a compiled server tree renders the same with the metadata', async () => {
    const plain = await loadCompiled(RUNTIME_SOURCE, { pluginOptions: { generate: 'ssr' } });
    const named = await loadCompiled(RUNTIME_SOURCE, { filename: '/proj/src/App.jsx', pluginOptions: { generate: 'ssr', devMetadata: true, projectRoot: '/proj' } });
    assert.equal(renderToString(h(named.App)), renderToString(h(plain.App)));
  });
});
