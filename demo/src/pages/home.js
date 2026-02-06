import { h, useState } from '@what/core';
import { Link } from '@what/router';

export function Home() {
  const [count, setCount] = useState(0);

  return h('div', null,
    // Hero
    h('div', { class: 'hero' },
      h('h1', null, h('span', null, 'What'), ' Framework'),
      h('p', null, 'The closest framework to vanilla JS. Signals-based reactivity, islands architecture, zero-config file routing, and tiny bundles.'),
      h('div', { style: 'display:flex;gap:0.75rem;justify-content:center' },
        h(Link, { href: '/docs', class: 'btn btn-primary' }, 'Get Started'),
        h(Link, { href: '/demos', class: 'btn btn-outline' }, 'See Demos'),
      ),
    ),

    // Quick counter demo
    h('div', { class: 'counter-demo' },
      h('p', { style: 'color:var(--muted);font-size:0.85rem;margin-bottom:0.5rem' }, 'Interactive — zero reload'),
      h('div', { class: 'counter-controls' },
        h('button', { onClick: () => setCount(c => c - 1) }, '\u2212'),
        h('span', { class: 'counter-value' }, count),
        h('button', { onClick: () => setCount(c => c + 1) }, '+'),
      ),
    ),

    // Features
    h('div', { class: 'section' },
      h('h2', null, 'Why What?'),
      h('div', { class: 'features' },
        feature('Signals', 'Fine-grained reactivity. Only the DOM nodes that depend on changed data update. No diffing overhead.'),
        feature('Islands', 'Ship zero JS by default. Hydrate only the interactive parts — on idle, on visible, on interaction.'),
        feature('Tiny', 'Core runtime under 4kB gzipped. No virtual DOM. No compiler. Just JavaScript.'),
        feature('Familiar', 'React-like hooks (useState, useEffect, useMemo) backed by signals. Easy migration.'),
        feature('File Routing', 'Drop a .js file in pages/ and it becomes a route. Dynamic params with [slug]. Catch-all with [...rest].'),
        feature('Hybrid Rendering', 'Static, server, client, or hybrid — per page. Like Astro, but without the build step.'),
        feature('Server Components', 'Mark a component as server() and it renders to HTML with zero client JS.'),
        feature('No Config', 'Zero config to start. One config file when you need it. No webpack, no babel, no drama.'),
      ),
    ),

    // Code example
    h('div', { class: 'section' },
      h('h2', null, 'How it looks'),
      h('pre', null, h('code', null, `import { h, mount, signal } from 'what';

function Counter() {
  const count = signal(0);

  return h('div', null,
    h('p', null, 'Count: ', () => count()),
    h('button', {
      onClick: () => count.set(c => c + 1)
    }, 'Increment'),
  );
}

mount(h(Counter), '#app');`)),
    ),
  );
}

function feature(title, desc) {
  return h('div', { class: 'feature' },
    h('h3', null, title),
    h('p', null, desc),
  );
}
