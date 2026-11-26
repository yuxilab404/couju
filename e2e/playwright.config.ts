import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 8791;
const dataDir = mkdtempSync(join(tmpdir(), 'couju-e2e-'));

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  // CI 上另出一份 HTML 报告传成 artifact：手机端每一屏的截图都在里面，PR 审查时点开就能看
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]] : 'list',
  // 和线上一样挂在子路径 /game/ 下跑，同时验证子路径部署
  use: { baseURL: `http://127.0.0.1:${port}/game/` },
  // 平台要求手机和电脑都能玩（AGENTS.md）：桌面跑全部流程，手机按一大一小两种竖屏用触屏再跑一遍
  projects: [
    { name: 'desktop', testIgnore: /mobile\.spec\.ts/, use: { viewport: { width: 1100, height: 800 } } },
    { name: 'phone-360', testMatch: /mobile\.spec\.ts/, use: { ...devices['Galaxy S8'] } },
    { name: 'phone-412', testMatch: /mobile\.spec\.ts/, use: { ...devices['Pixel 7'] } },
  ],
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
      COUJU_ADMIN_EMAILS: [
        'admin@e2e.test,admin2@e2e.test,admin3@e2e.test,admin4@e2e.test',
        // 手机项目每条用例一个邮箱（同一邮箱 60 秒内不能重发验证码）
        ...['phone-360', 'phone-412'].flatMap((p) => [
          `${p}@e2e.test`,
          `${p}-lr@e2e.test`,
          `${p}-gd@e2e.test`,
          ...[1, 2, 3].map((i) => `${p}-r${i}@e2e.test`),
        ]),
      ].join(','),
      COUJU_BASE_URL: `http://127.0.0.1:${port}/game`,
    },
  },
});
