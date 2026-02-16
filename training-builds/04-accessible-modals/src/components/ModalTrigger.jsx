import { useRef } from 'what-framework';

/**
 * ModalTrigger
 * A reusable button that manages its own ref for focus restoration.
 * Passes the ref to the parent so the Modal can restore focus on close.
 *
 * Props:
 *   label     - button text
 *   onclick   - click handler (receives the button ref as argument)
 *   variant   - 'primary' | 'danger' | 'success' | 'default'
 *   onRef     - callback to receive the button ref
 */
export function ModalTrigger({ label, onclick, variant = 'primary', onRef }) {
  const btnRef = useRef(null);

  function getStyle() {
    const base = {
      borderRadius: '10px',
      padding: '0.65rem 1.5rem',
      fontSize: '0.875rem',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'transform 0.15s, box-shadow 0.15s',
      outline: 'none',
      border: 'none',
    };

    switch (variant) {
      case 'primary':
        return {
          ...base,
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          color: '#fff',
          boxShadow: '0 2px 12px rgba(99, 102, 241, 0.3)',
        };
      case 'danger':
        return {
          ...base,
          background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
          color: '#fff',
          boxShadow: '0 2px 12px rgba(239, 68, 68, 0.3)',
        };
      case 'success':
        return {
          ...base,
          background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
          color: '#fff',
          boxShadow: '0 2px 12px rgba(34, 197, 94, 0.3)',
        };
      default:
        return {
          ...base,
          background: 'rgba(255, 255, 255, 0.06)',
          color: '#d4d4d8',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: 'none',
        };
    }
  }

  return (
    <button
      ref={(el) => {
        btnRef.current = el;
        if (onRef) onRef(btnRef);
      }}
      onclick={() => {
        if (onclick) onclick(btnRef);
      }}
      style={getStyle()}
      onmouseenter={(e) => {
        e.currentTarget.style.transform = 'scale(1.03)';
      }}
      onmouseleave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
      onmousedown={(e) => {
        e.currentTarget.style.transform = 'scale(0.97)';
      }}
      onmouseup={(e) => {
        e.currentTarget.style.transform = 'scale(1.03)';
      }}
      onfocus={(e) => {
        e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.5), 0 2px 12px rgba(99, 102, 241, 0.3)';
      }}
      onblur={(e) => {
        // Reset to variant-appropriate shadow
        const style = getStyle();
        e.currentTarget.style.boxShadow = style.boxShadow || 'none';
      }}
    >
      {label}
    </button>
  );
}
