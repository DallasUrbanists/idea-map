import { spawnSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchRegistryManifest, resolvePlatformImage } from './release-image-manifest.mjs'

const digestPattern = /^[a-z0-9-]+-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/[a-z][a-z0-9-]{0,62}\/idea-map-(web|worker)@sha256:[0-9a-f]{64}$/
const revisionPattern = /^[a-z][a-z0-9-]{0,62}$/

function requireMatch(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

function reconciledStatus(resource) {
  const conditions = resource?.status?.conditions
  if (!Array.isArray(conditions) || resource?.metadata?.generation == null ||
      resource.status?.observedGeneration == null ||
      String(resource.metadata.generation) !== String(resource.status.observedGeneration)) return null
  const readiness = conditions.filter(condition => condition?.type === 'Ready')
  if (readiness.length !== 1 || !['True', 'False'].includes(readiness[0].status)) return null
  return readiness[0].status
}

function currentRevision(service, serviceName, project, serviceKind) {
  const status = reconciledStatus(service)
  if (status === null) throw new Error('Service reconciliation has not completed')
  const serviceAnnotations = service.metadata?.annotations ?? {}
  const templateAnnotations = service.spec?.template?.metadata?.annotations ?? {}
  if ((serviceAnnotations['run.googleapis.com/minScale'] ?? '0') !== '0' ||
      (templateAnnotations['autoscaling.knative.dev/minScale'] ?? '0') !== '0' ||
      templateAnnotations['run.googleapis.com/cpu-throttling'] === 'false' ||
      service.spec?.template?.spec?.serviceAccountName !== `${serviceName}@${project}.iam.gserviceaccount.com` ||
      (serviceKind === 'worker' && (serviceAnnotations['run.googleapis.com/ingress'] !== 'internal' ||
        (status === 'False' && serviceAnnotations['run.googleapis.com/ingress-status'] !== 'internal')))) {
    throw new Error('Service scaling, identity, billing, or worker ingress is not the reviewed configuration')
  }
  const traffic = (service.status?.traffic ?? []).filter(target => (target.percent ?? 0) > 0)
  if (traffic.length !== 1 || traffic[0].percent !== 100 ||
      !traffic[0].revisionName?.startsWith(`${serviceName}-`)) {
    throw new Error('Service must have exactly one revision receiving 100% of traffic')
  }
  return requireMatch(traffic[0].revisionName, revisionPattern, 'current revision')
}

function checkedRevision(revision, serviceName, name, image, project, allowFailed = false) {
  const annotations = revision?.metadata?.annotations ?? {}
  const status = reconciledStatus(revision)
  if (revision?.metadata?.name !== name || revision.metadata?.labels?.['serving.knative.dev/service'] !== serviceName ||
      (status !== 'True' && !(allowFailed && status === 'False')) ||
      revision.spec?.containers?.length !== 1 ||
      (serviceName.startsWith('idea-map-worker-') &&
        ((revision.spec.containers[0].command?.length ?? 0) > 0 || (revision.spec.containers[0].args?.length ?? 0) > 0)) ||
      revision.spec?.serviceAccountName !== `${serviceName}@${project}.iam.gserviceaccount.com` ||
      (annotations['autoscaling.knative.dev/minScale'] ?? '0') !== '0' ||
      annotations['run.googleapis.com/cpu-throttling'] === 'false' ||
      typeof image !== 'string' || !/@sha256:[0-9a-f]{64}$/.test(image) ||
      revision.spec.containers[0].image !== image ||
      revision.status?.imageDigest?.split('@').pop() !== image.split('@').pop()) {
    throw new Error('Revision identity, image, or health metadata does not match')
  }
}

function validateConfig(config) {
  if (!['staging', 'production'].includes(config.environment)) throw new Error('Invalid environment')
  if (!['web', 'worker'].includes(config.service)) throw new Error('Invalid service')
  if (!['prepare', 'promote', 'rollback'].includes(config.operation)) throw new Error('Invalid operation')
  requireMatch(config.project, /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'project')
  requireMatch(config.region, /^[a-z]+(-[a-z0-9]+)+[0-9]$/, 'region')
  requireMatch(config.image, digestPattern, 'immutable image')
  if (config.image.split('/')[1] !== config.project ||
      !config.image.startsWith(`${config.imageRepository}/idea-map-${config.service}@sha256:`)) {
    throw new Error('Image does not belong to the configured release repository and service')
  }
  const resolvedImage = config.resolvedImage ?? config.image
  requireMatch(resolvedImage, digestPattern, 'resolved immutable image')
  if (resolvedImage.split('@')[0] !== config.image.split('@')[0]) throw new Error('Resolved image belongs to another repository')
  const serviceName = `idea-map-${config.service}-${config.environment === 'staging' ? 'dev' : 'prod'}`
  requireMatch(config.expectedRevision, revisionPattern, 'expected current revision')
  if (!config.expectedRevision.startsWith(`${serviceName}-`)) throw new Error('Current revision is for another service')
  return { serviceName, resolvedImage }
}

/** Execute one release operation using an injected Cloud Run command adapter. */
export function release(config, run) {
  const { serviceName, resolvedImage } = validateConfig(config)
  const common = [`--project=${config.project}`, `--region=${config.region}`, '--quiet']
  const service = () => run(['run', 'services', 'describe', serviceName, ...common, '--format=json'], true)
  const revision = name => run(['run', 'revisions', 'describe', name, ...common, '--format=json'], true)
  const current = () => {
    const name = currentRevision(service(), serviceName, config.project, config.service)
    const serving = revision(name)
    // A terminally unhealthy serving revision can still be replaced or rolled back.
    checkedRevision(serving, serviceName, name, serving?.spec?.containers?.[0]?.image, config.project, true)
    return name
  }
  const before = current()
  if (before !== config.expectedRevision) throw new Error('Current revision changed since review')
  let target
  if (config.operation === 'prepare') {
    const prepared = run(['run', 'services', 'update', serviceName, `--image=${config.image}`,
      '--no-traffic', ...common, '--format=json'], true)
    target = requireMatch(prepared?.status?.latestCreatedRevisionName, revisionPattern, 'candidate revision')
    if (prepared.metadata?.name !== serviceName || !target.startsWith(`${serviceName}-`) || target === before ||
        reconciledStatus(prepared) !== 'True') throw new Error('Prepared service did not return a reconciled candidate')
    checkedRevision(revision(target), serviceName, target, resolvedImage, config.project)
    if (current() !== before) throw new Error('Traffic changed while preparing candidate')
  } else {
    target = requireMatch(config.revision, revisionPattern, 'target revision')
    if (!target.startsWith(`${serviceName}-`) || target === before) throw new Error('Invalid target revision')
    checkedRevision(revision(target), serviceName, target, resolvedImage, config.project)
    if (current() !== before) throw new Error('Traffic changed before update')
    run(['run', 'services', 'update-traffic', serviceName, `--to-revisions=${target}=100`, ...common], false)
    if (current() !== target) throw new Error('Traffic did not converge to target revision')
  }
  return { environment: config.environment, service: config.service, operation: config.operation,
    project: config.project, region: config.region, image: config.image, previousRevision: before, revision: target }
}

/** Verify the selected image before changing a Cloud Run service. */
export async function releaseChecked(config, run, readManifest) {
  const { serviceName } = validateConfig(config)
  if (config.operation === 'rollback') {
    requireMatch(config.revision, revisionPattern, 'target revision')
    if (!config.revision.startsWith(`${serviceName}-`) || config.revision === config.expectedRevision) throw new Error('Invalid target revision')
    const target = run(['run', 'revisions', 'describe', config.revision,
      `--project=${config.project}`, `--region=${config.region}`, '--quiet', '--format=json'], true)
    if (target?.spec?.containers?.[0]?.image === config.image &&
        target.status?.imageDigest?.split('@').pop() === config.image.split('@').pop()) {
      return release(config, run)
    }
  }
  const resolvedImage = await resolvePlatformImage(config.image, readManifest)
  return release({ ...config, resolvedImage }, run)
}

function gcloud(args, json) {
  const result = spawnSync('gcloud', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error('Cloud Run command failed; inspect the service before retrying')
  return json ? JSON.parse(result.stdout) : undefined
}

async function main(env) {
  const config = { environment: env.RELEASE_ENVIRONMENT, service: env.RELEASE_SERVICE,
    operation: env.RELEASE_OPERATION, project: env.GCP_PROJECT_ID, region: env.GCP_RUN_REGION,
    imageRepository: env.RELEASE_IMAGE_REPOSITORY, image: env.RELEASE_IMAGE,
    revision: env.RELEASE_REVISION, expectedRevision: env.EXPECTED_REVISION }
  validateConfig(config)
  const result = await releaseChecked(config, gcloud, url => {
    const credentials = spawnSync('gcloud', ['auth', 'print-access-token', '--quiet'], { encoding: 'utf8' })
    if (credentials.error || credentials.status !== 0) throw new Error('Could not obtain registry access token')
    return fetchRegistryManifest(url, credentials.stdout.trim())
  })
  writeFileSync('release-receipt.json', JSON.stringify({ ...result,
    run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT, source: env.GITHUB_SHA }, null, 2) + '\n')
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
    `\n### Cloud Run ${result.operation}\n\nService: \`${result.service}\` (${result.environment})\n\nImage: \`${result.image}\`\n\nPrevious revision: \`${result.previousRevision}\`\n\nTarget revision: \`${result.revision}\`\n\nRevision Ready=True; resolved image digest matches.\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.env).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
