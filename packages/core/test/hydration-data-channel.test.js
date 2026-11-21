// The hydration data channel reader: one buffered element, any number of
// streamed ones, read as one payload, and owner keys that sort in document order.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let cleanup;
let data;

const shell = { loaderData: { page: 1 }, resources: { a: 1 }, owned: { '0:0': 'root' }, islandStores: { s: { n: 1 } } };
const fragment = { resources: { b: 2 }, owned: { '00:0': 'child' }, errors: { c: { message: 'no' } }, failed: { 1: { message: 'x' } } };

before(async () => {
  ({ cleanup } = installDOM(
    '<!DOCTYPE html><html><body>' +
    `<script id="__what_data" type="application/json">${JSON.stringify(shell)}</script>` +
    `<script type="application/json" data-what-data>${JSON.stringify(fragment)}</script>` +
    '</body></html>',
  ));
  data = await import('../src/hydration-data.js');
});
after(() => cleanup());

describe('hydration data channel', () => {
  it('merges the shell element and every streamed element', () => {
    data.__resetHydrationData();
    const merged = data.__readHydrationData();
    assert.deepEqual(merged.loaderData, { page: 1 });
    assert.deepEqual(merged.resources, { a: 1, b: 2 });
    assert.deepEqual(merged.owned, { '0:0': 'root', '00:0': 'child' });
    assert.deepEqual(merged.errors, { c: { message: 'no' } });
    assert.deepEqual(merged.failed, { 1: { message: 'x' } });
    assert.deepEqual(merged.islandStores, { s: { n: 1 } });
  });

  it('finds data from an element that arrived after the first read', () => {
    data.__resetHydrationData();
    assert.equal(data.getResource('late'), undefined);
    const el = document.createElement('script');
    el.type = 'application/json';
    el.setAttribute('data-what-data', '');
    el.textContent = JSON.stringify({ resources: { late: 'here' }, errors: { bad: { message: 'm', code: 'E' } } });
    document.body.appendChild(el);
    assert.equal(data.getResource('late'), 'here');
    assert.deepEqual(data.getResourceError('bad'), { message: 'm', code: 'E' });
    assert.equal(data.getLoaderData().page, 1);
  });

  it('keeps an explicit null value distinct from a missing one', () => {
    data.__resetHydrationData();
    const el = document.createElement('script');
    el.type = 'application/json';
    el.setAttribute('data-what-data', '');
    el.textContent = JSON.stringify({ resources: { nothing: null } });
    document.body.appendChild(el);
    assert.equal(data.getResource('nothing'), null);
    assert.equal(data.getResource('absent'), undefined);
  });

  it('ignores an element that is not valid JSON', () => {
    data.__resetHydrationData();
    const el = document.createElement('script');
    el.type = 'application/json';
    el.setAttribute('data-what-data', '');
    el.textContent = '{not json';
    document.body.appendChild(el);
    assert.equal(data.getResource('a'), 1);
  });
});

describe('owner paths and keys', () => {
  it('number children by position, with a length prefix past one digit', () => {
    const root = {};
    const app = {};
    data._assignOwnerPath(app, null, root);
    assert.equal(app._ownerPath, '0');
    const children = Array.from({ length: 40 }, () => ({}));
    for (const child of children) data._assignOwnerPath(child, app, root);
    assert.equal(children[0]._ownerPath, '00');
    assert.equal(children[35]._ownerPath, '0z');
    assert.equal(children[36]._ownerPath, '0A10');
    assert.equal(data._nextOwnerKey(children[36], root), '0A10:0');
    assert.equal(data._nextOwnerKey(children[36], root), '0A10:1');
    assert.equal(data._nextOwnerKey(null, root), ':0');
  });
});
