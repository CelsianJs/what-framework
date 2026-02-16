import { useRovingTabIndex, LiveRegion, useSignal } from 'what-framework';
import { Modal } from './Modal.jsx';

/**
 * ConfirmDialog
 * A confirmation dialog that extends Modal with Confirm/Cancel buttons.
 *
 * Features:
 *   - useRovingTabIndex for arrow key navigation between buttons
 *   - LiveRegion announcing the result of the action
 *   - Enter confirms, Escape cancels
 *
 * Props:
 *   isOpen       - boolean
 *   onClose      - function to close without confirming
 *   onConfirm    - function called when user confirms
 *   title        - dialog title
 *   message      - confirmation message
 *   confirmLabel - text for confirm button (default: "Confirm")
 *   cancelLabel  - text for cancel button (default: "Cancel")
 *   variant      - 'danger' | 'info' (default: 'danger')
 *   onResult     - callback receiving the result string for status display
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onResult,
}) {
  const roving = useRovingTabIndex(2);
  const resultMessage = useSignal('');

  function handleConfirm() {
    resultMessage(`Confirmed: ${title}`);
    if (onResult) onResult(`Confirmed: ${title}`);
    if (onConfirm) onConfirm();
    onClose();
  }

  function handleCancel() {
    resultMessage(`Cancelled: ${title}`);
    if (onResult) onResult(`Cancelled: ${title}`);
    onClose();
  }

  const confirmColors = variant === 'danger'
    ? {
        bg: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
        shadow: 'rgba(239, 68, 68, 0.3)',
        hoverShadow: 'rgba(239, 68, 68, 0.5)',
      }
    : {
        bg: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        shadow: 'rgba(99, 102, 241, 0.3)',
        hoverShadow: 'rgba(99, 102, 241, 0.5)',
      };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={title}
      description={message}
    >
      <div>
        <p style={{
          color: '#d4d4d8',
          fontSize: '0.95rem',
          lineHeight: '1.6',
          margin: '0 0 1.5rem 0',
        }}>
          {message}
        </p>

        {/* Button group with roving tab index */}
        <div
          role="group"
          aria-label="Dialog actions"
          style={{
            display: 'flex',
            gap: '0.75rem',
            justifyContent: 'flex-end',
          }}
        >
          {/* Cancel button */}
          <button
            tabIndex={roving.getItemProps(0).tabIndex}
            onclick={handleCancel}
            onkeydown={(e) => {
              roving.getItemProps(0).onKeyDown(e);
            }}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              color: '#d4d4d8',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '10px',
              padding: '0.6rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'background 0.15s, border-color 0.15s',
              outline: 'none',
            }}
            onfocus={(e) => {
              e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.5)';
              roving.getItemProps(0).onFocus();
            }}
            onblur={(e) => {
              e.currentTarget.style.boxShadow = 'none';
            }}
            onmouseenter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            }}
            onmouseleave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            }}
          >
            {cancelLabel}
          </button>

          {/* Confirm button */}
          <button
            tabIndex={roving.getItemProps(1).tabIndex}
            onclick={handleConfirm}
            onkeydown={(e) => {
              roving.getItemProps(1).onKeyDown(e);
            }}
            style={{
              background: confirmColors.bg,
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              padding: '0.6rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'transform 0.15s, box-shadow 0.15s',
              boxShadow: `0 2px 12px ${confirmColors.shadow}`,
              outline: 'none',
            }}
            onfocus={(e) => {
              e.currentTarget.style.boxShadow = `0 2px 12px ${confirmColors.shadow}, 0 0 0 2px rgba(99, 102, 241, 0.5)`;
              roving.getItemProps(1).onFocus();
            }}
            onblur={(e) => {
              e.currentTarget.style.boxShadow = `0 2px 12px ${confirmColors.shadow}`;
            }}
            onmouseenter={(e) => {
              e.currentTarget.style.transform = 'scale(1.03)';
              e.currentTarget.style.boxShadow = `0 4px 20px ${confirmColors.hoverShadow}`;
            }}
            onmouseleave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = `0 2px 12px ${confirmColors.shadow}`;
            }}
          >
            {confirmLabel}
          </button>
        </div>

        {/* Live region for announcing the result */}
        <LiveRegion priority="assertive">
          {() => resultMessage()}
        </LiveRegion>
      </div>
    </Modal>
  );
}
