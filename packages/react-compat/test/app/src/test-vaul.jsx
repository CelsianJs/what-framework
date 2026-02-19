import { Drawer } from 'vaul';

export function VaulTest() {
  return (
    <Drawer.Root>
      <Drawer.Trigger style={{ padding: '6px 12px' }}>Open Drawer</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
        <Drawer.Content style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'white', borderRadius: '12px 12px 0 0',
          padding: '24px', maxHeight: '50vh', color: '#333'
        }}>
          <div style={{ width: '40px', height: '4px', borderRadius: '2px', background: '#ddd', margin: '0 auto 16px' }} />
          <Drawer.Title style={{ fontWeight: 'bold', fontSize: '18px' }}>Vaul Drawer</Drawer.Title>
          <Drawer.Description style={{ color: '#666', marginTop: '8px' }}>
            This is a mobile-friendly drawer component from the vaul library, built on Radix primitives.
          </Drawer.Description>
          <Drawer.Close style={{ marginTop: '16px', padding: '6px 12px' }}>Close</Drawer.Close>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
