import assert from 'node:assert/strict';
import { ensurePretext } from '../../src/text-engine.js';

const mode = process.argv[2];
const failures = await Promise.allSettled([ensurePretext(), ensurePretext(), ensurePretext()]);
for (const failure of failures) {
  assert.equal(failure.status, 'rejected', 'all concurrent callers must observe the import failure');
  assert.equal(failure.reason.code, 'ERR_PRETEXT_NOT_INSTALLED');
  assert.match(failure.reason.message, /npm install @chenglou\/pretext/);
  if (mode === 'broken') assert.match(failure.reason.message, /installed Pretext initialization failed/);
}

if (mode === 'retry') {
  const mod = await ensurePretext();
  assert.equal(typeof mod.prepareWithSegments, 'function', 'failed loading must clear the in-flight promise');
  assert.equal(typeof mod.layoutWithLines, 'function');
  assert.equal(await ensurePretext(), mod, 'a successful retry must be cached');
} else {
  await assert.rejects(ensurePretext(), { code: 'ERR_PRETEXT_NOT_INSTALLED' });
}
console.log(`pretext ${mode}: verified`);
