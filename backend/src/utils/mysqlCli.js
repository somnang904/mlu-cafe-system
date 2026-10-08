const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { env } = require('../config/env')
const { resolveDbHost } = require('../../db')

function findLaragonMysqlBin() {
  const laragonRoot = process.env.LARAGON_ROOT || 'C:\\laragon'
  const mysqlRoot = path.join(laragonRoot, 'bin', 'mysql')

  if (!fs.existsSync(mysqlRoot)) return null

  const versions = fs.readdirSync(mysqlRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()

  for (const version of versions) {
    const binDir = path.join(mysqlRoot, version, 'bin')
    const mysqldumpPath = path.join(binDir, process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump')
    if (fs.existsSync(mysqldumpPath)) {
      return binDir
    }
  }

  return null
}

function findWampMysqlBin() {
  const roots = [process.env.WAMP_ROOT, 'C:\\wamp64', 'C:\\wamp'].filter(Boolean)
  const tool = process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump'
  for (const root of roots) {
    for (const engine of ['mariadb', 'mysql']) {
      const engineRoot = path.join(root, 'bin', engine)
      if (!fs.existsSync(engineRoot)) continue
      const versions = fs.readdirSync(engineRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      for (const version of versions) {
        const binDir = path.join(engineRoot, version, 'bin')
        if (fs.existsSync(path.join(binDir, tool))) return binDir
      }
    }
  }
  return null
}

function resolveMysqlBinDir() {
  if (process.env.MYSQL_BIN && fs.existsSync(process.env.MYSQL_BIN)) {
    return process.env.MYSQL_BIN
  }

  const wampBin = findWampMysqlBin()
  if (wampBin) return wampBin

  const laragonBin = findLaragonMysqlBin()
  if (laragonBin) return laragonBin

  return null
}

function resolveCliTool(toolName) {
  const binDir = resolveMysqlBinDir()
  const executable = process.platform === 'win32' ? `${toolName}.exe` : toolName

  if (binDir) {
    const fullPath = path.join(binDir, executable)
    if (fs.existsSync(fullPath)) return fullPath
  }

  return executable
}

function buildMysqlArgs() {
  const host = resolveDbHost(env.db.host)
  const args = ['-h', host, '-u', env.db.user]

  if (env.db.password) {
    args.push(`-p${env.db.password}`)
  }

  return args
}

function runCliProcess(executable, args, input = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const stdoutChunks = []
    const stderrChunks = []

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk))

    child.on('error', (error) => {
      reject(new Error(`Failed to start ${path.basename(executable)}: ${error.message}`))
    })

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks)
      const stderr = Buffer.concat(stderrChunks).toString('utf8')

      if (code !== 0) {
        const detail = stderr.trim() || `Process exited with code ${code}`
        reject(new Error(detail))
        return
      }

      resolve({ stdout, stderr })
    })

    if (input) {
      child.stdin.write(input)
    }
    child.stdin.end()
  })
}

function runCliToFile(executable, args, filePath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath, { flags: 'a' })
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stderrChunks = []

    child.stdout.pipe(output)
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk))
    child.on('error', (error) => {
      output.destroy()
      reject(error)
    })
    child.on('close', (code) => {
      const stderr = Buffer.concat(stderrChunks).toString('utf8')
      output.end(() => {
        if (code !== 0) {
          const error = new Error(stderr.trim() || `Process exited with code ${code}`)
          error.exitCode = code
          reject(error)
          return
        }
        resolve({ stderr })
      })
    })
  })
}

function runCliFromFile(executable, args, inputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stderrChunks = []
    const input = fs.createReadStream(inputPath)

    input.on('error', reject)
    input.pipe(child.stdin)
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk))
    child.stdout.on('data', () => {})
    child.on('error', reject)
    child.on('close', (code) => {
      const stderr = Buffer.concat(stderrChunks).toString('utf8')
      if (code !== 0) {
        const error = new Error(stderr.trim() || `Process exited with code ${code}`)
        error.exitCode = code
        reject(error)
        return
      }
      resolve({ stderr })
    })
  })
}

function formatBackupTimestamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

module.exports = {
  resolveCliTool,
  buildMysqlArgs,
  runCliProcess,
  runCliToFile,
  runCliFromFile,
  formatBackupTimestamp,
  getDatabaseName: () => env.db.database,
}
