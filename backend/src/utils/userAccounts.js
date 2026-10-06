const crypto = require('crypto')
const bcrypt = require('bcrypt')
const { env } = require('../config/env')
const { isAdminRole } = require('../constants/permissions')
const { BCRYPT_COST } = require('./loginAuth')

let emailColumnReady = null
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

async function ensureUsersEmailColumn(db) {
  if (!emailColumnReady) {
    emailColumnReady = (async () => {
      const [columns] = await db.execute(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email'`,
      )
      if (!columns.length) {
        await db.execute('ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER username')
      }

      if (env.adminEmail) {
        await db.execute(
          `UPDATE users
           SET email = ?
           WHERE LOWER(role) = 'admin' AND (email IS NULL OR email = '')`,
          [env.adminEmail],
        )
      }
    })().catch((error) => {
      emailColumnReady = null
      throw error
    })
  }
  return emailColumnReady
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function isAdminAccount(user) {
  if (!user) return false
  if (isAdminRole(user.role)) return true
  return Boolean(env.adminEmail) && normalizeEmail(user.email) === env.adminEmail
}

function generateTemporaryPassword(length = 14) {
  const bytes = crypto.randomBytes(length)
  let password = ''
  for (let i = 0; i < length; i += 1) {
    password += TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length]
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return `${password}A7`
  }
  return password
}

async function hashPassword(plainPassword) {
  return bcrypt.hash(String(plainPassword), BCRYPT_COST)
}

async function findUserForRecovery(db, identifier) {
  await ensureUsersEmailColumn(db)
  const value = String(identifier || '').trim()
  if (!value) return null

  const username = value.toLowerCase()
  const email = normalizeEmail(value)

  const [rows] = await db.execute(
    `SELECT id, display_name, username, email, role, permissions, password_hash
     FROM users
     WHERE BINARY username = ? OR LOWER(email) = ?
     LIMIT 1`,
    [username, email],
  )

  return rows[0] ?? null
}

async function listAdminUsers(db) {
  await ensureUsersEmailColumn(db)
  const [rows] = await db.execute(
    `SELECT id, display_name, username, email, role
     FROM users
     WHERE LOWER(role) = 'admin' OR LOWER(email) = ?`,
    [env.adminEmail],
  )
  return rows
}

async function updateUserPasswordHash(db, userId, passwordHash) {
  await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId])
}

async function migrateStaffUsersToCashier(db) {
  const [result] = await db.execute("UPDATE users SET role = 'Cashier' WHERE LOWER(role) = 'staff'")
  return result.affectedRows
}

module.exports = {
  migrateStaffUsersToCashier,
  ensureUsersEmailColumn,
  isAdminAccount,
  generateTemporaryPassword,
  hashPassword,
  findUserForRecovery,
  listAdminUsers,
  updateUserPasswordHash,
  normalizeEmail,
}
