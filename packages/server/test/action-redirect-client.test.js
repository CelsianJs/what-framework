// A server action that redirects (getResponse().redirect('/posts/one') in the
// action), called from a mounted page: the endpoint answers 200 with the
// target in X-What-Redirect (a 3xx would be followed by fetch), and the client
// goes there once what the action revalidates has landed: through the mounted
// <Router>, not by loading the page again. A result without a redirect stays
// in place. This file never renders on the server: a process that has is a
// server to what-router, which then never navigates.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let core;
let router;
let server;
let form;
let data;
const posts = [];
let refetch = null;

before(async () => {
  env = installDOM('<!DOCTYPE html><html><body><main></main></body></html>', { url: 'http://blog.test/publish' });
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    posts.push(body.args);
    const title = String(body.args[1].title);
    const headers = { 'content-type': 'application/json' };
    if (title.length < 3) return new Response(JSON.stringify({ error: 'Title needs three characters' }), { headers });
    return new Response(JSON.stringify({ saved: true }), { headers: { ...headers, 'x-what-redirect': '/posts/one' } });
  };
  core = await import('what-core');
  router = await import('what-router');
  data = await import('what-core/data');
  server = await import('../src/actions.js');
  form = await import('../src/form.js');
});
after(() => env.cleanup());

// Ticks, not settled(): that would wait for the refetch the test holds.
const until = async (done) => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe('a server action that redirects, with JavaScript', () => {
  it('navigates through the Router once its revalidation has landed; an error stays in place', async () => {
    const { h, mount, useActionState } = core;
    const publish = server.action(async () => null, { id: 'posts/publish', invalidates: [['posts']] });
    // The refetch the second submit's revalidation starts is held.
    let hold = false;
    const loadPosts = () => (hold ? new Promise((resolve) => { refetch = () => resolve(['one']); }) : Promise.resolve(['one']));
    function Editor() {
      const list = data.query(['posts'], loadPosts);
      const [state, dispatch] = useActionState(publish, null);
      return h(form.Form, { action: dispatch },
        h('p', { class: 'count' }, () => String(list().length)),
        h('input', { name: 'title', defaultValue: '' }),
        () => (state()?.error ? h('p', { role: 'alert' }, state().error) : null),
        h('button', { type: 'submit' }, 'Publish'));
    }
    const host = document.querySelector('main');
    const stop = mount(h(core.Suspense, { fallback: h('p', null, 'Loading') }, h(router.Router, {
      routes: [
        { path: '/publish', component: Editor },
        { path: '/posts/:slug', component: ({ params }) => h('h1', null, `Post ${params.slug}`) },
      ],
    })), host);
    await until(() => host.querySelector('form') !== null);
    const submit = (title) => {
      host.querySelector('[name=title]').value = title;
      host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    };

    submit('x');
    await until(() => host.querySelector('[role=alert]') !== null);
    assert.equal(host.querySelector('[role=alert]').textContent, 'Title needs three characters');
    assert.equal(location.pathname, '/publish');

    hold = true;
    submit('A new title');
    await until(() => refetch !== null);
    assert.deepEqual(posts.map((args) => args[1].title), ['x', 'A new title']);
    assert.equal(location.pathname, '/publish', 'not before the revalidation lands');
    refetch();
    await until(() => host.querySelector('h1') !== null);
    assert.equal(location.pathname, '/posts/one');
    assert.equal(host.querySelector('h1').textContent, 'Post one');
    stop();
  });
});
