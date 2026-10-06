import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function PaginationBar({ currentPage, totalPages, onPageChange, className = '', alwaysShow = false }) {
  const { t } = useTranslation()
  if (totalPages <= 1 && !alwaysShow) return null

  const label = (page) => t('order.pageOf', { page: page + 1, total: totalPages })

  return (
    <div className={`flex items-center justify-between gap-3 ${className}`.trim()}>
      <button
        type="button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 0}
        className="btn-secondary inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm shadow-sm disabled:pointer-events-none disabled:opacity-40 sm:px-4"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">{t('common.previous')}</span>
      </button>

      <div className="flex items-center gap-1.5" role="group" aria-label={label(currentPage)}>
        {Array.from({ length: totalPages }, (_, page) => (
          <button
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            aria-current={page === currentPage ? 'page' : undefined}
            aria-label={label(page)}
            className={`h-2.5 rounded-full transition-all ${
              page === currentPage
                ? 'w-6 bg-forest-500'
                : 'w-2.5 bg-slate-300 hover:bg-slate-400 dark:bg-zinc-700 dark:hover:bg-zinc-600'
            }`}
          />
        ))}
        <span className="ml-2 text-xs font-medium tabular-nums text-slate-500 dark:text-zinc-400">
          {currentPage + 1} / {totalPages}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages - 1}
        className="btn-primary inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm shadow-sm disabled:pointer-events-none disabled:opacity-40 sm:px-4"
      >
        <span className="hidden sm:inline">{t('common.next')}</span>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}
