// A fake-backed example only: no real provider, network calls or secrets.
import { generateDesign } from '../dist/index.js'

const rules = { plan: input => ({ name: input.description, segments: [{ kind: 'walkway', widthMeters: 2 }] }) }
const fakeProviderFactory = {
  create: credentials => ({
    create: async (plan, context) => {
      if (!credentials.accessToken) throw new Error('Fake credential required')
      return { provider: 'fake', designId: `fake:${plan.segments.length}`, sourceRevision: context.sourceRevision }
    },
  }),
}
const input = { ideaId: 'example', interpretationRevision: 'revision-1', description: 'A walkable street' }
const provider = fakeProviderFactory.create({ accessToken: 'fake-test-token' })
const result = await generateDesign(input, rules, provider)
console.log(JSON.stringify(result))
