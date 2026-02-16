import { ThemeProvider } from './context/ThemeContext';
import { ThemeControls } from './components/ThemeControls';
import { PreviewCard } from './components/PreviewCard';
import { PreviewForm } from './components/PreviewForm';

export function App() {
  return (
    <ThemeProvider>
      <div>
        {/* Header */}
        <header style="margin-bottom: 2rem;">
          <h1 style="font-size: 1.75rem; font-weight: 700; color: var(--text); margin-bottom: 0.25rem;">
            Theme Playground
          </h1>
          <p style="color: var(--text-muted); font-size: 0.875rem;">
            Customize colors, radius, and spacing in real time. Changes are saved to localStorage.
          </p>
        </header>

        {/* Layout: Controls on left, Preview on right */}
        <div style="display: grid; grid-template-columns: 360px 1fr; gap: 2rem; align-items: start;">
          {/* Left: Controls */}
          <ThemeControls />

          {/* Right: Preview */}
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <PreviewCard />
            <PreviewForm />
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}
