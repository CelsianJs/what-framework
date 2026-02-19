import React from 'react';
import { useMediaQuery } from 'react-responsive';

function DeviceInfo() {
  const isDesktop = useMediaQuery({ minWidth: 1024 });
  const isTablet = useMediaQuery({ minWidth: 768, maxWidth: 1023 });
  const isMobile = useMediaQuery({ maxWidth: 767 });
  const isPortrait = useMediaQuery({ orientation: 'portrait' });
  const isRetina = useMediaQuery({ minResolution: '2dppx' });

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, margin: '8px 0' }}>
        <div style={{ padding: 8, borderRadius: 4, background: isDesktop ? '#e8f5e9' : '#f5f5f5', border: `1px solid ${isDesktop ? '#4caf50' : '#ddd'}`, textAlign: 'center' }}>
          Desktop {isDesktop ? '✓' : '○'}
        </div>
        <div style={{ padding: 8, borderRadius: 4, background: isTablet ? '#e3f2fd' : '#f5f5f5', border: `1px solid ${isTablet ? '#2196f3' : '#ddd'}`, textAlign: 'center' }}>
          Tablet {isTablet ? '✓' : '○'}
        </div>
        <div style={{ padding: 8, borderRadius: 4, background: isMobile ? '#fff3e0' : '#f5f5f5', border: `1px solid ${isMobile ? '#ff9800' : '#ddd'}`, textAlign: 'center' }}>
          Mobile {isMobile ? '✓' : '○'}
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#666' }}>
        Orientation: {isPortrait ? 'Portrait' : 'Landscape'} | Retina: {isRetina ? 'Yes' : 'No'}
      </div>
    </div>
  );
}

export function ResponsiveTest() {
  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-responsive</h3>
      <DeviceInfo />
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — useMediaQuery hooks work</p>
    </div>
  );
}
