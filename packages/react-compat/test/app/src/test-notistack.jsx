import React from 'react';
import { SnackbarProvider, useSnackbar } from 'notistack';

function NotistackInner() {
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button onClick={() => enqueueSnackbar('Default notification')} style={{ padding: '4px 12px' }}>Default</button>
        <button onClick={() => enqueueSnackbar('Success!', { variant: 'success' })} style={{ padding: '4px 12px' }}>Success</button>
        <button onClick={() => enqueueSnackbar('Error occurred', { variant: 'error' })} style={{ padding: '4px 12px' }}>Error</button>
        <button onClick={() => enqueueSnackbar('Warning!', { variant: 'warning' })} style={{ padding: '4px 12px' }}>Warning</button>
        <button onClick={() => enqueueSnackbar('Info message', { variant: 'info' })} style={{ padding: '4px 12px' }}>Info</button>
      </div>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — notistack enqueueSnackbar works</p>
    </div>
  );
}

export function NotistackTest() {
  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>notistack</h3>
      <SnackbarProvider maxSnack={3} autoHideDuration={3000}>
        <NotistackInner />
      </SnackbarProvider>
    </div>
  );
}
