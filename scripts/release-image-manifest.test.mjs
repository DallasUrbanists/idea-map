import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fetchRegistryManifest, resolvePlatformImage } from './release-image-manifest.mjs'

const prefix = 'us-central1-docker.pkg.dev/synthetic-dev/releases/idea-map-web'
const leafType = 'application/vnd.oci.image.manifest.v1+json'
const indexType = 'application/vnd.oci.image.index.v1+json'
const leafDigest = `sha256:${'a'.repeat(64)}`
const descriptor = { mediaType: leafType, digest: leafDigest, platform: { os: 'linux', architecture: 'amd64' } }
const bytes = value => Buffer.from(JSON.stringify(value))
const reference = body => `${prefix}@sha256:${createHash('sha256').update(body).digest('hex')}`

test('resolves a checked OCI index to its Linux amd64 image', async () => {
  const body = bytes({ schemaVersion: 2, mediaType: indexType, manifests: [descriptor,
    { mediaType: leafType, digest: `sha256:${'b'.repeat(64)}`, platform: { os: 'unknown', architecture: 'unknown' } }] })
  const image = reference(body)
  const resolved = await resolvePlatformImage(image, async url => {
    assert.equal(url, `https://${prefix.replace('.pkg.dev/', '.pkg.dev/v2/')}/manifests/${image.split('@')[1]}`)
    return body
  })
  assert.equal(resolved, `${prefix}@${leafDigest}`)
})

test('accepts a checked single-platform manifest unchanged', async () => {
  const body = bytes({ schemaVersion: 2, mediaType: leafType, config: {} })
  assert.equal(await resolvePlatformImage(reference(body), async () => body), reference(body))
})

test('rejects altered, unsupported, missing, or ambiguous manifests', async () => {
  const invalid = [
    { schemaVersion: 1, mediaType: indexType, manifests: [descriptor] },
    { schemaVersion: 2, mediaType: 'unknown', manifests: [descriptor] },
    { schemaVersion: 2, mediaType: indexType, manifests: [] },
    { schemaVersion: 2, mediaType: indexType, manifests: [descriptor, descriptor] },
    { schemaVersion: 2, mediaType: indexType, manifests: [{ ...descriptor, digest: 'sha256:bad' }] },
    { schemaVersion: 2, mediaType: indexType, manifests: [{ ...descriptor, mediaType: indexType }] },
  ]
  for (const value of invalid) {
    const body = bytes(value)
    await assert.rejects(resolvePlatformImage(reference(body), async () => body))
  }
  const body = bytes({ schemaVersion: 2, mediaType: leafType })
  await assert.rejects(resolvePlatformImage(reference(body), async () => Buffer.from('changed')), /checked digest/)
  await assert.rejects(resolvePlatformImage('https://attacker.invalid/image:latest', async () => body), /Invalid immutable/)
})

test('sends registry credentials only to the validated HTTPS registry without redirects', async () => {
  const body = Buffer.from('{}')
  const url = `https://${prefix.replace('.pkg.dev/', '.pkg.dev/v2/')}/manifests/${leafDigest}`
  const result = await fetchRegistryManifest(url, 'test-token', async (target, options) => {
    assert.equal(target, url)
    assert.equal(options.headers.authorization, 'Bearer test-token')
    assert.equal(options.redirect, 'error')
    return { ok: true, headers: new Headers(), arrayBuffer: async () => body }
  })
  assert.deepEqual(result, body)
  await assert.rejects(fetchRegistryManifest('https://attacker.invalid/manifest', 'test-token', async () => {}), /Invalid registry/)
  await assert.rejects(fetchRegistryManifest(url, 'test-token\nleak', async () => {}), /Invalid registry/)
  await assert.rejects(fetchRegistryManifest(url, 'test-token', async () => { throw new Error('test-token') }),
    error => !error.message.includes('test-token'))
})
