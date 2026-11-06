import { readGuardedPublishedIdea, type PublicAccessLease } from '@idea-map/server'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Idea not found' })
  }
  const databaseUrl = useRuntimeConfig(event).databaseUrl
  const lease = event.context.publicAccessLease as PublicAccessLease | undefined
  if (!databaseUrl || !lease || lease.signal.aborted) throw createError({ statusCode: 503, statusMessage: 'Idea service unavailable' })
  try {
    const idea = await readGuardedPublishedIdea(id, lease)
    if (idea) return idea
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Idea service unavailable' })
  }
  throw createError({ statusCode: 404, statusMessage: 'Idea not found' })
})
