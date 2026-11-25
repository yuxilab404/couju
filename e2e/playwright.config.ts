import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const port = 8791;
const dataDir = mkdtempSync(join(tmpdir(), 'couju-e2e-'));

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  // 和线上一样挂在子路径 /game/ 下跑，同时验证子路径部署
  use: { baseURL: `http://127.0.0.1:${port}/game/`, viewport: { width: 1100, height: 800 } },
  webServer: {
    // 用打包产物跑，和线上一致；需要先 npm run build
    command: 'node --disable-warning=ExperimentalWarning dist/server/server.mjs',
    cwd: '..',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    env: {
      COUJU_DEV: '1',
      COUJU_PORT: String(port),
      COUJU_DATA_DIR: dataDir,
      COUJU_WEB_DIR: 'dist/web',
      COUJU_ADMIN_EMAILS: 'admin@e2e.test,admin2@e2e.test',
      COUJU_BASE_URL: `http://127.0.0.1:${port}/game`,
    },
  },
});
