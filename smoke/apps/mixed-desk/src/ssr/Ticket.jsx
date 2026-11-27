// A native ticket hosting a React stepper. The quote page uses it as a
// client:load island: the server renders it whole, and the browser hydrates
// it as a root of its own once the page's script runs.

import { signal } from 'what-framework';

import { SizeStepper } from './SizeStepper.jsx';

export function Ticket(props) {
  const fills = signal([]);
  return (
    <aside class="ticket" data-ticket>
      <h2>Ticket · {props.symbol}</h2>
      <SizeStepper start={props.start} onFill={(size) => fills([...fills(), size])} />
      <span data-ticket-fills>{fills().join(',')}</span>
    </aside>
  );
}
