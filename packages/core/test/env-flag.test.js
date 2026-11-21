// The development flag (src/env.js): resolved at runtime in the development
// tier, folded to a constant by a production build.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const envFile = fileURLToPath(new URL('../src/env.js', import.meta.url));

function flagWith({ nodeEnv, preamble = '' }) {
  const env = { ...process.env };
  delete env.NODE_ENV;
  if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
  const script = `${preamble}const { __DEV__ } = await import(${JSON.stringify(new URL('../src/env.js', import.meta.url).href)});` +
    'process.stdout.write(String(__DEV__));';
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
}

describe('__DEV__ in the development tier', () => {
  it('is on in plain Node and off under NODE_ENV=production', () => {
    assert.equal(flagWith({}), 'true');
    assert.equal(flagWith({ nodeEnv: 'development' }), 'true');
    assert.equal(flagWith({ nodeEnv: 'production' }), 'false');
  });

  it('obeys globalThis.__WHAT_DEV__ set before the framework loads, either way', () => {
    assert.equal(flagWith({ preamble: 'globalThis.__WHAT_DEV__ = false;' }), 'false');
    assert.equal(flagWith({ nodeEnv: 'production', preamble: 'globalThis.__WHAT_DEV__ = true;' }), 'true');
  });
});

describe('__DEV__ in the production tier', () => {
  it('folds to false, leaving no runtime detection behind', async () => {
    const result = await build({
      entryPoints: [envFile],
      bundle: true,
      minify: true,
      format: 'esm',
      write: false,
      logLevel: 'silent',
      define: { __WHAT_DEV__: 'false' },
    });
    const code = result.outputFiles[0].text;
    assert.doesNotMatch(code, /__WHAT_DEV__|import\.meta|process/);
    const { __DEV__ } = await import(`data:text/javascript,${encodeURIComponent(code)}`);
    assert.equal(__DEV__, false);
  });
});
