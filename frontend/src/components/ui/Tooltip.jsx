export default function Tooltip({ label, children, className = '' }) {
  return (
    <span className={`group/tip relative inline-flex ${className}`.trim()}>
      {children}
      {label ? (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition duration-150 group-focus-within/tip:translate-y-0 group-focus-within/tip:opacity-100 group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-hover/tip:delay-200 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {label}
          <span className="absolute left-1/2 top-full -mt-1 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900 dark:bg-zinc-100" />
        </span>
      ) : null}
    </span>
  )
}
