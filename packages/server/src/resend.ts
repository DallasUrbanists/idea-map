import { Resend } from 'resend'

/** A transactional email prepared and authorized by the calling worker. */
export interface TransactionalEmail {
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly text: string
}

/** Provider acceptance is not confirmation of delivery. */
export type EmailSubmission =
  | { readonly status: 'accepted'; readonly providerId: string }
  | { readonly status: 'rejected'; readonly httpStatus: number }
  | { readonly status: 'unknown' }

/** Send one prepared email. The caller must persist the request and key before sending. */
export async function sendTransactionalEmail(
  client: Pick<Resend, 'emails'>,
  message: TransactionalEmail,
  idempotencyKey: string,
): Promise<EmailSubmission> {
  if (!/^[\x21-\x7e]{1,256}$/.test(idempotencyKey)) throw new Error('Invalid email idempotency key')
  try {
    const result = await client.emails.send(message, { idempotencyKey })
    if (result.error) {
      const status = result.error.statusCode
      // Network errors, server failures, and concurrent requests may have sent mail.
      if (status == null || status >= 500 || status === 409) return { status: 'unknown' }
      return { status: 'rejected', httpStatus: status }
    }
    if (!result.data || typeof result.data.id !== 'string' || !result.data.id) return { status: 'unknown' }
    return { status: 'accepted', providerId: result.data.id }
  } catch {
    // A transport failure does not establish whether the provider accepted the email.
    return { status: 'unknown' }
  }
}

const deliveryTypes = new Set([
  'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced',
  'email.complained', 'email.failed', 'email.suppressed',
])

/** Minimal verified delivery event; it intentionally excludes message and recipient data. */
export interface DeliveryEvent {
  readonly eventId: string
  readonly emailId: string
  readonly type: string
  readonly occurredAt: string
}

/** The store must atomically deduplicate eventId and durably persist before returning. */
export interface DeliveryEventStore {
  insert(event: DeliveryEvent): Promise<'inserted' | 'duplicate'>
}

export type DeliveryWebhookResult = 'stored' | 'duplicate' | 'ignored' | 'invalid' | 'retry'

/** Verify a raw Resend webhook and persist its minimal delivery event before acknowledgement. */
export async function receiveDeliveryWebhook(
  input: { readonly payload: string; readonly id: string; readonly timestamp: string; readonly signature: string },
  webhookSecret: string,
  store: DeliveryEventStore,
): Promise<DeliveryWebhookResult> {
  if (!webhookSecret || !input.id || input.id.length > 256 || !input.timestamp || !input.signature ||
      Buffer.byteLength(input.payload, 'utf8') > 256 * 1024) return 'invalid'

  let value: unknown
  try {
    // Verification is local and does not use a sending credential or make an API call.
    const verifier = new Resend('webhook-verification-only')
    value = verifier.webhooks.verify({ payload: input.payload, webhookSecret, headers: {
      id: input.id, timestamp: input.timestamp, signature: input.signature,
    } })
  } catch {
    return 'invalid'
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid'
  const event = value as Record<string, unknown>
  if (typeof event.type !== 'string') return 'invalid'
  if (!deliveryTypes.has(event.type)) return 'ignored'
  if (typeof event.created_at !== 'string' || !Number.isFinite(Date.parse(event.created_at)) ||
      !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return 'invalid'
  const emailId = (event.data as Record<string, unknown>).email_id
  if (typeof emailId !== 'string' || emailId.length === 0 || emailId.length > 256) return 'invalid'
  try {
    const result = await store.insert({ eventId: input.id, emailId, type: event.type, occurredAt: event.created_at })
    if (result === 'inserted') return 'stored'
    if (result === 'duplicate') return 'duplicate'
    return 'retry'
  } catch {
    return 'retry'
  }
}
