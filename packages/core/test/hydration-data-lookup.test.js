// The hydration payload is read from script elements only (security review #7).
//
// The client read `document.getElementById('__what_data')`, so any element
// earlier in the body with a user-chosen id="__what_data" (a profile anchor, a
// heading slug) became the page's payload: forged loader data and resources.
// Page markup can carry any id or attribute, but it cannot create a script
// element, so only <script type="application/json"> elements are read.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let cleanup;
let data;

const real = { loaderData: { user: 'ann', isAdmin: false }, resources: { k: 'real' } };
const forged = { loaderData: { user: 'admin', isAdmin: true }, resources: { k: 'forged' } };

before(async () => {
  ({ cleanup } = installDOM(
    '<!DOCTYPE html><html><body>' +
    `<div id="__what_data">${JSON.stringify(forged)}</div>` +
    `<span data-what-data>${JSON.stringify({ resources: { k: 'forged-attr' } })}</span>` +
    `<script id="__what_data" type="text/plain">${JSON.stringify(forged)}</script>` +
    `<script id="__what_data" type="application/json">${JSON.stringify(real)}</script>` +
    '</body></html>',
  ));
  data = await import('../src/hydration-data.js');
});
after(() => cleanup());

describe('the hydration payload is located by element type', () => {
  it('an element that only carries the id or the attribute is ignored', () => {
    data.__resetHydrationData();
    assert.deepEqual(data.getLoaderData(), { user: 'ann', isAdmin: false });
    assert.equal(data.getResource('k'), 'real');
  });

  it('a streamed data element is read only when it is a JSON script', () => {
    data.__resetHydrationData();
    const div = document.createElement('div');
    div.setAttribute('data-what-data', '');
    div.textContent = JSON.stringify({ resources: { late: 'forged' } });
    document.body.appendChild(div);
    assert.equal(data.getResource('late'), undefined);
    const script = document.createElement('script');
    script.type = 'application/json';
    script.setAttribute('data-what-data', '');
    script.textContent = JSON.stringify({ resources: { late: 'real' } });
    document.body.appendChild(script);
    assert.equal(data.getResource('late'), 'real');
  });
});
