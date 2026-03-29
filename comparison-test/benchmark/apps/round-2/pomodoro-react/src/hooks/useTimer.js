import { useState, useEffect, useCallback, useRef } from 'react'

export function useTimer(initialMinutes, onComplete) {
  const [totalSeconds, setTotalSeconds] = useState(initialMinutes * 60)
  const [secondsLeft, setSecondsLeft] = useState(initialMinutes * 60)
  const [isRunning, setIsRunning] = useState(false)
  const intervalRef = useRef(null)
  const onCompleteRef = useRef(onComplete)

  // Keep callback ref current without re-creating effects
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  // The core countdown interval
  useEffect(() => {
    if (!isRunning) {
      return
    }

    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current)
          setIsRunning(false)
          onCompleteRef.current?.()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(intervalRef.current)
  }, [isRunning])

  const start = useCallback(() => {
    if (secondsLeft > 0) {
      setIsRunning(true)
    }
  }, [secondsLeft])

  const pause = useCallback(() => {
    setIsRunning(false)
  }, [])

  const reset = useCallback((newMinutes) => {
    setIsRunning(false)
    const secs = (newMinutes ?? initialMinutes) * 60
    setTotalSeconds(secs)
    setSecondsLeft(secs)
  }, [initialMinutes])

  const setDuration = useCallback((minutes) => {
    const secs = minutes * 60
    setTotalSeconds(secs)
    setSecondsLeft(secs)
    setIsRunning(false)
  }, [])

  const progress = totalSeconds > 0 ? secondsLeft / totalSeconds : 0

  return {
    secondsLeft,
    totalSeconds,
    isRunning,
    progress,
    start,
    pause,
    reset,
    setDuration,
  }
}
