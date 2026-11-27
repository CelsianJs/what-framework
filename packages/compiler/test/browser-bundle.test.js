// The Babel plugin also runs in a browser: sites/playground's compile worker
// bundles it with @babel/standalone. It is a module graph (babel-plugin.js,
// babel/*.js, what-core's markup rules), so it has to bundle as one, and the
// bundle has to run where there is no `process`, no `require` and no Node
// built-in.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { transformSync } from '@babel/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('compiler: browser bundle', () => {
  it('bundles for the browser and compiles both targets with no Node globals', async () => {
    const result = await build({
      entryPoints: [path.resolve(__dirname, '../src/babel-plugin.js')],
      bundle: true,
      format: 'iife',
      globalName: 'whatCompiler',
      platform: 'browser',
      write: false,
      logLevel: 'silent',
      // What a bundler does for the browser; the plugin reads NODE_ENV to
      // decide whether to print build warnings.
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const context = vm.createContext({ console });
    vm.runInContext(result.outputFiles[0].text, context);
    const plugin = context.whatCompiler.default;
    assert.equal(typeof plugin, 'function');

    const compile = (generate) => transformSync('const a = <p class="x">{count()}</p>;', {
      filename: 'playground.jsx',
      plugins: [[plugin, { generate }]],
      parserOpts: { plugins: ['jsx'] },
      configFile: false,
      babelrc: false,
    }).code;
    assert.match(compile('dom'), /_\$template\("<p class=x>"\)/);
    assert.match(compile('ssr'), /_\$ssr\(_tmpl\$0, \(\) => count\(\)\)/);
  });
});
