// Expense categories live in the expense_categories table (GET /expense-categories).
// The defaults (and names used before that table existed) get a translated label; any other
// category shows its stored name.
const EXPENSE_CATEGORY_KEYS = {
  Ingredients: 'ingredients',
  Salary: 'salary',
  Rent: 'rent',
  Utilities: 'utilities',
  Marketing: 'marketing',
  Maintenance: 'maintenance',
  Other: 'other',
  Others: 'other',
  Transport: 'transport',
  Supplies: 'supplies',
  'Inventory Restock': 'inventoryRestock',
  Payroll: 'staffPayroll',
  'Staff / Payroll': 'staffPayroll',
}

export function expenseCategoryLabel(category, t) {
  const key = EXPENSE_CATEGORY_KEYS[category]
  return key ? t(`expenses.categories.${key}`) : category
}

// Category colors are Tailwind palette names stored on the category; full class names here so
// Tailwind keeps them in the build.
const COLOR_CLASSES = {
  forest: 'bg-forest-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  teal: 'bg-teal-500',
  slate: 'bg-slate-400',
  orange: 'bg-orange-500',
  cyan: 'bg-cyan-500',
  lime: 'bg-lime-500',
  fuchsia: 'bg-fuchsia-500',
  indigo: 'bg-indigo-500',
  stone: 'bg-stone-400',
}

export function categoryColorClass(color) {
  return COLOR_CLASSES[color] || COLOR_CLASSES.slate
}

export const EXPENSE_METHODS = ['cash', 'aba_khqr', 'card', 'bank_transfer']
