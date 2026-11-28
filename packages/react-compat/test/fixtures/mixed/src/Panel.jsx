// A native component inside a React provider; it places React children and
// uses a React component of its own.
import { signal } from 'what-framework';
import { ThemedLabel } from './theme.jsx';

export function Panel(props) {
  const clicks = signal(0);
  return (
    <section id="panel">
      <h2 id="panel-title">{props.title}</h2>
      <button id="panel-btn" onClick={() => clicks(clicks() + 1)}>clicks {clicks()}</button>
      {props.children}
      <ThemedLabel id="inner" />
    </section>
  );
}
