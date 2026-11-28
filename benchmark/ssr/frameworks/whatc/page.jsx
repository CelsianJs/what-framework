// An ordinary page, compiled by what-compiler's server target: a storefront
// with a layout, context, a keyed list whose rows are components, reactive
// text and attributes, <Show>, an <ErrorBoundary>, a <Suspense> around a
// resource, an island and a form. page.mjs renders it to check that work on
// the table page (app.jsx) carries over to pages that are not one big list.
import { signal, computed, createContext, useContext, createResource, Suspense, ErrorBoundary, Show } from 'what-framework';

const ThemeCtx = createContext('light');
const CurrencyCtx = createContext('USD');

const NAV = [
  ['/', 'Home'], ['/shop', 'Shop'], ['/shop/new', 'New in'], ['/shop/sale', 'Sale'],
  ['/journal', 'Journal'], ['/about', 'About'], ['/help', 'Help'], ['/account', 'Account'],
];
const FOOTER = ['Shipping', 'Returns', 'Size guide', 'Gift cards', 'Careers', 'Press', 'Privacy', 'Terms', 'Cookies', 'Contact'];
const ADJECTIVES = ['Linen', 'Wool', 'Canvas', 'Oak', 'Brass', 'Ceramic', 'Glass', 'Leather'];
const NOUNS = ['shirt', 'throw', 'tote', 'stool', 'lamp', 'mug', 'carafe', 'wallet', 'apron', 'tray'];

export function buildProducts(count) {
  const products = new Array(count);
  for (let i = 0; i < count; i++) {
    products[i] = {
      id: 1000 + i,
      name: `${ADJECTIVES[i % ADJECTIVES.length]} ${NOUNS[(i * 7) % NOUNS.length]}`,
      blurb: `Made in small batches & finished by hand, no. ${i + 1}`,
      price: 1900 + ((i * 37) % 90) * 100,
      sale: i % 5 === 0,
      rating: 3 + (i % 3),
      colours: ['#1b1b1b', '#c8b6a6', '#5d7a68'].slice(0, 1 + (i % 3)),
      tags: i % 2 ? ['new', 'organic'] : ['staff pick'],
    };
  }
  return products;
}

function Price(props) {
  const currency = useContext(CurrencyCtx);
  return (
    <span class="price" data-currency={currency}>
      <Show when={props.sale} fallback={null}><s class="was">{(props.cents * 1.25 / 100).toFixed(2)}</s></Show>
      <b>{(props.cents / 100).toFixed(2)}</b> {currency}
    </span>
  );
}

function Stars(props) {
  return (
    <span class="stars" role="img" aria-label={`${props.value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => <i class={n <= props.value ? 'star on' : 'star'}></i>)}
    </span>
  );
}

function ProductCard(props) {
  const theme = useContext(ThemeCtx);
  const product = props.product;
  const qty = signal(1);
  const total = computed(() => qty() * product.price);
  return (
    <article class={props.selected() === product.id ? `card ${theme} selected` : `card ${theme}`} data-id={product.id}>
      <a class="thumb" href={`/shop/${product.id}`} title={product.name}>
        <img src={`/img/${product.id}.jpg`} alt={product.name} loading="lazy" width="320" height="320" />
      </a>
      <h3><a href={`/shop/${product.id}`}>{product.name}</a></h3>
      <p class="blurb">{product.blurb}</p>
      <Stars value={product.rating} />
      <Price cents={product.price} sale={product.sale} />
      <ul class="swatches">
        {product.colours.map((c) => <li class="swatch" style={{ backgroundColor: c }} aria-label={c}></li>)}
      </ul>
      <p class="tags">{product.tags.map((tag) => <span class="tag">{tag}</span>)}</p>
      <div class="buy">
        <button type="button" class="less" disabled={qty() <= 1} onClick={() => qty((q) => q - 1)}>-</button>
        <output class="qty">{qty()}</output>
        <button type="button" class="more" onClick={() => qty((q) => q + 1)}>+</button>
        <button type="button" class="add" onClick={() => props.onAdd(product.id, qty())}>Add, {(total() / 100).toFixed(2)}</button>
      </div>
    </article>
  );
}

function Filters(props) {
  return (
    <form class="filters" action="/shop" method="get">
      <label>Search <input type="search" name="q" value={props.query()} placeholder="Search the shop" /></label>
      <label>Sort
        <select name="sort" value={props.sort()}>
          <option value="new">Newest</option>
          <option value="low">Price, low to high</option>
          <option value="high">Price, high to low</option>
        </select>
      </label>
      <label><input type="checkbox" name="sale" checked={props.saleOnly()} /> On sale</label>
      <button type="submit">Apply</button>
    </form>
  );
}

function Reviews(props) {
  const [reviews] = createResource(props.load, { key: 'reviews' });
  return (
    <ul class="reviews">
      {(reviews() || []).map((r) => <li key={r.id}><b>{r.author}</b> <q>{r.text}</q></li>)}
    </ul>
  );
}

function CartButton(props) {
  const count = signal(props.count);
  return <button type="button" class="cart" onClick={() => count((c) => c + 1)}>Cart ({count()})</button>;
}

function Header(props) {
  return (
    <header class="site-header">
      <a class="logo" href="/">Storefront</a>
      <nav aria-label="Main">
        <ul>{NAV.map(([href, label]) => <li><a href={href} class={href === props.path ? 'current' : ''}>{label}</a></li>)}</ul>
      </nav>
      <CartButton client:idle count={props.cart} />
    </header>
  );
}

function Footer() {
  return (
    <footer class="site-footer">
      <ul>{FOOTER.map((label) => <li><a href={`/${label.toLowerCase().replace(/ /g, '-')}`}>{label}</a></li>)}</ul>
      <p class="legal">Prices include tax. Free shipping on orders over 80.00.</p>
    </footer>
  );
}

export function Page(props) {
  const selected = signal(props.selected);
  const query = signal('linen');
  const sort = signal('low');
  const saleOnly = signal(false);
  const shown = computed(() => props.products.length);
  const onAdd = () => {};
  return (
    <ThemeCtx.Provider value="dark">
      <div class="page">
        <Header path="/shop" cart={2} />
        <main>
          <h1>Shop</h1>
          <p class="count">{shown()} products</p>
          <Filters query={query} sort={sort} saleOnly={saleOnly} />
          <ErrorBoundary fallback={<p class="error">Something went wrong.</p>}>
            <CurrencyCtx.Provider value="EUR">
              <section class="grid">
                {props.products.map((product) => <ProductCard key={product.id} product={product} selected={selected} onAdd={onAdd} />)}
              </section>
            </CurrencyCtx.Provider>
          </ErrorBoundary>
          <Suspense fallback={<p class="loading">Loading reviews</p>}>
            <Reviews load={props.loadReviews} />
          </Suspense>
        </main>
        <Footer />
      </div>
    </ThemeCtx.Provider>
  );
}
