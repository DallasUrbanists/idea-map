import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSource } from './boundaries.mjs';

test('browser imports cannot reach server code or Node builtins', () => {
  const file = 'apps/web/src/client.ts';
  for (const specifier of ['@idea-map/server', '../src/server/secrets.js', 'node:fs', 'fs']) {
    assert.notEqual(checkSource(file, "import x from '" + specifier + "'").length, 0, specifier);
  }
  assert.deepEqual(checkSource(file, "import x from '@idea-map/contracts'"), []);
});

test('dynamic imports and package-to-application imports are checked', () => {
  assert.notEqual(checkSource('packages/streetmix/src/index.ts',
    "export * from '../../../apps/web/src/index.js'").length, 0);
  assert.notEqual(checkSource('packages/contracts/src/index.ts',
    "import('@idea-map/server')").length, 0);
  assert.notEqual(checkSource('packages/contracts/src/index.ts',
    "type Secret = import('@idea-map/server').Secret").length, 0);
  assert.notEqual(checkSource('apps/web/pages/index.ts',
    "import x from '../server/secrets.js'").length, 0);
  assert.notEqual(checkSource('packages/server/src/index.ts',
    "import x from '@idea-map/web'").length, 0);
  assert.notEqual(checkSource('apps/web/src/client.ts', 'import(name)').length, 0);
  assert.notEqual(checkSource('apps/web/src/client.ts', "require.resolve('node:fs')").length, 0);
});

test('server code may use Node builtins', () => {
  assert.deepEqual(checkSource('apps/web/src/server/config.ts', "import fs from 'node:fs'"), []);
});

test('Vue component scripts cannot import server modules', () => {
  const file = 'apps/web/pages/index.vue';
  assert.notEqual(checkSource(file,
    "<script setup lang=\"ts\">import x from '@idea-map/server'</script><template><p>Hello</p></template>").length, 0);
  assert.deepEqual(checkSource(file,
    "<script setup lang=\"ts\">import x from '@idea-map/contracts'</script><template><p>Hello</p></template>"), []);
  assert.notEqual(checkSource(file,
    '<template>{{ import("node:fs") }}</template>').length, 0);
});
