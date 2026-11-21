// New-post page — a form that posts to the createPost server action. mode:'server'
// so it's always fresh (never cached), which is also what lets it carry the
// visitor's CSRF token: the adapter hands the per-request token to this loader,
// and <Form> writes it into a hidden field next to the action id and redirect.
// That makes it a plain POST that works with JavaScript off. In a real app:
// src/pages/new.jsx.

import { h, Head, useLoaderData } from 'what-framework';
import { Form } from 'what-framework/server';
import { createPostAction } from '../actions/posts.js';

export const page = { mode: 'server' };

export const loader = ({ csrfToken }) => ({ csrfToken });

export default function NewPost() {
  const { csrfToken } = useLoaderData();
  return h('main', { class: 'container' },
    h(Head, { title: 'New post — What Blog' }),
    h('h1', {}, 'New post'),
    h(Form, { action: createPostAction, csrfToken, redirect: '/' },
      h('input', { name: 'title', placeholder: 'Title', required: true }),
      h('textarea', { name: 'body', placeholder: 'Write something…', required: true }),
      h('button', { type: 'submit' }, 'Publish')
    ),
    h('p', {}, h('a', { href: '/' }, '← Back'))
  );
}
