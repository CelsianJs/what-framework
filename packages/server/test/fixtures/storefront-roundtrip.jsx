import { computed, createResource, effect, Head, Island, signal, startTransition, Suspense, useLoaderData, useOptimistic } from 'what-framework';

export const loader = () => ({ customer: 'Ada' });
const products = [{ id: 'apple', name: 'Apple' }, { id: 'pear', name: 'Pear' }];

export function createStorefront({ fetchStock, fetchDelivery, fetchRating, saveLike, initialCustomer }) {
  function Customer() {
    return <p id="customer">{`Customer: ${useLoaderData()?.customer ?? initialCustomer ?? 'Guest'}`}</p>;
  }

  function Delivery() {
    const [delivery] = createResource(fetchDelivery, { key: 'delivery' });
    return <p id="delivery">{() => delivery() ?? 'Checking delivery'}</p>;
  }

  function Stock() {
    const [stock] = createResource(fetchStock);
    const rating = computed(({ signal }) => fetchRating(signal));
    return (
      <section id="stock">
        {() => stock() != null && <Head meta={{ name: 'description', content: stock() }} />}
        <p>{() => stock() ?? 'Checking stock'}</p>
        <p id="rating">{() => `Rated ${rating()}`}</p>
        <Suspense fallback={<p id="delivery-fallback">Checking delivery</p>}>
          <Delivery />
        </Suspense>
      </section>
    );
  }

  // An optimistic action: the count shows at once, and stays when the save
  // commits the real one. The write after the await is a transition of its
  // own, so it commits with the overlay's removal.
  function Likes() {
    const likes = signal(0, 'likes');
    const [shown, addLike] = useOptimistic(likes, (n, delta) => n + delta);
    const like = () => startTransition(async () => {
      addLike(1);
      await saveLike();
      startTransition(() => likes(n => n + 1));
    });
    return <button id="like" onClick={like}>{() => `Likes ${shown()}`}</button>;
  }

  function Cart() {
    const quantity = signal(0, 'cart quantity');
    return <button id="cart" onClick={() => quantity(n => n + 1)}>{() => quantity()}</button>;
  }

  function Storefront() {
    const rows = signal(products, 'products');
    const expanded = signal(true, 'details expanded');
    const name = signal('Ada', 'customer name');
    const clicks = signal(0, 'sort clicks');
    effect(function observeSort() { clicks(); });
    effect(function observeName() { name(); });
    const sort = () => {
      clicks(n => n + 1);
      rows(items => [...items].reverse());
      expanded(open => !open);
    };
    return (
      <main id="storefront">
        <Head title="Market" meta={{ name: 'application-name', content: 'Market' }} />
        <header><h1>Market</h1><Customer /></header>
        <button id="sort" onClick={sort}>{() => `Sort (${clicks()})`}</button>
        <ul id="products">{() => rows().map(row => <li key={row.id} id={row.id}>{row.name}</li>)}</ul>
        {() => expanded() && <aside id="details">Seasonal produce</aside>}
        <form id="order">
          <label for="name">Name</label>
          <input id="name" value={name} onInput={event => name(event.target.value)} />
          <output id="name-preview">{name}</output>
        </form>
        <Island component={Cart} mode="load" />
        <Likes />
        <Suspense fallback={<p id="stock-fallback">Checking stock</p>}>
          <Stock />
        </Suspense>
      </main>
    );
  }
  return Storefront;
}
