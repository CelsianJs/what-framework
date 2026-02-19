/**
 * Batch 3 test — 5 more libraries + 8 Radix primitives
 * Navigate to /test-batch3.html
 */
import { createRoot } from 'react-dom/client';
import { RadixSuiteTest } from './test-radix-suite.jsx';
import { VaulTest } from './test-vaul.jsx';
import { ErrorBoundaryTest } from './test-errorboundary.jsx';
import { ReactUseTest } from './test-reactuse.jsx';
import { InputOtpTest } from './test-inputotp.jsx';

function Section({ num, title, children }) {
  return (
    <>
      <section>
        <h2>{num}. {title}</h2>
        {children}
      </section>
      <hr />
    </>
  );
}

function App() {
  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <h1>what-react Batch 3 — Libraries 36-40</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>
        Extended Radix UI primitives + more ecosystem packages
      </p>

      <Section num={36} title="Radix UI Suite (8 Primitives)"><RadixSuiteTest /></Section>
      <Section num={37} title="Vaul (Drawer)"><VaulTest /></Section>
      <Section num={38} title="React Error Boundary"><ErrorBoundaryTest /></Section>
      <Section num={39} title="react-use (Hooks Collection)"><ReactUseTest /></Section>
      <Section num={40} title="input-otp (OTP Input)"><InputOtpTest /></Section>
    </div>
  );
}

const root = createRoot(document.getElementById('app'));
root.render(<App />);
