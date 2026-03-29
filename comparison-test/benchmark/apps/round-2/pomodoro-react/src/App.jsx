import { useState, useCallback, useEffect, useMemo } from 'react'
import CircularProgress from './components/CircularProgress.jsx'
import Controls from './components/Controls.jsx'
import ModeToggle from './components/ModeToggle.jsx'
import SessionCounter from './components/SessionCounter.jsx'
import Settings from './components/Settings.jsx'
import ThemeToggle from './components/ThemeToggle.jsx'
import { useTimer } from './hooks/useTimer.js'
import { useAudio } from './hooks/useAudio.js'
import './App.css'

const DEFAULT_WORK = 25
const DEFAULT_BREAK = 5

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function App() {
  const [isWork, setIsWork] = useState(true)
  const [workMinutes, setWorkMinutes] = useState(DEFAULT_WORK)
  const [breakMinutes, setBreakMinutes] = useState(DEFAULT_BREAK)
  const [sessions, setSessions] = useState(0)
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pomodoro-theme')
      if (saved) return saved === 'dark'
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  })

  const { playBeep } = useAudio()

  const handleComplete = useCallback(() => {
    playBeep()
    if (isWork) {
      setSessions((prev) => prev + 1)
    }
  }, [isWork, playBeep])

  const currentMinutes = isWork ? workMinutes : breakMinutes

  const {
    secondsLeft,
    isRunning,
    progress,
    start,
    pause,
    reset,
    setDuration,
  } = useTimer(currentMinutes, handleComplete)

  // Update document title with timer
  const timeDisplay = useMemo(() => formatTime(secondsLeft), [secondsLeft])

  useEffect(() => {
    const mode = isWork ? 'Focus' : 'Break'
    document.title = isRunning
      ? `${timeDisplay} - ${mode} | Pomodoro`
      : 'Pomodoro Timer'
  }, [timeDisplay, isRunning, isWork])

  // Theme persistence
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    localStorage.setItem('pomodoro-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  const handleModeToggle = useCallback(
    (toWork) => {
      if (toWork === isWork) return
      setIsWork(toWork)
      setDuration(toWork ? workMinutes : breakMinutes)
    },
    [isWork, workMinutes, breakMinutes, setDuration]
  )

  const handleWorkChange = useCallback(
    (val) => {
      setWorkMinutes(val)
      if (isWork && !isRunning) {
        setDuration(val)
      }
    },
    [isWork, isRunning, setDuration]
  )

  const handleBreakChange = useCallback(
    (val) => {
      setBreakMinutes(val)
      if (!isWork && !isRunning) {
        setDuration(val)
      }
    },
    [isWork, isRunning, setDuration]
  )

  const handleReset = useCallback(() => {
    reset(currentMinutes)
  }, [reset, currentMinutes])

  const handleThemeToggle = useCallback(() => {
    setIsDark((prev) => !prev)
  }, [])

  const modeLabel = isWork ? 'Focus' : 'Break'

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Pomodoro</h1>
        <div className="app__header-actions">
          <Settings
            workMinutes={workMinutes}
            breakMinutes={breakMinutes}
            onWorkChange={handleWorkChange}
            onBreakChange={handleBreakChange}
            disabled={isRunning}
          />
          <ThemeToggle isDark={isDark} onToggle={handleThemeToggle} />
        </div>
      </header>

      <main className="app__main">
        <ModeToggle
          isWork={isWork}
          onToggle={handleModeToggle}
          disabled={isRunning}
        />

        <div className="app__timer">
          <CircularProgress progress={progress} isWork={isWork}>
            <span className="app__time">{timeDisplay}</span>
            <span className="app__mode-label">{modeLabel}</span>
          </CircularProgress>
        </div>

        <Controls
          isRunning={isRunning}
          onStart={start}
          onPause={pause}
          onReset={handleReset}
        />

        <SessionCounter count={sessions} />
      </main>
    </div>
  )
}
