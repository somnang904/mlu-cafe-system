import STORE from '../config/store'
import { slotLabel } from '../data/reservations'

const LETTER_BG = '#B8977E'
const LETTER_GREEN = '#2D5A43'
const LETTER_LABEL = '#9A9A9A'
const LETTER_TEXT = '#1A1A1A'

export const LETTER_COLORS = {
  background: LETTER_BG,
  green: LETTER_GREEN,
  label: LETTER_LABEL,
  text: LETTER_TEXT,
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatLetterDate(iso) {
  const raw = String(iso || '').slice(0, 10)
  const [year, month, day] = raw.split('-').map(Number)
  if (!year || !month || !day) return raw || '—'
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatLetterService(reservation) {
  const tableName = String(reservation?.table_name || 'Table').trim()
  const guests = Number(reservation?.guest_count) || 1
  const guestWord = guests === 1 ? 'guest' : 'guests'
  return `${tableName} for ${guests} ${guestWord}`
}

export function contactTelHref(phone = STORE.phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits ? `tel:${digits}` : 'tel:'
}

function buildLetterWording(reservation) {
  if (String(reservation?.status) === 'Pending') {
    return {
      heading: 'Booking Received',
      intro: 'Your booking request has been received and is awaiting confirmation. We will be in touch shortly.',
    }
  }
  return {
    heading: 'Booking Confirmed!',
    intro: 'Your appointment has been successfully scheduled. We look forward to seeing you!',
  }
}

export function buildLetterFields(reservation) {
  return {
    ...buildLetterWording(reservation),
    guestName: String(reservation?.customer_name || 'Guest').trim(),
    dateLabel: formatLetterDate(reservation?.reservation_date),
    timeLabel: slotLabel(
      reservation?.time_slot,
      reservation?.time_slot_label,
      reservation?.duration_minutes,
    ),
    serviceLabel: formatLetterService(reservation),
    businessName: STORE.officialName,
    contactLabel: 'Contact Us',
    phoneLabel: STORE.phone,
    phoneHref: contactTelHref(STORE.phone),
    location: STORE.location,
  }
}

export function letterFileName(reservation) {
  const name = String(reservation?.customer_name || 'guest')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const date = String(reservation?.reservation_date || 'booking').slice(0, 10)
  return `Mlu-booking-confirmation-${name || 'guest'}-${date}.html`
}

export function canIssueConfirmationLetter(reservation) {
  if (!reservation?.id) return false
  return reservation.status !== 'Canceled' && reservation.status !== 'No-show'
}

function buildPrintableLetterHtml(reservation) {
  const letter = buildLetterFields(reservation)
  const row = (label, value) => `
    <div class="detail">
      <p class="label">${escapeHtml(label)}</p>
      <p class="value">${escapeHtml(value)}</p>
    </div>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(letter.heading.replace(/!$/, ''))} —${escapeHtml(letter.businessName)}</title>
  <style>
    @page { size: A5 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      min-height: 100%;
      background: ${LETTER_BG};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 28px 16px 40px;
      background:
        radial-gradient(circle at -8% -12%, rgba(90, 60, 40, 0.18) 0 160px, transparent 161px),
        radial-gradient(circle at 112% 118%, rgba(90, 60, 40, 0.16) 0 180px, transparent 181px),
        ${LETTER_BG};
      font-family: Arial, Helvetica, sans-serif;
    }
    .hint {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2;
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(255,255,255,0.92);
      color: #444;
      font-size: 12px;
    }
    .card {
      width: 380px;
      max-width: 100%;
      background: #fff;
      border-radius: 32px;
      padding: 42px 28px 32px;
      text-align: center;
      box-shadow: 0 18px 40px rgba(70, 40, 20, 0.18);
    }
    .check {
      width: 52px;
      height: 52px;
      margin: 0 auto;
      border-radius: 50%;
      background: ${LETTER_GREEN};
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .check svg { width: 26px; height: 26px; }
    h1 {
      margin: 20px 0 10px;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 30px;
      font-weight: 700;
      color: ${LETTER_TEXT};
    }
    .sub {
      margin: 0 8px;
      font-size: 13px;
      line-height: 1.5;
      color: #8A8A8A;
    }
    .guest {
      margin: 10px 0 0;
      font-size: 12px;
      color: #A3A3A3;
    }
    .rule {
      width: 78%;
      height: 1px;
      margin: 22px auto 6px;
      background: #E6E6E6;
    }
    .detail { padding: 16px 0 4px; }
    .label {
      margin: 0 0 4px;
      font-size: 11px;
      color: ${LETTER_LABEL};
    }
    .value {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: ${LETTER_TEXT};
    }
    .contact {
      display: inline-block;
      margin-top: 18px;
      min-width: 230px;
      padding: 12px 28px;
      border-radius: 999px;
      background: ${LETTER_GREEN};
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
    }
    .biz {
      margin: 22px 0 0;
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: ${LETTER_LABEL};
    }
    @media print {
      .hint { display: none !important; }
      body { padding: 24px 12px; }
      .card { box-shadow: none; }
    }
  </style>
</head>
<body>
  <p class="hint">Choose Save as PDF in the print dialog, then close this window.</p>
  <article class="card">
    <div class="check" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12.5 9.5 17 19 7" />
      </svg>
    </div>
    <h1>${escapeHtml(letter.heading)}</h1>
    <p class="sub">${escapeHtml(letter.intro)}</p>
    <p class="guest">Prepared for ${escapeHtml(letter.guestName)}</p>
    <div class="rule"></div>
    ${row('Date', letter.dateLabel)}
    ${row('Time', letter.timeLabel)}
    ${row('Service', letter.serviceLabel)}
    <a class="contact" href="${escapeHtml(letter.phoneHref)}">${escapeHtml(letter.contactLabel)}</a>
    <p class="biz">${escapeHtml(letter.businessName)}</p>
  </article>
  <script>
    window.addEventListener('load', function () {
      window.focus();
      window.print();
    });
  </script>
</body>
</html>`
}

export function downloadConfirmationLetter(reservation) {
  const html = buildPrintableLetterHtml(reservation)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = letterFileName(reservation)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function printConfirmationLetter(reservation) {
  const html = buildPrintableLetterHtml(reservation)
  const win = window.open('', '_blank', 'width=520,height=780')
  if (!win) {
    downloadConfirmationLetter(reservation)
    return 'download'
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  return 'print'
}
