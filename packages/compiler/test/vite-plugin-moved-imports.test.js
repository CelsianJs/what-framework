// what-compiler/vite answers an import of a name the root entry no longer
// exports with that name's IMPORT_CHANGES answer (ERR_MOVED_IMPORT), in the
// build and in the dev transform, instead of the bundler's generic
// "is not exported" error.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMPORT_CHANGES } from 'what-core/internal';
import whatVitePlugin from '../src/vite-plugin.js';

const answer = (name) => IMPORT_CHANGES.find((c) => c.name === name).answer;
const OLD = "import { mount, signal, useFocusTrap, transition, getCollectedErrors } from 'what-framework';\nmount(<p>{signal(1)()}</p>, '#app');\nconsole.log(useFocusTrap, transition, getCollectedErrors);\n";

function transform(code, id = '/proj/src/main.jsx') {
  const plugin = whatVitePlugin();
  plugin.configResolved({ root: '/proj', command: 'build' });
  return () => plugin.transform.call({}, code, id);
}

describe('vite plugin: imports the root entry no longer exports', () => {
  it('fails with every such name and its answer, pointing at the first one', () => {
    assert.throws(transform(OLD), (err) => {
      assert.equal(err.code, 'ERR_MOVED_IMPORT');
      assert.equal(err.plugin, 'vite-plugin-what');
      assert.deepEqual(err.loc, { file: '/proj/src/main.jsx', line: 1, column: 24 });
      assert.match(err.message, /^\[what-compiler\] ERR_MOVED_IMPORT in src\/main\.jsx:/);
      for (const name of ['useFocusTrap', 'transition', 'getCollectedErrors']) {
        assert.ok(err.message.includes(`"${name}" is not exported by what-framework. ${answer(name)}`), name);
      }
      assert.doesNotMatch(err.message, /"(mount|signal)"/);
      return true;
    });
  });

  it('checks what-core\'s root entry, plain .js and .ts modules, and re-exports', () => {
    assert.throws(transform("import { useForm } from 'what-core';", '/proj/src/form.js'), /"useForm" is not exported by what-core\./);
    assert.throws(transform("import { spring } from 'what-framework';\nexport const s = spring(0);", '/proj/src/anim.ts'), /"spring" is not exported/);
    assert.throws(transform("export { Spinner as Busy } from 'what-framework';", '/proj/src/ui.js'), /"Spinner" is not exported/);
    assert.throws(transform("import { useTween } from 'what-framework';", '/proj/src/a.js'), /"useTween" is not exported by what-framework\./);
  });

  it('leaves alone root names, subpaths, type-only imports, quoted code and excluded files', () => {
    const fine = [
      ["import { signal, effect } from 'what-framework';\nexport const n = signal(0);", '/proj/src/state.js'],
      ["import { useTransition, startTransition } from 'what-framework';\nexport { useTransition, startTransition };", '/proj/src/async.js'],
      ["import { useForm } from 'what-framework/form';\nimport { useTween } from 'what-core/motion';\nexport { useForm, useTween };", '/proj/src/kits.js'],
      ["import type { useForm } from 'what-framework';\nimport { type Spinner } from 'what-framework';\nexport const x = 1;", '/proj/src/types.ts'],
      ["export const sample = \"import { useForm } from 'what-framework'\";", '/proj/src/docs.js'],
      ["import { useForm } from 'what-framework';", '/proj/node_modules/old-lib/index.js'],
    ];
    for (const [code, id] of fine) assert.doesNotThrow(transform(code, id), id);
  });
});

describe('vite plugin: moved imports through real Vite', () => {
  const what = fileURLToPath(new URL('../../what/src/index.js', import.meta.url));
  let root;

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'what-moved-imports-'));
    writeFileSync(path.join(root, 'index.html'), '<div id="app"></div><script type="module" src="/main.jsx"></script>');
    writeFileSync(path.join(root, 'main.jsx'), OLD);
  });

  after(() => rmSync(root, { recursive: true, force: true }));

  const config = () => ({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [whatVitePlugin({ prodBundles: false })],
    resolve: { alias: [{ find: /^what-framework$/, replacement: what }] },
  });

  it('vite build fails with the answers, not the bundler\'s "is not exported"', async () => {
    const { build } = await import('vite');
    await assert.rejects(build({ ...config(), build: { write: false } }), (err) => {
      assert.match(err.message, /ERR_MOVED_IMPORT/);
      assert.ok(err.message.includes(answer('useFocusTrap')));
      assert.doesNotMatch(err.message, /is not exported by "/);
      return true;
    });
  });

  it('the dev server\'s transform fails the same way', async () => {
    const { createServer } = await import('vite');
    const server = await createServer({ ...config(), server: { hmr: false, watch: null } });
    try {
      await assert.rejects(server.transformRequest('/main.jsx'), (err) => {
        assert.equal(err.code, 'ERR_MOVED_IMPORT');
        assert.ok(err.message.includes(answer('getCollectedErrors')));
        return true;
      });
    } finally {
      await server.close();
    }
  });
});
