// fixture.jsx as a native What file: <Toaster> is an island, toast() is called from native handlers.
import { signal } from 'what-framework';
import toast, { Toaster } from 'react-hot-toast';
import { createCustom } from './parts.jsx';

export default function Native() {
  const closed = signal(0);
  return (
    <div>
      <Toaster position="bottom-right" toastOptions={{ duration: 60000 }} />
      <button id="ht-success" onClick={() => toast.success('Saved!')}>success</button>
      <button id="ht-error" onClick={() => toast.error('Broken', { id: 'err' })}>error</button>
      <button id="ht-short" onClick={() => toast('Short', { duration: 400 })}>short</button>
      <button id="ht-promise" onClick={() => toast.promise(new Promise((resolve) => setTimeout(resolve, 250)), { loading: 'Working', success: 'Finished', error: 'Nope' })}>promise</button>
      <button id="ht-custom" onClick={() => toast.custom((item) => createCustom(item, () => closed(closed() + 1)))}>custom</button>
      <button id="ht-dismiss" onClick={() => toast.dismiss()}>dismiss all</button>
      <span id="ht-closed">{closed()}</span>
    </div>
  );
}
