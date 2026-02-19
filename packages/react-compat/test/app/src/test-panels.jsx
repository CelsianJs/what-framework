import { Panel, Group, Separator } from 'react-resizable-panels';

export function PanelsTest() {
  return (
    <div>
      <Group direction="horizontal" style={{ height: '120px', border: '1px solid #444', borderRadius: '8px', overflow: 'hidden' }}>
        <Panel defaultSize={30} minSize={20}>
          <div style={{ height: '100%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
            Sidebar
          </div>
        </Panel>
        <Separator style={{ width: '4px', background: '#334155', cursor: 'col-resize' }} />
        <Panel minSize={30}>
          <div style={{ height: '100%', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
            Main Content
          </div>
        </Panel>
        <Separator style={{ width: '4px', background: '#334155', cursor: 'col-resize' }} />
        <Panel defaultSize={25} minSize={15}>
          <div style={{ height: '100%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
            Inspector
          </div>
        </Panel>
      </Group>
      <p style={{ color: 'green', marginTop: '4px' }}>react-resizable-panels with 3 resizable panes</p>
    </div>
  );
}
