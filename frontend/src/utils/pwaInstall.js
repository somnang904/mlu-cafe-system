import { useSyncExternalStore } from 'react'

// The browser fires `beforeinstallprompt` once, early, so it is captured here at
// startup (initPwa runs before React renders) and replayed when the button is clicked.
let deferredPrompt = null
const listeners = new Set()

function notify() {
  listeners.forEach((listener) => listener())
}

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari home-screen apps
    window.navigator.standalone === true
  )
}

export function initPwa() {
  if (typeof window === 'undefined') return

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event
    notify()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('Service worker registration failed:', error)
      })
    })
  }
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => Boolean(deferredPrompt) && !isStandalone()

/** canInstall is true only while the browser is offering installation. */
export function useInstallPrompt() {
  const canInstall = useSyncExternalStore(subscribe, getSnapshot, () => false)

  const install = async () => {
    if (!deferredPrompt) return 'unavailable'
    const prompt = deferredPrompt
    deferredPrompt = null
    notify()
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    return outcome
  }

  return { canInstall, install }
}
