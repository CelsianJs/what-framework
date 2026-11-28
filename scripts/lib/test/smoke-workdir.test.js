// smoke:clean stops only servers of the checkout it runs in. Another
// checkout's smoke run (another agent's, on the same machine) has a workdir of
// the same shape and is left alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKDIR_PREFIX, markWorkdir, startedBy, workdirOf } from '../smoke-workdir.mjs';

test('a server in a run workdir is the checkout\'s only when that checkout started the run', () => {
  const mine = mkdtempSync(join(tmpdir(), WORKDIR_PREFIX));
  const theirs = mkdtempSync(join(tmpdir(), WORKDIR_PREFIX));
  const unmarked = mkdtempSync(join(tmpdir(), WORKDIR_PREFIX));
  try {
    markWorkdir(mine, '/repos/what-fw');
    markWorkdir(theirs, '/repos/what-fw-other');
    for (const dir of [mine, theirs, unmarked]) mkdirSync(join(dir, 'storefront'));
    assert.equal(workdirOf(join(mine, 'storefront')), mine);
    assert.equal(startedBy(join(mine, 'storefront'), '/repos/what-fw'), true);
    assert.equal(startedBy(join(theirs, 'storefront'), '/repos/what-fw'), false, 'another checkout\'s run');
    assert.equal(startedBy(join(unmarked, 'storefront'), '/repos/what-fw'), false, 'a run with no marker');
  } finally {
    for (const dir of [mine, theirs, unmarked]) rmSync(dir, { recursive: true, force: true });
  }
});

test('a server inside the checkout is the checkout\'s; one in a sibling directory with the same prefix is not', () => {
  assert.equal(startedBy('/repos/what-fw/smoke/apps/storefront', '/repos/what-fw'), true);
  assert.equal(startedBy('/repos/what-fw', '/repos/what-fw'), true);
  assert.equal(startedBy('/repos/what-fw-other/smoke/apps/storefront', '/repos/what-fw'), false);
  assert.equal(startedBy('/elsewhere/app', '/repos/what-fw'), false);
  assert.equal(startedBy('', '/repos/what-fw'), false);
});
