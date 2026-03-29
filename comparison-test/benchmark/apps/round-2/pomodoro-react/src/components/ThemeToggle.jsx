import './ThemeToggle.css'

export default function ThemeToggle({ isDark, onToggle }) {
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="9" cy="9" r="4" />
          <path d="M9 1.5v1M9 15.5v1M3.7 3.7l.7.7M13.6 13.6l.7.7M1.5 9h1M15.5 9h1M3.7 14.3l.7-.7M13.6 4.4l.7-.7" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M15.5 9.6A6.5 6.5 0 1 1 8.4 2.5 5 5 0 0 0 15.5 9.6z" />
        </svg>
      )}
    </button>
  )
}
