// The layout around every page: the contents in a sidebar, and the page.
// While a navigation downloads the next page, the one being left stays and
// the page area says it is busy.

import { Suspense } from 'what-framework';
import { NavLink, route } from 'what-router';

import { CHAPTERS, chapterPath } from './chapters.js';
import { readMarks, session } from './state.js';

export function Shell({ children }) {
  return (
    <div class="layout">
      <aside class="sidebar" data-sidebar>
        <NavLink href="/" class="brand">Field Guide</NavLink>
        <nav>
          <ol class="chapters">
            {CHAPTERS.map((c) => (
              <li>
                <NavLink href={chapterPath(c.slug)} data-nav={c.slug}>
                  {c.title}
                  {readMarks()[c.slug] ? <span class="tick" aria-label="read">✓</span> : null}
                </NavLink>
              </li>
            ))}
          </ol>
          <NavLink href="/desk" data-nav="desk" class="desk-link">Editor desk</NavLink>
        </nav>
        <p class="who" data-who>{session() ? `Signed in as ${session().name}` : 'Reading as a guest'}</p>
      </aside>
      <main class="page" data-page aria-busy={route.isNavigating ? 'true' : 'false'}>
        <div class="loading-bar" data-loading-bar hidden={!route.isNavigating} />
        <Suspense fallback={<p class="page-loading" data-page-loading>Loading the page…</p>}>
          {children}
        </Suspense>
      </main>
    </div>
  );
}
