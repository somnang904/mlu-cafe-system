import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageOff, Loader2 } from 'lucide-react'
import { apiFetch } from '../../services/apiClient'

/**
 * A receipt photo. Receipts are not public files, so the image is fetched with the session
 * (apiFetch) and shown from a blob URL instead of a plain <img src>.
 */
export default function ReceiptImage({ url, alt, className = '' }) {
  const { t } = useTranslation()
  const [state, setState] = useState({ url: null, src: '', failed: false })

  useEffect(() => {
    let objectUrl = ''
    let cancelled = false
    apiFetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        const blob = await response.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setState({ url, src: objectUrl, failed: false })
      })
      .catch(() => !cancelled && setState({ url, src: '', failed: true }))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  if (state.url !== url) {
    return (
      <span className={`flex items-center justify-center bg-slate-50 dark:bg-zinc-800 ${className}`}>
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label={t('expenses.receiptLoading')} />
      </span>
    )
  }
  if (state.failed) {
    return (
      <span className={`flex flex-col items-center justify-center gap-1 bg-slate-50 text-xs text-slate-500 dark:bg-zinc-800 dark:text-zinc-400 ${className}`}>
        <ImageOff className="h-5 w-5" aria-hidden />
        {t('expenses.receiptUnavailable')}
      </span>
    )
  }
  return <img src={state.src} alt={alt} className={className} />
}
