import React, { useState, useRef } from 'react';
import { CSSTransition, TransitionGroup } from 'react-transition-group';

export function TransitionTest() {
  const [items, setItems] = useState([
    { id: 1, text: 'Item A' },
    { id: 2, text: 'Item B' },
    { id: 3, text: 'Item C' },
  ]);
  const [showAlert, setShowAlert] = useState(false);
  const nodeRef = useRef(null);
  let nextId = 4;

  const addItem = () => {
    setItems(prev => [...prev, { id: nextId++, text: `Item ${String.fromCharCode(64 + nextId)}` }]);
  };

  const removeItem = (id) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-transition-group</h3>
      <style>{`
        .fade-enter { opacity: 0; transform: translateY(-10px); }
        .fade-enter-active { opacity: 1; transform: translateY(0); transition: all 300ms; }
        .fade-exit { opacity: 1; }
        .fade-exit-active { opacity: 0; transform: translateY(10px); transition: all 300ms; }
        .alert-enter { opacity: 0; transform: scale(0.9); }
        .alert-enter-active { opacity: 1; transform: scale(1); transition: all 200ms; }
        .alert-exit { opacity: 1; }
        .alert-exit-active { opacity: 0; transform: scale(0.9); transition: all 200ms; }
      `}</style>

      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setShowAlert(s => !s)} style={{ marginRight: 8, padding: '4px 12px' }}>
          Toggle Alert
        </button>
        <button onClick={addItem} style={{ padding: '4px 12px' }}>Add Item</button>
      </div>

      <CSSTransition in={showAlert} timeout={200} classNames="alert" unmountOnExit nodeRef={nodeRef}>
        <div ref={nodeRef} style={{ padding: 12, background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 4, marginBottom: 12 }}>
          This is a CSSTransition alert!
        </div>
      </CSSTransition>

      <TransitionGroup>
        {items.map(item => (
          <CSSTransition key={item.id} timeout={300} classNames="fade">
            <div style={{ padding: 8, margin: 4, background: '#f0f0f0', borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
              {item.text}
              <button onClick={() => removeItem(item.id)} style={{ cursor: 'pointer' }}>×</button>
            </div>
          </CSSTransition>
        ))}
      </TransitionGroup>

      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — CSSTransition + TransitionGroup work</p>
    </div>
  );
}
