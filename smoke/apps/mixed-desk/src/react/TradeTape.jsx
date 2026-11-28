// Subscribes to the feed in an effect and keeps the last 12 trades in state.
// Unmounting has to unsubscribe: the feed counts its listeners.
import { useEffect, useState } from 'react';
import { onTrade } from '../store.js';
import { probes } from '../probes.js';
import { useProbe } from './probe.js';

export function TradeTape() {
  useProbe('tape');
  const [trades, setTrades] = useState([]);
  useEffect(() => {
    let live = true;
    const off = onTrade((sym, n) => {
      if (!live) probes.lateCallbacks++;
      setTrades((t) => [{ sym, n }, ...t.slice(0, 11)]);
    });
    return () => { live = false; off(); };
  }, []);
  return <ol className="tape" data-tape>{trades.map((t) => <li key={t.n} data-seq={t.n}>{t.sym} #{t.n}</li>)}</ol>;
}
