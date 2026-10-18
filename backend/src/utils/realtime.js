/**
 * Live notifications over Server-Sent Events.
 * The stream only says "something changed" (a type, no data). Each browser then re-reads its
 * own permission-filtered feed through the normal API, so nothing sensitive is broadcast.
 */
const MAX_CLIENTS = 200
const HEARTBEAT_MS = 25_000
const COALESCE_MS = 250

const clients = new Set()
const pending = new Map()

function send(payload) {
  for (const res of [...clients]) {
    try {
      res.write(payload)
    } catch {
      clients.delete(res)
    }
  }
}

// A burst (for example one stock change per ingredient) becomes a single event per type.
function publish(type) {
  if (clients.size === 0 || pending.has(type)) return
  const timer = setTimeout(() => {
    pending.delete(type)
    send(`event: live\ndata: ${JSON.stringify({ type, at: Date.now() })}\n\n`)
  }, COALESCE_MS)
  timer.unref?.()
  pending.set(type, timer)
}

function openStream(req, res) {
  if (clients.size >= MAX_CLIENTS) {
    return res.status(503).json({ message: 'Too many live connections' })
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx must not buffer the stream or events would arrive in batches, late.
    'X-Accel-Buffering': 'no',
  })
  res.write('retry: 3000\n\n: connected\n\n')
  clients.add(res)

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      cleanup()
    }
  }, HEARTBEAT_MS)
  heartbeat.unref?.()

  function cleanup() {
    clearInterval(heartbeat)
    clients.delete(res)
  }
  req.on('close', cleanup)
  res.on('error', cleanup)
  return undefined
}

function clientCount() {
  return clients.size
}

module.exports = { publish, openStream, clientCount }
