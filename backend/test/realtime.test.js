const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')
const { publish, openStream, clientCount } = require('../src/utils/realtime')

async function withStream(work) {
  const app = express()
  app.get('/events', (req, res) => openStream(req, res))
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const controller = new AbortController()
  const response = await fetch(`http://127.0.0.1:${server.address().port}/events`, { signal: controller.signal })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const readUntil = async (needle) => {
    let text = ''
    while (!text.includes(needle)) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value)
    }
    return text
  }
  try {
    await work({ response, readUntil })
  } finally {
    controller.abort()
    await new Promise((resolve) => server.close(resolve))
  }
}

describe('live notification stream', () => {
  it('sends a text/event-stream with headers that stop nginx from buffering it', async () => {
    await withStream(async ({ response }) => {
      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type'), /text\/event-stream/)
      assert.equal(response.headers.get('x-accel-buffering'), 'no')
      assert.equal(clientCount(), 1)
    })
  })

  it('pushes a "live" event with the change type, and merges a burst into one event', async () => {
    await withStream(async ({ readUntil }) => {
      await readUntil(': connected')
      publish('alerts')
      publish('alerts')
      publish('alerts')
      const text = await readUntil('"type":"alerts"')
      assert.match(text, /event: live/)
      assert.equal((text.match(/event: live/g) || []).length, 1)
    })
  })

  it('does nothing when nobody is connected', () => {
    assert.doesNotThrow(() => publish('security'))
  })
})
