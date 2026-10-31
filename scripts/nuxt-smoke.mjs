import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Build the web app before running this smoke test. Exercise the actual server,
// including the SSR response and the runtime-config serialization boundary.
test('production server renders, responds safely, and keeps private config private', async () => {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const secret = 'test-private-runtime-value-847329';
  const server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_API_SECRET: secret, NUXT_DATABASE_URL: '' },
    stdio: 'ignore',
  });
  const base = 'http://127.0.0.1:' + port;
  try {
    let health;
    for (let n = 0; n < 60; n++) {
      if (server.exitCode !== null) throw new Error('server exited before starting');
      try { health = await fetch(base + '/api/health'); break; } catch { await delay(250); }
    }
    assert.ok(health, 'server did not start');
    assert.deepEqual(await health.json(), { status: 'ok' });
    const home = await fetch(base + '/');
    const html = await home.text();
    assert.equal(home.status, 200);
    assert.match(html, /<h1>Idea Map<\/h1>/);
    assert.ok(!html.includes(secret));
    const api = await fetch(base + '/api/ideas/missing');
    assert.equal(api.status, 404);
    assert.match(api.headers.get('content-type'), /application\/json/);
    assert.equal((await api.json()).statusCode, 404);
    const unavailable = await fetch(base + '/api/ideas/11111111-1111-4111-8111-111111111111');
    assert.equal(unavailable.status, 503);
    assert.ok(!(await unavailable.text()).includes(secret));
    const page = await fetch(base + '/suggestion/missing');
    assert.equal(page.status, 404);
    assert.ok(!(await page.text()).includes(secret));
  } finally {
    server.kill();
  }
});
