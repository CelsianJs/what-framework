// A signal is handed wherever an accessor is taken (`<For each={todos}>`,
// `untrack(count)`, `createSelector(selected)`), and the accessor's value type
// comes from the signal: TypeScript infers a function type's return from the
// LAST call signature of an overloaded type, so Signal<T> declares its read,
// `(): T`, after its write, `(value): void`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('a signal passed as an accessor gives its value type', () => {
  const diags = tscDiagnose({
    writeRoot: HERE,
    compilerOptions: { lib: ['ES2022', 'DOM'], jsx: 'react-jsx', jsxImportSource: 'what-framework' },
    files: {
      'signal-accessor-usage.tsx': `
        import { signal, useSignal, untrack, createSelector, use, For } from 'what-framework';
        import { mapArray } from 'what-framework/render';

        interface User { id: number; name: string }
        const users = signal<User[]>([]);
        const maybe = signal<User[] | null>(null);
        const count = signal(0);

        export const list = <For each={users}>{(u) => <li>{u.name}</li>}</For>;
        export const keyed = <For each={users} key={(u) => u.id}>{(u) => <li>{u().name}</li>}</For>;
        export const nullable = <For each={maybe}>{(u) => <li>{u.name}</li>}</For>;
        export function Rows() {
          const rows = useSignal<User[]>([]);
          return <For each={rows}>{(u) => <li>{u.name}</li>}</For>;
        }
        mapArray(users, (u) => document.createTextNode(u.name));

        const n: number = untrack(count);
        const isSelected = createSelector(count);
        const picked: boolean = isSelected(2);
        const used: number = use(count);

        // Reading and writing still type-check as before.
        const read: number = count();
        count(5);
        count((c) => c + 1);
        count.set(6);
        // @ts-expect-error a number signal takes a number
        count('5');
        // @ts-expect-error a write returns nothing
        const written: number = count(5);

        export { n, picked, used, read, written };
      `,
    },
  });
  assert.deepEqual(diags.map((d) => `${d.line}: TS${d.code}: ${d.message}`), []);
});
