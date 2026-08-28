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
  renderPage,
  renderDocument,
  definePage,
  generateStaticPage,
  server,
} from 'what-server';

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
const stream: AsyncGenerator<string> = renderToStream(h(Greeting, { name: 'Alice' }));
const resolved = renderToStringAsync(h(Greeting, { name: 'Alice' }));

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

export { html, hydratable, withHead, stream, resolved, rendered, document_, staticHtml, ServerOnly, typedHtml };
