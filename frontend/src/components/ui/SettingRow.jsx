/** One labelled card with a control on the right, used by the settings pages. */
export default function SettingRow({ icon: Icon, label, description, children }) {
  return (
    <div className="surface-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-forest-50 text-forest-600 ring-1 ring-forest-100 dark:bg-forest-950/40 dark:text-forest-300 dark:ring-forest-800">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-heading font-semibold">{label}</p>
          {description ? <p className="text-muted mt-1 text-sm">{description}</p> : null}
        </div>
      </div>
      {children}
    </div>
  )
}
