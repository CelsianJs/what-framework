import { useState } from 'react'
import './Settings.css'

export default function Settings({
  workMinutes,
  breakMinutes,
  onWorkChange,
  onBreakChange,
  disabled,
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="settings">
      <button
        className="settings__toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Toggle settings"
        aria-expanded={isOpen}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="9" r="2.5" />
          <path d="M14.7 11.1a1.2 1.2 0 0 0 .24 1.32l.04.04a1.44 1.44 0 1 1-2.04 2.04l-.04-.04a1.2 1.2 0 0 0-1.32-.24 1.2 1.2 0 0 0-.72 1.08v.12a1.44 1.44 0 1 1-2.88 0v-.06a1.2 1.2 0 0 0-.78-1.08 1.2 1.2 0 0 0-1.32.24l-.04.04a1.44 1.44 0 1 1-2.04-2.04l.04-.04a1.2 1.2 0 0 0 .24-1.32 1.2 1.2 0 0 0-1.08-.72h-.12a1.44 1.44 0 0 1 0-2.88h.06a1.2 1.2 0 0 0 1.08-.78 1.2 1.2 0 0 0-.24-1.32l-.04-.04A1.44 1.44 0 1 1 5.7 3.3l.04.04a1.2 1.2 0 0 0 1.32.24h.06a1.2 1.2 0 0 0 .72-1.08v-.12a1.44 1.44 0 0 1 2.88 0v.06a1.2 1.2 0 0 0 .72 1.08 1.2 1.2 0 0 0 1.32-.24l.04-.04a1.44 1.44 0 1 1 2.04 2.04l-.04.04a1.2 1.2 0 0 0-.24 1.32v.06a1.2 1.2 0 0 0 1.08.72h.12a1.44 1.44 0 0 1 0 2.88h-.06a1.2 1.2 0 0 0-1.08.72z" />
        </svg>
      </button>

      {isOpen && (
        <div className="settings__panel">
          <div className="settings__row">
            <label className="settings__label" htmlFor="work-duration">
              Focus
            </label>
            <div className="settings__input-group">
              <button
                className="settings__step"
                onClick={() => onWorkChange(Math.max(1, workMinutes - 5))}
                disabled={disabled || workMinutes <= 1}
                aria-label="Decrease work duration"
              >
                -
              </button>
              <span className="settings__value" id="work-duration">
                {workMinutes}m
              </span>
              <button
                className="settings__step"
                onClick={() => onWorkChange(Math.min(60, workMinutes + 5))}
                disabled={disabled || workMinutes >= 60}
                aria-label="Increase work duration"
              >
                +
              </button>
            </div>
          </div>
          <div className="settings__row">
            <label className="settings__label" htmlFor="break-duration">
              Break
            </label>
            <div className="settings__input-group">
              <button
                className="settings__step"
                onClick={() => onBreakChange(Math.max(1, breakMinutes - 1))}
                disabled={disabled || breakMinutes <= 1}
                aria-label="Decrease break duration"
              >
                -
              </button>
              <span className="settings__value" id="break-duration">
                {breakMinutes}m
              </span>
              <button
                className="settings__step"
                onClick={() => onBreakChange(Math.min(30, breakMinutes + 1))}
                disabled={disabled || breakMinutes >= 30}
                aria-label="Increase break duration"
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
