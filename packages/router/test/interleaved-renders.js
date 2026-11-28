// Overlapping server renders of one <Router>, for the per-request route state
// tests (server-request-state*.test.js). Each request is /items/<i>?q=tok<i>z#h<i>
// and reads its route state in a layout, in the page before and after an
// await, and in a <Suspense> boundary that renders after a query lands. The
// renders pause, then resume in an order unrelated to the one they started
// in; half of them stream.
//
// Each field read is reported as 'own' (this request's value), 'none' (no
// route state: what a read after an await sees without an async context
// provider) or what it was; `foreign` lists any other request's token that
// appears anywhere in the response.

import { withResolvers } from '../../../test-utils/with-resolvers.js';

const COUNT = 120;
const tokenOf = (i) => `tok${i}z`;

export async function renderInterleaved({ server, h, Suspense, query, Router, route, useParams, useSearch, useRoute }) {
  const gates = Array.from({ length: COUNT }, () => withResolvers());
  const entered = Array.from({ length: COUNT }, () => withResolvers());
  const read = () => [route.path, route.hash, route.url, useParams().id, useSearch().q, route.params.id, route.query.q, useRoute().path()].join(' ');
  const own = (i) => [`/items/${i}`, `#h${i}`, `/items/${i}?q=${tokenOf(i)}#h${i}`, i, tokenOf(i), i, tokenOf(i), `/items/${i}`].join(' ');
  const none = ['/', '', '/', '', '', '', '', '/'].join(' ');
  const Later = ({ id }) => {
    const ready = query(['later', id], async () => {
      await new Promise((resolve) => setTimeout(resolve, Number(id) % 7));
      return 'ready';
    });
    return h('span', null, () => ready());
  };
  const LaterReader = () => h('b', { class: 'later' }, read());
  const routes = [{
    path: '/items/:id',
    layout: ({ children }) => h('section', null, h('i', { class: 'layout' }, read()), children),
    component: async ({ params }) => {
      const before = read();
      entered[Number(params.id)].resolve();
      await gates[Number(params.id)].promise;
      return h('main', null,
        h('i', { class: 'before' }, before),
        h('i', { class: 'after' }, read()),
        h(Suspense, { fallback: h('em', null, 'loading') }, h(Later, { id: params.id }), h(LaterReader)));
    },
  }];
  const renders = Array.from({ length: COUNT }, async (_, i) => {
    const init = { request: new Request(`http://app.test/items/${i}?q=${tokenOf(i)}#h${i}`) };
    if (i % 2 === 0) return (await server.renderToStringAsync(h(Router, { routes }), init)).body;
    let html = '';
    for await (const chunk of server.renderToStream(h(Router, { routes }), init)) html += chunk;
    return html;
  });
  await Promise.all(entered.map((entry) => entry.promise));
  for (let n = 0; n < COUNT; n++) {
    gates[(n * 37) % COUNT].resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
  const bodies = await Promise.all(renders);
  const results = bodies.map((body, i) => {
    const text = body.replace(/<!--[^>]*-->/g, '').replace(/&amp;/g, '&');
    const field = (name) => {
      const found = new RegExp(`class="${name}"[^>]*>([^<]*)<`).exec(text);
      if (found === null) return 'missing';
      return found[1] === own(i) ? 'own' : found[1] === none ? 'none' : found[1];
    };
    const foreign = [...new Set(text.match(/tok\d+z/g) || [])].filter((token) => token !== tokenOf(i));
    return { i, foreign, fields: { layout: field('layout'), before: field('before'), after: field('after'), later: field('later') } };
  });
  return { results, client: { url: route.url, path: route.path, hash: route.hash, params: { ...route.params }, query: { ...route.query } } };
}
