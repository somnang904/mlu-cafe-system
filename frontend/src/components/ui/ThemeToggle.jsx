import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../context/ThemeContext'

/**
 * @param {'icon' | 'switch'} variant
 * - icon: compact circular control for the app header (matches notification bell)
 * - switch: labeled track for Settings appearance row
 */
export default function ThemeToggle({ className = '', variant = 'icon' }) {
  const { isDark, toggleTheme } = useTheme()
  const { t } = useTranslation()
  const label = isDark ? t('a11y.switchToLightMode') : t('a11y.switchToDarkMode')

  if (variant === 'switch') {
    return (
      <button
        type="button"
        onClick={(event) => toggleTheme(event)}
        aria-label={label}
        aria-pressed={isDark}
        className={`interactive-btn relative inline-flex h-9 w-14 shrink-0 items-center rounded-full border border-slate-200 bg-slate-100 p-0.5 transition-colors duration-300 dark:border-zinc-700 dark:bg-zinc-800 ${className}`}
      >
        <span
          className={`pointer-events-none absolute top-0.5 left-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-300 dark:bg-zinc-950 ${
            isDark ? 'translate-x-5' : 'translate-x-0'
          }`}
        >
          {isDark ? (
            <Moon className="h-4 w-4 text-zinc-100" aria-hidden />
          ) : (
            <Sun className="h-4 w-4 text-forest-600" aria-hidden />
          )}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => toggleTheme(event)}
      aria-label={label}
      aria-pressed={isDark}
      className={`interactive-btn relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/50 bg-card/50 text-foreground backdrop-blur-sm transition-all hover:border-border hover:bg-card active:scale-95 dark:bg-card/40 ${className}`}
    >
      {isDark ? (
        <Moon className="h-5 w-5 text-foreground/90" aria-hidden />
      ) : (
        <Sun className="h-5 w-5 text-forest-600" aria-hidden />
      )}
    </button>
  )
}
