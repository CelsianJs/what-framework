import React from 'react';
import { ValtioTest } from './test-valtio.jsx';
import { TanStackFormTest } from './test-tanstackform.jsx';
import { FormikTest } from './test-formik.jsx';
import { RadixExtTest } from './test-radix-ext.jsx';
import { NotistackTest } from './test-notistack.jsx';
import { IntlTest } from './test-intl.jsx';
import { WrapBalancerTest } from './test-wrapbalancer.jsx';

const tests = [
  { name: 'valtio', C: ValtioTest },
  { name: '@tanstack/react-form', C: TanStackFormTest },
  { name: 'formik', C: FormikTest },
  { name: 'Radix UI Extended (7 primitives)', C: RadixExtTest },
  { name: 'notistack', C: NotistackTest },
  { name: 'react-intl', C: IntlTest },
  { name: 'react-wrap-balancer', C: WrapBalancerTest },
];

function App() {
  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 900, margin: '0 auto' }}>
      <h1>What React Compat — Batch 5 (8 Libraries)</h1>
      <p style={{ color: '#666' }}>Libraries #56-63: State, forms, i18n, Radix extended, notifications</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tests.map(({ name, C }) => (
          <div key={name}>
            <C />
          </div>
        ))}
      </div>
    </div>
  );
}

import { createRoot } from 'react-dom/client';
const root = createRoot(document.getElementById('app'));
root.render(<App />);
