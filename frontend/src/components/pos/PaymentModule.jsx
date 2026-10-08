import { Banknote, ScanLine, Calculator, Landmark } from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  formatUsd,
  formatKhr,
  calculateCashChange,
  splitChange,
  usdToKhr,
} from '../../utils/currency'
import { PAYMENT_BANKS, bankLabel } from '../../utils/paymentBanks'
import BankMark from './BankMark'
import { useExchangeRate } from '../../hooks/useExchangeRate'

const PAYMENT_METHODS = [
  { id: 'Cash', labelKey: 'payment.methods.cash', icon: Banknote },
  { id: 'Bank Scan', labelKey: 'payment.methods.bankScan', icon: ScanLine },
]

export default function PaymentModule({ disabled, billTotal = 0, onConfirm }) {
  const { t } = useTranslation()
  const [method, setMethod] = useState('Cash')
  // Which bank the QR was scanned on. Left empty on purpose so the cashier has to pick one.
  const [bank, setBank] = useState('')
  const exchangeRate = useExchangeRate()
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
    } catch {
      // Storage can be blocked (private mode); the toggle still works for this session.
    }
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
  const changeSplit = splitChange(changeCalculation.changeUsd, exchangeRate)

  const isCash = method === 'Cash'
  const needsBank = method === 'Bank Scan' && !bank
  // Cash has to be counted before the sale is recorded. Leaving the boxes empty used to
  // book the bill as paid in exact dollars, which puts the wrong currency in the drawer
  // when the guest actually paid riel.
  const cashEntered = parsedReceivedUsd > 0 || parsedReceivedKhr > 0
  const isExactDisabled = isCash && !changeCalculation.isSufficient

  const handleConfirm = () => {
    if (disabled || !method) return
    if (isCash && !changeCalculation.isSufficient) return
    if (needsBank) return

    const finalRecUsd = parsedReceivedUsd
    const finalRecKhr = parsedReceivedKhr
    const finalChangeUsd = changeCalculation.changeUsd
    const finalChangeKhr = changeCalculation.changeKhr

    onConfirm?.(method, {
      clearImmediately,
      payment_bank: method === 'Bank Scan' ? bank : null,
      received_usd: isCash ? finalRecUsd : null,
      received_khr: isCash ? finalRecKhr : null,
      change_usd: isCash ? finalChangeUsd : null,
      change_khr: isCash ? finalChangeKhr : null,
      exchange_rate: exchangeRate,
    })
    // The next sale picks its bank again instead of inheriting this one.
    setBank('')
  }

  return (
    <div className="space-y-3">
      {/* Dual Currency Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 dark:border-emerald-500/20 dark:bg-emerald-950/20">
        <div>
          <span className="text-2xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
            {t('payment.totalDue', { defaultValue: 'Total Due' })}
          </span>
          <p className="text-2xl font-bold leading-tight tabular-nums text-emerald-900 dark:text-emerald-300">
            {formatUsd(billTotal)}
          </p>
        </div>
        <div className="text-right">
          <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-2xs font-medium text-emerald-700 dark:text-emerald-300">
            $1 = {exchangeRate.toLocaleString()} ៛
          </span>
          <p className="mt-1 text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatKhr(usdToKhr(billTotal, exchangeRate))}
          </p>
        </div>
      </div>

      {/* Payment Method Selector */}
      <div>
        <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
          {t('payment.method')}
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {PAYMENT_METHODS.map(({ id, labelKey, icon: Icon }) => {
            const isActive = method === id
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => setMethod(id)}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 transition ${
                  isActive
                    ? 'surface-emerald-selected ring-2 ring-emerald-500/30'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50'
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Icon
                  className={`h-5 w-5 ${isActive ? 'text-emerald-900 dark:text-emerald-300' : 'text-slate-400 dark:text-zinc-500'}`}
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

      {/* Which bank was scanned, so Sales History can tell the accounts apart */}
      {method === 'Bank Scan' && (
        <div className="space-y-1.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
            <Landmark className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            {t('payment.scannedBank', { defaultValue: 'Scanned on which bank?' })}
          </p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('payment.scannedBank')}>
            {PAYMENT_BANKS.map((entry) => {
              const { id } = entry
              const isActive = bank === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  disabled={disabled}
                  onClick={() => setBank(id)}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold transition ${
                    isActive
                      ? 'surface-emerald-selected text-emerald-900 ring-2 ring-emerald-500/30 dark:text-emerald-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <BankMark bank={entry} />
                  <span className="max-w-full truncate">{bankLabel(id, t)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Cash Received & Change Calculator */}
      {isCash && (
        <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
              <Calculator className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {t('payment.cashCalculator', { defaultValue: 'Cash Received & Change' })}
            </p>
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
            </div>
          </div>

          {/* Change or Remaining Due Display */}
          {(parsedReceivedUsd > 0 || parsedReceivedKhr > 0) && (
            <div>
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
                  {changeSplit.usd + changeSplit.khr > 0 && (
                    <p className="mt-1 text-right text-xs font-medium tabular-nums text-emerald-800 dark:text-emerald-300">
                      {t('payment.giveBack', { defaultValue: 'Give back' })}:{' '}
                      {[
                        changeSplit.usd > 0 ? formatUsd(changeSplit.usd) : null,
                        changeSplit.khr > 0 ? formatKhr(changeSplit.khr) : null,
                      ]
                        .filter(Boolean)
                        .join(' + ')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Clear Table Immediately Toggle */}
      <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 px-3 py-2.5 transition dark:border-zinc-800 dark:bg-zinc-900/60">
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
      {needsBank && (
        <p className="text-center text-xs font-medium text-amber-700 dark:text-amber-300" role="status">
          {t('payment.chooseBank', { defaultValue: 'Choose the bank that was scanned.' })}
        </p>
      )}
      {isExactDisabled && (
        <p className="text-center text-xs font-medium text-amber-700 dark:text-amber-300" role="status">
          {cashEntered
            ? t('payment.needMoreCash', { defaultValue: 'Cash received does not cover the bill yet.' })
            : t('payment.enterCashFirst', { defaultValue: 'Enter the cash received.' })}
        </p>
      )}
      <button
        type="button"
        disabled={disabled || isExactDisabled || needsBank}
        onClick={handleConfirm}
        className="btn-primary w-full py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t('payment.confirmComplete')}
      </button>
    </div>
  )
}
