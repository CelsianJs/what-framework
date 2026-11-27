// The quote's layout: the progress indicator, the save state and the step.
// It stays mounted while the steps change under it; the steps it lists
// follow the draft, so the Business step appears as soon as a vehicle is
// used for business and goes when none is.

import { Link, navigate, route } from 'what-router';

import { draft, saving, startOver, steps } from './draft.js';
import { stepPath } from './step-form.js';

export function QuoteLayout({ children }) {
  const current = () => steps().findIndex((s) => stepPath(s.id) === route.path);
  const restart = () => {
    startOver();
    navigate('/quote/about');
  };
  return (
    <main class="quote">
      <header class="masthead">
        <div>
          <h1>Harbor auto quote</h1>
          <p class="muted" data-progress-text>{current() >= 0 ? `Step ${current() + 1} of ${steps().length}` : ''}</p>
        </div>
        <div class="save-state">
          <span data-save-state aria-live="polite">{saving() ? 'Saving…' : 'All changes saved'}</span>
          <button type="button" class="link" data-start-over onClick={restart}>Start over</button>
        </div>
      </header>
      <nav aria-label="Quote steps">
        <ol class="progress" data-progress>
          {steps().map((s, i) => (
            <li key={s.id} data-step={s.id} class={i === current() ? 'current' : (draft().done[s.id] ? 'done' : '')} aria-current={i === current() ? 'step' : undefined}>
              {draft().done[s.id] || i === current()
                ? <Link href={stepPath(s.id)}>{s.label}</Link>
                : <span>{s.label}</span>}
            </li>
          ))}
        </ol>
      </nav>
      <section class="step">{children}</section>
    </main>
  );
}
