import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const docs = [
  'principles', 'tokens', 'color', 'typography', 'size-and-space',
  'containers', 'theming',
]

test('foundation docs follow the selected theme and shared typography', async ({ page }) => {
  test.setTimeout(120000)
  for (const theme of ['light', 'dark']) {
    for (const name of docs) {
      await page.goto(`/?path=/docs/foundations-${name}--docs&globals=theme:${theme}`)
      const frame = page.frameLocator('#storybook-preview-iframe')
      const html = frame.locator('html')
      const wrapper = frame.locator('.sbdocs-wrapper')
      const heading = frame.locator('.sbdocs-content h1')
      const paragraph = frame.locator('.sbdocs-content p').first()
      await expect(heading).toBeVisible()
      await expect(html).toHaveAttribute('data-theme', theme)
      await expect(wrapper).toHaveCSS('background-color', theme === 'light' ? 'rgb(242, 244, 246)' : 'rgb(34, 36, 38)')
      await expect(paragraph).toHaveCSS('color', theme === 'light' ? 'rgb(40, 50, 62)' : 'rgb(242, 244, 246)')
      await expect(paragraph).toHaveCSS('font-size', '16px')
      await expect(paragraph).toHaveCSS('font-family', /Figtree Variable/)
      await expect(heading).toHaveCSS('font-weight', '750')
      const cells = frame.locator('.sbdocs-content table th, .sbdocs-content table td')
      expect(await cells.evaluateAll(elements => elements.every(el => getComputedStyle(el).textAlign === 'left'))).toBe(true)
    }
  }
})

test('token tables include every CSS token exactly once', async ({ page }) => {
  await page.goto('/iframe.html?id=foundations-tokens--docs&viewMode=docs&globals=theme:light')
  const tables = page.locator('.token-reference')
  await expect(tables).toHaveCount(3)
  const actual = await tables.locator('tbody th code').allTextContents()
  for (const table of await tables.all()) {
    const names = await table.locator('tbody th code').allTextContents()
    expect(names).toEqual([...names].sort())
  }
  const expected = await page.evaluate(async () => {
    const css = (await import('./src/styles/tokens.css?raw')).default
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    const names = new Set()
    function collect(rules) {
      for (const rule of rules) {
        if (rule.style && rule.selectorText) {
          for (const name of rule.style) {
            if (name.startsWith('--')) names.add(name)
          }
        } else if (rule.cssRules) {
          collect(rule.cssRules)
        }
      }
    }
    collect(sheet.cssRules)
    return [...names]
  })
  expect(actual).toHaveLength(expected.length)
  expect([...actual].sort()).toEqual(expected.sort())
  await expect(page.getByRole('table', { name: 'Color tokens' })).toHaveCount(1)
  await expect(page.getByRole('table', { name: 'Motion tokens' })).toHaveCount(1)
  await expect(page.getByRole('table', { name: 'Global tokens' })).toHaveCount(1)
  await expect(page.getByRole('table', { name: 'Color tokens' }).locator('tbody tr').nth(1)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.getByRole('table', { name: 'Motion tokens' }).locator('tbody tr').nth(1)).toHaveCSS('background-color', 'rgb(232, 237, 243)')
  await expect(page.getByRole('table', { name: 'Global tokens' }).locator('tbody tr').nth(1)).toHaveCSS('background-color', 'rgb(232, 237, 243)')
})

test('motion guidance is included in Tokens and consolidated docs replace old entries', async ({ page }) => {
  await page.goto('/iframe.html?id=foundations-tokens--docs&viewMode=docs&globals=theme:light')
  await expect(page.getByText(/Use motion to explain a change of state/)).toContainText('170ms')
  await expect(page.getByText(/Respect reduced-motion preferences/)).toBeVisible()
  await expect(page.getByRole('link', { name: "Signal's motion guidance" })).toHaveAttribute('href', 'https://signal.chitransit.app/foundations/motion')
  const index = await (await page.request.get('/index.json')).json()
  expect(index.entries).toHaveProperty('foundations-containers--docs')
  for (const name of ['motion', 'radius', 'elevation']) {
    expect(index.entries).not.toHaveProperty(`foundations-${name}--docs`)
  }
})

