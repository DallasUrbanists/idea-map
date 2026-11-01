import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowsSessionMutation } from '../apps/web/server/utils/session-csrf.mjs'

const valid = { origin: 'https://ideas.example', expectedOrigin: 'https://ideas.example', contentType: 'application/json', requestedWith: 'IdeaMapSession' }
test('session mutation requires exact configured origin and non-simple JSON request', () => {
  assert.equal(allowsSessionMutation(valid), true)
  for (const change of [
    { origin: undefined }, { origin: 'null' }, { origin: 'https://ideas.example.evil.test' },
    { expectedOrigin: '' }, { expectedOrigin: 'https://ideas.example/path' },
    { expectedOrigin: 'http://ideas.example', origin: 'http://ideas.example' },
    { contentType: 'text/plain' }, { contentType: 'application/jsonp' },
    { requestedWith: undefined }, { requestedWith: 'XMLHttpRequest' },
  ]) assert.equal(allowsSessionMutation({ ...valid, ...change }), false, JSON.stringify(change))
  assert.equal(allowsSessionMutation({ ...valid, origin: 'http://localhost:3000', expectedOrigin: 'http://localhost:3000', contentType: 'application/json; charset=utf-8' }), true)
})
