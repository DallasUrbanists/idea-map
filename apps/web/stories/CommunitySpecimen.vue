<script setup lang="ts">
import { ref } from 'vue'
import IdeaCard from '../app/components/IdeaCard.vue'
import IdeaDetails from '../app/components/IdeaDetails.vue'
import CommentComposer from '../app/components/CommentComposer.vue'
import CommentThread from '../app/components/CommentThread.vue'
import NotificationInbox from '../app/components/NotificationInbox.vue'
import SummaryConversation from '../app/components/SummaryConversation.vue'
import Button from '../app/components/Button.vue'

const props = withDefaults(defineProps<{ role?: 'guest' | 'owner' | 'moderator'; initialState?: 'idle' | 'pending' | 'error' | 'offline' }>(), { role: 'owner', initialState: 'idle' })
const state = ref(props.initialState)
const liked = ref(false)
const following = ref(false)
const comment = ref('')
const notice = ref('')
const comments = ref([{ id: 'one', author: 'Avery', text: 'Could we add seating under the trees?', time: 'Today' }])
function send() {
  if (state.value === 'error') { state.value = 'idle'; return }
  comments.value.push({ id: String(comments.value.length + 1), author: 'You', text: comment.value, time: 'Just now' })
  comment.value = ''
}
</script>
<template>
  <main class="specimen">
    <h1>Community patterns <small>Draft</small></h1>
    <p>Local synthetic example · {{ role }} · {{ state }}</p>
    <div class="controls"><Button variant="secondary" @click="state = state === 'offline' ? 'idle' : 'offline'">Toggle offline</Button><Button variant="secondary" @click="state = 'error'">Simulate error</Button><Button variant="secondary" @click="state = 'pending'">Simulate pending</Button><Button variant="secondary" @click="state = 'idle'">Reset state</Button></div>
    <IdeaCard title="Shade for the bus stop" summary="Plant shade trees near the stop and add a place to sit." :role="role" :liked="liked" :following="following" :offline="state === 'offline'" :pending="state === 'pending'" :error="state === 'error' ? 'The action could not be updated. Try again.' : ''" @like="liked = !liked" @follow="following = !following" @open="notice = 'Idea selected.'" @moderate="notice = 'Review selected.'" />
    <p v-if="notice" role="status">{{ notice }}</p>
    <IdeaDetails title="Shade for the bus stop" author="Morgan" description="A cooler place to wait would make this stop more comfortable in summer." :role="role" @edit="notice = 'Edit selected.'" @moderate="notice = 'Review selected.'" />
    <CommentThread :comments="comments" :role="role" @moderate="notice = 'Comment review selected.'" />
    <CommentComposer v-model="comment" :role="role" :state="state" @submit="send" />
    <NotificationInbox :items="[{ id: 'n1', text: 'Avery commented on Shade for the bus stop', unread: true }]" :state="state" @retry="state = 'idle'" @open="notice = 'Notification selected.'" />
    <SummaryConversation summary="The community is discussing shade and seating at the stop." :messages="[{ id: 'm1', author: 'Morgan', text: 'Where would the seating fit?' }, { id: 'm2', author: 'Avery', text: 'Beside the existing shelter, clear of the walkway.' }]" />
  </main>
</template>
<style scoped>
.specimen { box-sizing: border-box; max-width: 52rem; margin: auto; padding: var(--gap-standard); display: grid; gap: var(--gap-standard); color: var(--color-text); font: var(--font-body) / var(--line-body) var(--font-family-body); }
.controls { display: flex; gap: var(--gap-compact); flex-wrap: wrap; }
h1,p { margin: 0; } small { font-size: var(--font-small); }
</style>
