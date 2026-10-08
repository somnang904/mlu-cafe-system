const ALLOWED_KEYS = new Set(['usd_khr_rate'])

const { registerSchemaReset } = require('./schemaReset')
let schemaReadyPromise = null
registerSchemaReset(() => {
  schemaReadyPromise = null
})

async function ensureAppSettingsSchema(db) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS app_settings (
          setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
          setting_value VARCHAR(255) NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
    })().catch((error) => {
      schemaReadyPromise = null
      throw error
    })
  }
  return schemaReadyPromise
}

async function readSetting(db, key) {
  await ensureAppSettingsSchema(db)
  const [rows] = await db.execute(
    'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
    [key],
  )
  return rows.length ? rows[0].setting_value : null
}

async function writeSetting(db, key, value) {
  if (ALLOWED_KEYS.size > 0 && !ALLOWED_KEYS.has(key)) {
    throw new Error(`Unknown app setting: ${key}`)
  }
  await db.execute(
    `
    INSERT INTO app_settings (setting_key, setting_value)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
    `,
    [key, String(value)],
  )
}

module.exports = {
  ensureAppSettingsSchema,
  readSetting,
  writeSetting,
}
