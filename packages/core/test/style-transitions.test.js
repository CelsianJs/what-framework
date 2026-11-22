// A style binding moving between an object, a string, null and undefined, in
// every direction, on every client path (h(), compiled JSX, a spread, a
// hydration of each): it never throws, and the element ends with exactly the
// inline style a fresh render of the last value gives. Before, the h() path
// threw on an object followed by null (`prop in null`), left the style as it
// was for undefined, and the compiled path kept a string's declarations under
// the object that followed it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { signal, flushSync, mount, hydrate, h } = await import('what-framework');
const { renderToHydratableString } = await import('../../server/src/index.js');

const VALUES = {
  object: { color: 'red', fontWeight: 'bold' },
  other: { color: 'blue' },
  string: 'margin-top: 4px; color: green',
  null: null,
  undefined,
};

const source = `
  export const Plain = (p) => <p style={p.s()}>x</p>;
  export const Spread = (p) => <p {...{ style: p.s }}>x</p>;
`;
const client = await loadCompiled(source);
const hydratable = await loadCompiled(source, { pluginOptions: { hydratable: true } });
const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });

const paths = {
  h: { view: (s) => h('p', { style: () => s() }, 'x') },
  compiled: { view: (s) => h(client.Plain, { s }), hydrated: (s) => h(hydratable.Plain, { s }), ssr: (s) => h(server.Plain, { s }) },
  spread: { view: (s) => h(client.Spread, { s }), hydrated: (s) => h(hydratable.Spread, { s }), ssr: (s) => h(server.Spread, { s }) },
};

// The inline style a fresh client render of `value` gives.
function fresh(value) {
  const host = document.createElement('div');
  const stop = mount(h('p', { style: value }, 'x'), host);
  const style = host.firstChild.getAttribute('style');
  stop();
  return style;
}

function run(start, next, render) {
  const s = signal(VALUES[start]);
  const host = document.createElement('div');
  document.body.append(host);
  const stop = render(s, host);
  try {
    s(VALUES[next]);
    flushSync();
    return host.querySelector('p').getAttribute('style');
  } finally {
    stop();
    host.remove();
  }
}

describe('a style binding moves between object, string, null and undefined', () => {
  const names = Object.keys(VALUES);
  for (const [path, { view, hydrated, ssr }] of Object.entries(paths)) {
    it(`on the ${path} path, mounted and hydrated`, () => {
      for (const start of names) {
        for (const next of names) {
          const want = fresh(VALUES[next]);
          assert.equal(run(start, next, (s, host) => mount(view(s), host)), want, `${path} mount: ${start} -> ${next}`);
          const hydrateView = hydrated ?? view;
          const serverView = ssr ?? view;
          const got = run(start, next, (s, host) => {
            host.innerHTML = renderToHydratableString(serverView(signal(VALUES[start])));
            return hydrate(hydrateView(s), host);
          });
          assert.equal(got, want, `${path} hydrate: ${start} -> ${next}`);
        }
      }
    });
  }
});
