/** Titled card for a Reports section; `action` sits on the right of the title (e.g. "View all"). */
export default function ReportCard({ icon: Icon, title, action = null, children, className = '', bodyClassName = 'p-4 sm:p-5' }) {
  return (
    <section className={`surface-card overflow-hidden ${className}`.trim()}>
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-forest-100 dark:bg-forest-900/40">
              <Icon className="h-4 w-4 text-forest-600 dark:text-forest-400" aria-hidden />
            </span>
          ) : null}
          <h4 className="text-heading truncate font-semibold">{title}</h4>
        </div>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

/** Centered message for a section with nothing in the selected range. */
export function ReportEmpty({ children }) {
  return <p className="text-muted px-2 py-8 text-center text-sm">{children}</p>
}
