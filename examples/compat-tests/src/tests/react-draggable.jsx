import { useState, useRef } from 'react';
import Draggable from 'react-draggable';

function TestComponent() {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const nodeRef = useRef(null);

  function handleDrag(e, data) {
    setPosition({ x: data.x, y: data.y });
  }

  return (
    <div style={{ position: 'relative', height: '100px', overflow: 'hidden' }}>
      <Draggable
        nodeRef={nodeRef}
        position={position}
        onDrag={handleDrag}
        bounds="parent"
      >
        <div ref={nodeRef} style={{
          width: '80px',
          height: '36px',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          fontSize: '11px',
          color: '#fff',
          userSelect: 'none',
        }}>
          Drag me
        </div>
      </Draggable>
      <div style={{ fontSize: '11px', color: '#888', position: 'absolute', bottom: '4px', left: '4px' }}>
        Position: ({Math.round(position.x)}, {Math.round(position.y)})
      </div>
    </div>
  );
}

TestComponent.packageName = 'react-draggable';
TestComponent.downloads = '4M/week';
export default TestComponent;
