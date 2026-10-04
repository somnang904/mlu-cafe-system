import { Banknote, ScanLine, Calculator, DollarSign, Coins, Check, ArrowRight } from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_EXCHANGE_RATE,
  formatUsd,
  formatKhr,
  calculateCashChange,
  usdToKhr,
} from '../../utils/currency'

const PAYMENT_METHODS = [
  { id: 'Cash', labelKey: 'payment.methods.cash', icon: Banknote },
  { id: 'Bank Scan', labelKey: 'payment.methods.bankScan', icon: ScanLine },
]

const USD_PRESETS = [1, 5, 10, 20, 50, 100]
const KHR_PRESETS = [5000, 10000, 20000, 50000, 100000]

export default function PaymentModule({ disabled, billTotal = 0, onConfirm }) {
  const { t, i18n } = useTranslation()
  const [method, setMethod] = useState('Cash')
  const [exchangeRate] = useState(DEFAULT_EXCHANGE_RATE)
  const [receivedUsdInput, setReceivedUsdInput] = useState('')
  const [receivedKhrInput, setReceivedKhrInput] = useState('')

  const [clearImmediately, setClearImmediately] = useState(() => {
    try {
      const saved = localStorage.getItem('mlu_pos_clear_immediately')
      return saved !== null ? saved === 'true' : true
    } catch {
      return true
    }
  })

  const handleToggleClear = (val) => {
    setClearImmediately(val)
    try {
      localStorage.setItem('mlu_pos_clear_immediately', String(val))
    } catch {}
  }

  // Pre-fill exact cash or reset when billTotal changes
  useEffect(() => {
    setReceivedUsdInput('')
    setReceivedKhrInput('')
  }, [billTotal])

  const parsedReceivedUsd = parseFloat(receivedUsdInput) || 0
  const parsedReceivedKhr = parseFloat(receivedKhrInput) || 0

  const changeCalculation = useMemo(() => {
    return calculateCashChange({
      totalDueUsd: billTotal,
      receivedUsd: parsedReceivedUsd,
      receivedKhr: parsedReceivedKhr,
      exchangeRate,
    })
  }, [billTotal, parsedReceivedUsd, parsedReceivedKhr, exchangeRate])

  const isCash = method === 'Cash'
  const isExactDisabled = isCash && (!changeCalculation.isSufficient && (parsedReceivedUsd > 0 || parsedReceivedKhr > 0))

  const handleQuickUsd = (val) => {
    setReceivedUsdInput(String(val))
  }

  const handleQuickKhr = (val) => {
    setReceivedKhrInput(String(val))
  }

  const handleExactCashUsd = () => {
    setReceivedUsdInput(Number(billTotal).toFixed(2))
    setReceivedKhrInput('')
  }

  const handleExactCashKhr = () => {
    setReceivedUsdInput('')
    setReceivedKhrInput(String(usdToKhr(billTotal, exchangeRate)))
  }

  const handleConfirm = () => {
    if (disabled || !method) return
    if (isCash && !changeCalculation.isSufficient && (parsedReceivedUsd > 0 || parsedReceivedKhr > 0)) {
      return
    }

    // If cashier left inputs blank but clicked confirm, treat as exact cash in USD
    const finalRecUsd = isCash && parsedReceivedUsd === 0 && parsedReceivedKhr === 0
      ? Number(billTotal)
      : parsedReceivedUsd
    const finalRecKhr = parsedReceivedKhr
    const finalChangeUsd = isCash && parsedReceivedUsd === 0 && parsedReceivedKhr === 0
      ? 0
      : changeCalculation.changeUsd
    const finalChangeKhr = isCash && parsedReceivedUsd === 0 && parsedReceivedKhr === 0
      ? 0
      : changeCalculation.changeKhr

    onConfirm?.(method, {
      clearImmediately,
      received_usd: isCash ? finalRecUsd : null,
      received_khr: isCash ? finalRecKhr : null,
      change_usd: isCash ? finalChangeUsd : null,
      change_khr: isCash ? finalChangeKhr : null,
      exchange_rate: exchangeRate,
    })
  }

  return (
    <div className="space-y-4">
      {/* Dual Currency Banner */}
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 dark:border-emerald-500/20 dark:bg-emerald-950/20">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
            {t('payment.totalDue', { defaultValue: 'Total Due' })}
          </span>
          <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            $1 = {exchangeRate.toLocaleString()} ៛
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-2xl font-bold tabular-nums text-emerald-900 dark:text-emerald-300">
            {formatUsd(billTotal)}
          </span>
          <span className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatKhr(usdToKhr(billTotal, exchangeRate))}
          </span>
        </div>
      </div>

      {/* Payment Method Selector */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
          {t('payment.method')}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {PAYMENT_METHODS.map(({ id, labelKey, icon: Icon }) => {
            const isActive = method === id
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => setMethod(id)}
                className={`flex flex-col items-center justify-center gap-2 rounded-2xl border p-4 transition ${
                  isActive
                    ? 'surface-emerald-selected ring-2 ring-emerald-500/30'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50'
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Icon
                  className={`h-6 w-6 ${isActive ? 'text-emerald-900 dark:text-emerald-300' : 'text-slate-400 dark:text-zinc-500'}`}
                />
                <span
                  className={`text-sm font-semibold ${isActive ? 'text-emerald-900 dark:text-emerald-300' : 'text-slate-700 dark:text-zinc-300'}`}
                >
                  {t(labelKey)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Cash Received & Change Calculator */}
      {isCash && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
              <Calculator className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {t('payment.cashCalculator', { defaultValue: 'Cash Received & Change' })}
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={handleExactCashUsd}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                Exact $
              </button>
              <button
                type="button"
                onClick={handleExactCashKhr}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                Exact ៛
              </button>
            </div>
          </div>

          {/* Cash Inputs Grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* USD Input */}
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-zinc-400">
                {t('payment.receivedUsd', { defaultValue: 'Received (USD $)' })}
              </label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-slate-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={receivedUsdInput}
                  onChange={(e) => setReceivedUsdInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-7 pr-3 text-sm font-semibold tabular-nums text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {USD_PRESETS.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleQuickUsd(val)}
                    className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-emerald-950/40"
                  >
                    ${val}
                  </button>
                ))}
              </div>
            </div>

            {/* KHR Input */}
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-zinc-400">
                {t('payment.receivedKhr', { defaultValue: 'Received (KHR ៛)' })}
              </label>
              <div className="relative mt-1">
                <input
                  type="number"
                  step="100"
                  min="0"
                  placeholder="0"
                  value={receivedKhrInput}
                  onChange={(e) => setReceivedKhrInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-7 text-sm font-semibold tabular-nums text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 font-semibold text-slate-400">៛</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {KHR_PRESETS.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleQuickKhr(val)}
                    className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-emerald-950/40"
                  >
                    {val.toLocaleString()}៛
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Change or Remaining Due Display */}
          {(parsedReceivedUsd > 0 || parsedReceivedKhr > 0) && (
            <div className="pt-2">
              {!changeCalculation.isSufficient ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-300">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>{t('payment.remainingDue', { defaultValue: 'Remaining Due' })}</span>
                    <span className="tabular-nums">
                      {formatUsd(changeCalculation.remainingDueUsd)} / {formatKhr(changeCalculation.remainingDueKhr)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-950 dark:text-emerald-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      {t('payment.changeDue', { defaultValue: 'Change Due' })}
                    </span>
                    <div className="text-right">
                      <span className="text-lg font-bold tabular-nums">
                        {formatUsd(changeCalculation.changeUsd)}
                      </span>
                      <span className="ml-2 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                        ({formatKhr(changeCalculation.changeKhr)})
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Clear Table Immediately Toggle */}
      <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-3.5 transition dark:border-zinc-800 dark:bg-zinc-900/60">
        <label className="flex cursor-pointer items-start justify-between gap-3">
          <div className="flex-1 select-none">
            <span className="text-heading text-xs font-semibold">
              {t('payment.clearTableAfterPayment')}
            </span>
            <p className="text-muted mt-0.5 text-xs leading-normal">
              {clearImmediately
                ? t('payment.clearImmediatelyDesc')
                : t('payment.keepSeatedDesc')}
            </p>
          </div>
          <input
            type="checkbox"
            checked={clearImmediately}
            onChange={(e) => handleToggleClear(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-300 text-emerald-600 accent-emerald-600 focus:ring-emerald-500 dark:border-zinc-700"
          />
        </label>
      </div>

      {/* Confirm Button */}
      <button
        type="button"
        disabled={disabled || isExactDisabled}
        onClick={handleConfirm}
        className="btn-primary w-full py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t('payment.confirmComplete')}
      </button>
    </div>
  )
}
