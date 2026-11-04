type DatabaseSnapshot = {
  public_access_open: boolean
  backlog: { unpublished: number, oldest_seconds: number | null }
  overdue: { count: number, oldest_seconds: number | null }
  email: { failed: number, bounced: number, suppressed: number, delayed: number, complained: number }
}
type QueueSnapshot = { count: number, oldest_seconds: number | null, due: number, oldest_due_seconds: number | null }
type Thresholds = { backlogSeconds: number, overdueSeconds: number, queueSeconds: number, emailEvents: number }

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function age(value: unknown, total: number): value is number | null {
  return total === 0 ? value === null : typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Evaluate aggregates without returning job IDs, message details, or provider responses. */
export function assessOperations(database: DatabaseSnapshot, queue: QueueSnapshot, thresholds: Thresholds): string[] {
  if (!database?.backlog || !database.overdue || !database.email || !queue || !thresholds ||
      ![thresholds.backlogSeconds, thresholds.overdueSeconds, thresholds.queueSeconds, thresholds.emailEvents]
        .every(value => Number.isSafeInteger(value) && value > 0) ||
      typeof database.public_access_open !== 'boolean' ||
      !count(database.backlog.unpublished) || !age(database.backlog.oldest_seconds, database.backlog.unpublished) ||
      !count(database.overdue.count) || !age(database.overdue.oldest_seconds, database.overdue.count) ||
      !count(queue.count) || !age(queue.oldest_seconds, queue.count) || !count(queue.due) || queue.due > queue.count ||
      !age(queue.oldest_due_seconds, queue.due) ||
      !['failed', 'bounced', 'suppressed', 'delayed', 'complained'].every(key => count(database.email[key as keyof DatabaseSnapshot['email']]))) {
    throw new Error('Operations aggregates are invalid')
  }
  const alerts: string[] = []
  if (!database.public_access_open) alerts.push('public_access_closed')
  if (database.backlog.oldest_seconds !== null && database.backlog.oldest_seconds >= thresholds.backlogSeconds) alerts.push('outbox_age')
  if (database.overdue.oldest_seconds !== null && database.overdue.oldest_seconds >= thresholds.overdueSeconds) alerts.push('overdue_age')
  if (queue.oldest_seconds !== null && queue.oldest_seconds >= thresholds.queueSeconds) alerts.push('queue_age')
  if (queue.oldest_due_seconds !== null && queue.oldest_due_seconds >= thresholds.queueSeconds) alerts.push('queue_due_age')
  if (['failed', 'bounced', 'suppressed', 'delayed', 'complained']
    .some(key => database.email[key as keyof DatabaseSnapshot['email']] >= thresholds.emailEvents)) alerts.push('email_events')
  return alerts
}

/** Emit a completion marker even when thresholds are breached. */
export function operationsEvents(alerts: string[]) {
  const events = alerts.length
    ? alerts.map(signal => ({ severity: 'WARNING', event: 'operations_threshold_breached', signal }))
    : [{ severity: 'INFO', event: 'operations_assessment_healthy' }]
  return [...events, { severity: 'INFO', event: 'operations_assessment_completed' }]
}
