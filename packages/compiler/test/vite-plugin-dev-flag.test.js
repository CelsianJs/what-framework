// what-compiler/vite makes every non-development build What's production tier
// by defining __WHAT_DEV__ (read by what-core/src/env.js), whether the build
// resolves the packages' dist or their source.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import whatVitePlugin from '../src/vite-plugin.js';

const configFor = (env, options) => whatVitePlugin(options).config.call({ meta: {} }, {}, env);

describe('vite plugin: development flag', () => {
  it('defines __WHAT_DEV__ as false for production builds, from dist or from source', async () => {
    for (const prodBundles of [true, false]) {
      const cfg = await configFor({ command: 'build', mode: 'production' }, { prodBundles });
      assert.deepEqual(cfg.define, { __WHAT_DEV__: 'false' });
    }
    const staging = await configFor({ command: 'build', mode: 'staging' });
    assert.deepEqual(staging.define, { __WHAT_DEV__: 'false' });
  });

  it('leaves the flag to runtime detection in dev servers and development builds', async () => {
    assert.equal((await configFor({ command: 'serve', mode: 'development' })).define, undefined);
    assert.equal((await configFor({ command: 'build', mode: 'development' })).define, undefined);
  });
});

describe('vite plugin: development metadata', () => {
  const SOURCE = "import { signal } from 'what-framework';\nexport function App() { const n = signal(0); return <p title={n()}><Row /></p>; }";
  const transform = (command, options) => {
    const plugin = whatVitePlugin(options);
    plugin.configResolved({ root: '/proj', command });
    return plugin.transform.call({}, SOURCE, '/proj/src/App.jsx').code;
  };

  it('names components, signals and bindings in the dev server, with paths relative to the root', () => {
    const code = transform('serve', { production: false });
    assert.match(code, /signal\(0, "n@src\/App\.jsx:2:35"\)/);
    assert.match(code, /_\$createComponent\(Row, null, \[\], "Row@src\/App\.jsx:2:68"\)/);
    assert.match(code, /name: "p\.title@src\/App\.jsx:2:56"/);
  });

  it('never names anything in a build, whatever NODE_ENV says', () => {
    for (const production of [false, true]) {
      assert.doesNotMatch(transform('build', { production }), /@src\/App\.jsx/);
    }
  });
});
