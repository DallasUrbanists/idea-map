import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

for (const width of [320, 1280]) {
  test(`catalog overview exposes valid sections and links at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/iframe.html?id=catalog-overview--docs&viewMode=docs&globals=theme:light')
    const content = page.locator('.sbdocs-content')
    for (const heading of ['Foundations', 'Controls', 'Overlays', 'Ideas', 'Discussion', 'Submission']) {
      await expect(content.getByRole('heading', { name: heading })).toBeVisible()
    }
    await expect(content).toContainText('Dedicated discussion components and application flows are not represented')
    const index = await (await request.get('/index.json')).json()
    const links = await content.locator('a[href*="?path=/"]').all()
    expect(links.length).toBeGreaterThan(10)
    for (const link of links) {
      const href = await link.getAttribute('href')
      const id = href.split('/').at(-1)
      expect(index.entries[id], href).toBeTruthy()
      await expect(link).toHaveAttribute('target', '_top')
    }
    expect(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    const accessibility = await new AxeBuilder({ page }).include('.sbdocs-content').analyze()
    expect(accessibility.violations).toEqual([])
  })
}

test('catalog navigation returns to the overview repeatedly', async ({ page }) => {
  await page.goto('/?path=/docs/catalog-overview--docs')
  for (let i = 0; i < 2; i++) {
    const frame = page.frameLocator('#storybook-preview-iframe')
    const button = frame.getByRole('link', { name: 'Button', exact: true }).first()
    await button.focus()
    await expect(button).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/components-button--usage/)
    await page.goto('/?path=/docs/catalog-overview--docs')
    await expect(frame.getByRole('heading', { name: 'Component catalog' })).toBeVisible()
  }
})
