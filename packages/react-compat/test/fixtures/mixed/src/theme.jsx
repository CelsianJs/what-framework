// A React file with context.
import { createContext, useContext, useState } from 'react';

const Theme = createContext('none');

export function ThemeProvider({ theme, children }) {
  return <Theme.Provider value={theme}>{children}</Theme.Provider>;
}

export function ThemedLabel({ id = 'label' }) {
  const theme = useContext(Theme);
  const [c, setC] = useState(0);
  return <span id={id} onClick={() => setC(c + 1)}>theme:{theme} c{c}</span>;
}

export function Chip({ label }) {
  const [c, setC] = useState(0);
  return <li onClick={() => setC(c + 1)}>{label}:{c}</li>;
}
