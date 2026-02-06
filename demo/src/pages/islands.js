import { h, useState } from '@what/core';

export function Islands() {
  return h('div', null,
    h('h1', null, 'Islands Architecture'),
    h('p', { style: 'color:var(--muted);margin-bottom:2rem' },
      'Each section of a page can be independently static or dynamic. The nav is static HTML. The cart is an island that hydrates on interaction. The content area can be fully dynamic.',
    ),

    // Static island example
    h('div', { class: 'island-demo' },
      h('span', { class: 'island-label' }, 'static — zero JS'),
      h(StaticNav),
    ),

    // Idle-hydrate island
    h('div', { class: 'island-demo', style: 'margin-top:1.5rem' },
      h('span', { class: 'island-label' }, 'island: idle — hydrates when browser is idle'),
      h(SearchBar),
    ),

    // Visible-hydrate island
    h('div', { class: 'island-demo', style: 'margin-top:1.5rem' },
      h('span', { class: 'island-label' }, 'island: visible — hydrates on scroll'),
      h(ProductGrid),
    ),

    // Action-hydrate island
    h('div', { class: 'island-demo', style: 'margin-top:1.5rem' },
      h('span', { class: 'island-label' }, 'island: action — hydrates on first click'),
      h(CartWidget),
    ),

    // Code example
    h('div', { class: 'section' },
      h('h2', null, 'How Islands Work'),
      h('pre', null, h('code', null, `// Define islands with hydration strategies
import { island, Island } from 'what/server';

// Register: name, loader, options
island('cart', () => import('./islands/cart.js'), {
  mode: 'action'  // Only hydrate on first interaction
});

island('search', () => import('./islands/search.js'), {
  mode: 'idle'    // Hydrate when browser is idle
});

island('products', () => import('./islands/products.js'), {
  mode: 'visible' // Hydrate when scrolled into view
});

// In your page template (SSR):
function ProductPage({ products }) {
  return h('div', null,
    h(Nav),              // Static — no JS shipped
    h(Island, {          // Interactive — hydrates on idle
      name: 'search',
      props: { placeholder: 'Search...' }
    }),
    h(Island, {          // Interactive — hydrates on scroll
      name: 'products',
      props: { items: products }
    }),
    h(Island, {          // Interactive — hydrates on click
      name: 'cart'
    }),
    h(Footer),           // Static — no JS shipped
  );
}`)),
    ),

    h('div', { class: 'section' },
      h('h2', null, 'Hydration Modes'),
      h('div', { class: 'features' },
        mode('load', 'Hydrate immediately when the page loads. Use for above-the-fold interactive content.'),
        mode('idle', 'Hydrate when the browser is idle (requestIdleCallback). Good default for most islands.'),
        mode('visible', 'Hydrate when the element scrolls into the viewport (IntersectionObserver). Great for below-the-fold content.'),
        mode('action', 'Hydrate on first user interaction (click, focus, hover). Perfect for widgets users might not interact with.'),
        mode('media', 'Hydrate when a media query matches. Use for mobile-only or desktop-only features.'),
        mode('static', 'Never hydrate. Pure HTML. No JavaScript shipped to the client at all.'),
      ),
    ),
  );
}

// Simulated static nav
function StaticNav() {
  return h('nav', { style: 'display:flex;gap:1rem;padding:0.75rem;background:#f1f5f9;border-radius:6px' },
    h('span', { style: 'font-weight:700' }, 'ShopWhat'),
    h('a', { href: '#', style: 'color:var(--muted);text-decoration:none' }, 'Products'),
    h('a', { href: '#', style: 'color:var(--muted);text-decoration:none' }, 'About'),
    h('a', { href: '#', style: 'color:var(--muted);text-decoration:none' }, 'Contact'),
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
      style: 'width:100%;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:6px;font-size:0.9rem',
    }),
    results.length > 0
      ? h('ul', { style: 'list-style:none;margin-top:0.5rem' },
          ...results.map(r => h('li', { style: 'padding:0.25rem 0;color:var(--muted)' }, r))
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

  return h('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem' },
    ...products.map(p =>
      h('div', { style: 'background:#f8fafc;padding:1rem;border-radius:6px;text-align:center' },
        h('p', { style: 'font-weight:600' }, p.name),
        h('p', { style: 'color:var(--accent);font-weight:700' }, `$${p.price}`),
      )
    ),
  );
}

// Simulated cart widget
function CartWidget() {
  const [items, setItems] = useState(2);

  return h('div', { style: 'display:flex;align-items:center;gap:1rem' },
    h('span', null, 'Cart: ', h('strong', null, items), ' items'),
    h('button', {
      class: 'btn btn-primary',
      style: 'font-size:0.8rem;padding:0.4rem 0.8rem',
      onClick: () => setItems(i => i + 1),
    }, 'Add Item'),
    h('button', {
      class: 'btn btn-outline',
      style: 'font-size:0.8rem;padding:0.4rem 0.8rem',
      onClick: () => setItems(i => Math.max(0, i - 1)),
    }, 'Remove'),
  );
}

function mode(name, desc) {
  return h('div', { class: 'feature' },
    h('h3', null, name),
    h('p', null, desc),
  );
}
