// A strict TypeScript consumer of what-server, compiled by hygiene:types.
//
// Name parity says nothing about SHAPE, and shape is where the SSR entry points
// broke. `renderToString(vnode: VNode)` named a real export and matched the
// runtime perfectly, and was still unusable: `VNode<P>` carries P through
// `tag: string | Component<P>`, `Component<P>` is contravariant in its props
// under strictFunctionTypes, so `VNode<P>` is effectively invariant and
// `VNode<{ name: string }>` is NOT assignable to bare `VNode`. Every call below
// was a TS2345 in 0.13.4, starting with the first example on the SSR docs page.
//
// Nothing in the repo compiled a line of consumer code against these
// declarations, so the only way to see it was to install the packages.
import { h, type Component } from 'what-framework';
import {
  renderToString,
  renderToStream,
  renderToHydratableString,
  renderToStringWithHead,
  renderToStringAsync,
  createResponse,
  renderPage,
  renderDocument,
  definePage,
  generateStaticPage,
  server,
} from 'what-server';
import { action, csrfMetaTag } from 'what-server/actions';
import { matchRoute, parseQuery, type CompiledPath } from 'what-router/match';

// The SSR guide's first example, verbatim.
function Greeting({ name }: { name: string }) {
  return h('div', { class: 'greeting' },
    h('h1', {}, `Hello, ${name}!`),
    h('p', {}, 'Welcome to the site.'),
  );
}

const html: string = renderToString(h(Greeting, { name: 'Alice' }));
const hydratable: string = renderToHydratableString(h(Greeting, { name: 'Alice' }));
const withHead: { body: string; head: string } = renderToStringWithHead(h(Greeting, { name: 'Alice' }));
const stream: AsyncIterable<string> = renderToStream(h(Greeting, { name: 'Alice' }));
const resolved = renderToStringAsync(h(Greeting, { name: 'Alice' }));
// Its second argument is the render's inputs (README, renderToStringAsync).
const settled = renderToStringAsync(h(Greeting, { name: 'Alice' }), {
  loaderData: { greeting: 'hi' },
  signal: new AbortController().signal,
  response: createResponse(),
});

// A page module, the shape renderPage and renderDocument take.
const page = {
  default: (props: { name: string }) => h(Greeting, props),
  loader: () => ({ name: 'Alice' }),
};
const rendered = renderPage(page);
const document_ = renderDocument(page, { params: {} }, { lang: 'en' });

// definePage / generateStaticPage carry a component with real props too.
const config = definePage({
  title: 'Hello',
  component: (data?: { name: string }) => h(Greeting, { name: data?.name ?? 'Alice' }),
});
const staticHtml: string = generateStaticPage(config, { name: 'Alice' });

// server() marks a component server-only and must keep its props type.
const ServerOnly: (props: { name: string }) => unknown = server(Greeting);

// Component<P> is the other spelling users reach for.
const Typed: Component<{ name: string }> = ({ name }) => h('span', {}, name);
const typedHtml: string = renderToString(h(Typed, { name: 'Alice' }));

// The subpaths server adapters and the compiler's action transform import.
const save = action(async (title: string) => ({ saved: title.length }));
const saving: Promise<{ saved: number }> = save('draft');
const meta: string = csrfMetaTag('token');
const routes = [{ path: '/posts/:id', title: 'Post' }];
const matched = matchRoute('/posts/7', routes);
const postTitle: string | undefined = matched?.route.title;
const postId: string | undefined = matched?.params.id;
const query: Record<string, string> = parseQuery('?page=2');
const compiled: CompiledPath | null = null;

export { html, hydratable, withHead, stream, resolved, settled, rendered, document_, staticHtml, ServerOnly, typedHtml };
export { saving, meta, postTitle, postId, query, compiled };
