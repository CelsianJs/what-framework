// React parts of the tools screen, from packages outside the compatibility
// matrix: a spring-animated switch (@react-spring/web), a priority list
// dragged by keyboard or pointer (@hello-pangea/dnd), a shared counter in a
// valtio proxy, and a news carousel (embla-carousel-react).
import { useState } from 'react';
import { useSpring, animated } from '@react-spring/web';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { proxy, useSnapshot } from 'valtio';
import useEmblaCarousel from 'embla-carousel-react';
import { useProbe } from './probe.js';

export function SpringSwitch({ on }) {
  useProbe('spring-switch');
  const style = useSpring({ x: on ? 120 : 0, config: { duration: 120 } });
  return <animated.div className="spring-knob" data-spring style={style} />;
}

export function PriorityList({ items, onOrder }) {
  useProbe('priority-list');
  return (
    <DragDropContext onDragEnd={(r) => {
      if (!r.destination) return;
      const next = items.slice();
      const [moved] = next.splice(r.source.index, 1);
      next.splice(r.destination.index, 0, moved);
      onOrder(next);
    }}>
      <Droppable droppableId="priorities">
        {(drop) => (
          <ul className="priorities" ref={drop.innerRef} {...drop.droppableProps} data-dnd-list>
            {items.map((item, i) => (
              <Draggable key={item} draggableId={item} index={i}>
                {(drag) => <li ref={drag.innerRef} {...drag.draggableProps} {...drag.dragHandleProps} data-dnd-item={item}>{item}</li>}
              </Draggable>
            ))}
            {drop.placeholder}
          </ul>
        )}
      </Droppable>
    </DragDropContext>
  );
}

export const alerts = proxy({ count: 0 });

export function AlertCount() {
  useProbe('alert-count');
  const snap = useSnapshot(alerts);
  return <b data-valtio>{snap.count}</b>;
}

export function NewsCarousel() {
  useProbe('news-carousel');
  const [viewport, api] = useEmblaCarousel();
  const [selected, setSelected] = useState(0);
  return (
    <div className="carousel">
      <div className="embla" ref={viewport} data-embla>
        <div className="embla-track">{['Rates steady', 'Credit wide', 'FX quiet'].map((t) => <div className="embla-slide" key={t}>{t}</div>)}</div>
      </div>
      <button type="button" data-embla-next onClick={() => { api?.scrollNext(); setSelected(api?.selectedScrollSnap() ?? -1); }}>next story</button>
      <span data-embla-sel>{selected}</span>
    </div>
  );
}
