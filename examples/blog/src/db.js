// Tiny in-memory "database" for the demo. A real app would use SQLite/Postgres;
// the loader/action contract is identical either way.

const posts = [
  { slug: 'hello-world', title: 'Hello, World', body: 'The first post on this What Framework blog.', createdAt: 1 },
  { slug: 'why-signals', title: 'Why Signals', body: 'Fine-grained reactivity, no virtual DOM, components run once.', createdAt: 2 },
];

export function listPosts() {
  return [...posts].sort((a, b) => b.createdAt - a.createdAt);
}

export function getPost(slug) {
  return posts.find((p) => p.slug === slug) || null;
}

export function createPost({ title, body }) {
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const post = { slug, title, body, createdAt: Date.now() };
  posts.push(post);
  return post;
}
