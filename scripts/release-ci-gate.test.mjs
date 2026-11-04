import test from 'node:test'
import assert from 'node:assert/strict'
import { requirePassingRuns, requiredWorkflows } from './release-ci-gate.mjs'

const sha = 'a'.repeat(40)
const run = { head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }
const runs = () => Object.fromEntries(requiredWorkflows.map(workflow => [workflow, [{ ...run }]]))

test('requires successful main push runs for the precise source commit', () => {
  assert.doesNotThrow(() => requirePassingRuns(sha, runs()))
  for (const change of [{ conclusion: 'failure' }, { status: 'in_progress' },
    { head_sha: 'b'.repeat(40) }, { head_branch: 'other' }, { event: 'pull_request' }]) {
    const input = runs()
    input[requiredWorkflows[0]][0] = { ...run, ...change }
    assert.throws(() => requirePassingRuns(sha, input))
  }
  const missing = runs()
  missing[requiredWorkflows[1]] = []
  assert.throws(() => requirePassingRuns(sha, missing))
  const rerunFailed = runs()
  rerunFailed[requiredWorkflows[2]] = [{ ...run, conclusion: 'failure' }, run]
  assert.throws(() => requirePassingRuns(sha, rerunFailed))
})
