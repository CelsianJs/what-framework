import { mount, signal, computed } from 'what-framework';
import { useCartStore } from './cart-store.js';
import { products, formatPrice } from './products.js';

function CartBadge() {
  const count = useCartStore((s) => s.getItemCount());
  return (
    <span data-testid="cart-count" className="cart-badge">
      {count}
    </span>
  );
}

function CartSidebar({ onClose }) {
  const items = useCartStore((s) => s.items);
  const removeAll = useCartStore((s) => s.removeAll);
  const getTotal = useCartStore((s) => s.getTotal);

  const entries = Object.values(items);
  const total = getTotal();

  return (
    <aside data-testid="cart-sidebar" className="cart-sidebar">
      <div className="cart-header">
        <h2>Your Cart</h2>
        <button onClick={onClose} className="close-btn">X</button>
      </div>
      {entries.length === 0 ? (
        <p className="cart-empty">Your cart is empty</p>
      ) : (
        <>
          <ul className="cart-items">
            {entries.map((entry) => (
              <li key={entry.product.id} data-testid={`cart-item-${entry.product.id}`} className="cart-item">
                <span className="cart-item-emoji">{entry.product.emoji}</span>
                <div className="cart-item-info">
                  <span className="cart-item-name">{entry.product.name}</span>
                  <span className="cart-item-qty">Qty: {entry.quantity} - {formatPrice(entry.product.price * entry.quantity)}</span>
                </div>
                <button
                  data-testid={`remove-from-cart-${entry.product.id}`}
                  className="remove-btn"
                  onClick={() => removeAll(entry.product.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="cart-footer">
            <span data-testid="cart-total" className="cart-total">Total: {formatPrice(total)}</span>
          </div>
        </>
      )}
    </aside>
  );
}

function ProductCard({ product, onAdd }) {
  return (
    <div data-testid={`product-${product.id}`} className="product-card">
      <div className="product-emoji">{product.emoji}</div>
      <h3 className="product-name">{product.name}</h3>
      <p className="product-price">{formatPrice(product.price)}</p>
      <p className="product-category">{product.category}</p>
      <button
        data-testid={`add-to-cart-${product.id}`}
        className="add-btn"
        onClick={() => onAdd(product)}
      >
        Add to Cart
      </button>
    </div>
  );
}

// App renders through what-react, so it is a React component: it re-renders
// only when its React state changes, and What's hooks are not available in it.
// Its UI state lives in signals outside it, and the parts that show that state
// are function children, which What keeps up to date without a re-render.
const cartOpen = signal(false, 'cartOpen');
const search = signal('', 'search');

const filteredProducts = computed(() => {
  const q = search().toLowerCase().trim();
  if (!q) return products;
  return products.filter(
    (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
  );
});

function App() {
  const addItem = useCartStore((s) => s.addItem);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Shopping Cart</h1>
        <div className="header-actions">
          <input
            data-testid="search-input"
            type="text"
            placeholder="Search products..."
            onInput={(e) => search.set(e.target.value)}
            className="search-input"
          />
          <button data-testid="cart-toggle" className="cart-toggle" onClick={() => cartOpen.set((v) => !v)}>
            Cart <CartBadge />
          </button>
        </div>
      </header>

      <div data-testid="product-list" className="product-grid">
        {() => filteredProducts().map((product) => (
          <ProductCard key={product.id} product={product} onAdd={addItem} />
        ))}
      </div>

      {() => (cartOpen() ? <CartSidebar onClose={() => cartOpen.set(false)} /> : null)}
    </main>
  );
}

mount(<App />, '#app');
