import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const fixture = '/iframe.html?id=components-layout-patterns--interaction-fixture&viewMode=story&globals=theme:light'
const open = async (page, mode = 'auto') => {
  await page.route(/https:\/\/[^/]*(googleapis|gstatic)\.com\//, route => route.abort())
  await page.goto(`${fixture}&args=presentation:${mode}`)
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-map-status', 'ready')
}
const menu = async (page, destination) => {
  await page.getByRole('button', { name: 'Open profile and app menu' }).click()
  await page.getByRole('menuitem', { name: destination, exact: true }).click()
}
const oneMap = async page => {
  await expect(page.locator('[data-fixture-constructions]')).toHaveAttribute('data-fixture-constructions', '1')
  await expect(page.locator('[data-map-ready-count]')).toHaveAttribute('data-map-ready-count', '1')
}

for (const [width, height, placement] of [[320, 360, 'bottom'], [844, 390, 'bottom'], [320, 800, 'bottom'], [390, 844, 'bottom'], [768, 1024, 'bottom'], [1024, 768, 'side'], [1440, 900, 'side']]) {
  test(`map workspace adapts without overflow at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await open(page)
    await expect(page.locator('.map-shell')).toHaveAttribute('data-placement', placement)
    await page.getByRole('button', { name: 'Browse ideas' }).click()
    await expect(page.getByRole('complementary', { name: 'Community ideas', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close view and return to map' })).toBeVisible()
    expect(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    await oneMap(page)
  })
}

for (const [width, height, mode] of [[1440, 900, 'desktop'], [1024, 768, 'app']]) {
  test(`side tray overlays a full-width map behind search at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await open(page, mode)
    const canvas = page.locator('.fixture-map')
    const before = await canvas.boundingBox()
    const camera = await canvas.getAttribute('data-fixture-camera')
    await page.getByRole('button', { name: 'Browse ideas' }).click()
    await expect(page.getByRole('complementary', { name: 'Community ideas', exact: true })).toBeVisible()
    await expect.poll(() => canvas.boundingBox()).toEqual(before)
    await expect(canvas).toHaveAttribute('data-fixture-camera', camera)
    const shell = await page.locator('.map-shell').boundingBox()
    const search = await page.locator('.map-search').boundingBox()
    expect(before.x).toBe(shell.x)
    expect(before.width).toBe(shell.width)
    expect(before.x).toBeLessThan(search.x)
    expect(shell.x + shell.width - (search.x + search.width)).toBeLessThanOrEqual(20)
    const footer = await page.locator('.fixture-map-label').boundingBox()
    const tray = await page.locator('.tray-surface').boundingBox()
    expect(footer.x).toBeGreaterThanOrEqual(tray.x + tray.width)
    await page.locator('.idea-result').first().click()
    await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-fixture-reveal-padding') || '{}').left).toBeGreaterThan(0)
    await oneMap(page)
  })
}

