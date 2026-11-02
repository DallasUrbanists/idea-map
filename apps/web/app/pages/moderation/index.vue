<script setup lang="ts">
type Entry = { revisionId: string, createdAt: string, reviewState: string, version: number }
type Cursor = { revisionId: string, createdAt: string }
type Hold = { id: string, kind: string, reason: string, ownerId: string | null, sequence: number }
type Change = { id: string, reason: string }
type Review = { revisionId: string, version: number, content: unknown, assessmentId: string | null, reviewState: string, activeHolds: Hold[], activeChangeRequests: Change[] }
type Action = 'place-hold' | 'release-hold' | 'request-changes' | 'resolve-changes'

useHead({ title: 'Moderation review', meta: [{ name: 'robots', content: 'noindex, nofollow' }] })
const entries = ref<Entry[]>([])
const next = ref<Cursor | null>(null)
const review = ref<Review | null>(null)
const busy = ref(false)
const message = ref('')
const reason = ref('')
const action = ref<Action>('place-hold')
const target = ref('')

function failure(status: number): string {
  if (status === 401) return 'Sign in with your moderator account to continue.'
  if (status === 403) return 'Your account does not currently have moderator access.'
  if (status === 409) return 'This review changed. Reload it before deciding what to do next.'
  return 'Review is unavailable. Try again later.'
}
async function loadQueue(cursor: Cursor | null = null) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  review.value = null
  try {
    const query = cursor ? `?${new URLSearchParams({ after: cursor.revisionId, at: cursor.createdAt })}` : ''
    const response = await fetch(`/api/moderation/queue${query}`, { cache: 'no-store' })
    if (!response.ok) { entries.value = []; next.value = null; message.value = failure(response.status); return }
    const result = await response.json() as { entries: Entry[], next: Cursor | null }
    entries.value = result.entries
    next.value = result.next
  } catch { entries.value = []; next.value = null; message.value = failure(0) }
  finally { busy.value = false }
}
async function loadRevision(id: string) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  review.value = null
  reason.value = ''
  target.value = ''
  try {
    const response = await fetch(`/api/moderation/revisions/${encodeURIComponent(id)}`, { cache: 'no-store' })
    if (!response.ok) { message.value = response.status === 404 ? 'This revision is no longer awaiting review.' : failure(response.status); return }
    review.value = await response.json() as Review
    action.value = 'place-hold'
  } catch { review.value = null; reason.value = ''; target.value = ''; message.value = failure(0) }
  finally { busy.value = false }
}
async function submitAction() {
  if (busy.value || !review.value) return
  const current = review.value
  const trimmed = reason.value.trim()
  if (!trimmed || new TextEncoder().encode(trimmed).byteLength > 1000) { message.value = 'Enter a reason of at most 1,000 bytes.'; return }
  if (action.value === 'release-hold' && !current.activeHolds.some(hold => hold.id === target.value)) { message.value = 'Select an active hold.'; return }
  if (action.value === 'resolve-changes' && !current.activeChangeRequests.some(request => request.id === target.value)) { message.value = 'Select an active change request.'; return }
  const body: Record<string, string | null> = { action: action.value, revisionId: current.revisionId, assessmentId: current.assessmentId, reason: trimmed }
  if (action.value === 'release-hold') body.holdId = target.value
  if (action.value === 'resolve-changes') body.requestId = target.value
  busy.value = true
  message.value = ''
  try {
    const response = await fetch('/api/moderation/actions', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-idea-map-session': 'IdeaMapSession' }, body: JSON.stringify(body) })
    if (!response.ok) { review.value = null; reason.value = ''; target.value = ''; message.value = failure(response.status); return }
    review.value = null
    reason.value = ''
    target.value = ''
    message.value = 'Action recorded. Reload the revision to see its current state.'
  } catch { review.value = null; reason.value = ''; target.value = ''; message.value = failure(0) }
  finally { busy.value = false }
}
onMounted(() => { void loadQueue() })
</script>

<template>
  <main>
    <h1>Moderation review</h1>
    <p><NuxtLink to="/account">Sign in or manage your account</NuxtLink></p>
    <p role="status" aria-live="polite">{{ message }}</p>
    <section aria-labelledby="queue-title">
      <h2 id="queue-title">Pending revisions</h2>
      <button :disabled="busy" @click="loadQueue()">Refresh queue</button>
      <p v-if="!entries.length && !busy && !message">No pending revisions on this page.</p>
      <ul>
        <li v-for="entry in entries" :key="entry.revisionId">
          <button :disabled="busy" @click="loadRevision(entry.revisionId)">Review revision {{ entry.revisionId }}</button>
          <span> {{ entry.createdAt }} · {{ entry.reviewState }} · version {{ entry.version }}</span>
        </li>
      </ul>
      <button v-if="next" :disabled="busy" @click="loadQueue(next)">Next page</button>
    </section>
    <section v-if="review" aria-labelledby="review-title">
      <h2 id="review-title">Revision {{ review.revisionId }}</h2>
      <p>Version {{ review.version }} · {{ review.reviewState }}</p>
      <p>Media review is unavailable here. Review every part of a submission before making a decision.</p>
      <h3>Submitted content</h3>
      <pre>{{ JSON.stringify(review.content, null, 2) }}</pre>
      <h3>Active holds</h3>
      <ul v-if="review.activeHolds.length">
        <li v-for="hold in review.activeHolds" :key="hold.id">{{ hold.kind }}: {{ hold.reason }} <span v-if="hold.ownerId">(owner {{ hold.ownerId }}, sequence {{ hold.sequence }})</span></li>
      </ul>
      <p v-else>No active holds.</p>
      <h3>Active change requests</h3>
      <ul v-if="review.activeChangeRequests.length">
        <li v-for="request in review.activeChangeRequests" :key="request.id">{{ request.reason }}</li>
      </ul>
      <p v-else>No active change requests.</p>
      <form @submit.prevent="submitAction">
        <h3>Review action</h3>
        <label for="action">Action</label>
        <select id="action" v-model="action" :disabled="busy" @change="target = ''">
          <option value="place-hold">Place a hold</option>
          <option value="request-changes">Request changes</option>
          <option value="release-hold">Release a hold</option>
          <option value="resolve-changes">Resolve a change request</option>
        </select>
        <template v-if="action === 'release-hold'">
          <label for="hold">Hold to release</label>
          <select id="hold" v-model="target" :disabled="busy" required>
            <option value="">Select a hold</option>
            <option v-for="hold in review.activeHolds" :key="hold.id" :value="hold.id">{{ hold.kind }}: {{ hold.reason }}</option>
          </select>
        </template>
        <template v-if="action === 'resolve-changes'">
          <label for="request">Change request to resolve</label>
          <select id="request" v-model="target" :disabled="busy" required>
            <option value="">Select a change request</option>
            <option v-for="request in review.activeChangeRequests" :key="request.id" :value="request.id">{{ request.reason }}</option>
          </select>
        </template>
        <label for="reason">Reason</label>
        <textarea id="reason" v-model="reason" :disabled="busy" maxlength="1000" required />
        <p>Keep contact details and submitted content out of the reason.</p>
        <button :disabled="busy">Record action</button>
      </form>
    </section>
  </main>
</template>

<style scoped>
main { max-width: 64rem; margin: var(--space-8) auto; padding: 0 var(--space-4); color: var(--color-text); font: var(--font-size-body) / var(--line-body) var(--font-body); overflow-wrap: anywhere; }
h1 { font: var(--font-size-display) / var(--line-heading) var(--font-heading); }
section { margin: var(--space-6) 0; }
ul { padding-left: var(--space-6); }
li { margin: var(--space-2) 0; }
form { display: grid; gap: var(--space-2); max-width: 40rem; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: var(--space-3); background: var(--color-surface-raised); }
button, select, textarea { box-sizing: border-box; min-height: 44px; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-small); color: var(--color-text); background: var(--color-surface); font: inherit; }
button { cursor: pointer; }
button:disabled, select:disabled, textarea:disabled { opacity: 0.6; cursor: not-allowed; }
button:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }
</style>
