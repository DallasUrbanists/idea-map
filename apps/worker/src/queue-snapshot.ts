import type { TaskTransport } from '@idea-map/server'

// Cloud Tasks returns Z-normalized RFC 3339 timestamps with 0, 3, 6, or 9
// fractional digits. Date.parse alone accepts non-provider formats and silently
// normalizes invalid calendar dates, which could make an invalid page look healthy.
function providerTimestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(?:\d{3}|\d{6}|\d{9}))?Z$/.test(value)) {
    throw new Error('Queue timestamps are invalid')
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error('Queue timestamps are invalid')
  }
  return parsed
}

/** Estimate queue age without requesting or returning task bodies or identifiers. */
export async function readQueueSnapshot(transport: TaskTransport, queue: string, now?: Date, timeoutMs = 30_000) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 || !/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/queues\/[a-zA-Z0-9_-]+$/.test(queue) || (now && !Number.isFinite(now.getTime()))) {
    throw new Error('Invalid queue snapshot target')
  }
  const tokens = new Set<string>()
  let token = ''
  let count = 0
  let oldestCreated: number | null = null
  let latestCreated: number | null = null
  const schedules: number[] = []
  const controller = new AbortController()
  const deadline = performance.now() + timeoutMs
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Queue listing timed out')) }, timeoutMs)
  })
  try {
    do {
      if (performance.now() >= deadline) throw new Error('Queue listing timed out')
      const query = new URLSearchParams({ responseView: 'BASIC', pageSize: '1000', fields: 'tasks(createTime,scheduleTime),nextPageToken' })
      if (token) query.set('pageToken', token)
      const response = await Promise.race([transport.request('GET', `${queue}/tasks?${query}`, null, controller.signal), timeout])
      if (response.status !== 200 || !response.data || typeof response.data !== 'object') throw new Error('Queue listing failed')
      const page = response.data as { tasks?: unknown, nextPageToken?: unknown }
      if (page.tasks !== undefined && !Array.isArray(page.tasks)) throw new Error('Queue listing is ambiguous')
      for (const task of page.tasks ?? []) {
        if (!task || typeof task !== 'object') throw new Error('Queue listing is ambiguous')
        const item = task as { createTime?: unknown, scheduleTime?: unknown }
        const created = providerTimestamp(item.createTime)
        const scheduled = providerTimestamp(item.scheduleTime)
        count++
        if (count > 100_000) throw new Error('Queue listing is too large')
        oldestCreated = oldestCreated === null ? created : Math.min(oldestCreated, created)
        latestCreated = latestCreated === null ? created : Math.max(latestCreated, created)
        schedules.push(scheduled)
      }
      if (page.nextPageToken !== undefined && (typeof page.nextPageToken !== 'string' || !page.nextPageToken || tokens.has(page.nextPageToken))) {
        throw new Error('Queue pagination is ambiguous')
      }
      token = (page.nextPageToken as string | undefined) ?? ''
      if (token) tokens.add(token)
      if (tokens.size > 1000) throw new Error('Queue listing is too large')
    } while (token)
    if (performance.now() >= deadline) throw new Error('Queue listing timed out')
  } finally {
    if (timer) clearTimeout(timer)
  }
  const observed = now ?? new Date()
  if (latestCreated !== null && latestCreated > observed.getTime()) throw new Error('Queue timestamps are invalid')
  const dueSchedules = schedules.filter(scheduled => scheduled <= observed.getTime())
  const oldestDue = dueSchedules.reduce<number | null>((oldest, scheduled) => oldest === null ? scheduled : Math.min(oldest, scheduled), null)
  return { observed_at: observed.toISOString(), count, oldest_seconds: oldestCreated === null ? null : (observed.getTime() - oldestCreated) / 1000,
    due: dueSchedules.length, oldest_due_seconds: oldestDue === null ? null : (observed.getTime() - oldestDue) / 1000 }
}
