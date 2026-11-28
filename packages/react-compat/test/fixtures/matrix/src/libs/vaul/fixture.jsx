import { useState } from 'react';
import { Drawer } from 'vaul';

export default function Fixture() {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  return (
    <div>
      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Trigger id="va-open">Open drawer</Drawer.Trigger>
        <Drawer.Portal>
          <Drawer.Overlay id="va-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)' }} />
          <Drawer.Content id="va-content" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 320, background: 'white' }}>
            <Drawer.Handle id="va-handle" />
            <Drawer.Title>Notes</Drawer.Title>
            <Drawer.Description>Write something.</Drawer.Description>
            <input id="va-input" value={note} onChange={(e) => setNote(e.target.value)} />
            <Drawer.Close id="va-close">Close</Drawer.Close>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      <span id="va-state">{open ? 'open' : 'closed'}</span>
      <span id="va-note">{note}</span>
    </div>
  );
}
