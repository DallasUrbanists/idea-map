import test from 'node:test'
import assert from 'node:assert/strict'
import { release } from './cloud-run-release.mjs'

const project = 'synthetic-dev'
const service = 'idea-map-worker-dev'
const image = `us-central1-docker.pkg.dev/${project}/releases/idea-map-worker@sha256:${'a'.repeat(64)}`
const old = `${service}-old`
const target = `${service}-r123-1`
const config = { environment: 'staging', service: 'worker', operation: 'prepare', project,
  region: 'us-central1', imageRepository: `us-central1-docker.pkg.dev/${project}/releases`,
  image, expectedRevision: old, suffix: 'r123-1', revision: target }

function fakeCloud(options = {}) {
  let active = options.active ?? old
  const commands = []
  return {
    commands,
    run(args) {
      commands.push(args)
      if (args[1] === 'services' && args[2] === 'describe') {
        return { metadata: { generation: 2, annotations: { 'run.googleapis.com/ingress': 'internal' } },
          spec: { template: { metadata: { annotations: options.annotations ?? {} },
            spec: { serviceAccountName: `${service}@${project}.iam.gserviceaccount.com` } } },
          status: { observedGeneration: 2, conditions: [{ type: 'Ready', status: 'True' }],
            traffic: options.traffic ?? [{ revisionName: active, percent: 100 }] } }
      }
      if (args[1] === 'revisions' && args[2] === 'describe') {
        return { metadata: { name: args[3], generation: 1, labels: { 'serving.knative.dev/service': service } },
          spec: { serviceAccountName: options.revisionIdentity ?? `${service}@${project}.iam.gserviceaccount.com`,
            containers: [{ image: options.revisionImage ?? image }] },
          status: { observedGeneration: 1, imageDigest: image, conditions: [{ type: 'Ready', status: options.ready ?? 'True' }] } }
      }
      if (args[2] === 'update-traffic' && !options.trafficDoesNotConverge) active = target
    },
  }
}

test('prepares a checked revision without moving traffic', () => {
  const fake = fakeCloud()
  const result = release(config, fake.run)
  assert.equal(result.revision, target)
  assert.equal(result.previousRevision, old)
  const update = fake.commands.find(args => args[2] === 'update')
  assert.ok(update.includes('--no-traffic'))
  assert.ok(update.includes(`--image=${image}`))
  assert.equal(fake.commands.some(args => args[2] === 'update-traffic'), false)
})

for (const operation of ['promote', 'rollback']) {
  test(`${operation} verifies the revision before routing exact traffic`, () => {
    const fake = fakeCloud()
    const result = release({ ...config, operation }, fake.run)
    assert.equal(result.revision, target)
    assert.ok(fake.commands.some(args => args.includes(`--to-revisions=${target}=100`)))
    assert.equal(fake.commands.at(-1)[2], 'describe')
  })
}

test('rejects stale, split, or unexpectedly configured services before mutation', () => {
  for (const options of [
    { active: `${service}-other` },
    { traffic: [{ revisionName: old, percent: 50 }, { revisionName: target, percent: 50 }] },
    { annotations: { 'autoscaling.knative.dev/minScale': '1' } },
    { annotations: { 'run.googleapis.com/cpu-throttling': 'false' } },
  ]) {
    const fake = fakeCloud(options)
    assert.throws(() => release(config, fake.run))
    assert.equal(fake.commands.some(args => args[2] === 'update' || args[2] === 'update-traffic'), false)
  }
})

test('rejects a wrong or unhealthy revision before routing', () => {
  for (const options of [{ ready: 'False' }, { revisionImage: image.replace(/a{64}/, 'b'.repeat(64)) },
    { revisionIdentity: 'wrong@synthetic-dev.iam.gserviceaccount.com' }]) {
    const fake = fakeCloud(options)
    assert.throws(() => release({ ...config, operation: 'promote' }, fake.run))
    assert.equal(fake.commands.some(args => args[2] === 'update-traffic'), false)
  }
})

test('reports uncertain traffic when the provider does not converge after a change', () => {
  const fake = fakeCloud({ trafficDoesNotConverge: true })
  assert.throws(() => release({ ...config, operation: 'promote' }, fake.run), /did not converge/)
  assert.ok(fake.commands.some(args => args[2] === 'update-traffic'))
})

test('rejects mutable images, other services, and untrusted registry inputs', () => {
  for (const overrides of [{ image: 'example.invalid/worker:latest' },
    { imageRepository: 'example.invalid/other' }, { service: 'unknown' },
    { expectedRevision: 'another-service-old' }, { project: 'prod;echo' },
    { project: 'other-project' }]) {
    const fake = fakeCloud()
    assert.throws(() => release({ ...config, ...overrides }, fake.run))
    assert.equal(fake.commands.length, 0)
  }
})
