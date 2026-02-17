import { useSignal, useRef, useClickOutside, Portal } from 'what-framework';
import { useTheme } from '../context/ThemeContext';

export function ColorPicker({ label, propKey }) {
  const ctx = useTheme();
  const isOpen = useSignal(false);
  const popupRef = useRef(null);
  const swatchRef = useRef(null);
  const hexInput = useSignal('');

  const currentColor = () => ctx.theme()[propKey] || '#000000';

  const popupX = useSignal(0);
  const popupY = useSignal(0);

  const handleSwatchClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Store position for the popup
    popupX(rect.left);
    popupY(rect.bottom + 8);
    hexInput(currentColor());
    isOpen(true);
  };

  useClickOutside(popupRef, () => {
    isOpen(false);
  });

  const handleColorChange = (e) => {
    const value = e.target.value;
    hexInput(value);
    ctx.customizeColor(propKey, value);
  };

  const handleHexInput = (e) => {
    let value = e.target.value;
    hexInput(value);
    // Validate hex color
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
      ctx.customizeColor(propKey, value);
    }
  };

  return (
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <span style="font-size: 0.8125rem; color: var(--text); font-weight: 400;">
        {label}
      </span>
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <span style="font-size: 0.75rem; color: var(--text-muted); font-family: monospace;">
          {() => currentColor()}
        </span>
        {() => (
          <button
            ref={swatchRef}
            onClick={handleSwatchClick}
            style={`
              width: 28px;
              height: 28px;
              border-radius: 6px;
              background: ${currentColor()};
              border: 2px solid var(--border);
              cursor: pointer;
              padding: 0;
              transition: border-color 0.15s, transform 0.15s;
              flex-shrink: 0;
            `}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--text-muted)';
              e.currentTarget.style.transform = 'scale(1.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
            title={`Edit ${label}`}
          />
        )}
      </div>

      {/* Color Picker Popup via Portal */}
      {() => isOpen() ? (
        <Portal target="body">
          <div
            ref={popupRef}
            style={`
              position: fixed;
              left: ${popupX()}px;
              top: ${popupY()}px;
              z-index: 1000;
              background: var(--surface);
              border: 1px solid var(--border);
              border-radius: var(--radius);
              padding: 1rem;
              box-shadow: 0 8px 32px rgba(0,0,0,0.4);
              display: flex;
              flex-direction: column;
              gap: 0.75rem;
              min-width: 200px;
            `}
          >
            <div style="font-size: 0.8125rem; font-weight: 600; color: var(--text);">
              {label}
            </div>
            <input
              type="color"
              value={currentColor()}
              onInput={handleColorChange}
              style="
                width: 100%;
                height: 40px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                padding: 0;
                background: none;
              "
            />
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 0.75rem; color: var(--text-muted);">Hex:</span>
              <input
                type="text"
                value={hexInput()}
                onInput={handleHexInput}
                maxlength="7"
                style="
                  flex: 1;
                  background: var(--bg);
                  border: 1px solid var(--border);
                  border-radius: 6px;
                  padding: 0.375rem 0.5rem;
                  color: var(--text);
                  font-size: 0.8125rem;
                  font-family: monospace;
                  outline: none;
                "
                onFocus={(e) => { e.target.style.borderColor = 'var(--primary)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--border)'; }}
              />
            </div>
          </div>
        </Portal>
      ) : null}
    </div>
  );
}
