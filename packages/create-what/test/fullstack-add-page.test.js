// A page of the fullstack template lives in three places: its module, the
// route table the server renders from, and the client's matchPage(), which
// hydrates it. A page the client does not match is rendered and never
// hydrated, with no warning, so the README says all three.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const createWhat = resolve(import.meta.dirname, '../index.js');

test('the fullstack README says where a new page goes, matchPage() included', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'create-what-add-page-'));
  try {
    const out = spawnSync(process.execPath, [createWhat, 'pages-app', '--template=fullstack', '--yes'], { cwd: workDir, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const appDir = join(workDir, 'pages-app');
    const [readme, client] = await Promise.all(['README.md', 'src/entry-client.js'].map((f) => readFile(join(appDir, f), 'utf8')));
    const section = readme.slice(readme.indexOf('## Adding a page'));
    assert.ok(readme.includes('## Adding a page'), 'README has an Adding a page section');
    for (const place of ['src/pages/', 'src/routes.js', 'matchPage()', 'src/entry-client.js']) {
      assert.ok(section.includes(place), `the section names ${place}`);
    }
    assert.match(client, /function matchPage\(pathname\)/, 'entry-client has the matchPage() the README names');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
