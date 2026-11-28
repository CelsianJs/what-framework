import { useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';

export default function Fixture() {
  const [layout, setLayout] = useState('');
  const [clicks, setClicks] = useState(0);
  return (
    <div>
      <div style={{ width: 600, height: 200 }}>
        <Group orientation="horizontal" onLayoutChange={(next) => setLayout(JSON.stringify(next))}>
          <Panel id="left" defaultSize="50%" minSize="10%">
            <div id="rp-left" style={{ height: '100%', background: '#def' }}>
              <button id="rp-btn" onClick={() => setClicks(clicks + 1)}>left {clicks}</button>
            </div>
          </Panel>
          <Separator id="rp-handle" style={{ width: 8, background: '#888' }} />
          <Panel id="right" minSize="10%">
            <div id="rp-right" style={{ height: '100%', background: '#fed' }}>right</div>
          </Panel>
        </Group>
      </div>
      <span id="rp-layout">{layout}</span>
    </div>
  );
}
