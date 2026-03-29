import './SessionCounter.css'

export default function SessionCounter({ count }) {
  return (
    <div className="session-counter">
      <div className="session-counter__dots">
        {Array.from({ length: Math.min(count, 8) }, (_, i) => (
          <span key={i} className="session-counter__dot" />
        ))}
      </div>
      <span className="session-counter__label">
        {count === 0
          ? 'No sessions yet'
          : `${count} session${count !== 1 ? 's' : ''} completed`}
      </span>
    </div>
  )
}
