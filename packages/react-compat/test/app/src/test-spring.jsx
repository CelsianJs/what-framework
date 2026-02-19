/**
 * Test: React Spring inside What Framework
 *
 * React Spring uses a completely different animation model from Framer Motion:
 * - Spring physics simulation (not CSS keyframes)
 * - useSpring, useTrail, useTransition, useChain hooks
 * - Animated components (animated.div) with interpolation
 * - Imperative API via spring ref
 * - Complex hook interdependencies
 */
import { useState } from 'react';
import { useSpring, useTrail, animated, config } from '@react-spring/web';

function SpringBasic() {
  const [flipped, setFlipped] = useState(false);

  const spring = useSpring({
    transform: flipped ? 'rotateX(180deg)' : 'rotateX(0deg)',
    opacity: flipped ? 0.5 : 1,
    config: config.wobbly,
  });

  return (
    <div style={{ marginBottom: '16px' }}>
      <animated.div
        onclick={() => setFlipped((f) => !f)}
        style={{
          ...spring,
          width: '120px',
          height: '80px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 'bold',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {flipped ? 'Flipped!' : 'Click me'}
      </animated.div>
    </div>
  );
}

function SpringTrail() {
  const [open, setOpen] = useState(false);
  const items = ['Hello', 'World', 'From', 'React', 'Spring'];

  const trail = useTrail(items.length, {
    opacity: open ? 1 : 0,
    transform: open ? 'translateX(0px)' : 'translateX(-40px)',
    config: { mass: 1, tension: 280, friction: 20 },
  });

  return (
    <div>
      <button
        onclick={() => setOpen((o) => !o)}
        style={{
          padding: '4px 12px',
          marginBottom: '8px',
          borderRadius: '4px',
          border: '1px solid #ccc',
          background: '#f5f5f5',
          cursor: 'pointer',
        }}
      >
        {open ? 'Hide Trail' : 'Show Trail'}
      </button>
      <div style={{ display: 'flex', gap: '8px', minHeight: '32px' }}>
        {trail.map((style, i) => (
          <animated.span
            key={i}
            style={{
              ...style,
              padding: '4px 8px',
              background: '#e0e7ff',
              borderRadius: '4px',
              fontSize: '14px',
            }}
          >
            {items[i]}
          </animated.span>
        ))}
      </div>
    </div>
  );
}

export function SpringTest() {
  return (
    <div>
      <SpringBasic />
      <SpringTrail />
      <p style={{ color: 'green' }} id="spring-status">React Spring loaded OK</p>
    </div>
  );
}
