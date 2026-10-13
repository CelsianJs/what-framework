import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
const { signal, flushSync } = await import('../src/reactive.js');
const { jsx } = await import('../src/jsx-runtime.js');
const { hydrate } = await import('../src/render.js');
const { disposeTree } = await import('../src/dom.js');
const { renderToString } = await import('what-server');

describe('hydrated reactive props belong to their DOM element', () => {
  for (const key of ['class', 'className', 'style', 'data-value']) {
    it(`stops ${key} updates when the hydrated element is disposed`, () => {
      const source = signal(0);
      const value = () => key === 'style' ? { opacity: String(source()) } : `value-${source()}`;
      const vnode = jsx('span', { [key]: value, children: 'retained' });
      const host = document.createElement('div');
      host.innerHTML = renderToString(vnode);
      document.body.appendChild(host);
      const existing = host.firstElementChild;
      try {
        hydrate(vnode, host);
        assert.equal(host.firstElementChild, existing, 'hydration must adopt the existing element');
        source.set(1);
        flushSync();
        const beforeDisposal = existing.outerHTML;
        assert.match(beforeDisposal, key === 'style' ? /opacity:\s*1/ : /value-1/);
        disposeTree(host);
        disposeTree(host);
        source.set(2);
        flushSync();
        assert.equal(existing.outerHTML, beforeDisposal);
      } finally {
        disposeTree(host);
        host.remove();
      }
    });
  }
});
