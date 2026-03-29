import { useCallback, useRef } from 'react'

export function useAudio() {
  const audioCtxRef = useRef(null)

  const getContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    return audioCtxRef.current
  }, [])

  const playBeep = useCallback(() => {
    try {
      const ctx = getContext()
      const now = ctx.currentTime

      // Three-tone notification: ascending beep pattern
      const frequencies = [523.25, 659.25, 783.99] // C5, E5, G5
      const beepDuration = 0.15
      const gap = 0.08

      frequencies.forEach((freq, i) => {
        const oscillator = ctx.createOscillator()
        const gainNode = ctx.createGain()

        oscillator.connect(gainNode)
        gainNode.connect(ctx.destination)

        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(freq, now)

        const startTime = now + i * (beepDuration + gap)
        gainNode.gain.setValueAtTime(0, startTime)
        gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.02)
        gainNode.gain.setValueAtTime(0.3, startTime + beepDuration - 0.03)
        gainNode.gain.linearRampToValueAtTime(0, startTime + beepDuration)

        oscillator.start(startTime)
        oscillator.stop(startTime + beepDuration)
      })
    } catch {
      // Audio not available, fail silently
    }
  }, [getContext])

  return { playBeep }
}
