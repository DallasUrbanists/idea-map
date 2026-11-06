import { test, expect } from '@playwright/test'

const liveUrl = process.env.STORYBOOK_LIVE_MAPS_TEST_URL

test('selected Google marker stays anchored throughout zoom', async ({ page }) => {
  test.skip(!liveUrl, 'Set STORYBOOK_LIVE_MAPS_TEST_URL to a configured local Storybook iframe.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(liveUrl)
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-map-status', 'ready', { timeout: 30000 })
  await page.getByRole('button', { name: 'Browse ideas' }).click()
  await page.locator('.idea-result').first().click()
  const marker = page.locator('gmp-advanced-marker[aria-label="A safer library crossing"]')
  await expect.poll(() => marker.evaluate(el => el.map.getZoom()), { timeout: 10000 }).toBe(20)
  await expect.poll(async () => {
    const a = await marker.boundingBox(); const tray = await page.locator('.tray-surface').boundingBox(); const search = await page.locator('.map-search').boundingBox()
    return a.x >= tray.x + tray.width && a.y >= search.y + search.height
  }, { timeout: 10000 }).toBe(true)
  await expect(marker.locator('gmp-pin')).toHaveCount(1)
  const result = await marker.evaluate(async selected => {
    const map = selected.map
    const reference = new selected.constructor({ map, position: selected.position })
    const zoom = map.getZoom()
    try {
      await new Promise(resolve => setTimeout(resolve, 250))
      const offsets = []
      const sample = () => {
        const actual = selected.getBoundingClientRect()
        const expected = reference.getBoundingClientRect()
        offsets.push(Math.hypot(actual.x + actual.width / 2 - expected.x - expected.width / 2, actual.bottom - expected.bottom))
      }
      for (const level of [zoom - 1, zoom]) {
        map.setZoom(level)
        const start = performance.now()
        await new Promise(resolve => {
          function frame(time) {
            sample()
            if (time - start < 800) requestAnimationFrame(frame)
            else resolve()
          }
          requestAnimationFrame(frame)
        })
      }
      return { samples: offsets.length, maxOffset: Math.max(...offsets), hostScale: getComputedStyle(selected).scale }
    } finally {
      reference.map = null
    }
  })
  expect(result.samples).toBeGreaterThan(10)
  expect(result.hostScale).toBe('none')
  expect(result.maxOffset).toBeLessThan(2)
})

test('Google Maps animates between idea selections', async ({ page }) => {
  test.skip(!liveUrl, 'Set STORYBOOK_LIVE_MAPS_TEST_URL to a configured local Storybook iframe.')
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(liveUrl)
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-map-status', 'ready', { timeout: 30000 })
  await page.getByRole('button', { name: 'Browse ideas' }).click()
  await page.locator('.idea-result').first().click()
  const marker = page.locator('gmp-advanced-marker[aria-label="A safer library crossing"]')
  await expect.poll(() => marker.evaluate(el => el.map.getZoom()), { timeout: 10000 }).toBe(20)
  await page.getByRole('button', { name: 'Back to previous view' }).click()
  await marker.evaluate(el => { window.cameraFrames = []; const start = performance.now(); function sample(now) { const box = el.getBoundingClientRect(); window.cameraFrames.push(`${Math.round(box.x)},${Math.round(box.y)}`); if (now - start < 1500) requestAnimationFrame(sample) } requestAnimationFrame(sample) })
  await page.locator('.idea-result').nth(1).click()
  await page.waitForTimeout(1500)
  const frames = await page.evaluate(() => window.cameraFrames)
  expect(new Set(frames).size).toBeGreaterThan(2)
})

test('live Places search selects a temporary pin without changing zoom', async ({ page }) => {
  test.skip(!liveUrl || process.env.STORYBOOK_LIVE_PLACES_TEST !== '1', 'Enable the separate live Places check with a configured development key.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(liveUrl)
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-map-status', 'ready', { timeout: 30000 })
  const input = page.getByRole('searchbox', { name: 'Search places and ideas' })
  await input.fill('Dallas Museum of Art'); await input.press('Enter')
  await expect(page.locator('.place-result').first()).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('Google Maps', { exact: true })).toBeVisible()
  const marker = page.locator('gmp-advanced-marker').first()
  const before = await marker.evaluate(el => el.map.getZoom())
  await page.locator('.place-result').first().click()
  await expect(page.getByRole('complementary')).toHaveCount(0)
  await expect.poll(() => marker.evaluate(el => [...el.map.getDiv().querySelectorAll('gmp-advanced-marker')].length)).toBe(4)
  expect(await marker.evaluate(el => el.map.getZoom())).toBe(before)
  await input.fill('new query')
  await expect.poll(() => marker.evaluate(el => [...el.map.getDiv().querySelectorAll('gmp-advanced-marker')].length)).toBe(3)
})

for (const [width, height] of [[320, 800], [390, 844], [1024, 768], [1440, 900]]) {
  test(`Google camera controls remain usable and clear of the zoom indicator at ${width}px`, async ({ page }) => {
    test.skip(!liveUrl, 'Set STORYBOOK_LIVE_MAPS_TEST_URL to a configured local Storybook iframe.')
    await page.setViewportSize({ width, height })
    await page.goto(liveUrl)
    await expect(page.locator('.map-canvas')).toHaveAttribute('data-map-status', 'ready', { timeout: 30000 })
    await page.getByRole('button', { name: 'Browse ideas' }).click()
    const camera = page.getByRole('button', { name: 'Map camera controls' })
    await expect(camera).toBeVisible()
    await camera.click()
    const zoomIn = page.getByRole('button', { name: 'Zoom in', exact: true })
    await expect(zoomIn).toHaveCount(1)
    await expect(zoomIn).toBeVisible()
    const indicator = page.locator('.zoom-indicator')
    const shortcuts = page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).last()
    if (width <= 390) await page.waitForTimeout(500)
    const indicatorBox = await indicator.boundingBox(); const shortcutsBox = await shortcuts.boundingBox()
    if (width <= 390) {
      const tray = await page.locator('.tray-surface').boundingBox()
      const renderer = await page.locator('.map-renderer').boundingBox()
      const logo = await page.getByRole('link', { name: /Open this area in Google Maps/ }).boundingBox()
      expect(renderer.y + renderer.height - tray.y).toBeCloseTo(8, 0)
      expect(logo.y + logo.height).toBeLessThanOrEqual(tray.y + 1)
      expect(shortcutsBox.y + shortcutsBox.height).toBeLessThanOrEqual(tray.y + 1)
      expect(indicatorBox.x + indicatorBox.width <= logo.x || logo.x + logo.width <= indicatorBox.x || indicatorBox.y + indicatorBox.height <= logo.y || logo.y + logo.height <= indicatorBox.y, JSON.stringify({ indicatorBox, logo })).toBe(true)
    }
    expect(Math.abs(indicatorBox.y - shortcutsBox.y)).toBeLessThan(2)
    expect(shortcutsBox.x - (indicatorBox.x + indicatorBox.width)).toBeGreaterThanOrEqual(0)
    expect(shortcutsBox.x - (indicatorBox.x + indicatorBox.width)).toBeLessThan(15)
    const styles = await indicator.evaluate(el => ({ size: getComputedStyle(el).fontSize, family: getComputedStyle(el).fontFamily }))
    expect(styles).toEqual(await shortcuts.evaluate(el => ({ size: getComputedStyle(el).fontSize, family: getComputedStyle(el).fontFamily })))
    const first = await indicator.textContent()
    for (const name of ['Map camera controls', 'Move up', 'Move down', 'Move left', 'Move right', 'Zoom in', 'Zoom out']) {
      const button = page.getByRole('button', { name, exact: true })
      await expect(button).toBeVisible()
      const a = await button.boundingBox(); const b = await indicator.boundingBox()
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
    }
    await zoomIn.click()
    await expect(indicator).not.toHaveText(first)
    if (width <= 390) {
      await page.getByRole('button', { name: 'Expand tray', exact: true }).click()
      await expect(page.locator('.tray-layer')).toHaveAttribute('data-position', 'max')
      await expect(camera).toBeVisible()
      if (await camera.getAttribute('aria-expanded') !== 'true') await camera.click()
      await expect(zoomIn).toBeVisible()
      await expect(page.getByRole('button', { name: 'Browse ideas' })).toHaveCount(0)
      for (const name of ['Map camera controls', 'Move up', 'Move down', 'Move left', 'Move right', 'Zoom in', 'Zoom out']) {
        const button = page.getByRole('button', { name, exact: true })
        const a = await button.boundingBox(); const b = await indicator.boundingBox()
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
      }
      await page.getByRole('button', { name: 'Reduce tray', exact: true }).click()
      await expect(camera).toBeVisible()
      if (await camera.getAttribute('aria-expanded') !== 'true') await camera.click()
      await expect(zoomIn).toBeVisible()
      const a = await zoomIn.boundingBox(); const b = await indicator.boundingBox()
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
    }
  })
}
