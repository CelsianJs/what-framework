// Desk tools, each on a React package outside the compatibility matrix: the
// booking workflow as a React Flow diagram whose clicks and drags reach the
// store, money formatted by react-intl, and the parts in ToolParts.jsx.

import { signal } from 'what-framework';
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { IntlProvider, FormattedNumber } from 'react-intl';

import { SpringSwitch, PriorityList, AlertCount, alerts, NewsCarousel } from '../react/ToolParts.jsx';

export const workflow = signal([
  { id: 'book', position: { x: 0, y: 0 }, data: { label: 'Book' } },
  { id: 'check', position: { x: 0, y: 100 }, data: { label: 'Check' } },
]);
const links = [{ id: 'book-check', source: 'book', target: 'check' }];
export const priorities = signal(['Margin call', 'Client lunch', 'Risk review']);

export function Tools() {
  const picked = signal('');
  const on = signal(false);
  return (
    <section data-route="tools">
      <h1>Tools</h1>
      <div class="flow" data-flow>
        <ReactFlow
          defaultNodes={workflow()}
          defaultEdges={links}
          onNodeClick={(e, node) => picked(node.id)}
          onNodeDragStop={(e, node) => workflow(workflow().map((n) => (n.id === node.id ? { ...n, position: node.position } : n)))}
          fitView
        />
      </div>
      <p>Picked <b data-flow-picked>{picked()}</b>; positions <code data-flow-pos>{workflow().map((n) => `${n.id}:${Math.round(n.position.x)},${Math.round(n.position.y)}`).join(' ')}</code></p>
      <IntlProvider locale="de-DE"><p data-intl>Limit <FormattedNumber value={1234.5} style="currency" currency="EUR" /></p></IntlProvider>
      <button type="button" data-spring-toggle onClick={() => on(!on())}>switch</button>
      <SpringSwitch on={on()} />
      <PriorityList items={priorities()} onOrder={priorities} />
      <p>Order: <span data-dnd-order>{priorities().join(',')}</span></p>
      <button type="button" data-valtio-inc onClick={() => { alerts.count++; }}>raise alert</button>
      <AlertCount />
      <NewsCarousel />
    </section>
  );
}
