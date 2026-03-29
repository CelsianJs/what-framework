import { useMemo } from 'react'
import './CircularProgress.css'

export default function CircularProgress({ progress, isWork, children }) {
  const size = 280
  const strokeWidth = 6
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const strokeDashoffset = useMemo(
    () => circumference * (1 - progress),
    [circumference, progress]
  )

  const accentColor = isWork ? 'var(--accent-work)' : 'var(--accent-break)'
  const glowColor = isWork ? 'var(--accent-work-glow)' : 'var(--accent-break-glow)'

  return (
    <div className="circular-progress" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="circular-progress__svg"
      >
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--ring-progress-bg)"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={accentColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="circular-progress__ring"
          style={{
            filter: `drop-shadow(0 0 8px ${glowColor})`,
          }}
        />
      </svg>
      <div className="circular-progress__content">
        {children}
      </div>
    </div>
  )
}
