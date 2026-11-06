import { test, expect } from '@playwright/test'
const story = (page, name = 'default') => page.goto(`/iframe.html?id=components-tray--${name}&viewMode=story&globals=theme:light`)
const position = (page, value) => expect(page.locator('.tray-layer')).toHaveAttribute('data-position', value)

async function drag(page, distance, slow = false, cancel = false) {
  const handle = page.locator('.tray-handle')
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + distance, { steps: 2 })
  if (slow) await page.waitForTimeout(200)
  if (cancel) await handle.dispatchEvent('pointercancel', { pointerId: 1, isPrimary: true, clientY: box.y + box.height / 2 + distance })
  await page.mouse.up()
}

test('nonmodal tray supports background and keyboard interaction without a focus trap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await story(page)
  await expect(page.getByRole('complementary', { name: 'Example tray' })).toBeVisible()
  await page.getByRole('button', { name: 'Interact with background' }).click()
  await expect(page.getByRole('status')).toHaveText('Background interactions: 1')
  await expect(page.locator('[aria-modal="true"], .dialog-overlay')).toHaveCount(0)
  const handle = page.locator('.tray-handle')
  const bounds = await handle.boundingBox(); expect(bounds.height).toBeGreaterThanOrEqual(44)
  await handle.focus(); await page.keyboard.press('End'); await position(page, 'max')
  await page.keyboard.press('ArrowDown'); await position(page, 'medium')
  await page.keyboard.press('Home'); await position(page, 'closed')
  await expect(page.locator('.tray-surface')).toHaveAttribute('inert', '')
  await page.keyboard.press('ArrowUp'); await position(page, 'medium')
})

test('wheel expansion, independent body scrolling, and top-of-body reduction coordinate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await story(page)
  const body = page.locator('.tray-body')
  await body.dispatchEvent('wheel', { deltaY: 100, cancelable: true }); await position(page, 'max')
  await body.evaluate(element => { element.scrollTop = 120 })
  await body.dispatchEvent('wheel', { deltaY: -100, cancelable: true }); await position(page, 'max')
  await body.evaluate(element => { element.scrollTop = 0 })
  await body.dispatchEvent('wheel', { deltaY: -100, cancelable: true }); await position(page, 'medium')
})

test('slow snaps and pointer cancellation do not produce accidental handle clicks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await story(page)
  await drag(page, 70, true); await position(page, 'medium')
  await page.waitForTimeout(450)
  await drag(page, 190, true); await position(page, 'closed')
  await page.getByRole('button', { name: 'Open tray', exact: true }).click(); await position(page, 'medium')
  await page.waitForTimeout(450)
  await drag(page, -100, true, true); await position(page, 'medium')
})

test('short and changing content avoids an empty maximum state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await story(page, 'short-content')
  await expect(page.locator('.tray-layer')).toHaveAttribute('data-scrollable', 'false')
  await expect(page.getByRole('button', { name: 'Expand tray', exact: true })).toHaveCount(0)
  const bounds = await page.locator('.tray-surface').boundingBox(); expect(bounds.height).toBeLessThan(320)
  await page.getByRole('button', { name: 'Add content' }).click()
  await expect(page.locator('.tray-layer')).toHaveAttribute('data-scrollable', 'true')
  await page.getByRole('button', { name: 'Expand tray', exact: true }).click(); await position(page, 'max')
  await page.getByRole('button', { name: 'Remove content' }).click()
  await expect(page.locator('.tray-layer')).toHaveAttribute('data-scrollable', 'false'); await position(page, 'medium')
})

test('busy, directional permissions, and reduced motion remain accessible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
  await story(page, 'busy')
  await expect(page.locator('.tray-handle')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Expand tray', exact: true })).toBeDisabled()
  await expect(page.locator('.tray-shell')).toHaveCSS('transition-property', 'none')
  await page.getByRole('button', { name: 'Interact with background' }).click()
  await expect(page.getByRole('status')).toHaveText('Background interactions: 1')
  await story(page, 'opening-disabled')
  await expect(page.getByRole('button', { name: 'Expand tray', exact: true })).toBeDisabled()
  await page.locator('.tray-handle').focus(); await page.keyboard.press('End'); await position(page, 'medium')
})
