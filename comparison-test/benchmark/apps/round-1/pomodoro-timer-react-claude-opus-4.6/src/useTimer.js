import { useState, useEffect, useCallback, useRef } from 'react'

const WORK_DEFAULT = 25
const BREAK_DEFAULT = 5

export function useTimer() {
  const [workMinutes, setWorkMinutes] = useState(WORK_DEFAULT)
  const [breakMinutes, setBreakMinutes] = useState(BREAK_DEFAULT)
  const [secondsLeft, setSecondsLeft] = useState(WORK_DEFAULT * 60)
  const [isRunning, setIsRunning] = useState(false)
  const [isBreak, setIsBreak] = useState(false)
  const [sessions, setSessions] = useState(0)

  const intervalRef = useRef(null)
  const audioCtxRef = useRef(null)

  const totalSeconds = isBreak ? breakMinutes * 60 : workMinutes * 60
  const progress = 1 - secondsLeft / totalSeconds

  const playBeep = useCallback(() => {
    try {
      const ctx = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)

      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.8)

      // Second beep
      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.type = 'sine'
      osc2.frequency.value = 1100
      gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.3)
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.1)
      osc2.start(ctx.currentTime + 0.3)
      osc2.stop(ctx.currentTime + 1.1)
    } catch {
      // Audio not supported
    }
  }, [])

  useEffect(() => {
    if (!isRunning) {
      clearInterval(intervalRef.current)
      return
    }

    intervalRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(intervalRef.current)
  }, [isRunning])

  // Handle timer completion
  useEffect(() => {
    if (secondsLeft === 0 && isRunning) {
      playBeep()
      setIsRunning(false)

      if (!isBreak) {
        setSessions(s => s + 1)
        setIsBreak(true)
        setSecondsLeft(breakMinutes * 60)
      } else {
        setIsBreak(false)
        setSecondsLeft(workMinutes * 60)
      }
    }
  }, [secondsLeft, isRunning, isBreak, breakMinutes, workMinutes, playBeep])

  const toggle = useCallback(() => {
    setIsRunning(r => !r)
  }, [])

  const reset = useCallback(() => {
    setIsRunning(false)
    setIsBreak(false)
    setSecondsLeft(workMinutes * 60)
  }, [workMinutes])

  const updateWorkMinutes = useCallback((val) => {
    const mins = Math.max(1, Math.min(60, Number(val) || 1))
    setWorkMinutes(mins)
    if (!isRunning && !isBreak) {
      setSecondsLeft(mins * 60)
    }
  }, [isRunning, isBreak])

  const updateBreakMinutes = useCallback((val) => {
    const mins = Math.max(1, Math.min(30, Number(val) || 1))
    setBreakMinutes(mins)
    if (!isRunning && isBreak) {
      setSecondsLeft(mins * 60)
    }
  }, [isRunning, isBreak])

  const skipToNext = useCallback(() => {
    setIsRunning(false)
    if (!isBreak) {
      setIsBreak(true)
      setSecondsLeft(breakMinutes * 60)
    } else {
      setIsBreak(false)
      setSecondsLeft(workMinutes * 60)
    }
  }, [isBreak, breakMinutes, workMinutes])

  return {
    secondsLeft,
    isRunning,
    isBreak,
    sessions,
    progress,
    workMinutes,
    breakMinutes,
    toggle,
    reset,
    skipToNext,
    updateWorkMinutes,
    updateBreakMinutes,
  }
}
