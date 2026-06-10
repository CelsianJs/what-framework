import toast, { Toaster } from 'react-hot-toast';

export function ToastSection() {
  return (
    <section id="toast-section">
      <h2>5. react-hot-toast</h2>
      <Toaster position="bottom-right" />
      <button id="t-fire" onClick={() => toast.success('Toast works!')}>fire toast</button>
    </section>
  );
}
