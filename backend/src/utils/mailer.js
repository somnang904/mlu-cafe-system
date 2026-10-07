const fs = require('fs')
const path = require('path')
const nodemailer = require('nodemailer')
const { env } = require('../config/env')
const { STORE } = require('../config/store')
const { LOG_DIR } = require('./logger')
const { LOCK_RULE } = require('./loginLockoutPolicy')

function smtpIsConfigured() {
  return Boolean(env.smtp.host && env.smtp.user && env.smtp.pass)
}

function buildTransporter() {
  if (!smtpIsConfigured()) return null
  return nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure || env.smtp.port === 465,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass,
    },
  })
}

function writeDevMailLog({ to, subject, text }) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    const line = [
      `--- ${new Date().toISOString()} ---`,
      `To: ${to}`,
      `Subject: ${subject}`,
      text,
      '',
    ].join('\n')
    fs.appendFileSync(path.join(LOG_DIR, 'mail.log'), line, 'utf8')
  } catch (error) {
    console.warn('⚠️ Could not write mail.log:', error.message)
  }
}

/**
 * Sends a transactional email. When SMTP is not configured, development writes
 * the message to backend/logs/mail.log so local Admin resets are not lost.
 * Production without SMTP throws so the caller can surface a failure.
 */
async function sendMail({ to, subject, text, html }) {
  const recipient = String(to || '').trim()
  if (!recipient) {
    throw new Error('No email recipient')
  }

  const transporter = buildTransporter()
  if (transporter) {
    await transporter.sendMail({
      from: env.smtp.from,
      to: recipient,
      subject,
      text,
      html: html || undefined,
    })
    return { delivered: true, method: 'smtp' }
  }

  if (env.isProduction) {
    throw new Error('SMTP is not configured; cannot send email')
  }

  writeDevMailLog({ to: recipient, subject, text })
  console.warn(`⚠️ SMTP not configured — wrote mail to ${path.join(LOG_DIR, 'mail.log')}`)
  return { delivered: false, method: 'dev-log' }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function sendAdminPasswordResetEmail({ username, temporaryPassword }) {
  const to = env.adminEmail
  const subject = `${STORE.officialName} — administrator password reset`
  const text = [
    `A password reset was requested for the ${STORE.officialName} administrator account.`,
    '',
    `Username: ${username}`,
    `Temporary password: ${temporaryPassword}`,
    '',
    'Sign in with this password, then change it immediately in Users.',
    'If you did not request this reset, sign in and change the password anyway.',
  ].join('\n')

  const html = `
    <p>A password reset was requested for the ${escapeHtml(STORE.officialName)} administrator account.</p>
    <p><strong>Username:</strong> ${escapeHtml(username)}<br />
    <strong>Temporary password:</strong> <code>${escapeHtml(temporaryPassword)}</code></p>
    <p>Sign in with this password, then change it immediately in Users.</p>
  `

  return sendMail({ to, subject, text, html })
}

async function sendSecurityAlertEmail(alert) {
  const to = env.adminEmail
  const subject = `${STORE.officialName} — login lockout`
  const text = [
    `A login on ${STORE.officialName} was locked for ${LOCK_RULE.lockMs / 1000} seconds after ${LOCK_RULE.failures} failed attempts.`,
    '',
    `Username: ${alert.username}`,
    `IP address: ${alert.ipAddress}`,
    `Location: ${alert.location || 'Unknown'}`,
    `Browser: ${alert.browser || 'Unknown'}`,
    `Operating system: ${alert.osName || 'Unknown'}`,
    `Device: ${alert.deviceType || 'Unknown'}`,
    `Failed attempts: ${alert.failedAttempts}`,
    `Time: ${alert.createdAt}`,
    '',
    'Open Security Alerts in the admin dashboard to review or block this device.',
    'This message does not include a password.',
  ].join('\n')

  return sendMail({ to, subject, text })
}

module.exports = {
  smtpIsConfigured,
  sendMail,
  sendAdminPasswordResetEmail,
  sendSecurityAlertEmail,
}
