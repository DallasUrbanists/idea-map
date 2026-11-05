import { CRC32C } from '@google-cloud/storage'
import { compareUnverifiedRecoverySequence, decodeRecoverySequenceEntry } from './recovery-sequence.js'

type Target = { environment: 'dev' | 'prod', epochId: string, projectNumber: string, secretId: string }
export interface RecoverySequenceTransport {
  request(method: 'POST' | 'GET', path: string, body: unknown, signal: AbortSignal): Promise<{ status: number, data: unknown }>
}
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const versionPattern = /^[1-9][0-9]{0,4}$/
const exactVersionPattern = /^[1-9][0-9]{0,19}$/

function targetPath(target: Target): string {
  if (!target || !['dev', 'prod'].includes(target.environment) || typeof target.epochId !== 'string' || !uuid4.test(target.epochId) ||
      typeof target.projectNumber !== 'string' || !/^[1-9][0-9]{5,19}$/.test(target.projectNumber) ||
      typeof target.secretId !== 'string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(target.secretId)) throw new Error('Invalid recovery sequence target')
  return `projects/${target.projectNumber}/secrets/${target.secretId}`
}
function validVersion(version: unknown): version is string {
  return typeof version === 'string' && versionPattern.test(version) && Number(version) <= 10_000
}
function crc32c(bytes: Uint8Array): string {
  const crc = new CRC32C()
  crc.update(Buffer.from(bytes))
  return String(Buffer.from(crc.toString(), 'base64').readUInt32BE(0))
}
async function request(transport: RecoverySequenceTransport, method: 'POST' | 'GET', path: string, body: unknown, timeoutMs: number) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = performance.now() + timeoutMs
  try {
    const result = await Promise.race([
      transport.request(method, path, body, controller.signal),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Sequence request timed out')) }, timeoutMs) }),
    ])
    if (performance.now() >= deadline) throw new Error('Sequence request timed out')
    return result
  } finally { if (timer) clearTimeout(timer) }
}

/**
 * Append canonical bytes once. The provider has no idempotency key; any failed
 * response may still create a version. A retry must use identical bytes.
 */
export async function appendRecoverySequenceVersion(transport: RecoverySequenceTransport, target: Target,
  payload: Uint8Array, timeoutMs = 5000): Promise<{ version: string }> {
  const path = targetPath(target)
  if (!(payload instanceof Uint8Array) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) {
    throw new Error('Invalid recovery sequence entry')
  }
  const bytes = Buffer.from(payload)
  decodeRecoverySequenceEntry(bytes, target.environment, target.epochId)
  try {
    const response = await request(transport, 'POST', `${path}:addVersion`,
      { payload: { data: bytes.toString('base64'), dataCrc32c: crc32c(bytes) } }, timeoutMs)
    const value = response.data as { name?: unknown, state?: unknown, clientSpecifiedPayloadChecksum?: unknown } | null
    const prefix = `${path}/versions/`
    const version = typeof value?.name === 'string' && value.name.startsWith(prefix) ? value.name.slice(prefix.length) : ''
    if (response.status !== 200 || !validVersion(version) || value?.state !== 'ENABLED' || value.clientSpecifiedPayloadChecksum !== true) {
      throw new Error('Sequence append is ambiguous')
    }
    return { version }
  } catch { throw new Error('Recovery sequence append outcome is uncertain') }
}

