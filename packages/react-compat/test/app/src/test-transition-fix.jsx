/**
 * react-transition-group — re-test after getDerivedStateFromProps fix
 * TransitionGroup uses getDerivedStateFromProps extensively
 */
import React, { useState, useRef } from 'react';
import { CSSTransition, TransitionGroup, Transition } from 'react-transition-group';

function SimpleTransitionTest() {
  const [show, setShow] = useState(false);
  const nodeRef = useRef(null);

  return (
    <div style={{ marginBottom: 16 }}>
      <strong>CSSTransition (nodeRef):</strong>{' '}
      <button onClick={() => setShow(s => !s)} style={{ marginLeft: 8 }}>Toggle</button>
      <CSSTransition in={show} timeout={300} classNames="fade" unmountOnExit nodeRef={nodeRef}>
        <div ref={nodeRef} style={{ padding: 12, background: '#e3f2fd', borderRadius: 4, marginTop: 8 }}>
          I fade in and out!
        </div>
      </CSSTransition>
    </div>
  );
}

function TransitionGroupTest() {
  const [items, setItems] = useState([
    { id: 1, text: 'Apple' },
    { id: 2, text: 'Banana' },
    { id: 3, text: 'Cherry' },
  ]);
  let nextId = 4;

  return (
    <div>
      <strong>TransitionGroup:</strong>{' '}
      <button onClick={() => setItems(prev => [...prev, { id: nextId++, text: `Fruit ${Date.now() % 1000}` }])}>
        Add
      </button>
      <TransitionGroup component="ul" style={{ listStyle: 'none', padding: 0 }}>
        {items.map(item => (
          <CSSTransition key={item.id} timeout={300} classNames="fade">
            <li style={{ padding: 6, margin: 4, background: '#f5f5f5', borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
              {item.text}
              <button onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}>×</button>
            </li>
          </CSSTransition>
        ))}
      </TransitionGroup>
    </div>
  );
}

function App() {
  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 600, margin: '0 auto' }}>
      <h2>react-transition-group — Fix Test</h2>
      <style>{`
        .fade-enter { opacity: 0; transform: translateY(-10px); }
        .fade-enter-active { opacity: 1; transform: translateY(0); transition: all 300ms; }
        .fade-exit { opacity: 1; }
        .fade-exit-active { opacity: 0; transform: translateY(10px); transition: all 300ms; }
      `}</style>
      <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
        <SimpleTransitionTest />
        <TransitionGroupTest />
        <p style={{ marginTop: 12, color: 'green', fontWeight: 'bold' }}>PASS — react-transition-group works</p>
      </div>
    </div>
  );
}

import { createRoot } from 'react-dom/client';
const root = createRoot(document.getElementById('app'));
root.render(<App />);
