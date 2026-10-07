const { ensureOrderItemsSchema } = require('./orderTargets')
const { ensureSessionSecuritySchema } = require('./sessionSecurity')
const { ensureMenuItemsSchema } = require('./menuItemsSchema')
const { ensureInventorySchema } = require('./inventorySchema')
const { ensureStockSchema } = require('./stockSchema')
const { archiveNonDirectInventory } = require('./menuStockSimple')
const { ensureOrdersSchema } = require('./ordersSchema')
const { ensureExpensesSchema } = require('./expenses')
const { ensureAuditSchema } = require('./auditLog')
const { ensureUsersEmailColumn, migrateStaffUsersToCashier } = require('./userAccounts')
const { ensureAdminNotificationsSchema } = require('./adminNotifications')
const { ensureReservationsSchema } = require('./reservations')
const { ensureAppSettingsSchema } = require('./appSettings')
const { ensureLoginSecuritySchema } = require('./loginSecurity')
const { ensureShiftsSchema } = require('./shifts')

async function ensureApplicationSchema(db) {
  await ensureInventorySchema(db)
  await ensureStockSchema(db)
  await archiveNonDirectInventory(db)
  const restoredSaleDates = await ensureOrdersSchema(db)
  await ensureOrderItemsSchema(db)
  await ensureMenuItemsSchema(db)
  await ensureExpensesSchema(db)
  await ensureAuditSchema(db)
  await ensureUsersEmailColumn(db)
  await migrateStaffUsersToCashier(db)
  await ensureAdminNotificationsSchema(db)
  await ensureReservationsSchema(db)
  await ensureAppSettingsSchema(db)
  await ensureLoginSecuritySchema(db)
  await ensureSessionSecuritySchema(db)
  await ensureShiftsSchema(db)
  return restoredSaleDates
}

module.exports = {
  ensureApplicationSchema,
}
