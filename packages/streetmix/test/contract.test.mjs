import { generateDesign } from '../dist/index.js'
const check = (condition, message) => { if (!condition) throw new Error(message) }
const input = { ideaId: 'idea-1', interpretationRevision: 'rev-2', description: 'test' }
const plan = { name: 'test', segments: [{ kind: 'walkway', widthMeters: 2 }] }
let seen
const rules = { plan: value => { check(value === input, 'rules receive input'); return plan } }
const provider = { create: async (value, context) => { seen = { value, context }; return { provider: 'fake', designId: 'design-1', sourceRevision: context.sourceRevision } } }
const result = await generateDesign(input, rules, provider)
check(seen.value === plan && seen.context.sourceRevision === 'rev-2', 'provider receives plan and source revision')
check(result.designId === 'design-1' && result.sourceRevision === 'rev-2', 'provider result is returned')
const failure = new Error('provider unavailable')
try { await generateDesign(input, rules, { create: async () => { throw failure } }); throw new Error('expected failure') }
catch (error) { check(error === failure, 'provider failure must propagate') }
