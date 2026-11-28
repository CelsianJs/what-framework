// A process that imports what-server's Node entry is a server from its first
// line on, so a query cache used at import time, before the first render, is
// reported (ERR_QUERY_OUTSIDE_RENDER, the catalogue's own Bad example) and
// gets a cache no request shares (round 5, agent session F6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('prefetchQuery at import time in a Node server is ERR_QUERY_OUTSIDE_RENDER', () => {
  const script = `
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    await import('what-server');
    const { prefetchQuery, getQueryData } = await import('what-core/data');
    await prefetchQuery(['config'], async () => ({ a: 1 }));
    console.log(JSON.stringify({ reported: warnings.some((w) => w.includes('ERR_QUERY_OUTSIDE_RENDER')), shared: getQueryData(['config']) !== undefined }));
  `;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development' } });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout.trim().split('\n').pop()), { reported: true, shared: false });
});
