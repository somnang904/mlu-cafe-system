import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert } from 'lucide-react'
import { apiFetch } from '../services/apiClient'
import { useActionBanner } from '../hooks/useActionBanner'
import AuditLogPanel from '../components/security/AuditLogPanel'
import Modal from '../components/common/Modal'
import ModalHeader from '../components/ui/ModalHeader'

function formatWhen(value, language) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(language === 'km' ? 'km-KH' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const FILTERS = ['ALL', 'NEW', 'REVIEWED', 'BLOCKED']

function statusClass(status) {
  if (status === 'NEW') return 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200'
  if (status === 'BLOCKED') return 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
  return 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200'
}

function LoginAlertsTab() {
  const { t, i18n } = useTranslation()
  const { notifySaved, notifyFailed } = useActionBanner()
  const [status, setStatus] = useState('ALL')
  const [alerts, setAlerts] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState(null)

  const loadAlerts = useCallback(async (nextStatus = status) => {
    setIsLoading(true)
    setError('')
    try {
      const response = await apiFetch(`/security-alerts?status=${encodeURIComponent(nextStatus)}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || t('securityAlerts.loadFailed'))
      }
      setAlerts(Array.isArray(data.alerts) ? data.alerts : [])
    } catch (err) {
      setAlerts([])
      setError(err.message || t('securityAlerts.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }, [status, t])

  useEffect(() => {
    loadAlerts(status)
  }, [status, loadAlerts])

  const runAction = async (id, action) => {
    setPendingId(id)
    setError('')
    try {
      const response = await apiFetch(`/security-alerts/${id}/${action}`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || t('securityAlerts.actionFailed'))
      }
      notifySaved(t(`securityAlerts.${action}`, { defaultValue: action }))
      await loadAlerts(status)
    } catch (err) {
      setError(err.message || t('securityAlerts.actionFailed'))
      notifyFailed(err)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setStatus(filter)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              status === filter
                ? 'bg-forest-600 text-white'
                : 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200'
            }`}
          >
            {t(`securityAlerts.filters.${filter}`)}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="table-shell overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">{t('securityAlerts.when')}</th>
              <th className="px-4 py-3">{t('securityAlerts.username')}</th>
              <th className="px-4 py-3">{t('securityAlerts.ip')}</th>
              <th className="px-4 py-3">{t('securityAlerts.device')}</th>
              <th className="px-4 py-3">{t('securityAlerts.location')}</th>
              <th className="px-4 py-3">{t('securityAlerts.attempts')}</th>
              <th className="px-4 py-3">{t('common.status')}</th>
              <th className="px-4 py-3">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">{t('common.loading')}</td>
              </tr>
            ) : alerts.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">{t('securityAlerts.empty')}</td>
              </tr>
            ) : (
              alerts.map((alert) => (
                <tr key={alert.id} className="border-t border-slate-200/80 dark:border-zinc-800">
                  <td className="px-4 py-3 whitespace-nowrap">{formatWhen(alert.createdAt, i18n.language)}</td>
                  <td className="px-4 py-3 font-medium">{alert.username}</td>
                  <td className="px-4 py-3">{alert.ipAddress}</td>
                  <td className="px-4 py-3 break-words">
                    {[alert.browser, alert.osName, alert.deviceType].filter(Boolean).join(' · ')}
                  </td>
                  <td className="px-4 py-3">{alert.location || t('securityAlerts.unknown')}</td>
                  <td className="px-4 py-3">{alert.failedAttempts}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-2xs font-bold ${statusClass(alert.status)}`}>
                      {t(`securityAlerts.filters.${alert.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {alert.status === 'NEW' ? (
                        <button
                          type="button"
                          disabled={pendingId === alert.id}
                          onClick={() => runAction(alert.id, 'review')}
                          className="rounded-full px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          {t('securityAlerts.markReviewed')}
                        </button>
                      ) : null}
                      {alert.status !== 'BLOCKED' ? (
                        <button
                          type="button"
                          disabled={pendingId === alert.id}
                          onClick={() => runAction(alert.id, 'block')}
                          className="rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                        >
                          {t('securityAlerts.blockDevice')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={pendingId === alert.id}
                          onClick={() => runAction(alert.id, 'unblock')}
                          className="rounded-full px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-950/40"
                        >
                          {t('securityAlerts.unblock')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ActiveSessionsTab() {
  const { t, i18n } = useTranslation()
  const { notifySaved, notifyFailed } = useActionBanner()
  const [sessions, setSessions] = useState([])
  const [currentJti, setCurrentJti] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)
  const [confirm, setConfirm] = useState(null)

  const loadSessions = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const response = await apiFetch('/security/sessions')
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || t('securityAlerts.sessionsLoadFailed'))
      }
      setSessions(Array.isArray(data.sessions) ? data.sessions : [])
      setCurrentJti(data.currentJti || null)
    } catch (err) {
      setSessions([])
      setError(err.message || t('securityAlerts.sessionsLoadFailed'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const runTerminate = async () => {
    if (!confirm || pending) return
    setPending(confirm.key)
    setError('')
    try {
      const response = await apiFetch(`/security/sessions/${encodeURIComponent(confirm.jti)}/terminate`, {
        method: 'POST',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || t('securityAlerts.terminateFailed'))
      }
      setConfirm(null)
      if (data.isCurrentSession) {
        // Next authenticated call will 401 and clear the local session.
      }
      notifySaved(t('securityAlerts.terminate'))
      await loadSessions()
    } catch (err) {
      setError(err.message || t('securityAlerts.terminateFailed'))
      notifyFailed(err)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="table-shell overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">{t('securityAlerts.username')}</th>
              <th className="px-4 py-3">{t('securityAlerts.device')}</th>
              <th className="px-4 py-3">{t('securityAlerts.ip')}</th>
              <th className="px-4 py-3">{t('securityAlerts.signedIn')}</th>
              <th className="px-4 py-3">{t('securityAlerts.lastActive')}</th>
              <th className="px-4 py-3">{t('common.status')}</th>
              <th className="px-4 py-3">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">{t('common.loading')}</td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">{t('securityAlerts.sessionsEmpty')}</td>
              </tr>
            ) : (
              sessions.map((row) => {
                const isCurrent = row.jti === currentJti
                const isActive = row.status === 'active'
                return (
                  <tr key={row.jti} className="border-t border-slate-200/80 dark:border-zinc-800">
                    <td className="px-4 py-3 font-medium">
                      {row.displayName || row.username || row.userId}
                      {isCurrent ? (
                        <span className="ml-2 rounded-full bg-forest-100 px-2 py-0.5 text-2xs font-bold text-forest-800 dark:bg-forest-950/40 dark:text-forest-200">
                          {t('securityAlerts.thisDevice')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 break-words">{row.deviceLabel || '—'}</td>
                    <td className="px-4 py-3">{row.ip || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatWhen(row.createdAt, i18n.language)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatWhen(row.lastSeenAt, i18n.language)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-2xs font-bold ${
                        isActive
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                          : 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200'
                      }`}
                      >
                        {isActive ? t('securityAlerts.statusActive') : t('securityAlerts.statusTerminated')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {isActive ? (
                        <button
                          type="button"
                          disabled={Boolean(pending)}
                          onClick={() => setConfirm({
                            type: 'one',
                            key: row.jti,
                            jti: row.jti,
                            username: row.username,
                            deviceLabel: row.deviceLabel,
                            isSelf: isCurrent,
                          })}
                          className="rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                        >
                          {t('securityAlerts.terminate')}
                        </button>
                      ) : (
                        <span className="text-muted text-xs">—</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {confirm ? (
        <Modal
          title={t('securityAlerts.terminateTitle')}
          titleId="terminate-session-title"
          header={(
            <ModalHeader
              icon={ShieldAlert}
              iconClassName="text-red-600 dark:text-red-400"
              titleId="terminate-session-title"
              title={t('securityAlerts.terminateTitle')}
            />
          )}
          onClose={() => { if (!pending) setConfirm(null) }}
          closeLabel={t('a11y.closeModal')}
          dismissible={!pending}
          footer={(
            <>
              <button
                type="button"
                disabled={Boolean(pending)}
                onClick={() => setConfirm(null)}
                className="btn-secondary flex-1 py-2.5 text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={Boolean(pending)}
                onClick={runTerminate}
                className="btn-primary flex-1 bg-red-600 py-2.5 text-sm hover:bg-red-500"
              >
                {pending ? t('common.loading') : t('securityAlerts.terminateConfirm')}
              </button>
            </>
          )}
        >
          <div className="space-y-3 text-sm">
            <p>
              {t('securityAlerts.terminateOneBody', {
                user: confirm.username,
                device: confirm.deviceLabel || t('securityAlerts.unknown'),
              })}
            </p>
            {confirm.isSelf ? (
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                {t('securityAlerts.terminateSelfWarning')}
              </p>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

export default function SecurityAlerts() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('login')

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-heading flex items-center gap-2 text-lg font-bold">
          <ShieldAlert className="h-5 w-5 text-red-600" />
          {t('nav.securityAlerts')}
        </h3>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        <button
          type="button"
          onClick={() => setTab('login')}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
            tab === 'login'
              ? 'bg-forest-600 text-white'
              : 'text-muted hover:bg-stone-100 dark:hover:bg-zinc-800'
          }`}
        >
          {t('securityAlerts.tabLogin')}
        </button>
        <button
          type="button"
          onClick={() => setTab('sessions')}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
            tab === 'sessions'
              ? 'bg-forest-600 text-white'
              : 'text-muted hover:bg-stone-100 dark:hover:bg-zinc-800'
          }`}
        >
          {t('securityAlerts.tabSessions')}
        </button>
        <button
          type="button"
          onClick={() => setTab('audit')}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
            tab === 'audit'
              ? 'bg-forest-600 text-white'
              : 'text-muted hover:bg-stone-100 dark:hover:bg-zinc-800'
          }`}
        >
          {t('securityAlerts.tabAudit')}
        </button>
      </div>

      {tab === 'login' ? <LoginAlertsTab /> : null}
      {tab === 'sessions' ? <ActiveSessionsTab /> : null}
      {tab === 'audit' ? <AuditLogPanel /> : null}
    </div>
  )
}
