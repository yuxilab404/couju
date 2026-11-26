import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

function buildId(): string {
  if (process.env.COUJU_BUILD_ID) return process.env.COUJU_BUILD_ID;
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

const BUILD_ID = buildId();

const backend = `http://127.0.0.1:${process.env.COUJU_PORT ?? 8790}`;

export default defineConfig({
  root: __dirname,
  // 资源用相对地址，配合 index.html 里的 <base href>，站点可以挂在任意子路径下
  base: './',
  plugins: [
    react(),
    {
      // 页面定期拉它，和自己的 __BUILD_ID__ 不同就提示刷新（ADR-0006）
      name: 'couju-version',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId: BUILD_ID }) });
      },
    },
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: { outDir: '../dist/web', emptyOutDir: true, target: 'es2022' },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/avatars': backend,
      '/ws': { target: backend.replace('http', 'ws'), ws: true },
    },
  },
});
