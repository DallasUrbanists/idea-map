import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { createSSRApp, h } = require('vue')
const { renderToString } = require('vue/server-renderer')
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)

test('fields render unique label and validation associations; progress normalizes invalid ranges', async () => {
  const server = await createServer({ configFile: 'tests/controls/vite.config.mjs', server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { default: Field } = await server.ssrLoadModule('/app/components/IdeaField.vue')
    const { default: Progress } = await server.ssrLoadModule('/app/components/IdeaProgress.vue')
    const html = await renderToString(createSSRApp({ render: () => h('form', [
      h(Field, { label: 'First', modelValue: '', hint: 'Hint', error: 'Required', name: 'first' }),
      h(Field, { label: 'Second', modelValue: 'A draft', multiline: true }),
      h(Progress, { label: 'Upload', value: 150, max: 100 }),
      h(Progress, { label: 'Unknown', value: Number.NaN, max: -1 }),
    ]) }))
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1])
    assert.equal(new Set(ids).size, ids.length)
    for (const [, id] of html.matchAll(/for="([^"]+)"/g)) assert.ok(ids.includes(id))
    for (const [, list] of html.matchAll(/aria-describedby="([^"]+)"/g)) for (const id of list.split(' ')) assert.ok(ids.includes(id))
    assert.match(html, /aria-invalid="true"/)
    assert.match(html, /name="first"/)
    assert.match(html, /<textarea[^>]*>A draft<\/textarea>/)
    assert.match(html, /<progress[^>]*value="100"[^>]*max="100"/)
    assert.match(html, /<progress id="[^"]+" max="100"/)
  } finally { await server.close() }
})
