import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import StocktakeModal from '../components/inventory/StocktakeModal'
import { useAuth } from '../context/AuthContext'
import { userHasPermission } from '../utils/permissions'
import { apiFetch } from '../services/apiClient'
import { cacheInventoryItems, getInventoryFallback } from '../utils/offlineFallbacks'

export default function InventoryStock({ onNavigate }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const canManageItems = userHasPermission(user, 'inventory_stock')
  const [items, setItems] = useState([])
  const [usingFallbackInventory, setUsingFallbackInventory] = useState(false)
  const backToItems = () => onNavigate?.('inventory')

  const fetchInventory = useCallback(async () => {
    try {
      const response = await apiFetch('/inventory')
      if (!response.ok) {
        throw new Error(`Server status returned ${response.status}`)
      }
      const data = await response.json()
      const nextItems = Array.isArray(data) ? data : data.items || []
      if (nextItems.length === 0) {
        setItems(getInventoryFallback())
        setUsingFallbackInventory(true)
        return
      }
      cacheInventoryItems(nextItems)
      setItems(nextItems)
      setUsingFallbackInventory(false)
    } catch (error) {
      console.error('Error loading inventory layout:', error)
      setItems(getInventoryFallback())
      setUsingFallbackInventory(true)
    }
  }, [])

  useEffect(() => {
    fetchInventory()
  }, [fetchInventory])

  return (
    <div className="space-y-6 pt-2">
      {usingFallbackInventory && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200">
          {t('inventory.offlineData')}
        </div>
      )}
      {canManageItems ? (
        <StocktakeModal items={items} onClose={backToItems} onApplied={fetchInventory} />
      ) : null}
    </div>
  )
}
