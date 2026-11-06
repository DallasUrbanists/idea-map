import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// Exercise the helpers imported by web server code with the event created by
// Nitro's own H3 dependency. The production bundle may deduplicate H3 and mask
// an incompatible direct dependency in a built-server smoke test.
test('web H3 helpers accept Nitro request events', async () => {
  const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const nuxtRequire = createRequire(webRequire.resolve('nuxt/package.json'));
  const nitroRequire = createRequire(nuxtRequire.resolve('nitropack/package.json'));
  const webH3 = await import(webRequire.resolve('h3'));
  const nitroH3 = await import(nitroRequire.resolve('h3'));
  const app = nitroH3.createApp();
  app.use((event) => {
    webH3.setResponseHeader(event, 'Cache-Control', 'private, no-store');
    return 'ok';
  });
  const server = createServer(nitroH3.toNodeListener(app));
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await response.text(), 'ok');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
