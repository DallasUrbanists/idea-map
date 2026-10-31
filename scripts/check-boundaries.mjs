import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkSource } from './boundaries.mjs';

const roots = ['apps', 'packages'];
let failed = false;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.posix.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      console.error(file + ': symlinks are not supported by the boundary check');
      failed = true;
    } else if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.nuxt', '.output', 'storybook-static'].includes(entry.name)) await walk(file);
    } else if (/\.[cm]?[jt]sx?$/.test(file) || file.endsWith('.vue')) {
      for (const problem of checkSource(file, await readFile(file, 'utf8'))) {
        console.error(file + ': ' + problem);
        failed = true;
      }
    }
  }
}
for (const root of roots) await walk(root);
if (failed) process.exitCode = 1;
