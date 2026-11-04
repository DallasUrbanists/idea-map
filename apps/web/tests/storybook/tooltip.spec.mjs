import { test, expect } from '@playwright/test'

const story = '/iframe.html?id=components-button--icon-only&viewMode=story'

for (const theme of ['light', 'dark']) test(`${theme} corner tooltips stay within a narrow viewport`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto(`/iframe.html?id=components-tooltip--${theme}&viewMode=story`)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  for (const corner of ['Top left', 'Top right', 'Bottom left', 'Bottom right']) {
    const trigger = page.getByRole('button', { name: corner })
    await trigger.focus()
    await expect(page.getByRole('tooltip')).toHaveText(corner === 'Top right' ? 'Warning: review before continuing' : `Tooltip near ${corner.toLowerCase()}`)
    if (corner === 'Top right') {
      await expect(trigger).toHaveCSS('background-color', 'rgb(255, 140, 0)')
      await expect(page.locator('.tooltip')).toHaveCSS('background-color', 'rgb(255, 140, 0)')
    }
    const box = await page.locator('.tooltip').boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
    expect(box.y + box.height).toBeLessThanOrEqual(640)
  }
})

test('tooltip escapes a transformed clipping container', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/iframe.html?id=components-tooltip--usage-clipping&viewMode=story')
  const container = page.locator('.tooltip-story-clip')
  await page.getByRole('button', { name: 'Show hint' }).focus()
  await expect(page.getByRole('tooltip')).toHaveText('This hint can extend outside the clipped container')
  const content = page.locator('.tooltip')
  await expect(container.locator('.tooltip')).toHaveCount(0)
  const clip = await container.boundingBox()
  const box = await content.boundingBox()
  expect(box.y + box.height).toBeGreaterThan(clip.y + clip.height)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(320)
  expect(box.y + box.height).toBeLessThanOrEqual(640)
})

test('portalled tooltip retains the trigger’s local theme', async ({ page }) => {
  await page.goto(story)
  for (const [theme, color] of [['Light theme', 'rgb(232, 237, 243)'], ['Dark theme', 'rgb(48, 62, 78)']]) {
    await page.getByRole('region', { name: theme }).getByRole('button', { name: 'Primary save idea' }).focus()
    await expect(page.locator('.tooltip')).toHaveCSS('background-color', color)
  }
})

test('icon button tooltip supports hover, focus, and Escape', async ({ page }) => {
  await page.goto(story)
  const card = page.getByRole('region', { name: 'Light theme' })
  const button = card.getByRole('button', { name: 'Primary save idea' })
  await button.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Primary save idea')
  const content = page.locator('.tooltip')
  await expect(content).toHaveClass(/\bshadow-floating\b/)
  await expect(content).toHaveCSS('background-color', 'rgb(232, 237, 243)')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.mouse.move(0, 0)
  await button.focus()
  await expect(page.getByRole('tooltip')).toHaveText('Primary save idea')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('tooltip')).toHaveText('Secondary save idea')
})

for (const width of [320, 1024]) test(`long tooltip wraps within ${width}px viewport`, async ({ page }) => {
  await page.setViewportSize({ width, height: 640 })
  await page.goto('/iframe.html?id=components-tooltip--usage-long-text&viewMode=story')
  await page.getByRole('button', { name: 'About preview' }).focus()
  const content = page.locator('.tooltip')
  await expect(content).toBeVisible()
  await expect(content).toHaveCSS('text-wrap', 'pretty')
  const dimensions = await content.evaluate(el => ({
    width: el.getBoundingClientRect().width,
    height: el.getBoundingClientRect().height,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(dimensions.width).toBeLessThanOrEqual(Math.min(320, width - 16))
  expect(dimensions.height).toBeGreaterThan(40)
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
})

test('touch activation closes an open tooltip and does not reopen it', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  try {
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:6011${story}`)
    const button = page.getByRole('region', { name: 'Light theme' }).getByRole('button', { name: 'Primary save idea' })
    await button.focus()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await button.tap()
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await page.waitForTimeout(800)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('loading border animation respects reduced motion', async ({ page }) => {
  await page.goto(story)
  const button = page.getByRole('region', { name: 'Light theme' }).getByRole('button', { name: 'Saving idea' })
  await expect(button).toHaveCSS('animation-name', /^button-loading-border/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(button).toHaveCSS('animation-name', 'none')
})
