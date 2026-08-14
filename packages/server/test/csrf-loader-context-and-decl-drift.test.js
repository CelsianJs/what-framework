// Four defects found auditing whatfw.com against the released 0.12.3. One is a
// runtime lie, three are declaration lies, and they fail the same way: the thing
// the developer was told to do compiles and runs, and then silently does
// nothing.
//
//   #20 <Form>'s dev warning said the per-request CSRF token "is passed to
//       loaders". No stock render path put it there, so a server-rendered form
//       shipped an empty hidden field and the no-JS submit got a silent 403 —
//       exactly the visitor progressive enhancement exists to serve. The
//       create-what scaffold had already hand-rolled its own renderRoute to
//       work around this (see the "passes csrfToken through to loaders" comment
//       in packages/create-what/index.js), which is the tell.
//   #19 ActionOptions omitted `revalidateTags` and `timeout`, both of which the
//       runtime reads. The documented `action(fn, { revalidateTags })` call was
//       a compile error, and revalidateTags is the only way to purge by tag
//       from an action declaration.
//   #46 PageCacheConfig declared `pollInterval` and no runtime code ever read
//       it: set it, get no error, get no regeneration.
//   #29 useState's first tuple element is a signal accessor, not a T, and
//       batch() returns undefined, not the callback's value.
//
// scripts/check-type-parity.mjs already gates export NAMES in both directions.
// Nothing gated the SHAPES, so these three lived in the .d.ts files for
// releases. The type assertions below drive the real TypeScript compiler over
// an in-memory probe module, and the cache one scans the shipped runtime for a
// reader, because a config key nobody reads cannot be caught by any compiler.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { h } from 'what-core';
import { createCacheEngine, createMemoryStore } from 'what-isr';

import { createRequestHandler } from '../src/adapter/core.js';
import { action } from '../src/actions.js';
import { Form, ACTION_ENDPOINT } from '../src/form.js';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');

// --- TypeScript probe harness -------------------------------------------
// The probe module is never written to disk: it is served from memory at a path
// inside this directory so node_modules resolution finds the workspace packages
// exactly as a consumer's build would.
function diagnose(name, source) {
  const probePath = join(HERE, name);
  const options = {
    strict: true,
    noEmit: true,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    // Check the probe's USE of the declarations, not the internals of every
    // .d.ts it pulls in (including third-party ones).
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, langVersion, onError, shouldCreate) => (
    file.endsWith(name)
      ? ts.createSourceFile(file, source, langVersion, true, ts.ScriptKind.TS)
      : getSourceFile(file, langVersion, onError, shouldCreate)
  );
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (file) => (file.endsWith(name) ? true : fileExists(file));
  const readFile = host.readFile.bind(host);
  host.readFile = (file) => (file.endsWith(name) ? source : readFile(file));

  const program = ts.createProgram([probePath], options, host);
  return ts.getPreEmitDiagnostics(program).map((d) => ({
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  }));
}

function summarize(diags) {
  return diags.map((d) => `TS${d.code}: ${d.message}`).join('\n');
}

// =========================================================================
// #20 — the per-request CSRF token has to reach the code that renders the form
// =========================================================================

const reviewAction = action(
  async (form) => ({ ok: true, comment: form.comment }),
  { id: 'csrf-thread-review' },
);

function serverRoute(loaderSpy) {
  return [{
    path: '/review',
    mode: 'server',
    page: { mode: 'server' },
    loader: (ctx) => {
      loaderSpy(ctx);
      return { csrfToken: ctx.csrfToken ?? '' };
    },
    component: ({ loaderData }) => h(
      Form,
      { action: reviewAction, csrfToken: loaderData.csrfToken, redirect: '/thanks' },
      h('input', { name: 'comment' }),
    ),
  }];
}

