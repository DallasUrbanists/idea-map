import Table from '../app/components/Table.vue'
import Status from '../app/components/Status.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Table', component: Table }
const state = () => ({ columns: [{ key: 'title', label: 'Idea' }, { key: 'supporters', label: 'Supporters' }, { key: 'status', label: 'Status' }], rows: [{ id: 'shade', title: 'Shade at the bus stop', supporters: 42, status: 'Open for comments' }, { id: 'sidewalk', title: 'A wider sidewalk', supporters: 18, status: 'Workshop draft' }] })
export const Default = example({ Table }, '<Table caption="Workshop ideas" :columns="columns" :rows="rows" />', state)
export const Empty = example({ Table }, '<Table caption="Saved ideas" :columns="columns" :rows="[]" empty-label="No saved ideas. Save an idea to see it here." />', state)
export const CustomCells = example({ Table, Status }, '<Table caption="Workshop ideas" :columns="columns" :rows="rows"><template #cell="{ row, column }"><Status v-if="column.key === \'status\'" variant="pill">{{ row.status }}</Status><template v-else>{{ row[column.key] }}</template></template></Table>', state)
export const Light = { ...Default, globals: { theme: 'light' } }
export const Dark = { ...Default, globals: { theme: 'dark' } }
export const UsageDefault = { ...Default, tags: ['!dev'] }
export const UsageEmpty = { ...Empty, tags: ['!dev'] }
export const UsageCells = { ...CustomCells, tags: ['!dev'] }

