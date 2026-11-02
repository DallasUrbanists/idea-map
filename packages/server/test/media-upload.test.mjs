import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import { Storage } from '@google-cloud/storage'
import { createPendingUpload, createPendingUploadUrl, createUploadSigningStorage, deletePendingUploadGeneration } from '../dist/media-upload.js'

test('signed upload binds a private object, type, size and short expiry', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const storage = new Storage({ projectId: 'synthetic-project', credentials: {
    client_email: 'synthetic@synthetic-project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  } })
  const before = Date.now()
  const upload = await createPendingUpload(storage, 'synthetic-private-bucket', { contentType: 'image/png', maxBytes: 12345, expiresInSeconds: 300 })
  assert.match(upload.objectName, /^pending\/[0-9a-f-]{36}$/)
  assert.equal(upload.url, 'https://storage.googleapis.com/synthetic-private-bucket/')
  assert.equal(upload.fields.key, upload.objectName)
  const policy = JSON.parse(Buffer.from(upload.fields.policy, 'base64').toString('utf8'))
  assert.ok(policy.conditions.some(condition => condition.bucket === 'synthetic-private-bucket'))
  assert.ok(policy.conditions.some(condition => condition.key === upload.objectName))
  assert.ok(policy.conditions.some(condition => condition['Content-Type'] === 'image/png'))
  assert.ok(policy.conditions.some(condition => Array.isArray(condition) && condition.join(',') === 'content-length-range,1,12345'))
  assert.ok(Date.parse(policy.expiration) >= before + 299000 && Date.parse(policy.expiration) <= before + 301000)
  assert.ok(verify('sha256', Buffer.from(upload.fields.policy), publicKey, Buffer.from(upload.fields['x-goog-signature'], 'hex')))
  const second = await createPendingUpload(storage, 'synthetic-private-bucket', { contentType: 'image/png', maxBytes: 1, expiresInSeconds: 60 })
  assert.notEqual(second.objectName, upload.objectName)
})

test('unsafe upload configuration is rejected before invoking storage', async () => {
  const storage = { bucket() { assert.fail('storage should not be called') } }
  const good = { contentType: 'image/png', maxBytes: 10, expiresInSeconds: 60 }
  for (const options of [{ ...good, expiresInSeconds: 901 }, { ...good, maxBytes: 0 }, { ...good, contentType: 'image/png\r\nextra: value' }]) {
    await assert.rejects(createPendingUpload(storage, 'private', options), /Invalid pending upload configuration/)
  }
})

test('authorization is not returned if signing takes past its expiry', async (t) => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const storage = { bucket() { return { file() { return {
    async generateSignedPostPolicyV4() { now += 2000; return [{ url: 'https://example.invalid', fields: {} }] },
    async getSignedUrl() { now += 2000; return ['https://example.invalid'] },
  } } } } }
  const options = { contentType: 'image/png', maxBytes: 10, expiresInSeconds: 1 }
  await assert.rejects(createPendingUpload(storage, 'private', options), /expired during signing/)
  await assert.rejects(createPendingUploadUrl(storage, 'private', options), /expired during signing/)
})

test('signed PUT URL binds content type, byte range, and create-only precondition', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const storage = new Storage({ projectId: 'synthetic-project', credentials: {
    client_email: 'synthetic@synthetic-project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  } })
  const upload = await createPendingUploadUrl(storage, 'synthetic-private-bucket', { contentType: 'image/png', maxBytes: 12345, expiresInSeconds: 300 })
  const url = new URL(upload.url)
  assert.equal(url.host, 'storage.googleapis.com')
  assert.ok(url.pathname.endsWith(upload.objectName))
  const signedAt = url.searchParams.get('X-Goog-Date')
  assert.match(signedAt, /^\d{8}T\d{6}Z$/)
  const signedTime = Date.parse(signedAt.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'))
  const lifetime = Number(url.searchParams.get('X-Goog-Expires'))
  assert.ok(lifetime > 0 && lifetime <= 300)
  assert.equal(signedTime + lifetime * 1000, Date.parse(upload.expiresAt))
  assert.equal(url.searchParams.get('X-Goog-SignedHeaders'), 'content-type;host;x-goog-content-length-range;x-goog-if-generation-match')
  assert.ok(url.searchParams.get('X-Goog-Signature'))
  assert.deepEqual(upload.headers, { 'content-type': 'image/png', 'x-goog-content-length-range': '1,12345', 'x-goog-if-generation-match': '0' })
})

test('upload signing uses the dedicated service account through the supplied identity', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  let requestedUrl
  const source = {
    async getAccessToken() { return { token: 'synthetic-token' } },
    async request(request) {
      requestedUrl = request.url
      const bytes = Buffer.from(request.data.payload, 'base64')
      return { data: { signedBlob: sign('sha256', bytes, privateKey).toString('base64') } }
    },
  }
  const signer = 'idea-map-upload-dev@synthetic-project.iam.gserviceaccount.com'
  const storage = createUploadSigningStorage('synthetic-project', signer, source)
  const upload = await createPendingUploadUrl(storage, 'synthetic-private-bucket', { contentType: 'image/png', maxBytes: 10, expiresInSeconds: 300 })
  assert.match(requestedUrl, /idea-map-upload-dev@synthetic-project\.iam\.gserviceaccount\.com:signBlob$/)
  assert.match(new URL(upload.url).searchParams.get('X-Goog-Credential'), /^idea-map-upload-dev@synthetic-project\.iam\.gserviceaccount\.com\//)
  assert.throws(() => createUploadSigningStorage('synthetic-project', 'signer@other-project.iam.gserviceaccount.com', source), /Invalid upload signer/)
})

test('temporary cleanup targets only the requested generation and rejects unsafe targets', async () => {
  const calls = []
  const storage = { bucket(name) { return { file(object, options) { return {
    interceptors: [],
    async delete(deleteOptions) { calls.push({ name, object, options, deleteOptions }) },
  } } } } }
  const object = 'pending/11111111-1111-4111-8111-111111111111'
  await deletePendingUploadGeneration(storage, 'synthetic-pending', object, '1234567890123456')
  assert.deepEqual(calls, [{ name: 'synthetic-pending', object, options: {
    preconditionOpts: { ifGenerationMatch: '1234567890123456' },
  }, deleteOptions: { ignoreNotFound: true } }])
  await assert.rejects(deletePendingUploadGeneration(storage, 'synthetic-pending', 'approved/object', '123'), /Invalid pending upload generation/)
  await assert.rejects(deletePendingUploadGeneration(storage, 'synthetic-pending', object, '0'), /Invalid pending upload generation/)
  assert.equal(calls.length, 1)
})

test('storage client sends the exact generation and precondition for cleanup', async () => {
  const paths = []
  let exists = true
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    paths.push(url)
    const exact = url.searchParams.get('generation') === '9007199254740993' && url.searchParams.get('ifGenerationMatch') === '9007199254740993'
    if (!exact || !exists) { response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":{"code":404,"message":"not found"}}'); return }
    exists = false
    response.writeHead(204).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const previous = process.env.STORAGE_EMULATOR_HOST
  process.env.STORAGE_EMULATOR_HOST = `http://127.0.0.1:${server.address().port}`
  try {
    const storage = new Storage({ projectId: 'synthetic-project' })
    await deletePendingUploadGeneration(storage, 'synthetic-pending', 'pending/11111111-1111-4111-8111-111111111111', '9007199254740993')
    assert.equal(exists, false)
    // A retry may ignore 404 only after addressing the same exact generation.
    await deletePendingUploadGeneration(storage, 'synthetic-pending', 'pending/11111111-1111-4111-8111-111111111111', '9007199254740993')
    assert.equal(paths.length, 2)
    for (const requested of paths) {
      assert.equal(requested.searchParams.get('generation'), '9007199254740993')
      assert.equal(requested.searchParams.get('ifGenerationMatch'), '9007199254740993')
    }
  } finally {
    if (previous === undefined) delete process.env.STORAGE_EMULATOR_HOST
    else process.env.STORAGE_EMULATOR_HOST = previous
    await new Promise(resolve => server.close(resolve))
  }
})
