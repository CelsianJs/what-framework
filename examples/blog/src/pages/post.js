// Post page — dynamic /blog/[slug] with a loader, getStaticPaths (pre-render the
// known posts at build; the rest generate on first hit per `fallback`), ISR, and
// per-post <Head> meta. In a real app: src/pages/blog/[slug].jsx.

import { h, Head, useLoaderData } from 'what-framework';
import { getPost, listPosts } from '../db.js';

export const page = { mode: 'static', revalidate: 60, tags: ['posts'] };

export const loader = ({ params }) => {
  const post = getPost(params.slug);
  return { post };
};

export async function getStaticPaths() {
  return {
    paths: listPosts().map((p) => ({ params: { slug: p.slug } })),
    fallback: 'blocking', // unknown slugs render on first request, then cache
  };
}

export default function Post() {
  const { post } = useLoaderData();
  if (!post) {
    return h('main', { class: 'container' }, h('h1', {}, 'Not found'));
  }
  return h('main', { class: 'container' },
    h(Head, {
      title: `${post.title} — What Blog`,
      meta: [{ property: 'og:title', content: post.title }],
    }),
    h('article', {},
      h('h1', {}, post.title),
      h('p', {}, post.body)
    ),
    h('p', {}, h('a', { href: '/' }, '← Back'))
  );
}
