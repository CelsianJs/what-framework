// Server-only "database". Never served to the browser (see SERVED_PREFIXES in
// server.js): pages import it lazily inside their loader, which only runs on
// the server.

const PRODUCTS = [
  { slug: 'aeron-mug', title: 'Aeron Mug', price: 1800, blurb: 'Ceramic, 12oz, dishwasher safe.', stock: 12, tags: ['kitchen'] },
  { slug: 'field-notes', title: 'Field Notes 3-pack', price: 1295, blurb: 'Graph paper, pocket sized.', stock: 40, tags: ['paper'] },
  { slug: 'desk-mat', title: 'Wool Desk Mat', price: 6500, blurb: 'Merino felt, 900x400mm.', stock: 5, tags: ['desk'] },
  { slug: 'cable-clip', title: 'Cable Clips (6)', price: 900, blurb: 'Silicone, adhesive backed.', stock: 0, tags: ['desk'] },
];

// Mutated by the addReview action so revalidation has something observable to
// prove: a cached page must show a review that did not exist when it was cached.
const REVIEWS = new Map();

export function listProducts() {
  return PRODUCTS.map(({ slug, title, price, blurb, stock }) => ({ slug, title, price, blurb, stock }));
}

export function getProduct(slug) {
  const p = PRODUCTS.find((x) => x.slug === slug);
  if (!p) return null;
  return { ...p, reviews: REVIEWS.get(slug) ?? [] };
}

export function productSlugs() {
  return PRODUCTS.map((p) => p.slug);
}

export function addReview(slug, body) {
  if (!PRODUCTS.some((p) => p.slug === slug)) throw new Error(`no such product: ${slug}`);
  const text = String(body ?? '').trim();
  if (!text) throw new Error('review body is required');
  const list = REVIEWS.get(slug) ?? [];
  list.push({ id: `r${list.length + 1}`, body: text.slice(0, 200) });
  REVIEWS.set(slug, list);
  return list;
}

export function searchProducts(q) {
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return listProducts();
  return listProducts().filter((p) => p.title.toLowerCase().includes(needle));
}
