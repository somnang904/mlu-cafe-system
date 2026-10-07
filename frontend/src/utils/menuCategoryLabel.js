// Display name for a menu category key: a label the Menu page gave it, else the built-in
// translation, else the stored name itself (categories added from the Menu page).
const BUILT_IN_KEYS = {
  Coffee: 'coffee',
  Tea: 'tea',
  'Cold Drinks': 'coldDrinks',
  Beer: 'beer',
  Starters: 'starters',
  Mains: 'mains',
  Soup: 'soup',
  Vegetable: 'vegetable',
  Dessert: 'dessert',
}

export function menuCategoryLabel(category, t, labels = {}) {
  if (!category) return t('reports.uncategorized')
  if (labels[category]) return labels[category]
  const key = BUILT_IN_KEYS[category]
  return key ? t(`menuAdmin.categories.${key}`) : category
}
