/**
 * Modern POS Audio Chimes using Web Audio API
 * Zero external audio files required, 100% reliable, zero latency.
 */

let sharedAudioCtx = null

function getAudioContext() {
  if (typeof window === 'undefined') return null
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return null
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioCtx()
  }
  return sharedAudioCtx
}

export function initAudioOnUserInteraction() {
  if (typeof window === 'undefined') return
  const unlock = () => {
    const ctx = getAudioContext()
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
    window.removeEventListener('touchstart', unlock)
  }
  window.addEventListener('pointerdown', unlock, { passive: true, once: true })
  window.addEventListener('keydown', unlock, { passive: true, once: true })
  window.addEventListener('touchstart', unlock, { passive: true, once: true })
}

if (typeof window !== 'undefined') {
  initAudioOnUserInteraction()
}

export function playAlertSound(type = 'warning') {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const executeSound = () => {
      const now = ctx.currentTime

      if (type === 'critical') {
        // Out-of-stock warning: double urgent beep
        const osc1 = ctx.createOscillator()
        const gain1 = ctx.createGain()
        osc1.type = 'triangle'
        osc1.frequency.setValueAtTime(820, now)
        gain1.gain.setValueAtTime(0.32, now)
        gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15)
        osc1.connect(gain1)
        gain1.connect(ctx.destination)
        osc1.start(now)
        osc1.stop(now + 0.15)

        const osc2 = ctx.createOscillator()
        const gain2 = ctx.createGain()
        osc2.type = 'triangle'
        osc2.frequency.setValueAtTime(980, now + 0.18)
        gain2.gain.setValueAtTime(0.32, now + 0.18)
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.38)
        osc2.connect(gain2)
        gain2.connect(ctx.destination)
        osc2.start(now + 0.18)
        osc2.stop(now + 0.38)
      } else if (type === 'warning') {
        // Low stock warning: pleasant two-tone chime
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(587.33, now) // D5
        osc.frequency.setValueAtTime(880, now + 0.12) // A5
        gain.gain.setValueAtTime(0.28, now)
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now)
        osc.stop(now + 0.4)
      } else if (type === 'success') {
        // Sweet completion ding
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(523.25, now) // C5
        osc.frequency.setValueAtTime(659.25, now + 0.1) // E5
        gain.gain.setValueAtTime(0.25, now)
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now)
        osc.stop(now + 0.35)
      }
    }

    if (ctx.state === 'suspended') {
      ctx.resume().then(executeSound).catch(() => {})
    } else {
      executeSound()
    }
  } catch (err) {
    console.debug('Audio notification unavailable:', err)
  }
}

