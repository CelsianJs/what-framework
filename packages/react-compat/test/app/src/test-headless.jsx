/**
 * Test: @headlessui/react — unstyled accessible UI components by Tailwind Labs
 * 4.2M weekly downloads. Hooks, Context, render props, Transition.
 */
import { Disclosure, Switch } from '@headlessui/react';
import { useState } from 'react';

const faqs = [
  { q: 'What is What Framework?', a: 'A signals-based JavaScript framework with fine-grained reactivity, no virtual DOM diffing.' },
  { q: 'Is it compatible with React?', a: 'Yes! The what-react compat layer lets you use React libraries with zero changes.' },
  { q: 'How fast is it?', a: 'Signals update only the specific DOM nodes that depend on changed data — no tree diffing overhead.' },
];

export function HeadlessTest() {
  const [enabled, setEnabled] = useState(false);

  return (
    <div style={{ maxWidth: '500px' }}>
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '14px' }}>Dark mode:</span>
        <Switch
          checked={enabled}
          onChange={setEnabled}
          style={{
            width: '44px', height: '24px', borderRadius: '9999px',
            background: enabled ? '#3b82f6' : '#d1d5db',
            position: 'relative', display: 'inline-flex', alignItems: 'center',
            cursor: 'pointer', border: 'none', padding: 0,
          }}
        >
          <span
            style={{
              display: 'inline-block', width: '18px', height: '18px', borderRadius: '50%',
              background: 'white', transform: enabled ? 'translateX(22px)' : 'translateX(3px)',
              transition: 'transform 150ms',
            }}
          />
        </Switch>
        <span style={{ fontSize: '13px', color: '#666' }}>{enabled ? 'ON' : 'OFF'}</span>
      </div>

      <div>
        {faqs.map((faq, i) => (
          <Disclosure key={i}>
            {({ open }) => (
              <div style={{ borderBottom: '1px solid #e5e7eb' }}>
                <Disclosure.Button
                  style={{
                    width: '100%', padding: '10px 0', textAlign: 'left',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontWeight: 500, fontSize: '14px', display: 'flex', justifyContent: 'space-between',
                  }}
                >
                  {faq.q}
                  <span>{open ? '−' : '+'}</span>
                </Disclosure.Button>
                <Disclosure.Panel style={{ padding: '0 0 10px', color: '#666', fontSize: '13px' }}>
                  {faq.a}
                </Disclosure.Panel>
              </div>
            )}
          </Disclosure>
        ))}
      </div>
      <p style={{ color: 'green' }} id="headless-status">Headless UI loaded OK</p>
    </div>
  );
}
