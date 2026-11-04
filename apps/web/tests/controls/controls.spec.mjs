import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const specimen = '/tests/controls/'
test('keyboard interaction, validation associations, and save recovery', async ({ page }) => {
  await page.goto(specimen)
  const save = page.getByRole('button', { name: 'Save idea', exact: true })
  await page.keyboard.press('Tab')
  await expect(save).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Save activations: 1.')).toBeVisible()
  const toggle = page.getByRole('switch', { name: 'Receive idea updates' })
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).not.toBeChecked()
  await page.keyboard.press('Space')
  await expect(toggle).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Weekly digest (unavailable)' })).toBeDisabled()
  const select = page.getByLabel('Category', { exact: true })
  await select.selectOption('transit')
  await expect(select).toHaveValue('transit')
  await expect(page.getByLabel('Neighborhood')).toHaveAccessibleDescription('Use a neighborhood name, not a home address. Error: Enter a neighborhood to continue.')
  await expect(page.getByLabel('Neighborhood')).toHaveAttribute('aria-invalid', 'true')

  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  const title = page.getByLabel('Draft title (required)')
  await expect(title).toBeFocused()
  await expect(title).toHaveAccessibleDescription('No information leaves this specimen. Error: Enter a short title for your idea.')
  await title.fill('More shade at the bus stop')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  const loading = page.getByRole('button', { name: 'Saving…', exact: true })
  await expect(loading).toBeFocused()
  await expect(loading).toHaveAttribute('aria-busy', 'true')
  // ARIA-disabled keeps focus, but the handler must also block native submit.
  await page.locator('form').evaluate(form => { form.dataset.submits = '0'; form.addEventListener('submit', () => { form.dataset.submits = String(Number(form.dataset.submits) + 1) }) })
  await loading.press('Enter')
  await loading.press('Space')
  await expect(page.locator('form')).toHaveAttribute('data-submits', '0')
  await expect(page.getByRole('button', { name: 'Simulate failure' })).toBeVisible()
  await page.getByRole('button', { name: 'Simulate failure' }).click()
  await expect(title).toHaveValue('More shade at the bus stop')
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.getByRole('button', { name: 'Simulate success' }).click()
  await expect(page.getByText('Draft saved in this example.')).toBeVisible()
  await expect(title).not.toHaveAttribute('aria-invalid')
})

test('progress distinguishes zero, complete, and unknown duration', async ({ page }) => {
  await page.goto(specimen)
  await expect(page.getByRole('progressbar', { name: 'Waiting to start' })).toHaveAttribute('value', '0')
  await expect(page.getByRole('progressbar', { name: 'Preview ready' })).toHaveAttribute('value', '100')
  await expect(page.getByRole('progressbar', { name: 'Checking the upload' })).not.toHaveAttribute('value')
})

test('controls keep readable sizing and action emphasis in a smaller parent', async ({ page }) => {
  await page.goto(specimen)
  await page.locator('main').evaluate(el => { el.style.fontSize = '12px' })
  for (const control of [page.getByRole('button', { name: 'Save idea', exact: true }), page.getByLabel('Idea title (required)'), page.getByLabel('Category', { exact: true })]) {
    await expect(control).toHaveCSS('font-size', '16px')
  }
  await expect(page.getByRole('button', { name: 'Save idea', exact: true })).toHaveCSS('font-weight', '700')
})

for (const theme of ['light', 'dark']) {
  for (const width of [1280, 390]) {
    test(`${theme} at ${width}px: accessible specimens and no overflow`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await page.goto(specimen)
      if (process.env.CAPTURE_SPECIMENS) {
        await page.screenshot({ path: testInfo.outputPath(`controls-${theme}-${width}.png`), fullPage: true })
      }
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      expect(results.violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const targets = page.locator('button, input:not([type="checkbox"]), select')
      for (const control of await targets.all()) expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44)
    })
  }
}

test('forced colors and 320px reflow retain controls and visible focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.goto(specimen)
  await page.getByLabel('Idea title (required)').focus()
  await expect(page.getByLabel('Idea title (required)')).toBeFocused()
  expect(await page.getByLabel('Idea title (required)').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
