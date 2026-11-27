// useRef takes React's typed forms: `useRef<HTMLInputElement>(null)` is a ref
// to an element that is null until it mounts, and `useRef<number>()` one that
// starts undefined.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('useRef takes an element type with null, or no initial value', () => {
  const diags = tscDiagnose({
    writeRoot: HERE,
    compilerOptions: { lib: ['ES2022', 'DOM'], jsx: 'react-jsx', jsxImportSource: 'what-framework' },
    files: {
      'use-ref-usage.tsx': `
        import { useRef, onMount } from 'what-framework';

        export function Search() {
          const input = useRef<HTMLInputElement>(null);
          const timer = useRef<number>();
          const count = useRef(0);
          onMount(() => {
            input.current?.focus();
            timer.current = window.setTimeout(() => {}, 10);
            count.current += 1;
          });
          const el: HTMLInputElement | null = input.current;
          const t: number | undefined = timer.current;
          // @ts-expect-error the element is null until the ref is attached
          const sure: HTMLInputElement = input.current;
          // @ts-expect-error a number ref holds numbers
          count.current = 'x';
          return <input ref={input} data-el={String(el)} data-t={String(t)} data-sure={String(sure)} />;
        }
      `,
    },
  });
  assert.deepEqual(diags.map((d) => `${d.line}: TS${d.code}: ${d.message}`), []);
});
