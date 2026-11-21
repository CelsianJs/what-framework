// class and classList resolve in source order on every path. h() and the
// server apply props in the order they were written: a class written after a
// classList replaces the toggled classes. The compiled path used to bake a
// static class into the template, which applied it first, whatever its order.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();
const { mount, flushSync, h } = await import('../../core/src/index.js');
const { renderToString } = await import('../../server/src/index.js');

const compiled = await loadCompiled(`
  import { signal } from 'what-framework';
  export const on = signal(true);
  export const after = () => <p classList={{ a: on() }} class="b" />;
  export const before = () => <p class="b" classList={{ a: on() }} />;
`);
const server = await loadCompiled(`
  export const after = (on) => <p classList={{ a: on }} class="b" />;
  export const before = (on) => <p class="b" classList={{ a: on }} />;
`, { pluginOptions: { generate: 'ssr' } });

function domClass(build) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mount(build, host);
  flushSync();
  const cls = host.querySelector('p').getAttribute('class');
  host.remove();
  return cls;
}

describe('class and classList in source order', () => {
  it('a class written after classList wins on the compiled client, as in h() and on the server', () => {
    const viaH = domClass(() => h('p', { classList: { a: true }, class: 'b' }));
    assert.equal(viaH, 'b');
    assert.equal(domClass(compiled.after), viaH);
    assert.equal(renderToString(h('p', { classList: { a: true }, class: 'b' })), '<p class="b"></p>');
    assert.equal(renderToString(server.after(true)), '<p class="b"></p>');
  });

  it('a class written before classList is toggled over, on every path', () => {
    const viaH = domClass(() => h('p', { class: 'b', classList: { a: true } }));
    assert.equal(viaH, 'b a');
    assert.equal(domClass(compiled.before), viaH);
    assert.equal(renderToString(server.before(true)), '<p class="b a"></p>');
  });
});
