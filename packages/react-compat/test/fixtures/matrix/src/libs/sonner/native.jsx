// fixture.jsx as a native What file: <Toaster> is an island, toast() is called from native handlers.
import { signal } from 'what-framework';
import { Toaster, toast } from 'sonner';
// A React element for sonner, made in a React file.
import { createCustom } from './parts.jsx';

export default function Native() {
  const undone = signal(false);
  return (
    <div>
      <Toaster position="top-right" duration={60000} />
      <button id="so-plain" onClick={() => toast('Event created')}>plain</button>
      <button id="so-success" onClick={() => toast.success('Saved', { description: 'All changes stored' })}>success</button>
      <button id="so-action" onClick={() => toast('File deleted', { action: { label: 'Undo', onClick: () => undone(true) } })}>action</button>
      <button id="so-promise" onClick={() => toast.promise(new Promise((resolve) => setTimeout(() => resolve(42), 300)), { loading: 'Loading', success: (n) => `Done ${n}`, error: 'Failed' })}>promise</button>
      <button id="so-custom" onClick={() => toast.custom((id) => createCustom(id))}>custom</button>
      <button id="so-dismiss" onClick={() => toast.dismiss()}>dismiss all</button>
      <span id="so-undone">{String(undone())}</span>
    </div>
  );
}
