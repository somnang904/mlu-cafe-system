/**
 * Banks a Bank Scan payment can be received on. The id is what gets stored in
 * orders.payment_bank, so keep ids stable; the frontend owns the display names.
 */
const PAYMENT_BANKS = ['ABA', 'ACLEDA', 'Wing', 'Canadia', 'Sathapana', 'Other']

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 })
}

/**
 * The bank only means something for a Bank Scan sale, so cash always stores
 * null. Bank Scan accepts a missing bank (rows from before this existed have
 * none) but rejects one that is not in the list.
 */
function normalizePaymentBank(method, bank) {
  if (method !== 'Bank Scan') return null
  if (bank == null || bank === '') return null
  const value = String(bank).trim()
  if (!PAYMENT_BANKS.includes(value)) {
    throw badRequest(`Invalid payment_bank. Use one of: ${PAYMENT_BANKS.join(', ')}.`)
  }
  return value
}

module.exports = { PAYMENT_BANKS, normalizePaymentBank }
