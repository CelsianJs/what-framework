// useFieldArray's types: the item type given to it types fields() (each item
// with its `id`) and what append, insert, update and replace take; it takes
// a form's `control`, or the form itself. useForm's unregister takes a name
// or names and React Hook Form's keep options.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('useFieldArray types its items and the operations on them', () => {
  const diags = tscDiagnose({
    writeRoot: HERE,
    compilerOptions: { lib: ['ES2022', 'DOM'], jsx: 'react-jsx', jsxImportSource: 'what-framework' },
    files: {
      'use-field-array-usage.tsx': `
        import { useForm, useFieldArray } from 'what-framework/form';

        interface Vehicle { vin: string; year: number }

        export function Vehicles() {
          const form = useForm<{ vehicles: Vehicle[] }>({ defaultValues: { vehicles: [] }, shouldUnregister: false });
          const { fields, append, prepend, insert, remove, move, swap, update, replace } = useFieldArray<Vehicle>({ control: form.control, name: 'vehicles' });
          const same = useFieldArray<Vehicle>({ form, name: 'vehicles' });
          append({ vin: 'A', year: 2020 });
          append([{ vin: 'B', year: 2021 }]);
          prepend({ vin: 'C', year: 2022 });
          insert(1, { vin: 'D', year: 2023 });
          remove();
          remove(0);
          remove([0, 1]);
          move(0, 1);
          swap(0, 1);
          update(0, { vin: 'E', year: 2024 });
          replace([]);
          same.append({ vin: 'F', year: 2025 });
          // @ts-expect-error an item takes the item type
          append({ vin: 1 });
          // @ts-expect-error useFieldArray takes a control or a form
          useFieldArray({ name: 'vehicles' });
          form.unregister('vehicles.0.vin');
          form.unregister(['a', 'b'], { keepValue: true, keepError: true, keepTouched: true, keepDefaultValue: true });
          form.unregister();
          // @ts-expect-error not an option of unregister
          form.unregister('a', { keepEverything: true });
          return (
            <ul>
              {fields().map((field, index) => {
                const id: string = field.id;
                const year: number = field.year;
                return <li key={id} data-year={year}><input {...form.register(\`vehicles.\${index}.vin\`, { shouldUnregister: true })} /></li>;
              })}
            </ul>
          );
        }
      `,
    },
  });
  assert.deepEqual(diags.map((d) => `${d.line}: TS${d.code}: ${d.message}`), []);
});
