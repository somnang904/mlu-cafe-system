import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, X, AlertCircle, Printer } from 'lucide-react'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'
import { apiFetch } from '../../services/apiClient'
import { formatUsd, formatKhr, DEFAULT_EXCHANGE_RATE } from '../../utils/currency'
import { STORE } from '../../config/store'

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
      <button type="button" aria-label={t('a11y.close')} className="modal-backdrop print:hidden" onClick={onClose} />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="modal-panel relative z-10 w-full max-w-lg overflow-hidden print:max-w-none print:rounded-none print:border-none print:shadow-none"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border p-5 print:hidden">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-forest-50 text-forest-700 ring-1 ring-forest-100 dark:bg-forest-950/40 dark:text-forest-300 dark:ring-forest-800">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-heading text-lg font-bold">
                {t('shifts.title', { defaultValue: 'Cash Drawer & Shift Management' })}
              </h3>
              <p className="text-muted text-xs">
                {shift
                  ? `${t('shifts.statusOpen', { defaultValue: 'Shift in progress' })} · ${shift.cashier_name}`
                  : t('shifts.noOpenShift', { defaultValue: 'No active shift open' })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
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
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                    {t('shifts.openingFloatUsd', { defaultValue: 'Starting Float (USD $)' })}
                  </label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-slate-400">$</span>
                    <input
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
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                    {t('shifts.openingFloatKhr', { defaultValue: 'Starting Float (KHR ៛)' })}
                  </label>
                  <div className="relative mt-1">
                    <input
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
                className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-50"
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
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                    {t('shifts.countedUsd', { defaultValue: 'Actual Counted (USD $)' })}
                  </label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-slate-400">$</span>
                    <input
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
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                    {t('shifts.countedKhr', { defaultValue: 'Actual Counted (KHR ៛)' })}
                  </label>
                  <div className="relative mt-1">
                    <input
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
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                  {t('shifts.handoverNotes', { defaultValue: 'Handover / Discrepancy Notes' })}
                </label>
                <textarea
                  rows="2"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('shifts.notesPlaceholder', { defaultValue: 'Optional notes regarding this shift...' })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('view')}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting || countedUsd === ''}
                  className="btn-primary flex-1 py-2.5 text-sm font-semibold disabled:opacity-50"
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
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
