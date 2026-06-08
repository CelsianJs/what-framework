// New-post page — a form that posts to the createPost server action. mode:'server'
// so it's always fresh (never cached). The form is progressively enhanced: it
// works as a plain POST, and the createPostAction island wires optimistic UI on
// the client. In a real app: src/pages/new.jsx.

import { h, Head } from 'what-framework';

export const page = { mode: 'server' };

export default function NewPost() {
  return h('main', { class: 'container' },
    h(Head, { title: 'New post — What Blog' }),
    h('h1', {}, 'New post'),
    h('form', { method: 'post', action: '/__what_action', 'data-action': 'createPost' },
      h('input', { name: 'title', placeholder: 'Title', required: true }),
      h('textarea', { name: 'body', placeholder: 'Write something…', required: true }),
      h('button', { type: 'submit' }, 'Publish')
    ),
    h('p', {}, h('a', { href: '/' }, '← Back'))
  );
}
