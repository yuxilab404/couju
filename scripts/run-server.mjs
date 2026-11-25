#!/usr/bin/env node
/** 开发/测试时不打包直接跑服务端源码（用 esbuild 即时打包到内存后执行）。 */
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';

const r = await build({
  entryPoints: ['server/src/main.ts'],
  bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false,
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
mkdirSync('.data', { recursive: true });
writeFileSync('.data/server.dev.mjs', r.outputFiles[0].text);
await import(new URL('../.data/server.dev.mjs', import.meta.url).href);
