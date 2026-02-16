import { useRovingTabIndex } from 'what-framework';

/**
 * ButtonGroup
 * A group of buttons with keyboard navigation via roving tab index.
 * Arrow keys move focus between buttons; Home/End jump to first/last.
 *
 * Props:
 *   buttons  - array of { label, onclick, variant? }
 *   ariaLabel - accessible label for the group
 */
export function ButtonGroup({ buttons, ariaLabel = 'Action buttons' }) {
  const roving = useRovingTabIndex(buttons.length);

  function getButtonStyle(variant) {
    switch (variant) {
      case 'primary':
        return {
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          color: '#fff',
          border: 'none',
          boxShadow: '0 2px 12px rgba(99, 102, 241, 0.3)',
        };
      case 'danger':
        return {
          background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
          color: '#fff',
          border: 'none',
          boxShadow: '0 2px 12px rgba(239, 68, 68, 0.3)',
        };
      case 'success':
        return {
          background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
          color: '#fff',
          border: 'none',
          boxShadow: '0 2px 12px rgba(34, 197, 94, 0.3)',
        };
      default:
        return {
          background: 'rgba(255, 255, 255, 0.06)',
          color: '#d4d4d8',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: 'none',
        };
    }
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        gap: '0.75rem',
        flexWrap: 'wrap',
      }}
    >
      {() => buttons.map((btn, index) => {
        const baseStyle = getButtonStyle(btn.variant);
        const itemProps = roving.getItemProps(index);

        return (
          <button
            key={btn.label}
            tabIndex={itemProps.tabIndex}
            onclick={btn.onclick}
            onkeydown={(e) => {
              itemProps.onKeyDown(e);
            }}
            onfocus={() => {
              itemProps.onFocus();
            }}
            style={{
              ...baseStyle,
              borderRadius: '10px',
              padding: '0.65rem 1.5rem',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'transform 0.15s, box-shadow 0.15s, background 0.15s',
              outline: 'none',
            }}
            onmouseenter={(e) => {
              e.currentTarget.style.transform = 'scale(1.03)';
            }}
            onmouseleave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {btn.label}
          </button>
        );
      })}
    </div>
  );
}
