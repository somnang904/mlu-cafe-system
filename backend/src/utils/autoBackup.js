const fs = require('fs')
const path = require('path')

const DAY_MS = 24 * 60 * 60 * 1000
const CHECK_EVERY_MS = 30 * 60 * 1000
const AUTO_PREFIX = 'Mlu_Auto_'
const SAFETY_PREFIX = 'Mlu_Safety_'

function autoBackupSettings() {
  const enabled = String(process.env.AUTO_BACKUP || 'on').trim().toLowerCase() !== 'off'
  const hour = Number.parseInt(process.env.AUTO_BACKUP_HOUR || '23', 10)
  const keep = Number.parseInt(process.env.AUTO_BACKUP_KEEP || '30', 10)
  return {
    enabled,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 23,
    keep: Number.isInteger(keep) && keep >= 1 ? keep : 30,
  }
}

function listBackups(directory, prefix) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.sql'))
    .map((name) => {
      const stat = fs.statSync(path.join(directory, name))
      return { name, at: stat.mtime, size: stat.size }
    })
    .sort((a, b) => b.at - a.at)
}

function pruneBackups(directory, prefix, keep) {
  const removed = []
  for (const file of listBackups(directory, prefix).slice(keep)) {
    fs.rmSync(path.join(directory, file.name), { force: true })
    removed.push(file.name)
  }
  return removed
}

function isDue(latest, now, hour) {
  if (!latest) return true
  if (now - latest.at >= DAY_MS) return true
  const sameDay = latest.at.toDateString() === now.toDateString()
  const takenAfterHour = latest.at.getHours() >= hour
  return now.getHours() >= hour && !(sameDay && takenAfterHour)
}

function startAutoBackup({ db, backupDirectory, writeFullDump, uniqueSqlName, log = console }) {
  const settings = autoBackupSettings()
  if (!settings.enabled) {
    log.log('   Automatic backup: off (AUTO_BACKUP=off)')
    return { stop() {} }
  }
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const directory = backupDirectory()
      const now = new Date()
      const latest = listBackups(directory, AUTO_PREFIX)[0] || null
      if (!isDue(latest, now, settings.hour)) return
      const filename = uniqueSqlName(directory, AUTO_PREFIX.replace(/_$/, ''), now)
      await writeFullDump(db, path.join(directory, filename))
      pruneBackups(directory, AUTO_PREFIX, settings.keep)
      pruneBackups(directory, SAFETY_PREFIX, 10)
      log.log(`   Automatic backup saved: ${path.join(directory, filename)}`)
    } catch (error) {
      log.error('Automatic backup failed:', error.message)
    } finally {
      running = false
    }
  }
  const first = setTimeout(run, 60 * 1000)
  const timer = setInterval(run, CHECK_EVERY_MS)
  first.unref?.()
  timer.unref?.()
  log.log(`   Automatic backup: daily after ${String(settings.hour).padStart(2, '0')}:00, keeping ${settings.keep}`)
  return { run, stop() { clearTimeout(first); clearInterval(timer) } }
}

function autoBackupStatus(directory) {
  const settings = autoBackupSettings()
  const latest = listBackups(directory, AUTO_PREFIX)[0] || null
  return {
    enabled: settings.enabled,
    hour: settings.hour,
    keep: settings.keep,
    directory,
    count: listBackups(directory, AUTO_PREFIX).length,
    last: latest ? { name: latest.name, at: latest.at.toISOString(), size: latest.size } : null,
  }
}

module.exports = { autoBackupSettings, listBackups, pruneBackups, isDue, startAutoBackup, autoBackupStatus, AUTO_PREFIX }