for (const [width, height] of [[390, 844], [1024, 768], [1440, 900]]) {
  test(`zoom indicator follows the map without duplicate controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await open(page)
    await expect(page.locator('.map-controls')).toHaveCount(0)
    const indicator = page.locator('.zoom-indicator')
    await expect(indicator).toHaveText('Zoom 13')
    const search = await page.locator('.map-search').boundingBox()
    const controls = await page.locator('.map-floating-controls').boundingBox()
    expect(controls.y).toBeGreaterThanOrEqual(search.y + search.height)
    await page.locator('.fixture-map').dispatchEvent('wheel', { deltaY: -100 })
    await expect(indicator).toHaveText('Zoom 14')
    await page.getByRole('button', { name: 'Browse ideas' }).click()
    await expect(indicator).toBeVisible()
    await oneMap(page)
  })
}

test('tray grip, content and map canvas move together on click', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, 'app')
  await page.getByRole('button', { name: 'Browse ideas' }).click()
  await expect(page.getByRole('complementary', { name: 'Community ideas', exact: true })).toBeVisible()
  await page.waitForTimeout(500)
  const surface = page.locator('.tray-surface'); const grip = page.locator('.tray-grip'); const handle = page.locator('.tray-handle')
  const s = await surface.boundingBox(); const g = await grip.boundingBox(); const h = await handle.boundingBox()
  expect(g.y - s.y).toBe(8); expect(g.width).toBe(104); expect(h.height).toBeGreaterThanOrEqual(44)
  for (const action of ['Close tray', 'Open tray']) {
    await page.evaluate(() => {
      window.trayFrames = []
      const start = performance.now()
      function sample(now) {
        const tray = document.querySelector('.tray-surface').getBoundingClientRect()
        const map = document.querySelector('.map-renderer').getBoundingClientRect()
        const body = document.querySelector('.tray-body').getBoundingClientRect()
        window.trayFrames.push({ top: tray.top, bottom: map.bottom, height: body.height })
        if (now - start < 650) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await page.getByRole('button', { name: action, exact: true }).click()
    await page.waitForTimeout(700)
    const frames = await page.evaluate(() => window.trayFrames)
    expect(new Set(frames.map(frame => Math.round(frame.top))).size).toBeGreaterThan(5)
    expect(new Set(frames.map(frame => Math.round(frame.height))).size).toBeGreaterThan(5)
    expect(Math.max(...frames.map(frame => Math.abs(frame.bottom - frame.top)))).toBeLessThan(14)
    const last = frames.at(-1)
    expect(last.bottom - last.top).toBeCloseTo(action === 'Open tray' ? 8 : 0, 0)
  }
})

test('dragging tracks the map edge without a lagging transition', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, 'app')
  await page.getByRole('button', { name: 'Browse ideas' }).click(); await page.waitForTimeout(500)
  const handle = await page.locator('.tray-handle').boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 20)
  await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2, handle.y + 75, { steps: 5 })
  await expect(page.locator('.map-canvas')).toHaveClass(/map-dragging/)
  await expect(page.locator('.map-renderer')).toHaveCSS('transition-property', 'none')
  await expect.poll(async () => {
    const map = await page.locator('.map-renderer').boundingBox(); const tray = await page.locator('.tray-surface').boundingBox()
    return Math.round(map.y + map.height - tray.y)
  }).toBe(8)
  await page.mouse.up()
  await expect(page.locator('.map-canvas')).not.toHaveClass(/map-dragging/)
})

test('pill actions scroll horizontally and fade when the tray expands', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/iframe.html?id=components-layout-patterns--scrollable-actions&viewMode=story&globals=theme:light')
  const row = page.getByRole('group', { name: 'Map actions' })
  await expect(row.getByRole('button')).toHaveCount(6)
  expect(await row.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  await row.focus(); await page.keyboard.press('End')
  await expect.poll(() => row.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  await row.getByRole('button', { name: 'Browse ideas' }).click()
  await page.getByRole('button', { name: 'Expand tray', exact: true }).click()
  await expect(row).toHaveClass(/map-actions-leave-active/)
  await expect(row).toHaveCount(0)
  await page.getByRole('button', { name: 'Reduce tray', exact: true }).click()
  await expect(row).toHaveClass(/map-actions-enter-active/)
  await expect(row).toBeVisible()
})

for (const reduced of [false, true]) {
  test(`catalog icons reveal and respond to button focus with reduced motion ${reduced}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
    await page.addInitScript(() => {
      window.iconPlays = []
      const define = customElements.define.bind(customElements)
      customElements.define = (name, constructor, options) => {
        if (name === 'lord-icon') {
          const play = constructor.prototype.play
          constructor.prototype.play = function (...args) { window.iconPlays.push(this.getAttribute('src')); return play.apply(this, args) }
        }
        return define(name, constructor, options)
      }
    })
    await open(page)
    const button = page.getByRole('button', { name: 'Search', exact: true })
    const icon = button.locator('.animated-icon[data-icon="search"]')
    await expect(icon.locator('lord-icon')).toHaveCount(2)
    await expect.poll(() => icon.locator('lord-icon').first().evaluate(el => el.ready)).toBe(true)
    if (reduced) {
      await button.focus(); await page.waitForTimeout(300)
      expect(await page.evaluate(() => window.iconPlays.length)).toBe(0)
      await expect(icon.locator('lord-icon').last()).toHaveClass('hidden')
    } else {
      await expect.poll(() => page.evaluate(() => window.iconPlays.some(src => src.includes('magnifier-in-reveal')))).toBe(true)
      await button.focus()
      await expect(icon.locator('lord-icon').last()).not.toHaveClass('hidden')
      await expect.poll(() => page.evaluate(() => window.iconPlays.some(src => src.includes('magnifier-hover-pinch')))).toBe(true)
      await page.getByRole('searchbox').focus()
      await expect(icon.locator('lord-icon').last()).toHaveClass('hidden')
      await button.hover()
      await expect(icon.locator('lord-icon').last()).not.toHaveClass('hidden')
      await button.focus(); await page.mouse.move(0, 0)
      await expect(icon.locator('lord-icon').last()).not.toHaveClass('hidden')
    }
  })
}

test('desktop rail and touch-first app navigation use distinct presentation', async ({ browser, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page, 'desktop')
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  const context = await browser.newContext({ viewport: { width: 1366, height: 1024 }, hasTouch: true, isMobile: true })
  const touch = await context.newPage()
  await open(touch)
  await expect(touch.locator('.map-shell')).toHaveAttribute('data-presentation', 'app')
  await expect(touch.getByRole('navigation')).toBeHidden()
  await context.close()
})

