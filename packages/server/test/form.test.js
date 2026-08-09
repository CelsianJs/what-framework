// <Form> connects the forms module to the no-JS server-action path. The path
// itself already worked and is covered by the scaffold smoke test; what was
// missing was any way to reach it without hand-writing four exact fields, one of
// which (`what-csrf-token`) fails silently when misspelled.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Form, ACTION_ENDPOINT } from '../src/form.js';
import { action } from '../src/actions.js';
import { renderToString } from '../src/index.js';
import { h } from 'what-core';

const createPost = action(async () => ({ ok: true }), { id: 'createPost' });

describe('<Form> emits a form the no-JS action path accepts', () => {
  it('posts to the action endpoint', () => {
    const html = renderToString(h(Form, { action: createPost, csrfToken: 't0ken' }));
    assert.match(html, /<form[^>]*method="post"/);
    assert.match(html, new RegExp(`action="${ACTION_ENDPOINT}"`));
  });

  it('carries the action id in the field the handler reads', () => {
    const html = renderToString(h(Form, { action: createPost, csrfToken: 't0ken' }));
    assert.match(html, /<input type="hidden" name="_action" value="createPost">/);
    assert.match(html, /data-action="createPost"/);
  });

  // The field name is exactly what action-handler.js accepts. Misspelling it is
  // the silent failure this component exists to prevent.
  it('carries the CSRF token under the name the handler accepts', () => {
    const html = renderToString(h(Form, { action: createPost, csrfToken: 't0ken' }));
    assert.match(html, /name="what-csrf-token" value="t0ken"/);
  });

  it('includes the redirect only when one is given', () => {
    const withRedirect = renderToString(h(Form, { action: createPost, csrfToken: 't', redirect: '/' }));
    assert.match(withRedirect, /name="_redirect" value="\/"/);

    const without = renderToString(h(Form, { action: createPost, csrfToken: 't' }));
    assert.equal(/_redirect/.test(without), false);
  });

  it('renders its children after the hidden fields', () => {
    const html = renderToString(
      h(Form, { action: createPost, csrfToken: 't' }, h('input', { name: 'title' }), h('button', {}, 'Go'))
    );
    assert.match(html, /<input name="title">/);
    assert.match(html, /<button>Go<\/button>/);
    assert.ok(html.indexOf('_action') < html.indexOf('name="title"'), 'hidden fields come first');
  });

  it('marks itself for client enhancement, and can opt out', () => {
    assert.match(renderToString(h(Form, { action: createPost, csrfToken: 't' })), /data-enhance/);
    const plain = renderToString(h(Form, { action: createPost, csrfToken: 't', enhance: false }));
    assert.equal(/data-enhance/.test(plain), false, 'a plain HTML form still works, by design');
  });

  it('passes through arbitrary form attributes', () => {
    const html = renderToString(
      h(Form, { action: createPost, csrfToken: 't', class: 'stack', id: 'new-post' })
    );
    assert.match(html, /class="stack"/);
    assert.match(html, /id="new-post"/);
  });
});

describe('<Form> refuses ambiguous actions rather than failing silently', () => {
  it('accepts a bare action id string', () => {
    const html = renderToString(h(Form, { action: 'someId', csrfToken: 't' }));
    assert.match(html, /value="someId"/);
  });

  it('rejects a function that is not a server action', () => {
    assert.throws(
      () => renderToString(h(Form, { action: () => {}, csrfToken: 't' })),
      /not a server action/
    );
  });

  it('rejects a missing action', () => {
    assert.throws(() => renderToString(h(Form, { csrfToken: 't' })), /requires an `action` prop/);
  });
});
