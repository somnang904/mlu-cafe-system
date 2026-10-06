import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CalendarRange,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  HardDrive,
  KeyRound,
  Loader2,
  Upload,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../context/AuthContext'
import { useNotifications } from '../context/NotificationContext'
import Modal from '../components/common/Modal'
import ModalHeader from '../components/ui/ModalHeader'
import FieldLabel from '../components/ui/FieldLabel'
import { apiFetchDownload, apiUpload, saveBlobAsDownload } from '../services/apiClient'
import { userHasPermission } from '../utils/permissions'

import { formatMonthYear } from '../utils/dateTimeFormat'

function buildPeriodOptions(t, allTimeLabel) {
  const options = [{ value: 'all', label: allTimeLabel, month: null, year: null }]
  const now = new Date()

  for (let offset = 0; offset < 24; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const month = date.getMonth() + 1
    const year = date.getFullYear()
    const value = `${year}-${String(month).padStart(2, '0')}`
    const label = formatMonthYear(date, t)

    options.push({ value, label, month, year })
  }

  return options
}

function buildPeriodQuery(selectedPeriod) {
  if (selectedPeriod === 'all') return {}
  const [year, month] = selectedPeriod.split('-')
  return { month, year }
}

function OptionCard({ icon: Icon, title, badge, children, variant = 'default' }) {
  const accent =
    variant === 'danger'
      ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
      : 'bg-forest-100 dark:bg-forest-900/40 text-forest-600 dark:text-forest-400'

  return (
    <div className="surface-card flex flex-col gap-5 p-6">
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${accent}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-heading font-semibold">{title}</h4>
            {badge ? (
              <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                {badge}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}

function PeriodSelector({ value, onChange, id, options }) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label htmlFor={id} className="text-muted text-sm font-medium">
        {t('backup.exportPeriod')}
      </label>
      <div className="relative min-w-[220px]">
        <CalendarRange className="text-muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="input-field w-full appearance-none rounded-xl py-2.5 pl-10 pr-4 text-sm"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const EXCEL_TYPE = {
  description: 'Excel',
  accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
}
const PDF_TYPE = { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }
const SQL_TYPE = { description: 'SQL', accept: { 'application/sql': ['.sql'] } }

async function saveWithPicker(blob, filename, type) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [type],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return filename
    } catch (error) {
      if (error?.name === 'AbortError') return null
    }
  }
  saveBlobAsDownload(blob, filename)
  return filename
}

