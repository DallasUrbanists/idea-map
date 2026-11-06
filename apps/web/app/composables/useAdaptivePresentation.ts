import { computed, onBeforeUnmount, onMounted, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { resolveMapLayout, type MapPresentation } from './map-layout'

export function useAdaptivePresentation(presentation: MaybeRefOrGetter<MapPresentation>) {
  const width = ref(0)
  const height = ref(0)
  const visualHeight = ref(0)
  const visualTop = ref(0)
  const finePointer = ref(false)
  let pointer: MediaQueryList | undefined
  const update = () => {
    width.value = window.innerWidth
    height.value = window.innerHeight
    visualHeight.value = window.visualViewport?.height ?? height.value
    visualTop.value = window.visualViewport?.offsetTop ?? 0
    finePointer.value = pointer?.matches ?? false
  }
  onMounted(() => {
    pointer = window.matchMedia('(pointer: fine)')
    update()
    window.addEventListener('resize', update)
    pointer.addEventListener('change', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', update)
    pointer?.removeEventListener('change', update)
    window.visualViewport?.removeEventListener('resize', update)
    window.visualViewport?.removeEventListener('scroll', update)
  })
  const layout = computed(() => resolveMapLayout({ width: width.value, height: height.value, finePointer: finePointer.value }, toValue(presentation)))
  return { layout, width, height, visualHeight, visualTop }
}
