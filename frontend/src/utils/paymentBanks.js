/**
 * Banks a Bank Scan payment can be received on. `id` is stored with the order
 * (it must match backend/src/utils/paymentBanks.js); brand names are shown as-is
 * in every language, only "Other" is translated.
 *
 * `logo` is the bank's own image from frontend/public/banks/. Banks without one fall back to
 * `mark`, a placeholder badge (initials on a colour of our own choosing, not the bank's
 * brand colours). To add a logo, drop the file in that folder and set `logo` on the bank.
 */
export const PAYMENT_BANKS = [
  { id: 'ABA', label: 'ABA', logo: '/banks/aba.jpg', mark: { text: 'AB', color: '#0e7490' } },
  { id: 'ACLEDA', label: 'ACLEDA', logo: '/banks/acleda.jpg', mark: { text: 'AC', color: '#4338ca' } },
  { id: 'Wing', label: 'Wing', logo: '/banks/wing.jpg', mark: { text: 'W', color: '#15803d' } },
  { id: 'Canadia', label: 'Canadia', logo: '/banks/canadia.webp', mark: { text: 'C', color: '#b91c1c' } },
  { id: 'Sathapana', label: 'Sathapana', logo: '/banks/sathapana.webp', mark: { text: 'S', color: '#c2410c' } },
  { id: 'Other', labelKey: 'payment.banks.other', mark: { text: null, color: '#475569' } },
]

export function bankLabel(bankId, t) {
  if (!bankId) return ''
  const bank = PAYMENT_BANKS.find((entry) => entry.id === bankId)
  if (!bank) return bankId
  return bank.labelKey ? t(bank.labelKey) : bank.label
}

/** Just the bank name ("ABA") for a scanned sale; "Bank Scan" only if no bank was recorded. */
export function paymentLabel(method, bankId, t) {
  if (method === 'Bank Scan') return bankLabel(bankId, t) || t('payment.methods.bankScan')
  return method === 'Cash' ? t('payment.methods.cash') : method
}
