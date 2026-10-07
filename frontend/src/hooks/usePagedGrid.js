import { useCallback, useLayoutEffect, useState } from 'react'

export function usePagedGrid(gridRef, items, filterKey, rowsPerPage = 3) {
  const [pageSize, setPageSize] = useState(rowsPerPage * 3)
  const [pageState, setPageState] = useState({ key: filterKey, page: 0 })

  const hasItems = items.length > 0

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return undefined
    const measure = () => {
      const columns = window.getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1
      setPageSize((prev) => (prev === columns * rowsPerPage ? prev : columns * rowsPerPage))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [gridRef, rowsPerPage, hasItems])

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const requestedPage = pageState.key === filterKey ? pageState.page : 0
  const currentPage = Math.min(requestedPage, totalPages - 1)
  const pageItems = items.slice(currentPage * pageSize, currentPage * pageSize + pageSize)

  const goToPage = useCallback(
    (page) => setPageState({ key: filterKey, page: Math.max(0, Math.min(page, totalPages - 1)) }),
    [filterKey, totalPages],
  )

  return { pageItems, currentPage, totalPages, pageSize, goToPage }
}
