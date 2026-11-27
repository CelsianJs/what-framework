// A server action that returns nothing, called from a page: the call
// resolves with undefined, as the action returned, and a redirect it made
// (getResponse().redirect() and no return, the usual shape of an action that
// saves and moves on) is followed. Before, the endpoint's empty body
// made the call reject with "SyntaxError: Unexpected end of JSON input" and
// the redirect was never followed.
//
// The actions are defined before the DOM is installed, so the server half
// registers them; called once it is, they post as a page's code does.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getResponse } from 'what-core';
import { installDOM } from '../../../test-utils/dom.js';
import { action, createRequestHandler } from '../src/index.js';

const saved = [];
const save = action(async (fields) => { saved.push(fields.n); }, { id: 'no-result/save' });
const saveAndLeave = action(async () => { getResponse().redirect('/page#saved'); }, { id: 'no-result/leave' });

let env;
before(() => {
  const handle = createRequestHandler({ routes: [], csrf: false });
  env = installDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://app.test/page' });
  globalThis.fetch = async (url, init) => handle(new Request(new URL(url, location.href), init));
});
after(() => env.cleanup());

describe('a server action that returns nothing', () => {
  it('resolves with undefined', async () => {
    assert.equal(await save({ n: 1 }), undefined);
    assert.deepEqual(saved, [1]);
  });

  it('has the redirect it made followed', async () => {
    assert.equal(await saveAndLeave(), undefined);
    for (let i = 0; i < 20 && location.hash === ''; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(location.pathname + location.hash, '/page#saved');
  });
});
