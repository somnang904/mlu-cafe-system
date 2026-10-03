export const TAKEOUT_ID = 'takeout'

export const TAKEOUT_BILL = {
  id: TAKEOUT_ID,
  name: 'Take Out',
  isTakeOut: true,
  section: 'takeout',
  capacity: null,
  status: 'empty',
  orderTotal: null,
  orderSummary: null,
  items: [],
}

function emptyTable(id, name, section = 'standard', capacity = 4) {
  return {
    id,
    name,
    isTakeOut: false,
    section,
    capacity,
    status: 'empty',
    orderTotal: null,
    orderSummary: null,
    items: [],
  }
}

export const floorTables = [
  emptyTable(1, 'Table 1'),
  emptyTable(2, 'Table 2'),
  emptyTable(3, 'Table 3'),
  emptyTable(4, 'Table 4'),
  emptyTable(5, 'Table 5'),
  emptyTable(6, 'Table 6'),
  emptyTable(7, 'Table 7'),
  emptyTable(8, 'Table 8'),
  emptyTable(9, 'VIP Room 1', 'vip', 12),
  emptyTable(10, 'VIP Room 2', 'vip', 12),
]

export const TABLE_STATUS_META = {
  empty: {
    label: 'Empty',
    labelKey: 'statuses.empty',
    badge:
      'bg-emerald-50 text-emerald-700 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-700/50',
    card: 'border-emerald-300/80 bg-emerald-50/30 dark:border-emerald-700/40 dark:bg-emerald-950/15',
  },
  occupied: {
    label: 'Occupied',
    labelKey: 'statuses.occupied',
    badge:
      'bg-amber-50 text-amber-800 ring-amber-300/80 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-700/50',
    card: 'border-amber-300/70 bg-amber-50/35 dark:border-amber-700/40 dark:bg-amber-950/20',
  },
  reserved: {
    label: 'Reserved',
    labelKey: 'statuses.reserved',
    badge:
      'bg-violet-50 text-violet-800 ring-violet-300/80 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-700/50',
    card: 'border-violet-300/80 bg-violet-50/40 dark:border-violet-700/40 dark:bg-violet-950/20',
  },
  paid: {
    label: 'Paid',
    labelKey: 'statuses.paid',
    badge:
      'bg-teal-50 text-teal-800 ring-teal-300/80 dark:bg-teal-950/40 dark:text-teal-200 dark:ring-teal-700/50',
    card: 'border-teal-300/80 bg-teal-50/35 dark:border-teal-700/40 dark:bg-teal-950/20',
  },
}

/** Cashier queue badge — all open unbilled orders display as awaiting checkout */
export const PAYMENT_QUEUE_STATUS = {
  label: 'Pending Bill',
  labelKey: 'statuses.pendingBill',
  badge:
    'bg-orange-100 text-orange-900 ring-orange-400/80 dark:bg-orange-950/45 dark:text-orange-200 dark:ring-orange-600/50',
}

export const FLOOR_STATUS_KEYS = ['empty', 'occupied', 'paid', 'reserved']

export function getFloorTableLabel(tableId) {
  if (tableId === 'takeout') return 'Take Out'
  if (tableId == null || tableId === '') return 'Table'
  const table = floorTables.find((entry) => String(entry.id) === String(tableId))
  return table?.name || `Table ${tableId}`
}
