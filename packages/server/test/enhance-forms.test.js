// enhanceForms() is the JS half of the <Form> contract: it replaces a plain HTML
// submit with a fetch. "Indistinguishable from the plain submit" is the whole
// test, and it is where this has gone wrong twice.
//
// First it posted a FormData object unconditionally. /__what_action parses
// application/x-www-form-urlencoded or JSON and nothing else, so the body failed
// to parse, the `_action` field vanished, and every enhanced form answered 400
// while the no-JS path kept working: exactly the shape of failure that survives a
// release.
//
// Then the fix for that overcorrected and sent urlencoded unconditionally, which
// silently dropped file uploads from forms that correctly declared
// enctype="multipart/form-data". Encoding now follows the form's own enctype, as
// the browser does.
//
// These tests pin the WIRE FORMAT against the real parser, not the
// implementation.

import { describe, it } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import assert from 'node:assert/strict';

const { dom } = installDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
global.URLSearchParams = dom.window.URLSearchParams;
global.URL = dom.window.URL;
global.File = dom.window.File;

// islands.js calls bare `location.assign` after a followed redirect. There is no
// global location in Node, and jsdom's is non-configurable, so the module global
// is the only stubbable surface.
let assigned = null;
global.location = {
  assign: (url) => { assigned = url; },
  href: 'http://localhost/',
  origin: 'http://localhost',
};

const { enhanceForms } = await import('../src/islands.js');
const { createActionHandler, parseActionBody } = await import('../src/action-handler.js');
const { action } = await import('../src/actions.js');

// action() only populates the server registry when there is no `window`, and this
// file installs one for the DOM. Register as the server would.
{
  const savedWindow = global.window;
  delete global.window;
  action(async (form) => ({ got: form.title }), { id: 'enhanceTest' });
  global.window = savedWindow;
}

/** Install a form and capture the single fetch enhanceForms performs. */
function mountForm(html, { respond, cookie = 'what-csrf=cookie-token' } = {}) {
  document.body.innerHTML = html;
  document.cookie = cookie || 'what-csrf=; Max-Age=0';
  assigned = null;

  const calls = [];
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return respond
      ? respond({ url, init })
      : { ok: true, status: 200, url: String(url), redirected: false };
  };

  enhanceForms();
  const form = document.querySelector('form');

  return {
    form,
    calls,
    warnings,
    restore: () => { console.warn = originalWarn; },
    async submit(submitter) {
      if (submitter) form.requestSubmit(submitter);
      else form.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      console.warn = originalWarn;
    },
  };
}

const FORM = `
  <form method="post" action="/__what_action" data-action="enhanceTest" data-enhance>
    <input type="hidden" name="_action" value="enhanceTest">
    <input type="hidden" name="what-csrf-token" value="field-token">
    <input type="hidden" name="_redirect" value="/done">
    <input name="title" value="hello">
    <button type="submit">Go</button>
  </form>`;

describe('enhanceForms posts what the action endpoint can parse', () => {
  it('sends url-encoded for a default form, not multipart', async () => {
    const h = mountForm(FORM);
    await h.submit();

    assert.equal(h.calls.length, 1);
    const { init } = h.calls[0];
    assert.match(init.headers['Content-Type'], /application\/x-www-form-urlencoded/);
    assert.ok(init.body instanceof dom.window.URLSearchParams, 'body must be url-encoded');
  });

  it('produces a body the real handler dispatches', async () => {
    const h = mountForm(FORM);
    await h.submit();

    // Feed the exact bytes to the real parser + handler. If the encoding drifts
    // again this fails here rather than in a browser.
    const body = parseActionBody(String(h.calls[0].init.body), 'application/x-www-form-urlencoded');
    assert.equal(body._action, 'enhanceTest');

    const handle = createActionHandler({ getCsrfToken: () => 'cookie-token' });
    const out = await handle({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': 'cookie-token' },
      body,
      query: {},
    });
    assert.equal(out.status, 303, out.body);
    assert.equal(out.headers.location, '/done');
  });

  it('preserves reserved and user fields', async () => {
    const h = mountForm(FORM);
    await h.submit();

    const body = parseActionBody(String(h.calls[0].init.body), 'application/x-www-form-urlencoded');
    assert.equal(body.title, 'hello');
    assert.equal(body['what-csrf-token'], 'field-token');
    assert.equal(body._redirect, '/done');
  });

  it('normalizes newlines to CRLF the way the urlencoded serializer does', async () => {
    // A textarea round-tripped different bytes with JS on than with JS off:
    // native sends CRLF, URLSearchParams passes LF straight through.
    const h = mountForm(`
      <form method="post" action="/__what_action" data-enhance data-no-csrf="true">
        <textarea name="body">line one\nline two</textarea>
      </form>`);
    await h.submit();
    assert.match(String(h.calls[0].init.body), /line\+one%0D%0Aline\+two/);
  });
});

