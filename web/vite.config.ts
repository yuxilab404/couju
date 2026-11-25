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

const backend = `http://127.0.0.1:${process.env.COUJU_PORT ?? 8790}`;

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
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