async function readExactRecoverySequenceVersion(transport: RecoverySequenceTransport, target: Target,
  version: string, timeoutMs = 5000): Promise<Uint8Array> {
  const path = targetPath(target)
  if (typeof version !== 'string' || !exactVersionPattern.test(version) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('Invalid recovery sequence version')
  const environment = target.environment, epochId = target.epochId
  try {
    const name = `${path}/versions/${version}`
    const response = await request(transport, 'GET', `${name}:access`, null, timeoutMs)
    const value = response.data as { name?: unknown, payload?: { data?: unknown, dataCrc32c?: unknown } } | null
    const data = value?.payload?.data, checksum = value?.payload?.dataCrc32c
    if (response.status !== 200 || value?.name !== name || typeof data !== 'string' || data.length > 32_768 ||
        typeof checksum !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(checksum) || BigInt(checksum) > 4_294_967_295n) {
      throw new Error('Sequence version is ambiguous')
    }
    const bytes = Buffer.from(data, 'base64')
    if (bytes.toString('base64') !== data || crc32c(bytes) !== checksum) throw new Error('Sequence checksum differs')
    decodeRecoverySequenceEntry(bytes, environment, epochId)
    return bytes
  } catch { throw new Error('Recovery sequence version could not be verified') }
}

/** Read one exact numbered version within the scan limit; never infer absence from an error. */
export async function readRecoverySequenceVersion(transport: RecoverySequenceTransport, target: Target,
  version: string, timeoutMs = 5000): Promise<Uint8Array> {
  if (!validVersion(version)) throw new Error('Invalid recovery sequence version')
  return readExactRecoverySequenceVersion(transport, target, version, timeoutMs)
}

/**
 * Inspect one independently identified version beyond the scan limit. This
 * cannot find an unknown version, establish coverage, or authorize reopening.
 */
export async function inspectRecoverySequenceVersionOutsideScanLimit(transport: RecoverySequenceTransport, target: Target,
  version: string, timeoutMs = 5000): Promise<{ payload: Uint8Array, coverageVerified: false }> {
  if (typeof version !== 'string' || !exactVersionPattern.test(version) || validVersion(version)) {
    throw new Error('Invalid recovery sequence version')
  }
  const payload = await readExactRecoverySequenceVersion(transport, target, version, timeoutMs)
  return { payload, coverageVerified: false }
}

/** Append once and compare its exact version using a separately authorized reader. */
export async function appendAndVerifyRecoverySequenceVersion(writer: RecoverySequenceTransport, reader: RecoverySequenceTransport,
  target: Target, payload: Uint8Array, timeoutMs = 10_000): Promise<{ version: string, coverageVerified: false }> {
  targetPath(target)
  if (!(payload instanceof Uint8Array) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    throw new Error('Invalid recovery sequence entry')
  }
  const destination = { ...target }, bytes = Buffer.from(payload)
  decodeRecoverySequenceEntry(bytes, destination.environment, destination.epochId)
  const deadline = performance.now() + timeoutMs
  const remaining = () => {
    const value = Math.ceil(deadline - performance.now())
    if (value < 1) throw new Error('Recovery sequence timed out')
    return Math.min(value, 5000)
  }
  try {
    const { version } = await appendRecoverySequenceVersion(writer, destination, bytes, remaining())
    const observed = await readRecoverySequenceVersion(reader, destination, version, remaining())
    if (!Buffer.from(observed).equals(bytes)) throw new Error('Recovery sequence differs')
    remaining()
    return { version, coverageVerified: false }
  } catch { throw new Error('Recovery sequence outcome is uncertain') }
}

/** Read exact private frames and compare a selected fence, without asserting coverage. */
export async function readUnverifiedRecoverySequenceFrames(transport: RecoverySequenceTransport, target: Target,
  fenceVersion: string, fenceNonce: string, timeoutMs = 120_000) {
  targetPath(target)
  if (!validVersion(fenceVersion) || typeof fenceNonce !== 'string' || !uuid4.test(fenceNonce) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid recovery sequence request')
  const destination = { ...target }
  const deadline = performance.now() + timeoutMs
  const remaining = () => {
    const value = Math.ceil(deadline - performance.now())
    if (value < 1) throw new Error('Recovery sequence timed out')
    return Math.min(value, 5000)
  }
  try {
    const frames: { version: string, payload: Uint8Array }[] = new Array(Number(fenceVersion))
    let position = 0, totalBytes = 0, stopped = false
    const read = async () => {
      while (!stopped) {
        const index = position++
        if (index >= frames.length) return
        try {
          const version = String(index + 1)
          const payload = await readRecoverySequenceVersion(transport, destination, version, remaining())
          totalBytes += payload.byteLength
          if (totalBytes > 32 * 1024 * 1024) throw new Error('Recovery sequence is too large')
          frames[index] = { version, payload }
        } catch (error) { stopped = true; throw error }
      }
    }
    const results = await Promise.allSettled(Array.from({ length: Math.min(4, frames.length) }, read))
    if (results.some(result => result.status === 'rejected')) throw new Error('Recovery sequence read failed')
    const result = compareUnverifiedRecoverySequence(frames, destination.environment, destination.epochId, fenceVersion, fenceNonce)
    remaining()
    return { frames, sequence: result, coverageVerified: false as const }
  } catch { throw new Error('Recovery sequence could not be verified') }
}

/** Read every explicit version through a selected fence, without asserting coverage. */
export async function readUnverifiedRecoverySequence(transport: RecoverySequenceTransport, target: Target,
  fenceVersion: string, fenceNonce: string, timeoutMs = 120_000) {
  return (await readUnverifiedRecoverySequenceFrames(transport, target, fenceVersion, fenceNonce, timeoutMs)).sequence
}
