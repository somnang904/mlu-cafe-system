import { parseOptionalPrice } from './drinkOptions'

export const SUGAR_LEVELS = [
  { value: '0%', label: '0%' },
  { value: '25%', label: '25%' },
  { value: '50%', label: '50%' },
  { value: '75%', label: '75%' },
  { value: '100%', label: '100%' },
  { value: '120%', label: '120% / Extra Sweet' },
]

export const DEFAULT_SUGAR_LEVEL = '100%'

const NON_DRINK_CATEGORIES = new Set([
  'food',
  'bakery',
  'starters',
  'mains',
  'soup',
  'vegetable',
  'dessert',
  'desserts',
  'cocktails',
  'cocktail',
  'pastry',
  'snack',
  'snacks',
  'beer',
  'beers',
])

/**
 * Sugar % for iced / cold drinks, shakes, mixed drinks, and iced tea.
 * Hot coffee uses sugar packets — no sugar level prompt.
 * Iced coffee asks for sugar %. Hot tea (honey/lemon/selection) skips sugar; iced tea asks for it.
 */
export function needsSugarLevel(item, serving = null) {
  const category = String(item?.category || '').trim().toLowerCase()
  const name = String(item?.name || '').trim().toLowerCase()
  if (!category && !name) return false
  if (NON_DRINK_CATEGORIES.has(category)) return false
  if (category.includes('cocktail')) return false

  // Coffee: hot uses sugar packets on the side; iced asks for a sugar %.
  if (category === 'coffee') {
    return serving === 'iced'
  }

  if (/\b(shake|smoothie|frappe)\b/i.test(name) || /\b(shake|shakes|smoothie|smoothies)\b/i.test(category)) {
    return true
  }
  if (/\bmixed\b/i.test(name) && /\b(drink|juice)\b/i.test(name)) return true
  if (category === 'iced drinks') return true

  if (category === 'cold drinks' || category === 'cold drink') {
    if (/water|tonic|ginger\s*ale/i.test(name)) return false
    // Fresh fruit juices are 100% fruit — no sugar level.
    if (/fresh\s+(lime|pineapple|watermelon|mango|coconut)/i.test(name)) return false
    const hot = parseOptionalPrice(item?.hot_price)
    const iced = parseOptionalPrice(item?.iced_price)
    // Dual Hot/Ice juice drinks (e.g. Matcha): sugar only for Ice, like coffee.
    if (hot != null && iced != null) return serving === 'iced'
    return true
  }

  if (category === 'tea') {
    const hot = parseOptionalPrice(item?.hot_price)
    const iced = parseOptionalPrice(item?.iced_price)
    // Iced-only tea (milk teas / syrup) — always ask sugar.
    if (iced != null && hot == null) return true
    // Dual hot/iced tea — sugar only when iced is chosen.
    if (serving === 'iced' && iced != null) return true
    return false
  }

  return false
}

export function formatDrinkNotes({ serving, sugarLevel, extraNotes = '', teaFlavor = '' } = {}) {
  const parts = []
  if (serving === 'iced') parts.push('Iced')
  else if (serving === 'hot') parts.push('Hot')
  const flavor = String(teaFlavor || '').trim()
  if (flavor) parts.push(flavor)
  const level = sugarLevel == null ? '' : String(sugarLevel).trim()
  if (level) parts.push(`Sugar: ${level}`)
  const extra = String(extraNotes || '').trim()
  if (extra) parts.push(extra)
  return parts.join(' · ')
}

export function formatItemDisplayName(baseName, notes) {
  const name = String(baseName || '').trim() || 'Item'
  const note = String(notes || '').trim()
  if (!note) return name
  if (name.includes(`(${note})`) || /\(\s*Sugar:/i.test(name)) return name
  return `${name} (${note})`
}

export function lineIdentity(item) {
  const menuId = item?.menu_item_id ?? item?.id
  const notes = String(item?.notes || '').trim()
  return `${menuId}::${notes}`
}
