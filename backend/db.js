const mysql = require('mysql2')
const { env } = require('./src/config/env')

function resolveDbHost(host) {
  const normalized = String(host || '').trim().toLowerCase()
  if (normalized === 'localhost') {
    return '127.0.0.1'
  }
  return host
}

const pool = mysql.createPool({
  host: resolveDbHost(env.db.host),
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+07:00',
})

pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+07:00'")
})

module.exports = pool.promise()
module.exports.resolveDbHost = resolveDbHost