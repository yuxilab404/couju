#!/usr/bin/env node
/** 把服务端打成单个 dist/server/server.mjs（容器里不装 node_modules，ADR-0005） */
import { build } from 'esbuild';

await build({
  entryPoints: ['server/src/main.ts'],
  outfile: 'dist/server/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // ws 的可选原生加速包不打进来
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
