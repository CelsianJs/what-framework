import { useState } from 'what-framework';

export function Islands() {
  return (
    <div class="section">
      <div class="features-header">
        <p class="features-label">Architecture</p>
        <h1 class="features-title">Islands</h1>
        <p class="features-subtitle">
          Each section of a page can be independently static or dynamic.
          The Island component is now built into core. Ship zero JavaScript
          for static content, hydrate only what needs interactivity.
        </p>
      </div>

      {/* Static island example */}
      <div class="island-demo animate-fade-up">
        <span class="island-label">static — zero JS</span>
        <StaticNav />
      </div>

      {/* Idle-hydrate island */}
      <div class="island-demo animate-fade-up" style="animation-delay: 100ms">
        <span class="island-label">client:idle — hydrates when browser is idle</span>
        <SearchBar />
      </div>

      {/* Visible-hydrate island */}
      <div class="island-demo animate-fade-up" style="animation-delay: 200ms">
        <span class="island-label">client:visible — hydrates on scroll</span>
        <ProductGrid />
      </div>

      {/* Action-hydrate island */}
      <div class="island-demo animate-fade-up" style="animation-delay: 300ms">
        <span class="island-label">client:load — hydrates immediately</span>
        <CartWidget />
      </div>

      {/* Code example */}
      <div class="mt-12">
        <h2 class="section-title">How Islands Work</h2>
        <div class="code-block" style="max-width: none">
          <div class="code-header">
            <div class="code-dots">
              <span class="code-dot"></span>
              <span class="code-dot"></span>
              <span class="code-dot"></span>
            </div>
            <span class="code-filename">product-page.jsx</span>
          </div>
          <div class="code-content">
            <pre><code>{`// The Island component is built into core
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
// (no directive) — Static, never hydrate (zero JS)`}</code></pre>
          </div>
        </div>
      </div>

      <div class="mt-12">
        <h2 class="section-title">Hydration Directives</h2>
        <div class="features stagger-children">
          <HydrationMode name="client:load" desc="Hydrate immediately when the page loads. Use for above-the-fold interactive content." />
          <HydrationMode name="client:idle" desc="Hydrate when the browser is idle (requestIdleCallback). Good default for most islands." />
          <HydrationMode name="client:visible" desc="Hydrate when the element scrolls into the viewport (IntersectionObserver). Great for below-the-fold content." />
          <HydrationMode name="client:media" desc="Hydrate when a media query matches. Use for mobile-only or desktop-only interactive features." />
          <HydrationMode name="(no directive)" desc="Never hydrate. Pure static HTML. No JavaScript shipped to the client at all." />
        </div>
      </div>
    </div>
  );
}

// Simulated static nav
function StaticNav() {
  return (
    <nav style={{
      display: 'flex',
      gap: '1.5rem',
      padding: '1rem 1.25rem',
      background: 'var(--color-bg-subtle)',
      borderRadius: 'var(--radius-lg)',
      alignItems: 'center',
    }}>
      <span style={{ fontWeight: '700', color: 'var(--color-text)' }}>ShopWhat</span>
      <a href="#" class="nav-link">Products</a>
      <a href="#" class="nav-link">About</a>
      <a href="#" class="nav-link">Contact</a>
    </nav>
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

  return (
    <div>
      <input
        type="text"
        value={query}
        placeholder="Search products..."
        onInput={(e) => search(e.target.value)}
        style={{
          width: '100%',
          padding: '0.75rem 1rem',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          fontSize: 'var(--text-sm)',
          background: 'var(--color-surface)',
        }}
      />
      {() => results.length > 0
        ? <ul style={{ listStyle: 'none', marginTop: '0.75rem' }}>
            {() => results.map(r =>
              <li style={{
                padding: '0.5rem 0.75rem',
                color: 'var(--color-text-secondary)',
                background: 'var(--color-bg-subtle)',
                borderRadius: 'var(--radius-md)',
                marginBottom: '0.25rem',
              }}>{r}</li>
            )}
          </ul>
        : null
      }
    </div>
  );
}

// Simulated product grid
function ProductGrid() {
  const products = [
    { name: 'Headphones', price: 79 },
    { name: 'Keyboard', price: 129 },
    { name: 'Monitor', price: 349 },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
      {products.map(p =>
        <div style={{
          background: 'var(--color-bg-subtle)',
          padding: '1.5rem',
          borderRadius: 'var(--radius-lg)',
          textAlign: 'center',
        }}>
          <p style={{ fontWeight: '600', marginBottom: '0.25rem' }}>{p.name}</p>
          <p style={{ color: 'var(--color-accent)', fontWeight: '700' }}>{`$${p.price}`}</p>
        </div>
      )}
    </div>
  );
}

// Simulated cart widget
function CartWidget() {
  const [items, setItems] = useState(2);

  return (
    <div class="flex items-center gap-4">
      <span>Cart: <strong>{items}</strong> items</span>
      <button class="btn btn-primary" onClick={() => setItems(i => i + 1)}>Add Item</button>
      <button class="btn btn-secondary" onClick={() => setItems(i => Math.max(0, i - 1))}>Remove</button>
    </div>
  );
}

function HydrationMode({ name, desc }) {
  return (
    <div class="feature">
      <h3 class="feature-title">{name}</h3>
      <p class="feature-description">{desc}</p>
    </div>
  );
}
