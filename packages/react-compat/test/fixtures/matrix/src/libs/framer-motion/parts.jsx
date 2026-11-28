// A component that calls React hooks (useMotionValue) is a React file's:
// native.jsx imports it from here.
import { motion, useMotionValue, useTransform } from 'framer-motion';

export function Draggable() {
  const x = useMotionValue(0);
  const rounded = useTransform(x, (v) => Math.round(v));
  return (
    <div>
      <motion.div id="fm-drag" drag="x" dragMomentum={false} dragElastic={0} style={{ x, width: 60, height: 40, background: '#36c' }} />
      <motion.span id="fm-x">{rounded}</motion.span>
    </div>
  );
}
