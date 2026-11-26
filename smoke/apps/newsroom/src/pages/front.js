// Front page: mode 'server', streamed.
//
// The masthead and the page of stories (the loader) go out in the shell. The
// "most read" rail waits on a slow analytics query and the markets brief on a
// fast one; each sits in its own <Suspense>, so the shell is not held for
// either, and the markets brief (later in the page) arrives before the rail
// above it. The page number comes from the query string.

import { h, Head, Suspense, signal, useLoaderData } from 'what-framework';
import { query } from 'what-framework/data';
import { Footer, Masthead } from '../components/chrome.js';
import { PAGE_COUNT, pageOfStories, formatDate } from '../data/news.js';
import { source } from '../lib/source.js';

export const page = { mode: 'server' };

export function loader({ query: qs, response }) {
  const raw = qs.page ?? '1';
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= 1 && n <= PAGE_COUNT)) {
    response.setStatus(404);
    return { page: null, pages: PAGE_COUNT, stories: [] };
  }
  return { page: n, pages: PAGE_COUNT, stories: pageOfStories(n) };
}

function MostRead({ page }) {
  const items = query(() => ['most-read', page], (key, { signal }) => source.mostRead(key[1], signal));
  return h('ol', { class: 'most-read', 'data-most-read': String(page) },
    () => items().map((item) => h('li', { 'data-rank': String(item.rank) },
      h('a', { href: `/article/${item.slug}` }, item.headline))),
  );
}

function Markets({ page }) {
  const rows = query(() => ['markets', page], (key, { signal }) => source.markets(key[1], signal));
  return h('dl', { class: 'markets', 'data-markets': String(page) },
    () => rows().map((row) => [h('dt', {}, row.name), h('dd', { 'data-market': row.name }, row.value)]),
  );
}

function StoryCard({ story, lead }) {
  return h('article', { class: lead ? 'card lead' : 'card', 'data-story': story.slug },
    h('p', { class: 'kicker' }, story.section),
    h(lead ? 'h2' : 'h3', {}, h('a', { href: `/article/${story.slug}` }, story.headline)),
    h('p', { class: 'dek' }, story.dek),
    h('p', { class: 'byline' }, `By ${story.byline} · ${formatDate(story.publishedAt)}`),
  );
}

function Pager({ page, pages }) {
  return h('nav', { class: 'pager', 'aria-label': 'Pages', 'data-pager': '' },
    page > 1 ? h('a', { href: page === 2 ? '/' : `/?page=${page - 1}`, rel: 'prev', 'data-prev': '' }, '← Newer') : h('span', {}, ''),
    h('span', { 'data-page-of': '' }, `Page ${page} of ${pages}`),
    page < pages ? h('a', { href: `/?page=${page + 1}`, rel: 'next', 'data-next': '' }, 'Older →') : h('span', {}, ''),
  );
}

export default function FrontPage() {
  const data = useLoaderData();
  if (!data.page) {
    return h('div', { class: 'page' },
      h(Head, { title: 'Page not found · The Morning Ledger' }),
      h(Masthead, {}),
      h('main', { class: 'container' }, h('h1', { 'data-not-found': '' }, 'There is no such page')),
      h(Footer, {}),
    );
  }
  const { page, pages, stories } = data;
  const compact = signal(false, 'compact');

  return h('div', { class: 'page' },
    h(Head, {
      title: page === 1 ? 'The Morning Ledger' : `Page ${page} · The Morning Ledger`,
      meta: [
        { name: 'description', content: `Today's stories from the Morning Ledger, page ${page} of ${pages}.` },
        { property: 'og:title', content: 'The Morning Ledger' },
      ],
    }),
    h(Masthead, {}),
    h('main', { class: 'container front', 'data-front': String(page) },
      h('div', { class: 'front-tools' },
        h('button', {
          type: 'button',
          'data-compact': '',
          'aria-pressed': () => String(compact()),
          onclick: () => compact.set((c) => !c),
        }, () => (compact() ? 'Show summaries' : 'Headlines only')),
      ),
      h('section', { class: () => (compact() ? 'stories compact' : 'stories'), 'aria-label': 'Stories' },
        stories.map((story, i) => h(StoryCard, { story, lead: page === 1 && i === 0 })),
      ),
      h('aside', { class: 'rail' },
        h('h2', {}, 'Most read'),
        h(Suspense, { fallback: h('p', { class: 'loading', 'data-most-read-loading': '' }, 'Counting readers…') },
          h(MostRead, { page })),
        h('h2', {}, 'Markets'),
        h(Suspense, { fallback: h('p', { class: 'loading', 'data-markets-loading': '' }, 'Loading markets…') },
          h(Markets, { page })),
      ),
      h(Pager, { page, pages }),
    ),
    h(Footer, {}),
  );
}
