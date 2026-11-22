// A component bundled with its own copy of what-core (or loaded from another
// export tier) creates effects in a render that the installed what-server
// runs. They belong to a root of that copy's for the render, which the
// render's release disposes: nothing the render created runs after it,
// before or after an `await` in the component, also when the effect is the
// first thing the copy does (it takes the lookup the shared server store
// hands out). An async value such a copy makes is refused loudly
// (ERR_FOREIGN_ENGINE_IN_SSR): that copy never joins the render's resources.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const { h } = await import('what-framework');
const { createResponse, renderToStringAsync, renderToString, renderToStream } = await import('../src/index.js');

// The component and a copy of what-core of its own, in one module.
async function bundled(source, label) {
  const { outputFiles: [file] } = await build({
    absWorkingDir: root,
    stdin: { contents: source, resolveDir: root, loader: 'js' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return import('data:text/javascript;base64,' + Buffer.from(file.text + '\n//' + label).toString('base64'));
}

const COMPONENT = (wait) => `
  import { effect, getResponse, signal } from 'what-framework';
  export const count = signal(0);
  export const seen = { runs: 0 };
  export ${wait ? 'async ' : ''}function Page() {
    ${wait ? 'await Promise.resolve();' : ''}
    getResponse().setStatus(201);
    effect(() => { count(); seen.runs++; });
    return 'created';
  }
`;

describe('an effect from another copy of what-core in a server render', () => {
  for (const wait of [false, true]) {
    it(`is disposed with the render, ${wait ? 'after an await' : 'in the synchronous render'}`, async () => {
      const component = await bundled(COMPONENT(wait), `copy-${wait}`);
      const response = createResponse();
      const { body } = await renderToStringAsync(h(component.Page), { response });
      assert.match(body, /created/);
      assert.equal(response.status, 201, 'the copy reaches the render');
      assert.equal(component.seen.runs, 1, 'the effect ran in the render');
      component.count(1);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(component.seen.runs, 1, 'and never again after the render released');
    });
  }

  it('renderToString releases it too', async () => {
    const component = await bundled(COMPONENT(false), 'copy-sync-string');
    assert.match(renderToString(h(component.Page)), /created/);
    component.count(1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(component.seen.runs, 1);
  });
});

describe('a copy of what-core that touched nothing of the server first', () => {
  it('has its effect disposed with the render', async () => {
    const component = await bundled(`
      import { effect, signal } from 'what-framework';
      export const value = signal(0);
      export const observed = [];
      export function Page() {
        effect(() => observed.push(value()));
        return 'page';
      }
    `, 'first-operation');
    assert.match(renderToString(h(component.Page)), /page/);
    assert.deepEqual(component.observed, [0]);
    component.value(1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(component.observed, [0]);
  });

  it('fails the render with ERR_FOREIGN_ENGINE_IN_SSR when it makes an async value', async () => {
    const component = await bundled(`
      import { createResource } from 'what-framework';
      export let calls = 0;
      export function Page() {
        const [data] = createResource(() => { calls++; return Promise.resolve('record'); }, { key: 'record' });
        return data();
      }
    `, 'foreign-resource');
    const errors = [];
    for await (const chunk of renderToStream(h(component.Page), { onError: (error) => errors.push(error.code) })) void chunk;
    assert.deepEqual(errors, ['ERR_FOREIGN_ENGINE_IN_SSR']);
    assert.equal(component.calls, 0, 'the fetcher never runs');
  });
});
