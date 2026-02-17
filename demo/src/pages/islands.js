import { h, useState } from 'what-framework';

export function Islands() {
  return h('div', { class: 'section' },
    h('div', { class: 'features-header' },
      h('p', { class: 'features-label' }, 'Architecture'),
      h('h1', { class: 'features-title' }, 'Islands'),
      h('p', { class: 'features-subtitle' },
        'Each section of a page can be independently static or dynamic. The Island component is now built into core. Ship zero JavaScript for static content, hydrate only what needs interactivity.',
      ),
    ),

    // Static island example
    h('div', { class: 'island-demo animate-fade-up' },
      h('span', { class: 'island-label' }, 'static — zero JS'),
      h(StaticNav),
    ),

    // Idle-hydrate island
    h('div', { class: 'island-demo animate-fade-up', style: 'animation-delay: 100ms' },
      h('span', { class: 'island-label' }, 'client:idle — hydrates when browser is idle'),
      h(SearchBar),
    ),

    // Visible-hydrate island
    h('div', { class: 'island-demo animate-fade-up', style: 'animation-delay: 200ms' },
      h('span', { class: 'island-label' }, 'client:visible — hydrates on scroll'),
      h(ProductGrid),
    ),

    // Action-hydrate island
    h('div', { class: 'island-demo animate-fade-up', style: 'animation-delay: 300ms' },
      h('span', { class: 'island-label' }, 'client:load — hydrates immediately'),
      h(CartWidget),
    ),

    // Code example
    h('div', { class: 'mt-12' },
      h('h2', { class: 'section-title' }, 'How Islands Work'),
      h('div', { class: 'code-block', style: 'max-width: none' },
        h('div', { class: 'code-header' },
          h('div', { class: 'code-dots' },
            h('span', { class: 'code-dot' }),
            h('span', { class: 'code-dot' }),
            h('span', { class: 'code-dot' }),
          ),
          h('span', { class: 'code-filename' }, 'product-page.jsx'),
        ),
        h('div', { class: 'code-content' },
          h('pre', null, h('code', null, `// The Island component is built into core
// Components without a client: directive are static (zero JS)

import { Island } from 'what-framework';
import { Search } from './islands/Search';
import { Cart } from './islands/Cart';
import { ProductFeed } from './islands/ProductFeed';

function ProductPage({ products }) {
  return (
    <div>
      <Nav />                          {/* Static — no JS shipped */}

      <Search                          {/* Hydrates when browser is idle */}
        client:idle
        placeholder="Search products..."
      />

      <ProductFeed                     {/* Hydrates when scrolled into view */}
        client:visible
        items={products}
        category="new"
      />

      <Cart client:load />             {/* Hydrates immediately on page load */}

      <Newsletter                      {/* Hydrates on mobile only */}
        client:media="(max-width: 768px)"
      />

      <Footer />                       {/* Static — no JS shipped */}
    </div>
  );
}

// Hydration directives:
// client:load    — Hydrate immediately
// client:idle    — requestIdleCallback
// client:visible — IntersectionObserver
// client:media="(query)" — Media query match
// (no directive) — Static, never hydrate (zero JS)`)),
        ),
      ),
    ),

    h('div', { class: 'mt-12' },
      h('h2', { class: 'section-title' }, 'Hydration Directives'),
      h('div', { class: 'features stagger-children' },
        mode('client:load', 'Hydrate immediately when the page loads. Use for above-the-fold interactive content.'),
        mode('client:idle', 'Hydrate when the browser is idle (requestIdleCallback). Good default for most islands.'),
        mode('client:visible', 'Hydrate when the element scrolls into the viewport (IntersectionObserver). Great for below-the-fold content.'),
        mode('client:media', 'Hydrate when a media query matches. Use for mobile-only or desktop-only interactive features.'),
        mode('(no directive)', 'Never hydrate. Pure static HTML. No JavaScript shipped to the client at all.'),
      ),
    ),
  );
}

// Simulated static nav
function StaticNav() {
  return h('nav', {
    style: {
      display: 'flex',
      gap: '1.5rem',
      padding: '1rem 1.25rem',
      background: 'var(--color-bg-subtle)',
      borderRadius: 'var(--radius-lg)',
      alignItems: 'center',
    },
  },
    h('span', { style: { fontWeight: '700', color: 'var(--color-text)' } }, 'ShopWhat'),
    h('a', { href: '#', class: 'nav-link' }, 'Products'),
    h('a', { href: '#', class: 'nav-link' }, 'About'),
    h('a', { href: '#', class: 'nav-link' }, 'Contact'),
  );
}

// Simulated search island
function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  const items = ['Wireless Headphones', 'USB-C Cable', 'Laptop Stand', 'Mechanical Keyboard', 'Monitor Light'];

  const search = (q) => {
    setQuery(q);
    if (q.length > 0) {
      setResults(items.filter(i => i.toLowerCase().includes(q.toLowerCase())));
    } else {
      setResults([]);
    }
  };

  return h('div', null,
    h('input', {
      type: 'text',
      value: query,
      placeholder: 'Search products...',
      onInput: (e) => search(e.target.value),
      style: {
        width: '100%',
        padding: '0.75rem 1rem',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        fontSize: 'var(--text-sm)',
        background: 'var(--color-surface)',
      },
    }),
    results.length > 0
      ? h('ul', { style: { listStyle: 'none', marginTop: '0.75rem' } },
          ...results.map(r => h('li', {
            style: {
              padding: '0.5rem 0.75rem',
              color: 'var(--color-text-secondary)',
              background: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-md)',
              marginBottom: '0.25rem',
            },
          }, r))
        )
      : null,
  );
}

// Simulated product grid
function ProductGrid() {
  const products = [
    { name: 'Headphones', price: 79 },
    { name: 'Keyboard', price: 129 },
    { name: 'Monitor', price: 349 },
  ];

  return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' } },
    ...products.map(p =>
      h('div', {
        style: {
          background: 'var(--color-bg-subtle)',
          padding: '1.5rem',
          borderRadius: 'var(--radius-lg)',
          textAlign: 'center',
        },
      },
        h('p', { style: { fontWeight: '600', marginBottom: '0.25rem' } }, p.name),
        h('p', { style: { color: 'var(--color-accent)', fontWeight: '700' } }, `$${p.price}`),
      )
    ),
  );
}

// Simulated cart widget
function CartWidget() {
  const [items, setItems] = useState(2);

  return h('div', { class: 'flex items-center gap-4' },
    h('span', null, 'Cart: ', h('strong', null, items), ' items'),
    h('button', {
      class: 'btn btn-primary',
      onClick: () => setItems(i => i + 1),
    }, 'Add Item'),
    h('button', {
      class: 'btn btn-secondary',
      onClick: () => setItems(i => Math.max(0, i - 1)),
    }, 'Remove'),
  );
}

function mode(name, desc) {
  return h('div', { class: 'feature' },
    h('h3', { class: 'feature-title' }, name),
    h('p', { class: 'feature-description' }, desc),
  );
}
