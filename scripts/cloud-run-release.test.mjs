import test from 'node:test'
import assert from 'node:assert/strict'
import { release } from './cloud-run-release.mjs'

const project = 'synthetic-dev'
const service = 'idea-map-worker-dev'
const image = `us-central1-docker.pkg.dev/${project}/releases/idea-map-worker@sha256:${'a'.repeat(64)}`
const oldImage = image.replace(/a{64}/, 'b'.repeat(64))
const old = `${service}-old`
const target = `${service}-r123-1`
const config = { environment: 'staging', service: 'worker', operation: 'prepare', project,
  region: 'us-central1', imageRepository: `us-central1-docker.pkg.dev/${project}/releases`,
  image, expectedRevision: old, suffix: 'r123-1', revision: target }

function fakeCloud(options = {}) {
  let active = options.active ?? old
  let serviceReady = options.serviceReady ?? 'True'
  let failPrepareOnce = options.failPrepareOnce ?? false
  const commands = []
  return {
    commands,
    run(args) {
      commands.push(args)
      if (args[1] === 'services' && args[2] === 'describe') {
        return { metadata: { generation: Object.hasOwn(options, 'serviceGeneration') ? options.serviceGeneration : 2,
          annotations: { 'run.googleapis.com/ingress': 'internal',
            'run.googleapis.com/ingress-status': Object.hasOwn(options, 'activeIngress') ? options.activeIngress : 'internal' } },
          spec: { template: { metadata: { annotations: options.annotations ?? {} },
            spec: { serviceAccountName: `${service}@${project}.iam.gserviceaccount.com` } } },
          status: { observedGeneration: Object.hasOwn(options, 'serviceObservedGeneration') ? options.serviceObservedGeneration : 2,
            conditions: options.serviceConditions ?? [{ type: 'Ready', status: serviceReady }],
            traffic: options.traffic ?? [{ revisionName: active, percent: 100 }] } }
      }
      if (args[1] === 'revisions' && args[2] === 'describe') {
        const isTarget = args[3] !== old
        if (!isTarget && options.missingServing) return null
        const revisionImage = isTarget ? (options.revisionImage ?? image) : (options.servingImage ?? oldImage)
        return { metadata: { name: args[3], generation: 1, labels: { 'serving.knative.dev/service': service } },
          spec: { serviceAccountName: (isTarget ? options.revisionIdentity : options.servingIdentity) ??
              `${service}@${project}.iam.gserviceaccount.com`,
            containers: [{ image: revisionImage }] },
          status: { observedGeneration: isTarget ? 1 : (options.servingObservedGeneration ?? 1),
            imageDigest: (isTarget ? options.revisionDigest : options.servingDigest) ?? revisionImage,
            conditions: [{ type: 'Ready', status: (isTarget ? options.ready : options.servingReady) ?? 'True' }] } }
      }
      if (args[2] === 'update' && failPrepareOnce) {
        failPrepareOnce = false
        serviceReady = 'False'
        throw new Error('Candidate failed to start')
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

for (const operation of ['prepare', 'promote', 'rollback']) {
  test(`${operation} recovers after a failed candidate without trusting service readiness`, () => {
    const fake = fakeCloud({ serviceReady: 'False' })
    const result = release({ ...config, operation }, fake.run)
    assert.equal(result.previousRevision, old)
    assert.equal(result.revision, target)
    assert.ok(fake.commands.some(args => args[1] === 'revisions' && args[2] === 'describe' && args[3] === old))
    const mutation = fake.commands.find(args => args[2] === 'update' || args[2] === 'update-traffic')
    assert.ok(mutation)
    assert.ok(operation === 'prepare' ? mutation.includes('--no-traffic') :
      mutation.includes(`--to-revisions=${target}=100`))
  })
}

test('prepares a corrected candidate after a failed deployment leaves service readiness false', () => {
  const fake = fakeCloud({ failPrepareOnce: true })
  assert.throws(() => release(config, fake.run), /Candidate failed to start/)
  const result = release({ ...config, suffix: 'r124-1' }, fake.run)
  assert.equal(result.previousRevision, old)
  assert.equal(result.revision, `${service}-r124-1`)
  assert.equal(fake.commands.filter(args => args[2] === 'update').length, 2)
  assert.equal(fake.commands.some(args => args[2] === 'update-traffic'), false)
})

test('permits routing to a healthy revision when the current revision has failed', () => {
  const fake = fakeCloud({ serviceReady: 'False', servingReady: 'False' })
  const result = release({ ...config, operation: 'rollback' }, fake.run)
  assert.equal(result.revision, target)
  assert.ok(fake.commands.some(args => args[2] === 'update-traffic'))
})

test('rejects unknown, stale, missing, and ambiguous service reconciliation', () => {
  for (const options of [
    { serviceReady: 'Unknown' }, { serviceObservedGeneration: 1 },
    { serviceGeneration: null }, { serviceObservedGeneration: null }, { serviceConditions: [] },
    { serviceConditions: [{ type: 'Ready', status: 'True' }, { type: 'Ready', status: 'False' }] },
  ]) {
    const fake = fakeCloud({ serviceReady: 'False', ...options })
    assert.throws(() => release(config, fake.run), /reconciliation has not completed/)
    assert.equal(fake.commands.some(args => args[2] === 'update' || args[2] === 'update-traffic'), false)
  }
})

test('rejects unsafe serving revision metadata even after service reconciliation fails', () => {
  for (const options of [
    { missingServing: true }, { servingReady: 'Unknown' }, { servingObservedGeneration: 0 },
    { servingIdentity: 'wrong@synthetic-dev.iam.gserviceaccount.com' },
    { servingImage: 'example.invalid/worker:latest' },
    { servingDigest: image },
  ]) {
    const fake = fakeCloud({ serviceReady: 'False', ...options })
    assert.throws(() => release({ ...config, operation: 'rollback' }, fake.run))
    assert.equal(fake.commands.some(args => args[2] === 'update-traffic'), false)
  }
})

test('rejects stale, split, or unexpectedly configured services before mutation', () => {
  for (const options of [
    { active: `${service}-other` },
    { traffic: [{ revisionName: old, percent: 50 }, { revisionName: target, percent: 50 }] },
    { annotations: { 'autoscaling.knative.dev/minScale': '1' } },
    { annotations: { 'run.googleapis.com/cpu-throttling': 'false' } },
    { activeIngress: 'all' }, { activeIngress: null },
  ]) {
    const fake = fakeCloud({ serviceReady: 'False', ...options })
    assert.throws(() => release(config, fake.run))
    assert.equal(fake.commands.some(args => args[2] === 'update' || args[2] === 'update-traffic'), false)
  }
})

test('rejects a failed prepared revision even when a previous revision still serves traffic', () => {
  const fake = fakeCloud({ serviceReady: 'False', ready: 'False' })
  assert.throws(() => release(config, fake.run), /Revision identity, image, or health metadata/)
  assert.ok(fake.commands.some(args => args[2] === 'update' && args.includes('--no-traffic')))
  assert.equal(fake.commands.some(args => args[2] === 'update-traffic'), false)
})

test('rejects a wrong or unhealthy revision before routing', () => {
  for (const options of [{ ready: 'False' }, { revisionImage: image.replace(/a{64}/, 'b'.repeat(64)) },
    { revisionIdentity: 'wrong@synthetic-dev.iam.gserviceaccount.com' }]) {
    const fake = fakeCloud({ serviceReady: 'False', ...options })
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
