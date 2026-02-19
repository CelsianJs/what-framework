/**
 * Test: @dnd-kit — modern drag-and-drop toolkit
 * 8.4M weekly downloads. Context + hooks + sensors.
 */
import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableItem({ id, label }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    padding: '10px 14px',
    marginBottom: '4px',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
    background: isDragging ? '#eff6ff' : 'white',
    cursor: 'grab',
    userSelect: 'none',
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {label}
    </div>
  );
}

export function DndTest() {
  const [items, setItems] = useState([
    { id: '1', label: '🟦 First item' },
    { id: '2', label: '🟩 Second item' },
    { id: '3', label: '🟨 Third item' },
    { id: '4', label: '🟪 Fourth item' },
    { id: '5', label: '🟧 Fifth item' },
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (active.id !== over?.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex(i => i.id === active.id);
        const newIndex = prev.findIndex(i => i.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
          <div style={{ maxWidth: '300px' }}>
            {items.map(item => (
              <SortableItem key={item.id} id={item.id} label={item.label} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <p style={{ color: '#666', fontSize: '12px', marginTop: '4px' }}>Drag items to reorder</p>
      <p style={{ color: 'green' }} id="dnd-status">dnd-kit loaded OK</p>
    </div>
  );
}
