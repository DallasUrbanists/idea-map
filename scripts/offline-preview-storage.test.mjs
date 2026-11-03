import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createOfflinePreviewStorage } from '../packages/server/dist/offline-preview-storage.js'
import { exactGenerationFile } from '../packages/server/dist/storage-generation.js'

test('offline preview storage never follows redirects from the local fake', async () => {
  assert.throws(() => createOfflinePreviewStorage('https://example.invalid:9199'))
  let redirected = 0
  const destination = createServer((_request, response) => { redirected++; response.end('{}') })
  await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve))
  const fake = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    assert.equal(url.searchParams.get('generation'), '9007199254740993')
    assert.equal(url.searchParams.get('ifGenerationMatch'), '9007199254740993')
    response.writeHead(302, { location: `http://127.0.0.1:${destination.address().port}/redirected` }).end()
  })
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve))
  try {
    const storage = createOfflinePreviewStorage(`http://127.0.0.1:${fake.address().port}`)
    assert.throws(() => exactGenerationFile(storage, 'synthetic', '..', '1'), /Invalid local preview object/)
    const file = exactGenerationFile(storage, 'synthetic', 'synthetic/preview', '9007199254740993')
    await assert.rejects(file.getMetadata())
    await assert.rejects(async () => { for await (const chunk of file.createReadStream()) void chunk })
    assert.equal(redirected, 0)
  } finally {
    await Promise.all([new Promise(resolve => fake.close(resolve)), new Promise(resolve => destination.close(resolve))])
  }
})
