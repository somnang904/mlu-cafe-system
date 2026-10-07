const { readSetting, writeSetting } = require('./appSettings')
const { DEFAULT_EXCHANGE_RATE, MIN_EXCHANGE_RATE, MAX_EXCHANGE_RATE } = require('./cashDrawer')

const SETTING_KEY = 'usd_khr_rate'

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 })
}

function isValidRate(value) {
  return Number.isInteger(value) && value >= MIN_EXCHANGE_RATE && value <= MAX_EXCHANGE_RATE
}

/**
 * The rate the shop charges: riel per US dollar. Cash change and every receipt use it,
 * so the server owns it and the till never picks its own. Falls back to the default
 * until an admin sets one, and ignores a stored value that is no longer valid.
 */
async function getExchangeRate(db) {
  const stored = Number(await readSetting(db, SETTING_KEY))
  return isValidRate(stored) ? stored : DEFAULT_EXCHANGE_RATE
}

async function setExchangeRate(db, value) {
  const rate = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (!isValidRate(rate)) {
    throw badRequest(
      `Exchange rate must be a whole number between ${MIN_EXCHANGE_RATE} and ${MAX_EXCHANGE_RATE} riel per dollar`,
    )
  }
  await writeSetting(db, SETTING_KEY, rate)
  return rate
}

module.exports = {
  SETTING_KEY,
  getExchangeRate,
  setExchangeRate,
  isValidRate,
}
