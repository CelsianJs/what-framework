import { createContext, useContext, useState } from 'react';

const ThemeContext = createContext('default-theme');

function DeepLeaf() {
  const theme = useContext(ThemeContext);
  return <output id="ctx-value">{theme}</output>;
}

function Middle() {
  return (
    <div>
      <DeepLeaf />
    </div>
  );
}

export function ContextSection() {
  const [theme, setTheme] = useState('light');
  return (
    <section id="ctx-section">
      <h2>1. createContext / useContext (nested compat components)</h2>
      <ThemeContext.Provider value={theme}>
        <Middle />
      </ThemeContext.Provider>
      <button id="ctx-toggle" onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}>
        toggle theme
      </button>
    </section>
  );
}
