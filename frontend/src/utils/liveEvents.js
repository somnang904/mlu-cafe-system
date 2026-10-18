import { API_BASE, getAuthToken } from '../services/apiClient'
import { deviceHeaders } from './deviceFingerprint'

export const LIVE_EVENT = 'mlu:live'

const MIN_RETRY_MS = 1000
const MAX_RETRY_MS = 15000

/**
 * Keeps one Server-Sent Events connection open and calls onEvent({ type }) for each push.
 * fetch is used (not EventSource) so the sign-in token travels in the Authorization header,
 * never in the URL. It reconnects with a growing delay and stops when the session is gone.
 * Returns stop().
 */
export function startLiveEvents(onEvent) {
  let stopped = false
  let controller = null
  let retryMs = MIN_RETRY_MS
  let retryTimer = null

  const scheduleRetry = () => {
    if (stopped) return
    retryTimer = window.setTimeout(connect, retryMs)
    retryMs = Math.min(MAX_RETRY_MS, retryMs * 2)
  }

  async function connect() {
    const token = getAuthToken()
    if (stopped || !token) return
    controller = new AbortController()
    try {
      const response = await fetch(`${API_BASE}/events`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', ...(await deviceHeaders()) },
        signal: controller.signal,
        cache: 'no-store',
      })
      if (response.status === 401 || response.status === 403) return // signed out or blocked: stop
      if (!response.ok || !response.body) throw new Error(`stream status ${response.status}`)

      retryMs = MIN_RETRY_MS
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = block.split('\n').find((line) => line.startsWith('data:'))
          if (data) {
            try {
              onEvent(JSON.parse(data.slice(5).trim()))
            } catch {
              // ignore a malformed event
            }
          }
          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch {
      // network drop or abort: fall through to the retry below
    }
    scheduleRetry()
  }

  connect()

  return () => {
    stopped = true
    if (retryTimer != null) window.clearTimeout(retryTimer)
    controller?.abort()
  }
}
