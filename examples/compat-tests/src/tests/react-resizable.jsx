import { useState } from 'react';
import { ResizableBox } from 'react-resizable';

function TestComponent() {
  const [size, setSize] = useState({ width: 150, height: 60 });

  function handleResize(e, { size: newSize }) {
    setSize({ width: newSize.width, height: newSize.height });
  }

  return (
    <div>
      <ResizableBox
        width={size.width}
        height={size.height}
        minConstraints={[80, 40]}
        maxConstraints={[280, 120]}
        onResize={handleResize}
        resizeHandles={['se']}
      >
        <div style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #059669, #10b981)',
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          color: '#fff',
        }}>
          {Math.round(size.width)}x{Math.round(size.height)}
        </div>
      </ResizableBox>
      <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
        Drag corner to resize (min: 80x40, max: 280x120)
      </div>
    </div>
  );
}

TestComponent.packageName = 'react-resizable';
TestComponent.downloads = '2.2M/week';
export default TestComponent;
