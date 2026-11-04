import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const components = ['badge', 'card', 'error-state', 'chip', 'input', 'select', 'map-controls', 'menu', 'segmented-control', 'spinner', 'status', 'table', 'toast', 'tooltip', 'navigation-rail', 'switch', 'skeleton']
const openStory = (page, component, story = 'default', theme = 'light') => page.goto(`/iframe.html?id=components-${component}--${story}&viewMode=story&globals=theme:${theme}`)

test('each requested component has a usage page with code and live examples', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 320, height: 800 })
  for (const component of components) {
    await page.goto(`/iframe.html?id=components-${component}--usage&viewMode=docs&globals=theme:light`)
    await expect(page.locator('.sbdocs-content h1')).toContainText('usage')
    await expect(page.locator('.sbdocs-content pre').first()).toBeVisible()
    await expect(page.locator('.sbdocs-preview').first()).toBeVisible()
    await expect(page.locator('.sb-errordisplay')).not.toBeVisible()
    expect(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth), component).toBe(false)
    const foundationLinks = page.locator('.sbdocs-content a[href*="/foundations-"]')
    for (const link of await foundationLinks.all()) await expect(link).toHaveAttribute('href', /^\.\/\?path=\/docs\/foundations-/)
  }
})

test('exclusive choices support native arrow navigation and skip disabled options', async ({ page }) => {
  await openStory(page, 'segmented-control', 'disabled-option')
  const nearby = page.getByRole('radio', { name: 'Nearby', exact: true })
  await nearby.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Recent', exact: true })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Recent', exact: true })).toBeFocused()
  await expect(page.getByRole('radio', { name: 'Saved (sign in required)' })).toBeDisabled()
  await page.keyboard.press('ArrowRight')
  await expect(nearby).toBeChecked()
})

