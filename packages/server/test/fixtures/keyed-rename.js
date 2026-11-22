// The rename action of action-state-keyed.test.js's compiled table, over the
// records the test hands it.
import { action } from '../../src/index.js';

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
