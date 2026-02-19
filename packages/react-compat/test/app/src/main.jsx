/**
 * what-react compat test — tests Zustand and Framer Motion
 *
 * Uses React-style JSX (automatic runtime) — esbuild transforms JSX to
 * jsx() calls from 'react/jsx-runtime', which is aliased to what-react.
 * No what compiler plugin needed.
 */
import { createRoot } from 'react-dom/client';
import { ZustandTest } from './test-zustand.jsx';
import { FramerTest } from './test-framer.jsx';
import { RadixTest } from './test-radix.jsx';

function App() {
  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>what-react Compatibility Tests</h1>
      <section>
        <h2>Zustand</h2>
        <ZustandTest />
      </section>
      <hr />
      <section>
        <h2>Framer Motion</h2>
        <FramerTest />
      </section>
      <hr />
      <section>
        <h2>Radix UI</h2>
        <RadixTest />
      </section>
    </div>
  );
}

const root = createRoot(document.getElementById('app'));
root.render(<App />);
