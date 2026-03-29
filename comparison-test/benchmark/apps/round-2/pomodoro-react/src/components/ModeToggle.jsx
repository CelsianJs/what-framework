import './ModeToggle.css'

export default function ModeToggle({ isWork, onToggle, disabled }) {
  return (
    <div className="mode-toggle">
      <button
        className={`mode-toggle__btn ${isWork ? 'mode-toggle__btn--active' : ''}`}
        onClick={() => onToggle(true)}
        disabled={disabled}
        aria-label="Work mode"
      >
        Focus
      </button>
      <button
        className={`mode-toggle__btn ${!isWork ? 'mode-toggle__btn--active mode-toggle__btn--break' : ''}`}
        onClick={() => onToggle(false)}
        disabled={disabled}
        aria-label="Break mode"
      >
        Break
      </button>
    </div>
  )
}
