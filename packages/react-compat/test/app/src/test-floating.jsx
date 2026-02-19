import { useState } from 'react';
import { useFloating, autoUpdate, offset, flip, shift } from '@floating-ui/react-dom';

export function FloatingTest() {
  const [show, setShow] = useState(false);
  const { refs, floatingStyles } = useFloating({
    open: show,
    placement: 'top',
    middleware: [offset(8), flip(), shift()],
    whileElementsMounted: autoUpdate,
  });

  return (
    <div>
      <button
        ref={refs.setReference}
        onclick={() => setShow(s => !s)}
        style={{ padding: '8px 16px' }}
      >
        {show ? 'Hide' : 'Show'} Tooltip
      </button>
      {show && (
        <div
          ref={refs.setFloating}
          style={{
            ...floatingStyles,
            background: '#1e293b',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '14px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          Floating UI tooltip!
        </div>
      )}
      <p style={{ color: 'green', marginTop: '8px' }}>@floating-ui/react-dom with offset, flip, shift</p>
    </div>
  );
}
