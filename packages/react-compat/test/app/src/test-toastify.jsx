/**
 * Test: react-toastify — toast notifications for React
 * 2.6M weekly downloads. Portals, Context for toast container.
 */
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export function ToastifyTest() {
  return (
    <div>
      <ToastContainer position="bottom-right" autoClose={2000} />
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          onclick={() => toast.success('Success notification!')}
          style={{ padding: '6px 14px', borderRadius: '4px', border: '1px solid #22c55e', background: '#f0fdf4', color: '#166534', cursor: 'pointer' }}
        >
          Success
        </button>
        <button
          onclick={() => toast.error('Error notification!')}
          style={{ padding: '6px 14px', borderRadius: '4px', border: '1px solid #ef4444', background: '#fef2f2', color: '#991b1b', cursor: 'pointer' }}
        >
          Error
        </button>
        <button
          onclick={() => toast.info('Info notification')}
          style={{ padding: '6px 14px', borderRadius: '4px', border: '1px solid #3b82f6', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}
        >
          Info
        </button>
        <button
          onclick={() => toast.warn('Warning notification')}
          style={{ padding: '6px 14px', borderRadius: '4px', border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e', cursor: 'pointer' }}
        >
          Warning
        </button>
      </div>
      <p style={{ color: 'green' }} id="toastify-status">React Toastify loaded OK</p>
    </div>
  );
}
