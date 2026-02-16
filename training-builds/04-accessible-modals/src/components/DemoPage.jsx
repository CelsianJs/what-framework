import { useSignal, useRef, LiveRegion } from 'what-framework';
import { Modal } from './Modal.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { ModalTrigger } from './ModalTrigger.jsx';
import { ButtonGroup } from './ButtonGroup.jsx';

/**
 * DemoPage
 * Main content area demonstrating various modal types.
 * Contains trigger buttons for each modal variation
 * and a status area (LiveRegion) announcing actions.
 */
const kbdStyle = {
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: '4px',
  padding: '0.15rem 0.4rem',
  fontSize: '0.8rem',
  fontFamily: 'monospace',
  color: '#a78bfa',
};

const kbdListStyle = {
  display: 'inline-block',
  minWidth: '90px',
  textAlign: 'center',
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: '6px',
  padding: '0.25rem 0.5rem',
  fontSize: '0.8rem',
  fontFamily: 'monospace',
  color: '#a78bfa',
};

const primaryButtonStyle = {
  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  padding: '0.6rem 1.25rem',
  fontSize: '0.875rem',
  fontWeight: '600',
  cursor: 'pointer',
  transition: 'transform 0.15s, box-shadow 0.15s',
  boxShadow: '0 2px 12px rgba(99, 102, 241, 0.3)',
};

const successButtonStyle = {
  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  padding: '0.6rem 1.25rem',
  fontSize: '0.875rem',
  fontWeight: '600',
  cursor: 'pointer',
  transition: 'transform 0.15s, box-shadow 0.15s',
  boxShadow: '0 2px 12px rgba(34, 197, 94, 0.3)',
};

