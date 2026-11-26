// client:load. The comment form.
//
// Without JavaScript it is a plain form post to the action endpoint, which
// runs `postComment` and answers 303 back to the article: the page is cached
// (shared between readers), so it carries no CSRF token and the endpoint
// accepts it as a same-origin post. With JavaScript the island posts the same
// fields to the same action and shows the comment without a reload.

import { h, signal } from 'what-framework';
import { callAction } from '../lib/actions-client.js';

export default function CommentForm({ slug }) {
  const status = signal('idle', 'status'); // idle | sending | posted | failed
  const message = signal('', 'message');
  const posted = signal([], 'posted');

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    status.set('sending');
    try {
      const result = await callAction('postComment', fields);
      posted.set((list) => [...list, result.comment]);
      form.reset();
      status.set('posted');
      message.set('Thanks: your comment is live.');
    } catch (err) {
      status.set('failed');
      message.set(err.message);
    }
  }

  return h('form', {
    method: 'post',
    action: '/__what_action',
    class: 'comment-form',
    'data-comment-form': '',
    onsubmit: submit,
  },
    h('input', { type: 'hidden', name: '_action', value: 'postComment' }),
    h('input', { type: 'hidden', name: '_redirect', value: `/article/${slug}#comments` }),
    h('input', { type: 'hidden', name: 'slug', value: slug }),
    h('label', {}, 'Name', h('input', { name: 'author', autocomplete: 'nickname', 'data-comment-author': '' })),
    h('label', {}, 'Comment', h('textarea', { name: 'body', rows: 4, 'data-comment-body': '' })),
    h('button', { type: 'submit', disabled: () => status() === 'sending', 'data-comment-submit': '' },
      () => (status() === 'sending' ? 'Posting…' : 'Post comment')),
    h('p', { role: 'status', class: 'comment-status', 'data-comment-status': () => status() }, () => message()),
    h('ol', { class: 'comment-list just-posted', 'data-just-posted': '' },
      () => posted().map((c) => h('li', { 'data-comment': String(c.id) },
        h('p', { class: 'comment-author' }, c.author),
        h('p', { class: 'comment-body' }, c.body)))),
  );
}
