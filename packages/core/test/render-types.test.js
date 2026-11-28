// Type-level checks for the rendering entry point as a consumer imports it:
// delegateEvents takes the root the docs show, what-framework/render declares
// the compiler helpers it exports, and classList and mapArray accept what the
// runtime accepts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('the rendering API type-checks as documented', () => {
  const diags = tscDiagnose({
    writeRoot: HERE,
    compilerOptions: { lib: ['ES2022', 'DOM'] },
    files: {
      'usage.ts': `
        import { signal } from 'what-framework';
        import { delegateEvents, classList, mapArray, _$createComponent, _$componentVNode, setClassList, applyRef } from 'what-framework/render';

        const shadow = document.createElement('div').attachShadow({ mode: 'open' });
        delegateEvents(['click']);
        delegateEvents(['click'], shadow);
        delegateEvents(['click', 'input'], document.createElement('section'));

        const active = signal(false);
        const el = document.createElement('div');
        classList(el, { on: () => active(), off: true });
        classList(el, () => ({ on: active() }));
        setClassList(el, { on: () => active() });

        const items = signal(['a', 'b']);
        mapArray(items, (item) => document.createTextNode(String(item)), { key: (item) => String(item), raw: true, loc: 'src/List.tsx:3:5' });

        const Row = (props: { id: string }) => document.createTextNode(props.id);
        _$createComponent(Row, { id: 'a' }, []);
        _$componentVNode(Row, { id: 'a' }, []);

        let input: Element | undefined;
        input = applyRef(input, el) as Element;
      `,
    },
  });
  assert.deepEqual(diags.map((d) => `${d.code}: ${d.message}`), []);
});
