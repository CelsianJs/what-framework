// The response object createResponse() makes (what a loader gets as
// `response` and a component as getResponse()): its methods work when taken
// off it, `committed` is read-only, and only a response it made is accepted
// by a render, however closely another object copies one.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, getResponse } from 'what-core';
import { createResponse, renderToString, renderToStringAsync } from '../src/index.js';

describe('a response from createResponse()', () => {
  it('has methods that work taken off it, and a read-only committed', () => {
    const response = createResponse();
    const { setStatus, setHeader, redirect } = response;
    setStatus(404);
    setHeader('x-a', 1);
    setHeader('set-cookie', 'a=1');
    setHeader('set-cookie', 'b=2');
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('x-a'), '1');
    assert.deepEqual(response.headers.getSetCookie(), ['a=1', 'b=2']);
    redirect('/account?x=1');
    assert.deepEqual([response.status, response.location], [302, '/account?x=1']);

    assert.equal(response.committed, false);
    assert.throws(() => { /** @type {any} */ (response).committed = true; }, TypeError);
    let late = null;
    response._commit((location) => { late = location; });
    assert.equal(response.committed, true);
    setStatus(500);
    assert.equal(response.status, 302);
    response.redirect('/later', 303);
    assert.deepEqual([response.status, response.location, late], [302, '/account?x=1', '/later']);
  });

  it('is what a component sets status and headers on', () => {
    const response = createResponse();
    function Missing() {
      getResponse().setStatus(410);
      getResponse().setHeader('cache-control', 'no-store');
      return h('p', null, 'gone');
    }
    assert.equal(renderToString(h(Missing, {}), { response }), '<p>gone</p>');
    assert.equal(response.status, 410);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  it('is the only kind a render accepts', async () => {
    const real = createResponse();
    const copies = [{ ...real }, Object.create(Object.getPrototypeOf(real)), new Proxy(real, {}), Object.assign({}, real)];
    for (const response of copies) {
      await assert.rejects(renderToStringAsync(h('p', null, 'x'), { response }), (error) => error instanceof TypeError && /createResponse/.test(error.message));
    }
    assert.equal((await renderToStringAsync(h('p', null, 'x'), { response: real })).response, real);
  });
});
