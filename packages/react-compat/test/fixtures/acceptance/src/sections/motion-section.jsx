import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function MotionSection() {
  const [shown, setShown] = useState(true);
  const [x, setX] = useState(0);
  return (
    <section id="motion-section">
      <h2>7. framer-motion (re-check)</h2>
      <button id="mo-toggle" onClick={() => setShown((s) => !s)}>toggle box</button>
      <button id="mo-move" onClick={() => setX((v) => v + 60)}>move</button>
      <div style={{ height: 60, position: 'relative' }}>
        <AnimatePresence>
          {shown && (
            <motion.div
              id="mo-box"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, x }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ width: 40, height: 40, background: '#4c6ef5', borderRadius: 8 }}
            />
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
