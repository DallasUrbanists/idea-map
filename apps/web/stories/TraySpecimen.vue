<script setup lang="ts">
import { ref } from 'vue'
import Tray from '../app/components/Tray.vue'
import Button from '../app/components/Button.vue'
const props = withDefaults(defineProps<{ short?: boolean; busy?: boolean; placement?: 'bottom' | 'side'; canDragOpen?: boolean; canDragClose?: boolean }>(), { placement: 'bottom', canDragOpen: true, canDragClose: true })
const open = ref(true)
const maximize = ref(false)
const background = ref(0)
const extra = ref(false)
</script>
<template>
  <div class="tray-specimen">
    <Button class="background-action" variant="secondary" @click="background++">Interact with background</Button>
    <p role="status">Background interactions: {{ background }}</p>
    <div :class="['tray-example-area', { side: placement === 'side' }]">
      <Tray v-model:open="open" v-model:maximize="maximize" label="Example tray" :placement="placement" :busy="busy" :can-drag-open="canDragOpen" :can-drag-close="canDragClose">
        <template #head><h1>Example tray</h1></template>
        <div class="tray-example-content">
          <p>Map and tray controls can be used independently.</p>
          <Button variant="secondary" @click="extra = !extra">{{ extra ? 'Remove content' : 'Add content' }}</Button>
          <template v-if="!short || extra"><p v-for="index in 30" :key="index">Community idea {{ index }}: synthetic details demonstrate a fixed header and independently scrolling content.</p></template>
        </div>
      </Tray>
    </div>
  </div>
</template>
<style scoped>
.tray-specimen { height: 100dvh; position: relative; box-sizing: border-box; padding: var(--gap-spread); background: var(--map-ground); color: var(--color-text); font: var(--font-body) / var(--line-body) var(--font-family-body); }
.tray-example-area { position: absolute; inset: 0; pointer-events: none; }
.tray-example-area.side { width: min(var(--size-pane-wide), 80%); }
.tray-example-content { padding: var(--gap-standard); }
h1 { margin: 0; font-size: var(--font-heading); }
.background-action { position: relative; z-index: 1; }
</style>
