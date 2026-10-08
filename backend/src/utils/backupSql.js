const fs = require('fs')
const os = require('os')
const path = require('path')
const mysql = require('mysql2')
const {
  resolveCliTool,
  buildMysqlArgs,
  runCliToFile,
  runCliFromFile,
  getDatabaseName,
} = require('./mysqlCli')
const { beginMaintenance, endMaintenance } = require('./maintenance')

const DUMP_MARKER = 'Mlu Kitchen & Cafe Siem Reap System Database Backup'
const MAX_SQL_BYTES = 100 * 1024 * 1024
const REQUIRED_TABLES = ['orders', 'inventory', 'menu_item_stock_links', 'stock_movements']
const INSERT_BATCH = 200

function backupDirectory() {
  const configured = String(process.env.BACKUP_DIR || '').trim()
  const laragon = String(process.env.LARAGON_ROOT || '').trim()
  const directory = configured || (laragon ? path.join(laragon, 'backup') : path.join(__dirname, '..', '..', 'backups'))
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`
}

function uniqueSqlName(directory, prefix, date = new Date()) {
  const base = `${prefix}_${stamp(date)}`
  let filename = `${base}.sql`
  if (!fs.existsSync(path.join(directory, filename))) return filename
  const pad = (value) => String(value).padStart(2, '0')
  filename = `${base}${pad(date.getSeconds())}.sql`
  return filename
}

function headerLines() {
  return [
    `-- ${DUMP_MARKER}`,
    `-- Generated: ${new Date().toISOString()}`,
    '-- Backup-Scope: all',
    '-- Backup-Period: All Time',
    'SET FOREIGN_KEY_CHECKS=0;',
    'SET NAMES utf8mb4;',
    'SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";',
    '',
  ].join('\n')
}

function clientSafeDetail(error) {
  const raw = String(error?.message || '')
  const line = raw.split(/\r?\n/).find((part) => {
    const text = part.trim()
    if (!text) return false
    if (/password/i.test(text)) return false
    if (/[A-Za-z]:\\/.test(text)) return false
    if (/\/(laragon|Users|tmp|temp)\b/i.test(text)) return false
    return true
  })
  return String(line || 'the database tool reported an error').replace(/\s+/g, ' ').trim().slice(0, 180)
}

const SENSITIVE_DUMP_TABLES = [
  'users',
  'user_sessions',
  'revoked_tokens',
  'login_attempts',
  'security_alerts',
  'blocked_devices',
]

function publicError(status, message) {
  const error = new Error(message)
  error.status = status
  error.publicMessage = message
  return error
}

function writeChunk(stream, text) {
  return new Promise((resolve, reject) => {
    stream.write(text, (error) => (error ? reject(error) : resolve()))
  })
}

async function writeNodeDump(db, filePath, skipTables = []) {
  const output = fs.createWriteStream(filePath)
  await writeChunk(output, `${headerLines()}\n`)
  const [tables] = await db.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
  for (const tableRow of tables) {
    const tableName = Object.values(tableRow)[0]
    if (skipTables.includes(tableName)) continue
    const [[created]] = await db.query(`SHOW CREATE TABLE \`${tableName}\``)
    await writeChunk(output, `DROP TABLE IF EXISTS \`${tableName}\`;\n${created['Create Table']};\n\n`)
    const [columns] = await db.query(`SHOW COLUMNS FROM \`${tableName}\``)
    const fields = columns.map((column) => column.Field)
    const columnList = fields.map((field) => `\`${field}\``).join(', ')
    let lastId = 0
    const hasId = fields.includes('id')
    let offset = 0
    for (;;) {
      const sql = hasId
        ? `SELECT * FROM \`${tableName}\` WHERE id > ? ORDER BY id LIMIT ${INSERT_BATCH}`
        : `SELECT * FROM \`${tableName}\` LIMIT ${INSERT_BATCH} OFFSET ${offset}`
      const params = hasId ? [lastId] : []
      const [rows] = await db.query(sql, params)
      if (!rows.length) break
      const values = rows.map((row) => `(${fields.map((field) => mysql.escape(row[field])).join(', ')})`).join(',\n')
      await writeChunk(output, `INSERT INTO \`${tableName}\` (${columnList}) VALUES\n${values};\n`)
      if (hasId) lastId = rows[rows.length - 1].id
      else offset += rows.length
      if (rows.length < INSERT_BATCH) break
    }
    await writeChunk(output, '\n')
  }

  const [routines] = await db.query(
    `SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()`,
  )
  for (const routine of routines) {
    const type = String(routine.ROUTINE_TYPE || '').toUpperCase() === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE'
    const [[created]] = await db.query(`SHOW CREATE ${type} \`${routine.ROUTINE_NAME}\``)
    const body = created[`Create ${type.charAt(0)}${type.slice(1).toLowerCase()}`] || created['Create Procedure'] || created['Create Function']
    if (body) {
      await writeChunk(output, `DROP ${type} IF EXISTS \`${routine.ROUTINE_NAME}\`;\nDELIMITER $$\n${body} $$\nDELIMITER ;\n\n`)
    }
  }

  const [triggers] = await db.query('SHOW TRIGGERS')
  for (const trigger of triggers) {
    const [[created]] = await db.query(`SHOW CREATE TRIGGER \`${trigger.Trigger}\``)
    if (created['SQL Original Statement']) {
      await writeChunk(output, `DROP TRIGGER IF EXISTS \`${trigger.Trigger}\`;\n${created['SQL Original Statement']};\n\n`)
    }
  }

  await writeChunk(output, 'SET FOREIGN_KEY_CHECKS=1;\n')
  await new Promise((resolve, reject) => output.end((error) => (error ? reject(error) : resolve())))
}

