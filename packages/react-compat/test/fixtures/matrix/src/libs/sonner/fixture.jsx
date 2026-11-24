import { useState } from 'react';
import { Toaster, toast } from 'sonner';

export default function Fixture() {
  const [undone, setUndone] = useState(false);
  return (
    <div>
      <Toaster position="top-right" duration={60000} />
      <button id="so-plain" onClick={() => toast('Event created')}>plain</button>
      <button id="so-success" onClick={() => toast.success('Saved', { description: 'All changes stored' })}>success</button>
      <button id="so-action" onClick={() => toast('File deleted', { action: { label: 'Undo', onClick: () => setUndone(true) } })}>action</button>
      <button id="so-promise" onClick={() => toast.promise(new Promise((resolve) => setTimeout(() => resolve(42), 300)), { loading: 'Loading', success: (n) => `Done ${n}`, error: 'Failed' })}>promise</button>
      <button id="so-custom" onClick={() => toast.custom((id) => <div id="so-jsx">custom <button id="so-jsx-close" onClick={() => toast.dismiss(id)}>x</button></div>)}>custom</button>
      <button id="so-dismiss" onClick={() => toast.dismiss()}>dismiss all</button>
      <span id="so-undone">{String(undone)}</span>
    </div>
  );
}
