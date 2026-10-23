import { test, expect } from '@playwright/test'

// Needs a TEST account (ideally Admin so every menu item is visible) on a TEST database:
//   $env:E2E_USERNAME="..."; $env:E2E_PASSWORD="..."
const USERNAME = process.env.E2E_USERNAME
const PASSWORD = process.env.E2E_PASSWORD

// Labels as shown in the English sidebar.
const PAGES = ['Dashboard', 'Order', 'Table', 'Payment', 'Reservations', 'Sales', 'Menu', 'Expenses', 'Reports', 'Users']

test.describe('Sidebar navigation', () => {
  test.skip(!USERNAME || !PASSWORD, 'Set E2E_USERNAME and E2E_PASSWORD to run')

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.locator('#login-username').fill(USERNAME)
    await page.locator('#login-password').fill(PASSWORD)
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
  })

  for (const label of PAGES) {
    test(`opens "${label}" and highlights it`, async ({ page }) => {
      const item = page.locator('nav').getByRole('button', { name: label, exact: true })
      await item.click()
      await expect(item).toHaveAttribute('aria-current', 'page')
      await page.screenshot({ path: `screenshots/sidebar-${label.toLowerCase()}.png`, fullPage: true })
    })
  }

  test('Stock group expands and shows its sub-items', async ({ page }) => {
    const stock = page.locator('nav').getByRole('button', { name: 'Stock', exact: true })
    await stock.click()
    await expect(stock).toHaveAttribute('aria-expanded', 'true')
    await page.screenshot({ path: 'screenshots/sidebar-stock-expanded.png', fullPage: true })
  })

  test('Settings group expands and shows its sub-items', async ({ page }) => {
    const settings = page.locator('nav').getByRole('button', { name: 'Settings', exact: true })
    await settings.click()
    await expect(settings).toHaveAttribute('aria-expanded', 'true')
    await page.screenshot({ path: 'screenshots/sidebar-settings-expanded.png', fullPage: true })
  })
})