function cookieFrom(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/what-csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

describe('#20 the per-request CSRF token reaches the loader that renders the form', () => {
  it('hands the token to the loader of a directly-rendered route', async () => {
    let ctx = null;
    const handle = createRequestHandler({ routes: serverRoute((c) => { ctx = c; }) });

    const res = await handle(new Request('http://x/review'));
    const html = await res.text();
    const meta = html.match(/<meta name="what-csrf-token" content="([^"]+)">/);

    assert.ok(meta, 'the adapter embeds the token it minted as a meta tag');
    assert.ok(ctx, 'the loader ran');
    assert.equal(
      ctx.csrfToken,
      meta[1],
      'the loader must see the same token the page carries, or a form built from loader data is signed with nothing',
    );
  });

  it('completes a no-JS form post with the token the page rendered', async () => {
    const handle = createRequestHandler({ routes: serverRoute(() => {}) });

    // 1. A visitor with scripting off loads the page.
    const page = await handle(new Request('http://x/review'));
    const html = await page.text();
    const cookie = cookieFrom(page);
    assert.ok(cookie, 'the adapter set the double-submit cookie');

    const field = html.match(/name="what-csrf-token" value="([^"]*)"/);
    assert.ok(field, '<Form> rendered the hidden token field');
    assert.notEqual(field[1], '', 'the hidden field must carry the token, not an empty string');

    // 2. The browser submits it as a plain HTML form post.
    const body = new URLSearchParams({
      _action: 'csrf-thread-review',
      'what-csrf-token': field[1],
      _redirect: '/thanks',
      comment: 'nice',
    });
    const posted = await handle(new Request(`http://x${ACTION_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `what-csrf=${encodeURIComponent(cookie)}`,
      },
      body: String(body),
    }));

    assert.equal(
      posted.status,
      303,
      'the no-JS submit must be accepted (403 here is the silent failure this defect produces)',
    );
    assert.equal(posted.headers.get('location'), '/thanks');
  });

  // The other half of the contract, and the reason this cannot simply be
  // threaded everywhere: cached HTML is shared between visitors, so a
  // per-visitor token must never be rendered into it.
  it('does not hand a per-visitor token to a cached route', async () => {
    let ctx = null;
    const routes = [{
      path: '/cached',
      mode: 'static',
      page: { mode: 'static', revalidate: 60 },
      loader: (c) => { ctx = c; return { csrfToken: c.csrfToken ?? '' }; },
      component: () => h('main', {}, 'cached'),
    }];
    const handle = createRequestHandler({
      routes,
      cache: createCacheEngine({ store: createMemoryStore() }),
    });

    const res = await handle(new Request('http://x/cached'));
    const html = await res.text();

    assert.ok(ctx, 'the loader ran');
    assert.equal(ctx.csrfToken, undefined, "a shared cache entry must not be built from one visitor's token");
    assert.equal(/what-csrf-token/.test(html), false, 'and the cached HTML must not carry one');
  });

  it('warns about both halves of the contract when a server-rendered form has no token', () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      Form({ action: reviewAction, csrfToken: null });
    } finally {
      console.warn = original;
    }

    assert.equal(warnings.length, 1, 'the missing-token warning still fires');
    const [warning] = warnings;
    // Where the token comes from...
    assert.match(warning, /loader/i);
    // ...and where it deliberately does not, so nobody chases a token that a
    // shared cache entry is never going to have.
    assert.match(warning, /cached|static/i);
  });
});

// =========================================================================
// #19 — ActionOptions, and the rest of what-server/index.d.ts
// =========================================================================

describe('#19 what-server declarations describe the options the runtime reads', () => {
  it('accepts the documented action(fn, { id, revalidate, revalidateTags }) call', () => {
    const diags = diagnose('__probe-action-options.ts', `
      import { action } from 'what-server';
      export const createPost = action(async (title: string) => ({ title }), {
        id: 'createPost',
        revalidate: ['/posts'],
        revalidateTags: ['posts'],
        timeout: 5000,
      });
    `);
    assert.equal(diags.length, 0, `expected no diagnostics, got:\n${summarize(diags)}`);
  });

  it('accepts the options createActionHandler actually reads', () => {
    const diags = diagnose('__probe-action-handler.ts', `
      import { createActionHandler } from 'what-server';
      export const handler = createActionHandler({
        getCsrfToken: (req: any) => req.headers.cookie ?? null,
        skipCsrf: false,
        basePath: '/__what_action',
      });
    `);
    assert.equal(diags.length, 0, `expected no diagnostics, got:\n${summarize(diags)}`);
  });

  it('rejects an option createActionHandler never reads', () => {
    const diags = diagnose('__probe-action-handler-phantom.ts', `
      import { createActionHandler } from 'what-server';
      export const handler = createActionHandler({ csrfSecret: 'nothing reads this' });
    `);
    assert.ok(
      diags.some((d) => d.code === 2353 || d.code === 2561),
      `expected an excess-property error for a dead option, got:\n${summarize(diags) || '(no diagnostics)'}`,
    );
  });

  it('names the document option the request handler reads', () => {
    // The composition every example server.js performs, including a real
    // what-isr engine: closing the options object must not reject it.
    //
    // The route component here is a real `h(tag, props, children)` call, not the
    // `() => null as any` this probe was first written with. A component that
    // returns null (or h with literally empty props) is the ONE shape that
    // survives a `VNode`-typed return, so probing with it proves nothing about
    // the declaration and hid a regression that rejected every real page. See
    // the RouteDefinition probes below.
    const good = diagnose('__probe-request-handler.ts', `
      import { createRequestHandler } from 'what-server';
      import { createCacheEngine, createMemoryStore, createRevalidateWebhook } from 'what-isr';
      import { h } from 'what-core';

      const cache = createCacheEngine({ store: createMemoryStore() });
      export const handle = createRequestHandler({
        routes: [{
          path: '/',
          component: (p: any) => h('main', { class: 'page' }, p.loaderData.token),
          loader: (ctx) => ({ token: ctx.csrfToken }),
        }],
        cache,
        revalidateWebhook: createRevalidateWebhook(cache, { secret: 'sek' }),
        document: { lang: 'en', clientEntry: '/src/entry-client.js' },
        basePath: '',
        csrf: true,
      });
    `);
    assert.equal(good.length, 0, `expected no diagnostics, got:\n${summarize(good)}`);

    const phantom = diagnose('__probe-request-handler-phantom.ts', `
      import { createRequestHandler } from 'what-server';
      export const handle = createRequestHandler({ routes: [], documentOptions: { lang: 'en' } });
    `);
    assert.ok(
      phantom.some((d) => d.code === 2353 || d.code === 2561),
      `\`documentOptions\` is not read by the adapter and must not typecheck, got:\n${summarize(phantom) || '(no diagnostics)'}`,
    );
  });

  // --- Regression guards for the narrowing that came with these declarations ---
  //
  // Closing an open type is how this whole group removes declaration lies, and
  // it is also how the group can create one. `routes` went from `any[]` to
  // `RouteDefinition[]`, and the component was first typed
  // `(props: any) => VNode | null`. That looked right and was not: `VNode`
  // defaults to `VNode<Record<string, any>>`, `h<P>` returns `VNode<P>`, and
  // `VNode<P>` carries P through `tag: string | Component<P>` where
  // `Component<P>` is contravariant in props under strictFunctionTypes. The net
  // effect is an invariant `VNode<P>`: `h('div', { class: 'x' })` returns
  // `VNode<{ class: string }>`, which is NOT assignable to bare `VNode`. Every
  // route component with any props at all became a TS2322 while
  // `component: () => null` still passed, so a probe written with `null as any`
  // reported the declaration healthy.
  //
  // These probes therefore use component shapes an app would actually ship: an
  // intrinsic tag with props, a child component with props, and the #20 form
  // itself. Runtime behaviour is unaffected either way, which is precisely why
  // only a compiler can catch it.
  it('accepts the route components real pages are built from', () => {
    const diags = diagnose('__probe-route-component-shapes.ts', `
      import { createRequestHandler, Form } from 'what-server';
      import type { RouteDefinition } from 'what-server';
      import { h } from 'what-core';

      function Card(props: { title: string }) { return h('section', {}, props.title); }

      // The #20 scenario itself: the CSRF token comes off loader data and goes
      // into <Form>. If this does not compile, the fix this file exists to prove
      // cannot be written in TypeScript.
      function Review(props: { loaderData: { token: string } }) {
        return h(Form, { action: 'review', csrfToken: props.loaderData.token });
      }

      export const routes: RouteDefinition[] = [
        { path: '/plain', component: () => h('div', { class: 'x' }, 'hi') },
        { path: '/card', component: () => h(Card, { title: 'hi' }) },
        { path: '/review', loader: (ctx) => ({ token: ctx.csrfToken ?? '' }), component: Review },
        { path: '/maybe', component: (p: any) => (p.loaderData ? h('div', { id: 'a' }, 'x') : null) },
      ];

      export const handle = createRequestHandler({ routes });
    `);
    assert.equal(diags.length, 0, `expected no diagnostics, got:\n${summarize(diags)}`);
  });

  // Same declaration, reached through the Workers entry, because that is the
  // path a deployed app takes and it inlines its own options object.
  it('accepts them through createCloudflareHandler too', () => {
    const diags = diagnose('__probe-route-component-cf.ts', `
      import { createCloudflareHandler } from 'what-server';
      import { h } from 'what-core';
      export default createCloudflareHandler({
        routes: [{ path: '/', component: () => h('main', { id: 'root' }, 'hi') }],
      });
    `);
    assert.equal(diags.length, 0, `expected no diagnostics, got:\n${summarize(diags)}`);
  });

  // Widening the return to `VNode<any>` must not widen it to "anything". A route
  // component that returns markup as a string is a real mistake the framework
  // already warns about at build time, so the declaration has to keep rejecting it.
  it('still rejects a route component that does not return a VNode', () => {
    for (const [label, body] of [
      ['a raw HTML string', `() => '<h1>raw</h1>'`],
      ['a number', '() => 42'],
      ['a value that is not callable', `'<div>not a function</div>'`],
    ]) {
      const diags = diagnose(`__probe-route-component-bad-${label.replace(/\W+/g, '-')}.ts`, `
        import type { RouteDefinition } from 'what-server';
        export const route: RouteDefinition = { path: '/', component: ${body} };
      `);
      assert.ok(
        diags.some((d) => d.code === 2322 || d.code === 2345),
        `a component returning ${label} must not typecheck, got:\n${summarize(diags) || '(no diagnostics)'}`,
      );
    }
  });

  // The other closed interface the same rewrite introduced, audited the same
  // way. `render` used to fall through an index signature as `any`, so closing
  // it turns any key left off the interface into a compile error. what-isr's
  // makeEntry reads `private`, `usedRequestHeaders` and `partial` off exactly
  // this object, and `private` is the switch that keeps a per-visitor render out
  // of the shared cache: the same hazard as the cached-token half of #20, and
  // one a developer would "fix" by deleting the key the compiler rejected.
  it('names every render-result key the cache engine reads', () => {
    const diags = diagnose('__probe-render-result.ts', `
      import type { RenderRouteResult } from 'what-server';
      export const out: RenderRouteResult = {
        html: '<main/>',
        status: 200,
        head: '<title>x</title>',
        state: { n: 1 },
        tags: ['posts'],
        path: '/',
        private: true,
        usedRequestHeaders: true,
        partial: true,
      };
    `);
    assert.equal(diags.length, 0, `expected no diagnostics, got:\n${summarize(diags)}`);

    // ...and the runtime really does read them, so none of the above is a
    // declaration with no reader (the #46 failure, in the other direction).
    const code = runtimeCode([join(REPO, 'packages', 'cache', 'src')]);
    for (const key of ['private', 'usedRequestHeaders', 'partial']) {
      assert.match(code, new RegExp(`out\\.${key}\\b`), `what-isr's makeEntry must read out.${key}`);
    }
  });

  // what-framework/server star-exports what-server AND what-server/islands into
  // one module, so any name added to either side can collide there. That is the
  // ambiguity the comment above the islands re-export block warns about.
  it('re-exports through what-framework/server without an ambiguous name', () => {
    const diags = diagnose('__probe-server-barrel.ts', `
      import { createRequestHandler, Form, hydrateIslands, renderDocument } from 'what-framework/server';
      import type { RequestHandlerOptions, RouteDefinition, DocumentOptions } from 'what-framework/server';
      export const options: RequestHandlerOptions = {
        routes: [] as RouteDefinition[],
        document: { lang: 'en' } as DocumentOptions,
      };
      export const handle = createRequestHandler(options);
      export { Form, hydrateIslands, renderDocument };
    `);
    assert.equal(diags.length, 0, `expected no diagnostics, got:\n${summarize(diags)}`);
  });
});

