import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const requiredWorkflows = ['moderation-foundation.yml', 'browser-ci.yml', 'dependency-audit.yml']

/** Require the latest push run for this exact commit in each required workflow to pass. */
export function requirePassingRuns(sha, workflowRuns) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid source commit')
  for (const workflow of requiredWorkflows) {
    const runs = workflowRuns[workflow]
    const latest = Array.isArray(runs) ? runs[0] : undefined
    if (!latest || latest.head_sha !== sha || latest.head_branch !== 'main' || latest.event !== 'push' ||
        latest.status !== 'completed' || latest.conclusion !== 'success') {
      throw new Error(`Required main-branch CI is not passing: ${workflow}`)
    }
  }
}

async function main(env) {
  if (env.GITHUB_REPOSITORY !== 'DallasUrbanists/idea-map' || env.GITHUB_REF !== 'refs/heads/main' ||
      !env.GITHUB_TOKEN || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA)) throw new Error('Invalid release source')
  const result = {}
  for (const workflow of requiredWorkflows) {
    const url = new URL(`/repos/DallasUrbanists/idea-map/actions/workflows/${workflow}/runs`, env.GITHUB_API_URL)
    url.search = new URLSearchParams({ branch: 'main', event: 'push', head_sha: env.GITHUB_SHA, per_page: '100' })
    const response = await fetch(url, { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`Could not inspect required CI: ${workflow}`)
    result[workflow] = (await response.json()).workflow_runs
  }
  requirePassingRuns(env.GITHUB_SHA, result)
  console.log('Required main-branch CI passed for the release commit.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.env).catch(error => { console.error(error.message); process.exitCode = 1 })
}
