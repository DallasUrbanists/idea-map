import { createApp, h } from 'vue'
import Button from '../../app/components/Button.vue'
import Dialog from '../../app/components/Dialog.vue'
import '../../src/styles/tokens.css'

createApp({ render: () => h(Dialog, { title: 'Review idea', description: 'Check the details before continuing.' }, {
  trigger: () => h(Button, null, () => 'Open dialog'),
  default: () => h('button', 'First action'),
}) }).mount('#app')
