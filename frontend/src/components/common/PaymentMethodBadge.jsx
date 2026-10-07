import { useTranslation } from 'react-i18next'
import StatusBadge from './StatusBadge'
import { paymentLabel } from '../../utils/paymentBanks'

const PAYMENT_BADGE_STYLES = {
  Cash: 'badge-olive',
  'Bank Scan': 'badge-forest',
}

export default function PaymentMethodBadge({ method, bank = null }) {
  const { t } = useTranslation()
  const style = PAYMENT_BADGE_STYLES[method]
    || 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
  const label = paymentLabel(method, bank, t)

  return (
    <StatusBadge className={style}>{label}</StatusBadge>
  )
}
