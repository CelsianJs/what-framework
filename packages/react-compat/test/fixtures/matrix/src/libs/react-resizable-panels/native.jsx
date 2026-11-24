// fixture.jsx as a native What file: signals for state, the panel group is an island.
import { signal } from 'what-framework';
import { Group, Panel, Separator } from 'react-resizable-panels';

export default function Native() {
  const layout = signal('');
  const clicks = signal(0);
  return (
    <div>
      <div style={{ width: '600px', height: '200px' }}>
        <Group orientation="horizontal" onLayoutChange={(next) => layout(JSON.stringify(next))}>
          <Panel id="left" defaultSize="50%" minSize="10%">
            <div id="rp-left" style={{ height: '100%', background: '#def' }}>
              <button id="rp-btn" onClick={() => clicks(clicks() + 1)}>left {clicks()}</button>
            </div>
          </Panel>
          <Separator id="rp-handle" style={{ width: 8, background: '#888' }} />
          <Panel id="right" minSize="10%">
            <div id="rp-right" style={{ height: '100%', background: '#fed' }}>right</div>
          </Panel>
        </Group>
      </div>
      <span id="rp-layout">{layout()}</span>
    </div>
  );
}