test('map/list idea selection, camera movement, Back and Close retain a single map', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page, 'desktop')
  await page.getByRole('button', { name: 'Browse ideas' }).click()
  await page.locator('.idea-result').first().click()
  const details = page.getByRole('complementary', { name: 'A safer library crossing', exact: true })
  await expect(details).toBeVisible()
  await expect(page.locator('[data-fixture-reveals]')).toHaveAttribute('data-fixture-reveals', '1')
  const canvas = page.locator('.fixture-map')
  const before = await canvas.getAttribute('data-fixture-camera')
  await canvas.focus(); await page.keyboard.press('ArrowRight')
  await expect(canvas).not.toHaveAttribute('data-fixture-camera', before)
  await expect(details).toBeVisible()
  await expect(page.locator('.tray-layer')).toHaveAttribute('data-position', 'medium')
  await expect(canvas).toHaveAttribute('data-fixture-reveals', '1')
  const afterPan = await canvas.getAttribute('data-fixture-camera')
  await page.getByRole('button', { name: 'Back to previous view' }).click()
  await expect(page.getByRole('complementary', { name: 'Community ideas', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close view and return to map' }).click()
  await expect(page.getByRole('complementary')).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-fixture-camera', afterPan)
  await page.getByRole('button', { name: 'Shade at the bus stop', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Shade at the bus stop', exact: true })).toBeVisible()
  await oneMap(page)
})

test('hybrid search orders ideas first and clears the temporary place marker', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page, 'desktop')
  const input = page.getByRole('searchbox', { name: 'Search places and ideas' })
  const canvas = page.locator('.fixture-map')
  await input.fill('shade'); await input.press('Enter')
  await expect(page.locator('.idea-result').first()).toContainText('Shade at the bus stop')
  await expect(page.locator('.place-result')).toHaveText(/Shade Plaza/)
  await expect(page.getByText('Synthetic place fixture')).toBeVisible()
  await page.locator('.place-result').click()
  await expect(page.getByRole('complementary')).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-fixture-place', 'shade-place')
  expect(JSON.parse(await canvas.getAttribute('data-fixture-camera')).zoom).toBe(13)
  await input.fill('library')
  await expect(canvas).toHaveAttribute('data-fixture-place', '')
  await input.press('Enter'); await page.locator('.place-result').click()
  await expect(canvas).toHaveAttribute('data-fixture-place', 'library-place')
  await page.getByRole('button', { name: 'Browse ideas' }).click()
  await expect(canvas).toHaveAttribute('data-fixture-place', '')
  await oneMap(page)
})

test('place searches ignore stale responses and report errors without hiding ideas', async ({ page }) => {
  await open(page)
  const input = page.getByRole('searchbox', { name: 'Search places and ideas' })
  await input.fill('slow'); await input.press('Enter')
  await input.fill('shade'); await input.press('Enter')
  await expect(page.locator('.place-result')).toHaveText(/Shade Plaza/)
  await page.waitForTimeout(400)
  await expect(page.locator('.place-result')).toHaveText(/Shade Plaza/)
  await page.locator('.fixture-map').evaluate(element => { element.dataset.fixtureFailSearch = 'true' })
  await input.press('Enter')
  await expect(page.getByText('Places are unavailable.', { exact: false })).toBeVisible()
  await expect(page.locator('.idea-result')).toContainText(['Shade at the bus stop'])
  await page.locator('.fixture-map').evaluate(element => { delete element.dataset.fixtureFailSearch })
  await input.fill('no-such-result'); await input.press('Enter')
  await expect(page.getByText('No matching ideas or places.', { exact: false })).toBeVisible()
})

test('portrait/landscape rotation retains expanded sheet state, draft, and map instance', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 }); await open(page, 'app')
  await menu(page, 'New idea')
  await page.getByRole('textbox', { name: 'Idea title', exact: false }).fill('A retained draft')
  await page.getByRole('textbox', { name: 'Idea description' }).fill('A description that survives navigation.')
  await page.getByRole('button', { name: 'Use map center' }).click()
  const location = await page.getByText(/^Location:/).textContent()
  await page.getByRole('button', { name: 'Expand tray', exact: true }).click()
  await expect(page.locator('.tray-layer')).toHaveAttribute('data-position', 'max')
  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(page.locator('.map-shell')).toHaveAttribute('data-placement', 'side')
  await page.setViewportSize({ width: 768, height: 1024 })
  await expect(page.locator('.tray-layer')).toHaveAttribute('data-position', 'max')
  await page.getByRole('button', { name: 'Close view and return to map' }).click()
  await menu(page, 'New idea')
  await expect(page.getByRole('textbox', { name: 'Idea title', exact: false })).toHaveValue('A retained draft')
  await expect(page.getByRole('textbox', { name: 'Idea description' })).toHaveValue('A description that survives navigation.')
  await expect(page.getByText(/^Location:/)).toHaveText(location)
  await oneMap(page)
})

