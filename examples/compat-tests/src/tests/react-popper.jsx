import { useState, useRef } from 'react';
import { usePopper } from 'react-popper';

function TestComponent() {
  const [showPopper, setShowPopper] = useState(false);
  const [referenceElement, setReferenceElement] = useState(null);
  const [popperElement, setPopperElement] = useState(null);
  const [arrowElement, setArrowElement] = useState(null);

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: 'top',
    modifiers: [
      { name: 'arrow', options: { element: arrowElement } },
      { name: 'offset', options: { offset: [0, 8] } },
    ],
  });

  return (
    <div style={{ position: 'relative', minHeight: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <button
        ref={setReferenceElement}
        onclick={() => setShowPopper(s => !s)}
        style={{
          padding: '6px 14px',
          cursor: 'pointer',
          background: showPopper ? '#6366f1' : '#333',
          color: '#fff',
          border: '1px solid #555',
          borderRadius: '4px',
          fontSize: '12px',
        }}
      >
        {showPopper ? 'Hide' : 'Show'} Popper
      </button>

      {showPopper && (
        <div
          ref={setPopperElement}
          style={{
            ...styles.popper,
            background: '#1e1b4b',
            color: '#c7d2fe',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '11px',
            border: '1px solid #4338ca',
            zIndex: 10,
          }}
          {...attributes.popper}
        >
          Popper content
          <div ref={setArrowElement} style={styles.arrow} />
        </div>
      )}
    </div>
  );
}

TestComponent.packageName = 'react-popper';
TestComponent.downloads = '4.7M/week';
export default TestComponent;
