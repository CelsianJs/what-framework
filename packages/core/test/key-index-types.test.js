// The runtime hands every key function the item's index (render.js
// reconcileKeyed, what-server ssrList), so a key of item and position,
// `(item, i) => item + i`, type-checks wherever a key function is taken.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('a key function may take the index', () => {
  const diags = tscDiagnose({
    writeRoot: HERE,
    compilerOptions: { lib: ['ES2022', 'DOM'] },
    files: {
      'key-index-usage.ts': `
        import { For, h } from 'what-framework';
        import { mapArray, _$mapKeyed } from 'what-framework/render';
        import { ssrList, ssrFor } from 'what-server/ssr-runtime';

        const row = () => document.createElement('div');
        mapArray(['a'], row, { key: (item: string, i: number) => item + i });
        mapArray(['a'], row, { key: (item: string) => item });
        _$mapKeyed(() => ['a'], row, { key: (item: string, i: number) => item + i, follow: true });
        For({ each: ['a'], key: (item: string, i: number) => item + i, children: (item) => h('li', null, item()) });
        ssrList(['a'], (item) => item, true, (item: string, i: number) => item + i);
        ssrList(['a'], (item) => item, true, (item: string) => item, 3);
        ssrFor(['a'], (item) => item, (item: string, i: number) => item + i, null);
        // @ts-expect-error the index is a number
        mapArray(['a'], row, { key: (item: string, i: string) => item + i });
      `,
    },
  });
  assert.deepEqual(diags.map((d) => `${d.code}: ${d.message}`), []);
});
