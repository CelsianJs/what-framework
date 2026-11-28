import { useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function Item({ id }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, height: 40, width: 200, border: '1px solid #999', boxSizing: 'border-box', opacity: isDragging ? 0.4 : 1 };
  return <div id={`dk-${id}`} className="dk-item" ref={setNodeRef} style={style} {...attributes} {...listeners}>{id}</div>;
}

export default function Fixture() {
  const [items, setItems] = useState(['A', 'B', 'C', 'D']);
  const [active, setActive] = useState(null);
  const [drops, setDrops] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return (
    <div style={{ padding: 20 }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(event) => setActive(event.active.id)}
        onDragCancel={() => setActive(null)}
        onDragEnd={({ active: from, over }) => {
          setActive(null);
          setDrops((n) => n + 1);
          if (over && from.id !== over.id) setItems((list) => arrayMove(list, list.indexOf(from.id), list.indexOf(over.id)));
        }}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {items.map((id) => <Item key={id} id={id} />)}
        </SortableContext>
        <DragOverlay dropAnimation={null}>{active ? <div id="dk-overlay">dragging {active}</div> : null}</DragOverlay>
      </DndContext>
      <span id="dk-order">{items.join('')}</span>
      <span id="dk-active">{active ?? 'none'}</span>
      <span id="dk-drops">{drops}</span>
    </div>
  );
}
