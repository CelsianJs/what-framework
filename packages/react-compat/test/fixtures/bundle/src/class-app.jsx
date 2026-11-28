// A React app with named imports only, whose one class component does not
// extend Component: its prototype carries React's class marker
// (`isReactComponent`), set by hand, which React accepts. Nothing in the
// program references Component, so a bundler drops it; the class must still
// render as a class, with its lifecycle. Started by class.jsx (what-react's
// Vite plugin installs class components here) and class-installed.jsx.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

class Marked {
  constructor(props) {
    this.props = props;
  }
  componentDidMount() {
    window.__log.push(`mounted ${this.props.label}`);
  }
  componentDidUpdate(prev) {
    window.__log.push(`updated ${prev.label} -> ${this.props.label}`);
  }
  componentWillUnmount() {
    window.__log.push('unmounted');
  }
  render() {
    return <b id="marked">{this.props.label}</b>;
  }
}
Marked.prototype.isReactComponent = {};

function App() {
  const [label, setLabel] = useState('first');
  return (
    <main>
      <button id="next" onClick={() => setLabel('second')}>next</button>
      <Marked label={label} />
    </main>
  );
}

export function start() {
  window.__log = [];
  const root = createRoot(document.getElementById('app'));
  root.render(<App />);
  window.__unmount = () => root.unmount();
}
