import './Controls.css'

export default function Controls({ isRunning, onStart, onPause, onReset }) {
  return (
    <div className="controls">
      {isRunning ? (
        <button
          className="controls__btn controls__btn--pause"
          onClick={onPause}
          aria-label="Pause timer"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <rect x="4" y="3" width="4" height="14" rx="1" />
            <rect x="12" y="3" width="4" height="14" rx="1" />
          </svg>
          Pause
        </button>
      ) : (
        <button
          className="controls__btn controls__btn--start"
          onClick={onStart}
          aria-label="Start timer"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6 3.5a1 1 0 0 1 1.5-.86l9 5.2a1 1 0 0 1 0 1.72l-9 5.2A1 1 0 0 1 6 13.9V3.5z" />
          </svg>
          Start
        </button>
      )}
      <button
        className="controls__btn controls__btn--reset"
        onClick={onReset}
        aria-label="Reset timer"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3.5 3.5v4h4" />
          <path d="M3.5 7.5A6 6 0 1 1 3 10.5" />
        </svg>
        Reset
      </button>
    </div>
  )
}
