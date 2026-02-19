import { Toaster, toast } from 'sonner';

export function SonnerTest() {
  return (
    <div>
      <Toaster position="bottom-right" richColors />
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button onclick={() => toast.success('Action completed!')}>Success</button>
        <button onclick={() => toast.error('Something went wrong')}>Error</button>
        <button onclick={() => toast.info('FYI: this is informational')}>Info</button>
        <button onclick={() => toast.warning('Careful with that!')}>Warning</button>
        <button onclick={() => toast.promise(
          new Promise(r => setTimeout(r, 1500)),
          { loading: 'Loading...', success: 'Done!', error: 'Failed' }
        )}>Promise</button>
      </div>
      <p style={{ color: 'green', marginTop: '4px' }}>Sonner toast notifications with 5 variants</p>
    </div>
  );
}