test('token tables show matching theme and motion values', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
  await page.goto('/iframe.html?id=foundations-tokens--docs&viewMode=docs&globals=theme:light')
  const colors = page.getByRole('table', { name: 'Color tokens' })
  await expect(colors).toBeVisible()
  for (const theme of ['light', 'dark']) {
    const errors = await colors.evaluate((table, activeTheme) => {
      const root = document.documentElement
      root.dataset.theme = activeTheme
      const styles = getComputedStyle(root)
      const errors = []
      for (const row of table.tBodies[0].rows) {
        const name = row.querySelector('th code').textContent
        const cells = [...row.querySelectorAll('td')]
        const cell = cells.length === 1 ? cells[0] : cells[activeTheme === 'light' ? 0 : 1]
        const probe = document.createElement('span')
        probe.style.background = styles.getPropertyValue(name).trim()
        if (cell.style.background !== probe.style.background) errors.push(name)
        if (cells.length === 1 && cell.colSpan !== 2) errors.push(`${name}: missing colspan`)
        if (cells.length === 2 && cells[0].style.background === cells[1].style.background) errors.push(`${name}: shared value is not merged`)
      }
      return errors
    }, theme)
    expect(errors).toEqual([])
  }
  const motion = page.getByRole('table', { name: 'Motion tokens' })
  for (const reduced of [false, true]) {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: reduced ? 'reduce' : 'no-preference' })
    const errors = await motion.evaluate((table, isReduced) => {
      const styles = getComputedStyle(document.documentElement)
      return [...table.tBodies[0].rows].filter(row => {
        const name = row.querySelector('th code').textContent
        return row.cells[isReduced ? 2 : 1].innerText.trim() !== styles.getPropertyValue(name).trim()
      }).map(row => row.querySelector('th code').textContent)
    }, reduced)
    expect(errors).toEqual([])
  }
  const gradient = colors.getByRole('row', { name: /^--page-background / })
  await expect(gradient.locator('td')).toHaveCount(2)
  await expect(motion.getByRole('row', { name: /^--motion-fast / })).toContainText('150ms')
  await expect(motion.getByRole('row', { name: /^--motion-fast / })).toContainText('0ms')
  const invalidGlobals = await page.getByRole('table', { name: 'Global tokens' }).evaluate(table => {
    const root = document.documentElement
    root.dataset.theme = 'light'
    const light = getComputedStyle(root)
    const values = [...table.tBodies[0].rows].map(row => {
      const name = row.querySelector('th code').textContent
      return [name, light.getPropertyValue(name).trim()]
    })
    root.dataset.theme = 'dark'
    const dark = getComputedStyle(root)
    return values.filter(([name, value]) => dark.getPropertyValue(name).trim() !== value).map(([name]) => name)
  })
  expect(invalidGlobals).toEqual([])
})

test('token reader resolves CSS changes and theme aliases', async ({ page }) => {
  await page.goto('/iframe.html?id=foundations-tokens--docs&viewMode=docs&globals=theme:light')
  const result = await page.evaluate(async () => {
    const { createTokenReader } = await import('./stories/foundations/token-reference.js')
    const reader = createTokenReader(`
      :root { --palette-day: #123; --palette-night: rgb(15, 25, 35); --alias: var(--palette-day); --color-test: var(--alias); --motion-test: 1s; }
      :root[data-theme="dark"] { --alias: var(--palette-night); }
      @media (prefers-reduced-motion: reduce) { :root { --motion-test: 0s; } }
    `)
    return {
      light: reader.getColorValue('--color-test'),
      dark: reader.getColorValue('--color-test', 'dark'),
      palette: reader.getPaletteToken('--color-test', 'dark'),
      motion: reader.getTokenDefinitions().find(token => token.name === '--motion-test').declarations,
      motionValues: reader.getTokenGroups().motion.find(token => token.name === '--motion-test'),
    }
  })
  expect(result.light).toBe('#112233')
  expect(result.dark).toBe('#0F1923')
  expect(result.palette).toBe('--palette-night')
  expect(result.motion.map(item => item.value)).toEqual(['1s', '0s'])
  expect(result.motion[1].condition).toContain('prefers-reduced-motion')
  expect(result.motionValues).toEqual({ name: '--motion-test', standard: '1s', reduced: '0s' })
})

test('typography tables show the font tokens with their intended sizes', async ({ page }) => {
  await page.goto('/iframe.html?id=foundations-typography--docs&viewMode=docs&globals=theme:light')
  const tables = page.locator('.sbdocs-content table')
  await expect(tables).toHaveCount(2)
  await expect(tables.first().locator('thead th')).toHaveText(['Token', 'Sample', 'Size / weight', 'Use'])
  const rows = tables.first().locator('tbody tr')
  await expect(rows.locator('th')).toHaveText(['--font-title', '--font-heading', '--font-body', '--font-small', '--font-caption'])
  const expected = ['32px', '20px', '16px', '13px', '11px']
  for (let i = 0; i < expected.length; i++) {
    const sample = rows.nth(i).locator('td span')
    await expect(sample).toHaveCSS('font-size', expected[i])
    await expect(sample).toHaveCSS('font-family', /Figtree Variable/)
  }
  await expect(tables.nth(1).locator('tbody th')).toHaveText([
    '--weight-regular', '--weight-medium', '--weight-semibold', '--weight-bold', '--weight-heavy',
  ])
})

