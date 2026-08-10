// Diagnostics: the route that throws on purpose.
//
// It stands in for a page that dies on a bad payload from an integration. The
// route declares `error: RouteCrash`, so the Router wraps the page in an
// ErrorBoundary whose fallback is that component. The shell stays mounted and
// the rest of the app keeps navigating, which is the whole point of a
// per-route error component.

export function RouteCrash({ error, reset }) {
  return (
    <div class="notice" data-route-error>
      <strong>Diagnostics could not load</strong>
      <p class="muted" data-route-error-msg>{error.message}</p>
      <p><code>route /diagnostics · handled by the route error component</code></p>
      <button data-route-error-retry onclick={reset}>Try again</button>
    </div>
  );
}

export default function Diagnostics() {
  // Deliberate: reading the saved probe definition fails because the metrics
  // agent has not published a schema yet.
  throw new Error('Diagnostics probe failed: metrics agent unreachable');
}
