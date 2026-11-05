const DAY = 86_400_000

function retentionTime(value) {
  if (typeof value !== 'string') return NaN
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return NaN
  const [, y, m, d, h, min, sec, fraction = '', zone] = match
  const year = Number(y), month = Number(m), day = Number(d)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      Number(h) > 23 || Number(min) > 59 || Number(sec) > 59 ||
      (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) return NaN
  const milliseconds = Date.parse(value)
  // Date.parse truncates finer precision. Round upward so an unexpired
  // sub-millisecond retention window cannot become a deletion candidate.
  return milliseconds + (/[1-9]/.test(fraction.slice(3)) ? 1 : 0)
}

function weekOf(date) {
  const day = new Date(`${date}T00:00:00.000Z`)
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day.toISOString().slice(0, 10)
}

/** Plan, but do not delete, old generations from a complete isolated inventory. */
export function planBackupRetention({ environment, complete, objects, now = new Date() }) {
  if (!['dev', 'prod'].includes(environment) || complete !== true || !Array.isArray(objects) || !Number.isFinite(now.getTime())) {
    throw new Error('A complete backup inventory is required')
  }
  const seen = new Set()
  const entries = objects.map(object => {
    const prefix = `idea-map-v2/${environment}/`
    if (!object.name?.startsWith(prefix)) throw new Error('Inventory contains an unexpected object')
    const match = /^(daily|weekly)\/(\d{4}-\d{2}-\d{2})\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.pgdump$/.exec(object.name.slice(prefix.length))
    if (!match || typeof object.generation !== 'string' || !/^[1-9][0-9]*$/.test(object.generation) ||
        typeof object.metageneration !== 'string' || !/^[1-9][0-9]*$/.test(object.metageneration) || seen.has(object.name)) throw new Error('Ambiguous backup generation')
    seen.add(object.name)
    const midnight = Date.parse(`${match[2]}T00:00:00.000Z`)
    const created = Date.parse(object.timeCreated)
    if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== match[2] ||
        !Number.isFinite(created) || created < midnight || created >= midnight + 2 * DAY || created > now.getTime() ||
        object.timeDeleted || (object.retentionExpirationTime !== undefined &&
          !Number.isFinite(retentionTime(object.retentionExpirationTime))) ||
        (object.retention !== undefined && (!object.retention || typeof object.retention !== 'object' || Array.isArray(object.retention) ||
          !['Locked', 'Unlocked'].includes(object.retention.mode) || !Number.isFinite(retentionTime(object.retention.retainUntilTime)))) ||
        typeof object.eventBasedHold !== 'boolean' || typeof object.temporaryHold !== 'boolean') {
      throw new Error('Backup state is ambiguous')
    }
    return { ...object, kind: match[1], date: match[2], created, earliestStart: midnight, group: match[1] === 'daily' ? match[2] : weekOf(match[2]) }
  })
  const keepGroups = {}
  const groupCounts = {}
  const consecutive = {}
  let retentionSatisfied = true
  for (const [kind, minimum] of [['daily', 14], ['weekly', 8]]) {
    const groups = [...new Set(entries.filter(entry => entry.kind === kind).map(entry => entry.group))].sort().reverse()
    groupCounts[kind] = groups.length
    const start = groups.length ? Date.parse(`${groups[0]}T00:00:00.000Z`) : NaN
    const step = kind === 'daily' ? DAY : 7 * DAY
    consecutive[kind] = groups.length >= minimum && groups.slice(0, minimum).every((group, index) =>
      group === new Date(start - index * step).toISOString().slice(0, 10))
    if (!consecutive[kind]) retentionSatisfied = false
    keepGroups[kind] = new Set(groups.slice(0, minimum))
  }
  // Upload completion time is only a necessary freshness check: the caller
  // must separately verify the actual backup start and completion record.
  const recentDaily = entries.some(entry => entry.kind === 'daily' && now.getTime() - entry.created <= DAY)
  const recentWeekly = entries.some(entry => entry.kind === 'weekly' && now.getTime() - entry.created <= 7 * DAY)
  const candidates = entries.filter(entry => retentionSatisfied && recentDaily && recentWeekly && !keepGroups[entry.kind].has(entry.group) &&
    now.getTime() - entry.created >= (entry.kind === 'daily' ? 15 : 63) * DAY &&
    !entry.eventBasedHold && !entry.temporaryHold &&
    (!entry.retentionExpirationTime || retentionTime(entry.retentionExpirationTime) <= now.getTime()) &&
    (!entry.retention || retentionTime(entry.retention.retainUntilTime) <= now.getTime()))
    .map(({ name, generation, metageneration }) => ({ name, generation, metageneration }))
  const oldOrHeld = entries.filter(entry => now.getTime() - entry.created >= 76 * DAY || entry.eventBasedHold || entry.temporaryHold ||
    (entry.retentionExpirationTime && retentionTime(entry.retentionExpirationTime) > now.getTime()) ||
    (entry.retention && retentionTime(entry.retention.retainUntilTime) > now.getTime())).length
  // Fourteen days for primary deletion and seven for soft delete leave at most
  // 69 days before an archive needs attention. The date in its name gives
  // a conservative earliest start, even if upload completed much later. This
  // does not prove that a particular archive contains a removed item or that
  // it will expire on time.
  const expiryAttention = entries.filter(entry => now.getTime() - entry.earliestStart >= 69 * DAY).length
  return { retentionSatisfied, privacyDeadlineVerified: false, groupCounts, consecutive, candidates, oldOrHeld, expiryAttention }
}
