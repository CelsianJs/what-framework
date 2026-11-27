// what-router's redirect() thrown in a server action redirects the call's
// response, as it redirects a render's: the endpoint answers X-What-Redirect
// (with JavaScript) and a 303 (without) to the path below the base, as for
// getResponse().redirect(), and the revalidation the action declares still
// runs. A Next.js action's redirect() works the same way. Before, the signal
// was the action's failure: a 500 "Action failed", and the error logged.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redirect } from 'what-router';
import { action, createRequestHandler, setRevalidationHandler } from '../src/index.js';

const revalidated = [];
action(async (fields) => {
  if (fields?.next === 'off-site') redirect('https://billing.example/portal');
  redirect('/login?from=action');
}, { id: 'router-redirect/login', revalidate: ['/account'] });

const json = (fields) => new Request('http://app.test/app/__what_action', { method: 'POST', headers: { 'content-type': 'application/json', 'x-what-action': 'router-redirect/login' }, body: JSON.stringify({ args: [fields ?? {}] }) });
const form = (body) => new Request('http://app.test/app/__what_action', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });

describe('redirect() from what-router in a server action', () => {
  it('redirects the call\'s response below the base, with and without JavaScript', async () => {
    const handle = createRequestHandler({ routes: [], basePath: '/app', csrf: false });
    setRevalidationHandler({ revalidatePath: async (path) => { revalidated.push(path); }, revalidateTag: async () => {} });
    const errors = [];
    const error = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      const called = await handle(json());
      assert.equal(called.status, 200);
      assert.equal(called.headers.get('x-what-redirect'), '/app/login?from=action');
      const posted = await handle(form('_action=router-redirect%2Flogin'));
      assert.equal(posted.status, 303);
      assert.equal(posted.headers.get('location'), '/app/login?from=action');
      const off = await handle(json({ next: 'off-site' }));
      assert.equal(off.headers.get('x-what-redirect'), 'https://billing.example/portal');
    } finally {
      console.error = error;
      setRevalidationHandler(null);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(revalidated, ['/account', '/account', '/account']);
  });
});
