// client:idle: the chapter rail.
//
// `idle` because the server already ships it as working fragment links. The
// only thing hydration adds is the smooth scroll and moving the current-chapter
// mark, so it can wait until the browser has nothing better to do.

import { h } from 'what-framework';
import { smoothScrollTo } from 'what-framework/dom';
import { chapters } from '../story.js';
import { activeChapter, prefersReducedMotion } from '../motion.js';

export default function ChapterNav() {
  const jump = (event, id) => {
    const target = document.getElementById(id);
    if (!target) return; // let the browser follow the fragment
    event.preventDefault();
    if (prefersReducedMotion()) target.scrollIntoView();
    else smoothScrollTo(target, { duration: 450 });
    history.replaceState(null, '', `#${id}`);
  };

  return h('nav', { class: 'chapter-nav', 'aria-label': 'Chapters', 'data-chapter-nav': '' },
    h('p', { class: 'island-tag' }, 'client:idle'),
    h('ol', {},
      chapters.map((chapter) => h('li', {},
        h('a', {
          href: `#${chapter.id}`,
          // Reactive props, so the server marks the opening chapter as the
          // client does and the mark does not wait for the idle hydration.
          class: () => (activeChapter() === chapter.id ? 'chapter-link is-current' : 'chapter-link'),
          'aria-current': () => String(activeChapter() === chapter.id),
          'data-chapter-link': chapter.id,
          onclick: (event) => jump(event, chapter.id),
        },
        h('span', { class: 'chapter-num' }, chapter.num),
        h('span', { class: 'chapter-title' }, chapter.title),
        ),
      )),
    ),
  );
}
