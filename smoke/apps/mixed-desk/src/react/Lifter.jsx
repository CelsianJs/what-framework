// React state lifted into the What store: a counter that steps 100 times a
// second while running and hands each new value to its parent, which writes
// it to the store. The store's value comes back as `echo`.
import { useEffect, useRef, useState } from 'react';
import { useProbe } from './probe.js';

export function Lifter({ running, rate, onLift, echo }) {
  useProbe('lifter');
  const [n, setN] = useState(0);
  const k = useRef(0);
  useEffect(() => {
    if (!running) return undefined;
    const t0 = performance.now();
    const base = k.current;
    const id = setInterval(() => {
      const due = Math.floor(((performance.now() - t0) * rate) / 1000);
      while (k.current - base < due) {
        k.current++;
        setN(k.current);
        onLift(k.current);
      }
    }, 10);
    return () => clearInterval(id);
  }, [running, rate]);
  return (
    <div className="lifter" data-lifter>
      React state <b data-lifter-n>{n}</b> · store echo <b data-lifter-echo>{echo}</b>
    </div>
  );
}