test('menus navigate, activate, dismiss, and restore trigger focus', async ({ page }) => {
  await openStory(page, 'menu')
  const trigger = page.getByRole('button', { name: 'Draft tools', exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('menuitem', { name: 'Preview draft' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Copy draft link' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('Selected: copy')
  await expect(trigger).toBeFocused()
  await trigger.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.getByRole('status').click()
  await expect(page.getByRole('menu')).toHaveCount(0)
})

test('checked menu items update while the menu stays open', async ({ page }) => {
  await openStory(page, 'menu', 'checkboxes')
  await page.getByRole('button', { name: 'Visible layers' }).click()
  const item = page.getByRole('menuitemcheckbox', { name: 'Workshops' })
  await expect(item).toHaveAttribute('aria-checked', 'false')
  await item.click()
  await expect(item).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('menu')).toBeVisible()
})

test('input labels, error descriptions, native attributes, and values survive validation', async ({ page }) => {
  await openStory(page, 'input', 'error')
  const input = page.getByRole('textbox', { name: 'Idea title (required)' })
  await expect(input).toHaveAttribute('required', '')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(input).toHaveAccessibleDescription('Your title stays available after a failed save. Error: Enter an idea title.')
  await input.fill('Shade at the bus stop')
  await page.getByRole('button', { name: 'Check title' }).click()
  await expect(input).toHaveValue('Shade at the bus stop')
  await expect(input).not.toHaveAttribute('aria-invalid')
  await openStory(page, 'input', 'search')
  await page.getByRole('searchbox', { name: 'Search ideas' }).fill('shade')
  await expect(page.getByText('Search query: shade')).toBeVisible()
})

test('switches expose their state and retain keyboard and disabled behavior', async ({ page }) => {
  await openStory(page, 'switch')
  const control = page.getByRole('switch', { name: 'Show community ideas' })
  await control.focus()
  await page.keyboard.press('Space')
  await expect(control).toBeChecked()
  await expect(page.getByRole('status')).toHaveText('Community ideas are visible')
  await expect(control).toHaveAccessibleDescription('Changes apply immediately.')
  await page.keyboard.press('Space')
  await expect(control).not.toBeChecked()
  await openStory(page, 'switch', 'disabled')
  await expect(page.getByRole('switch', { name: 'Email updates' })).toBeDisabled()
})

test('map controls update zoom, enforce limits, and explain unavailable location', async ({ page }) => {
  await openStory(page, 'map-controls')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Zoom level 13')
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Zoom level 12')
  await page.getByRole('button', { name: 'Recenter map', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Recenter map', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await openStory(page, 'map-controls', 'zoom-limit')
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled()
  await openStory(page, 'map-controls', 'location-error')
  await expect(page.getByRole('status')).toContainText('Location is unavailable')
})

test('error recovery and skeleton completion replace pending content', async ({ page }) => {
  await openStory(page, 'error-state', 'recovery')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('status')).toContainText('Ideas loaded')
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
  await openStory(page, 'skeleton', 'completion')
  await expect(page.getByRole('group', { name: 'Loading community ideas' })).toHaveAttribute('aria-busy', 'true')
  await page.getByRole('button', { name: 'Simulate loaded results' }).click()
  await expect(page.getByRole('status')).toHaveText('2 ideas loaded')
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
})

test('toast actions and keyboard dismissal work without moving focus on arrival', async ({ page }) => {
  await openStory(page, 'toast', 'with-action')
  const trigger = page.getByRole('button', { name: 'Show notification' })
  await trigger.focus()
  await trigger.press('Enter')
  await expect(page.locator('.idea-toast')).toBeVisible()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Alt+t')
  await expect(page.locator('.idea-toast-viewport')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('.idea-toast')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('Save undone')
  await expect(page.locator('.idea-toast')).toHaveCount(0)
  await trigger.click()
  await page.keyboard.press('Alt+t')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Escape')
  await expect(page.locator('.idea-toast')).toHaveCount(0)
})

test('toast timers pause while a notification is hovered and resume after leaving', async ({ page }) => {
  await page.clock.install()
  await openStory(page, 'toast')
  await page.getByRole('button', { name: 'Show notification' }).click()
  await expect(page.locator('.idea-toast')).toBeVisible()
  await page.clock.fastForward(4000)
  await page.locator('.idea-toast').hover()
  await page.clock.fastForward(10000)
  await expect(page.locator('.idea-toast')).toBeVisible()
  await page.mouse.move(0, 0)
  await page.clock.fastForward(2000)
  await expect(page.locator('.idea-toast')).toHaveCount(0)
})

test('table headers, numeric alignment, and horizontal keyboard scrolling follow Foundations', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await openStory(page, 'table')
  await expect(page.getByRole('table', { name: 'Workshop ideas' })).toBeVisible()
  await expect(page.getByRole('columnheader')).toHaveCount(3)
  await expect(page.getByRole('rowheader')).toHaveCount(2)
  expect(await page.locator('th, td').evaluateAll(cells => cells.every(cell => ['start', 'left'].includes(getComputedStyle(cell).textAlign)))).toBe(true)
  const region = page.getByRole('region', { name: 'Workshop ideas' })
  await region.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  expect(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
})

test('navigation uses links, labels, and current page semantics', async ({ page }) => {
  await openStory(page, 'navigation-rail')
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(nav.getByRole('link')).toHaveCount(4)
  await nav.getByRole('link', { name: 'Saved', exact: true }).click()
  await expect(nav.getByRole('link', { name: 'Saved', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Nearby', exact: true })).not.toHaveAttribute('aria-current')
})

test('loading indicators preserve text and static skeletons under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openStory(page, 'spinner')
  await expect(page.getByRole('status')).toHaveText('Saving your idea…')
  await expect(page.locator('.ring')).toHaveCSS('animation-name', 'none')
  await openStory(page, 'skeleton')
  expect(await page.locator('.idea-skeleton *').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none'))).toBe(true)
})

for (const theme of ['light', 'dark']) {
  test(`catalog components reflow and pass accessibility checks in ${theme}`, async ({ page }) => {
    test.setTimeout(180000)
    await page.setViewportSize({ width: 320, height: 800 })
    const stories = [
      ['badge', 'with-icon'], ['card', 'default'], ['error-state', 'inline'], ['chip', 'meaning'],
      ['input', 'error'], ['map-controls', 'default'], ['menu', 'inline'], ['segmented-control', 'fill'],
      ['spinner', 'default'], ['status', 'pill'], ['table', 'custom-cells'],
      ['toast', 'tones'], ['navigation-rail', 'capsule'], ['switch', 'long-label'], ['skeleton', 'default'],
    ]
    for (const [component, story] of stories) {
      await openStory(page, component, story, theme)
      await expect(page.locator('#storybook-root > *').first()).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth), component).toBe(false)
      const result = await new AxeBuilder({ page }).include('#storybook-root').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      expect(result.violations, component).toEqual([])
      if (process.env.CAPTURE_CATALOG === '1') await page.locator('#storybook-root').screenshot({ path: `test-results/catalog-review/${theme}-${component}.png` })
    }
    await openStory(page, 'menu', 'checkboxes', theme)
    await page.getByRole('button', { name: 'Visible layers' }).click()
    const result = await new AxeBuilder({ page }).include('.idea-menu-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(result.violations).toEqual([])
  })
}