async function writeFullDump(db, filePath, { excludeSensitive = false } = {}) {
  await fs.promises.writeFile(filePath, headerLines(), 'utf8')
  const mysqldump = resolveCliTool('mysqldump')
  const skipTables = excludeSensitive ? SENSITIVE_DUMP_TABLES : []
  const args = [
    ...buildMysqlArgs(),
    ...skipTables.map((table) => `--ignore-table=${getDatabaseName()}.${table}`),
    '--single-transaction',
    '--routines',
    '--triggers',
    '--add-drop-table',
    '--default-character-set=utf8mb4',
    getDatabaseName(),
  ]
  try {
    await runCliToFile(mysqldump, args, filePath)
  } catch (error) {
    await fs.promises.rm(filePath, { force: true })
    if (error.code === 'ENOENT') {
      await writeNodeDump(db, filePath, skipTables)
      return { engine: 'node' }
    }
    throw error
  }
  await fs.promises.appendFile(filePath, '\nSET FOREIGN_KEY_CHECKS=1;\n', 'utf8')
  return { engine: 'mysqldump' }
}

async function createDownloadDump(db, options = {}) {
  const filename = uniqueSqlName(os.tmpdir(), 'Mlu_Backup')
  const filePath = path.join(os.tmpdir(), filename)
  const result = await writeFullDump(db, filePath, options)
  return { filePath, filename, engine: result.engine }
}

async function createSafetyBackup(db) {
  const directory = backupDirectory()
  const filename = uniqueSqlName(directory, 'Mlu_Safety')
  const filePath = path.join(directory, filename)
  await writeFullDump(db, filePath)
  return { filename }
}

function pipeDownload(res, filePath, filename, contentType) {
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  const stream = fs.createReadStream(filePath)
  const cleanup = () => {
    fs.promises.unlink(filePath).catch(() => {})
  }
  stream.on('error', () => {
    cleanup()
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to send the file' })
    } else {
      res.destroy()
    }
  })
  stream.on('close', cleanup)
  stream.pipe(res)
}

