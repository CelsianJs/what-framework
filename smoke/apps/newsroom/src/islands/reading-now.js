// client:visible. How many people have this article open, polled from the
// server every two seconds once the reader scrolls it into view.

import { h, onCleanup, signal } from 'what-framework';

export default function ReadingNow({ slug }) {
  const count = signal(null, 'count');
  if (typeof window !== 'undefined') {
    const reader = sessionStorage.getItem('reader') || Math.random().toString(36).slice(2);
    try { sessionStorage.setItem('reader', reader); } catch { /* private mode */ }
    let timer = null;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/reading-now?slug=${encodeURIComponent(slug)}&reader=${reader}`);
        if (res.ok && !stopped) count.set((await res.json()).count);
      } catch { /* offline: keep the last figure */ }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    poll();
    onCleanup(() => { stopped = true; clearTimeout(timer); });
  }
  return h('p', { class: 'reading-now', 'data-reading-now': '' },
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    h('output', { 'data-reading-count': '' }, () => (count() === null ? '…' : String(count()))),
    ' reading now');
}
