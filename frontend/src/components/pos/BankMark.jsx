import { Landmark } from 'lucide-react'

/**
 * A bank's logo when one is set, otherwise initials on a colour. The logos are app icons
 * saved as JPEG, so their corners are white; the rounded clip hides those.
 */
export default function BankMark({ bank, size = 'h-10 w-10' }) {
  if (bank.logo) {
    return (
      <img
        src={bank.logo}
        alt=""
        loading="lazy"
        className={`${size} shrink-0 rounded-[22%] object-cover`}
      />
    )
  }
  return (
    <span
      className={`${size} flex shrink-0 items-center justify-center rounded-[22%] text-xs font-bold text-white`}
      style={{ backgroundColor: bank.mark.color }}
      aria-hidden
    >
      {bank.mark.text ?? <Landmark className="h-4 w-4" />}
    </span>
  )
}
