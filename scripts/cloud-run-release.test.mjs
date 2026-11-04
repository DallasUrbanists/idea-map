import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { release, releaseChecked } from './cloud-run-release.mjs'

const project = 'synthetic-dev'
const service = 'idea-map-worker-dev'
const image = `us-central1-docker.pkg.dev/${project}/releases/idea-map-worker@sha256:${'a'.repeat(64)}`
const oldImage = image.replace(/a{64}/, 'b'.repeat(64))
const old = `${service}-old`
const target = `${service}-00002-abc`
const config = { environment: 'staging', service: 'worker', operation: 'prepare', project,
  region: 'us-central1', imageRepository: `us-central1-docker.pkg.dev/${project}/releases`,
  image, expectedRevision: old, revision: target }

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
            containers: [{ image: revisionImage, command: isTarget ? options.revisionCommand : options.servingCommand,
              args: isTarget ? options.revisionArgs : options.servingArgs }] },
          status: { observedGeneration: isTarget ? 1 : (options.servingObservedGeneration ?? 1),
            imageDigest: (isTarget ? options.revisionDigest : options.servingDigest) ?? revisionImage,
            conditions: [{ type: 'Ready', status: (isTarget ? options.ready : options.servingReady) ?? 'True' }] } }
      }
      if (args[2] === 'update' && failPrepareOnce) {
        failPrepareOnce = false
        serviceReady = 'False'
        throw new Error('Candidate failed to start')
      }
      if (args[2] === 'update') return {
        metadata: { name: options.preparedServiceName ?? service, generation: 3 },
        status: { observedGeneration: options.preparedObservedGeneration ?? 3,
          conditions: [{ type: 'Ready', status: 'True' }],
          latestCreatedRevisionName: Object.hasOwn(options, 'createdRevision') ? options.createdRevision : target },
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
  assert.ok(update.includes('--format=json'))
  assert.equal(update.some(arg => arg.startsWith('--revision-suffix=') || arg.startsWith('--tag=')), false)
  assert.equal(fake.commands.some(args => args[2] === 'update-traffic'), false)
})

test('rejects missing, stale, cross-service, or unchanged generated candidates without routing', () => {
  for (const options of [{ createdRevision: null }, { createdRevision: old },
    { createdRevision: 'another-service-00002-abc' }, { preparedServiceName: 'another-service' },
    { preparedObservedGeneration: 2 }]) {
    const fake = fakeCloud(options)
    assert.throws(() => release(config, fake.run))
    assert.equal(fake.commands.some(args => args[2] === 'update-traffic'), false)
  }
})

for (const operation of ['prepare', 'promote', 'rollback']) {
  test(`${operation} verifies the platform digest resolved from a checked image index`, () => {
    const resolvedImage = image.replace(/a{64}/, 'c'.repeat(64))
    const fake = fakeCloud({ revisionImage: resolvedImage, revisionDigest: resolvedImage })
    const result = release({ ...config, operation, resolvedImage }, fake.run)
    assert.equal(result.image, image)
    assert.equal(result.revision, target)
  })
}

test('checks an image index before issuing Cloud Run commands', async () => {
  const resolvedImage = image.replace(/a{64}/, 'c'.repeat(64))
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [{ mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: resolvedImage.split('@')[1],
      platform: { os: 'linux', architecture: 'amd64' } }] }))
  const indexImage = image.replace(/a{64}/, createHash('sha256').update(manifest).digest('hex'))
  const fake = fakeCloud({ revisionImage: resolvedImage, revisionDigest: resolvedImage })
  const result = await releaseChecked({ ...config, image: indexImage }, fake.run, async () => manifest)
  assert.equal(result.image, indexImage)
  assert.ok(fake.commands.some(args => args[2] === 'update' && args.includes(`--image=${indexImage}`)))
  const rejected = fakeCloud()
  await assert.rejects(releaseChecked({ ...config, image: indexImage }, rejected.run, async () => Buffer.from('tampered')))
  assert.equal(rejected.commands.length, 0)
})

test('can roll back to an exact revision digest without registry access', async () => {
  const fake = fakeCloud()
  const result = await releaseChecked({ ...config, operation: 'rollback' }, fake.run, async () => {
    throw new Error('Registry unavailable')
  })
  assert.equal(result.revision, target)
  assert.ok(fake.commands.some(args => args[2] === 'update-traffic'))
  const unhealthy = fakeCloud({ ready: 'False' })
  await assert.rejects(releaseChecked({ ...config, operation: 'rollback' }, unhealthy.run, async () => {
    throw new Error('Registry unavailable')
  }), /Revision identity, image, or health metadata/)
  assert.equal(unhealthy.commands.some(args => args[2] === 'update-traffic'), false)
})

test('rejects a revision that does not match the resolved platform digest', () => {
  const resolvedImage = image.replace(/a{64}/, 'c'.repeat(64))
  const fake = fakeCloud({ revisionImage: image, revisionDigest: image })
  assert.throws(() => release({ ...config, operation: 'promote', resolvedImage }, fake.run), /Revision identity, image, or health metadata/)
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
  const result = release(config, fake.run)
  assert.equal(result.previousRevision, old)
  assert.equal(result.revision, target)
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

test('never releases or rolls back to the temporary worker bootstrap process', () => {
  for (const options of [{ servingCommand: ['node', '-e', 'bootstrap'] },
    { revisionCommand: ['node', '-e', 'bootstrap'] }, { revisionArgs: ['bootstrap'] }]) {
    const fake = fakeCloud(options)
    assert.throws(() => release({ ...config, operation: 'rollback' }, fake.run), /Revision identity, image, or health metadata/)
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
    { resolvedImage: `us-central1-docker.pkg.dev/other-project/releases/idea-map-worker@sha256:${'c'.repeat(64)}` },
    { expectedRevision: 'another-service-old' }, { project: 'prod;echo' },
    { project: 'other-project' }]) {
    const fake = fakeCloud()
    assert.throws(() => release({ ...config, ...overrides }, fake.run))
    assert.equal(fake.commands.length, 0)
  }
})
