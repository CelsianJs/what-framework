// The quote, once the server accepted it.

import { Link } from 'what-router';

import { lastQuote } from './Review.jsx';

export function DonePage() {
  const q = lastQuote.value;
  return (
    <main class="quote done" data-done>
      <h1>Your quote is ready</h1>
      {q
        ? <p>Quote <strong data-quote-id>{q.quoteId}</strong>: <span data-premium>{`$${q.premium}`}</span> a year. License photo received: <span data-license-bytes>{String(q.licenseBytes)}</span> bytes.</p>
        : <p>No quote in this session.</p>}
      <Link href="/quote/about">Start another quote</Link>
    </main>
  );
}
