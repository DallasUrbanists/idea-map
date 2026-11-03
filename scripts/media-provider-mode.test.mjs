import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validatePreviewProviderMode } from '../packages/server/dist/media-preview.js'

test('media preview mode requires an explicit local emulator or a provider', () => {
  validatePreviewProviderMode('offline', 'http://127.0.0.1:9199')
  validatePreviewProviderMode('provider', '')
  for (const mode of ['', 'invalid']) assert.throws(() => validatePreviewProviderMode(mode, ''))
  for (const emulator of ['', 'https://example.invalid:9199', 'http://example.invalid:9199', 'http://127.0.0.1:0', 'http://127.0.0.1:9199/path', 'http://127.0.0.1:9199?x=y', 'http://user@127.0.0.1:9199']) {
    assert.throws(() => validatePreviewProviderMode('offline', emulator))
  }
  assert.throws(() => validatePreviewProviderMode('provider', 'http://127.0.0.1:9199'))
})
