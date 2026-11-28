import { useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';

export default function Fixture() {
  const [closed, setClosed] = useState(0);
  return (
    <div>
      <Toaster position="bottom-right" toastOptions={{ duration: 60000 }} />
      <button id="ht-success" onClick={() => toast.success('Saved!')}>success</button>
      <button id="ht-error" onClick={() => toast.error('Broken', { id: 'err' })}>error</button>
      <button id="ht-short" onClick={() => toast('Short', { duration: 400 })}>short</button>
      <button id="ht-promise" onClick={() => toast.promise(new Promise((resolve) => setTimeout(resolve, 250)), { loading: 'Working', success: 'Finished', error: 'Nope' })}>promise</button>
      <button id="ht-custom" onClick={() => toast.custom((item) => <div id="ht-jsx">custom <button id="ht-jsx-close" onClick={() => { toast.dismiss(item.id); setClosed((n) => n + 1); }}>x</button></div>)}>custom</button>
      <button id="ht-dismiss" onClick={() => toast.dismiss()}>dismiss all</button>
      <span id="ht-closed">{closed}</span>
    </div>
  );
}
