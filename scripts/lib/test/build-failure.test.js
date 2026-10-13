import { it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const target of ['core', 'router']) {
  it(`returns failure when the ${target} package cannot build`, () => {
    const fixture = mkdtempSync(join(tmpdir(), 'what-build-failure-'));
    try {
      mkdirSync(join(fixture, 'scripts'), { recursive: true });
      copyFileSync(new URL('../../build.js', import.meta.url), join(fixture, 'scripts/build.js'));
      writeFileSync(join(fixture, 'package.json'), JSON.stringify({ type: 'module' }));
      const esbuild = join(fixture, 'node_modules/esbuild');
      mkdirSync(esbuild, { recursive: true });
      writeFileSync(join(esbuild, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }));
      writeFileSync(join(esbuild, 'index.js'), `export async function build(options) {
        if ((options.outdir || options.outfile).replaceAll('\\\\', '/').includes('/${target}/')) {
          throw new Error('intentional fixture build failure');
        }
      }`);
      mkdirSync(join(fixture, 'packages/router/src'), { recursive: true });
      writeFileSync(join(fixture, 'packages/router/src/index.js'), 'export const value = 1;');
      const result = spawnSync(process.execPath, ['scripts/build.js'], { cwd: fixture, encoding: 'utf8' });
      assert.match(result.stderr, /intentional fixture build failure/);
      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stdout, /Done!/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}
