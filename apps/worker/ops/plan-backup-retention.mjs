const DAY = 86_400_000

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
        object.timeDeleted || (object.retentionExpirationTime && !Number.isFinite(Date.parse(object.retentionExpirationTime))) ||
        (object.retention && !Number.isFinite(Date.parse(object.retention.retainUntilTime))) ||
        typeof object.eventBasedHold !== 'boolean' || typeof object.temporaryHold !== 'boolean') {
      throw new Error('Backup state is ambiguous')
    }
    return { ...object, kind: match[1], date: match[2], created, group: match[1] === 'daily' ? match[2] : weekOf(match[2]) }
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
  const candidates = entries.filter(entry => retentionSatisfied && !keepGroups[entry.kind].has(entry.group) &&
    now.getTime() - entry.created >= (entry.kind === 'daily' ? 15 : 63) * DAY &&
    !entry.eventBasedHold && !entry.temporaryHold &&
    (!entry.retentionExpirationTime || Date.parse(entry.retentionExpirationTime) <= now.getTime()) &&
    (!entry.retention || Date.parse(entry.retention.retainUntilTime) <= now.getTime()))
    .map(({ name, generation, metageneration }) => ({ name, generation, metageneration }))
  const oldOrHeld = entries.filter(entry => now.getTime() - entry.created >= 76 * DAY || entry.eventBasedHold || entry.temporaryHold ||
    (entry.retentionExpirationTime && Date.parse(entry.retentionExpirationTime) > now.getTime()) ||
    (entry.retention && Date.parse(entry.retention.retainUntilTime) > now.getTime())).length
  return { retentionSatisfied, groupCounts, consecutive, candidates, oldOrHeld }
}
