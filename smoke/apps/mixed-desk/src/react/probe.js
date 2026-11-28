// A React hook every React component of the desk calls: counts its renders,
// mounts and unmounts, and a render of an instance that already unmounted.
import { useEffect, useRef } from 'react';
import { count, probes } from '../probes.js';

export function useProbe(name) {
  const gone = useRef(false);
  if (gone.current) probes.lateRenders++;
  count('renders', name);
  useEffect(() => {
    count('mounted', name);
    return () => {
      gone.current = true;
      count('unmounted', name);
    };
  }, []);
}