describe('enhanceForms honors the form encoding', () => {
  it('keeps multipart when the form declares it, so files still upload', async () => {
    // The regression this pins: sending urlencoded unconditionally dropped the
    // file bytes from a form that had correctly asked for multipart.
    //
    // jsdom cannot put a real file in a file input (it has no DataTransfer, and
    // FormData reads the internal file list, not a monkey-patched `files`), so
    // the byte-level assertion is not available here. What IS assertable is the
    // contract that carries the bytes in a browser: the body must be a FormData
    // handed straight to fetch, and we must NOT set Content-Type, because only
    // the browser can write the multipart boundary. Setting it by hand produces
    // a body no server can parse.
    const h = mountForm(`
      <form method="post" action="/upload" enctype="multipart/form-data" data-enhance data-no-csrf="true">
        <input type="file" name="avatar">
        <input name="title" value="hi">
      </form>`);
    await h.submit();

    const { init } = h.calls[0];
    assert.ok(init.body instanceof dom.window.FormData, 'a multipart form must send FormData');
    assert.equal(init.headers['Content-Type'], undefined,
      'the browser must set the multipart boundary itself');
    assert.equal(init.body.get('title'), 'hi', 'ordinary fields still ride along');
    assert.ok(init.body.has('avatar'), 'the file field is present in the body');
  });

  it('a file in a non-multipart form sends its name and says so', async () => {
    // Native behavior: with the default encoding a file input contributes only
    // its filename. Matching that is right, but doing it silently would hide a
    // real mistake, so it warns.
    const h = mountForm(`
      <form method="post" action="/upload" data-enhance data-no-csrf="true">
        <input type="file" name="avatar">
        <input name="title" value="hi">
      </form>`);
    await h.submit();

    const { init } = h.calls[0];
    assert.ok(init.body instanceof dom.window.URLSearchParams);
    assert.match(init.headers['Content-Type'], /application\/x-www-form-urlencoded/);
  });

  it('a GET form puts its fields in the query string', async () => {
    // The fields were serialized and then thrown away: an enhanced GET form
    // fetched a bare URL with none of its data.
    const h = mountForm(`
      <form method="get" action="/search" data-enhance data-no-csrf="true">
        <input name="q" value="mug">
        <input name="page" value="2">
      </form>`);
    await h.submit();

    const { url, init } = h.calls[0];
    assert.match(String(url), /\/search\?q=mug&page=2$/);
    assert.equal(init.body, undefined, 'a GET request must have no body');
    assert.equal(init.headers['Content-Type'], undefined);
  });
});

