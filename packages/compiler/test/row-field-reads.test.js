// A keyed row's read of one field of its item names the field: `row.name`
// lowers to `_$item(cell, "name").name`, which what-core records as a read of
// that field while the row is built (a replaced item with the same `name`
// keeps the row). A read of the whole item, or of a method it calls, names
// none: the row takes the whole item, as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';

const out = compileJSX(`
export function L(props) {
  return <ul>{props.rows().map((row) => {
    const label = row.label;
    return <li key={row.id} title={row['title']} class={row.on ? 'on' : ''}>
      {label} <Row item={row} name={row.name} first={row.tags[0]} maybe={row?.maybe} /> {row.describe()} {format(row)}
    </li>;
  })}</ul>;
}`);

test('a member read of the row names its field', () => {
  assert.match(out, /const label = _\$item\(_item\$0, "label"\)\.label;/);
  assert.match(out, /_\$item\(_item\$0, "on"\)\.on \? 'on' : ''/);
  assert.match(out, /get name\(\) \{\s*return _\$item\(_item\$0, "name"\)\.name;/);
  assert.match(out, /_\$item\(_item\$0, "tags"\)\.tags\[0\]/, 'a nested read names its first field');
  assert.match(out, /_\$item\(_item\$0, "title"\)\["title"\]|_\$item\(_item\$0, "title"\)\.title|_\$item\(_item\$0, "title"\)\['title'\]/, 'a literal computed key');
  assert.match(out, /_\$item\(_item\$0, "maybe"\)\?\.maybe/, 'an optional read');
});

test('the whole item and method calls name no field', () => {
  assert.match(out, /get item\(\) \{\s*return _\$item\(_item\$0\);/);
  assert.match(out, /_\$item\(_item\$0\)\.describe\(\)/, 'a method may read any field through this');
  assert.match(out, /format\(_\$item\(_item\$0\)\)/);
  assert.doesNotMatch(out, /_\$item\(_item\$0, "id"\)/, 'the key expression reads the item the row was built from');
});
