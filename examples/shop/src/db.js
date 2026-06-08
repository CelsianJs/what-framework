// Tiny in-memory store + cart for the demo. A real app would use a database;
// the loader/action contracts are identical either way.

const products = [
  { id: 'mug', name: 'Signal Mug', price: 1400, stock: 12, blurb: 'Holds coffee, reacts to nothing.' },
  { id: 'tee', name: 'No-VDOM Tee', price: 2800, stock: 30, blurb: 'Renders once. Wears forever.' },
  { id: 'cap', name: 'Fine-Grained Cap', price: 2200, stock: 0, blurb: 'Sold out — fine-grained demand.' },
];

// cart: id -> qty
const cart = new Map();

export function listProducts() {
  return products.map((p) => ({ ...p }));
}

export function getProduct(id) {
  const p = products.find((x) => x.id === id);
  return p ? { ...p } : null;
}

export function getCart() {
  const items = [];
  let total = 0;
  for (const [id, qty] of cart) {
    const p = getProduct(id);
    if (!p) continue;
    items.push({ ...p, qty, lineTotal: p.price * qty });
    total += p.price * qty;
  }
  return { items, total, count: [...cart.values()].reduce((a, b) => a + b, 0) };
}

export function addToCart(id, qty = 1) {
  if (!getProduct(id)) throw new Error('No such product');
  cart.set(id, (cart.get(id) || 0) + qty);
  return getCart();
}

export function removeFromCart(id) {
  cart.delete(id);
  return getCart();
}

// "Orders" view for the authed dashboard — derived from the cart for the demo.
export function listOrders() {
  return getCart().items.map((i) => ({ id: i.id, name: i.name, qty: i.qty, lineTotal: i.lineTotal }));
}
