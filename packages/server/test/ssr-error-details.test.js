// Server error details stay on the server unless development is positively
// established (security review #4).
//
// The flag was `NODE_ENV !== 'production'`, and in the production bundle
// "no `process`", so a server started with no NODE_ENV, with
// NODE_ENV=staging, or on Workers without nodejs_compat wrote a database
// driver's message ("password authentication failed for user ... at
// db.internal:5432") into the page. A library's error code (a Postgres
// SQLSTATE) travelled in every mode.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverEntry = fileURLToPath(new URL('../src/index.js', import.meta.url));
const coreEntry = fileURLToPath(new URL('../../core/src/index.js', import.meta.url));

// Render a page whose resource fails with a driver error and whose component
// throws, in a fresh process with the given environment, and return what the
// page carries.
function renderIn(env, { removeProcess = false } = {}) {
  const script = `
    const core = await import(${JSON.stringify(coreEntry)});
    const server = await import(${JSON.stringify(serverEntry)});
    ${removeProcess ? 'delete globalThis.process;' : ''}
    const { h, Suspense, createResource } = core;
    function Db() {
      const [v, { error }] = createResource(() => Promise.reject(Object.assign(
        new Error('password authentication failed for user "app" at db.internal:5432'), { code: '28P01' })));
      return h('p', null, () => (error() ? 'failed' : v()));
    }
    function Broken() { throw new Error('secret at /srv/app/db.js:12'); }
    const page = { default: () => h(Suspense, { fallback: '...' }, h(Db, {}), h(Broken, {})) };
    const html = await server.renderDocument(page, {}, { onError: () => {} });
    const chunks = [];
    for await (const c of server.renderToStream(page.default(), { onError: () => {} })) chunks.push(c);
    console.log(JSON.stringify({ html, stream: chunks.join('') }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

describe('error details on the wire', () => {
  for (const [label, env] of [['no NODE_ENV', {}], ['NODE_ENV=staging', { NODE_ENV: 'staging' }], ['NODE_ENV=production', { NODE_ENV: 'production' }]]) {
    it(`${label}: no message and no library code reach the page`, () => {
      const { html, stream } = renderIn(env);
      for (const out of [html, stream]) {
        assert.doesNotMatch(out, /password authentication|db\.internal|secret at|\/srv\/app/);
        assert.doesNotMatch(out, /28P01/);
        assert.match(out, /An error occurred while rendering on the server\./);
        assert.match(out, /<!-- SSR Error -->/);
      }
    });
  }

  it('no `process` at all (Workers without nodejs_compat) is production too', () => {
    const { html, stream } = renderIn({ NODE_ENV: 'development' }, { removeProcess: true });
    for (const out of [html, stream]) {
      assert.doesNotMatch(out, /password authentication|secret at|28P01/);
    }
  });

  it('NODE_ENV=development shows the messages, still without a library code', () => {
    const { html, stream } = renderIn({ NODE_ENV: 'development' });
    for (const out of [html, stream]) {
      assert.match(out, /password authentication failed/);
      assert.match(out, /<!-- SSR Error: secret at \/srv\/app\/db\.js:12 -->/);
      assert.doesNotMatch(out, /28P01/);
    }
  });

  it('a framework ERR_* code travels in every mode', () => {
    const { stream } = (() => {
      const script = `
        const core = await import(${JSON.stringify(coreEntry)});
        const server = await import(${JSON.stringify(serverEntry)});
        const { h, Suspense } = core;
        function Never() { throw Promise.resolve(); }
        const chunks = [];
        for await (const c of server.renderToStream(h(Suspense, { fallback: 'f' }, h(Never, {})), { onError: () => {} })) chunks.push(c);
        console.log(JSON.stringify({ stream: chunks.join('') }));
      `;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { PATH: process.env.PATH, NODE_ENV: 'production' }, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout.trim().split('\n').pop());
    })();
    assert.match(stream, /"code":"ERR_SSR_SUSPENSE_TIMEOUT"/);
    assert.doesNotMatch(stream, /pending after 12 attempts/);
  });

  it('an error message cannot end the error comment early, even in development', async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const { renderToStream } = await import('../src/index.js');
      const { h } = await import('what-core');
      function Broken() { throw new Error('a --> <script>alert(1)</script> b'); }
      let out = '';
      for await (const chunk of renderToStream(h('main', null, h(Broken, {})), { onError: () => {} })) out += chunk;
      assert.doesNotMatch(out, /<script>/);
      assert.equal(out.match(/-->/g).length, 1, out);
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved;
    }
  });
});
