// React context crossing a native layer, and React components reading the
// shell's What context.
import { createContext, useContext, useState } from 'react';
import { DeskContext } from '../context.js';
import { DeskBadge } from '../native-parts.jsx';
import { useProbe } from './probe.js';

const Theme = createContext('none');

export function ThemeProvider({ theme, children }) {
  useProbe('theme-provider');
  return <Theme.Provider value={theme}>{children}</Theme.Provider>;
}

export function ThemedChip() {
  useProbe('themed-chip');
  const theme = useContext(Theme);
  const [n, setN] = useState(0);
  return <button type="button" data-themed-chip onClick={() => setN(n + 1)}>theme:{theme} {n}</button>;
}

// A React component that places a native component: the native one finds
// the What context around the island.
export function DeskCard({ label }) {
  useProbe('desk-card');
  return <div className="card" data-desk-card><DeskBadge label={label} /></div>;
}

// A React component reading the shell's What context with React's
// useContext: it renders again when the trader changes.
export function DeskHeader() {
  useProbe('desk-header');
  const desk = useContext(DeskContext);
  return <span data-desk-header>{desk.desk} desk, {desk.trader()} trading</span>;
}
