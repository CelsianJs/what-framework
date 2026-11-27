// A React component that reads What signals while it renders: what-react
// re-renders it when one of them changes, with no prop in between.
import { prices } from '../store.js';
import { useProbe } from './probe.js';

export function SignalQuote({ symbol }) {
  useProbe(`signal:${symbol}`);
  return <span className="sigquote" data-sigquote={symbol}>{prices[symbol]()}</span>;
}
