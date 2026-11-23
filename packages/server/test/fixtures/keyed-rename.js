// The rename action of action-state-keyed.test.js's compiled table, over the
// records the test hands it, and an editor of a record for its islands.
import { h, useActionState } from 'what-core';
import { action, Form } from '../../src/index.js';

let records = [];

export function setRecords(list) {
  records = list;
}

export const rename = action(async (_previous, fields) => {
  const title = String(fields.title ?? '');
  if (title.trim().length < 3) return { error: 'Title needs three characters', fields: { title } };
  const record = records.find((r) => r.id === fields.id);
  if (record) record.title = title;
  return { saved: true };
}, { id: 'records/compiled-rename' });

export function IslandEditor({ id }) {
  const [state, save] = useActionState(rename, null);
  return h(Form, { action: save, 'data-form': id },
    h('input', { type: 'hidden', name: 'id', value: id }),
    h('input', { name: 'title', defaultValue: () => state()?.fields?.title ?? '' }),
    () => (state()?.error ? h('p', { role: 'alert' }, state().error) : null));
}
