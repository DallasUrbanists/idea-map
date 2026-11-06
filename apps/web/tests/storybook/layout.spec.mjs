import { test, expect } from '@playwright/test'

const storyPath = '/iframe.html?id=components-layout-patterns--document-layout&viewMode=story&globals=theme:light'

for (const width of [320, 768, 1280]) {
  test(`page layout fills the viewport and reflows at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(storyPath)
    await expect(page.getByRole('navigation')).toBeVisible()
    const boxes = await page.locator('.page-layout, .page-header, .page-body, .page-navigation, .nav-rail, .page-main, .page-aside').evaluateAll(elements =>
      Object.fromEntries(elements.map(element => {
        const { top, bottom, height } = element.getBoundingClientRect()
        return [element.className, { top, bottom, height }]
      })))
    expect(boxes['page-layout'].height).toBeCloseTo(900, 0)
    expect(boxes['page-body'].top).toBeCloseTo(boxes['page-header'].bottom, 0)
    expect(boxes['page-body'].bottom).toBeCloseTo(900, 0)
    expect(boxes['nav-rail'].height).toBeCloseTo(boxes['page-navigation'].height, 0)
    if (width > 760) {
      for (const region of ['nav-rail', 'page-main', 'page-aside']) {
        expect(boxes[region].height).toBeCloseTo(boxes['page-body'].height, 0)
      }
    } else {
      expect(boxes['page-main'].top).toBeCloseTo(boxes['nav-rail'].bottom, 0)
      expect(boxes['page-aside'].top).toBeCloseTo(boxes['page-main'].bottom, 0)
    }
    expect(await page.locator('html').evaluate(element => ({
      horizontal: element.scrollWidth > element.clientWidth,
      vertical: element.scrollHeight > element.clientHeight,
    }))).toEqual({ horizontal: false, vertical: false })
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('main')).toBeFocused()

    await page.getByRole('main').evaluate(element => {
      for (let index = 0; index < 80; index++) {
        const content = element.ownerDocument.createElement('p')
        content.textContent = `Community idea ${index + 1}`
        element.append(content)
      }
    })
    expect(await page.locator('html').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await page.getByRole('complementary').scrollIntoViewIfNeeded()
    await expect(page.getByRole('complementary')).toBeVisible()
    expect(await page.locator('html').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
  })
}

test('isolated layout docs preview has no baseline scrollbar', async ({ page }) => {
  await page.goto('/iframe.html?id=components-layout-patterns--usage&viewMode=docs&globals=theme:light')
  const preview = page.locator('.docs-story').first()
  const iframe = page.locator('iframe[id^="iframe--"]').first()
  await expect(iframe.contentFrame().getByRole('main', { name: 'Map workspace' })).toBeVisible()
  expect(await iframe.evaluate(element => getComputedStyle(element).display)).toBe('block')
  expect(await preview.evaluate(element => ({
    horizontal: element.scrollWidth > element.clientWidth,
    vertical: element.scrollHeight > element.clientHeight,
  }))).toEqual({ horizontal: false, vertical: false })
})

test('layout docs link opens Canvas with working phone and tablet viewport controls', async ({ page }) => {
  await page.goto('/?path=/docs/components-layout-patterns--usage&globals=theme:light')
  await page.frameLocator('#storybook-preview-iframe').getByRole('link', { name: 'Open device preview' }).click()
  await expect(page).toHaveURL(/path=\/story\/components-layout-patterns--default/)
  const viewport = page.getByRole('button', { name: /^Viewport size/ })
  const story = page.frameLocator('#storybook-preview-iframe')
  for (const [device, width, height, placement] of [
    ['iPhone 12', 390, 844, 'bottom'],
    ['iPad', 768, 1024, 'bottom'],
  ]) {
    await viewport.click()
    await page.getByRole('option', { name: device, exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Viewport width' })).toHaveValue(`${width}px`)
    await expect(page.getByRole('textbox', { name: 'Viewport height' })).toHaveValue(`${height}px`)
    await expect(story.locator('.map-shell')).toHaveAttribute('data-placement', placement)
    await expect.poll(() => story.locator('html').evaluate(element => element.clientWidth)).toBe(width)
    await expect.poll(() => story.locator('html').evaluate(element => element.clientHeight)).toBe(height)
  }
  await page.getByRole('button', { name: 'Rotate viewport' }).click()
  await expect(page.getByRole('textbox', { name: 'Viewport width' })).toHaveValue('1024px')
  await expect.poll(() => story.locator('html').evaluate(element => element.clientWidth)).toBe(1024)
  await expect(story.locator('.map-shell')).toHaveAttribute('data-placement', 'side')
  await viewport.click()
  await page.getByRole('option', { name: 'Reset viewport', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Rotate viewport' })).toHaveCount(0)
  const availableWidth = await page.locator('#storybook-preview-iframe').evaluate(element => element.clientWidth)
  await expect.poll(() => story.locator('html').evaluate(element => element.clientWidth)).toBe(availableWidth)
})
