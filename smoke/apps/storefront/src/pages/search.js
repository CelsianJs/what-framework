// Search: SERVER shell, client-driven results.
//
// This is the react-query-shaped surface: useQuery caches by key, exposes
// loading/data, and invalidateQueries(['products']) refetches every key beneath
// that prefix. The prefix behaviour is the part worth proving, because passing
// an array key used to silently do nothing at all.

import { h, Head, signal, useQuery, invalidateQueries, debounce } from 'what-framework';
import { Header, Footer } from '../components/chrome.js';
import { formatPrice } from '../store/cart.js';

export const page = { mode: 'server' };

export const loader = async () => ({ ok: true });

async function fetchSearch(term) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
  if (!res.ok) throw new Error(`search failed (${res.status})`);
  return res.json();
}

export default function Search() {
  const term = signal('', 'search:term');
  const refetches = signal(0, 'search:refetches');

  // Key is an ARRAY: ['products', 'search', term]. invalidateQueries(['products'])
  // must reach it as a prefix.
  const query = useQuery({
    queryKey: ['products', 'search', () => term()],
    queryFn: async () => {
      refetches((n) => n + 1);
      return fetchSearch(term());
    },
    staleTime: 0,
  });

  const onInput = debounce((event) => term(event.target.value), 80);

  return h('div', { class: 'page' },
    h(Head, { title: 'Search | Smoke Supply Co.' }),
    h(Header, { current: 'search' }),
    h('main', { class: 'container' },
      h('h1', {}, 'Search'),
      h('label', { for: 'q' }, 'Find a product'),
      h('input', { id: 'q', 'data-search-input': '', type: 'search', placeholder: 'mug', oninput: onInput }),

      h('p', { class: 'muted' },
        h('span', { 'data-query-state': '' }, () => (query.isLoading() ? 'loading' : 'idle')),
        ' · fetches: ',
        h('span', { 'data-fetch-count': '' }, () => String(refetches())),
      ),

      h('button', {
        'data-invalidate': '',
        // The documented prefix shape. Everything under ['products', ...] refetches.
        onclick: () => invalidateQueries(['products']),
      }, 'Refresh results'),

      h('ul', { 'data-results': '' }, () => {
        const data = query.data();
        if (!data) return h('li', { class: 'muted' }, 'No results yet.');
        return data.map((p) =>
          h('li', { key: p.slug, 'data-result': p.slug },
            h('a', { href: `/product/${p.slug}` }, p.title),
            ' · ',
            formatPrice(p.price),
          ),
        );
      }),
    ),
    h(Footer, {}),
  );
}
