// React components for the hydration-edges fixture (a React file: it imports react).
import { useActionState, useState } from 'react';

export function Counter({ id }) {
  const [n, setN] = useState(0);
  return <button id={id} onClick={() => setN(n + 1)}>{id} {n}</button>;
}

// draggable={false}: the server writes draggable="false", and after
// hydration the image and the link are not draggable.
export function NotDraggable() {
  return (
    <p>
      <img id="edge-img" alt="" width="20" height="20" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" draggable={false} />
      <a id="edge-link" href="#edge" draggable={false}>link</a>
    </p>
  );
}

// A form whose action is a function (useActionState): a submit before the
// page has hydrated must not navigate, and runs once it has.
export function EdgeForm() {
  const [state, action] = useActionState((previous, data) => ({ count: previous.count + 1, name: String(data.get('name')) }), { count: 0, name: '' });
  return (
    <form action={action} id="edge-form">
      <input id="edge-name" name="name" defaultValue="" />
      <button id="edge-submit" type="submit">send</button>
      <output id="edge-out">{state.count}:{state.name}</output>
    </form>
  );
}

// Renders on the server; throws in the browser while the page hydrates (an
// island of native.jsx only: real React would lose its whole root).
export function Boom() {
  if (typeof window !== 'undefined' && window.__ssr && window.__ssr.rendered) throw new Error('hydration-edges: a component that throws in the browser');
  return <span id="edge-boom">rendered on the server</span>;
}
