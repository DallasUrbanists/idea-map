import { randomUUID } from 'node:crypto'
import { Storage } from '@google-cloud/storage'
import { Impersonated, type AuthClient } from 'google-auth-library'

/** A signed form is a bearer credential and must be returned only to its authorized owner. */
export interface PendingUpload {
  readonly objectName: string
  readonly expiresAt: string
  readonly url: string
  readonly fields: Readonly<Record<string, string>>
}

/** A signed PUT URL and the exact headers its recipient must send. */
export interface PendingUploadUrl {
  readonly objectName: string
  readonly expiresAt: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

type UploadOptions = { readonly contentType: string; readonly maxBytes: number; readonly expiresInSeconds: number }

/** Use a dedicated same-project signer without a downloaded service-account key. */
export function createUploadSigningStorage(projectId: string, signerEmail: string, sourceClient: AuthClient): Storage {
  const suffix = `@${projectId}.iam.gserviceaccount.com`
  const account = signerEmail.endsWith(suffix) ? signerEmail.slice(0, -suffix.length) : ''
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(account)) throw new Error('Invalid upload signer')
  const signer = new Impersonated({
    sourceClient,
    targetPrincipal: signerEmail,
    targetScopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
    lifetime: 900,
  })
  return new Storage({ projectId, authClient: signer })
}

function validateUploadOptions(bucketName: string, options: UploadOptions): void {
  if (!bucketName || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(options.contentType) ||
      !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 ||
      !Number.isInteger(options.expiresInSeconds) || options.expiresInSeconds < 1 || options.expiresInSeconds > 900) {
    throw new Error('Invalid pending upload configuration')
  }
}

/**
 * Sign a bounded, single-object POST for an already-authorized draft.
 * The caller must use a private bucket and a create-only signing identity, persist
 * the allocation, and validate the uploaded bytes and generation before review.
 */
export async function createPendingUpload(
  storage: Storage,
  bucketName: string,
  options: UploadOptions,
): Promise<PendingUpload> {
  validateUploadOptions(bucketName, options)
  const objectName = `pending/${randomUUID()}`
  const expiresAt = new Date(Math.floor((Date.now() + options.expiresInSeconds * 1000) / 1000) * 1000)
  const [signed] = await storage.bucket(bucketName).file(objectName).generateSignedPostPolicyV4({
    expires: expiresAt,
    fields: { 'Content-Type': options.contentType },
    conditions: [['content-length-range', 1, options.maxBytes]],
  })
  if (Date.now() >= expiresAt.getTime()) throw new Error('Upload authorization expired during signing')
  return { objectName, expiresAt: expiresAt.toISOString(), url: signed.url, fields: signed.fields }
}

/** Sign a bounded create-only PUT for an already-authorized draft. */
export async function createPendingUploadUrl(storage: Storage, bucketName: string, options: UploadOptions): Promise<PendingUploadUrl> {
  validateUploadOptions(bucketName, options)
  const objectName = `pending/${randomUUID()}`
  const expiresAt = new Date(Math.floor((Date.now() + options.expiresInSeconds * 1000) / 1000) * 1000)
  const headers = {
    'content-type': options.contentType,
    'x-goog-content-length-range': `1,${options.maxBytes}`,
    'x-goog-if-generation-match': '0',
  }
  const [url] = await storage.bucket(bucketName).file(objectName).getSignedUrl({
    version: 'v4', action: 'write', expires: expiresAt, contentType: options.contentType,
    extensionHeaders: { 'x-goog-content-length-range': headers['x-goog-content-length-range'], 'x-goog-if-generation-match': '0' },
  })
  if (Date.now() >= expiresAt.getTime()) throw new Error('Upload authorization expired during signing')
  return { objectName, expiresAt: expiresAt.toISOString(), url, headers }
}

/**
 * Delete one exact temporary generation after the caller has exclusively claimed
 * it, checked expiry and references, and waited until upload access expires.
 * The caller must retain that claim until the deletion outcome is recorded.
 */
export async function deletePendingUploadGeneration(storage: Storage, bucketName: string, objectName: string, generation: string): Promise<void> {
  if (!bucketName || !/^pending\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(objectName) ||
      !/^[1-9][0-9]*$/.test(generation)) throw new Error('Invalid pending upload generation')
  await storage.bucket(bucketName).file(objectName, { generation, preconditionOpts: { ifGenerationMatch: generation } }).delete({ ignoreNotFound: true })
}
