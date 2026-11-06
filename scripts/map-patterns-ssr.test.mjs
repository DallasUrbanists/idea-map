import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { createSSRApp, h } = require('vue')
const { renderToString } = require('vue/server-renderer')
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)

test('map shell, search, closed tray and canvas render without browser globals or provider requests', async () => {
  const root = fileURLToPath(new URL('../apps/web/', import.meta.url))
  const configFile = fileURLToPath(new URL('../apps/web/tests/controls/vite.config.mjs', import.meta.url))
  const server = await createServer({ root, configFile, server: { middlewareMode: true }, appType: 'custom' })
  try {
    const components = await Promise.all(['MapShell', 'MapSearchBar', 'MapCanvas', 'Tray'].map(async name => (await server.ssrLoadModule(`/app/components/${name}.vue`)).default))
    const [MapShell, MapSearchBar, MapCanvas, Tray] = components
    const html = await renderToString(createSSRApp({ render: () => h('div', [
      h(MapShell, {}, { map: () => h(MapCanvas), search: () => h(MapSearchBar, { modelValue: '', destinations: [{ value: 'map', label: 'Explore' }] }), foreground: () => h(Tray, { open: false, label: 'Details' }, () => h('button', 'Hidden action')) }),
      h(MapShell),
    ]) }))
    assert.match(html, /Loading map/)
    assert.match(html, /aria-label="Map workspace"/)
    assert.match(html, /aria-label="Interactive idea map"/)
    assert.match(html, /aria-hidden="true" inert/)
    assert.doesNotMatch(html, /maps\.googleapis\.com/)
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1])
    assert.equal(new Set(ids).size, ids.length)
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id))
  } finally { await server.close() }
})
