// The server-rendered quote page: native What around a React form island,
// and a client:load island (a native ticket hosting a React stepper). The
// server writes all of it; the browser hydrates it, adopting the React
// islands' elements and text.

import { signal } from 'what-framework';

import { QuoteRequest } from './QuoteRequest.jsx';
import { Ticket } from './Ticket.jsx';

export function QuotePage(props) {
  const requests = signal([]);
  const pings = signal(0);
  return (
    <main class="quote-page" data-quote-page>
      <h1>Quote request · <span data-qp-symbol>{props.symbol}</span></h1>
      <button type="button" data-qp-ping onClick={() => pings(pings() + 1)}>native ping {pings()}</button>
      <QuoteRequest symbol={props.symbol} onRequest={(r) => requests([...requests(), r])} />
      <Ticket client:load symbol={props.symbol} start={500} />
      <ul data-qp-requests>{requests().map((r, i) => <li key={i}>{r.side} {r.size} {r.symbol}</li>)}</ul>
    </main>
  );
}
