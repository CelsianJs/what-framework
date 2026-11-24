// fixture.jsx as a native What file: signals for state, <motion.*> tags as islands.
import { signal } from 'what-framework';
import { AnimatePresence, motion } from 'framer-motion';
import { Draggable } from './parts.jsx';

const list = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.03 } } };
const item = { hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } };

export default function Native() {
  const moved = signal(false);
  const show = signal(true);
  const open = signal(false);
  const done = signal(0);
  return (
    <div style={{ padding: '20px' }}>
      <motion.div
        id="fm-box"
        initial={{ opacity: 0, x: 0 }}
        animate={{ opacity: 1, x: moved() ? 120 : 0 }}
        transition={{ duration: 0.15 }}
        onAnimationComplete={() => done(done.peek() + 1)}
        style={{ width: 50, height: 50, background: 'tomato' }}
      />
      <button id="fm-move" onClick={() => moved(!moved())}>move</button>
      <span id="fm-done">{done()}</span>

      <button id="fm-toggle" onClick={() => show(!show())}>toggle</button>
      <AnimatePresence>
        {show() && (
          <motion.p key="note" id="fm-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
            now you see me
          </motion.p>
        )}
      </AnimatePresence>

      <button id="fm-open" onClick={() => open(!open())}>list</button>
      <motion.ul id="fm-list" variants={list} initial="hidden" animate={open() ? 'visible' : 'hidden'}>
        {['a', 'b', 'c'].map((name) => <motion.li key={name} className="fm-item" variants={item}>{name}</motion.li>)}
      </motion.ul>

      <motion.button id="fm-hover" whileHover={{ scale: 1.5 }} whileTap={{ scale: 0.8 }} transition={{ duration: 0.05 }}>hover</motion.button>
      <Draggable />
    </div>
  );
}
