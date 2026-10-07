import { useEffect, useState } from 'react'
import { Check, Download, Mail, Phone, ScrollText } from 'lucide-react'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'
import { useNotifications } from '../../context/NotificationContext'
import { apiFetch } from '../../services/apiClient'
import FieldLabel from '../ui/FieldLabel'
import ModalHeader from '../ui/ModalHeader'
import {
  buildLetterFields,
  LETTER_COLORS,
  printConfirmationLetter,
} from '../../utils/reservationLetter'

export default function ConfirmationLetterModal({ isOpen, reservation, onClose }) {
  const panelRef = useModalKeyboard({ isOpen, onEscape: onClose, primaryActionMode: 'never' })
  const { pushBanner } = useNotifications()
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  useEffect(() => {
    if (!isOpen) return undefined
    setEmail('')
    setPhone(reservation?.phone || '')
    setSending(false)
    setSendError('')
    return undefined
  }, [isOpen, reservation?.id, reservation?.phone])

  if (!isOpen || !reservation) return null

  const letter = buildLetterFields(reservation)

  const handleDownload = () => {
    const method = printConfirmationLetter(reservation)
    if (method === 'download') {
      pushBanner({
        title: 'Letter downloaded',
        message: 'The print window was blocked, so an HTML copy was saved instead.',
      })
      return
    }
    pushBanner({
      title: 'Save as PDF',
      message: 'In the print dialog, choose Save as PDF to keep a copy for the guest.',
    })
  }

  const handleSend = async (event) => {
    event.preventDefault()
    setSending(true)
    setSendError('')
    try {
      const response = await apiFetch(`/reservations/${reservation.id}/confirmation-letter`, {
        method: 'POST',
        body: JSON.stringify({ email, phone: phone.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Failed to send the letter')
      pushBanner({
        title: data.delivered ? 'Letter sent' : 'Letter queued',
        message: data.delivered
          ? `Sent to ${email.trim()}.`
          : data.message || 'SMTP is not configured, so the letter was written to the mail log.',
      })
      onClose()
    } catch (err) {
      setSendError(err.message || 'Failed to send the letter')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="modal-backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel relative z-10 w-full max-w-[26rem]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-letter-title"
      >
        <div className="modal-panel-body p-5">
          <div className="mb-4">
            <ModalHeader
              icon={ScrollText}
              title="Confirmation letter"
              subtitle="Optional copy for the guest. Download a PDF or send it by email when they ask."
              titleId="confirmation-letter-title"
              onClose={onClose}
            />
          </div>

          <div
            className="overflow-hidden rounded-[1.6rem] px-4 py-7"
            style={{
              background: `radial-gradient(circle at -8% -12%, rgba(90,60,40,0.18) 0 120px, transparent 121px), radial-gradient(circle at 112% 118%, rgba(90,60,40,0.16) 0 140px, transparent 141px), ${LETTER_COLORS.background}`,
            }}
          >
            <article className="rounded-[1.75rem] bg-white px-6 py-8 text-center shadow-lg">
              <div
                className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-white"
                style={{ background: LETTER_COLORS.green }}
                aria-hidden
              >
                <Check className="h-6 w-6" strokeWidth={3} />
              </div>
              <h2
                className="mt-5 text-[1.65rem] leading-tight"
                style={{ fontFamily: 'Georgia, "Times New Roman", serif', color: LETTER_COLORS.text }}
              >
                Booking Confirmed!
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-neutral-500">
                Your appointment has been successfully scheduled. We look forward to seeing you!
              </p>
              <p className="mt-1 text-[12px] text-neutral-400">Prepared for {letter.guestName}</p>
              <div className="mx-auto mt-5 h-px w-[78%] bg-neutral-200" />
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-[11px]" style={{ color: LETTER_COLORS.label }}>
                    Date
                  </p>
                  <p className="mt-0.5 text-base font-semibold" style={{ color: LETTER_COLORS.text }}>
                    {letter.dateLabel}
                  </p>
                </div>
                <div>
                  <p className="text-[11px]" style={{ color: LETTER_COLORS.label }}>
                    Time
                  </p>
                  <p className="mt-0.5 text-base font-semibold" style={{ color: LETTER_COLORS.text }}>
                    {letter.timeLabel}
                  </p>
                </div>
                <div>
                  <p className="text-[11px]" style={{ color: LETTER_COLORS.label }}>
                    Service
                  </p>
                  <p className="mt-0.5 text-base font-semibold" style={{ color: LETTER_COLORS.text }}>
                    {letter.serviceLabel}
                  </p>
                </div>
              </div>
              <a
                href={letter.phoneHref}
                className="mt-6 inline-flex min-w-[14rem] items-center justify-center rounded-full px-6 py-2.5 text-sm font-semibold text-white"
                style={{ background: LETTER_COLORS.green }}
              >
                {letter.contactLabel}
              </a>
              <p
                className="mt-5 text-[11px] uppercase tracking-[0.16em]"
                style={{ color: LETTER_COLORS.label }}
              >
                {letter.businessName}
              </p>
            </article>
          </div>

          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={handleDownload}
              className="btn-secondary flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm"
            >
              <Download className="h-4 w-4" />
              Download letter
            </button>

            <form className="space-y-2" onSubmit={handleSend}>
              <div>
                <FieldLabel icon={Mail} htmlFor="letter-email">
                  Send to customer email
                </FieldLabel>
                <input
                  id="letter-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="input-field px-3 py-2 text-sm"
                  placeholder="guest@email.com"
                />
              </div>
              <div>
                <FieldLabel icon={Phone} htmlFor="letter-phone">
                  Customer phone (optional)
                </FieldLabel>
                <input
                  id="letter-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="input-field px-3 py-2 text-sm"
                  placeholder="099 333 225"
                />
              </div>
              {sendError ? <p className="text-sm text-red-600 dark:text-red-400">{sendError}</p> : null}
              <button
                type="submit"
                disabled={sending}
                className={`btn-primary flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
                  sending ? '' : 'beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)]'
                }`}
              >
                <Mail className="h-4 w-4" />
                {sending ? 'Sending…' : 'Send letter'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
