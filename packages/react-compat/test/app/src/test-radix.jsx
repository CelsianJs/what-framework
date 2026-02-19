/**
 * Test: Radix UI Popover inside What Framework
 *
 * Radix UI is the hardest compat test — it uses:
 * - React.createContext / useContext extensively
 * - React.forwardRef for all primitives
 * - Portals (via react-dom createPortal)
 * - Refs (callback refs and object refs)
 * - Composed event handlers
 *
 * If this works, virtually any headless UI library will too.
 */
import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';

export function RadixTest() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id="radix-trigger"
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #ccc',
              background: '#f9f9f9',
              cursor: 'pointer',
            }}
          >
            Open Popover
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            id="radix-content"
            sideOffset={5}
            style={{
              background: 'white',
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '16px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              minWidth: '200px',
            }}
          >
            <p style={{ margin: '0 0 8px 0', fontWeight: 'bold' }}>
              Popover Content
            </p>
            <p style={{ margin: '0 0 12px 0', color: '#666' }}>
              This is rendered via a React portal.
            </p>
            <Popover.Close asChild>
              <button
                id="radix-close"
                style={{
                  padding: '4px 12px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  background: '#eee',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </Popover.Close>
            <Popover.Arrow style={{ fill: 'white' }} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <p style={{ color: 'green' }} id="radix-status">Radix loaded OK</p>
    </div>
  );
}
