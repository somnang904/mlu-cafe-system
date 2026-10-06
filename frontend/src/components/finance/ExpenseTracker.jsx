import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Wallet } from 'lucide-react'
import { apiFetch } from '../../services/apiClient'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from '../../utils/expenseCategories'
import { PaidFromBadge, PaidFromSelector } from './PaidFrom'

const PAGE_SIZE = 25

function todayIso() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function ExpenseTracker({ days = 730, filterMonth = 'all', onChanged }) {
  const { t } = useTranslation()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const [form, setForm] = useState({
    category: 'Payroll',
    description: '',
    amount: '',
    expense_date: todayIso(),
    paid_from: 'drawer',
  })

  const panelRef = useModalKeyboard({
    isOpen: showForm,
    onEscape: () => setShowForm(false),
    primaryActionMode: 'never',
  })

  const loadExpenses = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`/expenses?days=${days}`)
      if (!res.ok) throw new Error(t('expenses.errors.load'))
      const data = await res.json()
      setExpenses(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error(err)
      setError(t('expenses.errors.couldNotLoad'))
      setExpenses([])
    } finally {
      setLoading(false)
    }
  }, [days, t])

  useEffect(() => {
    loadExpenses()
  }, [loadExpenses])

  useEffect(() => {
    setPage(1)
  }, [filterMonth])

  const visibleExpenses = useMemo(() => {
    if (!filterMonth || filterMonth === 'all') return expenses
    return expenses.filter((row) => String(row.expense_date || '').startsWith(filterMonth))
  }, [expenses, filterMonth])

  const totalSpending = useMemo(
    () => visibleExpenses.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [visibleExpenses],
  )

  const pageCount = Math.max(1, Math.ceil(visibleExpenses.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pagedExpenses = visibleExpenses.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: form.category,
          description: form.description,
          amount: Number(form.amount),
          expense_date: form.expense_date,
          paid_from: form.paid_from,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || t('expenses.errors.save'))
      setShowForm(false)
      setForm({
        category: 'Payroll',
        description: '',
        amount: '',
        expense_date: todayIso(),
        paid_from: 'drawer',
      })
      await loadExpenses()
      onChanged?.()
    } catch (err) {
      setError(err.message || t('expenses.errors.save'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      const res = await apiFetch(`/expenses/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(t('expenses.errors.delete'))
      setExpenses((prev) => prev.filter((row) => row.id !== id))
      onChanged?.()
    } catch (err) {
      setError(err.message || t('expenses.errors.delete'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-heading text-base font-semibold">{t('expenses.title')}</h4>
          <p className="text-muted text-sm">
            {t('expenses.summary', { total: `$${totalSpending.toFixed(2)}` })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          {t('expenses.add')}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border/60">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="table-head">
              <th className="px-4 py-3">{t('reservations.date')}</th>
              <th className="px-4 py-3">{t('common.category')}</th>
              <th className="px-4 py-3">{t('common.description')}</th>
              <th className="px-4 py-3">{t('common.amount')}</th>
              <th className="px-4 py-3">{t('expenses.paidFrom')}</th>
              <th className="px-4 py-3">{t('common.by')}</th>
              <th className="px-4 py-3 text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody className="table-divider">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  {t('expenses.loading')}
                </td>
              </tr>
            ) : visibleExpenses.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  <Wallet className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  {t('expenses.empty')}
                </td>
              </tr>
            ) : (
              pagedExpenses.map((row) => (
                <tr key={row.id} className="table-row">
                  <td className="px-4 py-3 tabular-nums text-muted">{row.expense_date}</td>
                  <td className="px-4 py-3 font-medium text-heading">{expenseCategoryLabel(row.category, t)}</td>
                  <td className="px-4 py-3 text-muted">{row.description || '—'}</td>
                  <td className="px-4 py-3 font-semibold tabular-nums text-heading">
                    ${Number(row.amount).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <PaidFromBadge value={row.paid_from} />
                  </td>
                  <td className="px-4 py-3 text-muted">{row.created_by_name || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(row.id)}
                      className="rounded-lg p-2 text-stone-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                      aria-label={t('a11y.deleteExpense')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {visibleExpenses.length > PAGE_SIZE ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted text-xs">
            {t('expenses.pagination', {
              from: (currentPage - 1) * PAGE_SIZE + 1,
              to: Math.min(currentPage * PAGE_SIZE, visibleExpenses.length),
              total: visibleExpenses.length,
            })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              className="btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('common.previous')}
            </button>
            <button
              type="button"
              disabled={currentPage >= pageCount}
              onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
              className="btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      ) : null}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="modal-backdrop" aria-hidden="true" />
          <div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            className="modal-panel relative z-10 w-full max-w-md p-6"
          >
            <h5 className="text-heading text-lg font-semibold">{t('expenses.logExpense')}</h5>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-zinc-300">
                  {t('common.category')}
                </label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="input-field"
                >
                  {EXPENSE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {expenseCategoryLabel(category, t)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-zinc-300">
                  {t('expenses.amountLabel')}
                </label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="input-field"
                />
              </div>
              <PaidFromSelector
                idPrefix="expense-tracker"
                value={form.paid_from}
                onChange={(paidFrom) => setForm((current) => ({ ...current, paid_from: paidFrom }))}
              />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-zinc-300">
                  {t('reservations.date')}
                </label>
                <input
                  type="date"
                  required
                  value={form.expense_date}
                  onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-zinc-300">
                  {t('common.description')}
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t('expenses.descriptionPlaceholder')}
                  className="input-field"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="btn-secondary flex-1 py-2.5 text-sm"
                >
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 py-2.5 text-sm">
                  {saving ? t('common.saving') : t('expenses.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
