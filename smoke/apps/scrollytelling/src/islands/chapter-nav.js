// client:idle: the chapter rail.
//
// `idle` because the server already ships it as working fragment links. The
// only thing hydration adds is the smooth scroll and the current-chapter mark,
// so it can wait until the browser has nothing better to do.

import { h, smoothScrollTo } from 'what-framework';
import { chapters } from '../story.js';
import { activeChapter, bindEl, prefersReducedMotion } from '../motion.js';

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
          class: 'chapter-link',
          'data-chapter-link': chapter.id,
          onclick: (event) => jump(event, chapter.id),
          ref: (el) => bindEl(el, () => {
            const on = activeChapter() === chapter.id;
            el.classList.toggle('is-current', on);
            if (on) el.setAttribute('aria-current', 'true');
            else el.setAttribute('aria-current', 'false');
          }),
        },
        h('span', { class: 'chapter-num' }, chapter.num),
        h('span', { class: 'chapter-title' }, chapter.title),
        ),
      )),
    ),
  );
}
