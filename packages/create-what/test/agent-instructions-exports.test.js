// The scaffold's agent instructions (and the skill generated from them) name
// what each what-framework entry exports: the root's async values and actions,
// and each subpath's kit. A name there that the entry does not export sends an
// agent to an import that fails; the guide said `/dom` had a `scheduler` for a
// release, and every scaffold carried it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRAMEWORK_BASICS } from '../agent-instructions.js';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

// `what-framework` has ... (`a`, `b`), and `/sub` (`c`, `d`): each entry the
// text names, with the backticked identifiers in the parentheses after it.
function namedExports(text) {
  const paragraph = text.split('\n').find((line) => line.startsWith('`what-framework` has'));
  assert.ok(paragraph, 'the instructions describe the entries');
  const out = [];
  const [root, kits] = paragraph.split('The domain kits are subpaths:');
  const rootNames = [...root.matchAll(/\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((n) => n[1]));
  out.push(['what-framework', rootNames]);
  for (const m of kits.matchAll(/`(?:what-framework)?\/([\w-]+)`(?:\s*\(([^)]*)\))?/g)) {
    out.push([`what-framework/${m[1]}`, m[2] ? [...m[2].matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((n) => n[1]) : []]);
  }
  return out;
}

test('every name the instructions list for an entry is an export of that entry', async () => {
  const entries = namedExports(FRAMEWORK_BASICS);
  assert.ok(entries.length >= 7, 'the root and its six kits');
  const missing = [];
  for (const [entry, names] of entries) {
    const mod = await import(entry);
    for (const name of names) if (!(name in mod)) missing.push(`${entry}: ${name}`);
  }
  assert.deepEqual(missing, []);
  assert.ok(entries.find(([entry]) => entry === 'what-framework/dom')[1].includes('scheduleRead'));
});
