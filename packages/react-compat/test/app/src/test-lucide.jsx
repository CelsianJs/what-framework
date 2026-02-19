import { useState } from 'react';
import { Heart, Star, Zap, Sun, Moon, Github, Check, X, ArrowRight, Loader2 } from 'lucide-react';

export function LucideTest() {
  const [size, setSize] = useState(24);
  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <Heart color="red" size={size} />
        <Star color="gold" size={size} fill="gold" />
        <Zap color="#3b82f6" size={size} />
        <Sun color="orange" size={size} />
        <Moon color="slateblue" size={size} />
        <Github size={size} />
        <Check color="green" size={size} />
        <X color="red" size={size} />
        <ArrowRight size={size} />
        <Loader2 size={size} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
      <div style={{ marginTop: '8px' }}>
        <button onclick={() => setSize(s => Math.max(16, s - 4))}>Smaller</button>
        <span style={{ margin: '0 8px' }}>{size}px</span>
        <button onclick={() => setSize(s => Math.min(48, s + 4))}>Larger</button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <p style={{ color: 'green' }}>10 Lucide icons rendering with dynamic sizing</p>
    </div>
  );
}
