// Seeded, time-bounded versions of the functional review's randomized checks
// (concurrency-fuzz.mjs and stream-diff-fuzz.mjs), so the two properties they
// verified stay protected:
//
//   isolation  interleaved requests across every renderer never see each
//              other's context, loader data, resources, head, island stores,
//              headers or cookies, and leave no component frame or render
//              context behind;
//   one engine the buffered render (renderToStringAsync) is the streamed
//              render once every swap has run, with scripts and with
//              noScripts + applyStreamedBoundaries() (functional review M5).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as core from 'what-core';
import { getServerContext, __resetHydrationData } from 'what-core/internal';
import * as server from '../src/node.js';
import * as islands from '../src/islands.js';
import { collect } from './stream-helpers.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { h, Suspense, ErrorBoundary, createResource, createContext, useContext, useLoaderData, getResponse, Head } = core;

function random(seed) {
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  return { rnd, ri: (n) => Math.floor(rnd() * n) };
}

describe('isolation across interleaved requests', () => {
  const Ctx = createContext('NOCTX');
  const tok = (rid) => `RID${rid}X`;
  function Leaf() {
    const rid = useContext(Ctx);
    const ld = useLoaderData();
    getResponse().setHeader('x-rid', rid);
    getResponse().setHeader('set-cookie', `c=${rid}`);
    return h('span', null, `ctx:${rid} ld:${ld && ld.rid}`);
  }
  function Res({ ms, keyed }) {
    const rid = useContext(Ctx);
    const [v] = createResource(async () => { await delay(ms); return rid; }, keyed ? { key: 'k' } : {});
    return h('span', null, () => `res:${v()}|ctx:${useContext(Ctx)}`);
  }
  function ResTwice({ ms }) {
    const rid = useContext(Ctx);
    const [a] = createResource(async () => { await delay(ms); return rid; });
    const av = a();
    const [b] = createResource(async () => { await delay(ms); return `${av}+`; });
    return h('span', null, `two:${av}:${b()}`);
  }
  async function AsyncC({ ms }) {
    const rid = useContext(Ctx);
    await delay(ms);
    const sc = getServerContext();
    return h('span', null, `async:${rid}:ld=${sc && sc.loaderData && sc.loaderData.rid}`, h(Leaf, {}));
  }
  function Thrower() { throw new Error(`boom-${useContext(Ctx)}`); }
  function HeadC() { return h(Head, { title: tok(useContext(Ctx)) }); }
  function StoreC() {
    const rid = useContext(Ctx);
    const store = islands.useIslandStore('shared', { owner: 'none' });
    store.owner = rid;
    return h('i', null, `store:${store.owner}`);
  }

  function tree(r, depth, async, rid, streamy) {
    const kids = [];
    for (let i = 1 + r.ri(3); i > 0; i--) {
      const k = r.ri(async ? 9 : 5);
      const ms = r.ri(10);
      if (k === 0) kids.push(h(Leaf, {}));
      else if (k === 1) kids.push(h(HeadC, {}));
      else if (k === 2) kids.push(h('div', { 'data-r': tok(rid) }, depth > 0 ? tree(r, depth - 1, async, rid, streamy) : 'x'));
      else if (k === 3) kids.push(h(StoreC, {}));
      else if (k === 4) kids.push(h(ErrorBoundary, { fallback: ({ error }) => h('b', null, `eb:${error.message}`) }, h(Thrower, {})));
      else if (k === 5) kids.push(h(Suspense, { fallback: h('em', null, 'fb') }, h(Res, { ms, keyed: r.rnd() < 0.5 }), depth > 0 ? tree(r, depth - 1, async, rid, streamy) : null));
      else if (k === 6) kids.push(h(Suspense, { fallback: h('em', null, 'fb') }, streamy ? h(AsyncC, { ms }) : h(Res, { ms, keyed: true })));
      else if (k === 7) kids.push(h(Suspense, { fallback: h('em', null, 'fb') }, h(ResTwice, { ms })));
      else kids.push(h(ErrorBoundary, { fallback: h('b', null, 'eb2') }, h(Suspense, { fallback: h('em', null, 'fb') }, h(Res, { ms, keyed: false }))));
    }
    return kids;
  }

  const MARKERS = /RID(\d+)X|ctx:(\d+)|ld:(\d+)|res:(\d+)|async:(\d+)|store:(\d+)|two:(\d+)|c=(\d+)|ld=(\d+)/g;

  async function run(seed, count) {
    const r = random(seed);
    const failures = [];
    const check = (rid, kind, text) => {
      const others = [...String(text).matchAll(MARKERS)].map((m) => m.slice(1).find((x) => x !== undefined)).filter((x) => x !== String(rid));
      if (others.length) failures.push({ rid, kind, others: [...new Set(others)] });
    };
    async function one(rid) {
      const kind = r.ri(7);
      const body = tree(r, 2, kind >= 2, rid, kind === 3 || kind === 4 || kind === 6);
      const vnode = h(({ rid: id, body: content }) => h(Ctx.Provider, { value: id }, h('main', null, h(Leaf, {}), content)), { rid, body });
      const loaderData = { rid };
      try {
        if (kind === 0) return check(rid, 'string', server.renderToString(vnode));
        if (kind === 1) return check(rid, 'hydratable', server.renderToHydratableString(vnode));
        if (kind === 2) {
          const out = await server.renderToStringAsync(vnode, undefined, { onError: () => {} });
          return check(rid, 'async', out.body + out.head + JSON.stringify(islands.getIslandStoresSnapshot(out.ctx)) + JSON.stringify(out.owned) + JSON.stringify(out.resources));
        }
        const controller = new AbortController();
        if (r.rnd() < 0.2) setTimeout(() => controller.abort(), r.ri(15));
        if (kind === 3 || kind === 4) {
          let out = '';
          try { out = await collect(server.renderToStream(vnode, { loaderData, signal: controller.signal, onError: () => {} })); } catch { out = '[aborted]'; }
          return check(rid, 'stream', out);
        }
        const response = server.createResponse();
        const pageModule = { default: () => vnode, loader: async () => { await delay(r.ri(4)); return loaderData; } };
        if (kind === 5) {
          const html = await server.renderDocument(pageModule, { response, signal: controller.signal }, { onError: () => {} });
          return check(rid, 'doc', html + [...response.headers].join(';'));
        }
        const stream = await server.renderDocumentStream(pageModule, { response, signal: controller.signal }, { onError: () => {} });
        let out = '';
        try {
          await stream.shellReady;
          out = `H:${[...response.headers].join(';')}${await collect(stream)}`;
        } catch { out = '[aborted]'; }
        return check(rid, 'docstream', out);
      } catch (error) {
        if (error && error.name === 'AbortError') return undefined;
        failures.push({ rid, kind, error: String(error && error.stack || error) });
        return undefined;
      }
    }
    const jobs = [];
    for (let i = 0; i < count; i++) {
      jobs.push((async () => { await delay(r.ri(8)); await one(i); })());
      if (r.rnd() < 0.3) await Promise.resolve();
    }
    await Promise.all(jobs);
    return failures;
  }

  for (const seed of [1, 7, 19]) {
    it(`seed ${seed}: 60 interleaved requests stay isolated and leave nothing behind`, async () => {
      const warn = console.warn;
      console.warn = () => {};
      try {
        const failures = await run(seed, 60);
        assert.deepEqual(failures, []);
      } finally {
        console.warn = warn;
      }
      await delay(20);
      assert.equal(core.getOwner(), null, 'a component frame was left current');
      assert.equal(getServerContext(), null);
    });
  }
});