export default function BackupRecovery() {
  const { t } = useTranslation()
  const { isAdmin, user, logout } = useAuth()
  const canDownloadBackup = isAdmin || userHasPermission(user, 'backup_recovery')
  const { pushBanner } = useNotifications()
  const fileInputRef = useRef(null)
  const periodOptions = useMemo(
    () => buildPeriodOptions(t, t('dates.allTime')),
    [t],
  )

  const [selectedPeriod, setSelectedPeriod] = useState('all')
  const [pdfPeriod, setPdfPeriod] = useState('all')
  const [excelLoading, setExcelLoading] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [sqlLoading, setSqlLoading] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restorePhrase, setRestorePhrase] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const busy = excelLoading || pdfLoading || sqlLoading || restoreLoading

  const selectedPeriodLabel =
    periodOptions.find((option) => option.value === selectedPeriod)?.label || t('dates.allTime')
  const pdfPeriodLabel =
    periodOptions.find((option) => option.value === pdfPeriod)?.label || t('dates.allTime')

  const clearMessages = () => {
    setStatusMessage('')
    setErrorMessage('')
  }

  const notify = (title, tone, message) => {
    pushBanner({ title, message, tone, durationMs: tone === 'error' ? 8000 : 5000 })
  }

  const downloadExport = async (path, fallback, query, type, setLoading, successKey, failedKey) => {
    clearMessages()
    setLoading(true)
    try {
      const { blob, filename } = await apiFetchDownload(path, fallback, query)
      const saved = await saveWithPicker(blob, filename, type)
      if (!saved) return
      setStatusMessage(t(successKey, { filename: saved }))
      notify(t(successKey, { filename: saved }), 'success')
    } catch (error) {
      const message = error.message || t(failedKey)
      setErrorMessage(message)
      notify(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleExcelExport = () => downloadExport(
    '/system/backup/excel',
    'mlu-kitchen-cafe-business-data.xlsx',
    buildPeriodQuery(selectedPeriod),
    EXCEL_TYPE,
    setExcelLoading,
    'backup.exportSuccess',
    'backup.exportFailed',
  )

  const handlePdfExport = () => downloadExport(
    '/system/backup/sales-pdf',
    'Mlu_Sales.pdf',
    buildPeriodQuery(pdfPeriod),
    PDF_TYPE,
    setPdfLoading,
    'backup.exportPdfSuccess',
    'backup.exportPdfFailed',
  )

  const handleSqlBackup = () => downloadExport(
    '/system/backup/sql',
    'Mlu_Backup.sql',
    {},
    SQL_TYPE,
    setSqlLoading,
    'backup.sqlSuccess',
    'backup.sqlFailed',
  )

  const handleFileSelect = (event) => {
    clearMessages()
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
  }

  const openRestore = () => {
    if (!selectedFile) {
      const message = t('backup.chooseFileFirst')
      setErrorMessage(message)
      notify(message, 'error')
      return
    }
    setRestorePhrase('')
    setRestoreOpen(true)
  }

  const handleRestore = async () => {
    if (!selectedFile || restorePhrase !== t('backup.restorePhrase') || restoreLoading) return
    clearMessages()
    setRestoreLoading(true)
    try {
      const result = await apiUpload('/system/backup/restore', 'sqlFile', selectedFile)
      const message = t('backup.restoreSuccessDetail', {
        count: result.tables ?? 0,
        file: result.safetyBackup || t('backup.restoreSuccess'),
      })
      setStatusMessage(message)
      notify(message, 'success')
      setRestoreOpen(false)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      window.setTimeout(() => logout(), 2500)
    } catch (error) {
      const message = error.message || t('backup.restoreFailed')
      setErrorMessage(message)
      notify(message, 'error')
    } finally {
      setRestoreLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-heading text-lg">{t('nav.backupRecovery')}</h3>
      </div>

      {(statusMessage || errorMessage) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            errorMessage
              ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300'
          }`}
        >
          {errorMessage || statusMessage}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <OptionCard
          icon={FileSpreadsheet}
          title={t('backup.exportExcelTitle')}
          badge={t('backup.excelBadge')}
        >
          {canDownloadBackup ? (
          <div className="space-y-4">
            <PeriodSelector
              id="excel-period"
              value={selectedPeriod}
              onChange={setSelectedPeriod}
              options={periodOptions}
            />
            <button
              type="button"
              onClick={handleExcelExport}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-forest-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {excelLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {excelLoading
                ? t('backup.preparingExport')
                : t('backup.downloadExcel', { period: selectedPeriodLabel })}
            </button>
          </div>
          ) : (
            <p className="text-muted text-sm">{t('backup.downloadPermissionRequired')}</p>
          )}
        </OptionCard>

        <OptionCard
          icon={FileText}
          title={t('backup.exportPdfTitle')}
          badge={t('backup.pdfBadge')}
        >
          {canDownloadBackup ? (
          <div className="space-y-4">
            <p className="text-muted text-sm">{t('backup.exportPdfHint')}</p>
            <PeriodSelector
              id="sales-pdf-period"
              value={pdfPeriod}
              onChange={setPdfPeriod}
              options={periodOptions}
            />
            <button
              type="button"
              onClick={handlePdfExport}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-forest-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {pdfLoading
                ? t('backup.preparingExport')
                : t('backup.downloadPdf', { period: pdfPeriodLabel })}
            </button>
          </div>
          ) : (
            <p className="text-muted text-sm">{t('backup.downloadPermissionRequired')}</p>
          )}
        </OptionCard>

        <OptionCard
          icon={Database}
          title={t('backup.sqlTitle')}
          badge={canDownloadBackup ? t('backup.admin') : t('backup.adminOnly')}
        >
          {canDownloadBackup ? (
            <div className="space-y-4">
              <p className="text-muted text-sm">{t('backup.sqlDescription')}</p>
              <button
                type="button"
                onClick={handleSqlBackup}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-forest-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sqlLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" />}
                {sqlLoading ? t('backup.creatingBackup') : t('backup.downloadSql')}
              </button>
            </div>
          ) : (
            <p className="text-muted text-sm">{t('backup.downloadPermissionRequired')}</p>
          )}
        </OptionCard>
      </div>

      <OptionCard
        icon={Upload}
        title={t('backup.restoreTitle')}
        badge={isAdmin ? t('backup.safeOverwrite') : t('backup.adminOnly')}
        variant="danger"
      >
        {isAdmin ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".sql"
                onChange={handleFileSelect}
                className="text-muted block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-stone-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-stone-700 hover:file:bg-stone-200 dark:file:bg-stone-800 dark:file:text-stone-200 dark:hover:file:bg-stone-700"
              />
              <button
                type="button"
                onClick={openRestore}
                disabled={busy || !selectedFile}
                className="inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {restoreLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                {restoreLoading ? t('backup.restoring') : t('backup.restoreFromSql')}
              </button>
            </div>
            {selectedFile ? (
              <p className="text-muted text-sm">
                {t('backup.selectedFile', {
                  filename: selectedFile.name,
                  size: formatFileSize(selectedFile.size),
                })}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-muted text-sm">{t('backup.restoreAdminRequired')}</p>
        )}
      </OptionCard>

      {restoreOpen ? (
        <Modal
          title={t('backup.restoreTitle')}
          titleId="restore-backup-title"
          header={(
            <ModalHeader
              icon={AlertTriangle}
              iconClassName="text-rose-600 dark:text-rose-400"
              titleId="restore-backup-title"
              title={t('backup.restoreTitle')}
            />
          )}
          onClose={() => {
            if (!restoreLoading) setRestoreOpen(false)
          }}
          dismissible={!restoreLoading}
          closeLabel={t('backup.cancel')}
          footer={(
            <>
              <button
                type="button"
                onClick={() => setRestoreOpen(false)}
                disabled={restoreLoading}
                className="btn-secondary px-4 text-sm disabled:opacity-60"
              >
                {t('backup.cancel')}
              </button>
              <button
                type="button"
                onClick={handleRestore}
                disabled={restoreLoading || restorePhrase !== t('backup.restorePhrase')}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {restoreLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                {restoreLoading ? t('backup.restoring') : t('backup.restoreNow')}
              </button>
            </>
          )}
        >
          <div className="space-y-4">
            <p className="text-sm text-stone-700 dark:text-stone-200">{t('backup.restoreConfirm')}</p>
            {selectedFile ? (
              <p className="text-muted text-sm">
                {t('backup.selectedFile', {
                  filename: selectedFile.name,
                  size: formatFileSize(selectedFile.size),
                })}
              </p>
            ) : null}
            <div>
              <FieldLabel icon={KeyRound} htmlFor="restore-phrase">
                {t('backup.restoreTypeLabel')}
              </FieldLabel>
              <input
                id="restore-phrase"
                value={restorePhrase}
                onChange={(event) => setRestorePhrase(event.target.value)}
                autoComplete="off"
                disabled={restoreLoading}
                className="input-field w-full rounded-xl px-3 py-2.5 text-sm"
              />
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
