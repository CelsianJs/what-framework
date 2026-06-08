// Home page — lists posts. Authored with h() so it runs without a build step;
// in a real app this is `src/pages/index.jsx` (JSX compiled by the vite plugin).
//
//   export const page  -> route config (JSON-safe: mode, revalidate, tags)
//   export const loader -> runs on the server before render, result -> loaderData
//   export default      -> the page component

import { h, Head, useLoaderData } from 'what-framework';
import { listPosts } from '../db.js';

export const page = { mode: 'static', revalidate: 60, tags: ['posts'] };

export const loader = () => ({ posts: listPosts() });

export default function Home() {
  const { posts } = useLoaderData();
  return h('main', { class: 'container' },
    h(Head, {
      title: 'What Blog',
      meta: [{ name: 'description', content: 'A full-stack blog built with What Framework' }],
    }),
    h('h1', {}, 'What Blog'),
    h('p', {}, 'Server-rendered, ISR-cached, hydrated islands.'),
    h('ul', {}, posts.map((p) =>
      h('li', { key: p.slug },
        h('a', { href: `/blog/${p.slug}` }, p.title)
      )
    )),
    h('p', {}, h('a', { href: '/new' }, '+ New post'))
  );
}
