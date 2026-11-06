import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import * as server from '../packages/server/dist/index.js'
import { acquirePublicAccessLease } from '../packages/server/dist/public-access-lease.js'

function fakePool() {
  const client = new EventEmitter()
  client.query = async sql => {
    if (sql.includes('public.public_access_allowed()')) return { rows: [{ is_open: true, closing: false }] }
    if (sql.includes('FROM ideas AS idea')) return { rows: [{ title: 'Synthetic title', description: 'Synthetic description' }] }
    return { rows: [] }
  }
  client.release = () => {}
  return { client, connect: async () => client }
}

test('server public content APIs require a real, active lease', async () => {
  assert.equal('readPublishedIdea' in server, false)
  assert.equal('getMediaPreview' in server, false)
  assert.equal('readMediaPreview' in server, false)
  assert.equal('publicAccessLeaseClient' in server, false)
  for (const name of ['removePublishedIdea', 'placeLegalHold', 'releaseLegalHold']) assert.equal(name in server, false)
  assert.equal(typeof server.lockIdeaIfNotHeld, 'function')
  const pool = fakePool()
  const forged = { client: pool.client, signal: new AbortController().signal, release: async () => {} }
  await assert.rejects(server.readGuardedPublishedIdea('synthetic', forged), /Public access unavailable/)
  await assert.rejects(server.getGuardedMediaPreview('synthetic', 'synthetic', 100, 'provider', forged), /Public access unavailable/)
  const lease = await acquirePublicAccessLease(pool)
  assert.equal(Object.isFrozen(lease), true)
  assert.equal('client' in lease, false)
  assert.deepEqual(await server.readGuardedPublishedIdea('synthetic', lease),
    { title: 'Synthetic title', description: 'Synthetic description' })
  await lease.release()
  await assert.rejects(server.readGuardedPublishedIdea('synthetic', lease), /Public access unavailable/)
  await assert.rejects(server.getGuardedMediaPreview('synthetic', 'synthetic', 100, 'provider', lease), /Public access unavailable/)
})

test('a projection returned after lease release is not exposed', async () => {
  const pool = fakePool()
  const original = pool.client.query
  let resolveProjection
  pool.client.query = sql => sql.includes('FROM ideas AS idea')
    ? new Promise(resolve => { resolveProjection = resolve }) : original(sql)
  const lease = await acquirePublicAccessLease(pool)
  const reading = server.readGuardedPublishedIdea('synthetic', lease)
  await lease.release()
  resolveProjection({ rows: [{ title: 'Synthetic title', description: 'Synthetic description' }] })
  await assert.rejects(reading, /Public access unavailable/)
})
