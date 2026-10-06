export default function FieldLabel({ icon: Icon, htmlFor, children, className = '' }) {
  return (
    <label
      htmlFor={htmlFor}
      className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400 ${className}`.trim()}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden /> : null}
      {children}
    </label>
  )
}
