import {
  createContext,
  useContext,
  useLocalStorage,
  useMediaQuery,
  signal,
  effect,
  batch,
  flushSync,
  untrack,
} from 'what-framework';
import { themes } from '../data/default-themes';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  // Persist theme name
  const themeName = useLocalStorage('what-theme', 'dark');

  // System preference detection
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');

  // Individual color signals for granular reactivity
  const primary = signal(themes.dark.primary);
  const secondary = signal(themes.dark.secondary);
  const background = signal(themes.dark.background);
  const surface = signal(themes.dark.surface);
  const text = signal(themes.dark.text);
  const textMuted = signal(themes.dark.textMuted);
  const border = signal(themes.dark.border);
  const success = signal(themes.dark.success);
  const error = signal(themes.dark.error);
  const warning = signal(themes.dark.warning);
  const radius = signal(themes.dark.radius);
  const spacing = signal(themes.dark.spacing);

  // Apply a full theme preset
  const applyTheme = (name) => {
    const t = themes[name];
    if (!t) return;
    batch(() => {
      primary(t.primary);
      secondary(t.secondary);
      background(t.background);
      surface(t.surface);
      text(t.text);
      textMuted(t.textMuted);
      border(t.border);
      success(t.success);
      error(t.error);
      warning(t.warning);
      radius(t.radius);
      spacing(t.spacing);
      themeName(name);
    });
    flushSync();
  };

  // Initialize with saved theme on first render
  const savedName = untrack(() => themeName());
  if (savedName && themes[savedName]) {
    const t = themes[savedName];
    primary(t.primary);
    secondary(t.secondary);
    background(t.background);
    surface(t.surface);
    text(t.text);
    textMuted(t.textMuted);
    border(t.border);
    success(t.success);
    error(t.error);
    warning(t.warning);
    radius(t.radius);
    spacing(t.spacing);
  }

  // Set theme by name
  const setTheme = (name) => {
    applyTheme(name);
  };

  // Toggle between dark and light based on current theme
  const toggleDarkMode = () => {
    const current = untrack(() => themeName());
    if (current === 'light') {
      applyTheme('dark');
    } else {
      applyTheme('light');
    }
  };

  // Customize a single color property
  const customizeColor = (prop, value) => {
    const signalMap = {
      primary, secondary, background, surface,
      text, textMuted, border, success, error, warning,
    };
    if (signalMap[prop]) {
      signalMap[prop](value);
    }
  };

  // Customize radius
  const customizeRadius = (val) => {
    radius(val);
  };

  // Customize spacing
  const customizeSpacing = (val) => {
    spacing(val);
  };

  // Reset to default theme values
  const resetToDefault = () => {
    const name = untrack(() => themeName());
    applyTheme(name);
  };

  // Apply CSS custom properties reactively
  effect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary', primary());
    root.style.setProperty('--secondary', secondary());
    root.style.setProperty('--bg', background());
    root.style.setProperty('--surface', surface());
    root.style.setProperty('--text', text());
    root.style.setProperty('--text-muted', textMuted());
    root.style.setProperty('--border', border());
    root.style.setProperty('--success', success());
    root.style.setProperty('--error', error());
    root.style.setProperty('--warning', warning());
    root.style.setProperty('--radius', radius() + 'px');
    root.style.setProperty('--spacing', spacing() + 'px');
  });

  // Build theme getter that reads all signals
  const getTheme = () => ({
    primary: primary(),
    secondary: secondary(),
    background: background(),
    surface: surface(),
    text: text(),
    textMuted: textMuted(),
    border: border(),
    success: success(),
    error: error(),
    warning: warning(),
    radius: radius(),
    spacing: spacing(),
  });

  const contextValue = {
    theme: getTheme,
    themeName,
    setTheme,
    toggleDarkMode,
    customizeColor,
    customizeRadius,
    customizeSpacing,
    resetToDefault,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
