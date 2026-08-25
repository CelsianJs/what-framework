// The revalidation registry binds ONE cache engine for the whole process, so it
// must not live in a module-level `let`: whether there is one instance of the
// module is a bundler's decision, not ours.
//
// Vura bundles its server entry and each API route separately. The entry
// inlined what-server and bound its private copy of the registry; each API
// route imported `what-framework/server` as an external and read a different
// copy, permanently null. `revalidateTag()` from an API route returned without
// error, its dev warning was suppressed by NODE_ENV=production, and every ISR
// purge silently did nothing — a page stayed stale until its own revalidate
// window expired. The self-host audit caught it as "A2: revalidateTag() purges
// the cache" failing while "A1: page is cached" passed.
//
// Loading the module twice under distinct specifiers is the closest a test can
// get to two bundled copies, and it is enough: with a module-level `let` the
// second instance sees null.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('the revalidation registry is process-wide, not per-module-instance', () => {
  it('a second instance of the module sees a handler bound through the first', async () => {
    const first = await import('../src/revalidation-registry.js');
    // A distinct specifier for the same file: Node keys the module cache by
    // resolved URL, so the query string forces a second, independent instance —
    // module-level state and all.
    const second = await import('../src/revalidation-registry.js?instance=2');

    assert.notEqual(first, second, 'the two imports must be different module instances');

    const purged = [];
    first.setRevalidationHandler({
      revalidatePath: async (p) => { purged.push(`path:${p}`); },
      revalidateTag: async (t) => { purged.push(`tag:${t}`); },
    });

    // Read it back through the OTHER instance, which is what an API route in a
    // separately-bundled file is doing.
    assert.ok(second.getRevalidationHandler(), 'second instance sees no handler');

    await second.revalidateTag('posts');
    await second.revalidatePath('/posts');

    assert.deepEqual(purged, ['tag:posts', 'path:/posts']);
  });

  it('still no-ops safely when nothing is bound', async () => {
    const mod = await import('../src/revalidation-registry.js?instance=3');
    mod.setRevalidationHandler(null);
    // Must not throw. The dev warning is behaviour, not contract, so it is not
    // asserted here.
    await mod.revalidateTag('nothing');
    await mod.revalidatePath('/nothing');
    assert.equal(mod.getRevalidationHandler(), null);
  });
});
