import { createApp, h } from 'vue'
import IdeaDialog from '../../app/components/IdeaDialog.vue'
import '../../src/styles/tokens.css'

createApp({ render: () => h(IdeaDialog, { title: 'Review idea', description: 'Check the details before continuing.' }, {
  trigger: () => h('button', 'Open dialog'),
  default: () => h('button', 'First action'),
}) }).mount('#app')
