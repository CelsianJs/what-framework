import {
  Portal,
  FocusTrap,
  useClickOutside,
  onKey,
  Keys,
  useId,
  VisuallyHidden,
  announce,
  useRef,
  useEffect,
  useSignal,
} from 'what-framework';

/**
 * Modal
 * Fully accessible, reusable modal dialog component.
 *
 * Features:
 *   - Rendered via Portal (target: body)
 *   - FocusTrap wrapping content to contain keyboard focus
 *   - useClickOutside for backdrop click dismissal
 *   - Escape key to close
 *   - useId for unique aria-labelledby / aria-describedby
 *   - VisuallyHidden for screen-reader description
 *   - announce() on open for screen reader notification
 *   - Focus restoration handled by parent (via onClose callback)
 *   - CSS transition entrance (opacity + scale)
 *
 * Props:
 *   isOpen       - boolean, whether modal is visible
 *   onClose      - function to call when modal should close
 *   title        - string, dialog title
 *   children     - modal body content
 *   description  - optional string for aria-describedby
 */
const backdropStyle = {
  position: 'fixed',
  inset: '0',
  zIndex: '9998',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'opacity 0.2s ease, backdrop-filter 0.2s ease',
};

const overlayBaseStyle = {
  position: 'absolute',
  inset: '0',
  background: 'rgba(0, 0, 0, 0.7)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  transition: 'opacity 0.2s ease',
};

const panelBaseStyle = {
  position: 'relative',
  zIndex: '9999',
  background: '#1a1a2e',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '16px',
  padding: '0',
  maxWidth: '480px',
  width: '90vw',
  maxHeight: '85vh',
  overflow: 'auto',
  boxShadow: '0 25px 60px rgba(0, 0, 0, 0.5)',
  transition: 'opacity 0.2s ease, transform 0.2s ease',
};

const closeButtonStyle = {
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: '8px',
  color: '#a1a1aa',
  fontSize: '1.1rem',
  lineHeight: '1',
  width: '32px',
  height: '32px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s',
};

export function Modal({ isOpen, onClose, title, children, description }) {
  const titleId = useId('modal-title');
  const descId = useId('modal-desc');
  const contentRef = useRef(null);
  const hasAnnounced = useRef(false);
  const visible = useSignal(false);

  // Animate in when opened
  useEffect(() => {
    if (isOpen) {
      // Small delay so the DOM renders before transition
      requestAnimationFrame(() => {
        visible(true);
      });
      // Announce to screen readers
      if (!hasAnnounced.current) {
        announce(`Dialog opened: ${title}`);
        hasAnnounced.current = true;
      }
    } else {
      visible(false);
      hasAnnounced.current = false;
    }
  }, [isOpen]);

  // Click outside to dismiss
  useClickOutside(contentRef, () => {
    if (isOpen) onClose();
  });

  if (!isOpen) return null;

  return (
    <Portal target="body">
      {/* Backdrop */}
      <div
        style={backdropStyle}
        onkeydown={onKey(Keys.Escape, (e) => {
          e.preventDefault();
          onClose();
        })}
      >
        {/* Overlay bg */}
        {() => {
          const isVisible = visible();
          return (
            <div style={{
              ...overlayBaseStyle,
              opacity: isVisible ? '1' : '0',
            }} />
          );
        }}

        {/* Modal content */}
        <FocusTrap>
          {() => {
            const isVisible = visible();
            return (
              <div
                ref={contentRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId()}
                aria-describedby={description ? descId() : undefined}
                style={{
                  ...panelBaseStyle,
                  opacity: isVisible ? '1' : '0',
                  transform: isVisible ? 'scale(1)' : 'scale(0.95)',
                }}
              >
                {/* Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '1.25rem 1.5rem',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}>
                  <h2
                    id={titleId()}
                    style={{
                      margin: '0',
                      fontSize: '1.15rem',
                      fontWeight: '600',
                      color: '#f0f0f0',
                    }}
                  >
                    {title}
                  </h2>
                  <button
                    onclick={onClose}
                    aria-label="Close dialog"
                    style={closeButtonStyle}
                    onmouseenter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                      e.currentTarget.style.color = '#f0f0f0';
                    }}
                    onmouseleave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                      e.currentTarget.style.color = '#a1a1aa';
                    }}
                  >
                    {'\u2715'}
                  </button>
                </div>

                {/* Hidden description for screen readers */}
                {description ? (
                  <VisuallyHidden>
                    <span id={descId()}>{description}</span>
                  </VisuallyHidden>
                ) : null}

                {/* Body */}
                <div style={{ padding: '1.5rem' }}>
                  {children}
                </div>
              </div>
            );
          }}
        </FocusTrap>
      </div>
    </Portal>
  );
}
