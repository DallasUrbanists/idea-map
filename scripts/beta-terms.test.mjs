import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const betaVersion = 'sha256:418671e6f926f5bd68d50bb6d2465b78c4b0ea85132995c8cd4d94835a246219'
const initialVersion = 'sha256:155c2837ea919a462704fe6d48e4cf529c07b61cd7cd726fe6f03bc87bf882c2'

test('inactive beta terms retain exact policy bytes and an immutable distinct digest', async () => {
  const beta = await readFile(new URL('../packages/server/terms/beta-terms.md', import.meta.url))
  const policy = await readFile(new URL('../docs/policies/beta-terms-of-use-policy.md', import.meta.url))
  const initial = await readFile(new URL('../packages/server/terms/initial-terms.md', import.meta.url))
  assert.deepEqual(beta, policy)
  assert.equal(sha256(beta), betaVersion)
  assert.equal(sha256(initial), initialVersion)
  assert.notEqual(betaVersion, initialVersion)
})
