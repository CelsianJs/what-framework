// A Radix dialog opened from a native button and controlled by a What signal,
// with a What-controlled field and native components inside it; toasts from
// native click handlers through sonner and react-toastify; context in both
// directions.

import { signal } from 'what-framework';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { toast as toastify } from 'react-toastify';

import { NativeNote } from '../native-parts.jsx';
import { ThemeProvider, ThemedChip, DeskCard, DeskHeader } from '../react/Theme.jsx';

function NativeLayer(props) {
  return <div class="native-layer" data-native-layer>{props.children}</div>;
}

export function Overlays() {
  const open = signal(false);
  const name = signal('');
  let toasts = 0;
  // The dialog has no Radix Trigger (a native button opens it), so the
  // focus goes back to that button when it closes.
  let opener = null;
  const refocus = (e) => { e.preventDefault(); opener?.focus(); };
  return (
    <section data-route="overlays">
      <h1>Overlays</h1>
      <button type="button" data-open-dialog ref={(el) => { opener = el; }} onClick={() => open(true)}>Edit counterparty</button>
      <span data-dialog-state>{open() ? 'open' : 'closed'}</span>
      <span data-name-echo>{name()}</span>
      <Dialog.Root open={open()} onOpenChange={open}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog" data-dialog aria-describedby={undefined} onCloseAutoFocus={refocus}>
            <Dialog.Title>Counterparty</Dialog.Title>
            <input data-dialog-name value={name()} onChange={(e) => name(e.target.value)} />
            <NativeNote />
            <DeskCard label="in the dialog" />
            <Dialog.Close data-dialog-close>Done</Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <div class="toasts">
        <button type="button" data-sonner onClick={() => toast(`Trade booked ${++toasts}`)}>sonner toast</button>
        <button type="button" data-toastify onClick={() => toastify(`Limit raised ${++toasts}`)}>react-toastify toast</button>
        <button type="button" data-dismiss onClick={() => { toast.dismiss(); toastify.dismiss(); }}>dismiss all</button>
      </div>
      <h2>Context</h2>
      <ThemeProvider theme="dark">
        <NativeLayer>
          <ThemedChip />
        </NativeLayer>
      </ThemeProvider>
      <DeskCard label="on the page" />
      <DeskHeader />
    </section>
  );
}
