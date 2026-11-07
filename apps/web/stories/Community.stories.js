import CommunitySpecimen from './CommunitySpecimen.vue'

export default { title: 'Components/Community patterns', component: CommunitySpecimen }
export const Owner = {}
export const Guest = { args: { role: 'guest' } }
export const Moderator = { args: { role: 'moderator' } }
export const Offline = { args: { initialState: 'offline' } }
export const Error = { args: { initialState: 'error' } }
export const Pending = { args: { initialState: 'pending' } }
export const Dark = { globals: { theme: 'dark' } }
