import { useState } from 'react';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react';

function TestComponent() {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom',
    middleware: [offset(8), flip(), shift()],
    whileElementsMounted: autoUpdate,
  });

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={refs.setReference}
        onclick={() => setIsOpen(!isOpen)}
        style={{ padding: '4px 12px', background: '#333', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
      >
        Toggle Tooltip
      </button>
      {isOpen && (
        <div
          ref={refs.setFloating}
          style={{
            ...floatingStyles,
            background: '#444',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          Floating tooltip content
        </div>
      )}
    </div>
  );
}

TestComponent.packageName = '@floating-ui/react';
TestComponent.downloads = '10.7M/week';
export default TestComponent;
