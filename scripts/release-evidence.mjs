import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function verifyRun(run, id, attempt, workflow) {
  if (!/^[1-9][0-9]*$/.test(id) || String(run?.id) !== id ||
      !/^[1-9][0-9]*$/.test(attempt) || String(run.run_attempt) !== attempt ||
      run.repository?.full_name !== 'DallasUrbanists/idea-map' ||
      run.path !== `.github/workflows/${workflow}` || run.event !== 'workflow_dispatch' ||
      run.head_branch !== 'main' || run.status !== 'completed' || run.conclusion !== 'success' ||
      !/^[a-f0-9]{40}$/.test(run.head_sha)) throw new Error('Release evidence is not a successful trusted run')
}

/** Verify build and, for production, staging promotion evidence for an image digest. */
export function verifyEvidence(config, buildRun, manifest, stagingRun, receipt) {
  if (!['staging', 'production'].includes(config.environment) || !['web', 'worker'].includes(config.service) ||
      !['prepare', 'promote'].includes(config.operation) ||
      !/^.+@sha256:[a-f0-9]{64}$/.test(config.image)) throw new Error('Invalid evidence request')
  verifyRun(buildRun, config.buildRunId, config.buildAttempt, 'build-release-images.yml')
  if (manifest.run_id !== config.buildRunId || manifest.run_attempt !== config.buildAttempt || manifest.source !== buildRun.head_sha ||
      typeof manifest.images?.[config.service] !== 'string') throw new Error('Build metadata does not match its run')
  const builtImage = manifest.images[config.service]
  const digest = config.image.split('@')[1]
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(builtImage) || builtImage.split('@')[1] !== digest ||
      (config.environment === 'staging' && builtImage !== config.image)) {
    throw new Error('Image digest does not match the checked build')
  }
  if (config.environment === 'production') {
    verifyRun(stagingRun, config.stagingRunId, config.stagingAttempt, 'cloud-run-release.yml')
    if (receipt?.run_id !== config.stagingRunId || receipt.run_attempt !== config.stagingAttempt || receipt.source !== stagingRun.head_sha ||
        receipt.environment !== 'staging' || receipt.operation !== 'promote' ||
        receipt.service !== config.service || receipt.image !== builtImage) {
      throw new Error('Staging promotion evidence does not match the image and service')
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = process.env
    const read = path => JSON.parse(readFileSync(path, 'utf8'))
    const production = env.RELEASE_ENVIRONMENT === 'production'
    verifyEvidence({ environment: env.RELEASE_ENVIRONMENT, service: env.RELEASE_SERVICE,
      operation: env.RELEASE_OPERATION, image: env.RELEASE_IMAGE, buildRunId: env.BUILD_RUN_ID,
      buildAttempt: env.BUILD_ATTEMPT, stagingRunId: env.STAGING_RUN_ID,
      stagingAttempt: env.STAGING_ATTEMPT }, read('build-run.json'), read('build-evidence/release-images.json'),
    production ? read('staging-run.json') : undefined,
    production ? read('staging-evidence/release-receipt.json') : undefined)
    console.log('Release evidence matches the selected image and environment.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
