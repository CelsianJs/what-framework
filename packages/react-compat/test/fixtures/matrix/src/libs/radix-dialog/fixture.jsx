import { forwardRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Slot } from '@radix-ui/react-slot';

// A custom component under `asChild`: Radix clones it with the trigger's
// props and a merged ref.
const FancyButton = forwardRef(function FancyButton({ children, ...props }, ref) {
  return <button ref={ref} className="fancy" {...props}>{children}</button>;
});

function SlotLink({ asChild, ...props }) {
  const Comp = asChild ? Slot : 'a';
  return <Comp data-slotted="yes" {...props} />;
}

export default function Fixture() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState('');
  const [nested, setNested] = useState(0);
  return (
    <Tooltip.Provider delayDuration={0}>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <FancyButton id="rd-open">Edit profile</FancyButton>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay id="rd-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)' }} />
          <Dialog.Content id="rd-content" style={{ position: 'fixed', top: 100, left: 100, background: 'white', padding: 20 }}>
            <Dialog.Title>Edit profile</Dialog.Title>
            <Dialog.Description>Change your name.</Dialog.Description>
            <input id="rd-name" value={name} onChange={(e) => setName(e.target.value)} />
            <Popover.Root>
              <Popover.Trigger id="rd-nested-open">Nested</Popover.Trigger>
              <Popover.Portal>
                <Popover.Content id="rd-nested">
                  <button id="rd-nested-btn" onClick={() => setNested((n) => n + 1)}>inside {nested}</button>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <button id="rd-save" onClick={() => { setSaved(name); setOpen(false); }}>Save</button>
            <Dialog.Close id="rd-close">Cancel</Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <span id="rd-saved">{saved}</span>
      <span id="rd-state">{open ? 'open' : 'closed'}</span>

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

      <SlotLink asChild href="#x" id="rs-slot" className="from-slot"><span className="from-child">slotted</span></SlotLink>
      <button id="outside" style={{ position: 'fixed', right: 10, bottom: 10 }}>outside</button>
    </Tooltip.Provider>
  );
}
