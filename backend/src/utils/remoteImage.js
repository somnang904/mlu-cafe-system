const dns = require('dns')
const http = require('http')
const https = require('https')
const net = require('net')

const MAX_BYTES = 30 * 1024 * 1024
const TIMEOUT_MS = 15000
const MAX_REDIRECTS = 3

// Downloads are made by the server on behalf of a user, so a link must never reach
// the server itself or the private network behind it (SSRF).
const blocked = new net.BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96],
]) blocked.addSubnet(address, prefix, 'ipv6')

function isBlockedAddress(address) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped) return blocked.check(mapped[1], 'ipv4')
  return blocked.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4')
}

function publicError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

// Validates the address actually connected to, so DNS rebinding cannot swap in a
// private IP between the check and the request.
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err)
    const safe = addresses.filter((entry) => !isBlockedAddress(entry.address))
    if (safe.length !== addresses.length || safe.length === 0) {
      return callback(publicError('That link points to a private or local address'))
    }
    if (options.all) return callback(null, safe)
    return callback(null, safe[0].address, safe[0].family)
  })
}

function parseImageUrl(raw) {
  let url
  try {
    url = new URL(String(raw || '').trim())
  } catch {
    throw publicError('Please paste a full image link starting with http:// or https://')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw publicError('Only http:// and https:// image links are supported')
  }
  if (url.username || url.password) throw publicError('Links with a username or password are not supported')
  if (url.port && !['80', '443'].includes(url.port)) throw publicError('Links on non-standard ports are not supported')
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw publicError('That link points to a private or local address')
  }
  return url
}

function requestOnce(url) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const req = client.get(url, {
      lookup: guardedLookup,
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MluCafeMenuImport/1.0)',
        Accept: 'image/avif,image/webp,image/*;q=0.9,*/*;q=0.5',
      },
    }, (res) => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        return resolve({ redirect: new URL(res.headers.location, url) })
      }
      if (status !== 200) {
        res.resume()
        return reject(publicError(`The image link returned an error (HTTP ${status})`))
      }
      const declared = Number(res.headers['content-length'] || 0)
      if (declared > MAX_BYTES) {
        res.destroy()
        return reject(publicError('The image at that link is larger than 30 MB'))
      }
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BYTES) {
          res.destroy()
          reject(publicError('The image at that link is larger than 30 MB'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(publicError('The image link took too long to respond')))
    req.on('error', (err) => reject(err.status ? err : publicError('Could not download an image from that link')))
  })
}

/** Download an image from a public http(s) URL. Errors carry `status = 400` and a user-facing message. */
async function downloadRemoteImage(rawUrl) {
  let url = parseImageUrl(rawUrl)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await requestOnce(url)
    if (!result.redirect) {
      let fileName = url.pathname.split('/').pop() || ''
      try { fileName = decodeURIComponent(fileName) } catch { /* keep the raw segment */ }
      return { ...result, fileName: fileName || 'photo' }
    }
    url = parseImageUrl(result.redirect.href)
  }
  throw publicError('The image link redirected too many times')
}

module.exports = { downloadRemoteImage, isBlockedAddress }
