import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{sdk,protocol,server,platform,games,web,e2e}/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
  },
});
