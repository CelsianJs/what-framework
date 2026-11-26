import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';

test('the documented typed Button updates the prop passed as an accessor, in place', async () => {
  const { cleanup } = installDOM();
  try {
    const docs = readFileSync(new URL('../../../docs/TYPESCRIPT.md', import.meta.url), 'utf8');
    const example = docs.split('### Typed Components')[1].match(/```tsx\n([\s\S]*?)```/)[1];
    const source = transformSync(`${example}\nexport { Button };`, { loader: 'tsx', jsx: 'preserve' }).code;
    const compiled = compileJSX(source).replaceAll('"what-framework/render"', JSON.stringify(new URL('../../core/src/render.js', import.meta.url).href));
    const { Button } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
    const { signal, mount, flushSync } = await import('../../core/src/index.js');
    const variant = signal('primary');
    let clicks = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);
    // Props as a component receives them: one frozen plain object, built once.
    // label is a value; variant changes, so the parent passes the signal.
    const dispose = mount(Button(Object.freeze({ label: 'Save', variant, onClick: () => { clicks++; } })), host);
    try {
      const button = host.querySelector('button');
      assert.equal(button.textContent, 'Save');
      assert.equal(button.className, 'btn btn-primary');
      variant('secondary');
      flushSync();
      assert.equal(host.querySelector('button'), button, 'the change updates the existing DOM');
      assert.equal(button.className, 'btn btn-secondary');
      assert.equal(button.textContent, 'Save');
      button.click();
      assert.equal(clicks, 1);
    } finally {
      dispose();
      host.remove();
    }
  } finally {
    cleanup();
  }
});
