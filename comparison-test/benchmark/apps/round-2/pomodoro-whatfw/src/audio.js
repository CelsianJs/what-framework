// Simple beep notification using Web Audio API

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

export function playBeep() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Play a pleasant two-tone chime
    const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5
    const durations = [0.15, 0.15, 0.3];

    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0, now + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.3, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + durations[i]);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + durations[i] + 0.05);
    });
  } catch (e) {
    // Audio not supported, silently ignore
  }
}
