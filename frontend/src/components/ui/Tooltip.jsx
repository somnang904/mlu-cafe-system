const PLACEMENT = {
  top: {
    bubble:
      'bottom-full left-1/2 mb-2 -translate-x-1/2 translate-y-1 group-hover/tip:translate-y-0 group-focus-within/tip:translate-y-0',
    arrow: 'left-1/2 top-full -mt-1 -translate-x-1/2',
  },
  left: {
    bubble:
      'right-full top-1/2 mr-2 -translate-y-1/2 translate-x-1 group-hover/tip:translate-x-0 group-focus-within/tip:translate-x-0',
    arrow: 'left-full top-1/2 -ml-1 -translate-y-1/2',
  },
}

export default function Tooltip({ label, children, className = '', side = 'top' }) {
  const placement = PLACEMENT[side] || PLACEMENT.top
  return (
    <span className={`group/tip relative inline-flex ${className}`.trim()}>
      {children}
      {label ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute z-30 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition duration-150 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100 group-hover/tip:delay-200 dark:bg-zinc-100 dark:text-zinc-900 ${placement.bubble}`}
        >
          {label}
          <span className={`absolute h-2 w-2 rotate-45 bg-slate-900 dark:bg-zinc-100 ${placement.arrow}`} />
        </span>
      ) : null}
    </span>
  )
}
