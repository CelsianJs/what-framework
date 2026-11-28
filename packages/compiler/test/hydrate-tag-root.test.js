// The JSX handed to hydrate() arrives unbuilt (_$componentVNode), and when
// its tag may be a string held in a binding (`hydrate(<Tag />)`, Tag a
// parameter or a prop) it is run as the component that claims the server's
// element (render.js _$hcomponentVNode, claimedTag): the element, its text and
// its children are the server's, and its handlers and holes are live. An
// imported tag is a component, and a plain function the module defines is
// one too; those roots stay _$componentVNode.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const source = (root) => `
  import { hydrate, signal } from 'what-framework';
  export const n = signal(0);
  export const page = (Tag) => <Tag class="x" onClick={() => n(n() + 1)}>hi {n()}<b>bold</b></Tag>;
  export function boot(el, Tag, onHydrationError) { ${root} }
`;

describe('hydrate(<Tag />) with a tag held in a binding', () => {
  it('claims the server\'s element, text and children, and its handler and hole are live', async () => {
    const { renderToString } = await import('../../server/src/index.js');
    const server = await loadCompiled(source(''), { pluginOptions: { generate: 'ssr' } });
    const client = await loadCompiled(source('return hydrate(<Tag class="x" onClick={() => n(n() + 1)}>hi {n()}<b>bold</b></Tag>, el, { onHydrationError });'), { pluginOptions: { hydratable: true } });
    const host = document.createElement('div');
    host.innerHTML = renderToString(server.page('p'));
    document.body.appendChild(host);
    const p = host.firstChild;
    const b = p.querySelector('b');
    const mismatches = [];
    const dispose = client.boot(host, 'p', (m) => mismatches.push(m.kind));
    try {
      assert.deepEqual(mismatches, []);
      assert.equal(host.firstChild, p, 'the server\'s element stays');
      assert.equal(p.querySelector('b'), b, 'its children are adopted');
      assert.equal(p.textContent, 'hi 0bold');
      p.click();
      await Promise.resolve();
      assert.equal(p.textContent, 'hi 1bold');
    } finally {
      dispose();
      host.remove();
    }
  });

  it('an imported tag and a plain function of the module stay plain component vnodes', () => {
    const imported = compileJSX(`import { hydrate } from 'what-framework'; import App from './App.jsx'; hydrate(<App />, el);`, { pluginOptions: { hydratable: true } });
    assert.match(imported, /_\$componentVNode\(App/);
    assert.doesNotMatch(imported, /_\$hcomponentVNode/);
    const local = compileJSX(`import { hydrate } from 'what-framework'; function App() { return <p />; } hydrate(<App />, el);`, { pluginOptions: { hydratable: true } });
    assert.match(local, /_\$componentVNode\(App/);
    assert.doesNotMatch(local, /_\$hcomponentVNode/);
    const held = compileJSX(`import { hydrate } from 'what-framework'; export const boot = (Tag) => hydrate(<Tag />, el);`, { pluginOptions: { hydratable: true } });
    assert.match(held, /_\$hcomponentVNode\(Tag/);
  });
});
