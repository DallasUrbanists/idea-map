import { expect, test } from '@playwright/test'

const revision = '11111111-1111-4111-8111-111111111111'
const holdId = '22222222-2222-4222-8222-222222222222'
const requestId = '33333333-3333-4333-8333-333333333333'
const ownerId = '44444444-4444-4444-8444-444444444444'
const payload = { revisionId: revision, version: 1, content: { text: '<img src=x onerror="window.syntheticXss=1">' }, assessmentId: null, reviewState: 'waiting',
  activeHolds: [{ id: holdId, kind: 'hold', reason: 'Synthetic hold', ownerId: null, sequence: 0 }],
  activeChangeRequests: [{ id: requestId, reason: 'Synthetic change request' }] }

async function mockReview(page, actionStatus = 200) {
  await page.route('**/api/moderation/queue*', route => route.fulfill({ json: { entries: [{ revisionId: revision, createdAt: '2031-01-01T12:00:00.123456Z', reviewState: 'waiting', version: 1 }], next: null } }))
  await page.route(`**/api/moderation/revisions/${revision}`, route => route.fulfill({ json: payload }))
  await page.route('**/api/moderation/moderators', route => route.fulfill({ json: { moderators: [{ userId: ownerId, isSelf: true }] } }))
  const actions = []
  await page.route('**/api/moderation/actions', async route => {
    actions.push({ body: route.request().postDataJSON(), headers: route.request().headers() })
    await route.fulfill({ status: actionStatus, json: actionStatus === 200 ? { outcome: 'released' } : { outcome: 'stale' } })
  })
  return actions
}

test('reviewer sees escaped content and sends only the selected authorized hold action', async ({ page }) => {
  const actions = await mockReview(page)
  await page.setViewportSize({ width: 320, height: 700 })
  const response = await page.goto('/moderation')
  expect(await response.text()).not.toContain('Synthetic hold')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  await page.getByRole('button', { name: `Review revision ${revision}` }).click()
  await expect(page.getByText('Media review is unavailable here.', { exact: false })).toBeVisible()
  await expect(page.locator('pre')).toContainText('<img src=x')
  expect(await page.locator('main img').count()).toBe(0)
  expect(await page.evaluate(() => window.syntheticXss)).toBeUndefined()
  await expect(page.getByRole('button', { name: /approve/i })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByLabel('Action').selectOption('release-hold')
  await page.getByLabel('Hold to release').selectOption(holdId)
  await page.getByLabel('Reason').fill('Synthetic resolution')
  await page.getByRole('button', { name: 'Record action' }).click()
  await expect(page.locator('main').getByRole('status')).toContainText('Action recorded')
  expect(actions).toHaveLength(1)
  expect(actions[0].body).toEqual({ action: 'release-hold', revisionId: revision, assessmentId: null, reason: 'Synthetic resolution', holdId })
  expect(actions[0].headers['x-idea-map-session']).toBe('IdeaMapSession')
  await expect(page.getByRole('heading', { name: `Revision ${revision}` })).toHaveCount(0)
})

test('escalation selects a current moderator without permitting approval', async ({ page }) => {
  const actions = await mockReview(page)
  await page.goto('/moderation')
  await page.getByRole('button', { name: `Review revision ${revision}` }).click()
  await page.getByLabel('Action').selectOption('escalate')
  await page.getByLabel('Moderator').selectOption(ownerId)
  await page.getByLabel('Reason').fill('Synthetic escalation')
  await page.getByRole('button', { name: 'Record action' }).click()
  await expect(page.locator('main').getByRole('status')).toContainText('Action recorded')
  expect(actions[0].body).toEqual({ action: 'escalate', revisionId: revision, assessmentId: null, reason: 'Synthetic escalation', ownerId })
  await expect(page.getByRole('button', { name: /approve/i })).toHaveCount(0)
})

test('stale review clears private content and requires reopening', async ({ page }) => {
  const actions = await mockReview(page, 409)
  await page.goto('/moderation')
  await page.getByRole('button', { name: `Review revision ${revision}` }).click()
  await page.getByLabel('Action').selectOption('resolve-changes')
  await page.getByLabel('Change request to resolve').selectOption(requestId)
  await page.getByLabel('Reason').fill('Synthetic resolution')
  await page.getByRole('button', { name: 'Record action' }).click()
  await expect(page.locator('main').getByRole('status')).toContainText('This review changed')
  await expect(page.locator('pre')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Record action' })).toHaveCount(0)
  expect(actions[0].body.requestId).toBe(requestId)
})

test('an unavailable owner lookup clears the private review', async ({ page }) => {
  await mockReview(page)
  await page.route('**/api/moderation/moderators', route => route.fulfill({ status: 503, json: { statusCode: 503 } }))
  await page.goto('/moderation')
  await page.getByRole('button', { name: `Review revision ${revision}` }).click()
  await expect(page.locator('pre')).toBeVisible()
  await page.getByLabel('Action').selectOption('escalate')
  await expect(page.locator('main').getByRole('status')).toContainText('Review is unavailable')
  await expect(page.locator('pre')).toHaveCount(0)
})

test('denied access and a narrow viewport remain usable without exposing content', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 600 })
  await page.route('**/api/moderation/queue*', route => route.fulfill({ status: 403, json: { statusCode: 403 } }))
  await page.goto('/moderation')
  await expect(page.locator('main').getByRole('status')).toContainText('does not currently have moderator access')
  await expect(page.locator('pre')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