describe('the buffered render is the settled stream', () => {
  const Ctx = createContext('d');
  let uid = 0;

  function gen(r, depth) {
    const out = [];
    for (let i = r.ri(4); i > 0; i--) {
      const kid = () => (depth > 0 ? gen(r, depth - 1) : `leaf${r.ri(9)}`);
      switch (r.ri(12)) {
        case 0: out.push(`t${r.ri(100)}${r.rnd() < 0.2 ? ' <&>"\'' : ''}`); break;
        case 1: out.push(h('div', { class: `c${r.ri(3)}`, 'aria-hidden': r.rnd() < 0.5, 'data-x': r.rnd() < 0.5 ? false : 'y', hidden: r.rnd() < 0.5, style: { color: 'red' }, htmlFor: 'f', title: () => 'tt' }, kid())); break;
        case 2: out.push(kid()); break;
        case 3: { const v = kid(); out.push(r.rnd() < 0.5 ? null : () => v); break; }
        case 4: out.push(h(Ctx.Provider, { value: `p${r.ri(5)}` }, kid())); break;
        case 5: case 6: {
          const ms = r.ri(8);
          const keyed = r.rnd() < 0.5 ? `k${uid++}` : undefined;
          const fail = r.rnd() < 0.15;
          const label = `r${r.ri(99)}`;
          const R = () => {
            const [v, { error }] = createResource(async () => { await delay(ms); if (fail) throw new Error('rf'); return label; }, keyed ? { key: keyed } : {});
            return h('span', { 'data-l': label }, () => (error() ? 'ERR' : v()), ':', useContext(Ctx));
          };
          out.push(h(Suspense, { fallback: h('i', null, 'fb') }, h(R, {}), r.rnd() < 0.6 ? kid() : null));
          break;
        }
        case 7: {
          const ms = r.ri(6);
          const Twice = () => {
            const [a] = createResource(async () => { await delay(ms); return 'a'; });
            const x = a();
            const [b] = createResource(async () => { await delay(ms); return `${x}b`; });
            return h('u', null, x, b());
          };
          out.push(h(Suspense, { fallback: 'fb2' }, h(Twice, {}), kid()));
          break;
        }
        case 8: out.push(h(ErrorBoundary, { fallback: ({ error }) => h('b', null, `eb:${error.message}`) }, kid(), r.rnd() < 0.5 ? h(() => { throw new Error('t'); }, {}) : null)); break;
        case 9: out.push(h('ul', null, [1, 2, 3].map((j) => h('li', { key: j }, `li${j}`)))); break;
        case 10: out.push(h('br')); out.push(h('input', { value: 'v', disabled: true })); break;
        default: {
          const ms = r.ri(5);
          const Q = () => { const [v] = createResource(async () => { await delay(ms); return 'q'; }); return h('em', null, () => v()); };
          out.push(h(ErrorBoundary, { fallback: 'ebx' }, h(Suspense, { fallback: 'sfb' }, h(Q, {}))));
        }
      }
    }
    return out;
  }

  const withoutComments = (s) => s.replace(/<!--.*?-->/g, '');
  function parsed(html) {
    const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
    const out = dom.window.document.body.innerHTML;
    dom.window.close();
    return out;
  }
  function settled(html, noScripts) {
    const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`, noScripts ? {} : { runScripts: 'dangerously' });
    const doc = dom.window.document;
    if (noScripts) {
      const saved = globalThis.document;
      globalThis.document = doc;
      try {
        __resetHydrationData();
        core.applyStreamedBoundaries();
      } finally {
        if (saved === undefined) delete globalThis.document;
        else globalThis.document = saved;
      }
    }
    for (const el of doc.body.querySelectorAll('script, template')) el.remove();
    const out = doc.body.innerHTML;
    dom.window.close();
    return out;
  }

  for (const seed of [3, 11]) {
    it(`seed ${seed}: 40 random trees settle to the buffered body, with and without scripts`, async () => {
      const r = random(seed);
      const mismatches = [];
      for (let t = 0; t < 40; t++) {
        const tree = h('main', null, gen(r, 3));
        const buffered = await server.renderToStringAsync(tree, undefined, { onError: () => {} });
        const expected = withoutComments(parsed(buffered.body));
        const streamed = withoutComments(settled(await collect(server.renderToStream(tree, { onError: () => {} })), false));
        const noScripts = withoutComments(settled(await collect(server.renderToStream(tree, { noScripts: true, onError: () => {} })), true));
        if (streamed !== expected || noScripts !== expected) mismatches.push({ t, expected, streamed, noScripts });
      }
      assert.deepEqual(mismatches.slice(0, 2), []);
    });
  }
});
