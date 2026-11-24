// The same screen as fixture.jsx, written as a native What file: state is
// signals, and the Radix tags are React islands.
import { signal } from 'what-framework';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Slot } from '@radix-ui/react-slot';

export default function Native() {
  const open = signal(false);
  const name = signal('');
  const saved = signal('');
  const nested = signal(0);
  return (
    <div>
      <Tooltip.Provider delayDuration={0}>
        <Dialog.Root open={open()} onOpenChange={(next) => open(next)}>
          <Dialog.Trigger asChild>
            <button id="rd-open" className="fancy">Edit profile</button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay id="rd-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)' }} />
            <Dialog.Content id="rd-content" style={{ position: 'fixed', top: 100, left: 100, background: 'white', padding: 20 }}>
              <Dialog.Title>Edit profile</Dialog.Title>
              <Dialog.Description>Change your name.</Dialog.Description>
              <input id="rd-name" value={name()} onChange={(e) => name(e.target.value)} />
              <Popover.Root>
                <Popover.Trigger id="rd-nested-open">Nested</Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content id="rd-nested">
                    <button id="rd-nested-btn" onClick={() => nested(nested() + 1)}>inside {nested()}</button>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
              <button id="rd-save" onClick={() => { saved(name()); open(false); }}>Save</button>
              <Dialog.Close id="rd-close">Cancel</Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Popover.Root>
          <Popover.Trigger id="rp-open">More</Popover.Trigger>
          <Popover.Portal>
            <Popover.Content id="rp-content" sideOffset={8}>
              <p>Popover body</p>
              <Popover.Close id="rp-close">Done</Popover.Close>
              <Popover.Arrow />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <Tooltip.Root>
          <Tooltip.Trigger id="rt-trigger">Hover me</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content id="rt-content">Tip text</Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      <Slot data-slotted="yes" href="#x" id="rs-slot"><span>slotted</span></Slot>
      <span id="rd-saved">{saved()}</span>
      <span id="rd-state">{open() ? 'open' : 'closed'}</span>
      <button id="outside" style={{ position: 'fixed', right: '10px', bottom: '10px' }}>outside</button>
    </div>
  );
}
