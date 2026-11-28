// fixture.jsx as a native What file: signals for state, the Drawer is an island.
import { signal } from 'what-framework';
import { Drawer } from 'vaul';

export default function Native() {
  const open = signal(false);
  const note = signal('');
  return (
    <div>
      <Drawer.Root open={open()} onOpenChange={(next) => open(next)}>
        <Drawer.Trigger id="va-open">Open drawer</Drawer.Trigger>
        <Drawer.Portal>
          <Drawer.Overlay id="va-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)' }} />
          <Drawer.Content id="va-content" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 320, background: 'white' }}>
            <Drawer.Handle id="va-handle" />
            <Drawer.Title>Notes</Drawer.Title>
            <Drawer.Description>Write something.</Drawer.Description>
            <input id="va-input" value={note()} onChange={(e) => note(e.target.value)} />
            <Drawer.Close id="va-close">Close</Drawer.Close>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      <span id="va-state">{open() ? 'open' : 'closed'}</span>
      <span id="va-note">{note()}</span>
    </div>
  );
}
