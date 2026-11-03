import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateBrowserAuthMode, validateServerAuthMode } from '../apps/web/shared/auth-provider.mjs'

test('authentication requires an explicit matching emulator or provider mode', () => {
  validateBrowserAuthMode('offline', 'demo-idea-map', 'http://127.0.0.1:9099')
  validateBrowserAuthMode('emulator-popup', 'demo-idea-map', 'http://127.0.0.1:9099')
  validateServerAuthMode('offline', 'demo-idea-map', 'firebase:9099')
  validateServerAuthMode('offline', 'demo-idea-map', '127.0.0.1:9099')
  validateBrowserAuthMode('provider', 'synthetic-hosted-project', '')
  validateServerAuthMode('provider', 'synthetic-hosted-project', '')
  for (const mode of ['', 'unknown']) {
    assert.throws(() => validateBrowserAuthMode(mode, 'demo-idea-map', 'http://127.0.0.1:9099'))
    assert.throws(() => validateServerAuthMode(mode, 'demo-idea-map', '127.0.0.1:9099'))
  }
  for (const emulator of ['', 'https://example.invalid:9099', 'http://example.invalid:9099', 'http://127.0.0.1:0', 'http://127.0.0.1:9099/path']) {
    assert.throws(() => validateBrowserAuthMode('offline', 'demo-idea-map', emulator))
  }
  for (const host of ['', 'example.invalid:9099', 'localhost:65536', '127.0.0.1:0']) assert.throws(() => validateServerAuthMode('offline', 'demo-idea-map', host))
  assert.throws(() => validateBrowserAuthMode('offline', 'hosted', 'http://localhost:9099'))
  assert.throws(() => validateBrowserAuthMode('emulator-popup', 'hosted', 'http://localhost:9099'))
  assert.throws(() => validateServerAuthMode('emulator-popup', 'demo-idea-map', 'localhost:9099'))
  assert.throws(() => validateServerAuthMode('offline', 'hosted', 'localhost:9099'))
  assert.throws(() => validateBrowserAuthMode('provider', 'demo-idea-map', ''))
  assert.throws(() => validateServerAuthMode('provider', 'demo-idea-map', ''))
  assert.throws(() => validateBrowserAuthMode('provider', 'hosted', 'http://localhost:9099'))
  assert.throws(() => validateServerAuthMode('provider', 'hosted', 'localhost:9099'))
})
