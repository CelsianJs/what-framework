// A native component, rendered by a React file.
import { signal } from 'what-framework';

export function Counter(props) {
  const k = signal(0);
  return <span id="counter" onClick={() => k(k() + 1)}>{props.label}:{k()}</span>;
}
