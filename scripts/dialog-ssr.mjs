import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { createSSRApp, h } = require('vue')
const { renderToString } = require('vue/server-renderer')
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)

test('the closed dialog trigger renders on the server', async () => {
  const server = await createServer({ configFile: 'tests/dialog/vite.config.mjs', server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { default: Dialog } = await server.ssrLoadModule('/app/components/Dialog.vue')
    const html = await renderToString(createSSRApp({ render: () => h(Dialog, { title: 'Title', description: 'Description' }, { trigger: () => h('button', 'Open dialog') }) }))
    assert.match(html, /<button[^>]*>Open dialog<\/button>/)
  } finally { await server.close() }
})
