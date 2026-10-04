// Stored category values (sent to the API) in the order they are offered.
// The backend accepts any non-empty category, so this list is the single source of choices.
export const EXPENSE_CATEGORIES = [
  'Inventory Restock',
  'Utilities',
  'Transport',
  'Supplies',
  'Payroll',
  'Others',
]

const EXPENSE_CATEGORY_KEYS = {
  'Inventory Restock': 'inventoryRestock',
  Utilities: 'utilities',
  Transport: 'transport',
  Supplies: 'supplies',
  Payroll: 'staffPayroll',
  'Staff / Payroll': 'staffPayroll',
  Others: 'other',
  Other: 'other',
}

export function expenseCategoryLabel(category, t) {
  const key = EXPENSE_CATEGORY_KEYS[category]
  return key ? t(`expenses.categories.${key}`) : category
}
