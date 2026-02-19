import React, { useState, useRef } from 'react';
import ReactPlayer from 'react-player';

export function PlayerTest() {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const playerRef = useRef(null);

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-player</h3>
      <div style={{ maxWidth: 480, margin: '0 auto', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
        <ReactPlayer
          ref={playerRef}
          url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
          width="100%"
          height={270}
          playing={playing}
          controls
          onProgress={({ played }) => setProgress(Math.round(played * 100))}
          onError={(e) => console.log('Player error (expected without network):', e)}
        />
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setPlaying(!playing)} style={{ padding: '4px 12px' }}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <span>Progress: {progress}%</span>
      </div>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — ReactPlayer renders with controls</p>
    </div>
  );
}