test('spacing and container samples use sorted token values', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto(`/iframe.html?id=foundations-size-and-space--docs&viewMode=docs&globals=theme:${theme}`)
    const table = page.getByRole('region', { name: 'Spacing tokens' }).locator('table')
    await expect(table).toBeVisible()
    const rows = await table.locator('tbody tr').evaluateAll(elements => elements.map(row => ({
      token: row.querySelector('th code').textContent,
      value: row.cells[2].innerText.trim(),
      actual: getComputedStyle(document.documentElement).getPropertyValue(row.querySelector('th code').textContent).trim(),
      sample: getComputedStyle(row.querySelector('.spacing-sample')).width,
      hidden: row.querySelector('.spacing-sample').getAttribute('aria-hidden'),
    })))
    expect(rows).toHaveLength(21)
    const names = rows.map(row => row.token)
    expect(names).toEqual([...names].sort())
    for (const row of rows) {
      expect(row.value).toBe(row.actual)
      expect(row.sample).toBe(row.actual)
      expect(row.hidden).toBe('true')
    }
    await expect(page.getByRole('region', { name: 'Radius tokens' })).toHaveCount(0)
    await page.goto(`/iframe.html?id=foundations-containers--docs&viewMode=docs&globals=theme:${theme}`)
    const containers = page.getByRole('region', { name: 'Container classes' }).locator('table')
    await expect(containers).toBeVisible()
    await expect(containers.locator('thead th')).toHaveText(['Class', 'Sample', 'Radius', 'Shadow', 'Use'])
    const containerRows = await containers.locator('tbody tr').evaluateAll(elements => elements.map(row => {
      const sample = row.querySelector('.container-sample')
      const probe = document.createElement('span')
      probe.style.boxShadow = row.cells[3].innerText.trim()
      document.body.appendChild(probe)
      const expectedShadow = getComputedStyle(probe).boxShadow
      probe.remove()
      return {
        name: row.querySelector('th code').textContent,
        hasClass: sample.matches(row.querySelector('th code').textContent),
        radius: row.cells[2].innerText.trim(),
        sampleRadius: getComputedStyle(sample).borderTopLeftRadius,
        sampleShadow: getComputedStyle(sample).boxShadow,
        expectedShadow,
        hidden: sample.getAttribute('aria-hidden'),
        use: row.cells[4].innerText.trim(),
      }
    }))
    expect(containerRows).toHaveLength(6)
    expect(containerRows.map(row => row.name)).toEqual([
      '.contain-chip', '.contain-card', '.contain-control',
      '.contain-floating', '.contain-dialog', '.contain-pill',
    ])
    for (const heading of await containers.locator('th').all()) {
      await expect(heading).toHaveCSS('white-space', 'nowrap')
    }
    for (const row of containerRows) {
      expect(row.hasClass).toBe(true)
      expect(row.sampleRadius).toBe(row.radius)
      expect(row.sampleShadow).toBe(row.expectedShadow)
      expect(row.hidden).toBe('true')
      expect(row.use).toMatch(/^Use .+\.$/)
    }
  }
})

test('toolbar changes and reloads update standalone docs', async ({ page }) => {
  await page.goto('/?path=/docs/foundations-principles--docs&globals=theme:light')
  const frame = page.frameLocator('#storybook-preview-iframe')
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: /Color theme for the component preview/ }).click()
  await page.getByRole('option', { name: 'dark', exact: true }).click()
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(frame.locator('.sbdocs-wrapper')).toHaveCSS('background-color', 'rgb(34, 36, 38)')
  await page.reload()
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(frame.locator('.sbdocs-content p').first()).toHaveCSS('color', 'rgb(242, 244, 246)')
})

test('system theme follows the operating system preference', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/?path=/docs/foundations-principles--docs&globals=theme:system')
  const frame = page.frameLocator('#storybook-preview-iframe')
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'system')
  await expect(frame.locator('.sbdocs-wrapper')).toHaveCSS('background-color', 'rgb(34, 36, 38)')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(frame.locator('.sbdocs-wrapper')).toHaveCSS('background-color', 'rgb(242, 244, 246)')
  await expect(frame.locator('.sbdocs-content p').first()).toHaveCSS('color', 'rgb(40, 50, 62)')
})

