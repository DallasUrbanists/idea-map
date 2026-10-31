import { expect, test } from '@playwright/test'

test('modal is named, traps focus, closes on Escape and restores the trigger', async ({ page }) => {
  await page.goto('/tests/dialog/')
  const trigger = page.getByRole('button', { name: 'Open dialog' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Review idea' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAccessibleDescription('Check the details before continuing.')
  await dialog.getByRole('button', { name: 'Close' }).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'First action' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('dialog remains within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 })
  await page.goto('/tests/dialog/')
  await page.getByRole('button', { name: 'Open dialog' }).click()
  const bounds = await page.getByRole('dialog').boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
