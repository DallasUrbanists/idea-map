import { createError, defineEventHandler, getHeader, setResponseHeader } from 'h3'
import { deliveryEventStore, receiveDeliveryWebhook } from '@idea-map/server'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  if (!config.resendWebhookSecret || !config.databaseUrl) {
    throw createError({ statusCode: 503, statusMessage: 'Webhook unavailable' })
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 256 * 1024) throw createError({ statusCode: 413, statusMessage: 'Request too large' })
    chunks.push(bytes)
  }
  const result = await receiveDeliveryWebhook({
    payload: Buffer.concat(chunks).toString('utf8'),
    id: getHeader(event, 'svix-id') ?? '',
    timestamp: getHeader(event, 'svix-timestamp') ?? '',
    signature: getHeader(event, 'svix-signature') ?? '',
  }, config.resendWebhookSecret, deliveryEventStore(config.databaseUrl))
  if (result === 'invalid') throw createError({ statusCode: 400, statusMessage: 'Invalid webhook' })
  if (result === 'retry') throw createError({ statusCode: 503, statusMessage: 'Webhook unavailable' })
  return { ok: true }
})
