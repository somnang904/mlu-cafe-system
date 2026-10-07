/** Label for a payment group from paymentBreakdown(): cash, bank (ABA/KHQR, stored as Bank Scan), card. */
export function paymentGroupLabel(row, t) {
  if (row.key === 'cash') return t('payment.methods.cash')
  if (row.key === 'bank') return t('reports.methods.abaKhqr')
  if (row.key === 'card') return t('reports.methods.card')
  return row.label || row.key
}