test('dark color-reference tables preserve readable swatches without striping', async ({ page }) => {
  await page.goto('/?path=/docs/foundations-color--docs&globals=theme:dark')
  const frame = page.frameLocator('#storybook-preview-iframe')
  const table = frame.locator('.color-reference').first()
  await expect(table).toBeVisible()
  await expect(table.locator('tbody tr').nth(1)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const swatch = table.locator('td[style]').first()
  await expect(swatch).toHaveCSS('background-color', 'rgb(242, 244, 246)')
  await expect(swatch).toHaveCSS('color', 'rgb(40, 50, 62)')
  await expect(table.locator('tbody tr').first().locator('td').last()).toHaveCSS('color', 'rgb(242, 244, 246)')
})

test('documentation uses hard borders under headings and soft table borders', async ({ page }) => {
  for (const [theme, hard, soft] of [
    ['light', 'rgb(123, 135, 148)', 'rgb(215, 222, 230)'],
    ['dark', 'rgb(131, 145, 162)', 'rgb(70, 84, 99)'],
  ]) {
    await page.goto(`/?path=/docs/foundations-color--docs&globals=theme:${theme}`)
    const frame = page.frameLocator('#storybook-preview-iframe')
    await expect(frame.locator('.sbdocs-content h2').first()).toHaveCSS('border-bottom-color', hard)
    const table = frame.locator('.color-reference').first()
    await expect(table.locator('thead th').first()).toHaveCSS('border-bottom-color', hard)
    await expect(table.locator('thead th').first()).toHaveCSS('border-top-color', soft)
    await expect(table.locator('tbody td').first()).toHaveCSS('border-bottom-color', soft)
  }
})

test('thematic color entries use the documented fixed palette tokens', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto(`/?path=/docs/foundations-color--docs&globals=theme:${theme}`)
    const table = page.frameLocator('#storybook-preview-iframe').locator('.color-reference').first()
    await expect(table).toBeVisible()
    const rows = await table.locator('tbody tr').all()
    expect(rows).toHaveLength(23)
    for (const row of rows) {
      const token = await row.locator('th code').innerText()
      const cell = row.locator('td').first()
      const hex = (await cell.innerText()).trim()
      expect(token).toMatch(/^--palette-/)
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
      await expect(cell).toHaveAttribute('style', new RegExp(`background-color: var\\(${token}\\)`))
      const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16))
      await expect(cell).toHaveCSS('background-color', `rgb(${rgb.join(', ')})`)
    }
  }
})

test('UI color assignments reference the palette and match semantic tokens', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto(`/?path=/docs/foundations-color--docs&globals=theme:${theme}`)
    const frame = page.frameLocator('#storybook-preview-iframe')
    const tables = frame.locator('.color-reference')
    await expect(tables.first().locator('tbody tr')).toHaveCount(23)
    const palette = await tables.first().locator('tbody th code').allTextContents()
    await expect(tables.nth(1).locator('tbody tr')).toHaveCount(18)
    const rows = await tables.nth(1).locator('tbody tr').all()
    expect(rows).toHaveLength(18)
    for (const row of rows) {
      const semantic = await row.locator('th code').innerText()
      expect(semantic).toMatch(/^--color-/)
      const cells = row.locator('td')
      for (const cell of await cells.all()) {
        const token = await cell.locator('code').innerText()
        expect((await cell.innerText()).trim()).toBe(token)
        expect(palette).toContain(token)
        await expect(cell).toHaveAttribute('style', new RegExp(`background-color: var\\(${token}\\)`))
      }
      const activeCell = cells.nth(theme === 'light' ? 0 : 1)
      const values = await activeCell.evaluate((cell, name) => {
        const root = getComputedStyle(document.documentElement)
        const probe = document.createElement('span')
        probe.style.color = `var(${name})`
        document.body.appendChild(probe)
        const result = [getComputedStyle(cell).backgroundColor, getComputedStyle(probe).color, root.getPropertyValue(name)]
        probe.remove()
        return result
      }, semantic)
      expect(values[2].trim()).not.toBe('')
      expect(values[0]).toBe(values[1])
    }
  }
})

