import { useState } from 'react';
import { SnackbarProvider, useSnackbar } from 'notistack';

function NotificationButtons() {
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();
  const [count, setCount] = useState(0);

  function showNotification(variant) {
    setCount(c => c + 1);
    enqueueSnackbar(`Notification #${count + 1} (${variant})`, {
      variant,
      autoHideDuration: 2000,
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        <button
          onclick={() => showNotification('success')}
          style={{ padding: '3px 8px', cursor: 'pointer', background: '#166534', color: '#fff', border: 'none', borderRadius: '3px', fontSize: '11px' }}
        >
          Success
        </button>
        <button
          onclick={() => showNotification('error')}
          style={{ padding: '3px 8px', cursor: 'pointer', background: '#991b1b', color: '#fff', border: 'none', borderRadius: '3px', fontSize: '11px' }}
        >
          Error
        </button>
        <button
          onclick={() => showNotification('warning')}
          style={{ padding: '3px 8px', cursor: 'pointer', background: '#854d0e', color: '#fff', border: 'none', borderRadius: '3px', fontSize: '11px' }}
        >
          Warning
        </button>
        <button
          onclick={() => showNotification('info')}
          style={{ padding: '3px 8px', cursor: 'pointer', background: '#1e40af', color: '#fff', border: 'none', borderRadius: '3px', fontSize: '11px' }}
        >
          Info
        </button>
      </div>
      <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
        Sent: {count} notifications
      </div>
    </div>
  );
}

function TestComponent() {
  return (
    <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
      <NotificationButtons />
    </SnackbarProvider>
  );
}

TestComponent.packageName = 'notistack';
TestComponent.downloads = '1.2M/week';
export default TestComponent;
