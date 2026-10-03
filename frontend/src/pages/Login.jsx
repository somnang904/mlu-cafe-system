import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import ThemeToggle from '../components/ui/ThemeToggle'
import LanguageToggle from '../components/ui/LanguageToggle'
import { consumeConnectionLost } from '../services/sessionStorage'
import BrandLogo from '../components/common/BrandLogo'

export default function Login({ onLogin }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [lockedUntil, setLockedUntil] = useState(0)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [showConnectionNotice, setShowConnectionNotice] = useState(false)
  const lockSeconds = lockedUntil > nowTick ? Math.ceil((lockedUntil - nowTick) / 1000) : 0

  useEffect(() => {
    if (!lockedUntil || lockedUntil <= Date.now()) return undefined
    const timer = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [lockedUntil])

  useEffect(() => {
    if (consumeConnectionLost()) {
      setShowConnectionNotice(true)
    }
  }, [])

  const formatCountdown = (totalSeconds) => {
    const seconds = Math.max(0, totalSeconds)
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainder = seconds % 60
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    }
    return `${minutes}:${String(remainder).padStart(2, '0')}`
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (isLoading || lockSeconds > 0) return
    setError('')
    setShowConnectionNotice(false)
    setIsLoading(true)
    try {
      await onLogin({ username: email.trim(), password })
    } catch (err) {
      if (err.retryAfterSeconds > 0) {
        setLockedUntil(Date.now() + err.retryAfterSeconds * 1000)
        setNowTick(Date.now())
        setError(t('auth.tooManyAttempts'))
      } else if (err.status === 403) {
        setError(t('auth.accessDenied'))
      } else {
        setError(t('auth.invalidCredentials'))
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden text-foreground transition-colors duration-300">
      {/* Calm, on-brand gradient backdrop (replaces the old cafe photo). */}
      <div className="login-backdrop pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />

      <div className="absolute right-4 top-4 z-50 flex items-center gap-2 sm:right-8 sm:top-8">
        <LanguageToggle />
        <ThemeToggle variant="icon" />
      </div>

      <div className="login-page relative z-10 mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center gap-x-10 px-4 py-10 sm:px-8 lg:gap-x-16 lg:px-12">
        <div className="hidden lg:flex lg:w-[42%] lg:items-center lg:justify-center">
          <BrandLogo glow className="h-auto w-full max-h-[380px] max-w-[320px] object-contain" />
        </div>

        <div className="flex w-full items-center justify-center lg:w-[58%]">
          <div className="w-full max-w-[420px]">
            <div className="mb-8 flex justify-center lg:hidden">
              <BrandLogo glow className="h-auto w-full max-h-[180px] max-w-[180px] object-contain sm:max-h-[220px] sm:max-w-[220px]" />
            </div>

            <div className="flex w-full flex-col gap-5 rounded-3xl border border-cocoa-100/80 bg-white/70 p-6 shadow-xl shadow-cocoa-900/10 ring-1 ring-white/40 backdrop-blur-xl sm:p-8 dark:border-white/10 dark:bg-zinc-900/55 dark:shadow-black/30 dark:ring-white/10">
              <h2 className="text-3xl font-semibold tracking-tight text-slate-900 lg:text-4xl dark:text-zinc-50">
                {t('auth.staffSignIn')}
              </h2>

              <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                <div>
                  <label
                    htmlFor="login-username"
                    className="mb-2 block text-sm font-medium text-slate-700 lg:text-base dark:text-zinc-300"
                  >
                    {t('auth.username')}
                  </label>
                  <input
                    id="login-username"
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="username"
                    disabled={isLoading || lockSeconds > 0}
                    className="w-full rounded-xl border border-slate-200/80 bg-white/85 px-4 py-3.5 text-base text-slate-900 transition-shadow focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 lg:min-h-[52px] lg:px-5 lg:text-lg dark:border-zinc-600/80 dark:bg-zinc-800/90 dark:text-zinc-100 dark:focus:ring-emerald-500 [&:-webkit-autofill]:bg-transparent [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_rgb(255_255_255_/_0.9)] [&:-webkit-autofill]:[-webkit-text-fill-color:#1d1d1f] dark:[&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_rgb(39_39_42_/_0.95)] dark:[&:-webkit-autofill]:[-webkit-text-fill-color:#fafafa]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="mb-2 block text-sm font-medium text-slate-700 lg:text-base dark:text-zinc-300"
                  >
                    {t('auth.password')}
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    disabled={isLoading || lockSeconds > 0}
                    className="w-full rounded-xl border border-slate-200/80 bg-white/85 px-4 py-3.5 text-base text-slate-900 transition-shadow focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 lg:min-h-[52px] lg:px-5 lg:text-lg dark:border-zinc-600/80 dark:bg-zinc-800/90 dark:text-zinc-100 dark:focus:ring-emerald-500 [&:-webkit-autofill]:bg-transparent [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_rgb(255_255_255_/_0.9)] [&:-webkit-autofill]:[-webkit-text-fill-color:#1d1d1f] dark:[&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_rgb(39_39_42_/_0.95)] dark:[&:-webkit-autofill]:[-webkit-text-fill-color:#fafafa]"
                  />
                </div>

                {showConnectionNotice && !error ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
                    {t('auth.connectionLost')}
                  </p>
                ) : null}

                {error ? (
                  <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={isLoading || lockSeconds > 0}
                  className="relative w-full overflow-hidden rounded-full bg-forest-500 py-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-forest-600 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-[52px] lg:text-lg"
                >
                  <span className={isLoading ? 'opacity-0' : 'opacity-100'}>
                    {lockSeconds > 0
                      ? t('auth.tryAgainIn', { time: formatCountdown(lockSeconds) })
                      : t('auth.login')}
                  </span>
                  {isLoading ? (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    </span>
                  ) : null}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
