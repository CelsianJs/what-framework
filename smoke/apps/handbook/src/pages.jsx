// The pages that ship in the main bundle: the contents, sign-in, the
// not-found page, and the page a chapter shows when its chunk failed.

import { Link, navigate, route } from 'what-router';

import { CHAPTERS, chapterPath } from './chapters.js';
import { readMarks, session } from './state.js';

export function Home() {
  const parts = [...new Set(CHAPTERS.map((c) => c.part))];
  return (
    <section class="home" data-home>
      <h1>Field Guide</h1>
      <p class="lede">How the platform team works. Chapters load when you open them.</p>
      <p class="progress-line" data-read-count>
        {`${Object.values(readMarks()).filter(Boolean).length} of ${CHAPTERS.length} chapters read`}
      </p>
      {parts.map((part) => (
        <div class="part">
          <h2>{part}</h2>
          <ul class="toc">
            {CHAPTERS.filter((c) => c.part === part).map((c) => (
              <li><Link href={chapterPath(c.slug)} data-toc={c.slug}>{c.title}</Link></li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function SignIn() {
  const next = () => route.query.next || '/';
  const submit = (e) => {
    e.preventDefault();
    session({ name: e.currentTarget.elements.name.value || 'Editor' });
    navigate(next(), { replace: true });
  };
  return (
    <section class="signin" data-signin>
      <h1>Sign in</h1>
      <p class="muted">The editor desk is for handbook editors.</p>
      <form onSubmit={submit}>
        <label>Name <input name="name" data-signin-name value="Robin" /></label>
        <button type="submit" data-signin-submit>Sign in</button>
      </form>
    </section>
  );
}

export function NotFound() {
  return (
    <section data-not-found>
      <h1>Not in the handbook</h1>
      <p><Link href="/">Back to the contents</Link></p>
    </section>
  );
}

// A route's error page. A chunk that failed to download lands here, inside
// the layout, so the sidebar keeps working. lazy() keeps a failed download's
// error (as React's lazy does), so the page cannot load it again in place:
// trying again loads the page again.
export function ChapterFailed({ error }) {
  return (
    <section class="failed" data-chapter-failed role="alert">
      <h1>This page did not load</h1>
      <p class="muted" data-failed-message>{String(error?.message ?? error)}</p>
      <button data-retry onClick={() => location.reload()}>Try again</button>
    </section>
  );
}
