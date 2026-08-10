// Theme is a module signal that mirrors itself onto <html data-theme>, so the
// CSS variables in styles.css switch palettes. Components never read this
// module directly: the shell hands it down through context.

import { signal, effect } from 'what-framework';

export const theme = signal('night', 'theme');

export function toggleTheme() {
  theme((t) => (t === 'night' ? 'day' : 'night'));
}

if (typeof document !== 'undefined') {
  effect(() => {
    document.documentElement.dataset.theme = theme();
  });
}
