import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const ARROW_CLASS =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-forest-600 active:scale-95 disabled:pointer-events-none disabled:opacity-35 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'

export default function ScrollRow({ children, className = '' }) {
  const { t } = useTranslation()
  const rowRef = useRef(null)
  const [state, setState] = useState({ overflow: false, left: false, right: false })

  const update = useCallback(() => {
    const row = rowRef.current
    if (!row) return
    const max = row.scrollWidth - row.clientWidth
    setState({ overflow: max > 1, left: row.scrollLeft > 1, right: row.scrollLeft < max - 1 })
  }, [])

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return undefined
    update()
    const observer = new ResizeObserver(update)
    observer.observe(row)
    for (const child of row.children) observer.observe(child)
    return () => observer.disconnect()
  }, [update, children])

  const fade = `linear-gradient(to right, ${state.left ? 'transparent, #000 40px' : '#000'}, ${
    state.right ? '#000 calc(100% - 40px), transparent' : '#000'
  })`

  const scrollBy = (direction) => {
    const row = rowRef.current
    if (!row) return
    row.scrollBy({ left: direction * Math.max(160, row.clientWidth * 0.6), behavior: 'smooth' })
  }

  return (
    <div className="flex items-center gap-2">
      {state.overflow ? (
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          disabled={!state.left}
          className={ARROW_CLASS}
          aria-label={t('a11y.scrollLeft')}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
      ) : null}
      <div
        ref={rowRef}
        onScroll={update}
        onWheel={(event) => {
          const row = event.currentTarget
          if (row.scrollWidth > row.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            row.scrollLeft += event.deltaY
          }
        }}
        style={{ maskImage: fade, WebkitMaskImage: fade }}
        className={`no-scrollbar flex min-w-0 flex-1 overflow-x-auto scroll-smooth ${className}`.trim()}
      >
        {children}
      </div>
      {state.overflow ? (
        <button
          type="button"
          onClick={() => scrollBy(1)}
          disabled={!state.right}
          className={ARROW_CLASS}
          aria-label={t('a11y.scrollRight')}
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
