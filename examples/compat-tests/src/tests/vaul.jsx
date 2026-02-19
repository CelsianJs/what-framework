import { Drawer } from 'vaul';

function TestComponent() {
  return (
    <Drawer.Root>
      <Drawer.Trigger asChild>
        <button style={{ padding: '6px 12px', cursor: 'pointer', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}>
          Open Drawer
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999 }} />
        <Drawer.Content style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#1a1a1a',
          borderTopLeftRadius: '12px',
          borderTopRightRadius: '12px',
          padding: '24px',
          zIndex: 1000,
          minHeight: '200px'
        }}>
          <Drawer.Title style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
            Drawer Title
          </Drawer.Title>
          <Drawer.Description style={{ color: '#aaa' }}>
            This is a drawer component from vaul, rendered via What's React compat layer.
          </Drawer.Description>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

TestComponent.packageName = 'vaul';
TestComponent.downloads = '6.9M/week';
export default TestComponent;
