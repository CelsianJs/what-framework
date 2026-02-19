import { useState } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

function DragItem({ name }) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: 'ITEM',
    item: { name },
    collect: monitor => ({ isDragging: monitor.isDragging() }),
  }));
  return (
    <div ref={drag} style={{
      padding: '8px 12px', background: '#1e293b', borderRadius: '6px',
      cursor: 'grab', opacity: isDragging ? 0.4 : 1, border: '1px solid #334155',
    }}>
      {name}
    </div>
  );
}

function DropZone() {
  const [dropped, setDropped] = useState([]);
  const [{ isOver }, drop] = useDrop(() => ({
    accept: 'ITEM',
    drop: item => setDropped(prev => [...prev, item.name]),
    collect: monitor => ({ isOver: monitor.isOver() }),
  }));
  return (
    <div ref={drop} style={{
      minHeight: '80px', padding: '12px', borderRadius: '8px',
      border: '2px dashed ' + (isOver ? '#3b82f6' : '#444'),
      background: isOver ? '#3b82f610' : 'transparent',
    }}>
      {dropped.length === 0
        ? <span style={{ color: '#666' }}>Drop items here</span>
        : dropped.map((n, i) => <span key={i} style={{ marginRight: '8px' }}>{n}</span>)
      }
    </div>
  );
}

export function ReactDndTest() {
  return (
    <DndProvider backend={HTML5Backend}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <DragItem name="Item A" />
        <DragItem name="Item B" />
        <DragItem name="Item C" />
      </div>
      <DropZone />
      <p style={{ color: 'green', marginTop: '4px' }}>react-dnd with useDrag/useDrop hooks + HTML5Backend</p>
    </DndProvider>
  );
}
