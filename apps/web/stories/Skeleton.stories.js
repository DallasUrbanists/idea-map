import { ref } from 'vue'
import Skeleton from '../app/components/Skeleton.vue'
import Button from '../app/components/Button.vue'
import Card from '../app/components/Card.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Skeleton', component: Skeleton }
export const Default = example({ Skeleton }, '<div class="catalog-stack"><Skeleton label="Loading community ideas" :rows="3" /></div>')
export const WithoutLead = example({ Skeleton }, '<div class="catalog-stack"><Skeleton label="Loading saved ideas" :rows="2" :lead="false" /></div>')
export const Completion = example({ Skeleton, Button, Card }, '<div class="catalog-stack"><Skeleton v-if="loading" label="Loading community ideas" :rows="2" /><template v-else><p role="status">2 ideas loaded</p><Card>Shade at the bus stop</Card><Card>A wider sidewalk</Card></template><Button variant="secondary" @click="loading = !loading">{{ loading ? "Simulate loaded results" : "Simulate loading" }}</Button></div>', () => ({ loading: ref(true) }))
export const Light = { ...Default, globals: { theme: 'light' } }
export const Dark = { ...Default, globals: { theme: 'dark' } }
export const UsageDefault = { ...Completion, tags: ['!dev'] }
export const UsageWithoutLead = { ...WithoutLead, tags: ['!dev'] }

