require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const db = require('../db')

async function main() {
  console.log('--- Cleaning Sales & Orders History ---')
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [resItems] = await conn.query('DELETE FROM order_items')
    console.log(`✔ Deleted ${resItems.affectedRows || 0} order items.`)
    const [resOrders] = await conn.query('DELETE FROM orders')
    console.log(`✔ Deleted ${resOrders.affectedRows || 0} orders.`)
    try {
      await conn.query('ALTER TABLE orders AUTO_INCREMENT = 1')
      await conn.query('ALTER TABLE order_items AUTO_INCREMENT = 1')
    } catch {}
    try {
      const [resTables] = await conn.query("UPDATE tables SET status = 'available'")
      console.log(`✔ Reset ${resTables.affectedRows || 0} tables to available.`)
    } catch {}
    await conn.commit()
    console.log('\n✅ Successfully wiped all sales and orders data!')
    console.log('Orders: 0 | Sales Revenue: $0.00 (Clean state)\n')
  } catch (error) {
    await conn.rollback()
    console.error('❌ Failed to wipe orders:', error.message)
    process.exit(1)
  } finally {
    conn.release()
    process.exit(0)
  }
}
main()
