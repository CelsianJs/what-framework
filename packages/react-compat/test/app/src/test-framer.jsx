/**
 * Test: Framer Motion components inside What Framework
 *
 * Framer Motion uses hooks, refs, context, and animation scheduling.
 * If this works, most UI libraries will too.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

export function FramerTest() {
  const [isVisible, setVisible] = useState(true);

  return (
    <div>
      <button onclick={() => setVisible(v => !v)}>
        Toggle Animation
      </button>
      <AnimatePresence>
        {isVisible && (
          <motion.div
            key="box"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              width: '100px',
              height: '100px',
              background: '#2563eb',
              borderRadius: '12px',
              marginTop: '1rem',
            }}
          />
        )}
      </AnimatePresence>
      <p style="color: green;" id="framer-status">Framer Motion loaded OK</p>
    </div>
  );
}