test('map and chart swatches display their CSS tokens and theme values', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto(`/?path=/docs/foundations-color--docs&globals=theme:${theme}`)
    const tables = page.frameLocator('#storybook-preview-iframe').locator('.color-reference')
    for (const [index, prefix, count] of [[2, '--map-|--location', 10], [3, '--chart-', 8]]) {
      await expect(tables.nth(index).locator('tbody tr')).toHaveCount(count)
      const rows = await tables.nth(index).locator('tbody tr').all()
      expect(rows).toHaveLength(count)
      for (const row of rows) {
        const token = await row.locator('th code').innerText()
        expect(token).toMatch(new RegExp(`^(?:${prefix})`))
        const cells = row.locator('td')
        for (const cell of await cells.all()) {
          expect((await cell.innerText()).trim()).toMatch(/^#[0-9a-f]{6}$/i)
        }
        const activeCell = cells.nth(theme === 'light' ? 0 : 1)
        const colors = await activeCell.evaluate((cell, name) => {
          const probe = document.createElement('span')
          probe.style.color = `var(${name})`
          document.body.appendChild(probe)
          const result = [getComputedStyle(cell).backgroundColor, getComputedStyle(probe).color]
          probe.remove()
          return result
        }, token)
        expect(colors[0]).toBe(colors[1])
      }
    }
  }
})

test('DART reference swatches display their fixed tokens and values', async ({ page }) => {
  const busValues = {
    '--dart-bus-local-yellow': '#FFCC00',
    '--dart-bus-local-purple': '#794489',
    '--dart-bus-local-cyan': '#6BCCE7',
    '--dart-bus-express-pink': '#F280A4',
    '--dart-bus-shuttle-green': '#98CC67',
  }
  for (const theme of ['light', 'dark']) {
    await page.goto(`/?path=/docs/foundations-color--docs&globals=theme:${theme}`)
    const tables = page.frameLocator('#storybook-preview-iframe').locator('.color-reference')
    const table = tables.nth(4)
    await expect(table).toHaveAttribute('aria-label', 'DART public transit colors')
    await expect(table.locator('tbody tr')).toHaveCount(10)
    for (const row of await table.locator('tbody tr').all()) {
      const token = await row.locator('th code').innerText()
      const cell = row.locator('td')
      const hex = (await cell.innerText()).trim()
      expect(token).toMatch(/^--dart-(rail-(red|blue|green|orange|silver)|bus-(local-(yellow|purple|cyan)|express-pink|shuttle-green))$/)
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
      if (token.startsWith('--dart-bus-')) expect(hex).toBe(busValues[token])
      await expect(cell).toHaveAttribute('style', new RegExp(`background-color: var\\(${token}\\)`))
      const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16))
      await expect(cell).toHaveCSS('background-color', `rgb(${rgb.join(', ')})`)
    }
  }
})

test('docs reflow on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  for (const name of docs) {
    await page.goto(`/?path=/docs/foundations-${name}--docs&globals=theme:dark`)
    const frame = page.frameLocator('#storybook-preview-iframe')
    await expect(frame.locator('.sbdocs-content h1')).toBeVisible()
    const overflow = await frame.locator('html').evaluate(el => el.scrollWidth > el.clientWidth)
    expect(overflow, name).toBe(false)
  }
})

test('token tables can be scrolled with a keyboard on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/iframe.html?id=foundations-tokens--docs&viewMode=docs&globals=theme:light')
  const table = page.getByRole('table', { name: 'Color tokens' })
  await expect(table).toBeVisible()
  expect(await table.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  await table.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  expect(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
})

test('color table tokens and values stay on one line and scroll by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/iframe.html?id=foundations-color--docs&viewMode=docs&globals=theme:dark')
  const tables = page.locator('.color-reference')
  await expect(tables).toHaveCount(5)
  for (const table of await tables.all()) {
    await expect(table).toHaveAttribute('tabindex', '0')
    const cells = table.locator('tbody th code, tbody td[style]')
    for (const cell of await cells.all()) await expect(cell).toHaveCSS('white-space', 'nowrap')
  }
  const table = tables.nth(1)
  expect(await table.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  await table.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  expect(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
})

for (const theme of ['light', 'dark']) {
  for (const name of ['principles', 'tokens', 'color', 'size-and-space', 'containers']) {
    test(`${name} docs pass accessibility checks in ${theme} mode`, async ({ page }) => {
      test.setTimeout(120000)
      await page.goto(`/iframe.html?id=foundations-${name}--docs&viewMode=docs&globals=theme:${theme}`)
      await expect(page.locator('.sbdocs-content h1')).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const results = await new AxeBuilder({ page }).include('.sbdocs-content')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      expect(results.violations).toEqual([])
    })
  }
}
