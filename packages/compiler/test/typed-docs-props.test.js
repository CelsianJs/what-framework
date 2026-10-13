import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';

test('the documented typed Button keeps changing props reactive', async () => {
  const { cleanup } = installDOM();
  try {
    const docs = readFileSync(new URL('../../../docs/TYPESCRIPT.md', import.meta.url), 'utf8');
    const example = docs.split('### Typed Components')[1].match(/```tsx\n([\s\S]*?)```/)[1];
    const source = transformSync(`${example}\nexport { Button };`, { loader: 'tsx', jsx: 'preserve' }).code;
    const compiled = compileJSX(source).replaceAll('"what-framework/render"', JSON.stringify(new URL('../../core/src/render.js', import.meta.url).href));
    const { Button } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
    const { signal, mount, flushSync } = await import('../../core/src/index.js');
    const label = signal('Before');
    const variant = signal(undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);
    // Supply signal-backed property reads, matching a native reactive props
    // proxy. This tests the actual example without relying on parent remounts.
    const dispose = mount(Button({
      get label() { return label(); },
      get variant() { return variant(); },
    }), host);
    try {
      const button = host.querySelector('button');
      assert.equal(button.textContent, 'Before');
      assert.equal(button.className, 'btn btn-primary');
      label('After');
      variant('secondary');
      flushSync();
      assert.equal(host.querySelector('button'), button, 'prop changes update the existing DOM');
      assert.equal(button.textContent, 'After');
      assert.equal(button.className, 'btn btn-secondary');
    } finally {
      dispose();
      host.remove();
    }
  } finally {
    cleanup();
  }
});
