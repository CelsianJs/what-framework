import { cls } from 'what-framework';
import { useTheme } from '../context/ThemeContext';
import { ColorPicker } from './ColorPicker';

const colorProperties = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'background', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'text', label: 'Text' },
  { key: 'textMuted', label: 'Text Muted' },
  { key: 'border', label: 'Border' },
  { key: 'success', label: 'Success' },
  { key: 'error', label: 'Error' },
  { key: 'warning', label: 'Warning' },
];

const themePresets = [
  { key: 'dark', label: 'Dark', icon: '\u{1F31A}' },
  { key: 'light', label: 'Light', icon: '\u{2600}\u{FE0F}' },
  { key: 'ocean', label: 'Ocean', icon: '\u{1F30A}' },
];

export function ThemeControls() {
  const ctx = useTheme();

  const handlePresetClick = (key) => {
    ctx.setTheme(key);
  };

  const handleReset = () => {
    ctx.resetToDefault();
  };

  return (
    <div style="
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      position: sticky;
      top: 2rem;
      max-height: calc(100vh - 4rem);
      overflow-y: auto;
    ">
      {/* Theme Presets */}
      <div>
        <h3 style="font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem;">
          Presets
        </h3>
        <div style="display: flex; gap: 0.5rem;">
          {() => themePresets.map(preset => (
            <button
              key={preset.key}
              onClick={() => handlePresetClick(preset.key)}
              class={cls(
                'preset-btn',
                ctx.themeName() === preset.key && 'preset-btn--active'
              )}
              style={`
                flex: 1;
                padding: 0.625rem 0.75rem;
                background: ${ctx.themeName() === preset.key ? 'var(--primary)' : 'var(--bg)'};
                color: ${ctx.themeName() === preset.key ? '#fff' : 'var(--text)'};
                border: 1px solid ${ctx.themeName() === preset.key ? 'var(--primary)' : 'var(--border)'};
                border-radius: var(--radius);
                font-size: 0.8125rem;
                font-weight: 500;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0.375rem;
                transition: all 0.2s;
              `}
            >
              <span style="font-size: 0.875rem;">{preset.icon}</span>
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style="height: 1px; background: var(--border);" />

      {/* Color Pickers */}
      <div>
        <h3 style="font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem;">
          Colors
        </h3>
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          {() => colorProperties.map(prop => (
            <ColorPicker
              key={prop.key}
              label={prop.label}
              propKey={prop.key}
            />
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style="height: 1px; background: var(--border);" />

      {/* Radius Slider */}
      <div>
        <h3 style="font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem;">
          Border Radius
        </h3>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <input
            type="range"
            min="0"
            max="24"
            value={ctx.theme().radius}
            onInput={(e) => ctx.customizeRadius(Number(e.target.value))}
            style="
              flex: 1;
              accent-color: var(--primary);
              cursor: pointer;
            "
          />
          <span style="font-size: 0.8125rem; color: var(--text-muted); min-width: 3rem; text-align: right;">
            {() => ctx.theme().radius + 'px'}
          </span>
        </div>
      </div>

      {/* Spacing Slider */}
      <div>
        <h3 style="font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem;">
          Spacing
        </h3>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <input
            type="range"
            min="8"
            max="32"
            value={ctx.theme().spacing}
            onInput={(e) => ctx.customizeSpacing(Number(e.target.value))}
            style="
              flex: 1;
              accent-color: var(--primary);
              cursor: pointer;
            "
          />
          <span style="font-size: 0.8125rem; color: var(--text-muted); min-width: 3rem; text-align: right;">
            {() => ctx.theme().spacing + 'px'}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div style="height: 1px; background: var(--border);" />

      {/* Reset Button */}
      <button
        onClick={handleReset}
        style="
          background: transparent;
          color: var(--error);
          border: 1px solid var(--error);
          border-radius: var(--radius);
          padding: 0.625rem 1rem;
          font-size: 0.8125rem;
          font-weight: 500;
          transition: all 0.2s;
          width: 100%;
        "
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--error)';
          e.currentTarget.style.color = '#fff';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--error)';
        }}
      >
        Reset to Default
      </button>
    </div>
  );
}
