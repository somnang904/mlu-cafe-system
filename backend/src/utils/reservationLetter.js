const { STORE } = require('../config/store')
const { sendMail } = require('./mailer')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LETTER_BG = '#B8977E'
const LETTER_GREEN = '#2D5A43'
const LETTER_LABEL = '#9A9A9A'
const LETTER_TEXT = '#1A1A1A'

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatLetterDate(iso) {
  const raw = String(iso || '').slice(0, 10)
  const [year, month, day] = raw.split('-').map(Number)
  if (!year || !month || !day) return raw || '—'
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatLetterTime(reservation) {
  const label = String(reservation?.time_slot_label || '').trim()
  if (label) return label
  return String(reservation?.time_slot || '—')
}

function formatLetterService(reservation) {
  const tableName = String(reservation?.table_name || 'Table').trim()
  const guests = Number(reservation?.guest_count) || 1
  const guestWord = guests === 1 ? 'guest' : 'guests'
  return `${tableName} for ${guests} ${guestWord}`
}

function contactTelHref(phone = STORE.phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits ? `tel:${digits}` : 'tel:'
}

function buildLetterWording(reservation) {
  if (String(reservation?.status) === 'Pending') {
    return {
      heading: 'Booking Received',
      intro: 'Your booking request has been received and is awaiting confirmation. We will be in touch shortly.',
      subjectPrefix: 'Booking received',
    }
  }
  return {
    heading: 'Booking Confirmed!',
    intro: 'Your appointment has been successfully scheduled. We look forward to seeing you!',
    subjectPrefix: 'Booking confirmed',
  }
}

function buildLetterFields(reservation) {
  return {
    ...buildLetterWording(reservation),
    guestName: String(reservation?.customer_name || 'Guest').trim(),
    dateLabel: formatLetterDate(reservation?.reservation_date),
    timeLabel: formatLetterTime(reservation),
    serviceLabel: formatLetterService(reservation),
    businessName: STORE.officialName,
    contactLabel: 'Contact Us',
    phoneLabel: STORE.phone,
    phoneHref: contactTelHref(STORE.phone),
    location: STORE.location,
  }
}

function isValidLetterEmail(value) {
  return EMAIL_RE.test(String(value || '').trim())
}

function buildLetterText(reservation) {
  const letter = buildLetterFields(reservation)
  return [
    letter.heading,
    '',
    letter.intro,
    '',
    `Prepared for: ${letter.guestName}`,
    `Date: ${letter.dateLabel}`,
    `Time: ${letter.timeLabel}`,
    `Service: ${letter.serviceLabel}`,
    '',
    letter.phoneLabel,
    letter.businessName,
    letter.location,
  ].join('\n')
}

function buildLetterEmailHtml(reservation) {
  const letter = buildLetterFields(reservation)
  const row = (label, value) => `
    <tr>
      <td align="center" style="padding:0 24px 22px 24px;">
        <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.02em;color:${LETTER_LABEL};">${escapeHtml(label)}</p>
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:600;color:${LETTER_TEXT};">${escapeHtml(value)}</p>
      </td>
    </tr>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(letter.heading.replace(/!$/, ''))}</title>
</head>
<body style="margin:0;padding:0;background:${LETTER_BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${LETTER_BG};">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="380" cellpadding="0" cellspacing="0" style="width:380px;max-width:100%;background:#ffffff;border-radius:28px;">
          <tr>
            <td align="center" style="padding:36px 24px 8px 24px;">
              <div style="width:48px;height:48px;border-radius:24px;background:${LETTER_GREEN};line-height:48px;color:#ffffff;font-size:22px;font-family:Arial,Helvetica,sans-serif;">&#10003;</div>
              <h1 style="margin:18px 0 8px 0;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:${LETTER_TEXT};">${escapeHtml(letter.heading)}</h1>
              <p style="margin:0 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#8A8A8A;">${escapeHtml(letter.intro)}</p>
              <p style="margin:10px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#A3A3A3;">Prepared for ${escapeHtml(letter.guestName)}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 48px 8px 48px;">
              <div style="height:1px;background:#E6E6E6;line-height:1px;">&nbsp;</div>
            </td>
          </tr>
          ${row('Date', letter.dateLabel)}
          ${row('Time', letter.timeLabel)}
          ${row('Service', letter.serviceLabel)}
          <tr>
            <td align="center" style="padding:4px 40px 20px 40px;">
              <a href="${escapeHtml(letter.phoneHref)}" style="display:inline-block;min-width:220px;padding:12px 28px;border-radius:999px;background:${LETTER_GREEN};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(letter.contactLabel)}</a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 24px 32px 24px;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${LETTER_LABEL};">${escapeHtml(letter.businessName)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

async function sendReservationConfirmationLetter({ reservation, to }) {
  const email = String(to || '').trim()
  if (!isValidLetterEmail(email)) {
    const error = new Error('Please enter a valid email address')
    error.status = 400
    throw error
  }
  if (!reservation) {
    const error = new Error('Reservation not found')
    error.status = 404
    throw error
  }
  if (['Canceled', 'No-show'].includes(String(reservation.status))) {
    const error = new Error('Cannot send a confirmation letter for a canceled booking')
    error.status = 400
    throw error
  }

  const letter = buildLetterFields(reservation)
  const subject = `${letter.subjectPrefix} — ${letter.businessName} (${letter.dateLabel})`
  return sendMail({
    to: email,
    subject,
    text: buildLetterText(reservation),
    html: buildLetterEmailHtml(reservation),
  })
}

module.exports = {
  buildLetterFields,
  buildLetterText,
  buildLetterEmailHtml,
  isValidLetterEmail,
  sendReservationConfirmationLetter,
}