// =========================================================================
// #46 — a cache config key nothing reads
// =========================================================================

function jsSourcesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsSourcesUnder(full));
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

// Comments are stripped: a key mentioned only in prose has no reader, which is
// the exact failure mode being tested.
function runtimeCode(dirs) {
  return dirs
    .flatMap(jsSourcesUnder)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('#46 every declared page-cache option has a reader', () => {
  it('names no PageCacheConfig key the shipped runtime ignores', () => {
    const decl = readFileSync(join(REPO, 'packages', 'cache', 'index.d.ts'), 'utf8');
    const block = decl.match(/export interface PageCacheConfig \{([\s\S]*?)\n\}/);
    assert.ok(block, 'PageCacheConfig is declared');

    const keys = [...block[1].matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
    assert.ok(keys.length >= 5, `expected the config keys, parsed: ${keys.join(', ')}`);

    const code = runtimeCode([
      join(REPO, 'packages', 'cache', 'src'),
      join(REPO, 'packages', 'server', 'src'),
    ]);
    const dead = keys.filter((k) => !new RegExp(`\\b${k}\\b`).test(code));
    assert.deepEqual(
      dead,
      [],
      `declared on the public page config but read by nothing: ${dead.join(', ')}`,
    );
  });

  // The same audit over the rest of what-isr's surface, driven from the caller's
  // side: this is the poll-regeneration flow `pollInterval` claimed to automate,
  // written out by hand. Before the fix it failed five ways at once (no
  // `regenerate`, purges typed `void`, `maxConcurrent` unknown, a scheduler that
  // could not chain, buildCacheHeaders taking three arguments in the wrong
  // roles), which is why declaring one more key on top would not have helped.
  it('accepts the poll-regeneration flow the runtime supports', () => {
    const diags = diagnose('__probe-isr-flow.ts', `
      import {
        createCacheEngine, createMemoryStore, createScheduler, makeEntry, isFresh, buildCacheHeaders,
      } from 'what-isr';
      import type { CacheEntry, CacheStore, PageCacheConfig } from 'what-isr';

      const page: PageCacheConfig = { mode: 'static', revalidate: 60, swr: 30, tags: ['posts'] };
      const entry: CacheEntry = makeEntry({ html: '<main/>', status: 200, tags: ['posts'] }, page);
      export const fresh: boolean = isFresh(entry);
      export const headers: Record<string, string> = buildCacheHeaders(entry, page, 'HIT', ['cookie:session']);

      const store: CacheStore = createMemoryStore();
      const engine = createCacheEngine({ store });
      export async function warm(): Promise<void> {
        await engine.regenerate({ path: '/', query: {}, config: page });
        const purged: string[] = await engine.revalidateTag('posts');
        void purged;
        createScheduler(engine, { maxConcurrent: 2 })
          .register({ path: '/', query: {}, config: page }, { intervalMs: 300000 })
          .start()
          .stop();
      }
    `);
    assert.equal(diags.length, 0, `expected no diagnostics, got:\n${summarize(diags)}`);
  });
});

// =========================================================================
// #29 — two core declarations that contradict the implementation
// =========================================================================

describe('#29 core declarations match the reactive runtime', () => {
  it('types useState\'s first element as the signal accessor it returns', () => {
    const diags = diagnose('__probe-use-state.ts', `
      import { useState } from 'what-core';
      export function probe(): number {
        const [count, setCount] = useState(0);
        const now: number = count();
        setCount((c) => c + 1);
        return now;
      }
    `);
    assert.equal(diags.length, 0, `expected no diagnostics, got:\n${summarize(diags)}`);
  });

  it('types batch() as returning nothing, because it returns undefined', () => {
    const diags = diagnose('__probe-batch.ts', `
      import { batch, signal } from 'what-core';
      const a = signal(0);
      export const value: number = batch(() => { a(1); return 42; });
    `);
    assert.ok(
      diags.some((d) => d.code === 2322),
      `batch() returns undefined at runtime, so its result must not be assignable to number. Got:\n${summarize(diags) || '(no diagnostics)'}`,
    );
  });

  it('still accepts batch() as a statement', () => {
    const diags = diagnose('__probe-batch-ok.ts', `
      import { batch, signal } from 'what-core';
      const a = signal(0);
      const b = signal(0);
      export function bump(): void {
        batch(() => { a(1); b(2); });
      }
    `);
    assert.equal(diags.length, 0, `expected no diagnostics, got:\n${summarize(diags)}`);
  });
});
