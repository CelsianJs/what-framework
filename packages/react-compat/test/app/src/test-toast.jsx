/**
 * Test: react-hot-toast — lightweight toast notifications
 * 1.6M weekly downloads. Imperative toast() API + Toaster component.
 */
import toast, { Toaster } from 'react-hot-toast';

export function ToastTest() {
  return (
    <div>
      <Toaster position="top-right" />
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          onclick={() => toast.success('Operation completed!')}
          style={{ padding: '6px 14px', borderRadius: '4px', border: '1px solid #22c55e', background: '#f0fdf4', color: '#166534', cursor: 'pointer' }}
        >
          Success Toast
        </button>
        <button
          onclick={() => toast.error('Something went wrong')}
          style={{ padding: '6px 14px', borderRadius: '4px', border: '1px solid #ef4444', background: '#fef2f2', color: '#991b1b', cursor: 'pointer' }}
        >
          Error Toast
        </button>
        <button
          onclick={() => toast('Hello from What Framework!', { icon: '👋' })}
          style={{ padding: '6px 14px', borderRadius: '4px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer' }}
        >
          Custom Toast
        </button>
        <button
          onclick={() => {
            const id = toast.loading('Processing...');
            setTimeout(() => toast.success('Done!', { id }), 1500);
          }}
          style={{ padding: '6px 14px', borderRadius: '4px', border: '1px solid #3b82f6', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}
        >
          Loading Toast
        </button>
      </div>
      <p style={{ color: 'green' }} id="toast-status">React Hot Toast loaded OK</p>
    </div>
  );
}