async function validateSqlFile(filePath) {
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile() || stat.size === 0) {
    throw publicError(400, 'The uploaded SQL file is empty')
  }
  if (stat.size > MAX_SQL_BYTES) {
    throw publicError(400, 'The uploaded SQL file exceeds the 100 MB limit')
  }

  const found = new Set()
  let marker = false
  let checkedHeader = false
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
    let pending = ''
    stream.on('data', (chunk) => {
      const text = pending + chunk
      pending = text.slice(-80)
      if (!checkedHeader) {
        checkedHeader = true
        marker = text.slice(0, 4096).includes(DUMP_MARKER)
      }
      for (const table of REQUIRED_TABLES) {
        if (text.includes(`\`${table}\``) || text.includes(` ${table} `)) found.add(table)
      }
    })
    stream.on('error', reject)
    stream.on('end', resolve)
  })

  if (!marker) {
    throw publicError(400, 'This file is not a backup from Mlu Kitchen & Cafe. Restore only a full backup downloaded from Data Management.')
  }
  const missing = REQUIRED_TABLES.filter((table) => !found.has(table))
  if (missing.length) {
    throw publicError(400, 'This backup is missing stock tables from this system. Restore only a full backup downloaded from Data Management.')
  }
}

async function countTables(database) {
  const mysqlPath = resolveCliTool('mysql')
  const { stdout } = await new Promise((resolve, reject) => {
    const { spawn } = require('child_process')
    const child = spawn(mysqlPath, [
      ...buildMysqlArgs(),
      '-N',
      '-e',
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${database.replace(/'/g, '')}'`,
    ], { windowsHide: true })
    const out = []
    const err = []
    child.stdout.on('data', (chunk) => out.push(chunk))
    child.stderr.on('data', (chunk) => err.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(Buffer.concat(err).toString('utf8')))
      else resolve({ stdout: Buffer.concat(out).toString('utf8') })
    })
  })
  const count = Number.parseInt(String(stdout).trim(), 10)
  return Number.isInteger(count) ? count : 0
}

async function restoreDatabaseFromFile(db, filePath, options = {}) {
  await validateSqlFile(filePath)
  const database = options.database || getDatabaseName()
  const live = database === getDatabaseName() && options.database == null
  let safety = null

  if (live) {
    try {
      safety = await createSafetyBackup(db)
    } catch (error) {
      throw publicError(500, `Restore was cancelled because the safety backup could not be created. No data was changed. ${clientSafeDetail(error)}`)
    }
    beginMaintenance()
  }

  try {
    const mysqlPath = resolveCliTool('mysql')
    await runCliFromFile(mysqlPath, [...buildMysqlArgs(), database], filePath)
    if (live && typeof options.afterRestore === 'function') {
      try {
        await options.afterRestore()
      } catch (error) {
        throw publicError(
          500,
          `The backup data WAS restored, but updating the database structure afterwards failed (${clientSafeDetail(error)}). Restart the server so it can finish the update, then sign in again and check the Users page.`,
        )
      }
    }
    const tables = await countTables(database)
    return {
      message: `Database restored. ${tables} tables restored. Everyone has been signed out. After signing in again, check the Users page: an older backup can bring back old accounts, passwords or disabled users.`,
      tables,
      safetyBackup: safety?.filename || null,
      safetyLocation: safety ? 'server backup folder' : null,
    }
  } catch (error) {
    if (error.publicMessage) throw error
    const recovery = safety
      ? ` Import the safety backup ${safety.filename} from the server backup folder to put the data back.`
      : ''
    throw publicError(
      500,
      `Restore did not finish (${clientSafeDetail(error)}). The database may be partly changed.${recovery}`,
    )
  } finally {
    if (live) endMaintenance()
  }
}

module.exports = {
  DUMP_MARKER,
  MAX_SQL_BYTES,
  createDownloadDump,
  SENSITIVE_DUMP_TABLES,
  createSafetyBackup,
  pipeDownload,
  validateSqlFile,
  restoreDatabaseFromFile,
  writeFullDump,
  backupDirectory,
  uniqueSqlName,
}
