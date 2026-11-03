import { generateDesign } from '../packages/streetmix/dist/index.js'
import { createCloudTasksDispatcher, sendTransactionalEmail } from '../packages/server/dist/index.js'
import { createOfflineProviderFixtures, selectFixtureProvider } from './provider-fixtures.mjs'

const argument = process.argv.slice(2)
if (argument.length !== 1 || !argument[0].startsWith('--mode=')) throw new Error('Use --mode=offline or --mode=provider')
const mode = argument[0].slice('--mode='.length)
const fixtures = createOfflineProviderFixtures()
// This demonstration supplies only offline adapters. A caller that owns an
// actual provider integration must explicitly supply its own provider factory.
const design = selectFixtureProvider(mode, { offline: () => fixtures.design })
const email = selectFixtureProvider(mode, { offline: () => fixtures.email })
const tasks = selectFixtureProvider(mode, { offline: () => fixtures.tasks })
const generated = await generateDesign(
  { ideaId: 'synthetic', interpretationRevision: 'revision-1', description: 'Synthetic street' },
  { plan: input => ({ name: input.description, segments: [{ kind: 'walkway', widthMeters: 2 }] }) }, design,
)
const sent = await sendTransactionalEmail(email, { from: 'sender@example.invalid', to: 'recipient@example.invalid',
  subject: 'Synthetic message', text: 'Synthetic content' }, 'fixture-email-1')
const dispatcher = createCloudTasksDispatcher({ queue: 'projects/synthetic-project/locations/us-central1/queues/jobs',
  workerOrigin: 'https://worker.example.invalid', invokerEmail: 'tasks@synthetic-project.iam.gserviceaccount.com', transport: tasks })
await dispatcher.dispatch({ id: '11111111-1111-4111-8111-111111111111', idempotencyKey: 'synthetic', kind: 'moderation-deadline',
  revisionId: null, assessmentId: null, assessmentReceivedAt: null, scheduledAt: new Date('2030-01-01T00:00:00Z'), deliveryGeneration: 0 }, new AbortController().signal)
console.log(JSON.stringify({ mode, designProvider: generated.provider, emailStatus: sent.status, task: 'accepted by in-memory transport' }))