export function DemoPage() {
  // Modal open states
  const basicModalOpen = useSignal(false);
  const confirmDeleteOpen = useSignal(false);
  const infoDialogOpen = useSignal(false);

  // Trigger refs for focus restoration
  const basicTriggerRef = useRef(null);
  const confirmTriggerRef = useRef(null);
  const infoTriggerRef = useRef(null);

  // Status messages
  const statusMessage = useSignal('');

  function setStatus(msg) {
    statusMessage(msg);
    // Clear after a few seconds
    setTimeout(() => statusMessage(''), 4000);
  }

  return (
    <main id="main" tabindex="-1" style={{ outline: 'none' }}>
      {/* Page header */}
      <div style={{ marginBottom: '2.5rem' }}>
        <h1 style={{
          fontSize: '1.75rem',
          fontWeight: '700',
          color: '#f0f0f0',
          margin: '0 0 0.5rem 0',
        }}>
          Accessible Modal System
        </h1>
        <p style={{
          fontSize: '0.95rem',
          color: '#71717a',
          margin: '0',
          lineHeight: '1.6',
        }}>
          Fully accessible modals with focus trapping, keyboard navigation,
          screen reader announcements, and animated transitions.
        </p>
      </div>

      {/* Demo section: Trigger buttons */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{
          fontSize: '1.1rem',
          fontWeight: '600',
          color: '#d4d4d8',
          margin: '0 0 1rem 0',
        }}>
          Modal Triggers
        </h2>

        <div style={{
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}>
          <ModalTrigger
            label="Basic Modal"
            variant="primary"
            onclick={(ref) => {
              basicTriggerRef.current = ref.current;
              basicModalOpen(true);
            }}
          />
          <ModalTrigger
            label="Confirm Delete"
            variant="danger"
            onclick={(ref) => {
              confirmTriggerRef.current = ref.current;
              confirmDeleteOpen(true);
            }}
          />
          <ModalTrigger
            label="Info Dialog"
            variant="success"
            onclick={(ref) => {
              infoTriggerRef.current = ref.current;
              infoDialogOpen(true);
            }}
          />
        </div>
      </section>

      {/* Demo section: Button Group with roving tab index */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{
          fontSize: '1.1rem',
          fontWeight: '600',
          color: '#d4d4d8',
          margin: '0 0 1rem 0',
        }}>
          Button Group (Arrow Key Navigation)
        </h2>

        <ButtonGroup
          ariaLabel="Sample actions"
          buttons={[
            { label: 'Save', variant: 'primary', onclick: () => setStatus('Save clicked') },
            { label: 'Export', variant: 'success', onclick: () => setStatus('Export clicked') },
            { label: 'Delete', variant: 'danger', onclick: () => setStatus('Delete clicked') },
            { label: 'Cancel', variant: 'default', onclick: () => setStatus('Cancel clicked') },
          ]}
        />
      </section>

      {/* Keyboard hints */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{
          fontSize: '1.1rem',
          fontWeight: '600',
          color: '#d4d4d8',
          margin: '0 0 1rem 0',
        }}>
          Keyboard Shortcuts
        </h2>
        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: '12px',
          padding: '1.25rem',
        }}>
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {[
              { key: 'Tab', desc: 'Move focus to next focusable element' },
              { key: 'Shift+Tab', desc: 'Move focus to previous focusable element' },
              { key: 'Escape', desc: 'Close the active modal' },
              { key: 'Enter', desc: 'Activate the focused button' },
              { key: '\u2190 \u2192', desc: 'Navigate between buttons in a group' },
              { key: 'Home / End', desc: 'Jump to first / last in group' },
            ].map((item) => (
              <div key={item.key} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
              }}>
                <kbd style={kbdListStyle}>
                  {item.key}
                </kbd>
                <span style={{
                  fontSize: '0.85rem',
                  color: '#a1a1aa',
                }}>
                  {item.desc}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Status message area */}
      <section>
        <h2 style={{
          fontSize: '1.1rem',
          fontWeight: '600',
          color: '#d4d4d8',
          margin: '0 0 0.75rem 0',
        }}>
          Status
        </h2>
        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: '12px',
          padding: '1rem 1.25rem',
          minHeight: '3rem',
          display: 'flex',
          alignItems: 'center',
        }}>
          <LiveRegion priority="polite">
            {() => {
              const msg = statusMessage();
              return msg ? (
                <span style={{
                  color: '#a78bfa',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                }}>
                  {msg}
                </span>
              ) : (
                <span style={{
                  color: '#52525b',
                  fontSize: '0.9rem',
                  fontStyle: 'italic',
                }}>
                  No recent actions
                </span>
              );
            }}
          </LiveRegion>
        </div>
      </section>

      {/* ---- MODALS ---- */}

      {/* Basic Modal */}
      {() => basicModalOpen() ? (
        <Modal
          isOpen={true}
          onClose={() => {
            basicModalOpen(false);
            setStatus('Basic modal closed');
            if (basicTriggerRef.current) basicTriggerRef.current.focus();
          }}
          title="Welcome"
          description="An introductory dialog demonstrating basic modal functionality."
        >
          <div>
            <p style={{
              color: '#d4d4d8',
              fontSize: '0.95rem',
              lineHeight: '1.6',
              margin: '0 0 1rem 0',
            }}>
              This is a basic modal dialog. It demonstrates focus trapping,
              escape key handling, backdrop click dismissal, and screen reader
              announcements.
            </p>
            <p style={{
              color: '#a1a1aa',
              fontSize: '0.85rem',
              lineHeight: '1.6',
              margin: '0 0 1.25rem 0',
            }}>
              Try pressing <kbd style={kbdStyle}>Tab</kbd> to cycle through focusable elements,
              or <kbd style={kbdStyle}>Escape</kbd> to close.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onclick={() => {
                  basicModalOpen(false);
                  setStatus('Basic modal closed via button');
                  if (basicTriggerRef.current) basicTriggerRef.current.focus();
                }}
                style={primaryButtonStyle}
                onmouseenter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.03)';
                }}
                onmouseleave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                Got it
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Confirm Delete Dialog */}
      {() => confirmDeleteOpen() ? (
        <ConfirmDialog
          isOpen={true}
          onClose={() => {
            confirmDeleteOpen(false);
            if (confirmTriggerRef.current) confirmTriggerRef.current.focus();
          }}
          onConfirm={() => setStatus('Item deleted successfully')}
          title="Delete Item"
          message="Are you sure you want to delete this item? This action cannot be undone and all associated data will be permanently removed."
          confirmLabel="Delete"
          cancelLabel="Keep"
          variant="danger"
          onResult={(result) => setStatus(result)}
        />
      ) : null}

      {/* Info Dialog */}
      {() => infoDialogOpen() ? (
        <Modal
          isOpen={true}
          onClose={() => {
            infoDialogOpen(false);
            setStatus('Info dialog closed');
            if (infoTriggerRef.current) infoTriggerRef.current.focus();
          }}
          title="About Accessibility"
          description="Information about the accessibility features in this modal system."
        >
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem',
              padding: '0.75rem',
              background: 'rgba(34, 197, 94, 0.08)',
              borderRadius: '10px',
              border: '1px solid rgba(34, 197, 94, 0.15)',
            }}>
              <span style={{ fontSize: '1.5rem' }}>{'\u2713'}</span>
              <span style={{ color: '#4ade80', fontSize: '0.9rem', fontWeight: '500' }}>
                All WCAG 2.1 AA criteria met
              </span>
            </div>

            <h3 style={{
              fontSize: '0.95rem',
              fontWeight: '600',
              color: '#e5e5e5',
              margin: '0 0 0.75rem 0',
            }}>
              Features included:
            </h3>
            <ul style={{
              color: '#a1a1aa',
              fontSize: '0.85rem',
              lineHeight: '1.8',
              paddingLeft: '1.25rem',
              margin: '0 0 1.25rem 0',
            }}>
              <li>Focus trapping within modal boundaries</li>
              <li>Keyboard-only navigation support</li>
              <li>Screen reader announcements on open/close</li>
              <li>ARIA labels and descriptions</li>
              <li>Focus restoration to trigger element</li>
              <li>Escape key to dismiss</li>
              <li>Click outside to dismiss</li>
              <li>Roving tab index for button groups</li>
            </ul>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onclick={() => {
                  infoDialogOpen(false);
                  setStatus('Info dialog closed');
                  if (infoTriggerRef.current) infoTriggerRef.current.focus();
                }}
                style={successButtonStyle}
                onmouseenter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.03)';
                }}
                onmouseleave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                Understood
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
