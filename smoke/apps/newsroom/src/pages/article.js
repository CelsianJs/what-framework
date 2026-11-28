// Article page: mode 'hybrid', ISR-cached and tagged 'articles'.
//
// The article is several thousand words, and the whole page hydrates (the
// save toggle is the page's own). The interactive parts that are not needed
// at once are islands, one per hydration mode:
//
//   comment form   client:load         typing should work as soon as scripts run
//   text size      client:idle         nobody needs it in the first second
//   contents rail  client:media        only on screens wide enough to show it
//   reading now    client:visible      polls the server, so only once seen
//   share menu     client:interaction  only for the reader who opens it
//
// Each island is written by hand, so each gets a `name`: a minifier renames
// the component's function, and the server and the browser must agree.

import { h, Head, signal, useLoaderData } from 'what-framework';
import { _$Island as Island } from 'what-framework/render';
import { Footer, Masthead } from '../components/chrome.js';
import { formatDate } from '../data/news.js';
import CommentForm from '../islands/comment-form.js';
import TextSize from '../islands/text-size.js';
import Contents from '../islands/contents.js';
import ReadingNow from '../islands/reading-now.js';
import ShareMenu from '../islands/share-menu.js';

export const page = { mode: 'hybrid', revalidate: 300, tags: ['articles'] };

export async function loader({ params, response }) {
  const { getArticle, commentsFor } = await import('../db.js');
  const article = getArticle(params.slug);
  if (!article) {
    response.setStatus(404);
    return { article: null, comments: [] };
  }
  return { article, comments: commentsFor(params.slug) };
}

function Block({ block }) {
  if (block.type === 'h2') return h('h2', { id: block.id }, block.text);
  if (block.type === 'quote') {
    return h('blockquote', { class: 'pull' }, h('p', {}, block.text), h('cite', {}, block.source));
  }
  return h('p', {},
    block.lead, ' ', h('em', {}, block.em), ', as ',
    h('a', { href: block.link.href }, block.link.text), ' showed.', block.tail);
}

export default function ArticlePage() {
  const { article, comments } = useLoaderData();
  if (!article) {
    return h('div', { class: 'page' },
      h(Head, { title: 'Story not found · The Morning Ledger' }),
      h(Masthead, {}),
      h('main', { class: 'container' }, h('h1', { 'data-not-found': '' }, 'We could not find that story')),
      h(Footer, {}),
    );
  }

  const saved = signal(false, 'saved');
  const sections = article.blocks.filter((b) => b.type === 'h2').map((b) => ({ id: b.id, text: b.text }));

  return h('div', { class: 'page' },
    h(Head, {
      title: `${article.headline} · The Morning Ledger`,
      meta: [
        { name: 'description', content: article.dek },
        { property: 'og:title', content: article.headline },
        { property: 'og:type', content: 'article' },
        { name: 'author', content: article.byline },
      ],
    }),
    h(Masthead, {}),
    h('div', { class: 'container article-layout' },
      h(Island, { component: Contents, name: 'Contents', mode: 'media', mediaQuery: '(min-width: 1100px)', sections }),
      h('main', { class: 'article', 'data-article': article.slug },
        h('p', { class: 'kicker' }, article.section),
        h('h1', { 'data-headline': '' }, article.headline),
        h('p', { class: 'dek' }, article.dek),
        h('div', { class: 'article-meta' },
          h('p', { class: 'byline' }, `By ${article.byline} · ${formatDate(article.publishedAt)}`),
          h('button', {
            type: 'button',
            class: 'save',
            'data-save': '',
            'aria-pressed': () => String(saved()),
            onclick: () => saved.set((s) => !s),
          }, () => (saved() ? 'Saved' : 'Save for later')),
          h(Island, { component: ShareMenu, name: 'ShareMenu', mode: 'interaction', slug: article.slug, headline: article.headline }),
          h(Island, { component: TextSize, name: 'TextSize', mode: 'idle' }),
        ),
        h('div', { class: 'article-body', 'data-article-body': '' },
          article.blocks.map((block) => h(Block, { block })),
        ),
        h(Island, { component: ReadingNow, name: 'ReadingNow', mode: 'visible', slug: article.slug }),
        h('section', { id: 'comments', class: 'comments', 'aria-labelledby': 'comments-heading' },
          h('h2', { id: 'comments-heading' }, `Comments (${comments.length})`),
          h('ol', { class: 'comment-list', 'data-comment-list': '' },
            comments.map((c) => h('li', { 'data-comment': String(c.id) },
              h('p', { class: 'comment-author' }, c.author),
              h('p', { class: 'comment-body' }, c.body)))),
          h(Island, { component: CommentForm, name: 'CommentForm', mode: 'load', slug: article.slug }),
        ),
      ),
    ),
    h(Footer, {}),
  );
}
