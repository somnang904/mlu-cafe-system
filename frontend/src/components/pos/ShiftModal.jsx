import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, AlertCircle, Printer, DollarSign, Coins, NotebookPen } from 'lucide-react'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'
import { apiFetch } from '../../services/apiClient'
import { formatUsd, formatKhr, DEFAULT_EXCHANGE_RATE } from '../../utils/currency'
import { STORE } from '../../config/store'
import ModalHeader from '../ui/ModalHeader'
import FieldLabel from '../ui/FieldLabel'

/** Drawer movement reads as a change, so it keeps its sign; paying riel can take dollars out. */
function signedUsd(amount) {
  const value = Number(amount) || 0
  return `${value < 0 ? '−' : '+'}${formatUsd(Math.abs(value))}`
}

function signedKhr(amount) {
  const value = Number(amount) || 0
  return `${value < 0 ? '−' : '+'}${formatKhr(Math.abs(value))}`
}

export default function ShiftModal({ isOpen, onClose }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen, onEscape: onClose, primaryActionMode: 'never' })

  const [loading, setLoading] = useState(true)
  const [shift, setShift] = useState(null)
  const [step, setStep] = useState('view') // 'view' | 'close_form' | 'z_report'
  const [closingShiftResult, setClosingShiftResult] = useState(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Start shift form state
  const [openUsd, setOpenUsd] = useState('')
  const [openKhr, setOpenKhr] = useState('')

  // Close shift form state
  const [countedUsd, setCountedUsd] = useState('')
  const [countedKhr, setCountedKhr] = useState('')
  const [notes, setNotes] = useState('')

  const fetchCurrentShift = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/shifts/current')
      if (res.ok) {
        const data = await res.json()
        setShift(data.shift)
      }
    } catch (err) {
      console.error('Failed to load current shift:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      setStep('view')
      setClosingShiftResult(null)
      fetchCurrentShift()
    }
  }, [isOpen])

  if (!isOpen) return null

  const previewRate = Number(shift?.exchange_rate) > 0 ? Number(shift.exchange_rate) : DEFAULT_EXCHANGE_RATE
  const previewDiffUsd = (parseFloat(countedUsd) || 0) - Number(shift?.expected_cash_usd || 0)
  const previewDiffKhr = (parseFloat(countedKhr) || 0) - Number(shift?.expected_cash_khr || 0)
  const previewDiffTotalUsd = previewDiffUsd + previewDiffKhr / previewRate

  const handleStartShift = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await apiFetch('/shifts/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opening_float_usd: parseFloat(openUsd) || 0,
          opening_float_khr: parseFloat(openKhr) || 0,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to start shift')
      setShift(data.shift)
      setOpenUsd('')
      setOpenKhr('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleEndShift = async (e) => {
    e.preventDefault()
    if (!shift) return
    setSubmitting(true)
    setError('')
    try {
      const res = await apiFetch('/shifts/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shift_id: shift.id,
          closing_cash_usd: parseFloat(countedUsd) || 0,
          closing_cash_khr: parseFloat(countedKhr) || 0,
          notes,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to close shift')
      // Stamp the end time once here; computing it during render made it tick on every re-render.
      setClosingShiftResult({ ...data.shift, end_time: data.shift?.end_time ?? new Date().toISOString() })
      setStep('z_report')
      setShift(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handlePrintZReport = () => {
    window.print()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop print:hidden" aria-hidden="true" />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="modal-panel relative z-10 w-full max-w-lg overflow-hidden print:max-w-none print:rounded-none print:border-none print:shadow-none"
      >
        {/* Modal Header */}
        <div className="border-b border-border p-5 print:hidden">
          <ModalHeader
            icon={Clock}
            title={t('shifts.title', { defaultValue: 'Cash Drawer & Shift Management' })}
            subtitle={
              shift
                ? `${t('shifts.statusOpen', { defaultValue: 'Shift in progress' })} · ${shift.cashier_name}`
                : t('shifts.noOpenShift', { defaultValue: 'No active shift open' })
            }
            onClose={onClose}
          />
        </div>

        {/* Modal Content */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400">
              {t('common.loading', { defaultValue: 'Loading shift status...' })}
            </div>
          ) : !shift && step !== 'z_report' ? (
            /* =================== NO OPEN SHIFT (START SHIFT FORM) =================== */
            <form onSubmit={handleStartShift} className="space-y-4">
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {t('shifts.startShiftPrompt', { defaultValue: 'Open Shift & Enter Starting Float' })}
                </p>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  {t('shifts.startShiftDesc', {
                    defaultValue: 'Enter the cash in drawer before beginning sales so daily cash can be reconciled.',
                  })}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel icon={DollarSign} htmlFor="shift-open-usd">
                    {t('shifts.openingFloatUsd', { defaultValue: 'Starting Float (USD $)' })}
                  </FieldLabel>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-slate-400">$</span>
                    <input
                      id="shift-open-usd"
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      placeholder="0.00"
                      value={openUsd}
                      onChange={(e) => setOpenUsd(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white p-2.5 pl-7 text-sm font-semibold tabular-nums focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel icon={Coins} htmlFor="shift-open-khr">
                    {t('shifts.openingFloatKhr', { defaultValue: 'Starting Float (KHR ៛)' })}
                  </FieldLabel>
                  <div className="relative">
                    <input
                      id="shift-open-khr"
                      type="number"
                      step="100"
                      min="0"
                      placeholder="0"
                      value={openKhr}
                      onChange={(e) => setOpenKhr(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white p-2.5 pr-7 text-sm font-semibold tabular-nums focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-semibold text-slate-400">៛</span>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className={`btn-primary w-full py-3 text-sm font-semibold disabled:opacity-50 ${
                  submitting ? '' : 'beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)]'
                }`}
              >
                {submitting
                  ? t('common.saving', { defaultValue: 'Opening...' })
                  : t('shifts.openShiftBtn', { defaultValue: 'Start Shift (Open Drawer)' })}
              </button>
            </form>
          ) : shift && step === 'view' ? (
            /* =================== ACTIVE SHIFT DASHBOARD =================== */
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
                    {t('shifts.floatUsd', { defaultValue: 'Start Float ($)' })}
                  </span>
                  <p className="mt-1 text-base font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatUsd(shift.opening_float_usd)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
                    {t('shifts.floatKhr', { defaultValue: 'Start Float (៛)' })}
                  </span>
                  <p className="mt-1 text-base font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatKhr(shift.opening_float_khr)}
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 dark:border-emerald-500/20 dark:bg-emerald-950/20">
                  <span className="text-2xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                    {t('shifts.cashSales', { defaultValue: 'Cash Sales' })}
                  </span>
                  <p className="mt-1 text-base font-bold tabular-nums text-emerald-950 dark:text-emerald-200">
                    {formatUsd(shift.cash_sales_usd)}
                  </p>
                  {/* The sales value above is in dollars whatever the guest handed over, so
                      show what each currency actually did in the drawer, change included. */}
                  <p className="mt-0.5 text-2xs font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                    {t('shifts.intoDrawer', { defaultValue: 'In drawer' })}:{' '}
                    {signedUsd(shift.cash_net_usd)} · {signedKhr(shift.cash_sales_khr)}
                  </p>
                </div>
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 dark:border-cyan-500/20 dark:bg-cyan-950/20">
                  <span className="text-2xs font-semibold uppercase tracking-wider text-cyan-800 dark:text-cyan-300">
                    {t('shifts.bankSales', { defaultValue: 'Bank Scan' })}
                  </span>
                  <p className="mt-1 text-base font-bold tabular-nums text-cyan-950 dark:text-cyan-200">
                    {formatUsd(shift.bank_sales_usd)}
                  </p>
                </div>
              </div>

              {/* Expected In Drawer Highlight */}
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 dark:border-emerald-500/30 dark:bg-emerald-950/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-900 dark:text-emerald-200">
                    {t('shifts.expectedCash', { defaultValue: 'Expected Cash in Drawer' })}
                  </span>
                  <span className="text-xs text-emerald-700 dark:text-emerald-400">
                    {shift.order_count} orders completed
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold tabular-nums text-emerald-950 dark:text-emerald-100">
                    {formatUsd(shift.expected_cash_usd)}
                  </span>
                  <span className="text-lg font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
                    {formatKhr(shift.expected_cash_khr)}
                  </span>
                </div>
                {shift.expenses_usd > 0 && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {t('shifts.drawerExpensesDeducted', { amount: formatUsd(shift.expenses_usd) })}
                  </p>
                )}
                {shift.cash_refunds_usd > 0 && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    - {formatUsd(shift.cash_refunds_usd)} refunded for earlier shifts&apos; cash sales
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary flex-1 text-sm"
                >
                  {t('common.done')}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('close_form')}
                  className="btn-primary flex-1 py-2.5 text-sm font-semibold"
                >
                  {t('shifts.closeShiftBtn', { defaultValue: 'Close Shift & Z-Report' })}
                </button>
              </div>
            </div>
          ) : shift && step === 'close_form' ? (
            /* =================== CLOSE SHIFT (COUNTED CASH ENTRY) =================== */
            <form onSubmit={handleEndShift} className="space-y-4">
              <button
                type="button"
                onClick={() => setStep('view')}
                className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
              >
                ← {t('common.back', { defaultValue: 'Back to shift overview' })}
              </button>

              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                {t('shifts.countPrompt', {
                  defaultValue: 'Please count the physical cash in drawer and enter the amounts below.',
                })}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel icon={DollarSign} htmlFor="shift-counted-usd">
                    {t('shifts.countedUsd', { defaultValue: 'Actual Counted (USD $)' })}
                  </FieldLabel>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-slate-400">$</span>
                    <input
                      id="shift-counted-usd"
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      placeholder="0.00"
                      value={countedUsd}
                      onChange={(e) => setCountedUsd(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white p-2.5 pl-7 text-sm font-semibold tabular-nums focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel icon={Coins} htmlFor="shift-counted-khr">
                    {t('shifts.countedKhr', { defaultValue: 'Actual Counted (KHR ៛)' })}
                  </FieldLabel>
                  <div className="relative">
                    <input
                      id="shift-counted-khr"
                      type="number"
                      step="100"
                      min="0"
                      placeholder="0"
                      value={countedKhr}
                      onChange={(e) => setCountedKhr(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white p-2.5 pr-7 text-sm font-semibold tabular-nums focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-semibold text-slate-400">៛</span>
                  </div>
                </div>
              </div>

              {/* Live difference preview */}
              {countedUsd !== '' && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Expected:</span>
                    <span className="font-semibold tabular-nums">
                      {formatUsd(shift.expected_cash_usd)} / {formatKhr(shift.expected_cash_khr)}
                    </span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-slate-500">Difference (Over/Short):</span>
                    <span className="font-semibold tabular-nums">
                      {formatUsd(previewDiffUsd)} / {formatKhr(previewDiffKhr)}
                    </span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-slate-500">Total Difference (in $):</span>
                    <span
                      className={`font-bold tabular-nums ${
                        previewDiffTotalUsd >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatUsd(previewDiffTotalUsd)}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <FieldLabel icon={NotebookPen} htmlFor="shift-notes">
                  {t('shifts.handoverNotes', { defaultValue: 'Handover / Discrepancy Notes' })}
                </FieldLabel>
                <textarea
                  id="shift-notes"
                  rows="2"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('shifts.notesPlaceholder', { defaultValue: 'Optional notes regarding this shift...' })}
                  className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('view')}
                  className="btn-secondary flex-1 text-sm"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting || countedUsd === ''}
                  className={`btn-primary flex-1 py-2.5 text-sm font-semibold disabled:opacity-50 ${
                    submitting || countedUsd === '' ? '' : 'beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)]'
                  }`}
                >
                  {submitting
                    ? t('common.saving', { defaultValue: 'Closing...' })
                    : t('shifts.finalizeZReport', { defaultValue: 'Finalize & Generate Z-Report' })}
                </button>
              </div>
            </form>
          ) : (
            /* =================== Z-REPORT DISPLAY =================== */
            <div id="z-report-print-area" className="space-y-4">
              <div className="rounded-2xl border border-emerald-500/30 bg-white p-5 text-stone-900 shadow-sm print:border-none print:p-0">
                <div className="border-b border-dashed border-stone-200 pb-3 text-center">
                  <h2 className="text-lg font-bold">{STORE.officialName}</h2>
                  <p className="text-xs text-stone-500">Z-REPORT · END OF SHIFT</p>
                  <p className="mt-1 text-2xs text-stone-400">
                    Shift #{closingShiftResult?.id} · {closingShiftResult?.cashier_name}
                  </p>
                </div>

                <div className="py-3 text-xs space-y-1.5 border-b border-dashed border-stone-200">
                  <div className="flex justify-between">
                    <span className="text-stone-500">Start Time:</span>
                    <span className="tabular-nums font-medium">
                      {new Date(closingShiftResult?.start_time).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">End Time:</span>
                    <span className="tabular-nums font-medium">
                      {new Date(closingShiftResult?.end_time).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Opening Float:</span>
                    <span className="tabular-nums font-medium">
                      {formatUsd(closingShiftResult?.opening_float_usd)} / {formatKhr(closingShiftResult?.opening_float_khr)}
                    </span>
                  </div>
                </div>

                <div className="py-3 text-xs space-y-1.5 border-b border-dashed border-stone-200">
                  <div className="flex justify-between">
                    <span className="text-stone-500">Cash Sales:</span>
                    <span className="tabular-nums font-medium">{formatUsd(closingShiftResult?.cash_sales_usd)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Bank Scan Sales:</span>
                    <span className="tabular-nums font-medium">{formatUsd(closingShiftResult?.bank_sales_usd)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">{t('shifts.drawerExpenses')}</span>
                    <span className="tabular-nums font-medium text-rose-600">
                      -{formatUsd(closingShiftResult?.expenses_usd)}
                    </span>
                  </div>
                  {closingShiftResult?.cash_refunds_usd > 0 && (
                    <div className="flex justify-between">
                      <span className="text-stone-500">Earlier Sales Refunded:</span>
                      <span className="tabular-nums font-medium text-rose-600">
                        -{formatUsd(closingShiftResult.cash_refunds_usd)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold pt-1 border-t border-stone-100">
                    <span>Expected in Drawer:</span>
                    <span className="tabular-nums">
                      {formatUsd(closingShiftResult?.expected_cash_usd)} / {formatKhr(closingShiftResult?.expected_cash_khr)}
                    </span>
                  </div>
                </div>

                <div className="py-3 text-xs space-y-1.5">
                  <div className="flex justify-between font-bold">
                    <span>Actual Counted Cash:</span>
                    <span className="tabular-nums">
                      {formatUsd(closingShiftResult?.closing_cash_usd)} / {formatKhr(closingShiftResult?.closing_cash_khr)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Difference (Over/Short):</span>
                    <span className="tabular-nums font-medium">
                      {formatUsd(closingShiftResult?.difference_usd)} / {formatKhr(closingShiftResult?.difference_khr)}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-sm">
                    <span>Total Difference (in $):</span>
                    <span
                      className={`tabular-nums ${
                        Number(closingShiftResult?.difference_total_usd) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {formatUsd(closingShiftResult?.difference_total_usd)}
                    </span>
                  </div>
                  {closingShiftResult?.notes && (
                    <p className="mt-2 text-2xs text-stone-500 italic">
                      Note: {closingShiftResult.notes}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 print:hidden">
                <button
                  type="button"
                  onClick={handlePrintZReport}
                  className="btn-primary flex-1 py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                >
                  <Printer className="h-4 w-4" />
                  {t('shifts.printZReport', { defaultValue: 'Print Z-Report' })}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary px-4 text-sm"
                >
                  {t('common.done')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
