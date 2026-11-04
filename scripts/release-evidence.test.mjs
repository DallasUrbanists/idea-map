import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyEvidence } from './release-evidence.mjs'

const sha = 'a'.repeat(40)
const image = `us-central1-docker.pkg.dev/staging-project/releases/idea-map-web@sha256:${'b'.repeat(64)}`
const prodImage = image.replace('staging-project', 'production-project')
const trusted = (id, path) => ({ id: Number(id), repository: { full_name: 'DallasUrbanists/idea-map' },
  path: `.github/workflows/${path}`, event: 'workflow_dispatch', head_branch: 'main',
  status: 'completed', conclusion: 'success', head_sha: sha, run_attempt: 1 })
const build = trusted('123', 'build-release-images.yml')
const manifest = { run_id: '123', run_attempt: '1', source: sha, images: { web: image } }
const staging = trusted('456', 'cloud-run-release.yml')
const receipt = { run_id: '456', run_attempt: '1', source: sha, environment: 'staging', operation: 'promote', service: 'web', image }
const config = { environment: 'production', operation: 'prepare', service: 'web', image: prodImage,
  buildRunId: '123', buildAttempt: '1', stagingRunId: '456', stagingAttempt: '1' }

test('accepts the same built and staged digest in the production repository', () => {
  assert.doesNotThrow(() => verifyEvidence(config, build, manifest, staging, receipt))
  assert.doesNotThrow(() => verifyEvidence({ ...config, environment: 'staging', image }, build, manifest))
})

test('rejects missing, mismatched, failed, or untrusted evidence', () => {
  assert.throws(() => verifyEvidence(config, { ...build, conclusion: 'failure' }, manifest, staging, receipt))
  assert.throws(() => verifyEvidence(config, build, { ...manifest, source: 'b'.repeat(40) }, staging, receipt))
  assert.throws(() => verifyEvidence(config, build, manifest, staging, { ...receipt, operation: 'prepare' }))
  assert.throws(() => verifyEvidence(config, build, manifest, { ...staging, run_attempt: 2 }, receipt))
  assert.throws(() => verifyEvidence(config, build, manifest, { ...staging, path: '.github/workflows/other.yml' }, receipt))
  assert.throws(() => verifyEvidence({ ...config, image: prodImage.replace(/b{64}/, 'c'.repeat(64)) }, build, manifest, staging, receipt))
  assert.throws(() => verifyEvidence({ ...config, environment: 'staging' }, build, manifest))
})
