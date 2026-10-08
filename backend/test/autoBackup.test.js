const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { isDue, pruneBackups, listBackups, autoBackupStatus } = require('../src/utils/autoBackup')

const at = (text) => new Date(text)

test('a backup is due when none exists or the last one is a day old', () => {
  assert.equal(isDue(null, at('2026-10-08T10:00:00'), 23), true)
  assert.equal(isDue({ at: at('2026-10-07T09:00:00') }, at('2026-10-08T10:00:00'), 23), true)
})

test('a backup is due after the daily hour unless one was already taken after that hour today', () => {
  assert.equal(isDue({ at: at('2026-10-08T09:00:00') }, at('2026-10-08T22:59:00'), 23), false)
  assert.equal(isDue({ at: at('2026-10-08T09:00:00') }, at('2026-10-08T23:05:00'), 23), true)
  assert.equal(isDue({ at: at('2026-10-08T23:01:00') }, at('2026-10-08T23:40:00'), 23), false)
})

test('pruning keeps only the newest files of one kind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlu-auto-'))
  for (let i = 1; i <= 5; i += 1) {
    const file = path.join(dir, `Mlu_Auto_2026-10-0${i}_2300.sql`)
    fs.writeFileSync(file, 'x')
    fs.utimesSync(file, new Date(`2026-10-0${i}T23:00:00`), new Date(`2026-10-0${i}T23:00:00`))
  }
  fs.writeFileSync(path.join(dir, 'Mlu_Safety_2026-10-01_1000.sql'), 'x')
  const removed = pruneBackups(dir, 'Mlu_Auto_', 3)
  assert.deepEqual(removed.sort(), ['Mlu_Auto_2026-10-01_2300.sql', 'Mlu_Auto_2026-10-02_2300.sql'])
  assert.equal(listBackups(dir, 'Mlu_Auto_').length, 3)
  assert.equal(listBackups(dir, 'Mlu_Safety_').length, 1)
  const status = autoBackupStatus(dir)
  assert.equal(status.count, 3)
  assert.equal(status.last.name, 'Mlu_Auto_2026-10-05_2300.sql')
  fs.rmSync(dir, { recursive: true, force: true })
})
