import { Banknote } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useExchangeRate } from '../../hooks/useExchangeRate'

function formatKhr(value) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/**
 * The shop's USD -> KHR rate, for reference. An admin changes it under
 * Settings > Exchange Rate; the live market rate, when known, sits underneath.
 */
export default function ExchangeRateCard({ marketRate = null, marketUpdated = null }) {
  const { t } = useTranslation()
  const rate = useExchangeRate()

  return (
    <div className="surface-card flex items-center gap-4 p-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm">
        <Banknote className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <p className="text-muted text-sm font-medium">{t('dashboard.exchangeRate')}</p>
        <p className="text-heading mt-1 text-2xl font-semibold tabular-nums">
          {t('dashboard.usdToKhr', { rate: formatKhr(rate) })}
        </p>
        {marketRate ? (
          <p className="text-muted mt-1 text-xs tabular-nums">
            {t('dashboard.marketRate', { rate: formatKhr(marketRate) })}
            {marketUpdated ? ` · ${marketUpdated}` : ''}
          </p>
        ) : null}
      </div>
    </div>
  )
}
