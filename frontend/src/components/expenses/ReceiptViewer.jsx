import { useTranslation } from 'react-i18next'
import { Paperclip } from 'lucide-react'
import Modal from '../common/Modal'
import ModalHeader from '../ui/ModalHeader'
import ReceiptImage from './ReceiptImage'

/** Full-size receipt photo for one expense. */
export default function ReceiptViewer({ expense, title, onClose }) {
  const { t } = useTranslation()
  return (
    <Modal
      title={t('expenses.receiptTitle')}
      titleId="receipt-viewer-title"
      header={<ModalHeader icon={Paperclip} titleId="receipt-viewer-title" title={t('expenses.receiptTitle')} />}
      onClose={onClose}
      closeLabel={t('a11y.closeModal')}
      maxWidth="max-w-2xl"
      footer={(
        <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2.5 text-sm">
          {t('common.close')}
        </button>
      )}
    >
      <p className="text-muted mb-3 text-sm">{title}</p>
      <ReceiptImage
        url={expense.receipt_url}
        alt={t('expenses.receiptAlt', { title })}
        className="mx-auto max-h-[65vh] w-full rounded-xl object-contain"
      />
    </Modal>
  )
}
