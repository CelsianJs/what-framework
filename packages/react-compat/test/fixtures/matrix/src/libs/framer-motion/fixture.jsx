import { useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion';

const list = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.03 } } };
const item = { hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } };

function Draggable() {
  const x = useMotionValue(0);
  const rounded = useTransform(x, (v) => Math.round(v));
  return (
    <div>
      <motion.div id="fm-drag" drag="x" dragMomentum={false} dragElastic={0} style={{ x, width: 60, height: 40, background: '#36c' }} />
      <motion.span id="fm-x">{rounded}</motion.span>
    </div>
  );
}

export default function Fixture() {
  const [moved, setMoved] = useState(false);
  const [show, setShow] = useState(true);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(0);
  return (
    <div style={{ padding: 20 }}>
      <motion.div
        id="fm-box"
        initial={{ opacity: 0, x: 0 }}
        animate={{ opacity: 1, x: moved ? 120 : 0 }}
        transition={{ duration: 0.15 }}
        onAnimationComplete={() => setDone((n) => n + 1)}
        style={{ width: 50, height: 50, background: 'tomato' }}
      />
      <button id="fm-move" onClick={() => setMoved(!moved)}>move</button>
      <span id="fm-done">{done}</span>

      <button id="fm-toggle" onClick={() => setShow(!show)}>toggle</button>
      <AnimatePresence>
        {show && (
          <motion.p key="note" id="fm-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
            now you see me
          </motion.p>
        )}
      </AnimatePresence>

      <button id="fm-open" onClick={() => setOpen(!open)}>list</button>
      <motion.ul id="fm-list" variants={list} initial="hidden" animate={open ? 'visible' : 'hidden'}>
        {['a', 'b', 'c'].map((name) => <motion.li key={name} className="fm-item" variants={item}>{name}</motion.li>)}
      </motion.ul>

      <motion.button id="fm-hover" whileHover={{ scale: 1.5 }} whileTap={{ scale: 0.8 }} transition={{ duration: 0.05 }}>hover</motion.button>
      <Draggable />
    </div>
  );
}
