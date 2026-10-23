import { test, expect } from '@playwright/test'

// Optional: set E2E_USERNAME / E2E_PASSWORD (a test account on a TEST database) to run the signed-in checks.
const USERNAME = process.env.E2E_USERNAME
const PASSWORD = process.env.E2E_PASSWORD

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  // Keep a permanent copy of every page for the report (test-results/ is wiped on each run).
  test.afterEach(async ({ page }, testInfo) => {
    const name = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true })
  })

  test('shows the username, password fields and login button', async ({ page }) => {
    await expect(page.locator('#login-username')).toBeVisible()
    await expect(page.locator('#login-password')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('password field is hidden by default and can be revealed', async ({ page }) => {
    const password = page.locator('#login-password')
    await expect(password).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(password).toHaveAttribute('type', 'text')
  })

  test('rejects an unknown account with an error message', async ({ page }) => {
    await page.locator('#login-username').fill('no-such-user-e2e')
    await page.locator('#login-password').fill('wrong-password-123')
    await page.locator('button[type="submit"]').click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.locator('#login-username')).toBeVisible()
  })

  test('cannot open a protected API route without a token', async ({ request }) => {
    const res = await request.get('/api/users')
    expect(res.status()).toBe(401)
  })
})

test.describe('Signed-in flow', () => {
  test.skip(!USERNAME || !PASSWORD, 'Set E2E_USERNAME and E2E_PASSWORD to run')

  test('valid login leaves the login page', async ({ page }) => {
    await page.goto('/')
    await page.locator('#login-username').fill(USERNAME)
    await page.locator('#login-password').fill(PASSWORD)
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('#login-username')).toBeHidden({ timeout: 15_000 })
  })
})
