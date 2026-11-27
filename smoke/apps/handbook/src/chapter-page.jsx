// The frame every chapter renders into: its title, how long the reader has
// had it open, a "mark as read" box and a note kept between visits.

import { onCleanup, signal } from 'what-framework';
import { Link } from 'what-router';

import { CHAPTERS, chapterPath } from './chapters.js';
import { draftOf, readMarks, stats, toggleRead } from './state.js';

export function ChapterPage({ slug, title, children }) {
  const seconds = signal(0);
  const draft = draftOf(slug);
  const index = CHAPTERS.findIndex((c) => c.slug === slug);
  const next = CHAPTERS[index + 1];

  stats.mounts[slug] = (stats.mounts[slug] ?? 0) + 1;
  stats.live++;
  stats.timers++;
  const timer = setInterval(() => seconds((s) => s + 1), 1000);
  onCleanup(() => {
    clearInterval(timer);
    stats.timers--;
    stats.live--;
  });

  return (
    <article class="chapter" data-chapter={slug}>
      <p class="eyebrow">{`Chapter ${index + 1} of ${CHAPTERS.length}`}</p>
      <h1 data-chapter-title>{title}</h1>
      <p class="meta">Open for <span data-seconds>{seconds()}</span> s</p>
      <div class="body">{children}</div>
      <label class="read">
        <input type="checkbox" data-read checked={!!readMarks()[slug]} onChange={() => toggleRead(slug)} />
        Mark as read
      </label>
      <label class="note">
        Your note
        <textarea data-note rows="3" value={draft()} onInput={(e) => draft(e.target.value)} />
      </label>
      {next ? <p class="next"><Link href={chapterPath(next.slug)} data-next>{`Next: ${next.title}`}</Link></p> : null}
    </article>
  );
}