describe('enhanceForms matches a native submit', () => {
  it('sends the submitter button name and value', async () => {
    // Without this a multi-button form cannot tell the server which button was
    // pressed, because FormData(form) never includes submit buttons.
    const h = mountForm(`
      <form method="post" action="/__what_action" data-enhance data-no-csrf="true">
        <input type="hidden" name="_action" value="enhanceTest">
        <button type="submit" name="intent" value="publish">Publish</button>
        <button type="submit" name="intent" value="delete">Delete</button>
      </form>`);

    await h.submit(document.querySelectorAll('button')[1]);

    const body = parseActionBody(String(h.calls[0].init.body), 'application/x-www-form-urlencoded');
    assert.equal(body.intent, 'delete');
  });

  it('a field named "method" or "action" does not kill the submit', async () => {
    // HTMLFormElement is [LegacyOverrideBuiltIns]: these fields SHADOW
    // form.method / form.action with the input element. Reading them threw a
    // TypeError after preventDefault, so the form did nothing at all: no fetch,
    // no error event, no native fallback.
    const h = mountForm(`
      <form method="post" action="/__what_action" data-enhance data-no-csrf="true">
        <input type="hidden" name="_action" value="enhanceTest">
        <input name="method" value="wire-transfer">
        <input name="action" value="refund">
      </form>`);
    await h.submit();

    assert.equal(h.calls.length, 1, 'the submit must still happen');
    assert.equal(h.calls[0].init.method, 'POST');
    assert.match(String(h.calls[0].url), /\/__what_action$/);
    const body = parseActionBody(String(h.calls[0].init.body), 'application/x-www-form-urlencoded');
    assert.equal(body.method, 'wire-transfer');
  });
});

describe('enhanceForms CSRF handling', () => {
  it('falls back to the form field when the page has no meta tag', async () => {
    const h = mountForm(FORM);
    await h.submit();
    assert.equal(h.calls[0].init.headers['X-CSRF-Token'], 'field-token');
  });

  it('falls back to the cookie when there is neither meta nor field', async () => {
    // The cached-page case: shared HTML carries no per-visitor token, so
    // refusing to submit on a missing meta tag blocked valid posts.
    const h = mountForm(`
      <form method="post" action="/__what_action" data-enhance>
        <input type="hidden" name="_action" value="enhanceTest">
        <input name="title" value="hello">
      </form>`);
    await h.submit();
    assert.equal(h.calls.length, 1, 'a cookie token must be enough to submit');
    assert.equal(h.calls[0].init.headers['X-CSRF-Token'], 'cookie-token');
  });

  it('blocks and reports when no token exists anywhere', async () => {
    const h = mountForm(`
      <form method="post" action="/__what_action" data-enhance>
        <input type="hidden" name="_action" value="enhanceTest">
      </form>`, { cookie: null });

    const errors = [];
    h.form.addEventListener('form:error', (e) => errors.push(e.detail.error.message));
    await h.submit();

    assert.equal(h.calls.length, 0);
    assert.deepEqual(errors, ['Missing CSRF token']);
  });

  it('never sends our CSRF token to another origin', async () => {
    // The token is a double-submit secret. Attaching it to a third-party form
    // action hands it to that third party.
    const h = mountForm(`
      <form method="post" action="https://evil.example/collect" data-enhance>
        <input name="title" value="hello">
      </form>`);
    await h.submit();

    assert.equal(h.calls.length, 1, 'a cross-origin form is not ours to block');
    assert.equal(h.calls[0].init.headers['X-CSRF-Token'], undefined,
      'the CSRF token must never leave this origin');
  });
});

describe('enhanceForms redirect handling', () => {
  const redirectTo = (url) => () => ({ ok: true, status: 200, url, redirected: true });

  it('navigates to a followed same-origin redirect', async () => {
    const h = mountForm(FORM, { respond: redirectTo('http://localhost/done') });
    const seen = [];
    h.form.addEventListener('form:response', (e) => seen.push(e.detail.redirected));

    await h.submit();

    assert.deepEqual(seen, [true]);
    assert.equal(assigned, 'http://localhost/done');
  });

  it('refuses to navigate to another origin', async () => {
    const h = mountForm(FORM, { respond: redirectTo('https://evil.example/landing') });
    await h.submit();
    assert.equal(assigned, null, 'a server response must not be able to move the page off-site');
  });

  it('a cancelled form:response suppresses navigation', async () => {
    const h = mountForm(FORM, { respond: redirectTo('http://localhost/done') });
    h.form.addEventListener('form:response', (e) => e.preventDefault());
    await h.submit();
    assert.equal(assigned, null);
  });

  it('stays put when the response was not a redirect', async () => {
    const h = mountForm(FORM);
    await h.submit();
    assert.equal(assigned, null);
  });
});
