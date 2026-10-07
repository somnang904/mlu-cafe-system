import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarRange, FileSpreadsheet, FileText, GitCompareArrows, Loader2, Pencil } from 'lucide-react'
import Modal from '../common/Modal'
import ModalHeader from '../ui/ModalHeader'
import FieldLabel from '../ui/FieldLabel'
import { useNotifications } from '../../context/NotificationContext'
import { apiFetchDownload, saveBlobAsDownload } from '../../services/apiClient'

const REPORT_EXPORT_SECTIONS = [
  { id: 'income', labelKey: 'reports.salesAndRefunds' },
  { id: 'expenses', labelKey: 'reports.expenses' },
  { id: 'profit', labelKey: 'reports.netProfit' },
  { id: 'orders', labelKey: 'reports.ordersFulfilled' },
  { id: 'monthly', labelKey: 'reports.breakdownSection' },
  { id: 'spending', labelKey: 'reports.spendingByCategory' },
]

function reportFileBase(from, to) {
  return from === to ? `Mlu_Report_${from}` : `Mlu_Report_${from}_to_${to}`
}

function sanitizeFileBase(value) {
  return String(value || '')
    .replace(/\.(xlsx|pdf)$/i, '')
    // Control characters are invalid in Windows file names, so matching them is intended.
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/** Excel/PDF export of the selected range (and the previous period when compare is on). The file is in English. */
export default function ReportExportDialog({ kind, from, to, allTime = false, compare, compareRange = null, periodLabel, compareLabel, onClose }) {
  const { t } = useTranslation()
  const { pushBanner } = useNotifications()
  const [sections, setSections] = useState(() => REPORT_EXPORT_SECTIONS.map((section) => section.id))
  const [fileName, setFileName] = useState(() => (allTime ? 'Mlu_Report_All-Time' : reportFileBase(from, to)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const allSelected = sections.length === REPORT_EXPORT_SECTIONS.length
  const fileBase = sanitizeFileBase(fileName)
  const canSave = sections.length > 0 && Boolean(fileBase) && !saving
  const extension = kind === 'excel' ? 'xlsx' : 'pdf'
  const title = kind === 'excel' ? t('reports.exportExcelTitle') : t('reports.exportPdfTitle')
  const saveLock = useRef(false)

  const toggleSection = (id) => {
    setSections((current) => (
      current.includes(id) ? current.filter((section) => section !== id) : [...current, id]
    ))
    setError('')
  }

  const confirmExport = async () => {
    if (!canSave || saveLock.current) return
    saveLock.current = true
    const fullName = `${fileBase}.${extension}`
    let handle = null
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: fullName,
          types: [
            extension === 'xlsx'
              ? {
                  description: 'Excel',
                  accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
                }
              : { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } },
          ],
        })
      } catch (pickerError) {
        if (pickerError?.name === 'AbortError') {
          saveLock.current = false
          return
        }
        handle = null
      }
    }

    setSaving(true)
    setError('')
    try {
      const ordered = REPORT_EXPORT_SECTIONS.map((section) => section.id).filter((id) => sections.includes(id))
      const { blob } = await apiFetchDownload(`/reports/export/${kind}`, fullName, {
        // All time: month=all (no date range); otherwise the selected days.
        ...(allTime ? { month: 'all' } : { from, to }),
        compare: compare ? '1' : '0',
        // The exact period the page compares with (yesterday, last week, …).
        ...(compare && compareRange ? { compare_from: compareRange.from, compare_to: compareRange.to } : {}),
        sections: ordered.join(','),
      })
      if (handle) {
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
      } else {
        saveBlobAsDownload(blob, fullName)
      }
      pushBanner({ title: t('reports.exportSaved', { filename: fullName }), tone: 'success', durationMs: 4000 })
      onClose()
    } catch (exportError) {
      setError(exportError.message || t('reports.exportFailed'))
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  return (
    <Modal
      title={title}
      titleId="report-export-title"
      header={<ModalHeader icon={kind === 'excel' ? FileSpreadsheet : FileText} titleId="report-export-title" title={title} />}
      onClose={onClose}
      closeLabel={t('a11y.closeModal')}
      dismissible={!saving}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary flex-1 py-2.5 text-sm">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={confirmExport}
            disabled={!canSave}
            className={`btn-primary inline-flex flex-1 items-center justify-center gap-2 py-2.5 text-sm ${
              canSave ? 'beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)]' : ''
            }`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? t('reports.exportPreparing') : t('reports.exportOk')}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">{t('reports.exportSections')}</p>
          <button
            type="button"
            onClick={() => {
              setSections(allSelected ? [] : REPORT_EXPORT_SECTIONS.map((section) => section.id))
              setError('')
            }}
            className="shrink-0 text-sm font-semibold text-forest-700 hover:underline dark:text-forest-300"
          >
            {allSelected ? t('reports.clearAll') : t('reports.selectAll')}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          {REPORT_EXPORT_SECTIONS.map((section) => (
            <label key={section.id} className="flex min-h-10 min-w-0 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-forest-600"
                checked={sections.includes(section.id)}
                onChange={() => toggleSection(section.id)}
              />
              <span className="min-w-0 break-words">{t(section.labelKey)}</span>
            </label>
          ))}
        </div>
        {sections.length === 0 ? (
          <p className="text-sm text-rose-700 dark:text-rose-300">{t('reports.exportNeedSection')}</p>
        ) : null}
        <div>
          <FieldLabel icon={Pencil} htmlFor="report-export-file-name">
            {t('reports.fileName')}
          </FieldLabel>
          <input
            id="report-export-file-name"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            className="input-field w-full min-w-0 px-3 py-2 text-sm"
            maxLength={120}
          />
        </div>
        <div className="space-y-1.5 text-sm">
          <p className="flex items-center gap-1.5">
            <CalendarRange className="h-4 w-4 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
            <span className="text-muted">{t('reports.exportPeriod')}: </span>
            <span className="break-words font-medium">{periodLabel}</span>
          </p>
          {compare ? (
            <p className="flex items-center gap-1.5">
              <GitCompareArrows className="h-4 w-4 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
              <span className="text-muted">{t('reports.comparedWith')}: </span>
              <span className="break-words font-medium">{compareLabel}</span>
            </p>
          ) : null}
          <p className="text-muted text-xs">{t('reports.exportEnglishNote')}</p>
        </div>
        {error ? <p className="break-words text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
      </div>
    </Modal>
  )
}
