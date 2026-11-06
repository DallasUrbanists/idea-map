import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('review guidance keeps new patterns Draft and names evidence gaps', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/iframe.html?id=foundations-component-review--docs&viewMode=docs&globals=theme:light')
  const content = page.locator('.sbdocs-content')
  await expect(content.getByRole('heading', { name: 'Component review' })).toBeVisible()
  await expect(content).toContainText('New patterns stay Draft until a design reviewer explicitly accepts')
  await expect(content).toContainText('do not replace a real screen-reader walkthrough')
  expect(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
  expect((await new AxeBuilder({ page }).include('.sbdocs-content').analyze()).violations).toEqual([])
})

for (const width of [320, 1280]) {
  test(`production input error supports keyboard recovery and accessible labeling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/iframe.html?id=components-input--error&viewMode=story&globals=theme:light')
    const input = page.getByRole('textbox', { name: 'Idea title' })
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = await input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const descriptions = await page.locator('form').evaluate((form, ids) => ids.split(/\s+/).map(id => form.ownerDocument.getElementById(id)?.textContent).join(' '), describedBy)
    expect(descriptions).toContain('Enter an idea title')
    await input.focus()
    await input.fill('Synthetic crossing')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Check title' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toHaveText('Ready to check')
    await expect(input).not.toHaveAttribute('aria-invalid', 'true')
    expect(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([])
  })
}
