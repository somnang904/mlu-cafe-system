import { readSession, writeSession } from './sessionStorage'
import { deviceHeaders } from '../utils/deviceFingerprint'

const DEFAULT_API_BASE = 'http://localhost:5500/api'

export const API_BASE = (import.meta.env.VITE_API_URL || DEFAULT_API_BASE).replace(/\/$/, '')

export const SESSION_EXPIRED_EVENT = 'mlu:session-expired'
export const BACKEND_STATUS_EVENT = 'mlu:backend-status'
const RENEWED_TOKEN_HEADER = 'X-Renewed-Token'

const GET_ATTEMPTS = 3
const GET_RETRY_DELAYS_MS = [300, 800]

const PUBLIC_API_PATHS = new Set(['/auth/login', '/auth/forgot-password'])
const SILENT_NETWORK_PATHS = new Set(['/auth/login', '/auth/forgot-password', '/auth/logout'])

function normalizeApiPath(path) {
  const withSlash = path.startsWith('/') ? path : `/${path}`
  return withSlash.split('?')[0]
}

function isPublicApiPath(path) {
  return PUBLIC_API_PATHS.has(normalizeApiPath(path))
}

export function getAuthToken() {
  const token = readSession()?.token
  if (!token) return null
  const trimmed = String(token).trim()
  return trimmed || null
}

function unauthenticatedResponse() {
  return new Response(JSON.stringify({ message: 'Authentication required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function noteBackend(reachable) {
  window.dispatchEvent(new CustomEvent(BACKEND_STATUS_EVENT, { detail: { reachable } }))
}

function noteSessionExpired() {
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
}

function storeRenewedToken(response) {
  const renewed = response.headers.get(RENEWED_TOKEN_HEADER)
  if (!renewed) return
  const session = readSession()
  if (!session?.token) return
  writeSession({ ...session, token: renewed })
}

export async function apiFetch(path, options = {}) {
  const token = options.token ?? getAuthToken()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const fetchOptions = { ...options }
  delete fetchOptions.token
  delete fetchOptions.activity
  const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData
  const headers = {
    ...(fetchOptions.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(await deviceHeaders()),
    ...(fetchOptions.headers || {}),
  }
  if (isFormData) {
    delete headers['Content-Type']
  }

  if (!isPublicApiPath(normalizedPath) && !token) {
    return unauthenticatedResponse()
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const method = String(fetchOptions.method || 'GET').toUpperCase()
  const attempts = method === 'GET' ? GET_ATTEMPTS : 1
  let lastError = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${normalizedPath}`, {
        ...fetchOptions,
        headers,
      })
      noteBackend(true)
      storeRenewedToken(response)
      if (token && !isPublicApiPath(normalizedPath) && response.status === 401) {
        noteSessionExpired()
      }
      if (response.status < 500 || attempt === attempts - 1) return response
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1) break
    }
    await delay(GET_RETRY_DELAYS_MS[attempt] ?? 800)
  }

  if (!SILENT_NETWORK_PATHS.has(normalizeApiPath(normalizedPath))) {
    noteBackend(false)
  }
  throw lastError || new Error('Backend unreachable')
}

function parseFilenameFromDisposition(headerValue) {
  if (!headerValue) return null
  const match = headerValue.match(/filename="?([^"]+)"?/)
  return match?.[1] ?? null
}

function buildQueryString(query = {}) {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value))
    }
  }
  const queryString = searchParams.toString()
  return queryString ? `?${queryString}` : ''
}

export function saveBlobAsDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export async function apiFetchDownload(path, fallbackFilename = 'download', query = {}) {
  if (!getAuthToken()) {
    throw new Error('Authentication required')
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const response = await apiFetch(`${normalizedPath}${buildQueryString(query)}`)

  if (!response.ok) {
    let message = 'Download failed'
    try {
      const payload = await response.json()
      message = payload.message || message
    } catch {
      // Response body is not JSON
    }
    throw new Error(message)
  }

  const blob = await response.blob()
  const filename =
    parseFilenameFromDisposition(response.headers.get('Content-Disposition')) || fallbackFilename
  return { blob, filename }
}

export async function apiDownload(path, fallbackFilename = 'download', query = {}) {
  const { blob, filename } = await apiFetchDownload(path, fallbackFilename, query)
  saveBlobAsDownload(blob, filename)
  return filename
}

export async function apiUpload(path, fieldName, file) {
  const token = getAuthToken()
  if (!token) {
    throw new Error('Authentication required')
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const formData = new FormData()
  formData.append(fieldName, file)

  let response
  try {
    response = await fetch(`${API_BASE}${normalizedPath}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(await deviceHeaders()) },
      body: formData,
    })
  } catch (error) {
    noteBackend(false)
    throw error
  }

  noteBackend(true)
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401) {
    noteSessionExpired()
  }

  if (!response.ok) {
    throw new Error(payload.message || payload.detail || 'Upload failed')
  }

  return payload
}

export function updateSessionUser(user) {
  const session = readSession()
  if (!session) return
  writeSession({ ...session, user })
}
