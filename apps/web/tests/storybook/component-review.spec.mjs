import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('review guidance keeps new patterns Draft and names evidence gaps', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/iframe.html?id=foundations-before-you-contribute--docs&viewMode=docs&globals=theme:light')
  const content = page.locator('.sbdocs-content')
  await expect(content.getByRole('heading', { name: 'Before you contribute' })).toBeVisible()
  await expect(content.getByRole('heading', { name: 'Ready checklist' })).toBeVisible()
  await expect(content).toContainText('answer yes to every question before requesting design review')
  const checklist = content.getByRole('region', { name: 'Review checklist' }).getByRole('table')
  await expect(checklist.getByRole('columnheader')).toHaveText(['Review question', 'How to check'])
  const rows = checklist.locator('tbody tr')
  await expect(rows).toHaveCount(24)
  for (const row of await rows.all()) {
    await expect(row.getByRole('rowheader')).toContainText(/\?$/)
    await expect(row.getByRole('cell')).not.toBeEmpty()
  }
  const answers = content.getByRole('region', { name: 'Questions and answers' }).getByRole('table')
  await expect(answers.getByRole('columnheader')).toHaveText(['Question', 'Answer'])
  await expect(answers.locator('tbody tr')).toHaveCount(8)
  await expect(answers).toContainText("don't prove that a screen reader or touch device works well")
  await expect(answers).toContainText('return the changed pattern to Draft')
  await expect(answers).toContainText("aren't approved visual baselines")
  await expect(answers).toContainText('who will follow up')
  await expect(content).toContainText('project maintainer @hexel on GitHub')
  await expect(content.getByText('Tip: Check with AI.', { exact: false }).first()).toBeVisible()
  await expect(content.getByText('Tip: Request review with AI.', { exact: false }).first()).toBeVisible()
  await expect(content).toContainText("don't implement fixes or change files")
  await expect(content).toContainText('If any answer is no or unverified, stop')
  await expect(content).toContainText('tag @hexel for design review')
  const steps = content.locator('ol').first().getByRole('listitem')
  await expect(steps).toHaveCount(5)
  await expect(steps.nth(0)).toContainText('create a working branch')
  await expect(steps.nth(1)).toContainText('Commit your changes')
  await expect(steps.nth(3)).toContainText('Open a pull request')
  await expect(steps.nth(4)).toContainText('Tag @hexel')
  await expect(content.locator('iframe')).toHaveCount(0)
  await expect(content.getByRole('link', { name: 'component review guide' })).toHaveCount(0)
  expect(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
  expect((await new AxeBuilder({ page }).include('.sbdocs-content').analyze()).violations).toEqual([])
})

for (const width of [320, 1280]) {
  test(`review checklist remains accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/iframe.html?id=foundations-before-you-contribute--docs&viewMode=docs&globals=theme:light')
    for (const name of ['Review checklist', 'Questions and answers']) {
      const region = page.getByRole('region', { name })
      await region.focus()
      await expect(region).toBeFocused()
      if (await region.evaluate(el => el.scrollWidth > el.clientWidth)) {
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
      }
    }
    expect(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
  })
}

test('review page is last in the Foundations sidebar', async ({ page }) => {
  await page.goto('/?path=/docs/foundations-before-you-contribute--docs')
  const review = page.getByRole('link', { name: 'Before you contribute', exact: true })
  await expect(review).toBeVisible()
  for (const name of ['Overview', 'Principles', 'Tokens', 'Color', 'Typography', 'Size and space', 'Containers', 'Theming']) {
    const item = page.getByRole('link', { name, exact: true })
    await expect(item).toBeVisible()
    expect(await item.evaluate((element, target) => Boolean(element.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING), await review.elementHandle())).toBe(true)
  }
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