test('search keeps query/results, independent list scroll, and nested modal Escape order', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, 'app')
  await page.getByRole('searchbox', { name: 'Search places and ideas' }).fill('shade')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.locator('.idea-result')).toHaveCount(1)
  await page.locator('.idea-result').first().click()
  await page.getByRole('button', { name: 'Back to previous view' }).click()
  await expect(page.getByRole('searchbox')).toHaveValue('shade')
  await page.getByRole('button', { name: 'Close view and return to map' }).click()
  await menu(page, 'Profile')
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('button', { name: 'Satellite', exact: true }).click()
  await expect(page.locator('.fixture-map')).toHaveAttribute('data-fixture-map-type', 'satellite')
  await page.getByRole('button', { name: 'Review clear draft' }).click()
  await expect(page.getByRole('dialog', { name: 'Clear demo draft?' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'Settings', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Profile', exact: true })).toBeVisible()
  await oneMap(page)
})

test('pointer pan and wheel zoom leave the open tray fixed without automatic recentering', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, 'app')
  await page.getByRole('button', { name: 'A safer library crossing', exact: true }).click()
  const tray = page.locator('.tray-surface')
  const box = await tray.boundingBox()
  const canvas = page.locator('.fixture-map')
  const mapBox = await canvas.boundingBox()
  const before = await canvas.getAttribute('data-fixture-camera')
  await page.mouse.move(mapBox.x + 20, mapBox.y + 220)
  await page.mouse.down(); await page.mouse.move(mapBox.x + 80, mapBox.y + 250, { steps: 3 }); await page.mouse.up()
  await expect(canvas).not.toHaveAttribute('data-fixture-camera', before)
  await expect(canvas).toHaveAttribute('data-fixture-reveals', '1')
  const panned = await canvas.getAttribute('data-fixture-camera')
  await page.mouse.wheel(0, 100)
  await expect(canvas).not.toHaveAttribute('data-fixture-camera', panned)
  expect(await tray.boundingBox()).toEqual(box)
  await expect(page.locator('.tray-layer')).toHaveAttribute('data-position', 'medium')
  await oneMap(page)
})

test('Back restores the independent results scroll position', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, 'app')
  await page.getByRole('button', { name: 'Browse ideas' }).click()
  const body = page.locator('.tray-body')
  await body.evaluate(element => { element.scrollTop = 150 })
  const before = await body.evaluate(element => element.scrollTop)
  expect(before).toBeGreaterThan(0)
  const result = page.locator('.idea-result').nth(1)
  await result.evaluate(element => element.addEventListener('click', () => { window.scrollAtSelection = element.closest('.tray-body').scrollTop }, { capture: true, once: true }))
  await result.click()
  const atSelection = await page.evaluate(() => window.scrollAtSelection)
  await page.getByRole('button', { name: 'Back to previous view' }).click()
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(atSelection)
})

test('provider footer remains above the tray handle and below floating controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, 'app')
  const clearFooter = async () => {
    const footer = await page.locator('.fixture-map-label').boundingBox()
    const handle = await page.locator('.tray-handle').boundingBox()
    const controls = await page.locator('.map-floating-controls').boundingBox()
    return footer && handle && controls && footer.y + footer.height <= handle.y && controls.y + controls.height <= footer.y
  }
  await expect.poll(clearFooter).toBe(true)
  await page.getByRole('button', { name: 'Browse ideas' }).click()
  await expect.poll(clearFooter).toBe(true)
})

test('missing configuration and provider failure are explicit and recoverable', async ({ page }) => {
  await page.goto('/iframe.html?id=components-layout-patterns--missing-configuration&viewMode=story')
  await expect(page.getByText('Configure the non-production Storybook Maps browser key locally to load the live basemap.')).toBeVisible()
  await page.getByRole('button', { name: 'Retry map' }).click()
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-map-status', 'error')
  await page.goto('/iframe.html?id=components-layout-patterns--provider-failure&viewMode=story')
  await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry map' }).click()
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-map-status', 'error')
})

for (const theme of ['light', 'dark']) test(`map foreground accessibility in ${theme} mode`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, 'app')
  if (theme === 'dark') await page.goto(`${fixture.replace('theme:light', 'theme:dark')}&args=presentation:app`)
  await page.getByRole('button', { name: 'Browse ideas' }).click()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations).toEqual([])
})
